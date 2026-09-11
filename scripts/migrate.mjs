#!/usr/bin/env node
/**
 * BPA Migration Runner
 * Usage: node scripts/migrate.mjs
 * Reads credentials from .env.local and runs all *pending* migrations.
 *
 * It used to run every file in the directory on every invocation, and the CI
 * workflow invokes it on any push that touches supabase/migrations. So adding
 * one unrelated migration re-ran all of them — including the one-time data
 * repairs, which is how a whole finance ledger was marked paid a second time,
 * over the answers a person had since given it.
 *
 * A migration that has been applied is now recorded in `public.schema_migrations`
 * and skipped. A file whose contents have changed since it was recorded is run
 * again and says so, because in this repo a migration is re-assertable DDL and
 * editing one is how it is corrected — but that is now a visible decision
 * rather than what happens to every file, every time, silently.
 *
 * A failure also fails the run. Errors used to be printed and then followed by
 * "✅ Done" and exit 0, so a broken migration deployed green.
 */

import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'
import https from 'https'
import http from 'http'

const __dir = dirname(fileURLToPath(import.meta.url))
const root  = join(__dir, '..')

// ── Load .env.local ──────────────────────────────────────────────────────────
const env = {}
try {
  readFileSync(join(root, '.env.local'), 'utf8')
    .split('\n')
    .filter(l => l.includes('='))
    .forEach(l => {
      const [k, ...v] = l.split('=')
      env[k.trim()] = v.join('=').trim()
    })
} catch {
  console.error('❌  .env.local not found. Create it with SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF.')
  process.exit(1)
}

const TOKEN = env.SUPABASE_ACCESS_TOKEN
const REF   = env.SUPABASE_PROJECT_REF

if (!TOKEN || TOKEN.includes('paste_')) {
  console.error('❌  SUPABASE_ACCESS_TOKEN missing in .env.local')
  process.exit(1)
}
if (!REF || REF.includes('paste_')) {
  console.error('❌  SUPABASE_PROJECT_REF missing in .env.local')
  process.exit(1)
}

/** Rows out of whatever shape the endpoint answers a select with.
 *
 *  Read defensively on purpose. If this returns [] when the ledger is in fact
 *  populated, nothing breaks loudly — every migration simply runs again, every
 *  time, which is precisely the silent behaviour that cost a finance ledger.
 *  So it accepts the bare array the Management API sends today and the common
 *  wrappers, and `checkLedger` below shouts if the answer looks wrong anyway. */
function rowsOf(res) {
  if (Array.isArray(res)) return res
  for (const key of ['result', 'rows', 'data']) {
    if (Array.isArray(res?.[key])) return res[key]
  }
  return []
}

// ── Run SQL via Supabase Management API ──────────────────────────────────────
// Point at something other than Supabase — a local Postgres proxy, or a stand-in
// that records what it was asked to run. The default is the real project.
const ENDPOINT = process.env.MIGRATE_ENDPOINT

function runSQL(sql) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query: sql })
    const target = ENDPOINT ? new URL(ENDPOINT) : null
    const transport = target && target.protocol === 'http:' ? http : https
    const req  = transport.request({
      hostname: target ? target.hostname : 'api.supabase.com',
      port:     target ? target.port : undefined,
      path:     target ? target.pathname : `/v1/projects/${REF}/database/query`,
      method:   'POST',
      headers:  {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data))
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`))
        }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// ── The ledger of what has already been applied ──────────────────────────────
// Created by the runner rather than by a migration of its own, so it exists
// before the first file is considered.
await runSQL(`
  create table if not exists public.schema_migrations (
    name       text primary key,
    checksum   text        not null,
    applied_at timestamptz not null default now()
  );
`)

const applied = new Map()
for (const row of rowsOf(await runSQL('select name, checksum from public.schema_migrations;'))) {
  applied.set(row.name, row.checksum)
}

// ── Load and run migration files ─────────────────────────────────────────────
const migrationsDir = join(root, 'supabase', 'migrations')
const files = readdirSync(migrationsDir)
  .filter(f => f.endsWith('.sql'))
  .sort()

const sum = sql => createHash('sha256').update(sql).digest('hex')

let ran = 0, skipped = 0, failed = 0

console.log(`\n🚀  ${files.length} migration(s) on disk, ${applied.size} already applied\n`)

for (const file of files) {
  const sql  = readFileSync(join(migrationsDir, file), 'utf8')
  const hash = sum(sql)
  const seen = applied.get(file)

  if (seen === hash) { skipped++; continue }

  process.stdout.write(`  → ${file}${seen ? ' (changed since it was applied)' : ''} ... `)
  try {
    await runSQL(sql)
    await runSQL(`
      insert into public.schema_migrations (name, checksum) values ($$${file}$$, $$${hash}$$)
      on conflict (name) do update set checksum = excluded.checksum, applied_at = now();
    `)
    console.log('✓')
    ran++
  } catch (err) {
    console.log(`✗\n     ${err.message}`)
    failed++
  }
}

// Did the ledger actually take? A runner that writes rows it cannot read back
// reports a clean run and then re-applies everything on the next push — the
// failure is invisible until a data migration fires a second time over data
// somebody has since changed. So prove the round trip rather than assume it.
if (ran > 0 && failed === 0) {
  const back = rowsOf(await runSQL('select name from public.schema_migrations;')).length
  if (back < ran) {
    console.error(
      `\n⚠️   Wrote ${ran} ledger row(s) and read back ${back}. The ledger is not\n` +
      `    working, so every migration will run again on the next push. Check the\n` +
      `    shape this endpoint answers a select with — see rowsOf().\n`)
    process.exit(1)
  }
}

console.log(`\n${failed ? '❌' : '✅'}  ${ran} applied, ${skipped} already up to date, ${failed} failed.\n`)
process.exit(failed ? 1 : 0)

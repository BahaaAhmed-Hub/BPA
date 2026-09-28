#!/usr/bin/env node
/**
 * node scripts/select-columns-exist.mjs
 *
 * Every `.from('t').select('a, b, c')` in `src/`, against the columns the
 * project really has. Credentials come from `.env.local` / the environment,
 * exactly as `migrate.mjs` reads them — nothing is stored here.
 *
 * This exists because a select naming a column nobody has is a **400 that
 * fails the whole read**, and almost every caller turns that into "there is
 * nothing there". `loadAccountsFromServer` asked `google_accounts` for a
 * `scopes` column no migration ever added, so three connected accounts —
 * rows and live tokens intact in Postgres — read on screen as none at all.
 * TypeScript cannot catch it: the column name is a string, and the table it
 * names is in another system. One round trip can.
 *
 * Exits non-zero on any mismatch, so it can be a step in a workflow.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import https from 'node:https'

const envFile = new URL('../.env.local', import.meta.url)
if (existsSync(envFile)) for (const line of readFileSync(envFile, 'utf8').split('\n')) {
  const i = line.indexOf('=')
  if (i > 0 && !process.env[line.slice(0, i).trim()]) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim()
}
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const REF   = process.env.SUPABASE_PROJECT_REF
if (!TOKEN || !REF) {
  console.error('❌  SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF are needed (.env.local or the environment)')
  process.exit(1)
}

const runSQL = sql => new Promise((res, rej) => {
  const body = JSON.stringify({ query: sql })
  const req = https.request({ hostname: 'api.supabase.com', path: `/v1/projects/${REF}/database/query`,
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body) } }, r => {
    let d = ''; r.on('data', c => d += c)
    r.on('end', () => r.statusCode >= 200 && r.statusCode < 300
      ? res(JSON.parse(d)) : rej(new Error(`HTTP ${r.statusCode}: ${d}`)))
  })
  req.on('error', rej); req.write(body); req.end()
})

const files = []
;(function walk(d) { for (const e of readdirSync(d)) { const p = `${d}/${e}`
  if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(p)) files.push(p) } })(
  new URL('../src', import.meta.url).pathname)

const cols = {}
for (const r of await runSQL(`select table_name, string_agg(column_name, ',') as c
  from information_schema.columns where table_schema = 'public' group by table_name`))
  cols[r.table_name] = new Set(r.c.split(','))

// `.from('t')` then `.select('…')` within a short reach — the shape every call
// site here uses. A computed select is skipped rather than guessed at.
const RE = /\.from\(\s*['"`]([a-z_]+)['"`]\s*\)[\s\S]{0,120}?\.select\(\s*['"`]([^'"`]*)['"`]/g
const seen = new Set()
let bad = 0, checked = 0
for (const f of files) {
  const rel = f.split('/src/')[1]
  for (const [, table, sel] of readFileSync(f, 'utf8').matchAll(RE)) {
    if (!cols[table]) { console.log(`?  ${table} — no such table   (${rel})`); bad++; continue }
    checked++
    // Drop `*`, embeds (`a!b(…)`), aliases and functions — only plain columns.
    for (const c of sel.split(',').map(s => s.trim().split('(')[0].split(':').pop().trim())
                       .filter(c => c && c !== '*' && !c.includes('!') && /^[a-z_]+$/.test(c))) {
      if (cols[table].has(c)) continue
      const k = `${table}.${c}`
      if (seen.has(k)) continue
      seen.add(k); bad++
      console.log(`✗  ${table}.${c} — not a column   (${rel})`)
    }
  }
}
console.log(`\n${checked} select(s) checked, ${bad} naming something that does not exist`)
process.exit(bad ? 1 : 0)

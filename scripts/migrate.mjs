#!/usr/bin/env node
/**
 * BPA Migration Runner
 * Usage: node scripts/migrate.mjs
 * Reads credentials from .env.local and runs all pending migrations.
 */

import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import https from 'https'

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

// ── Run SQL via Supabase Management API ──────────────────────────────────────
function runSQL(sql) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query: sql })
    const req  = https.request({
      hostname: 'api.supabase.com',
      path:     `/v1/projects/${REF}/database/query`,
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

// ── Load and run migration files ─────────────────────────────────────────────
const migrationsDir = join(root, 'supabase', 'migrations')
const files = readdirSync(migrationsDir)
  .filter(f => f.endsWith('.sql'))
  .sort()

console.log(`\n🚀  Running ${files.length} migration(s)...\n`)

for (const file of files) {
  const sql = readFileSync(join(migrationsDir, file), 'utf8')
  process.stdout.write(`  → ${file} ... `)
  try {
    await runSQL(sql)
    console.log('✓')
  } catch (err) {
    console.log(`✗\n     ${err.message}`)
  }
}

console.log('\n✅  Done.\n')

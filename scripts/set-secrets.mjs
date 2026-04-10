#!/usr/bin/env node
/**
 * Set Supabase Edge Function secrets via the Management API.
 * Usage: node scripts/set-secrets.mjs GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy
 *
 * Reads SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF from .env.local
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import https from 'https'

const __dir = dirname(fileURLToPath(import.meta.url))
const root  = join(__dir, '..')

// ── Load .env.local ──────────────────────────────────────────────────────────
const env = {}
try {
  readFileSync(join(root, '.env.local'), 'utf8')
    .split('\n').filter(l => l.includes('=')).forEach(l => {
      const [k, ...v] = l.split('=')
      env[k.trim()] = v.join('=').trim()
    })
} catch {
  console.error('❌  .env.local not found.')
  process.exit(1)
}

const TOKEN = env.SUPABASE_ACCESS_TOKEN
const REF   = env.SUPABASE_PROJECT_REF

if (!TOKEN || !REF) {
  console.error('❌  SUPABASE_ACCESS_TOKEN or SUPABASE_PROJECT_REF missing in .env.local')
  process.exit(1)
}

// ── Parse KEY=value args ─────────────────────────────────────────────────────
const secrets = process.argv.slice(2).map(arg => {
  const idx = arg.indexOf('=')
  if (idx === -1) { console.error(`❌  Bad format: "${arg}" — use KEY=value`); process.exit(1) }
  return { name: arg.slice(0, idx), value: arg.slice(idx + 1) }
})

if (secrets.length === 0) {
  console.error('Usage: node scripts/set-secrets.mjs GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy')
  process.exit(1)
}

// ── POST to Supabase Management API ─────────────────────────────────────────
function postSecrets(secrets) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(secrets)
    const req = https.request({
      hostname: 'api.supabase.com',
      path:     `/v1/projects/${REF}/secrets`,
      method:   'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve()
        else reject(new Error(`HTTP ${res.statusCode}: ${data}`))
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

console.log(`\n🔐  Setting ${secrets.length} secret(s) on project ${REF}...\n`)
for (const s of secrets) {
  process.stdout.write(`  → ${s.name} ... `)
}
console.log()

try {
  await postSecrets(secrets)
  console.log('\n✅  Secrets set. The Edge Function will use them on next invocation.\n')
} catch (err) {
  console.error(`\n❌  Failed: ${err.message}\n`)
  process.exit(1)
}

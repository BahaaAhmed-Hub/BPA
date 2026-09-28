#!/usr/bin/env node
/**
 * Creates (or resets) the static admin user in Supabase.
 *
 * Usage:
 *   ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=yourpassword node scripts/setup-admin.mjs
 *
 * Or add ADMIN_EMAIL and ADMIN_PASSWORD to .env.local (never commit that file).
 * Also reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local.
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))

// Load .env.local
const envPath = resolve(__dir, '../.env.local')
let envVars = {}
try {
  const raw = readFileSync(envPath, 'utf8')
  for (const line of raw.split('\n')) {
    const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/)
    if (m) envVars[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
  }
} catch {
  console.log('No .env.local found — using environment variables only.')
}

const SUPABASE_URL         = process.env.SUPABASE_URL         || envVars.SUPABASE_URL         || envVars.VITE_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || envVars.SUPABASE_SERVICE_ROLE_KEY
const ADMIN_EMAIL          = process.env.ADMIN_EMAIL          || envVars.ADMIN_EMAIL
const ADMIN_PASSWORD       = process.env.ADMIN_PASSWORD       || envVars.ADMIN_PASSWORD

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD (in .env.local or as env vars)')
  process.exit(1)
}
if (ADMIN_PASSWORD.length < 12) {
  console.error('ADMIN_PASSWORD must be at least 12 characters')
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// Check if user already exists
const { data: existing } = await admin.auth.admin.listUsers()
const found = existing?.users?.find(u => u.email === ADMIN_EMAIL)

let userId
if (found) {
  console.log(`User ${ADMIN_EMAIL} already exists — updating password.`)
  const { error } = await admin.auth.admin.updateUserById(found.id, { password: ADMIN_PASSWORD })
  if (error) { console.error('Failed to update password:', error.message); process.exit(1) }
  userId = found.id
} else {
  console.log(`Creating user ${ADMIN_EMAIL}…`)
  const { data, error } = await admin.auth.admin.createUser({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    email_confirm: true,
  })
  if (error) { console.error('Failed to create user:', error.message); process.exit(1) }
  userId = data.user.id
}

// Insert into public.admins (ignore if already there)
const { error: admErr } = await admin
  .from('admins')
  .upsert({ user_id: userId }, { onConflict: 'user_id' })
if (admErr) { console.error('Failed to insert into public.admins:', admErr.message); process.exit(1) }

console.log(`\n✓ Admin user ready`)
console.log(`  Email:   ${ADMIN_EMAIL}`)
console.log(`  User ID: ${userId}`)
console.log(`\nSign in at: <your-app-url>/#admin`)

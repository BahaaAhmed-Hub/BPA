#!/usr/bin/env node
/**
 * Creates (or resets) the static admin user in Supabase.
 *
 * Usage:
 *   ADMIN_USERNAME=bahaa.ahmed ADMIN_PASSWORD=yourpassword node scripts/setup-admin.mjs
 *
 * Or add these to .env.local (never commit that file).
 * Supabase requires an email; the username is stored as <username>@admin.local internally.
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
const ADMIN_USERNAME       = process.env.ADMIN_USERNAME       || envVars.ADMIN_USERNAME
const ADMIN_PASSWORD       = process.env.ADMIN_PASSWORD       || envVars.ADMIN_PASSWORD

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
  console.error('Set ADMIN_USERNAME and ADMIN_PASSWORD (in .env.local or as env vars)')
  process.exit(1)
}

// Supabase auth requires an email address; we construct one from the username
const ADMIN_EMAIL = `${ADMIN_USERNAME}@admin.local`

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// Check if user already exists
const { data: existing } = await admin.auth.admin.listUsers()
const found = existing?.users?.find(u => u.email === ADMIN_EMAIL)

let userId
if (found) {
  console.log(`User ${ADMIN_USERNAME} already exists — updating password.`)
  const { error } = await admin.auth.admin.updateUserById(found.id, { password: ADMIN_PASSWORD })
  if (error) { console.error('Failed to update password:', error.message); process.exit(1) }
  userId = found.id
} else {
  console.log(`Creating user ${ADMIN_USERNAME}…`)
  const { data, error } = await admin.auth.admin.createUser({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    email_confirm: true,
  })
  if (error) { console.error('Failed to create user:', error.message); process.exit(1) }
  userId = data.user.id
}

// Insert into public.admins
const { error: admErr } = await admin
  .from('admins')
  .upsert({ user_id: userId }, { onConflict: 'user_id' })
if (admErr) { console.error('Failed to insert into public.admins:', admErr.message); process.exit(1) }

console.log(`\n✓ Admin user ready`)
console.log(`  Username: ${ADMIN_USERNAME}`)
console.log(`  User ID:  ${userId}`)
console.log(`\nSign in at: <your-app-url>/#admin`)

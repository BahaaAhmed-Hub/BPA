/**
 * admin-user-management — Supabase Edge Function
 *
 * Auth-level CRUD that needs the service role key. Every request is
 * verified against public.admins before anything runs.
 *
 * Actions (POST body: { action, ...payload }):
 *   create         — { email, full_name, plan, password? } → { user_id, temp_password }
 *   delete         — { user_id } → {}
 *   update_email   — { user_id, email } → {}
 *   reset_password — { user_id, password } → {}
 *
 * Auto-injected: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function ok(data: unknown) {
  return new Response(JSON.stringify(data), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } })
}
function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

function randPassword(len = 16): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$'
  const buf = new Uint8Array(len)
  crypto.getRandomValues(buf)
  return Array.from(buf, b => chars[b % chars.length]).join('')
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  // ── Verify the caller is a signed-in admin ────────────────────────────────
  const jwt = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!jwt) return err('Missing authorization header', 401)

  const caller = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: adminRow } = await caller.from('admins').select('user_id').maybeSingle()
  if (!adminRow) return err('Not an admin', 403)

  // ── Dispatch ──────────────────────────────────────────────────────────────
  let body: Record<string, string>
  try { body = await req.json() } catch { return err('Invalid JSON') }

  const { action } = body

  // ── create ────────────────────────────────────────────────────────────────
  if (action === 'create') {
    const { email, full_name, plan, password } = body
    if (!email) return err('email is required')

    const tempPassword = password?.length >= 6 ? password : randPassword()

    const { data, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name: full_name ?? '' },
    })
    if (createErr) return err(createErr.message)

    const userId = data.user.id

    // handle_new_user trigger creates the public.users row; update the name
    if (full_name) {
      await admin.from('users').update({ full_name }).eq('id', userId)
    }

    // Create subscription row
    if (plan && plan !== 'free') {
      await admin.from('subscriptions').upsert(
        { user_id: userId, plan, status: 'active' },
        { onConflict: 'user_id' },
      )
    }

    return ok({ user_id: userId, temp_password: tempPassword })
  }

  // ── delete ────────────────────────────────────────────────────────────────
  if (action === 'delete') {
    const { user_id } = body
    if (!user_id) return err('user_id is required')

    // Deleting the auth user cascades to public.users (FK on delete cascade),
    // which cascades to subscriptions, companies, tasks, habits, finance, etc.
    const { error: delErr } = await admin.auth.admin.deleteUser(user_id)
    if (delErr) return err(delErr.message)

    return ok({ deleted: user_id })
  }

  // ── update_email ──────────────────────────────────────────────────────────
  if (action === 'update_email') {
    const { user_id, email } = body
    if (!user_id || !email) return err('user_id and email are required')

    const { error: upErr } = await admin.auth.admin.updateUserById(user_id, { email })
    if (upErr) return err(upErr.message)

    // Keep public.users.email in sync
    await admin.from('users').update({ email }).eq('id', user_id)

    return ok({ updated: user_id })
  }

  // ── reset_password ────────────────────────────────────────────────────────
  if (action === 'reset_password') {
    const { user_id, password } = body
    if (!user_id || !password) return err('user_id and password are required')
    if (password.length < 6)   return err('Password must be at least 6 characters')

    const { error: upErr } = await admin.auth.admin.updateUserById(user_id, { password })
    if (upErr) return err(upErr.message)

    return ok({ updated: user_id })
  }

  return err(`Unknown action: ${action}`)
})

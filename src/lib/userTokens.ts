/**
 * userTokens — CRUD for personal access tokens (user_tokens table).
 *
 * Tokens authenticate the MCP server, Siri Shortcuts, and the Telegram bot.
 * Each starts with `prof_sk_` followed by 48 hex chars (24 random bytes).
 * The token is shown to the user once on creation and stored plaintext in the
 * DB (protected by RLS — only the owner can SELECT).
 */

import { supabase } from './supabase'

export interface UserToken {
  id:           string
  label:        string
  token:        string   // only present right after creation
  created_at:   string
  last_used_at: string | null
  revoked:      boolean
}

export function generateToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return 'prof_sk_' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

export async function createUserToken(label: string): Promise<UserToken | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const token = generateToken()
  const { data, error } = await supabase
    .from('user_tokens')
    .insert({ user_id: user.id, token, label })
    .select()
    .single()

  if (error) { console.warn('[userTokens] create error:', error); return null }
  return data as UserToken
}

export async function listUserTokens(): Promise<UserToken[]> {
  const { data, error } = await supabase
    .from('user_tokens')
    .select('id, label, created_at, last_used_at, revoked')
    .eq('revoked', false)
    .order('created_at', { ascending: false })

  if (error) { console.warn('[userTokens] list error:', error); return [] }
  return (data ?? []) as UserToken[]
}

export async function revokeUserToken(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('user_tokens')
    .update({ revoked: true })
    .eq('id', id)

  if (error) { console.warn('[userTokens] revoke error:', error); return false }
  return true
}

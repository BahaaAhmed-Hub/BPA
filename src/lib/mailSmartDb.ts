// ─── Where the smart view's reading is kept ──────────────────────────────────
//
//  Every call here is allowed to fail. The migration may not have run, the
//  network may be down, and neither is a reason for the tab to be empty: the
//  view falls back to reading the mail live, which is what it would have done
//  anyway on a first run. A read that fails returns `null` — "could not ask" —
//  and never `[]`, which would mean "there is nothing", and would quietly
//  re-analyse thirty days of mail every time the table was unreachable.

import { supabase } from '@/lib/supabase'
import type { SmartSection, ReplyState } from '@/lib/mailSmart'
import type { MailKind } from '@/lib/mailKinds'

export interface SmartRow {
  account_email: string
  thread_id: string
  last_message_id: string
  last_at: string
  subject: string | null
  from_name: string | null
  from_email: string | null
  section: SmartSection
  reply_state: ReplyState
  need: string | null
  draft: string | null
  direct: boolean
  addressed_to: boolean
  named_in_body: boolean
  bottleneck: boolean
  awaiting_customer: boolean
  handled_at: string | null
  kind: MailKind
  /** You have said you do not want this thread. New messages do not undo it. */
  muted: boolean
  archived_at: string | null
  acknowledged_at: string | null
  analyzed_at: string
}

let tableMissing = false
/** Whether the server can hold any of this. Settings says so when it cannot. */
export function smartStoreAvailable(): boolean { return !tableMissing }

function noteMissing(err: { message?: string; code?: string } | null): void {
  // 42P01 is "relation does not exist" — the migration has not run. Anything
  // else is a transient failure and must not turn the feature off.
  if (err?.code === '42P01') tableMissing = true
}

async function uid(): Promise<string | null> {
  const { data } = await supabase.auth.getUser()
  return data.user?.id ?? null
}

/** Everything read for these mailboxes inside the window. `null` on a failure. */
export async function loadSmartThreads(
  accounts: string[], since: Date,
): Promise<SmartRow[] | null> {
  if (tableMissing || accounts.length === 0) return null
  const userId = await uid()
  if (!userId) return null
  const { data, error } = await supabase
    .from('mail_smart_threads')
    .select('*')
    .eq('user_id', userId)
    .in('account_email', accounts)
    .gte('last_at', since.toISOString())
    .order('last_at', { ascending: false })
  if (error) { noteMissing(error); return null }
  return (data ?? []) as SmartRow[]
}

export async function saveSmartThreads(rows: Omit<SmartRow, 'analyzed_at'>[]): Promise<void> {
  if (tableMissing || rows.length === 0) return
  const userId = await uid()
  if (!userId) return
  // One request for the batch. Sent one at a time, a pass over forty threads is
  // forty round trips, and a reload landing in the middle of it stores half a
  // reading.
  const { error } = await supabase
    .from('mail_smart_threads')
    .upsert(rows.map(r => ({ ...r, user_id: userId, analyzed_at: new Date().toISOString() })),
            { onConflict: 'user_id,account_email,thread_id' })
  if (error) { noteMissing(error); console.warn('mail smart: could not store', error.message) }
}

/** Set one of the "stop showing me this" marks on a thread.
 *
 *  They are separate because they promise different things: handled is "dealt
 *  with for now", muted is "not this thread, ever", acknowledged is "seen" for
 *  the kinds that are never actions, and archived records what was done to the
 *  mail itself. A single flag would have made undoing one undo the others. */
export async function markThread(
  accountEmail: string, threadId: string,
  marks: Partial<Pick<SmartRow, 'handled_at' | 'muted' | 'archived_at' | 'acknowledged_at'>>,
): Promise<void> {
  if (tableMissing) return
  const userId = await uid()
  if (!userId) return
  const { error } = await supabase
    .from('mail_smart_threads')
    .update(marks)
    .match({ user_id: userId, account_email: accountEmail, thread_id: threadId })
  if (error) noteMissing(error)
}

/** Dealt with for now. */
export async function markHandled(
  accountEmail: string, threadId: string, handled: boolean,
): Promise<void> {
  await markThread(accountEmail, threadId, { handled_at: handled ? new Date().toISOString() : null })
}

/** Delete what has fallen out of the thirty-day window. Without this the table
 *  grows for ever and every load drags the whole history back. */
export async function pruneSmartThreads(before: Date): Promise<void> {
  if (tableMissing) return
  const userId = await uid()
  if (!userId) return
  const { error } = await supabase
    .from('mail_smart_threads')
    .delete()
    .eq('user_id', userId)
    .lt('last_at', before.toISOString())
  if (error) noteMissing(error)
}

// ─── The watermark ───────────────────────────────────────────────────────────

export async function loadSyncMarks(accounts: string[]): Promise<Record<string, number>> {
  if (tableMissing || accounts.length === 0) return {}
  const userId = await uid()
  if (!userId) return {}
  const { data, error } = await supabase
    .from('mail_smart_sync')
    .select('account_email, synced_to')
    .eq('user_id', userId)
    .in('account_email', accounts)
  if (error) { noteMissing(error); return {} }
  const out: Record<string, number> = {}
  for (const r of data ?? []) {
    const t = (r as { synced_to: string | null }).synced_to
    if (t) out[(r as { account_email: string }).account_email] = new Date(t).getTime()
  }
  return out
}

export async function saveSyncMark(accountEmail: string, syncedTo: number): Promise<void> {
  if (tableMissing) return
  const userId = await uid()
  if (!userId) return
  const { error } = await supabase
    .from('mail_smart_sync')
    .upsert({
      user_id: userId, account_email: accountEmail,
      synced_to: new Date(syncedTo).toISOString(),
      last_run_at: new Date().toISOString(),
    }, { onConflict: 'user_id,account_email' })
  if (error) noteMissing(error)
}

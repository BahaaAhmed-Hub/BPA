// ─── Keeping two open devices in step ────────────────────────────────────────
// Everything in this app already reads the server once, at sign-in, and then
// never again. Open the laptop and the iPad together and they drift apart for
// the rest of the session: a habit ticked on one, a task moved on the other, a
// transaction added on a third — none of it arrives until someone reloads.
//
// This is the layer that makes them agree while they are both open. It does
// not try to apply row deltas; it asks the store that owns the data to reload
// it. The stores already know how to merge, and duplicating that here is how
// two implementations of the same merge end up disagreeing.
//
// Two things wake it, and it works with either alone:
//
//   · Postgres change events, which arrive in about a second, and need the
//     tables to be published for Realtime (20260004_realtime.sql).
//   · A poll, plus a pull whenever the tab comes back to the foreground or the
//     network returns. This needs nothing, and is what carries the feature on
//     a database where Realtime was never switched on.
//
// The poll backs right off once Realtime is confirmed working, so it costs a
// request every few minutes rather than every few seconds.

import { supabase } from '@/lib/supabase'

export type LiveDomain = 'habits' | 'tasks' | 'finance'

/** Every table whose changes anyone here cares about, and who to tell. */
const DOMAIN_OF_TABLE: Record<string, LiveDomain> = {
  habits:                   'habits',
  habit_logs:               'habits',
  tasks:                    'tasks',
  finance_accounts:         'finance',
  finance_categories:       'finance',
  finance_transactions:     'finance',
  finance_plans:            'finance',
  finance_actuals_override: 'finance',
  finance_cell_comments:    'finance',
  finance_bills:            'finance',
  finance_goals:            'finance',
  finance_budgets:          'finance',
}

const DOMAINS = ['habits', 'tasks', 'finance'] as const

type Refetch = () => void | Promise<void>

const refetchers = new Map<LiveDomain, Refetch>()
const pending  = new Map<LiveDomain, ReturnType<typeof setTimeout>>()
const lastRun  : Record<LiveDomain, number> = { habits: 0, tasks: 0, finance: 0 }
const lastWrite: Record<LiveDomain, number> = { habits: 0, tasks: 0, finance: 0 }

/** A row change rarely arrives alone — one edit can touch a habit and three of
 *  its logs — so let the burst finish before reading. */
const SETTLE_MS = 700

/** An edit here is held for 1.5s before it is written. Reloading inside that
 *  window would pull the old row back over what the person is still typing, so
 *  wait until their own write has had time to land. */
const QUIET_MS = 3000

/** A floor on how often a domain reloads, whatever is asking. */
const MIN_GAP_MS = 4000

const POLL_WITH_REALTIME_MS = 5 * 60_000
const POLL_ALONE_MS         = 45_000

let realtimeReady = false

/** Called by a store the moment it changes something, and again when the write
 *  lands. Without it, live sync fights the person using the app. */
export function markLocalWrite(domain: LiveDomain): void {
  lastWrite[domain] = Date.now()
}

function schedule(domain: LiveDomain, delay: number = SETTLE_MS): void {
  const existing = pending.get(domain)
  if (existing) clearTimeout(existing)
  pending.set(domain, setTimeout(() => { void run(domain) }, delay))
}

async function run(domain: LiveDomain): Promise<void> {
  pending.delete(domain)
  const fn = refetchers.get(domain)
  if (!fn) return

  const now = Date.now()
  const quietFor = QUIET_MS - (now - lastWrite[domain])
  if (quietFor > 0) { schedule(domain, quietFor); return }
  const gap = MIN_GAP_MS - (now - lastRun[domain])
  if (gap > 0) { schedule(domain, gap); return }

  lastRun[domain] = now
  try { await fn() } catch { /* offline, or signed out mid-flight */ }
}

/** Reload everything now — the tab just came back, or the network did. */
export function refreshAllNow(): void {
  for (const d of DOMAINS) if (refetchers.has(d)) schedule(d, 0)
}

export interface LiveSyncHandlers {
  habits:  Refetch
  tasks:   Refetch
  finance: Refetch
}

/** Returns the teardown. Safe to call again after sign-out and back in. */
export function startLiveSync(userId: string, handlers: LiveSyncHandlers): () => void {
  refetchers.set('habits',  handlers.habits)
  refetchers.set('tasks',   handlers.tasks)
  refetchers.set('finance', handlers.finance)

  // ── Push ───────────────────────────────────────────────────────────────────
  // One channel, one listener per table. The user_id filter is what keeps a
  // shared database from waking every session; DELETE can only be filtered
  // when the table replicates its old row, which the migration arranges.
  // Realtime carries its own copy of the auth token and checks it against RLS.
  // The client normally keeps it current on its own; saying so explicitly costs
  // nothing and covers the case where the socket predates the session.
  try { void supabase.realtime.setAuth() } catch { /* older client, handled */ }

  const channel = supabase.channel(`live-sync:${userId}`)
  for (const table of Object.keys(DOMAIN_OF_TABLE)) {
    channel.on(
      // The typings for this overload are generated per-schema and do not
      // survive a generic table name.
      'postgres_changes' as never,
      { event: '*', schema: 'public', table, filter: `user_id=eq.${userId}` } as never,
      (() => { schedule(DOMAIN_OF_TABLE[table]) }) as never,
    )
  }
  channel.subscribe(status => {
    realtimeReady = status === 'SUBSCRIBED'
    // Whatever changed while this device was not listening.
    if (realtimeReady) refreshAllNow()
  })

  // ── Pull ───────────────────────────────────────────────────────────────────
  const wake = () => {
    if (document.visibilityState !== 'visible') return
    refreshAllNow()
  }
  document.addEventListener('visibilitychange', wake)
  window.addEventListener('focus', wake)
  window.addEventListener('online', wake)

  // A single slow tick rather than three timers. It is the whole feature when
  // Realtime is off, and a backstop for a dropped socket when it is on.
  const tick = setInterval(() => {
    if (document.visibilityState !== 'visible') return
    const every = realtimeReady ? POLL_WITH_REALTIME_MS : POLL_ALONE_MS
    const now = Date.now()
    for (const d of DOMAINS) {
      if (refetchers.has(d) && now - lastRun[d] >= every) schedule(d, 0)
    }
  }, 15_000)

  return () => {
    clearInterval(tick)
    document.removeEventListener('visibilitychange', wake)
    window.removeEventListener('focus', wake)
    window.removeEventListener('online', wake)
    void supabase.removeChannel(channel)
    for (const t of pending.values()) clearTimeout(t)
    pending.clear()
    refetchers.clear()
    realtimeReady = false
  }
}

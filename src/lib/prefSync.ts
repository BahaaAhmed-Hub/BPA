// ─── Preferences that belong to you, not to a browser ────────────────────────
// Most of what this app remembers lives in localStorage, which is per browser
// and, on iOS, erased after a week of not visiting. Some of those keys are
// genuinely device preferences — which tab you had open. Others are your work:
// which events you marked done, your board columns, your automation rules, your
// budget. Those follow you.
//
// They ride in users.schedule_rules, already a jsonb column, so no migration.
//
// The merge is deliberately timid: the server fills in a key this device has
// never had, and otherwise leaves it alone. Two devices editing the same
// preference would need real conflict resolution, and quietly overwriting the
// one in front of you is worse than being slightly out of date.

import { supabase } from '@/lib/supabase'

/** Your work — the same on every device you open. */
const SHARED_KEYS = [
  'cal-event-statuses',          // which events you marked done or cancelled
  'cal-intel-hidden',            // calendars you hid
  'cal-intel-hidden-accounts',
  'cal-intel-colors',            // colours you gave them
  'professor-custom-statuses',   // your task board's columns
  'professor-automation-rules',  // the rules that run for you
  'professor-company-users',     // people, per company
  'professor-habit-quantity-logs', // how much, not just whether
  'professor-notif-events',
  'professor-review-hours',
  'professor-ai-config',
  'professor-display-name',
  'task-board-col-order',
  'task-board-type',
  'finance-budget-rules',
  'finance-tx-flags',
  'finance-payees',              // who you have paid before
  'finance-category-order',
  'finance-tab-order',
  'finance-currency',
  'finance-month-start',
  'finance-week-start',
  'finance-alert-threshold',
  'finance-count-on',
  'finance-include-planned',
  'finance-envelope-style',
  'finance-numbers-in-full',
  'finance-round-whole',
  'finance-show-cents',
] as const

// Deliberately not synced: tokens and caches (google_provider_token,
// cal-intel-*-cache), and which view you happened to leave open on this
// device (cal-view, task-view-mode, settings-active-section, professor-ui).

const FIELD = 'shared_prefs'

/** Fill-if-missing is right for a preference — one value, and the device in
 *  front of you knows it best. It is wrong for a *log*: the moment a device
 *  writes its own copy it stops receiving anyone else's, permanently, and the
 *  counts you entered on the laptop never reach the iPad. These keys are maps
 *  that can simply be joined, so join them. Where both sides have the same
 *  entry this device's wins; where only the server has one, it arrives. */
const MERGEABLE: Partial<Record<typeof SHARED_KEYS[number], (mine: string, theirs: string) => string>> = {
  // A list of names. Joining keeps a payee typed on the laptop reaching the
  // iPad; fill-if-missing would have stopped the moment either device saved one.
  'finance-payees': (mine, theirs) => {
    try {
      const a = JSON.parse(mine)   as string[]
      const b = JSON.parse(theirs) as string[]
      const out: string[] = []
      const seen = new Set<string>()
      for (const name of [...a, ...b]) {
        const key = name.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key); out.push(name)
      }
      return JSON.stringify(out.slice(0, 400))
    } catch { return mine }
  },

  // { habitId: { 'YYYY-MM-DD': count } }
  'professor-habit-quantity-logs': (mine, theirs) => {
    try {
      const a = JSON.parse(mine)   as Record<string, Record<string, number>>
      const b = JSON.parse(theirs) as Record<string, Record<string, number>>
      const out: Record<string, Record<string, number>> = { ...b }
      for (const [habitId, days] of Object.entries(a)) {
        out[habitId] = { ...(b[habitId] ?? {}), ...days }
      }
      return JSON.stringify(out)
    } catch { return mine }
  },
}

async function userId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ?? null
}

/** Send this device's copy up. Last writer wins, which is why the pull below
 *  never overwrites a key that already exists here. */
export async function pushSharedPrefs(): Promise<void> {
  const id = await userId()
  if (!id) return

  const bag: Record<string, string> = {}
  for (const key of SHARED_KEYS) {
    const v = localStorage.getItem(key)
    if (v != null) bag[key] = v
  }
  if (Object.keys(bag).length === 0) return

  const { data: existing } = await supabase
    .from('users').select('schedule_rules').eq('id', id).maybeSingle()

  const rules = (existing?.schedule_rules as Record<string, unknown>) ?? {}
  await supabase.from('users')
    .update({ schedule_rules: { ...rules, [FIELD]: bag } })
    .eq('id', id)
}

/** Fill in whatever this device has never had. Returns the keys it restored,
 *  so a caller can reload the stores that read them. */
export async function pullSharedPrefs(): Promise<string[]> {
  const id = await userId()
  if (!id) return []

  const { data } = await supabase
    .from('users').select('schedule_rules').eq('id', id).maybeSingle()

  const rules = (data?.schedule_rules as Record<string, unknown>) ?? {}
  const bag = rules[FIELD] as Record<string, string> | undefined
  if (!bag) return []

  const restored: string[] = []
  for (const key of SHARED_KEYS) {
    const v = bag[key]
    if (typeof v !== 'string') continue

    const mine = localStorage.getItem(key)
    if (mine != null) {
      const join = MERGEABLE[key]
      if (!join) continue                             // this device knows better
      const joined = join(mine, v)
      if (joined === mine) continue                   // nothing new arrived
      try { localStorage.setItem(key, joined); restored.push(key) } catch { /* full */ }
      continue
    }

    try { localStorage.setItem(key, v); restored.push(key) } catch { /* full */ }
  }
  return restored
}

/** Pull once, then push on the way out and every few minutes, which is often
 *  enough for preferences and rare enough not to matter. */
export function startPrefSync(): () => void {
  void pullSharedPrefs().then(restored => {
    // Anything restored arrived after the modules that read it, so tell them.
    if (restored.length) window.dispatchEvent(new CustomEvent('professor:prefsRestored', { detail: restored }))
    void pushSharedPrefs()
  })

  const timer = setInterval(() => { void pushSharedPrefs() }, 5 * 60_000)
  const onHide = () => { if (document.visibilityState === 'hidden') void pushSharedPrefs() }
  document.addEventListener('visibilitychange', onHide)

  return () => {
    clearInterval(timer)
    document.removeEventListener('visibilitychange', onHide)
  }
}

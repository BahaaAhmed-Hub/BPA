import { supabase } from './supabase'

// ─── Steps from an iPhone ────────────────────────────────────────────────────
//
// There is no way for a web page to read Apple Health. HealthKit is a native
// iOS framework with no web API and no OAuth service; a browser on the phone
// cannot see a single step, and no amount of permission-asking changes that.
//
// What Apple does give is **Shortcuts**: on the phone, a Shortcut can read a
// health sample and POST it anywhere, and an Automation can run it every day
// without being opened. So the phone pushes, rather than this pulling — which
// is the only shape that exists.
//
// A link is one habit, one metric and one secret URL. The Shortcut sends the
// number to that URL; the edge function writes it as the day's quantity for
// that habit. Per-habit tokens mean deleting a link revokes exactly one thing.

export type HealthMetric = 'steps' | 'distance_km' | 'active_minutes' | 'workout_minutes'

export interface HealthLink {
  id: string
  habitId: string
  metric: HealthMetric
  token: string
  createdAt: string
  lastSeenAt?: string | null
}

export const METRIC_LABEL: Record<HealthMetric, string> = {
  steps:            'Steps',
  distance_km:      'Walking + running distance (km)',
  active_minutes:   'Exercise minutes',
  workout_minutes:  'Workout minutes',
}

/** What the Shortcut should read, in Apple's own words, so the instructions
 *  can be followed without guessing. */
export const METRIC_SAMPLE: Record<HealthMetric, string> = {
  steps:           'Steps',
  distance_km:     'Walking + Running Distance',
  active_minutes:  'Exercise Minutes',
  workout_minutes: 'Workouts',
}

/** Habits this is worth offering on. Named after what people call them rather
 *  than after Apple's sample types — someone writes "10k steps", not
 *  "HKQuantityTypeIdentifierStepCount". */
const MOVEMENT = /\b(walk|walking|run|running|jog|jogging|steps?|10k|5k|hike|hiking|treadmill|cycle|cycling|bike|biking|swim|swimming|cardio|workout|gym|exercise|move|movement|distance|km|miles?)\b/i

export function isMovementHabit(name: string, unit?: string): boolean {
  return MOVEMENT.test(name) || (!!unit && MOVEMENT.test(unit))
}

/** The metric a habit most likely wants, from what it is called. */
export function suggestMetric(name: string, unit?: string): HealthMetric {
  const text = `${name} ${unit ?? ''}`.toLowerCase()
  if (/\b(km|kilometre|kilometer|miles?|distance)\b/.test(text)) return 'distance_km'
  if (/\b(minute|min|exercise|cardio)\b/.test(text)) return 'active_minutes'
  if (/\b(workout|gym|session)\b/.test(text)) return 'workout_minutes'
  return 'steps'
}

interface Row {
  id: string; habit_id: string; metric: string; token: string
  created_at: string; last_seen_at: string | null
}

const fromRow = (r: Row): HealthLink => ({
  id: r.id, habitId: r.habit_id, metric: r.metric as HealthMetric,
  token: r.token, createdAt: r.created_at, lastSeenAt: r.last_seen_at,
})

/** `null` when the table is not there yet — which is a different thing from
 *  "you have no links", and the screen says so rather than offering a button
 *  that cannot work. */
export async function loadHealthLinks(): Promise<HealthLink[] | null> {
  const { data, error } = await supabase
    .from('health_links')
    .select('id, habit_id, metric, token, created_at, last_seen_at')
    .order('created_at', { ascending: true })
  if (error) return null
  return (data as Row[]).map(fromRow)
}

export async function createHealthLink(habitId: string, metric: HealthMetric): Promise<HealthLink> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in.')
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').slice(0, 8)
  const { data, error } = await supabase
    .from('health_links')
    .insert({ user_id: user.id, habit_id: habitId, metric, token })
    .select('id, habit_id, metric, token, created_at, last_seen_at')
    .single()
  if (error) throw new Error(error.message)
  return fromRow(data as Row)
}

export async function deleteHealthLink(id: string): Promise<void> {
  const { error } = await supabase.from('health_links').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/** The address the Shortcut posts to. Empty when this build has no Supabase
 *  URL — a relative address is worse than none, because it looks right and the
 *  phone cannot possibly reach it. */
export function ingestUrl(token: string): string {
  const base = (import.meta.env.VITE_SUPABASE_URL as string ?? '').replace(/\/$/, '')
  if (!/^https?:\/\//.test(base)) return ''
  return `${base}/functions/v1/health-ingest?token=${token}`
}


// ─── Is it actually wired up? ────────────────────────────────────────────────
//
// Three things have to be true before a step count can arrive: the function is
// deployed, the token is known, and it points at a habit. Each fails
// differently, and "nothing has arrived" tells you none of it — so ask, without
// writing anything.

export type LinkCheck =
  | { ok: true; detail: string }
  | { ok: false; detail: string }

export async function checkHealthLink(token: string): Promise<LinkCheck> {
  const url = ingestUrl(token)
  if (!url) return { ok: false, detail: 'This build has no Supabase address, so there is nowhere for the phone to send to.' }
  let res: Response
  try {
    res = await fetch(`${url}&dry=1`, { method: 'POST' })
  } catch {
    return { ok: false, detail: 'Could not reach it at all — check your connection.' }
  }
  if (res.status === 404) {
    return { ok: false, detail: 'The health-ingest function is not deployed yet — deploy it and try again.' }
  }
  const body = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; metric?: string }
  if (res.ok && body.ok) return { ok: true, detail: 'Wired up — the phone can send to this.' }
  if (res.status === 403) return { ok: false, detail: 'This address is not recognised. Unlink and link again.' }
  if (res.status === 401) return { ok: false, detail: 'The address is missing its token — copy it again.' }
  return { ok: false, detail: body.error ?? `It answered ${res.status}.` }
}

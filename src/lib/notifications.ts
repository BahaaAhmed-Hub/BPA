// ─── What is waiting for you ─────────────────────────────────────────────────
// The bell was a picture of a bell. Settings → Notifications, meanwhile, is a
// matrix of seven things worth being told about and three channels to be told
// on — saved, synced, and read by nothing.
//
// Push is the channel this app can actually deliver: a list under the bell. So
// that is what this is. Each kind is switched on or off by the same matrix, the
// quiet hours set beside it decide whether the count is shown, and every item
// is derived from data already on the device — nothing is invented, and a kind
// nothing can be derived for says so rather than staying quietly empty.

import { useTaskStore } from '@/store/taskStore'
import { loadHabits, loadLogs } from '@/store/habitsStore'
import { loadWaiting, mailEverRead } from '@/lib/mailWaiting'
import { pendingDrafts } from '@/lib/mailBriefs'
import { lastRankChange } from '@/lib/rankWatch'
import { useBehavioralStore } from '@/store/behavioralStore'
import { RANK_META } from '@/lib/behavioralEngine'

export type NotifKind = 'decision' | 'needsyou' | 'draft' | 'conflict' | 'habit' | 'review' | 'rank'
export type NotifChannel = 'push' | 'mail' | 'digest'

export interface NotifSetting {
  id: NotifKind
  label: string
  sub: string
  push: boolean
  mail: boolean
  digest: boolean
}

export interface QuietHours { on: boolean; start: string; end: string }

export interface Notification {
  /** Stable across reloads — dismissing one has to stick. */
  id: string
  kind: NotifKind
  title: string
  detail: string
  /** ISO, for ordering and for "2h ago". */
  at: string
  /** Where clicking it goes. */
  go?: { module: string; id?: string; date?: string }
}

/** The seven things worth being told about. The matrix in Settings draws
 *  these; the bell reads the same list. */
export const DEFAULT_NOTIF_EVENTS: NotifSetting[] = [
  { id: 'decision', label: 'A decision has waited two days', sub: 'The nudge that keeps decisions from rotting', push: true,  mail: true,  digest: true  },
  { id: 'needsyou', label: 'Mail that needs you',            sub: 'Only threads the assistant marks NEEDS YOU',  push: true,  mail: false, digest: true  },
  { id: 'draft',    label: 'Draft ready to send',            sub: 'When a reply is written and waiting',         push: true,  mail: false, digest: true  },
  { id: 'conflict', label: 'Calendar conflict',              sub: 'Two events land on the same hour',            push: true,  mail: true,  digest: false },
  { id: 'habit',    label: 'Habit not logged',               sub: 'Nothing against it by the afternoon',         push: true,  mail: false, digest: false },
  { id: 'review',   label: 'Weekly review is due',           sub: 'Sunday evening, once',                        push: false, mail: true,  digest: true  },
  { id: 'rank',     label: 'Rank changed',                   sub: 'Behavioral OS moved you up or down',          push: true,  mail: false, digest: true  },
]

const EVENTS_KEY = 'professor-notif-events'
const QUIET_KEY  = 'professor-quiet-hours'
const SEEN_KEY   = 'professor-notif-seen'
export const NOTIF_EVENT = 'professor:notificationsChanged'

/** All seven are worked out from what the device holds. Three of them read a
 *  note left by something else — the last read of the mail, the drafts written
 *  for it, and the rank the Behavioral OS last evaluated — because mail and a
 *  rank are not in localStorage by themselves. A kind whose source has not run
 *  yet says what it is waiting on (`dormantKinds`) rather than staying quietly
 *  empty. */
export const DERIVABLE: NotifKind[] = ['decision', 'needsyou', 'draft', 'conflict', 'habit', 'review', 'rank']

export function loadNotifSettings(defaults: NotifSetting[] = DEFAULT_NOTIF_EVENTS): NotifSetting[] {
  try {
    const raw = localStorage.getItem(EVENTS_KEY)
    if (!raw) return defaults
    const saved = JSON.parse(raw) as NotifSetting[]
    // Defaults decide the set; what is saved decides the switches.
    return defaults.map(d => ({ ...d, ...(saved.find(s => s.id === d.id) ?? {}) }))
  } catch { return defaults }
}

export function loadQuietHours(): QuietHours {
  try {
    const raw = localStorage.getItem(QUIET_KEY)
    if (raw) return JSON.parse(raw) as QuietHours
  } catch { /* fall through */ }
  return { on: true, start: '22:30', end: '07:00' }
}

export function saveQuietHours(q: QuietHours): void {
  try { localStorage.setItem(QUIET_KEY, JSON.stringify(q)) } catch { /* quota */ }
  window.dispatchEvent(new Event(NOTIF_EVENT))
}

/** Quiet hours wrap midnight more often than not, so the comparison has to. */
export function inQuietHours(q: QuietHours = loadQuietHours(), now = new Date()): boolean {
  if (!q.on) return false
  const mins = now.getHours() * 60 + now.getMinutes()
  const [sh, sm] = q.start.split(':').map(Number)
  const [eh, em] = q.end.split(':').map(Number)
  const start = sh * 60 + sm, end = eh * 60 + em
  return start <= end ? mins >= start && mins < end : mins >= start || mins < end
}

// ─── Dismissal ───────────────────────────────────────────────────────────────

export function saveNotifSettings(events: NotifSetting[]): void {
  try { localStorage.setItem(EVENTS_KEY, JSON.stringify(events)) } catch { /* quota */ }
  window.dispatchEvent(new Event(NOTIF_EVENT))
}

export function loadSeen(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, number> } catch { return {} }
}

function writeSeen(map: Record<string, number>): void {
  // Anything a fortnight old cannot come back anyway; the map should not grow
  // for ever.
  const cutoff = Date.now() - 14 * 86400_000
  const kept = Object.fromEntries(Object.entries(map).filter(([, t]) => t > cutoff))
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(kept)) } catch { /* quota */ }
  window.dispatchEvent(new Event(NOTIF_EVENT))
}

export function markSeen(ids: string[]): void {
  const map = loadSeen()
  const now = Date.now()
  for (const id of ids) map[id] = now
  writeSeen(map)
}

// ─── Working them out ────────────────────────────────────────────────────────

function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface CachedEvent {
  id: string
  summary?: string
  start: { dateTime?: string; date?: string }
  end: { dateTime?: string; date?: string }
}

/** Today's events, out of the cache the calendar already keeps per week. */
function todaysCachedEvents(): CachedEvent[] {
  const today = dayKey()
  const out: CachedEvent[] = []
  const seen = new Set<string>()
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key?.startsWith('cal-intel-events-cache:')) continue
    try {
      const { events } = JSON.parse(localStorage.getItem(key) ?? '{}') as { events?: CachedEvent[] }
      for (const ev of events ?? []) {
        const start = ev.start?.dateTime ?? ev.start?.date
        if (!start || !start.startsWith(today) || seen.has(ev.id)) continue
        seen.add(ev.id)
        out.push(ev)
      }
    } catch { /* a cache entry that will not parse is not a notification */ }
  }
  return out
}

function overlaps(a: CachedEvent, b: CachedEvent): boolean {
  if (!a.start.dateTime || !b.start.dateTime || !a.end.dateTime || !b.end.dateTime) return false
  return new Date(a.start.dateTime) < new Date(b.end.dateTime)
      && new Date(b.start.dateTime) < new Date(a.end.dateTime)
}

const TWO_DAYS = 2 * 86400_000
const FOUR_HOURS = 4 * 3600_000

/** "2h", "3 days" — long enough to be a reason to open the mail. */
function howLong(ms: number): string {
  const hours = Math.floor(ms / 3600_000)
  if (hours < 24) return `waiting ${hours}h`
  const days = Math.floor(hours / 24)
  return `waiting ${days} day${days === 1 ? '' : 's'}`
}

export function collect(settings: NotifSetting[], now = new Date()): Notification[] {
  const on = (kind: NotifKind) => settings.find(s => s.id === kind)?.push !== false
  const out: Notification[] = []

  // A decision that has waited. A task nobody has placed on the board is a
  // decision not taken, and two days is the app's own threshold for saying so.
  if (on('decision')) {
    for (const t of useTaskStore.getState().tasks) {
      if (t.completed || t.status === 'done' || t.status === 'cancelled') continue
      if (t.quadrant) continue
      const made = t.createdAt ? new Date(t.createdAt).getTime() : 0
      if (!made || now.getTime() - made < TWO_DAYS) continue
      const days = Math.floor((now.getTime() - made) / 86400_000)
      out.push({
        id: `decision:${t.id}`, kind: 'decision',
        title: t.title?.trim() || 'An unplaced task',
        detail: `Still in the dump after ${days} day${days === 1 ? '' : 's'}`,
        at: new Date(made + TWO_DAYS).toISOString(),
        go: { module: 'tasks', id: t.id },
      })
    }
  }

  // Two things on the same hour, today.
  if (on('conflict')) {
    const evs = todaysCachedEvents()
    for (let i = 0; i < evs.length; i++) {
      for (let j = i + 1; j < evs.length; j++) {
        if (!overlaps(evs[i], evs[j])) continue
        const [a, b] = [evs[i], evs[j]]
        const when = new Date(a.start.dateTime!)
        out.push({
          id: `conflict:${dayKey(now)}:${[a.id, b.id].sort().join('~')}`, kind: 'conflict',
          title: `${a.summary ?? '(No title)'} runs into ${b.summary ?? '(No title)'}`,
          detail: when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + ' today',
          at: when.toISOString(),
          go: { module: 'calendar', id: a.id, date: dayKey(now) },
        })
      }
    }
  }

  // A habit with nothing against today. Not before the afternoon — a habit is
  // not late at nine in the morning.
  if (on('habit') && now.getHours() >= 12) {
    const logs = loadLogs()
    const today = dayKey(now)
    for (const h of loadHabits()) {
      if (h.archived || h.isActive === false || h.frequency !== 'daily') continue
      if ((logs[h.id] ?? []).includes(today)) continue
      out.push({
        id: `habit:${today}:${h.id}`, kind: 'habit',
        title: `${h.emoji ?? ''} ${h.name}`.trim(),
        detail: 'Not logged today',
        at: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).toISOString(),
        go: { module: 'habits', id: h.id },
      })
    }
  }

  // Sunday evening, once.
  if (on('review') && now.getDay() === 0 && now.getHours() >= 18) {
    out.push({
      id: `review:${dayKey(now)}`, kind: 'review',
      title: 'The weekly review is due',
      detail: 'Sunday evening — half an hour to close the week',
      at: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18).toISOString(),
      go: { module: 'review' },
    })
  }

  // Mail addressed to you that nobody has answered. The threshold is the same
  // four hours the automation waits before drafting: below that, a reply is
  // not late, it is just recent.
  if (on('needsyou')) {
    const note = loadWaiting()
    const drafted = new Set(pendingDrafts().map(d => d.threadId))
    for (const row of note?.rows ?? []) {
      if (!row.needsYou) continue
      const at = new Date(row.receivedAt).getTime()
      const waited = now.getTime() - at
      if (!at || waited < FOUR_HOURS) continue
      // One that already has an answer written is the other notification's
      // business; saying both about one thread is saying it twice.
      if (drafted.has(row.id)) continue
      out.push({
        id: `needsyou:${row.id}:${row.messageId}`, kind: 'needsyou',
        title: `${row.fromName || row.fromEmail} is waiting`,
        detail: `${row.subject || '(no subject)'} · ${howLong(waited)}`,
        at: new Date(at + FOUR_HOURS).toISOString(),
        go: { module: 'mail', id: row.id },
      })
    }
  }

  // A reply that is written and has not been sent. Sending forgets the brief,
  // so anything still here is one click from gone.
  if (on('draft')) {
    for (const d of pendingDrafts()) {
      out.push({
        id: `draft:${d.threadId}:${d.messageId}`, kind: 'draft',
        title: d.fromName ? `A reply to ${d.fromName} is written` : 'A reply is written',
        detail: `${d.subject || 'Not sent yet'} · nothing has been sent`,
        at: new Date(d.at).toISOString(),
        go: { module: 'mail', id: d.threadId },
      })
    }
  }

  // The rank moved. Only while Behavioral OS is on — see rankWatch.
  if (on('rank')) {
    const change = lastRankChange(now)
    if (change) {
      out.push({
        id: `rank:${change.at}:${change.to}`, kind: 'rank',
        title: `${change.up ? 'Up' : 'Down'} to ${RANK_META[change.to].label}`,
        detail: `From ${RANK_META[change.from].label} · ${change.score}/100 · ${RANK_META[change.to].philosophy}`,
        at: change.at,
        go: { module: 'behavioral' },
      })
    }
  }

  const seen = loadSeen()
  return out
    .filter(n => !seen[n.id])
    .sort((a, b) => b.at.localeCompare(a.at))
}

/**
 * A kind that is switched on and cannot say anything yet, with what it is
 * waiting on. Every kind is wired; some read a note that something else has to
 * leave first, and an empty bell for that reason is worth saying out loud —
 * it is the difference between a quiet day and a switch that does nothing.
 */
export function dormantKinds(settings: NotifSetting[]): { setting: NotifSetting; why: string }[] {
  const out: { setting: NotifSetting; why: string }[] = []
  const read = mailEverRead()
  for (const s of settings) {
    if (!s.push) continue
    if ((s.id === 'needsyou' || s.id === 'draft') && !read)
      out.push({ setting: s, why: 'once the mail has been read here' })
    if (s.id === 'rank' && !useBehavioralStore.getState().enabled)
      out.push({ setting: s, why: 'needs Behavioral OS switched on' })
  }
  return out
}

/** What a kind is waiting on, for the row in Settings. Null when it is live. */
export function dormantWhy(kind: NotifKind, settings: NotifSetting[]): string | null {
  return dormantKinds(settings).find(d => d.setting.id === kind)?.why ?? null
}

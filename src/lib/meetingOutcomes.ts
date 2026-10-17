// ─── What a meeting left behind, and the thread back to it ───────────────────
//
// "What came out of it?" files things in five modules — a task, an expense, a
// habit day, a book, a follow-up. Each of those records had nowhere to say
// *which meeting it came out of*, and giving each table a column for it would
// have been four migrations and a missed table away from a link that quietly
// does not exist.
//
// So the link is its own small list, and the records stay as they were. One
// entry says: this meeting → this record. From it both directions are a lookup:
// the meeting lists what it produced, and a record asks where it came from.
//
// **Two roles, because the same window does two different things.** `made` is
// a record this window created. `touched` is one that already existed and was
// ticked or edited here — an old task closed in the meeting is still part of
// what the meeting did, and the meeting should be able to say so.
//
// **A removal is a tombstone, not a delete.** The list is joined across
// devices (`prefSync`, key `cal-outcome-links`) and a join only ever adds: an
// entry absent on this device would come straight back from the other. So an
// undone link stays, marked `gone`, and the later of two `at`s wins.

export type OutcomeKind = 'task' | 'expense' | 'habit' | 'book' | 'event'

export interface OutcomeLink {
  eventId: string
  /** What the meeting was called then — kept so "From: Client lunch" still
   *  reads when the event has since been renamed or deleted. */
  eventTitle: string
  kind: OutcomeKind
  recordId: string
  role: 'made' | 'touched'
  /** ISO time of the last change to this entry; the later one wins a join. */
  at: string
  gone?: boolean
}

export const OUTCOME_KEY = 'cal-outcome-links'
const EVENT = 'professor:outcomeLinksUpdated'

const keyOf = (eventId: string, kind: OutcomeKind, recordId: string) => `${eventId}|${kind}|${recordId}`

export function loadOutcomeLinks(): Record<string, OutcomeLink> {
  try {
    const raw = localStorage.getItem(OUTCOME_KEY)
    return raw ? (JSON.parse(raw) as Record<string, OutcomeLink>) : {}
  } catch { return {} }
}

function save(map: Record<string, OutcomeLink>): void {
  try { localStorage.setItem(OUTCOME_KEY, JSON.stringify(map)) } catch { /* quota */ }
  window.dispatchEvent(new Event(EVENT))
}

/** Joins two copies of the list: per entry, the later `at` wins. Exported for
 *  `prefSync`, which must not drop a link the other device made. */
export function joinOutcomeLinks(a: Record<string, OutcomeLink>, b: Record<string, OutcomeLink>): Record<string, OutcomeLink> {
  const out: Record<string, OutcomeLink> = { ...b }
  for (const [k, v] of Object.entries(a)) {
    const other = out[k]
    if (!other || other.at <= v.at) out[k] = v
  }
  return out
}

/** Link a record to the meeting. Idempotent; a `made` entry is never downgraded
 *  to `touched` by a later tick, and a link that was undone comes back. */
export function addOutcomeLink(
  link: { eventId: string; eventTitle: string; kind: OutcomeKind; recordId: string; role: 'made' | 'touched' },
): void {
  const map = loadOutcomeLinks()
  const k = keyOf(link.eventId, link.kind, link.recordId)
  const prev = map[k]
  const role = prev && !prev.gone && prev.role === 'made' ? 'made' : link.role
  map[k] = { ...link, role, at: new Date().toISOString() }
  save(map)
}

/** Take the link back. The record's own undo is the caller's business. */
export function removeOutcomeLink(eventId: string, kind: OutcomeKind, recordId: string): void {
  const map = loadOutcomeLinks()
  const k = keyOf(eventId, kind, recordId)
  const prev = map[k]
  if (!prev || prev.gone) return
  map[k] = { ...prev, gone: true, at: new Date().toISOString() }
  save(map)
}

/** Everything this meeting produced, newest first. */
export function linksForEvent(eventId: string, kind?: OutcomeKind): OutcomeLink[] {
  return Object.values(loadOutcomeLinks())
    .filter(l => !l.gone && l.eventId === eventId && (!kind || l.kind === kind))
    .sort((a, b) => b.at.localeCompare(a.at))
}

/** Where a record came from: the meetings that linked it, newest first. */
export function linksForRecord(kind: OutcomeKind, recordId: string): OutcomeLink[] {
  return Object.values(loadOutcomeLinks())
    .filter(l => !l.gone && l.kind === kind && l.recordId === recordId)
    .sort((a, b) => b.at.localeCompare(a.at))
}

/** Re-render when the list changes, here or on another tab. */
export function subscribeOutcomeLinks(fn: () => void): () => void {
  const onStorage = (e: StorageEvent) => { if (e.key === OUTCOME_KEY) fn() }
  window.addEventListener(EVENT, fn)
  window.addEventListener('storage', onStorage)
  return () => { window.removeEventListener(EVENT, fn); window.removeEventListener('storage', onStorage) }
}

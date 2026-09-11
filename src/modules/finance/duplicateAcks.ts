import type { Transaction } from './types'

// ─── "I have looked at this one" ─────────────────────────────────────────────
//
// Duplicate detection points at pairs; it never decides. Some of those pairs
// are real — a second tank of petrol, a bill paid in two halves — and the list
// had no way to say so. The chip stayed at "10 to check" for ever, which is a
// count you learn to ignore, and a count you ignore is worse than no count.
//
// Acknowledging one takes it out of the list and out of the chip. It changes
// nothing about the entry: this is a note about *having looked*, kept on this
// browser beside the other finance preferences, not a field on the ledger.
//
// **The note is against the entry as it was when you looked at it.** An
// acknowledgement keyed on the id alone would outlive the thing it was about —
// change the amount, the payee or the account and it is a different entry that
// happens to carry the same id, and it should be checked again. So the key
// carries the fields that made it a duplicate in the first place, and editing
// any of them brings it back.

const KEY = 'finance-duplicate-acks'

/** What the acknowledgement is *about*. The same fields `duplicates.ts`
 *  fingerprints on, plus the date — two entries are a duplicate because of
 *  when they both are, so moving one is a change worth re-checking. */
export function ackKey(tx: Transaction): string {
  return [
    tx.id,
    tx.type,
    Math.abs(tx.amount).toFixed(2),
    tx.currency,
    tx.accountId ?? '',
    tx.categoryId ?? '',
    (tx.payee ?? '').trim().toLowerCase().replace(/\s+/g, ' '),
    tx.date,
  ].join('|')
}

export function loadAcks(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    return new Set(Array.isArray(raw) ? (raw as string[]) : [])
  } catch { return new Set() }
}

export const ACKS_EVENT = 'finance:duplicateAcksChanged'

function save(acks: Set<string>): void {
  try { localStorage.setItem(KEY, JSON.stringify([...acks])) } catch { /* private mode */ }
  window.dispatchEvent(new Event(ACKS_EVENT))
}

export function acknowledge(tx: Transaction): void {
  const acks = loadAcks()
  acks.add(ackKey(tx))
  save(acks)
}

export function unacknowledge(tx: Transaction): void {
  const acks = loadAcks()
  acks.delete(ackKey(tx))
  save(acks)
}

/** Everything that has been looked at and left alone. Cleared in one go from
 *  the list, since the only way back to a single one is to find it again. */
export function forgetAllAcks(): void {
  save(new Set())
}

export const isAcknowledged = (acks: Set<string>, tx: Transaction): boolean =>
  acks.has(ackKey(tx))

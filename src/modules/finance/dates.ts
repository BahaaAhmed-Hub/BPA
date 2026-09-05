// ─── A date is the day you are living in ─────────────────────────────────────
// new Date(…).toISOString().slice(0, 10) is the UTC day, not the local one.
// Anywhere ahead of UTC it names yesterday for the first hours of the morning,
// and a local midnight — which is what new Date(y, m, 0) is — converts back to
// the previous day outright. That is how the month range came to end on the
// 29th of September: the 30th, at midnight, is the 29th in UTC.

export function isoDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function todayISO(): string {
  return isoDate(new Date())
}

export function monthStartISO(d: Date = new Date()): string {
  return isoDate(new Date(d.getFullYear(), d.getMonth(), 1))
}

export function monthEndISO(d: Date = new Date()): string {
  return isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0))
}

/** Days added to a date, staying in local time. */
export function shiftDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return isoDate(new Date(y, m - 1, d + days))
}

// ─── The week, as a thing that gets closed ───────────────────────────────────
// Two facts the "Close the week" rule and the Weekly Review page share: whether
// the review was opened this week, and the insight written for it. Kept apart
// from the automation itself so the page does not pull the whole engine in.

function pad(n: number): string { return String(n).padStart(2, '0') }

export function todayLocal(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The Monday of the week `day` falls in, local. */
export function mondayOf(day = todayLocal()): string {
  const [y, m, d] = day.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const back = (dt.getDay() + 6) % 7
  dt.setDate(dt.getDate() - back)
  return todayLocal(dt)
}

const OPENED = (monday: string) => `professor-review-opened-${monday}`
const INSIGHT = (monday: string) => `professor-week-insight-${monday}`

export function markReviewOpened(monday = mondayOf()): void {
  try { localStorage.setItem(OPENED(monday), new Date().toISOString()) } catch { /* quota */ }
}

export function wasReviewOpened(monday = mondayOf()): boolean {
  try { return localStorage.getItem(OPENED(monday)) != null } catch { return false }
}

export interface WeekInsight { text: string; at: string }

export function saveWeekInsight(monday: string, text: string): void {
  try { localStorage.setItem(INSIGHT(monday), JSON.stringify({ text, at: new Date().toISOString() } satisfies WeekInsight)) } catch { /* quota */ }
}

export function loadWeekInsight(monday: string): WeekInsight | null {
  try {
    const raw = localStorage.getItem(INSIGHT(monday))
    return raw ? JSON.parse(raw) as WeekInsight : null
  } catch { return null }
}

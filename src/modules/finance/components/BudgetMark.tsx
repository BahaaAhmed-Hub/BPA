import { CalendarClock } from 'lucide-react'

/** This entry was written by a budget with a day on it, not typed. It is a
 *  plan until it is ticked paid — the dotted red border says that part; this
 *  says where it came from, so nobody hunts for the entry they do not remember
 *  making. */
export function BudgetMark({ on }: { on: boolean }) {
  if (!on) return null
  return (
    <span
      title="Written by its budget. Tick it paid when the money moves."
      style={{ display: 'inline-flex', flexShrink: 0, color: '#C08A2E' }}>
      <CalendarClock size={11} strokeWidth={2.2} />
    </span>
  )
}

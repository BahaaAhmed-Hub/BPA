import { useEffect, useState } from 'react'
import { CalendarCheck } from 'lucide-react'
import { linksForRecord, subscribeOutcomeLinks, type OutcomeKind } from '@/lib/meetingOutcomes'
import { useUIStore } from '@/store/uiStore'

// ─── Where a record came from ────────────────────────────────────────────────
//
// "What came out of it?" files tasks, expenses, habit days, books and quotes, and
// each of those records keeps a thread back to the meeting (`meetingOutcomes.ts`).
// This is the other end of that thread: the one line a record shows to say where
// it came from, and the way back to the meeting.
//
// **It draws nothing when there is nothing to say.** A task nobody made in a
// meeting has no chip, and no empty row either — which is why it takes its own
// placement style rather than being wrapped in a box by the caller.
//
// **The title is the one the meeting had then.** The ledger keeps it, so
// "From: Client lunch" still reads after the event was renamed or deleted; the
// click is best effort (the calendar opens the day and selects the event when it
// is still there).

const VERBS: Record<OutcomeKind, string> = {
  task: 'From', expense: 'From meeting', habit: 'Logged from', book: 'From', quote: 'Saved during', event: 'Made in',
}

export function MeetingBacklink({ kind, recordId, verb, style }: {
  kind: OutcomeKind
  recordId: string
  /** The words in front of the title, where the default does not read right. */
  verb?: string
  /** Placement only — a grid column, a margin. */
  style?: React.CSSProperties
}) {
  const focusOn = useUIStore(s => s.focusOn)
  const [, bump] = useState(0)
  useEffect(() => subscribeOutcomeLinks(() => bump(n => n + 1)), [])

  const links = linksForRecord(kind, recordId)
  if (links.length === 0) return null
  const shown = links.slice(0, 2)
  const more = links.length - shown.length

  return (
    <div data-meeting-backlink={kind} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', ...style }}>
      {shown.map(l => (
        <button
          key={l.eventId}
          onClick={() => focusOn({ module: 'calendar', id: l.eventId, ...(l.eventDate ? { date: l.eventDate } : {}) })}
          title={`Open this meeting${l.eventDate ? ` — ${l.eventDate}` : ''}`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%', cursor: 'pointer',
            height: 30, padding: '0 11px', borderRadius: 'var(--sb-r-pill)', fontFamily: 'inherit',
            fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: 'var(--sb-ink-2)',
            background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)',
          }}>
          <CalendarCheck size={13} aria-hidden style={{ flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {verb ?? VERBS[kind]}: {l.eventTitle || 'a meeting'}
          </span>
        </button>
      ))}
      {more > 0 && <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>+{more} more</span>}
    </div>
  )
}

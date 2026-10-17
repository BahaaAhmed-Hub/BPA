// ─── What a meeting produced, on the meeting ─────────────────────────────────
//
// The other end of the thread (`meetingOutcomes.ts`): every record "What came out
// of it?" filed has a line back to the meeting, and this is the meeting's list of
// them. It sits in the event panel, and it carries the way back into the window.
//
// **Counts, not amounts.** An expense's figure is money, and Finance sits behind a
// lock because a browser left open is read over your shoulder. The meeting is on
// the calendar, which is not behind that lock, so it says "1 expense" and nothing
// more: the amount is one click away in the place that asks who you are.
//
// **Drawn when there is something to say, or when the meeting is done.** An event
// nobody has marked done and nothing was filed from has no outcomes, and a card
// saying so on every event would be noise on the busiest screen in the app. A done
// one always carries it, so the window can be reopened after being closed.

import { useEffect, useState } from 'react'
import { useTaskStore } from '@/store/taskStore'
import { useHabitsStore } from '@/store/habitsStore'
import { useUIStore } from '@/store/uiStore'
import { linksForEvent, subscribeOutcomeLinks, type OutcomeKind } from '@/lib/meetingOutcomes'

const LABEL: React.CSSProperties = {
  fontSize: 'var(--sb-t-meta)', fontWeight: 700, letterSpacing: '0.10em', color: 'var(--sb-ink-3)', textTransform: 'uppercase',
}
const LINE: React.CSSProperties = {
  display: 'flex', alignItems: 'baseline', gap: 7, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-2)', lineHeight: 1.5,
  background: 'none', border: 'none', padding: 0, textAlign: 'left', fontFamily: 'inherit',
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function OutcomesCard({ eventId, done, onReopen }: {
  eventId: string
  /** Marked done in this app — such a meeting always carries the card. */
  done: boolean
  onReopen: () => void
}) {
  const [, bump] = useState(0)
  useEffect(() => subscribeOutcomeLinks(() => bump(n => n + 1)), [])
  const tasks = useTaskStore(s => s.tasks)
  const habits = useHabitsStore(s => s.habits)
  const focusOn = useUIStore(s => s.focusOn)

  const by = (k: OutcomeKind) => linksForEvent(eventId, k)
  const t = by('task'), x = by('expense'), h = by('habit'), b = by('book'), q = by('quote'), e = by('event')
  const total = t.length + x.length + h.length + b.length + q.length + e.length
  if (!done && total === 0) return null

  return (
    <span data-outcomes-card style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 6 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={LABEL}>Outcomes</span>
        {/* Beside the label, not at the far edge: the assistant's floating button
            is fixed to the bottom-right of the viewport and sits over whatever
            scrolls under it there. */}
        <button onClick={onReopen} style={{
          height: 30, padding: '0 12px', borderRadius: 'var(--sb-r-pill)', cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: 'var(--sb-ink-2)',
          background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)',
        }}>{total ? 'Reopen' : 'What came out of it?'}</button>
      </span>

      {total === 0 && <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>Nothing is filed from this meeting yet.</span>}

      {t.map(l => {
        const task = tasks.find(x => x.id === l.recordId)
        const finished = !!task && (task.completed || task.status === 'done')
        return (
          <button key={l.recordId} data-outcome-line="task" onClick={() => focusOn({ module: 'tasks', id: l.recordId })}
            style={{ ...LINE, cursor: 'pointer', color: finished ? 'var(--sb-ink-3)' : 'var(--sb-ink-2)', textDecoration: finished ? 'line-through' : 'none' }}>
            <span aria-hidden style={{ width: 5, height: 5, borderRadius: '50%', flexShrink: 0, alignSelf: 'center', background: finished ? 'var(--sb-ink-4)' : 'var(--sb-positive)' }} />
            {task?.title ?? 'A task'}
          </button>
        )
      })}
      {x.length > 0 && <span data-outcome-line="expense" style={LINE}>{plural(x.length, 'expense')} filed</span>}
      {h.length > 0 && (
        <span data-outcome-line="habit" style={LINE}>
          Habits: {h.map(l => habits.find(y => y.id === l.recordId)?.name ?? 'a habit').join(', ')}
        </span>
      )}
      {(b.length > 0 || q.length > 0) && (
        <span data-outcome-line="book" style={LINE}>
          {[b.length ? plural(b.length, 'book') : '', q.length ? plural(q.length, 'quote') : ''].filter(Boolean).join(' · ')}
        </span>
      )}
      {e.length > 0 && <span data-outcome-line="event" style={LINE}>{plural(e.length, 'event')} scheduled</span>}
    </span>
  )
}

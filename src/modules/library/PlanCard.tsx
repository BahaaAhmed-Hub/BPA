import { Target, Trash2 } from 'lucide-react'
import { Button, Card, Segmented } from '@/components/ui'
import { ICON } from '@/lib/type'
import { DateField, Eyebrow, NumField, Row } from './fields'
import { useLibraryStore } from './libraryStore'
import { niceDay, planSentence, planStatus, STATE_INK, STATE_LABEL, suggestedFinish } from './planStats'
import { fmtMinutes } from './readingStats'
import type { Book, PlanPer } from './types'

const PER: { value: PlanPer; label: string }[] = [{ value: 'day', label: 'a day' }, { value: 'week', label: 'a week' }]

/**
 * What you mean to do with this book, and whether you are doing it.
 *
 * **Pre-answered**: "Make a plan" opens already holding a finish date — where
 * your current pace lands, or a month out — so the work is editing, not filling.
 * Every control writes straight through (the calendar composer's contract); the
 * words that are numbers are held 700ms by `NumField`.
 *
 * The status line is derived from the session log (`planStatus`), never stored.
 * Clearing both the date and the time budget removes the plan: the table would
 * refuse a plan that says nothing.
 */
export function PlanCard({ book, disabled }: { book: Book; disabled?: boolean }) {
  const plan = useLibraryStore(s => s.plans.find(p => p.bookId === book.id))
  const sessions = useLibraryStore(s => s.sessions)
  const setPlan = useLibraryStore(s => s.setPlan)
  const deletePlan = useLibraryStore(s => s.deletePlan)

  if (disabled) {
    return (
      <Card style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Eyebrow>Plan</Eyebrow>
        <div role="status" style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-accent-deep)' }}>
          Plans need migration <code>20260031_library_plans.sql</code>.
        </div>
      </Card>
    )
  }

  if (!plan) {
    return (
      <Card style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Eyebrow>Plan</Eyebrow>
        <div style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>
          Pick a day to finish by and see what that asks of each day.
        </div>
        <div>
          <Button size="sm" variant="secondary" onClick={() => setPlan(book.id, { finishBy: suggestedFinish(book, sessions) })}>
            <Target size={ICON.sm} /> Make a plan
          </Button>
        </div>
      </Card>
    )
  }

  const st = planStatus(book, sessions, plan)
  return (
    <Card style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1 }}><Eyebrow>Plan</Eyebrow></div>
        <button type="button" onClick={() => deletePlan(book.id)} aria-label="Remove this plan" title="Remove this plan"
          style={{ all: 'unset', cursor: 'pointer', color: 'var(--sb-ink-3)', display: 'flex', padding: 4, marginTop: -8 }}>
          <Trash2 size={ICON.sm} />
        </button>
      </div>

      <Row>
        <DateField label="Finish by" value={plan.finishBy} onPush={finishBy => setPlan(book.id, { finishBy })} />
        <NumField label="Minutes" value={plan.minutes} placeholder="optional"
          onPush={v => setPlan(book.id, { minutes: v && v > 0 ? Math.min(1440, v) : undefined })} />
        <Segmented value={plan.per} onChange={per => setPlan(book.id, { per })} options={PER} />
      </Row>

      <div role="status" aria-label="Plan status" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: STATE_INK[st.state] }}>
          {STATE_LABEL[st.state]}{plan.finishBy && st.state !== 'done' ? ` · by ${niceDay(plan.finishBy)}` : ''}
          {st.daysLeft !== null && st.daysLeft > 0 && st.state !== 'done' ? ` · ${st.daysLeft} day${st.daysLeft === 1 ? '' : 's'} left` : ''}
        </div>
        <div style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-2)' }}>{planSentence(st)}</div>
        {st.needPerWeek !== null && st.state !== 'done' && st.state !== 'late' && (
          <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>That is about {st.needPerWeek} pages a week.</div>
        )}
        {st.minutes && (
          <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
            {st.minutes.left === 0
              ? `Time for this ${st.minutes.per === 'day' ? 'day' : 'week'} is met — ${fmtMinutes(st.minutes.done)} of ${fmtMinutes(st.minutes.target)}.`
              : `${fmtMinutes(st.minutes.done)} of ${fmtMinutes(st.minutes.target)} this ${st.minutes.per === 'day' ? 'day' : 'week'} · ${fmtMinutes(st.minutes.left)} to go.`}
          </div>
        )}
      </div>
    </Card>
  )
}

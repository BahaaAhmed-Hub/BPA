import { useEffect, useState } from 'react'
import { CalendarClock, Target, Trash2 } from 'lucide-react'
import { Button, Card, Segmented } from '@/components/ui'
import { ICON } from '@/lib/type'
import { createCalendarEvent, deleteCalendarEvent, updateCalendarEvent } from '@/lib/googleCalendar'
import { forgetDay } from '@/lib/slotConflicts'
import { DateField, Eyebrow, Field, NumField, Row } from './fields'
import { inputStyle } from './fieldStyle'
import { blocksSupported } from './libraryDb'
import { blockSig, buildBlock } from './planBlock'
import { useLibraryStore } from './libraryStore'
import { niceDay, planSentence, planStatus, STATE_INK, STATE_LABEL, suggestedFinish } from './planStats'
import { fmtMinutes } from './readingStats'
import type { Book, PlanPer, ReadingPlan } from './types'

const AT_KEY = 'library-block-at'
const lastAt = (): string => { try { return localStorage.getItem(AT_KEY) || '20:00' } catch { return '20:00' } }
/** Google answers a delete or patch of an event that is already gone with 404 or 410 — for a delete that is the goal met. */
const gone = (err?: string) => !!err && /^(404|410)\b/.test(err)

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
  const setPlanBlock = useLibraryStore(s => s.setPlanBlock)
  const deletePlan = useLibraryStore(s => s.deletePlan)
  const [at, setAt] = useState(() => plan?.blockAt ?? lastAt())
  const [supported, setSupported] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [blockErr, setBlockErr] = useState<string | null>(null)
  const hasPlan = !!plan
  useEffect(() => { if (hasPlan) void blocksSupported().then(setSupported) }, [hasPlan])

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

  /** Writes the block, or moves the one that exists. Nothing is remembered unless Google took it. */
  async function putOnCalendar(p: ReadingPlan) {
    setBlockErr(null)
    const built = buildBlock(book, p, at, Intl.DateTimeFormat().resolvedOptions().timeZone)
    if (!built.ok) { setBlockErr(built.error); return }
    setBusy(true)
    try {
      let res = p.blockEventId ? await updateCalendarEvent('primary', p.blockEventId, built.event) : await createCalendarEvent('primary', built.event)
      // Deleted in Google since: say so, and make a fresh one rather than failing on an id that no longer exists.
      if (p.blockEventId && gone(res.error)) res = await createCalendarEvent('primary', built.event)
      if (res.noAuth) { setBlockErr('Sign in to Google first — the calendar is not connected.'); return }
      if (res.error || !res.event) { setBlockErr(`Google said no — ${res.error ?? 'no event came back'}`); return }
      try { localStorage.setItem(AT_KEY, at) } catch { /* a remembered time is a convenience */ }
      forgetDay(built.first)
      setPlanBlock(book.id, { blockAt: at, blockEventId: res.event.id, blockSig: built.sig })
    } finally { setBusy(false) }
  }

  /** Takes the event off the calendar, then forgets it. A refusal keeps the id: it is the only handle. */
  async function takeOff(p: ReadingPlan, forget = true): Promise<boolean> {
    if (!p.blockEventId) return true
    setBlockErr(null); setBusy(true)
    try {
      const res = await deleteCalendarEvent('primary', p.blockEventId)
      if (res.noAuth) { setBlockErr('Sign in to Google first — the calendar is not connected.'); return false }
      if (!res.success && !gone(res.error)) { setBlockErr(`Google said no — ${res.error ?? 'it was not removed'}. The block is still on your calendar.`); return false }
      // When the plan is about to go, writing the cleared block first would race the delete: the upsert can land second and bring the row back.
      if (forget) setPlanBlock(book.id, { blockAt: undefined, blockEventId: undefined, blockSig: undefined })
      return true
    } finally { setBusy(false) }
  }

  async function removePlan() {
    // The block goes first: a plan removed while its event stays leaves an event nothing can find.
    if (plan && !(await takeOff(plan, false))) return
    deletePlan(book.id)
  }

  const onCalendar = !!plan.blockEventId
  const stale = onCalendar && plan.blockSig !== blockSig(book, plan, at)
  return (
    <Card style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1 }}><Eyebrow>Plan</Eyebrow></div>
        <button type="button" disabled={busy} onClick={() => void removePlan()} aria-label="Remove this plan" title="Remove this plan"
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

      {plan.minutes && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 10, borderTop: 'var(--sb-border-width) solid var(--sb-hairline)' }}>
          <Row>
            <Field label="Time of day" grow={0}>
              <input type="time" value={at} onChange={e => setAt(e.target.value)} aria-label="Time of day for the calendar block" style={{ ...inputStyle, minWidth: 96 }} />
            </Field>
            {supported !== false && (
              <Button size="sm" variant="secondary" disabled={busy || !at || (onCalendar && !stale)} onClick={() => void putOnCalendar(plan)}>
                <CalendarClock size={ICON.sm} /> {onCalendar ? 'Update the block' : 'Block this time'}
              </Button>
            )}
            {onCalendar && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void takeOff(plan)}>Take it off</Button>
            )}
          </Row>
          {supported === false ? (
            <div role="status" style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-accent-deep)' }}>
              Putting this on the calendar needs migration <code>20260032_library_plan_blocks.sql</code>.
            </div>
          ) : (
            <div role="status" aria-label="Calendar block" style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
              {onCalendar
                ? stale
                  ? 'The block on your calendar no longer matches this plan.'
                  : `On your calendar: ${plan.per === 'day' ? 'every day' : 'every week'} at ${plan.blockAt}, ${fmtMinutes(plan.minutes)}${plan.finishBy ? `, until ${niceDay(plan.finishBy)}` : ', for the next four weeks'}.`
                : `One repeating ${fmtMinutes(plan.minutes)} block ${plan.per === 'day' ? 'every day' : 'every week'}${plan.finishBy ? ` until ${niceDay(plan.finishBy)}` : ' for four weeks'}, on your main calendar.`}
            </div>
          )}
          {blockErr && <div role="alert" style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-negative)' }}>{blockErr}</div>}
        </div>
      )}
    </Card>
  )
}

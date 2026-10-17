// ─── Habits, from the meeting ────────────────────────────────────────────────
//
// A meeting is often the thing a habit is about — networking, a client call, a
// walk-and-talk — and a habit counted in the moment is counted; one remembered
// at ten at night is guessed. This box logs against the meeting's own day
// without leaving the window.
//
// Four rules, all the Habits module's own:
//
// **`commitHabitLogs` is the only write path.** Every screen that records a tap
// has to go through it, or the next load pulls the server's copy straight back
// over the tap: "it reset on refresh". A day is written as a tick *or* a
// quantity, a measured habit is ticked when its goal is met, and every write
// goes out debounced from what localStorage holds *then*.
//
// **A day is a share of itself, not a count.** The summary leads with the
// share (`dayTotals`) and the tally supports it; 1,000 ml of 2,000 beside one
// ticked habit is 58% of the day, not "1 of 3".
//
// **A habit has no meeting on it, so none is invented.** Nothing in a habit says
// "this is about meetings", and guessing from its name would be a rule nobody
// agreed to. What is true: every active habit applies to the day, and the ones
// you have logged from a meeting before are the ones most likely wanted — so
// they come first and say so.
//
// **Putting it back is the same gesture.** A change made here is remembered as
// it was; Undo (or flipping the control back) restores it and takes the link
// the change made, so the meeting never claims a tick that no longer exists.

import { useEffect, useMemo, useState } from 'react'
import { Flame, Plus, Link as LinkIcon, Check } from 'lucide-react'
import {
  useHabitsStore, loadLogs, loadQuantityLogs, commitHabitLogs, getHabitColors, calcStreak,
  type Habit,
} from '@/store/habitsStore'
import { dayProgress, dayTotals } from '@/lib/habitProgress'
import { stepFor } from '@/lib/habitSteps'
import { moduleIsOff } from '@/lib/entitlements'
import { ICON } from '@/lib/type'
import {
  addOutcomeLink, removeOutcomeLink, loadOutcomeLinks, linksForEvent, subscribeOutcomeLinks,
} from '@/lib/meetingOutcomes'
import { OutcomeBox, EYEBROW, FIELD, chip, ymd, fromYmd, type OutcomeEvent } from './shared'

const TINT = 'var(--sb-warning)'
/** The Habits page reads its logs once on mount and listens for this. */
const LOGS_UPDATED = 'professor:habitLogsUpdated'

const dayLabel = (d: string) => fromYmd(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const FREQS = ['daily', 'weekdays', 'weekly'] as const

interface Before { done: boolean; qty: number }

function HabitRow({ habit, day, done, qty, linkedHere, usual, changed, madeHere, onToggle, onStep, onUndo, onUndoMade }: {
  habit: Habit
  day: string
  done: boolean
  qty: number
  linkedHere: boolean
  /** Logged from some other meeting before — the reason it is near the top. */
  usual: boolean
  changed: boolean
  madeHere: boolean
  onToggle: () => void
  onStep: (delta: number) => void
  onUndo: () => void
  onUndoMade: () => void
}) {
  const measured = habit.type === 'quantity' && !!habit.goal && habit.goal > 0
  const step = measured ? stepFor(habit) : 0
  const pct = measured ? Math.min(100, Math.round((qty / habit.goal!) * 100)) : done ? 100 : 0
  const streak = !measured || done ? calcStreak(loadLogs()[habit.id] ?? []) : 0

  return (
    <div
      data-outcome-habit={habit.id}
      data-done={done ? '1' : '0'}
      style={{
        borderRadius: 'var(--sb-r-nav)', padding: '0 12px', minHeight: 56, display: 'flex', alignItems: 'center', gap: 10,
        background: done ? 'color-mix(in srgb, var(--sb-warning) 10%, var(--sb-card))' : 'var(--sb-card)',
        border: 'var(--sb-border-width) solid var(--sb-border)',
      }}>
      <button
        onClick={onToggle}
        role="checkbox"
        aria-checked={done}
        aria-label={`${done ? 'Unmark' : 'Mark done for'} ${habit.name} on ${dayLabel(day)}`}
        style={{
          width: 26, height: 26, borderRadius: '50%', flexShrink: 0, padding: 0, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--sb-card)',
          background: done ? 'var(--sb-ink-1)' : 'transparent',
          border: done ? 'none' : '2px solid var(--sb-ink-3)',
        }}>
        {done && <Check size={14} strokeWidth={3} />}
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--sb-t-body)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span aria-hidden style={{ marginRight: 6 }}>{habit.emoji}</span>{habit.name}
        </div>
        {measured ? (
          <div style={{ height: 6, borderRadius: 999, background: 'var(--sb-hairline, var(--sb-border))', marginTop: 6, overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--sb-ink-1)' }} />
          </div>
        ) : (
          <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
            {done ? 'Logged' : 'Not logged'} for {dayLabel(day)}{streak > 0 ? ` · streak ${streak}` : ''}
          </div>
        )}
      </div>

      {measured && (
        <>
          <span data-habit-qty style={{ fontSize: 'var(--sb-t-body-s)', fontWeight: 600, minWidth: 96, textAlign: 'right' }}>
            {qty.toLocaleString()} / {habit.goal!.toLocaleString()}{habit.unit ? ` ${habit.unit}` : ''}
          </span>
          <button onClick={() => onStep(-step)} aria-label={`Remove ${step} ${habit.unit ?? ''} from ${habit.name}`}
            style={{ ...chip(), width: 36, padding: 0, justifyContent: 'center', fontSize: 18 }}>−</button>
          <button onClick={() => onStep(step)} aria-label={`Add ${step} ${habit.unit ?? ''} to ${habit.name}`} style={chip()}>
            + {step.toLocaleString()}
          </button>
        </>
      )}

      {usual && !linkedHere && (
        <span title="You have logged this from a meeting before" style={{
          fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-3)', background: 'var(--sb-field)',
          borderRadius: 'var(--sb-r-pill)', padding: '3px 9px', whiteSpace: 'nowrap',
        }}>from meetings</span>
      )}
      {linkedHere && (
        <span title="Linked to this meeting" style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 'var(--sb-t-micro)', fontWeight: 600,
          color: 'var(--sb-ink-1)', background: 'var(--sb-field)', borderRadius: 'var(--sb-r-pill)', padding: '3px 9px', whiteSpace: 'nowrap',
        }}><LinkIcon size={12} />this meeting</span>
      )}
      {changed && !madeHere && <button onClick={onUndo} style={chip()}>Undo</button>}
      {madeHere && <button onClick={onUndoMade} style={chip()}>Undo</button>}
    </div>
  )
}

function HabitsInner({ event, open, onToggle }: { event: OutcomeEvent; open: boolean; onToggle: () => void }) {
  const all = useHabitsStore(s => s.habits)
  const addHabit = useHabitsStore(s => s.addHabit)
  const deleteHabit = useHabitsStore(s => s.deleteHabit)
  const habits = useMemo(() => all.filter(h => h.isActive), [all])

  // The Habits page reads its logs once on mount and tells everyone through
  // this event when they change; so does this, and so do other devices.
  const [, bump] = useState(0)
  useEffect(() => {
    const h = () => bump(n => n + 1)
    window.addEventListener(LOGS_UPDATED, h)
    window.addEventListener('professor:prefsRestored', h)
    const off = subscribeOutcomeLinks(h)
    return () => { window.removeEventListener(LOGS_UPDATED, h); window.removeEventListener('professor:prefsRestored', h); off() }
  }, [])

  const day = event.date ?? ymd(new Date())
  const logs = loadLogs()
  const qtyLogs = loadQuantityLogs()

  const linked = linksForEvent(event.id, 'habit')
  const linkedIds = new Set(linked.map(l => l.recordId))
  // Habits ever logged from some *other* meeting: what you reach for here.
  const usualCount = useMemo(() => {
    const n = new Map<string, number>()
    for (const l of Object.values(loadOutcomeLinks())) {
      if (!l.gone && l.kind === 'habit' && l.eventId !== event.id) n.set(l.recordId, (n.get(l.recordId) ?? 0) + 1)
    }
    return n
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id, linked.length])

  /** What each habit was when this window first changed it. Session-only. */
  const [before, setBefore] = useState<Record<string, Before>>({})
  const [madeHere, setMadeHere] = useState<Set<string>>(new Set())
  const [showAll, setShowAll] = useState(false)

  const stateOf = (h: Habit): Before => ({
    done: (logs[h.id] ?? []).includes(day),
    qty: qtyLogs[h.id]?.[day] ?? 0,
  })

  // Order is fixed by what you have logged from meetings, then the habits' own
  // order — never by what was just ticked, so a row stays where it was.
  const ordered = useMemo(() => {
    const idx = new Map(habits.map((h, i) => [h.id, i]))
    return [...habits].sort((a, b) =>
      (usualCount.get(b.id) ?? 0) - (usualCount.get(a.id) ?? 0) || idx.get(a.id)! - idx.get(b.id)!)
  }, [habits, usualCount])
  const visible = showAll ? ordered : ordered.slice(0, 6)

  const link = (id: string, role: 'made' | 'touched') =>
    addOutcomeLink({ eventId: event.id, eventTitle: event.title, kind: 'habit', recordId: id, role })

  const notifyLogs = () => window.dispatchEvent(new Event(LOGS_UPDATED))

  function writeDone(h: Habit, done: boolean) {
    const cur = loadLogs()
    const has = (cur[h.id] ?? []).includes(day)
    if (done === has) return
    const days = cur[h.id] ?? []
    commitHabitLogs({ ...cur, [h.id]: done ? [...days, day] : days.filter(x => x !== day) })
    notifyLogs()
  }

  /** Same rule as the Habits page: the quantity is written, and the tick
   *  follows whether the goal is met. */
  function writeQty(h: Habit, value: number) {
    const q = loadQuantityLogs()
    commitHabitLogs(undefined, { ...q, [h.id]: { ...(q[h.id] ?? {}), [day]: value } })
    writeDone(h, h.goal ? value >= h.goal : value > 0)
    notifyLogs()
  }

  /** After any change: remember what it was, and keep the link exactly as true
   *  as the change — present while it differs from before, gone when it does not. */
  function settle(h: Habit, was: Before, now: Before) {
    const first = before[h.id] ?? was
    const same = first.done === now.done && first.qty === now.qty
    if (same) {
      setBefore(p => { const n = { ...p }; delete n[h.id]; return n })
      const l = linked.find(x => x.recordId === h.id)
      if (l?.role === 'touched') removeOutcomeLink(event.id, 'habit', h.id)
    } else {
      setBefore(p => ({ ...p, [h.id]: first }))
      if (!linkedIds.has(h.id)) link(h.id, 'touched')
    }
  }

  function toggle(h: Habit) {
    const was = stateOf(h)
    if (h.type === 'quantity' && h.goal) writeQty(h, was.done ? 0 : h.goal)
    else writeDone(h, !was.done)
    const nowLogs = loadLogs(); const nowQty = loadQuantityLogs()
    settle(h, was, { done: (nowLogs[h.id] ?? []).includes(day), qty: nowQty[h.id]?.[day] ?? 0 })
  }

  function step(h: Habit, delta: number) {
    const was = stateOf(h)
    writeQty(h, Math.max(0, was.qty + delta))
    const nowLogs = loadLogs(); const nowQty = loadQuantityLogs()
    settle(h, was, { done: (nowLogs[h.id] ?? []).includes(day), qty: nowQty[h.id]?.[day] ?? 0 })
  }

  function undo(h: Habit) {
    const b = before[h.id]
    if (!b) return
    if (h.type === 'quantity' && h.goal) writeQty(h, b.qty)
    else writeDone(h, b.done)
    setBefore(p => { const n = { ...p }; delete n[h.id]; return n })
    const l = linked.find(x => x.recordId === h.id)
    if (l?.role === 'touched') removeOutcomeLink(event.id, 'habit', h.id)
  }

  // ── A new habit, made here ──
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [measured, setMeasured] = useState(false)
  const [goal, setGoal] = useState('')
  const [unit, setUnit] = useState('')
  const [freq, setFreq] = useState<Habit['frequency']>('daily')
  const [countDay, setCountDay] = useState(true)

  function create() {
    const n = name.trim()
    const g = Number(goal)
    if (!n || (measured && !(g > 0))) return
    const colors = getHabitColors()
    const id = addHabit({
      name: n, emoji: '🎯', color: colors[habits.length % colors.length]!, frequency: freq, isActive: true,
      type: measured ? 'quantity' : 'boolean',
      ...(measured ? { goal: g, ...(unit.trim() ? { unit: unit.trim() } : {}) } : {}),
    })
    link(id, 'made')
    setMadeHere(prev => new Set(prev).add(id))
    if (countDay && !measured) {
      const cur = loadLogs()
      commitHabitLogs({ ...cur, [id]: [...(cur[id] ?? []), day] })
      notifyLogs()
    }
    setName(''); setGoal(''); setUnit(''); setMeasured(false); setCreating(false)
  }

  function undoMade(h: Habit) {
    // As the Habits page deletes one: the habit, then its days.
    deleteHabit(h.id)
    const l = loadLogs(); delete l[h.id]; commitHabitLogs(l)
    const q = loadQuantityLogs(); delete q[h.id]; commitHabitLogs(undefined, q)
    notifyLogs()
    removeOutcomeLink(event.id, 'habit', h.id)
    setMadeHere(prev => { const n = new Set(prev); n.delete(h.id); return n })
  }

  const totals = dayTotals(habits, day, logs, qtyLogs)
  const changedCount = linked.length
  const summary = habits.length === 0
    ? 'No habits yet'
    : [`${totals.pct}% of ${dayLabel(day)}`, changedCount ? `${changedCount} logged here` : ''].filter(Boolean).join(' · ')

  return (
    <OutcomeBox id="habits" icon={<Flame size={ICON.lg} />} title="Habits" summary={summary} open={open} onToggle={onToggle} tint={TINT}>
      {habits.length > 0 && (
        <p style={EYEBROW}>Your habits for {dayLabel(day)}</p>
      )}
      {visible.map(h => {
        const s = stateOf(h)
        return (
          <HabitRow
            key={h.id} habit={h} day={day}
            done={dayProgress(h, day, logs, qtyLogs) >= 1} qty={s.qty}
            linkedHere={linkedIds.has(h.id)} usual={(usualCount.get(h.id) ?? 0) > 0}
            changed={!!before[h.id]} madeHere={madeHere.has(h.id)}
            onToggle={() => toggle(h)} onStep={d => step(h, d)}
            onUndo={() => undo(h)} onUndoMade={() => undoMade(h)} />
        )
      })}
      {ordered.length > 6 && (
        <button onClick={() => setShowAll(v => !v)} style={{ ...chip(false, true), alignSelf: 'flex-start' }}>
          {showAll ? 'Show fewer' : `Show ${ordered.length - 6} more`}
        </button>
      )}
      {habits.length === 0 && !creating && (
        <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>
          You have no active habits. Make one from this meeting below.
        </p>
      )}

      {!creating ? (
        <button onClick={() => setCreating(true)} style={{
          height: 46, borderRadius: 'var(--sb-r-nav)', cursor: 'pointer', fontFamily: 'inherit',
          border: 'var(--sb-border-width) dashed var(--sb-border)', background: 'transparent',
          color: 'var(--sb-ink-2)', fontSize: 'var(--sb-t-body-s)', fontWeight: 600,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}><Plus size={ICON.md} /> New habit from this meeting</button>
      ) : (
        <form
          onSubmit={e => { e.preventDefault(); create() }}
          style={{
            display: 'flex', flexDirection: 'column', gap: 10, padding: 12,
            background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-nav)',
          }}>
          <input aria-label="Habit name" autoFocus value={name} onChange={e => setName(e.target.value)}
            placeholder="Name it — Networking, Walk and talk…"
            style={{ ...FIELD, height: 46, background: 'var(--sb-card)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" aria-pressed={!measured} onClick={() => setMeasured(false)} style={chip(!measured)}>Done or not</button>
            <button type="button" aria-pressed={measured} onClick={() => setMeasured(true)} style={chip(measured)}>Measured</button>
            {measured && (
              <>
                <input aria-label="Daily goal" inputMode="numeric" value={goal} onChange={e => setGoal(e.target.value.replace(/[^\d.]/g, ''))}
                  placeholder="Goal" style={{ ...FIELD, height: 36, width: 90, borderRadius: 'var(--sb-r-pill)' }} />
                <input aria-label="Unit" value={unit} onChange={e => setUnit(e.target.value)}
                  placeholder="Unit — steps, min…" style={{ ...FIELD, height: 36, width: 140, borderRadius: 'var(--sb-r-pill)' }} />
              </>
            )}
            <span style={{ width: 1, height: 22, background: 'var(--sb-border)', margin: '0 6px' }} />
            {FREQS.map(f => (
              <button type="button" key={f} aria-pressed={freq === f} onClick={() => setFreq(f)} style={chip(freq === f)}>
                {f[0]!.toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {!measured && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-2)' }}>
                <input type="checkbox" checked={countDay} onChange={e => setCountDay(e.target.checked)} />
                Count {dayLabel(day)} as done
              </label>
            )}
            <span style={{ flex: 1 }} />
            <button type="button" onClick={() => setCreating(false)} style={chip()}>Cancel</button>
            <button type="submit" disabled={!name.trim() || (measured && !(Number(goal) > 0))} style={{
              height: 40, padding: '0 18px', borderRadius: 'var(--sb-r-sm)', border: 'none', fontFamily: 'inherit',
              fontSize: 'var(--sb-t-body-s)', fontWeight: 700, cursor: 'pointer',
              background: 'var(--sb-ink-1)', color: 'var(--sb-card)',
              opacity: name.trim() && (!measured || Number(goal) > 0) ? 1 : 0.45,
            }}>Create habit</button>
          </div>
        </form>
      )}
    </OutcomeBox>
  )
}

export function HabitsBox(props: { event: OutcomeEvent; open: boolean; onToggle: () => void }) {
  // A module that is off is not drawn, and was never loaded.
  if (moduleIsOff('habits')) return null
  return <HabitsInner {...props} />
}

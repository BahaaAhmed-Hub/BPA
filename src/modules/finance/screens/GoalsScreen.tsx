import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { GripVertical, Plus, Trash2, Check } from 'lucide-react'
import { useFinanceStore } from '../financeStore'
import type { Goal } from '../types'
import { MoneyInput } from '../components/MoneyInput'
import { acct, group } from '../format'
import { todayISO } from '../dates'
import { ICON, STROKE } from '@/lib/type'
import {
  capacityFrom, planGoals, scheduleGoals, byRank, monthsUntil, debtGoals, isDebtGoal,
  DEFAULT_BUFFER_MONTHS, WINDOW_MONTHS,
  type Policy, type GoalPlan, type Schedule,
} from '../goalPlan'
import { Segmented } from '@/components/ui'
import { CategoryGlyph } from '../components/CategoryGlyph'

// ─── 21 · Goals ───────────────────────────────────────────────────────────────
// A target and a date are a wish. What makes a plan is knowing what is spare,
// what a normal month leaves over, and what order things get funded in — all of
// which the ledger already knows. See goalPlan.ts for the arithmetic; this
// screen's job is to show its working, because a number nobody can check is
// worth about as much as the wish was.
//
// A card with a balance is here too, as a goal with a target of zero (see
// `debtGoals`). It is ranked and funded like any other; what it cannot be is
// edited or deleted here — the balance is the ledger's, and it is paid down or
// settled from Balances.

const C = {
  bg:      'var(--sb-page)',
  surface: 'var(--sb-card)',
  field:   'var(--sb-field)',
  border:  'var(--sb-border)',
  hair:    'var(--sb-hairline)',
  ink1:    'var(--sb-ink-1)',
  ink2:    'var(--sb-ink-2)',
  ink3:    'var(--sb-ink-3)',
  ink4:    'var(--sb-ink-4)',
  accent:  'var(--sb-accent)',
  accentBg:'var(--sb-accent-tint2)',
  accentBr:'var(--sb-accent-border)',
  green:   'var(--sb-positive)',
  red:     'var(--sb-negative)',
}

const DISPLAY = 'var(--sb-font-num)'
const BUFFER_KEY = 'finance-goal-buffer-months'
const POLICY_KEY = 'finance-goal-policy'
const DEBT_RANKS_KEY = 'finance-debt-goal-ranks'

const EYEBROW: React.CSSProperties = {
  fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '.12em',
  color: C.ink3, textTransform: 'uppercase',
}

const FIELD: React.CSSProperties = {
  height: 38, boxSizing: 'border-box', padding: '0 12px', width: '100%',
  borderRadius: 'var(--sb-r-nav)', background: C.field, border: `var(--sb-border-width) solid ${C.border}`,
  fontSize: 'var(--sb-t-label)', color: C.ink1, outline: 'none', fontFamily: 'inherit',
}

/** 'YYYY-MM' n months from now — for "starts in 11 months" read as a month. */
function monthsOn(n: number | null, from = new Date()): string | null {
  if (n === null || n <= 0) return null
  const d = new Date(from.getFullYear(), from.getMonth() + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(key: string | null): string {
  if (!key) return 'never at this rate'
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}

/** A figure with its label under it — the shape every summary tile uses. */
function Stat({ label, value, tone, sub }: {
  label: string; value: string; tone?: string; sub?: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span style={EYEBROW}>{label}</span>
      <span style={{
        fontFamily: DISPLAY, fontSize: 'var(--sb-t-h2)', fontWeight: 700, letterSpacing: '-.02em',
        color: tone ?? C.ink1, fontVariantNumeric: 'tabular-nums',
      }}>{value}</span>
      {sub && <span style={{ fontSize: 'var(--sb-t-micro)', color: C.ink4 }}>{sub}</span>}
    </div>
  )
}

// ─── One goal in the ranked list ─────────────────────────────────────────────

function GoalRow({ plan, place, selected, lifted, over, onSelect, onGrab, regRow, currency, startMonth }: {
  plan: GoalPlan
  /** 'YYYY-MM' the money first reaches it, for a goal still in the queue. */
  startMonth: string | null
  place: number
  selected: boolean
  lifted: boolean
  over: boolean
  onSelect: () => void
  onGrab: (e: React.PointerEvent) => void
  regRow: (el: HTMLDivElement | null) => void
  currency: string
}) {
  const g = plan.goal
  const pct = g.targetAmount > 0
    ? Math.min(100, Math.round((g.currentAmount / g.targetAmount) * 100)) : 0
  // A goal that spare cash already covers is not "September", it is now —
  // there is nothing to wait for.
  // Nothing reaching it is the same story whether or not it has a deadline,
  // so that reading comes first — "never at this rate" and "nothing reaching
  // it" side by side for two goals in the same position reads as a bug.
  const verdict = plan.remaining <= 0 ? 'done'
    : plan.lump >= plan.remaining ? 'now'
    : plan.eta === null ? 'stalled'
    : plan.onTime === false ? 'late'
    : 'ok'
  // A goal queued behind another is not stalled: it starts the month the one
  // above it lands, and saying which month is the whole job of this screen.
  const queued = verdict === 'ok' && plan.monthly <= 0 && plan.startsIn !== null && plan.startsIn > 0
  const tone = verdict === 'done' || verdict === 'now' ? C.green
    : verdict === 'late' || verdict === 'stalled' ? C.red : C.ink3

  return (
    <div
      ref={regRow}
      onClick={onSelect}
      style={{
        display: 'flex', flexDirection: 'column', gap: 8, cursor: 'pointer',
        padding: '11px 12px', borderRadius: 'var(--sb-r-nav)', boxSizing: 'border-box',
        background: over ? 'var(--sb-accent-tint)' : selected ? C.accentBg : C.surface,
        border: `var(--sb-border-width) solid ${over ? C.accent : selected ? C.accentBr : C.hair}`,
        opacity: lifted ? 0.4 : 1,
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
        <span style={{
          width: 20, height: 20, borderRadius: 'var(--sb-r-chip)', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: C.ink1, color: 'var(--sb-ink-on-dark)', fontSize: 'var(--sb-t-micro)', fontWeight: 700,
        }}>{place}</span>
        {/* An account's picture arrives here as its icon — a data URL, which
            printed as text is a line of base64 where the name should be. */}
        <span style={{ display: 'inline-flex', flexShrink: 0 }}><CategoryGlyph icon={g.icon} size={18} /></span>
        <span style={{
          fontSize: 'var(--sb-t-label)', fontWeight: 600, color: C.ink1, minWidth: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{g.name}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 'var(--sb-t-meta)', color: tone, fontWeight: 600, flexShrink: 0 }}>
          {verdict === 'done' ? 'Reached'
            : verdict === 'now' ? 'Fundable now'
            : verdict === 'stalled' ? 'Nothing reaching it'
            : monthLabel(plan.eta)}
        </span>
        <span
          onPointerDown={onGrab}
          onClick={e => e.stopPropagation()}
          title="Drag to change its rank"
          style={{
            display: 'inline-flex', flexShrink: 0, padding: '2px 0', marginLeft: 2,
            color: lifted ? C.ink1 : 'var(--sb-border)', touchAction: 'none',
            cursor: lifted ? 'grabbing' : 'grab',
          }}>
          <GripVertical size={ICON.sm} strokeWidth={STROKE.rest} />
        </span>
      </div>

      <div style={{ height: 5, borderRadius: 'var(--sb-r-pill)', background: 'var(--sb-hairline)', overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`, height: '100%', borderRadius: 'var(--sb-r-pill)',
          background: verdict === 'done' ? C.green : C.accent,
        }} />
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 'var(--sb-t-meta)', color: C.ink3 }}>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {group(g.currentAmount)} of {group(g.targetAmount)} {g.currency ?? currency}
        </span>
        <span style={{ flex: 1 }} />
        {plan.monthly > 0 ? (
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            +{group(Math.round(plan.monthly))}/mo
          </span>
        ) : queued ? (
          <span>starts {monthLabel(startMonth)}</span>
        ) : null}
      </div>
    </div>
  )
}

// ─── Screen ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function GoalsScreen(_props?: any) {
  const { goals, accounts, transactions, upsertGoal, removeGoal } = useFinanceStore()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [bufferMonths, setBufferMonths] = useState(() => {
    try { return Number(localStorage.getItem(BUFFER_KEY) ?? DEFAULT_BUFFER_MONTHS) } catch { return DEFAULT_BUFFER_MONTHS }
  })
  const [policy, setPolicy] = useState<Policy>(() => {
    try { return (localStorage.getItem(POLICY_KEY) as Policy) === 'share' ? 'share' : 'ladder' } catch { return 'ladder' }
  })
  function pickPolicy(p: Policy) {
    setPolicy(p)
    try { localStorage.setItem(POLICY_KEY, p) } catch { /* private mode */ }
  }
  function pickBuffer(n: number) {
    setBufferMonths(n)
    try { localStorage.setItem(BUFFER_KEY, String(n)) } catch { /* private mode */ }
  }
  // Where each card-to-clear was dragged to. Real goals keep their rank on the
  // server; a debt goal is made from an account and has no row of its own.
  const [debtRanks, setDebtRanks] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem(DEBT_RANKS_KEY) ?? '{}') as Record<string, number> } catch { return {} }
  })
  function setDebtRank(id: string, n: number) {
    setDebtRanks(prev => {
      const next = { ...prev, [id]: n }
      try { localStorage.setItem(DEBT_RANKS_KEY, JSON.stringify(next)) } catch { /* private mode */ }
      return next
    })
  }

  // New goal
  const [newName, setNewName]     = useState('')
  const [newTarget, setNewTarget] = useState(0)
  const [newBy, setNewBy]         = useState('')
  const [newIcon, setNewIcon]     = useState('🎯')
  // MoneyInput holds the text you typed, so that a half-typed "1,2" survives.
  // Setting the value back to 0 does not clear that — the field has to be a
  // new one, or the amount you just used stays in the form.
  const [formTick, setFormTick]   = useState(0)

  const capacity = useMemo(
    () => capacityFrom(accounts, transactions, bufferMonths, undefined, goals),
    [accounts, transactions, bufferMonths, goals])
  const allGoals = useMemo(
    () => [...goals, ...debtGoals(accounts, transactions, debtRanks)],
    [goals, accounts, transactions, debtRanks])
  const debts = allGoals.length - goals.length
  const plans = useMemo(
    () => planGoals(allGoals, capacity, policy),
    [allGoals, capacity, policy])
  // The same run of the plan the figures come from, kept so the screen can
  // show its working month by month rather than asserting a date.
  const schedule = useMemo(
    () => scheduleGoals(allGoals, capacity, policy),
    [allGoals, capacity, policy])

  const selected = plans.find(p => p.goal.id === selectedId) ?? plans[0] ?? null

  function addGoal() {
    if (!newName.trim() || newTarget <= 0) return
    const g: Goal = {
      id: crypto.randomUUID(),
      name: newName.trim(),
      icon: newIcon || '🎯',
      targetAmount: newTarget,
      currentAmount: 0,
      color: C.accent,
      sub: newBy ? `by ${newBy}` : 'no deadline',
      // A new goal joins the back of the queue. Nothing already planned for
      // gets pushed down by something typed in a hurry.
      rank: allGoals.length,
      deadline: newBy || undefined,
      currency: capacity.currency as Goal['currency'],
    }
    void upsertGoal(g)
    setSelectedId(g.id)
    setNewName(''); setNewTarget(0); setNewBy(''); setNewIcon('🎯')
    setFormTick(n => n + 1)
  }

  // ─── Ranking by drag ───────────────────────────────────────────────────────
  // Same as the Financials table: pointer events, because dragstart never
  // fires for a finger and this is a list you reorder on a tablet.
  const rowEls = useRef(new Map<string, HTMLDivElement>())
  const [drag, setDrag] = useState<{ id: string; over: string | null } | null>(null)
  const justDragged = useRef(false)

  const regRow = useCallback((id: string) => (el: HTMLDivElement | null) => {
    if (el) rowEls.current.set(id, el)
    else rowEls.current.delete(id)
  }, [])

  const grab = useCallback((id: string) => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDrag({ id, over: null })
  }, [])

  useEffect(() => {
    if (!drag) return
    const order = byRank(allGoals).map(g => g.id)

    const move = (e: PointerEvent) => {
      let over: string | null = null
      for (const id of order) {
        const el = rowEls.current.get(id)
        if (!el) continue
        const r = el.getBoundingClientRect()
        if (e.clientY >= r.top && e.clientY <= r.bottom) { over = id; break }
      }
      setDrag(d => (d && d.over !== over ? { ...d, over } : d))
    }
    const up = () => {
      const { id, over } = drag
      if (over && over !== id) {
        const from = order.indexOf(id)
        const to = order.indexOf(over)
        if (from >= 0 && to >= 0) {
          const next = order.slice()
          next.splice(to, 0, next.splice(from, 1)[0])
          // Positions, not whatever numbers were there: a list where nothing
          // has a rank still comes out in an order.
          next.forEach((gid, n) => {
            const g = allGoals.find(x => x.id === gid)
            if (!g || g.rank === n) return
            if (isDebtGoal(g)) setDebtRank(g.id, n)
            else void upsertGoal({ ...g, rank: n })
          })
        }
      }
      justDragged.current = true
      setTimeout(() => { justDragged.current = false }, 0)
      setDrag(null)
    }
    // A class rather than a style write: the document's inline style belongs
    // to lib/themes.ts, and this is a state ("something is being dragged")
    // rather than a value.
    document.body.classList.add('sb-dragging')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      document.body.classList.remove('sb-dragging')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [drag, allGoals, upsertGoal])

  const cur = capacity.currency
  const money = (n: number) => acct(n, { currency: cur })
  const canAdd = newName.trim().length > 0 && newTarget > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%', overflow: 'hidden', background: C.bg }}>

      {/* ── What there is to work with ── */}
      <div style={{ padding: '18px 26px 0' }}>
        <div style={{ ...EYEBROW, color: C.ink4 }}>Finance · Goals</div>
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 22, flexWrap: 'wrap',
          marginTop: 8, padding: '15px 18px', borderRadius: 'var(--sb-r-card)',
          background: C.surface, border: `var(--sb-border-width) solid ${C.border}`,
        }}>
          <Stat label="Spare now" value={money(capacity.free)}
            sub={[
              `${group(Math.round(capacity.held))} in cash`,
              capacity.buffer > 0 ? `less ${group(Math.round(capacity.buffer))} kept back` : null,
              capacity.earmarked > 0 ? `less ${group(Math.round(capacity.earmarked))} already saved into goals` : null,
              // Gold, a flat, an investment: wealth, but not what next month's
              // saving comes out of. Counting it made every goal "fundable
              // now" and left nothing to plan.
              capacity.assets > 0 ? `${group(Math.round(capacity.assets))} in assets, not counted` : null,
              capacity.owed > 0 ? `${group(Math.round(capacity.owed))} owed on cards, ranked below` : null,
            ].filter(Boolean).join(' · ')} />
          <Stat label="A normal month" value={money(capacity.surplus)}
            tone={capacity.surplus >= 0 ? C.green : C.red}
            sub={capacity.months > 0
              ? `${group(Math.round(capacity.monthlyIn))} in, ${group(Math.round(capacity.monthlyOut))} out · median of ${capacity.months} month${capacity.months === 1 ? '' : 's'}`
              : `no paid entries in the last ${WINDOW_MONTHS} months`} />
          {capacity.committed > 0 && (
            <Stat label="Already spoken for" value={money(-capacity.committed)} tone={C.red}
              sub="unpaid entries dated ahead" />
          )}

          <div style={{ flex: 1 }} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={EYEBROW}>How to divide it</span>
            <Segmented
              aria-label="How to divide it"
              value={policy}
              onChange={pickPolicy}
              options={[
                { value: 'ladder' as const, label: 'Ladder', title: 'Rank 1 is filled before rank 2 gets anything — things arrive one after another, each as early as it can' },
                { value: 'share'  as const, label: 'Share',  title: 'Every goal moves at once, weighted by rank — nothing arrives as early, nothing sits still' },
              ]}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={EYEBROW}>Keep back</span>
            <Segmented
              aria-label="Keep back"
              value={String(bufferMonths)}
              onChange={v => pickBuffer(Number(v))}
              options={[0, 1, 2, 3, 6].map(n => ({
                value: String(n),
                label: String(n),
                title: n === 0 ? 'Nothing held back' : `${n} month${n === 1 ? '' : 's'} of typical spending held back before any goal is funded`,
              }))}
            />
          </div>
        </div>
      </div>

      {/* ── The goals, and the one that is open ── */}
      <div style={{ flex: 1, display: 'flex', gap: 14, padding: '14px 26px 22px', overflow: 'hidden', minHeight: 0 }}>

        <div style={{
          width: 400, flexShrink: 0, background: C.surface, border: `var(--sb-border-width) solid ${C.border}`,
          borderRadius: 'var(--sb-r-card)', padding: '15px 16px', display: 'flex', flexDirection: 'column',
          gap: 10, overflowY: 'auto', boxSizing: 'border-box',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={EYEBROW}>In order</span>
            <span style={{ marginLeft: 'auto', fontSize: 'var(--sb-t-meta)', color: C.ink4 }}>
              {plans.length === 0 ? 'none yet'
                : `${goals.length} goal${goals.length === 1 ? '' : 's'}${debts ? ` · ${debts} card${debts === 1 ? '' : 's'} to clear` : ''} · drag to re-rank`}
            </span>
          </div>

          {plans.length === 0 && (
            <div style={{ padding: '18px 0', color: C.ink3, fontSize: 'var(--sb-t-body-s)', lineHeight: 1.55 }}>
              Nothing here yet. Add one below — a name and an amount is enough, and a
              date if it has to be there by one. A card that owes something will appear
              here on its own, as a goal to clear it.
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {plans.map((p, i) => (
              <GoalRow
                key={p.goal.id}
                plan={p}
                place={i + 1}
                currency={cur}
                startMonth={monthsOn(p.startsIn)}
                selected={selected?.goal.id === p.goal.id}
                lifted={drag?.id === p.goal.id}
                over={drag?.over === p.goal.id && drag?.id !== p.goal.id}
                onSelect={() => { if (!justDragged.current) setSelectedId(p.goal.id) }}
                onGrab={grab(p.goal.id)}
                regRow={regRow(p.goal.id)} />
            ))}
          </div>

          {/* Add one */}
          <div style={{
            marginTop: 'auto', paddingTop: 12, borderTop: `var(--sb-border-width) solid ${C.hair}`,
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            <span style={EYEBROW}>New goal</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={newIcon}
                onChange={e => setNewIcon(e.target.value.slice(0, 2))}
                title="An emoji for it"
                style={{ ...FIELD, width: 44, textAlign: 'center', padding: 0, flexShrink: 0 }} />
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && canAdd) addGoal() }}
                placeholder="What it is for"
                style={FIELD} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                <span style={{ ...EYEBROW, fontSize: 'var(--sb-t-micro)' }}>Target</span>
                <MoneyInput key={formTick} value={newTarget} min={0} onChange={setNewTarget}
                  placeholder="60,000"
                  style={{ ...FIELD, fontFamily: DISPLAY, fontWeight: 600 }} />
              </span>
              <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                <span style={{ ...EYEBROW, fontSize: 'var(--sb-t-micro)' }}>By (optional)</span>
                <input type="date" value={newBy} min={todayISO()}
                  onChange={e => setNewBy(e.target.value)}
                  style={{ ...FIELD, fontFamily: DISPLAY }} />
              </span>
            </div>
            <button
              onClick={addGoal}
              disabled={!canAdd}
              style={{
                height: 38, borderRadius: 'var(--sb-r-nav)', display: 'inline-flex', alignItems: 'center',
                justifyContent: 'center', gap: 7, cursor: canAdd ? 'pointer' : 'default',
                background: canAdd ? C.ink1 : 'var(--sb-field)',
                border: `var(--sb-border-width) solid ${canAdd ? C.ink1 : C.border}`,
                color: canAdd ? 'var(--sb-ink-on-dark)' : C.ink4,
                fontFamily: 'inherit', fontSize: 'var(--sb-t-label)', fontWeight: 600,
              }}>
              <Plus size={ICON.sm} /> Add goal
            </button>
          </div>
        </div>

        {/* ── What it would take ── */}
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
          {selected ? <GoalDetail
            plan={selected}
            place={plans.findIndex(p => p.goal.id === selected.goal.id) + 1}
            policy={policy}
            currency={cur}
            surplus={capacity.surplus}
            startMonth={monthsOn(selected.startsIn)}
            schedule={schedule}
            goals={allGoals}
            onChange={g => void upsertGoal(g)}
            onDelete={g => {
              if (!window.confirm(`Delete the goal "${g.name}"?`)) return
              void removeGoal(g.id)
              setSelectedId(null)
            }} /> : (
            <div style={{
              background: C.surface, border: `var(--sb-border-width) solid ${C.border}`, borderRadius: 'var(--sb-r-card)',
              padding: '28px 26px', color: C.ink3, fontSize: 'var(--sb-t-label)', lineHeight: 1.6, maxWidth: 620,
            }}>
              <div style={{ fontFamily: DISPLAY, fontSize: 'var(--sb-t-h2)', fontWeight: 700, color: C.ink1, letterSpacing: '-.02em', marginBottom: 8 }}>
                How this plans
              </div>
              Add a goal and this works out three things from the ledger you already keep:
              what is <b>spare now</b> (what the accounts hold, less what you said to keep
              back and anything unpaid but already due), what a <b>normal month</b> leaves
              over (the median of the last {WINDOW_MONTHS} months of money that actually
              moved — the median so one strange month does not reset the plan), and then it
              pours both down the <b>ranking</b>, a month at a time, until everything
              lands — so a goal queued behind another still gets a date rather than a
              shrug. Drag a goal up and everything behind it re-plans. A <b>card with a
              balance</b> is in the ranking too, as a goal to clear it — pay it down in
              Balances and the target shrinks.
            </div>
          )}
          {!selected && plans.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <SchedulePlan schedule={schedule} goals={allGoals} currency={cur} selectedId={null} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── The plan, month by month ────────────────────────────────────────────────
//
// The verdict sentence says *when*; this says *how*, which is the part nobody
// can check otherwise. Every row is a month, what goes into which goal that
// month, and the ones that land in it. It is the same run of the plan the
// figures above come from — not a second calculation that could disagree.

function SchedulePlan({ schedule, goals, currency, selectedId, months = 18 }: {
  schedule: Schedule
  goals: Goal[]
  currency: string
  selectedId: string | null
  months?: number
}) {
  const [all, setAll] = useState(false)
  const byId = new Map(goals.map(g => [g.id, g]))
  const rows = all ? schedule.rows : schedule.rows.slice(0, months)
  const hidden = schedule.rows.length - rows.length
  const money = (n: number) => acct(n, { currency })

  if (schedule.rows.length === 0) {
    return (
      <div style={{
        background: C.surface, border: `var(--sb-border-width) solid ${C.border}`, borderRadius: 'var(--sb-r-card)',
        padding: '18px 20px', color: C.ink3, fontSize: 'var(--sb-t-body-s)', lineHeight: 1.6,
      }}>
        <span style={EYEBROW}>The plan, month by month</span>
        <div style={{ marginTop: 8 }}>
          Nothing is going into these goals yet — there is no spare cash and a normal
          month leaves nothing over. The plan starts the month that changes.
        </div>
      </div>
    )
  }

  return (
    <div style={{
      background: C.surface, border: `var(--sb-border-width) solid ${C.border}`, borderRadius: 'var(--sb-r-card)',
      padding: '16px 18px 14px',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
        <span style={EYEBROW}>The plan, month by month</span>
        <span style={{ marginLeft: 'auto', fontSize: 'var(--sb-t-meta)', color: C.ink4 }}>
          {schedule.unfinished
            ? 'not everything lands inside ten years'
            : `everything lands by ${monthLabel(schedule.rows[schedule.rows.length - 1].month)}`}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {rows.map((r, i) => {
          const lands = r.shares.filter(x => x.lands)
          return (
            <div key={r.month} style={{
              display: 'flex', alignItems: 'flex-start', gap: 12, padding: '7px 8px',
              borderRadius: 'var(--sb-r-chip)',
              background: lands.length ? 'var(--sb-positive-tint)' : i % 2 ? C.field : 'transparent',
            }}>
              <span style={{
                width: 76, flexShrink: 0, fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: C.ink2,
                fontFamily: DISPLAY, fontVariantNumeric: 'tabular-nums',
              }}>{monthLabel(r.month)}</span>
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', gap: '3px 10px' }}>
                {r.shares.map(sh => {
                  const g = byId.get(sh.goalId)
                  const mine = sh.goalId === selectedId
                  return (
                    <span key={sh.goalId} style={{
                      fontSize: 'var(--sb-t-meta)', color: mine ? C.ink1 : C.ink3,
                      fontWeight: mine ? 600 : 400, whiteSpace: 'nowrap',
                    }}>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(Math.round(sh.amount))}</span>
                      {' → '}{g?.name ?? 'a goal'}
                      {sh.lands && <span style={{ color: C.green, fontWeight: 600 }}> ✓ there</span>}
                    </span>
                  )
                })}
              </span>
              {r.fromSpare > 0 && (
                <span style={{ fontSize: 'var(--sb-t-micro)', color: C.ink4, flexShrink: 0 }}>from what is spare</span>
              )}
            </div>
          )
        })}
      </div>

      {hidden > 0 && (
        <button onClick={() => setAll(true)} style={{
          marginTop: 8, background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          fontFamily: 'inherit', fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: C.accent,
        }}>
          Show the other {hidden} month{hidden === 1 ? '' : 's'}
        </button>
      )}
    </div>
  )
}

// ─── The open goal ────────────────────────────────────────────────────────────

function GoalDetail({ plan, place, policy, currency, surplus, startMonth, schedule, goals, onChange, onDelete }: {
  plan: GoalPlan
  place: number
  policy: Policy
  currency: string
  surplus: number
  /** 'YYYY-MM' the money first reaches it, when it is still in the queue. */
  startMonth: string | null
  schedule: Schedule
  goals: Goal[]
  onChange: (g: Goal) => void
  onDelete: (g: Goal) => void
}) {
  const g = plan.goal
  const debt = isDebtGoal(g)
  const money = (n: number) => acct(n, { currency: g.currency ?? currency })
  const [saved, setSaved] = useState(g.currentAmount)
  const [target, setTarget] = useState(g.targetAmount)
  useEffect(() => { setSaved(g.currentAmount); setTarget(g.targetAmount) }, [g.id, g.currentAmount, g.targetAmount])

  const done = plan.remaining <= 0
  const coveredNow = !done && plan.lump >= plan.remaining
  const shortfall = plan.required !== null ? plan.required - plan.monthly : 0
  // Nothing next month, but something later: it is behind another goal, not
  // abandoned. The old screen called this "nothing reaching it".
  const queued = !done && !coveredNow && plan.monthly <= 0 && !!startMonth && plan.eta !== null
  /** What this goal gets, month by month — its own rows out of the run. */
  const mine = schedule.rows
    .map(r => ({ month: r.month, share: r.shares.find(x => x.goalId === plan.goal.id) }))
    .filter(r => r.share)

  const card: React.CSSProperties = {
    background: C.surface, border: `var(--sb-border-width) solid ${C.border}`, borderRadius: 'var(--sb-r-card)',
    padding: '18px 20px', marginBottom: 12,
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            width: 22, height: 22, borderRadius: 'var(--sb-r-chip)', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: C.ink1, color: 'var(--sb-ink-on-dark)', fontSize: 'var(--sb-t-meta)', fontWeight: 700,
          }}>{place}</span>
          <span style={{ display: 'inline-flex', flexShrink: 0 }}><CategoryGlyph icon={g.icon} size={24} /></span>
          <span style={{ fontFamily: DISPLAY, fontSize: 'var(--sb-t-h2)', fontWeight: 700, letterSpacing: '-.03em', color: C.ink1 }}>
            {g.name}
          </span>
          <span style={{ flex: 1 }} />
          {debt ? (
            <span style={{ fontSize: 'var(--sb-t-meta)', color: C.ink4 }}>{g.sub}</span>
          ) : (
            <button
              onClick={() => onDelete(g)}
              title="Delete this goal"
              style={{
                width: 30, height: 30, borderRadius: 'var(--sb-r-pill)', padding: 0, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: C.surface, border: `var(--sb-border-width) solid ${C.border}`, color: C.ink4,
              }}><Trash2 size={ICON.sm} /></button>
          )}
        </div>

        <div style={{ display: 'flex', gap: 26, marginTop: 16, flexWrap: 'wrap' }}>
          <Stat label={debt ? 'Still owed' : 'Still to find'} value={money(plan.remaining)}
            tone={done ? C.green : C.ink1}
            sub={done ? (debt ? 'cleared' : 'reached') : debt ? 'the live balance, from the ledger' : `${group(g.currentAmount)} of ${group(g.targetAmount)} saved`} />
          <Stat label="From what is spare" value={money(plan.lump)}
            sub={plan.lump > 0 ? 'available today' : 'nothing spare reaches it'} />
          <Stat label="Each month"
            value={plan.monthly > 0 ? money(plan.monthly) : queued ? '—' : money(0)}
            tone={plan.monthly > 0 ? C.green : queued ? C.ink1 : C.red}
            sub={plan.monthly > 0
              ? (policy === 'ladder' ? 'down the ranking' : 'its share of the surplus')
              : queued ? `starts ${monthLabel(startMonth)}` : 'nothing is reaching it'} />
          <Stat label="Lands" value={done ? 'Reached' : coveredNow ? 'Now' : monthLabel(plan.eta)}
            tone={plan.onTime === false ? C.red : plan.onTime ? C.green : C.ink1}
            sub={g.deadline
              ? `wanted by ${monthLabel(g.deadline.slice(0, 7))}`
              : 'no deadline set'} />
        </div>
      </div>

      {/* The verdict, in a sentence */}
      <div style={{ ...card, background: done || coveredNow ? 'var(--sb-positive-tint)' : plan.onTime === false || plan.eta === null ? 'var(--sb-negative-tint)' : C.accentBg,
        border: `var(--sb-border-width) solid ${done || coveredNow ? 'var(--sb-positive-tint)' : plan.onTime === false || plan.eta === null ? 'var(--sb-negative-tint)' : C.accentBr}` }}>
        <div style={{ fontSize: 'var(--sb-t-body)', color: C.ink1, lineHeight: 1.6 }}>
          {done
            ? (debt ? 'This card is clear. Anything ranked below it now gets what it was taking.' : 'This one is there. Anything ranked below it now gets what it was taking.')
            : coveredNow
            ? `There is enough spare today to finish this outright — ${money(plan.remaining)} of the ${money(plan.lump + 0)} it can draw on. Nothing has to be waited for.`
            : queued
              ? `It waits its turn: ${monthLabel(startMonth)} is when the goals above it are done and the money starts coming here, and it is there by ${monthLabel(plan.eta)}. Drag it up the list to be paid first.`
            : plan.eta === null
              ? `Nothing is reaching this goal${surplus <= 0 ? ' — a normal month leaves nothing over at all, so no plan can be made from it' : ', and nothing will inside ten years'}.`
              : plan.onTime === false
                ? `At ${money(plan.monthly)} a month this lands in ${monthLabel(plan.eta)}, after the ${monthLabel(g.deadline!.slice(0, 7))} you wanted. It needs ${money(plan.required ?? 0)} a month to be on time — ${money(shortfall)} more than it is getting.`
                : g.deadline
                  ? `On track. ${money(plan.required ?? 0)} a month gets there by ${monthLabel(g.deadline.slice(0, 7))}, and it is getting ${money(plan.monthly)}.`
                  : `At ${money(plan.monthly)} a month this lands in ${monthLabel(plan.eta)}. Give it a date if it has to be sooner.`}
        </div>
      </div>

      {/* How it gets there — the one thing a target and a date cannot say. */}
      {!done && (
        <div style={card}>
          <span style={EYEBROW}>How it gets there</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginTop: 8, fontSize: 'var(--sb-t-body-s)', color: C.ink2 }}>
            {plan.lump > 0 && <span><b style={{ fontFamily: DISPLAY }}>{money(plan.lump)}</b> now, from what is spare</span>}
            {plan.lump > 0 && !coveredNow && <span style={{ color: C.ink4 }}>then</span>}
            {!coveredNow && (
              queued
                ? <span><b style={{ fontFamily: DISPLAY }}>{monthLabel(startMonth)}</b> — when the goals above it are done</span>
                : plan.monthly > 0
                  ? <span><b style={{ fontFamily: DISPLAY }}>{money(plan.monthly)}</b> a month</span>
                  : <span style={{ color: C.red }}>nothing, at this rate</span>
            )}
            {plan.eta && <span style={{ color: C.ink4 }}>→</span>}
            {plan.eta && (
              <span style={{ color: plan.onTime === false ? C.red : C.green, fontWeight: 600 }}>
                there in {monthLabel(plan.eta)}
              </span>
            )}
          </div>
          {mine.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
              {mine.slice(0, 14).map(r => (
                <span key={r.month} title={`${monthLabel(r.month)} · ${money(Math.round(r.share!.amount))}`}
                  style={{
                    fontSize: 'var(--sb-t-micro)', padding: '3px 8px', borderRadius: 'var(--sb-r-pill)',
                    fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                    background: r.share!.lands ? 'var(--sb-positive-tint)' : C.field,
                    color: r.share!.lands ? C.green : C.ink3,
                    border: `var(--sb-border-width) solid ${r.share!.lands ? 'var(--sb-positive-tint)' : C.hair}`,
                    fontWeight: r.share!.lands ? 600 : 400,
                  }}>
                  {monthLabel(r.month).replace(/ \d{4}$/, '')} {group(Math.round(r.share!.amount))}{r.share!.lands ? ' ✓' : ''}
                </span>
              ))}
              {mine.length > 14 && <span style={{ fontSize: 'var(--sb-t-micro)', color: C.ink4, alignSelf: 'center' }}>+{mine.length - 14} more months</span>}
            </div>
          )}
        </div>
      )}

      {/* What can be changed about it — for a card, nothing here: the balance
          is the ledger's, and it moves from Balances. */}
      {debt ? (
        <div style={card}>
          <span style={EYEBROW}>The card itself</span>
          <div style={{ fontSize: 'var(--sb-t-body-s)', color: C.ink3, lineHeight: 1.6, marginTop: 8 }}>
            This is {g.name.replace(/^Clear /, '')}'s balance as the ledger has it, {g.sub}. Every
            payment recorded against the card brings the target down; <b>Settle</b> on its row in
            Balances clears it in one transfer, and the goal goes with it. Drag it in the ranking
            to decide what it waits behind — by default a card comes first, because its interest
            outruns anything a goal below it would earn.
          </div>
        </div>
      ) : (
      <div style={card}>
        <span style={EYEBROW}>The goal itself</span>
        <div style={{ display: 'flex', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 150, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ ...EYEBROW, fontSize: 'var(--sb-t-micro)' }}>Target</span>
            <MoneyInput value={target} min={0} onChange={setTarget}
              style={{ ...FIELD, fontFamily: DISPLAY, fontWeight: 600 }} />
          </span>
          <span style={{ flex: 1, minWidth: 150, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ ...EYEBROW, fontSize: 'var(--sb-t-micro)' }}>Saved so far</span>
            <MoneyInput value={saved} min={0} onChange={setSaved}
              style={{ ...FIELD, fontFamily: DISPLAY, fontWeight: 600 }} />
          </span>
          <span style={{ flex: 1, minWidth: 150, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ ...EYEBROW, fontSize: 'var(--sb-t-micro)' }}>By</span>
            <input type="date" value={g.deadline ?? ''} min={todayISO()}
              onChange={e => onChange({ ...g, deadline: e.target.value || undefined, sub: e.target.value ? `by ${e.target.value}` : 'no deadline' })}
              style={{ ...FIELD, fontFamily: DISPLAY }} />
          </span>
          <span style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button
              onClick={() => onChange({ ...g, targetAmount: target, currentAmount: saved })}
              disabled={target === g.targetAmount && saved === g.currentAmount}
              style={{
                height: 38, paddingInline: 16, borderRadius: 'var(--sb-r-nav)', display: 'inline-flex',
                alignItems: 'center', gap: 7, fontFamily: 'inherit', fontSize: 'var(--sb-t-label)', fontWeight: 600,
                cursor: target === g.targetAmount && saved === g.currentAmount ? 'default' : 'pointer',
                background: target === g.targetAmount && saved === g.currentAmount ? 'var(--sb-field)' : C.ink1,
                border: `var(--sb-border-width) solid ${target === g.targetAmount && saved === g.currentAmount ? C.border : C.ink1}`,
                color: target === g.targetAmount && saved === g.currentAmount ? C.ink4 : 'var(--sb-ink-on-dark)',
              }}>
              <Check size={ICON.sm} /> Save
            </button>
          </span>
        </div>
        {g.deadline && !done && (
          <div style={{ fontSize: 'var(--sb-t-meta)', color: C.ink3, marginTop: 10 }}>
            {monthsUntil(g.deadline)} month{monthsUntil(g.deadline) === 1 ? '' : 's'} to go.
          </div>
        )}
      </div>
      )}

      <SchedulePlan schedule={schedule} goals={goals} currency={currency} selectedId={g.id} />
    </div>
  )
}

import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { GripVertical, Plus, Trash2, Check } from 'lucide-react'
import { useFinanceStore } from '../financeStore'
import type { Goal } from '../types'
import { MoneyInput } from '../components/MoneyInput'
import { acct, group } from '../format'
import { todayISO } from '../dates'
import {
  capacityFrom, planGoals, byRank, monthsUntil,
  DEFAULT_BUFFER_MONTHS, WINDOW_MONTHS,
  type Policy, type GoalPlan,
} from '../goalPlan'

// ─── 21 · Goals ───────────────────────────────────────────────────────────────
// A target and a date are a wish. What makes a plan is knowing what is spare,
// what a normal month leaves over, and what order things get funded in — all of
// which the ledger already knows. See goalPlan.ts for the arithmetic; this
// screen's job is to show its working, because a number nobody can check is
// worth about as much as the wish was.

const C = {
  bg:      '#F7F4EA',
  surface: '#FFFFFF',
  field:   '#FAF7EC',
  border:  '#E8E1CE',
  hair:    '#F0EBDC',
  ink1:    '#191712',
  ink2:    '#4A4438',
  ink3:    '#6C6553',
  ink4:    '#9B9180',
  accent:  '#F5D14E',
  accentBg:'#FDF6DE',
  accentBr:'#EFE1B4',
  green:   '#0C8140',
  red:     '#C62828',
}

const DISPLAY = 'Outfit, sans-serif'
const BUFFER_KEY = 'finance-goal-buffer-months'
const POLICY_KEY = 'finance-goal-policy'

const EYEBROW: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, letterSpacing: '.12em',
  color: C.ink3, textTransform: 'uppercase',
}

const FIELD: React.CSSProperties = {
  height: 38, boxSizing: 'border-box', padding: '0 12px', width: '100%',
  borderRadius: 10, background: C.field, border: `1px solid ${C.border}`,
  fontSize: 13, color: C.ink1, outline: 'none', fontFamily: 'inherit',
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
        fontFamily: DISPLAY, fontSize: 19, fontWeight: 700, letterSpacing: '-.02em',
        color: tone ?? C.ink1, fontVariantNumeric: 'tabular-nums',
      }}>{value}</span>
      {sub && <span style={{ fontSize: 10.5, color: C.ink4 }}>{sub}</span>}
    </div>
  )
}

// ─── One goal in the ranked list ─────────────────────────────────────────────

function GoalRow({ plan, place, selected, lifted, over, onSelect, onGrab, regRow, currency }: {
  plan: GoalPlan
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
  const tone = verdict === 'done' || verdict === 'now' ? C.green
    : verdict === 'late' || verdict === 'stalled' ? C.red : C.ink3

  return (
    <div
      ref={regRow}
      onClick={onSelect}
      style={{
        display: 'flex', flexDirection: 'column', gap: 8, cursor: 'pointer',
        padding: '11px 12px', borderRadius: 13, boxSizing: 'border-box',
        background: over ? '#FBF1D2' : selected ? C.accentBg : C.surface,
        border: `1px solid ${over ? C.accent : selected ? C.accentBr : C.hair}`,
        opacity: lifted ? 0.4 : 1,
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
        <span style={{
          width: 20, height: 20, borderRadius: 6, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: C.ink1, color: '#FDF8E7', fontSize: 10.5, fontWeight: 700,
        }}>{place}</span>
        <span style={{ fontSize: 15, flexShrink: 0 }}>{g.icon}</span>
        <span style={{
          fontSize: 13.5, fontWeight: 600, color: C.ink1, minWidth: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{g.name}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: tone, fontWeight: 600, flexShrink: 0 }}>
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
            color: lifted ? C.ink1 : '#CFC7B2', touchAction: 'none',
            cursor: lifted ? 'grabbing' : 'grab',
          }}>
          <GripVertical size={13} strokeWidth={2} />
        </span>
      </div>

      <div style={{ height: 5, borderRadius: 999, background: '#EFEADB', overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`, height: '100%', borderRadius: 999,
          background: verdict === 'done' ? C.green : C.accent,
        }} />
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 11, color: C.ink3 }}>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {group(g.currentAmount)} of {group(g.targetAmount)} {g.currency ?? currency}
        </span>
        <span style={{ flex: 1 }} />
        {plan.monthly > 0 && (
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            +{group(Math.round(plan.monthly))}/mo
          </span>
        )}
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
    () => capacityFrom(accounts, transactions, bufferMonths),
    [accounts, transactions, bufferMonths])
  const plans = useMemo(
    () => planGoals(goals, capacity, policy),
    [goals, capacity, policy])

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
      rank: goals.length,
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
    const order = byRank(goals).map(g => g.id)

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
            const g = goals.find(x => x.id === gid)
            if (!g || g.rank === n) return
            void upsertGoal({ ...g, rank: n })
          })
        }
      }
      justDragged.current = true
      setTimeout(() => { justDragged.current = false }, 0)
      setDrag(null)
    }
    const prevSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      document.body.style.userSelect = prevSelect
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [drag, goals, upsertGoal])

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
          marginTop: 8, padding: '15px 18px', borderRadius: 16,
          background: C.surface, border: `1px solid ${C.border}`,
        }}>
          <Stat label="Spare now" value={money(capacity.free)}
            sub={`${group(Math.round(capacity.held))} held, less ${group(Math.round(capacity.buffer))} kept back`} />
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
            <span style={{ display: 'inline-flex', background: '#F1ECDE', borderRadius: 10, padding: 3, gap: 3 }}>
              {([['ladder', 'Ladder'], ['share', 'Share']] as const).map(([id, label]) => (
                <button key={id} onClick={() => pickPolicy(id)}
                  title={id === 'ladder'
                    ? 'Rank 1 is filled before rank 2 gets anything — things arrive one after another, each as early as it can'
                    : 'Every goal moves at once, weighted by rank — nothing arrives as early, nothing sits still'}
                  style={{
                    padding: '0 14px', height: 32, borderRadius: 8, border: 'none', cursor: 'pointer',
                    fontFamily: 'inherit', fontSize: 12.5, fontWeight: policy === id ? 700 : 500,
                    background: policy === id ? C.ink1 : 'transparent',
                    color: policy === id ? '#FDF8E7' : C.ink3,
                  }}>{label}</button>
              ))}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={EYEBROW}>Keep back</span>
            <span style={{ display: 'inline-flex', background: '#F1ECDE', borderRadius: 10, padding: 3, gap: 3 }}>
              {[0, 1, 2, 3, 6].map(n => (
                <button key={n} onClick={() => pickBuffer(n)}
                  title={n === 0 ? 'Nothing held back' : `${n} month${n === 1 ? '' : 's'} of typical spending held back before any goal is funded`}
                  style={{
                    width: 32, height: 32, borderRadius: 8, border: 'none', cursor: 'pointer',
                    fontFamily: 'inherit', fontSize: 12.5, fontWeight: bufferMonths === n ? 700 : 500,
                    background: bufferMonths === n ? C.ink1 : 'transparent',
                    color: bufferMonths === n ? '#FDF8E7' : C.ink3,
                  }}>{n}</button>
              ))}
            </span>
          </div>
        </div>
      </div>

      {/* ── The goals, and the one that is open ── */}
      <div style={{ flex: 1, display: 'flex', gap: 14, padding: '14px 26px 22px', overflow: 'hidden', minHeight: 0 }}>

        <div style={{
          width: 400, flexShrink: 0, background: C.surface, border: `1px solid ${C.border}`,
          borderRadius: 18, padding: '15px 16px', display: 'flex', flexDirection: 'column',
          gap: 10, overflowY: 'auto', boxSizing: 'border-box',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={EYEBROW}>In order</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: C.ink4 }}>
              {goals.length === 0 ? 'none yet' : `${goals.length} goal${goals.length === 1 ? '' : 's'} · drag to re-rank`}
            </span>
          </div>

          {plans.length === 0 && (
            <div style={{ padding: '18px 0', color: C.ink3, fontSize: 12.5, lineHeight: 1.55 }}>
              Nothing here yet. Add one below — a name and an amount is enough, and a
              date if it has to be there by one.
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {plans.map((p, i) => (
              <GoalRow
                key={p.goal.id}
                plan={p}
                place={i + 1}
                currency={cur}
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
            marginTop: 'auto', paddingTop: 12, borderTop: `1px solid ${C.hair}`,
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
                <span style={{ ...EYEBROW, fontSize: 9.5 }}>Target</span>
                <MoneyInput key={formTick} value={newTarget} min={0} onChange={setNewTarget}
                  placeholder="60,000"
                  style={{ ...FIELD, fontFamily: DISPLAY, fontWeight: 600 }} />
              </span>
              <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                <span style={{ ...EYEBROW, fontSize: 9.5 }}>By (optional)</span>
                <input type="date" value={newBy} min={todayISO()}
                  onChange={e => setNewBy(e.target.value)}
                  style={{ ...FIELD, fontFamily: DISPLAY }} />
              </span>
            </div>
            <button
              onClick={addGoal}
              disabled={!canAdd}
              style={{
                height: 38, borderRadius: 10, display: 'inline-flex', alignItems: 'center',
                justifyContent: 'center', gap: 7, cursor: canAdd ? 'pointer' : 'default',
                background: canAdd ? C.ink1 : '#EDE7D9',
                border: `1px solid ${canAdd ? C.ink1 : C.border}`,
                color: canAdd ? '#FDF8E7' : C.ink4,
                fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
              }}>
              <Plus size={14} /> Add goal
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
            onChange={g => void upsertGoal(g)}
            onDelete={g => {
              if (!window.confirm(`Delete the goal "${g.name}"?`)) return
              void removeGoal(g.id)
              setSelectedId(null)
            }} /> : (
            <div style={{
              background: C.surface, border: `1px solid ${C.border}`, borderRadius: 18,
              padding: '28px 26px', color: C.ink3, fontSize: 13, lineHeight: 1.6, maxWidth: 620,
            }}>
              <div style={{ fontFamily: DISPLAY, fontSize: 20, fontWeight: 700, color: C.ink1, letterSpacing: '-.02em', marginBottom: 8 }}>
                How this plans
              </div>
              Add a goal and this works out three things from the ledger you already keep:
              what is <b>spare now</b> (what the accounts hold, less what you said to keep
              back and anything unpaid but already due), what a <b>normal month</b> leaves
              over (the median of the last {WINDOW_MONTHS} months of money that actually
              moved — the median so one strange month does not reset the plan), and then it
              pours both down the <b>ranking</b>. Drag a goal up and everything behind it
              re-plans.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── The open goal ────────────────────────────────────────────────────────────

function GoalDetail({ plan, place, policy, currency, surplus, onChange, onDelete }: {
  plan: GoalPlan
  place: number
  policy: Policy
  currency: string
  surplus: number
  onChange: (g: Goal) => void
  onDelete: (g: Goal) => void
}) {
  const g = plan.goal
  const money = (n: number) => acct(n, { currency: g.currency ?? currency })
  const [saved, setSaved] = useState(g.currentAmount)
  const [target, setTarget] = useState(g.targetAmount)
  useEffect(() => { setSaved(g.currentAmount); setTarget(g.targetAmount) }, [g.id, g.currentAmount, g.targetAmount])

  const done = plan.remaining <= 0
  const coveredNow = !done && plan.lump >= plan.remaining
  const shortfall = plan.required !== null ? plan.required - plan.monthly : 0

  const card: React.CSSProperties = {
    background: C.surface, border: `1px solid ${C.border}`, borderRadius: 18,
    padding: '18px 20px', marginBottom: 12,
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            width: 22, height: 22, borderRadius: 7, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: C.ink1, color: '#FDF8E7', fontSize: 11, fontWeight: 700,
          }}>{place}</span>
          <span style={{ fontSize: 20 }}>{g.icon}</span>
          <span style={{ fontFamily: DISPLAY, fontSize: 22, fontWeight: 700, letterSpacing: '-.03em', color: C.ink1 }}>
            {g.name}
          </span>
          <span style={{ flex: 1 }} />
          <button
            onClick={() => onDelete(g)}
            title="Delete this goal"
            style={{
              width: 30, height: 30, borderRadius: '50%', padding: 0, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: C.surface, border: `1px solid ${C.border}`, color: C.ink4,
            }}><Trash2 size={13} /></button>
        </div>

        <div style={{ display: 'flex', gap: 26, marginTop: 16, flexWrap: 'wrap' }}>
          <Stat label="Still to find" value={money(plan.remaining)}
            tone={done ? C.green : C.ink1}
            sub={done ? 'reached' : `${group(g.currentAmount)} of ${group(g.targetAmount)} saved`} />
          <Stat label="From what is spare" value={money(plan.lump)}
            sub={plan.lump > 0 ? 'available today' : 'nothing spare reaches it'} />
          <Stat label="Each month" value={money(plan.monthly)}
            tone={plan.monthly > 0 ? C.green : C.red}
            sub={policy === 'ladder' ? 'down the ranking' : 'its share of the surplus'} />
          <Stat label="Lands" value={done ? 'Reached' : coveredNow ? 'Now' : monthLabel(plan.eta)}
            tone={plan.onTime === false ? C.red : plan.onTime ? C.green : C.ink1}
            sub={g.deadline
              ? `wanted by ${monthLabel(g.deadline.slice(0, 7))}`
              : 'no deadline set'} />
        </div>
      </div>

      {/* The verdict, in a sentence */}
      <div style={{ ...card, background: done || coveredNow ? '#E9F3EC' : plan.onTime === false || plan.eta === null ? '#FBEAEA' : C.accentBg,
        border: `1px solid ${done || coveredNow ? '#BFDCC8' : plan.onTime === false || plan.eta === null ? '#EFCECE' : C.accentBr}` }}>
        <div style={{ fontSize: 13.5, color: C.ink1, lineHeight: 1.6 }}>
          {done
            ? 'This one is there. Anything ranked below it now gets what it was taking.'
            : coveredNow
            ? `There is enough spare today to finish this outright — ${money(plan.remaining)} of the ${money(plan.lump + 0)} it can draw on. Nothing has to be waited for.`
            : plan.eta === null
              ? policy === 'ladder'
                ? `Nothing is reaching this goal. ${surplus <= 0 ? 'A normal month leaves nothing over at all.' : 'Everything a month leaves over is going to the goals ranked above it — move it up, or give the ones above it a deadline so they stop taking more than they need.'}`
                : 'Nothing is reaching this goal — a normal month leaves nothing over.'
              : plan.onTime === false
                ? `At ${money(plan.monthly)} a month this lands in ${monthLabel(plan.eta)}, after the ${monthLabel(g.deadline!.slice(0, 7))} you wanted. It needs ${money(plan.required ?? 0)} a month to be on time — ${money(shortfall)} more than it is getting.`
                : g.deadline
                  ? `On track. ${money(plan.required ?? 0)} a month gets there by ${monthLabel(g.deadline.slice(0, 7))}, and it is getting ${money(plan.monthly)}.`
                  : `At ${money(plan.monthly)} a month this lands in ${monthLabel(plan.eta)}. Give it a date if it has to be sooner.`}
        </div>
      </div>

      {/* What can be changed about it */}
      <div style={card}>
        <span style={EYEBROW}>The goal itself</span>
        <div style={{ display: 'flex', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 150, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ ...EYEBROW, fontSize: 9.5 }}>Target</span>
            <MoneyInput value={target} min={0} onChange={setTarget}
              style={{ ...FIELD, fontFamily: DISPLAY, fontWeight: 600 }} />
          </span>
          <span style={{ flex: 1, minWidth: 150, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ ...EYEBROW, fontSize: 9.5 }}>Saved so far</span>
            <MoneyInput value={saved} min={0} onChange={setSaved}
              style={{ ...FIELD, fontFamily: DISPLAY, fontWeight: 600 }} />
          </span>
          <span style={{ flex: 1, minWidth: 150, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ ...EYEBROW, fontSize: 9.5 }}>By</span>
            <input type="date" value={g.deadline ?? ''} min={todayISO()}
              onChange={e => onChange({ ...g, deadline: e.target.value || undefined, sub: e.target.value ? `by ${e.target.value}` : 'no deadline' })}
              style={{ ...FIELD, fontFamily: DISPLAY }} />
          </span>
          <span style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button
              onClick={() => onChange({ ...g, targetAmount: target, currentAmount: saved })}
              disabled={target === g.targetAmount && saved === g.currentAmount}
              style={{
                height: 38, paddingInline: 16, borderRadius: 10, display: 'inline-flex',
                alignItems: 'center', gap: 7, fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
                cursor: target === g.targetAmount && saved === g.currentAmount ? 'default' : 'pointer',
                background: target === g.targetAmount && saved === g.currentAmount ? '#EDE7D9' : C.ink1,
                border: `1px solid ${target === g.targetAmount && saved === g.currentAmount ? C.border : C.ink1}`,
                color: target === g.targetAmount && saved === g.currentAmount ? C.ink4 : '#FDF8E7',
              }}>
              <Check size={14} /> Save
            </button>
          </span>
        </div>
        {g.deadline && !done && (
          <div style={{ fontSize: 11.5, color: C.ink3, marginTop: 10 }}>
            {monthsUntil(g.deadline)} month{monthsUntil(g.deadline) === 1 ? '' : 's'} to go.
          </div>
        )}
      </div>
    </div>
  )
}

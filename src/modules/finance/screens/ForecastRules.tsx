import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { MoneyInput } from '../components/MoneyInput'
import { acct } from '../format'
import { ICON } from '@/lib/type'
import type { Rule, RuleId, ForecastState, OwnRule } from '../forecast'

// ─── What the forecast assumes, and what you know that it cannot ─────────────
//
//  Every date on this screen rests on a handful of judgements about the future.
//  A single number with none of them shown is a number nobody can argue with,
//  which is worse than one nobody agrees with — so each is a row that says
//  **when it fires**, **what it read** and **what it did with it**, carries a
//  switch, and lets you type over the figure.
//
//  Both sections are folded away by default. The screen that opens is the one
//  that was there before; this is what you come to when a date looks wrong.

const CARD: React.CSSProperties = {
  background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
  borderRadius: 'var(--sb-r-card)', overflow: 'hidden',
}
const SUMMARY: React.CSSProperties = {
  cursor: 'pointer', listStyle: 'none', padding: '12px 16px',
  // Wrap rather than squeeze. Beside the open goal these cards are about
  // 300px, and a row of title-then-caption broke the title across three lines
  // to keep the caption on the same line as it.
  display: 'flex', alignItems: 'baseline', gap: '2px 10px', flexWrap: 'wrap',
  fontFamily: 'var(--sb-font-display)', fontSize: 'var(--sb-t-body)', fontWeight: 600,
  letterSpacing: '-0.02em', color: 'var(--sb-ink-1)',
}
const WHY: React.CSSProperties = {
  marginLeft: 'auto', flexBasis: '100%', fontFamily: 'system-ui', fontWeight: 400,
  fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', letterSpacing: 0,
  lineHeight: 1.45,
}
const INNER: React.CSSProperties = {
  padding: '14px 16px 16px', borderTop: 'var(--sb-border-width) solid var(--sb-hairline)',
}
const FIELD: React.CSSProperties = {
  height: 34, padding: '0 10px', borderRadius: 'var(--sb-r-nav)', background: 'var(--sb-field)',
  border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-1)',
  font: 'inherit', fontSize: 'var(--sb-t-meta)',
}
const EB: React.CSSProperties = {
  fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.12em',
  textTransform: 'uppercase', color: 'var(--sb-ink-4)',
}

const SOURCE: Record<Rule['source'], string> = {
  ledger: 'from your ledger',
  budget: 'from your budgets',
  setting: 'your setting',
  published: 'a published figure',
}

/** A 38px switch. Not a checkbox: the question is "is this being applied", and
 *  a rule you can see the effect of turning off is the whole reason these are
 *  on the screen at all. */
function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <span style={{ position: 'relative', flexShrink: 0, width: 38, height: 22, marginTop: 2 }}>
      <input type="checkbox" checked={on} aria-label={label}
        onChange={e => onChange(e.target.checked)}
        style={{ position: 'absolute', inset: 0, opacity: 0, margin: 0, cursor: 'pointer', width: '100%', height: '100%', zIndex: 2 }} />
      <span style={{
        position: 'absolute', inset: 0, borderRadius: 'var(--sb-r-pill)',
        background: on ? 'var(--sb-positive)' : 'var(--sb-border)', transition: 'background .15s',
      }}>
        <span style={{
          position: 'absolute', top: 2, left: 2, width: 18, height: 18, borderRadius: '50%',
          background: 'var(--sb-card)', boxShadow: '0 1px 2px rgba(0,0,0,.25)',
          transform: on ? 'translateX(16px)' : 'none', transition: 'transform .15s',
        }} />
      </span>
    </span>
  )
}

export function ForecastRulesCard({ rules, state, onChange, currency }: {
  rules: Rule[]
  state: ForecastState
  onChange: (next: ForecastState) => void
  currency: string
}) {
  const applied = rules.filter(r => r.on && !r.dormant).length
  const yours = rules.filter(r => r.yours).length
  const dormant = rules.filter(r => r.dormant).length

  function toggle(id: RuleId, on: boolean) {
    onChange({ ...state, off: on ? state.off.filter(x => x !== id) : [...new Set([...state.off, id])] })
  }
  function setValue(id: RuleId, v: number | null) {
    const values = { ...state.values }
    if (v === null) delete values[id]
    else values[id] = v
    onChange({ ...state, values })
  }

  return (
    <details style={CARD}>
      <summary style={SUMMARY}>
        <span style={{ color: 'var(--sb-ink-4)', fontSize: 12 }}>▸</span>
        What the forecast assumes
        <span style={WHY}>
          {applied} of {rules.length} applied
          {yours > 0 ? ` · ${yours} figure${yours === 1 ? '' : 's'} yours` : ''}
          {dormant > 0 ? ` · ${dormant} waiting on data` : ''}
        </span>
      </summary>
      <div style={INNER}>
        <p style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', margin: '0 0 12px', lineHeight: 1.55 }}>
          Each rule says <b>when it fires</b>, <b>what it read</b> and <b>what it did with it</b>. Type over a
          figure and the plan is rebuilt on yours, marked as yours. Nothing here is invented: a rule that cannot
          find its figure goes quiet and names what it is missing rather than guessing one.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rules.map(r => (
            <RuleRow key={r.id} rule={r} currency={currency}
              onToggle={v => toggle(r.id, v)}
              onValue={v => setValue(r.id, v)} />
          ))}
        </div>
      </div>
    </details>
  )
}

function RuleRow({ rule, currency, onToggle, onValue }: {
  rule: Rule
  currency: string
  onToggle: (v: boolean) => void
  onValue: (v: number | null) => void
}) {
  const [open, setOpen] = useState(false)
  const live = rule.on && !rule.dormant
  const isMoney = rule.unit.startsWith(currency)

  return (
    <div style={{
      background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)',
      borderRadius: 'var(--sb-r-nav)', padding: '13px 15px', opacity: live ? 1 : 0.62,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <Switch on={rule.on} onChange={onToggle} label={rule.title} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 'var(--sb-t-body-s)', fontWeight: 600, lineHeight: 1.35, color: 'var(--sb-ink-1)' }}>
            {rule.title}
          </div>
          <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.5 }}>
            {rule.when}
          </div>
        </div>
        <span style={{
          marginLeft: 'auto', fontSize: 'var(--sb-t-micro)', fontWeight: 600, whiteSpace: 'nowrap',
          padding: '2px 9px', borderRadius: 'var(--sb-r-pill)',
          background: rule.yours ? 'var(--sb-accent-tint)' : 'var(--sb-card)',
          border: 'var(--sb-border-width) solid var(--sb-border)',
          color: rule.yours ? 'var(--sb-accent-deep)' : 'var(--sb-ink-4)',
        }}>{rule.yours ? 'your figure' : SOURCE[rule.source]}</span>
      </div>

      {/* The figure it is using, and the way to disagree with it. A rule with
          nothing to read still takes one, because typing the figure in is
          exactly how you make it speak. */}
      {rule.dormant && (
        <div style={{
          marginTop: 10, paddingTop: 10, borderTop: 'var(--sb-border-width) solid var(--sb-hairline)',
          fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', lineHeight: 1.5,
        }}>
          Nothing to read yet — {rule.dormant}. It guesses nothing; give it a figure below and it is yours.
        </div>
      )}
      {(
        <div style={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 10,
          paddingTop: 10,
          borderTop: rule.dormant ? undefined : 'var(--sb-border-width) solid var(--sb-hairline)',
        }}>
          <label style={{ ...EB, fontSize: 'var(--sb-t-micro)' }}>It uses</label>
          {isMoney
            ? <MoneyInput value={rule.value ?? 0} min={0} onChange={v => onValue(v)}
                style={{ ...FIELD, width: 130, fontFamily: 'var(--sb-font-num)', fontWeight: 600 }} />
            : <input type="number" value={rule.value ?? 0} step={rule.id === 'buffer' ? 0.5 : 0.1} min={0}
                onChange={e => onValue(Number(e.target.value))}
                style={{ ...FIELD, width: 96, fontFamily: 'var(--sb-font-num)', fontWeight: 600 }} />}
          <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>{rule.unit}</span>
          {rule.yours && (
            <button onClick={() => onValue(null)}
              style={{
                height: 28, padding: '0 11px', borderRadius: 'var(--sb-r-nav)', cursor: 'pointer',
                background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
                color: 'var(--sb-ink-3)', fontFamily: 'inherit', fontSize: 'var(--sb-t-micro)', fontWeight: 600,
              }}>Put the read figure back</button>
          )}
          <button onClick={() => setOpen(o => !o)}
            style={{
              marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer', padding: 0,
              fontFamily: 'inherit', fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: 'var(--sb-info, var(--sb-ink-3))',
            }}>{open ? '⌄ hide the working' : 'ⓘ show the working'}</button>
        </div>
      )}

      {open && rule.why.length > 0 && (
        <div style={{
          marginTop: 9, padding: '11px 13px', background: 'var(--sb-card)',
          border: 'var(--sb-border-width) solid var(--sb-hairline)', borderRadius: 'var(--sb-r-chip)',
          fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-2)', lineHeight: 1.65,
        }}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {rule.why.map((line, i) => <li key={i} style={{ margin: '4px 0' }}>{line}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}

// ─── Your own rules ──────────────────────────────────────────────────────────
//
//  A raise, a car sold, a loan that starts in March. None of it is in the
//  ledger and none of it can be read out of one, so the honest thing is to ask
//  rather than to model it — and to keep what is asked plainly separate from
//  what was measured.

export function OwnRulesCard({ state, onChange, currency }: {
  state: ForecastState
  onChange: (next: ForecastState) => void
  currency: string
}) {
  const [what, setWhat] = useState('')
  const [kind, setKind] = useState<'income' | 'expense'>('income')
  const [amount, setAmount] = useState(0)
  const [when, setWhen] = useState<OwnRule['when']>('every')
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [tick, setTick] = useState(0)

  const canAdd = what.trim().length > 0 && amount > 0 && /^\d{4}-\d{2}$/.test(month)

  function add() {
    if (!canAdd) return
    const rule: OwnRule = {
      id: crypto.randomUUID(), what: what.trim(), kind, amount, when, month, on: true,
    }
    onChange({ ...state, own: [...state.own, rule] })
    setWhat(''); setAmount(0); setTick(n => n + 1)
  }
  function patch(id: string, next: Partial<OwnRule>) {
    onChange({ ...state, own: state.own.map(r => (r.id === id ? { ...r, ...next } : r)) })
  }
  function drop(id: string) {
    onChange({ ...state, own: state.own.filter(r => r.id !== id) })
  }

  const phrase = (r: OwnRule) =>
    r.when === 'every' ? `every month from ${r.month}`
      : r.when === 'once' ? `once, in ${r.month}`
      : `every year in ${r.month.slice(5)}`

  return (
    <details style={CARD}>
      <summary style={SUMMARY}>
        <span style={{ color: 'var(--sb-ink-4)', fontSize: 12 }}>▸</span>
        Your own rules
        <span style={WHY}>
          {state.own.length === 0
            ? 'A raise, a car sold, a loan starting — things the ledger cannot know'
            : `${state.own.filter(r => r.on).length} of ${state.own.length} applied`}
        </span>
      </summary>
      <div style={INNER}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 160px', minWidth: 0 }}>
            <span style={EB}>What</span>
            <input value={what} onChange={e => setWhat(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && canAdd) add() }}
              placeholder="A raise" style={{ ...FIELD, width: '100%' }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={EB}>Kind</span>
            <select value={kind} onChange={e => setKind(e.target.value as 'income' | 'expense')} style={FIELD}>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={EB}>Amount</span>
            <MoneyInput key={tick} value={amount} min={0} onChange={setAmount}
              placeholder="8,000"
              style={{ ...FIELD, width: 120, fontFamily: 'var(--sb-font-num)', fontWeight: 600 }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={EB}>When</span>
            <select value={when} onChange={e => setWhen(e.target.value as OwnRule['when'])} style={FIELD}>
              <option value="every">Every month from…</option>
              <option value="once">Once, in…</option>
              <option value="year">Every year in…</option>
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={EB}>Month</span>
            <input type="month" value={month} onChange={e => setMonth(e.target.value)}
              style={{ ...FIELD, width: 150, fontFamily: 'var(--sb-font-num)' }} />
          </label>
          <button onClick={add} disabled={!canAdd}
            style={{
              height: 34, padding: '0 14px', borderRadius: 'var(--sb-r-nav)', display: 'inline-flex',
              alignItems: 'center', gap: 6, cursor: canAdd ? 'pointer' : 'default',
              background: canAdd ? 'var(--sb-ink-1)' : 'var(--sb-field)',
              border: `var(--sb-border-width) solid ${canAdd ? 'var(--sb-ink-1)' : 'var(--sb-border)'}`,
              color: canAdd ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-4)',
              fontFamily: 'inherit', fontSize: 'var(--sb-t-label)', fontWeight: 600,
            }}>
            <Plus size={ICON.sm} /> Add rule
          </button>
        </div>

        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {state.own.length === 0 && (
            <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', lineHeight: 1.55 }}>
              None yet. Anything added here is marked as yours everywhere it lands — it is a thing you told the
              plan, not a thing the plan read.
            </div>
          )}
          {state.own.map(r => (
            <div key={r.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px',
              background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)',
              borderRadius: 'var(--sb-r-nav)', opacity: r.on ? 1 : 0.55,
            }}>
              <Switch on={r.on} onChange={v => patch(r.id, { on: v })} label={r.what} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--sb-t-body-s)', fontWeight: 600 }}>
                {r.what}
                <span style={{ display: 'block', fontWeight: 400, fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)' }}>
                  {phrase(r)}
                </span>
              </span>
              <span style={{
                fontFamily: 'var(--sb-font-num)', fontVariantNumeric: 'tabular-nums', fontWeight: 700,
                fontSize: 'var(--sb-t-body-s)',
                color: r.kind === 'income' ? 'var(--sb-positive)' : 'var(--sb-negative)',
              }}>
                {r.kind === 'income' ? acct(r.amount, { currency }) : acct(-r.amount, { currency })}
              </span>
              <button onClick={() => drop(r.id)} title={`Remove "${r.what}"`}
                style={{
                  width: 28, height: 28, borderRadius: 'var(--sb-r-chip)', padding: 0, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                  background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
                  color: 'var(--sb-ink-4)',
                }}><Trash2 size={ICON.sm} /></button>
            </div>
          ))}
        </div>
      </div>
    </details>
  )
}

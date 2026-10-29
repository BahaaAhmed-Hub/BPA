import { Check, ChevronDown, X } from 'lucide-react'
import type { Account } from '../types'
import { MoneyInput } from './MoneyInput'
import { PILL, ROW, LABEL, PillPicker } from '../modals/pickers'
import {
  PLAN_FREQUENCIES, planIssue, payoff, dayPhrase, monthPhrase, type LoanPlan,
} from '../loanPlan'
import { acct } from '../format'
import { todayISO } from '../dates'
import { openPicker } from '@/lib/nativePicker'
import { ICON, STROKE } from '@/lib/type'

// ─── "Set a payment plan" — the loan's budget, asked for in plain words ──────
//
// Off, a loan is just a debt: it has a goal ("Repay Ahmed") and nothing is
// scheduled. On, it asks for the four things a repayment is — how much, how
// often, when it starts and where it leaves from — and the plan it makes is the
// loan's budget line (`loanPlan.ts`). A last month is optional: left empty the
// plan runs until the debt is gone.
//
// Controlled. The caller owns the plan and decides when it is written, because
// two different forms use this and they save at different moments.

export function LoanPlanFields({ value, onChange, currency, owed, payFrom, defaultPayFromId }: {
  value: LoanPlan | null
  onChange: (next: LoanPlan | null) => void
  /** The loan's own currency — what each payment is written in. */
  currency: string
  /** What is owed now, in that currency, for the "clears in" line. */
  owed?: number
  /** Where payments can leave from. */
  payFrom: Account[]
  defaultPayFromId?: string
}) {
  const on = !!value
  const patch = (p: Partial<LoanPlan>) => value && onChange({ ...value, ...p })
  const issue = value ? planIssue(value) : null
  const today = todayISO()
  const result = value && !issue && owed && owed > 0 ? payoff(value, owed, today) : null

  return (
    <>
      <div style={ROW}>
        <span style={LABEL}>Repay</span>
        <button
          type="button" role="checkbox" aria-checked={on}
          onClick={() => onChange(on ? null : {
            frequency: 'monthly', amount: 0, start: today,
            payFromId: defaultPayFromId || payFrom[0]?.id,
          })}
          style={{
            ...PILL, flex: 1, justifyContent: 'flex-start',
            background: on ? 'var(--sb-ink-1)' : 'var(--sb-card)',
            border: on ? 'none' : 'var(--sb-border-width) solid var(--sb-border)',
            color: on ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-3)',
          }}>
          {on ? <><Check size={ICON.sm} strokeWidth={STROKE.active} /> On a payment plan</> : 'Set a payment plan'}
        </button>
      </div>

      {value && (
        <>
          <div style={ROW}>
            <span style={LABEL}>Every</span>
            <span style={{ display: 'flex', gap: 6, flex: 1, minWidth: 0 }}>
              {PLAN_FREQUENCIES.map(f => (
                <button key={f.v} type="button" aria-pressed={value.frequency === f.v}
                  onClick={() => patch({ frequency: f.v })}
                  style={{
                    ...PILL, flex: 1, justifyContent: 'center', paddingInline: 8,
                    fontSize: 'var(--sb-t-body-s)', fontWeight: value.frequency === f.v ? 600 : 500,
                    background: value.frequency === f.v ? 'var(--sb-ink-1)' : 'var(--sb-card)',
                    color: value.frequency === f.v ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-3)',
                  }}>{f.label}</button>
              ))}
            </span>
          </div>

          <div style={ROW}>
            <span style={LABEL}>Each</span>
            <span style={{ ...PILL, flex: 1, cursor: 'text', gap: 8 }}>
              <span style={{ color: 'var(--sb-ink-3)', fontWeight: 600 }}>{currency}</span>
              <MoneyInput
                value={value.amount} min={0}
                onChange={n => patch({ amount: n })}
                placeholder="0" aria-label="Each payment"
                style={{
                  flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
                  fontFamily: 'inherit', fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)', textAlign: 'right', padding: 0,
                }} />
            </span>
          </div>

          <div style={ROW}>
            <span style={LABEL}>First</span>
            <label onClick={openPicker} style={{ ...PILL, flex: 1, position: 'relative', justifyContent: 'space-between' }}>
              {dayPhrase(value.start)}
              <ChevronDown size={ICON.sm} strokeWidth={STROKE.rest} style={{ color: 'var(--sb-ink-3)', flexShrink: 0 }} />
              <input type="date" value={value.start} aria-label="First payment"
                onChange={e => e.target.value && patch({ start: e.target.value })}
                style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', border: 'none', padding: 0, pointerEvents: 'none' }} />
            </label>
          </div>

          <div style={ROW}>
            <span style={LABEL}>Until</span>
            <span style={{ display: 'flex', gap: 7, flex: 1, minWidth: 0 }}>
              <label onClick={openPicker} style={{ ...PILL, flex: 1, position: 'relative', justifyContent: 'space-between' }}>
                {value.ends ? monthPhrase(value.ends) : <span style={{ color: 'var(--sb-ink-3)' }}>Until it is paid off</span>}
                <ChevronDown size={ICON.sm} strokeWidth={STROKE.rest} style={{ color: 'var(--sb-ink-3)', flexShrink: 0 }} />
                <input type="month" value={value.ends ?? ''} min={value.start.slice(0, 7)} aria-label="Last payment month"
                  onChange={e => patch({ ends: e.target.value || undefined })}
                  style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', border: 'none', padding: 0, pointerEvents: 'none' }} />
              </label>
              {value.ends && (
                <button type="button" onClick={() => patch({ ends: undefined })}
                  title="No last month" aria-label="No last month"
                  style={{ ...PILL, width: 42, padding: 0, justifyContent: 'center', flexShrink: 0, color: 'var(--sb-ink-3)' }}>
                  <X size={ICON.sm} />
                </button>
              )}
            </span>
          </div>

          <div style={ROW}>
            <span style={LABEL}>From</span>
            <PillPicker
              value={value.payFromId ?? ''}
              onChange={id => patch({ payFromId: id })}
              placeholder={payFrom.length === 0 ? 'Add a payment account first' : 'Which account'}
              options={payFrom.map(a => ({ id: a.id, label: a.name, glyph: a.emoji, tint: a.color }))} />
          </div>

          {/* What the plan comes to, or what is wrong with it. A plan that ends
              before the debt does says by how much — it is allowed, and it
              should never be a surprise. */}
          <div style={{ ...ROW, alignItems: 'flex-start' }}>
            <span style={LABEL} />
            <span style={{
              flex: 1, minWidth: 0, padding: '9px 12px', borderRadius: 'var(--sb-r-nav)',
              background: issue ? 'var(--sb-negative-tint)' : 'var(--sb-field)',
              fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-2)', lineHeight: 1.5,
            }} data-plan-summary>
              {issue ? issue
                : result && result.short <= 0
                  ? <>Clears {acct(owed!, { currency })} in <b style={{ fontWeight: 600 }}>{result.payments} payment{result.payments === 1 ? '' : 's'}</b>, the last on {dayPhrase(result.last!)}.</>
                : result
                  ? <>Ends before it is cleared: <b style={{ fontWeight: 600 }}>{acct(result.short, { currency })}</b> would still be owed after {result.payments} payment{result.payments === 1 ? '' : 's'}.</>
                  : 'It goes into the Budget as a fixed cost, and each payment is filed as unpaid until you pay it.'}
            </span>
          </div>
        </>
      )}
    </>
  )
}

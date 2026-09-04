import { useEffect, useRef } from 'react'
import { X, ChevronDown, Check } from 'lucide-react'
import type { Category, Transaction } from '../types'

// ─── What an envelope is set to ──────────────────────────────────────────────
// This was a whole right-hand column: an amount, a fixed-or-flexible pair, five
// frequency pills, a start month, and four switches. Two of those switches —
// auto-raise with inflation, and count toward guilt-free spend — were never
// read by anything. They remembered their own position and that was the whole
// of what they did, so they are gone.

const INK   = '#191712'
const MUTED = '#6C6553'
const GHOST = '#9B9180'
const LINE  = '#E8E1CE'
const HAIR  = '#F0EBDC'
const OLIVE = '#5F7038'
const RUST  = '#B4523A'
const AMBER = '#F5D14E'
const DISPLAY = "'Outfit', system-ui, sans-serif"

export type Frequency = 'weekly' | 'monthly' | 'every_2_months' | 'quarterly' | 'yearly'

export interface BudgetRule {
  amount: number
  frequency: Frequency
  rollover: boolean
  warn80: boolean
  starts: string          // YYYY-MM
  fixedType: 'fixed' | 'flexible'
}

export const FREQ_OPTS: { v: Frequency; label: string; per: number }[] = [
  { v: 'weekly',         label: 'a week',      per: 52 / 12 },
  { v: 'monthly',        label: 'a month',     per: 1 },
  { v: 'every_2_months', label: 'two months',  per: 1 / 2 },
  { v: 'quarterly',      label: 'a quarter',   per: 1 / 3 },
  { v: 'yearly',         label: 'a year',      per: 1 / 12 },
]

export function defaultRule(): BudgetRule {
  const d = new Date()
  return {
    amount: 0, frequency: 'monthly', rollover: false, warn80: true,
    starts: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
    fixedType: 'flexible',
  }
}

/** What this envelope is worth in a single month. The frequency was collected
 *  and then ignored: a yearly budget of 12,000 was compared against one
 *  month's spending as though it were 12,000 a month. */
export function monthlyAmount(rule?: Pick<BudgetRule, 'amount' | 'frequency'>): number {
  if (!rule?.amount) return 0
  return rule.amount * (FREQ_OPTS.find(f => f.v === rule.frequency)?.per ?? 1)
}

const PILL: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, height: 42, boxSizing: 'border-box',
  padding: '0 14px', borderRadius: 10, background: '#FFFFFF', border: `1px solid ${LINE}`,
  color: INK, fontSize: 13.5, fontFamily: 'inherit', cursor: 'pointer', minWidth: 0,
}
const ROUND: React.CSSProperties = {
  width: 30, height: 30, borderRadius: '50%', flexShrink: 0, padding: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: '#FFFFFF', border: `1px solid ${LINE}`, color: MUTED, cursor: 'pointer',
}
const LABEL: React.CSSProperties = { width: 74, flexShrink: 0, fontSize: 13.5, color: MUTED, fontWeight: 500 }
const ROW: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10 }

function Switch({ on, onChange, label, sub }: {
  on: boolean; onChange: (v: boolean) => void; label: string; sub: string
}) {
  return (
    <button onClick={() => onChange(!on)}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 11, width: '100%', padding: '10px 0',
        background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
      }}>
      <span style={{
        width: 34, height: 20, borderRadius: 999, flexShrink: 0, marginTop: 1,
        background: on ? INK : '#E4DCC6', position: 'relative', transition: 'background .15s',
      }}>
        <span style={{
          position: 'absolute', top: 2, left: on ? 16 : 2, width: 16, height: 16, borderRadius: '50%',
          background: '#FFFFFF', boxShadow: '0 1px 2px rgba(25,23,18,0.2)', transition: 'left .15s',
        }} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13, color: INK }}>{label}</span>
        <span style={{ display: 'block', fontSize: 11.5, color: GHOST, marginTop: 2 }}>{sub}</span>
      </span>
    </button>
  )
}

interface Props {
  category: Category
  rule: BudgetRule
  subs: Category[]
  transactions: Transaction[]
  monthKey: string          // YYYY-MM
  currency: string
  onChange: (rule: BudgetRule) => void
  onEditCategory: () => void
  onAddSub: () => void
  onEditSub: (sub: Category) => void
  onDrill: () => void
  onClose: () => void
}

export function BudgetRuleModal({
  category, rule, subs, transactions, monthKey, currency,
  onChange, onEditCategory, onAddSub, onEditSub, onDrill, onClose,
}: Props) {
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const openedAt = Date.now()
    const away = (e: Event) => {
      if (Date.now() - openedAt < 400) return
      if (box.current && !box.current.contains(e.target as Node)) onClose()
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc) }
  }, [onClose])

  const wanted = category.txType === 'income' ? 'income' : 'expense'
  const ids = new Set([category.id, ...subs.map(s => s.id)])
  const spent = transactions
    .filter(tx => tx.type === wanted && tx.categoryId && ids.has(tx.categoryId) && tx.date.startsWith(monthKey))
    .reduce((s, tx) => s + Math.abs(tx.amount), 0)

  const budget = monthlyAmount(rule)
  const pct    = budget > 0 ? Math.min(spent / budget, 1) : 0
  const over   = budget > 0 && spent > budget
  const near   = budget > 0 && !over && rule.warn80 && spent / budget >= 0.8
  const tone   = category.txType === 'income' ? OLIVE : RUST
  const freq   = FREQ_OPTS.find(f => f.v === rule.frequency) ?? FREQ_OPTS[1]

  const fmt = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 0 })

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, padding: 18,
        background: 'rgba(25,23,18,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
      <div ref={box} style={{
        width: 'clamp(320px, 94vw, 440px)', maxHeight: '90vh', overflowY: 'auto',
        boxSizing: 'border-box', scrollbarWidth: 'thin',
        background: '#FFFFFF', border: `1px solid ${LINE}`, borderRadius: 18,
        boxShadow: '0 24px 60px rgba(25,23,18,0.24)', padding: '18px 20px 22px',
      }}>

        {/* Which envelope, and the way out */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 24, flexShrink: 0 }}>{category.icon}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontFamily: DISPLAY, fontSize: 19, fontWeight: 600, letterSpacing: '-0.02em', color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {category.name}
            </div>
            <div style={{ fontSize: 11.5, color: GHOST, marginTop: 1 }}>
              {new Date(monthKey + '-01T12:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
            </div>
          </div>
          <button onClick={onClose} title="Close" style={ROUND}><X size={14} /></button>
        </div>

        {/* Where it stands this month */}
        <div style={{
          marginTop: 14, padding: '13px 15px', borderRadius: 12,
          background: '#FAF7EC', border: `1px solid ${LINE}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: DISPLAY, fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em', color: over ? tone : INK, fontVariantNumeric: 'tabular-nums' }}>
              {fmt(spent)}
            </span>
            <span style={{ fontSize: 12, color: MUTED }}>
              {budget > 0 ? `of ${currency} ${fmt(budget)} this month` : 'no budget set'}
            </span>
            <span style={{ flex: 1 }} />
            {spent > 0 && (
              <button onClick={onDrill}
                style={{ height: 26, padding: '0 10px', borderRadius: 7, background: '#E9EFD9', border: '1px solid #C8D9A8', color: OLIVE, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                View all →
              </button>
            )}
          </div>
          {budget > 0 && (
            <>
              <div style={{ height: 6, borderRadius: 999, background: '#EDE7D9', marginTop: 10, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct * 100}%`, background: over ? tone : near ? '#E8A94A' : OLIVE, borderRadius: 999 }} />
              </div>
              <div style={{ fontSize: 11.5, color: over ? tone : near ? '#8A6D0B' : MUTED, marginTop: 7 }}>
                {over  ? `Over by ${currency} ${fmt(spent - budget)}`
                 : near ? `${currency} ${fmt(budget - spent)} left — past 80%`
                        : `${currency} ${fmt(budget - spent)} left`}
              </div>
            </>
          )}
        </div>

        <div style={{ height: 1, background: HAIR, margin: '18px 0' }} />

        {/* The budget itself: one number, and how often it renews */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={ROW}>
            <span style={LABEL}>Budget</span>
            <span style={{ flex: 1, minWidth: 0, display: 'flex', gap: 7 }}>
              <span style={{
                ...PILL, flex: 1, cursor: 'text', gap: 8,
                background: '#FAF7EC',
              }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: MUTED, flexShrink: 0 }}>{currency}</span>
                <input
                  type="number" min={0} inputMode="decimal"
                  value={rule.amount || ''}
                  onChange={e => onChange({ ...rule, amount: parseFloat(e.target.value) || 0 })}
                  placeholder="0"
                  style={{
                    flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
                    fontFamily: DISPLAY, fontSize: 18, fontWeight: 600, color: INK,
                    textAlign: 'right', fontVariantNumeric: 'tabular-nums', padding: 0,
                  }} />
              </span>
              <span style={{ position: 'relative', display: 'flex', flexShrink: 0 }}>
                <span style={{ ...PILL, gap: 5, color: MUTED }}>
                  {freq.label}
                  <ChevronDown size={13} strokeWidth={2} style={{ color: GHOST }} />
                </span>
                <select value={rule.frequency} onChange={e => onChange({ ...rule, frequency: e.target.value as Frequency })}
                  style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', border: 'none' }}>
                  {FREQ_OPTS.map(f => <option key={f.v} value={f.v}>{f.label}</option>)}
                </select>
              </span>
            </span>
          </div>

          {rule.frequency !== 'monthly' && rule.amount > 0 && (
            <div style={{ ...ROW, marginTop: -4 }}>
              <span style={LABEL} />
              <span style={{ fontSize: 11.5, color: GHOST }}>
                {currency} {fmt(budget)} a month, which is what the envelope is measured against
              </span>
            </div>
          )}

          <div style={ROW}>
            <span style={LABEL}>Kind</span>
            <span style={{ flex: 1, minWidth: 0, display: 'flex', gap: 7 }}>
              {(['flexible', 'fixed'] as const).map(t => {
                const on = rule.fixedType === t
                return (
                  <button key={t} onClick={() => onChange({ ...rule, fixedType: t })}
                    title={t === 'fixed' ? 'A commitment you cannot move' : 'Spending you can steer'}
                    style={{
                      ...PILL, flex: 1, justifyContent: 'center', whiteSpace: 'nowrap',
                      background: on ? INK : '#FFFFFF',
                      border: on ? 'none' : `1px solid ${LINE}`,
                      color: on ? '#FDF8E7' : MUTED,
                      fontWeight: on ? 600 : 400,
                    }}>{t === 'fixed' ? 'Fixed' : 'Flexible'}</button>
                )
              })}
            </span>
          </div>

          <div style={ROW}>
            <span style={LABEL}>Starts</span>
            <label style={{ ...PILL, flex: 1, position: 'relative', justifyContent: 'space-between' }}>
              {new Date(rule.starts + '-01T12:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
              <ChevronDown size={13} strokeWidth={2} style={{ color: GHOST, flexShrink: 0 }} />
              <input type="month" value={rule.starts} onChange={e => onChange({ ...rule, starts: e.target.value })}
                style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', border: 'none', padding: 0 }} />
            </label>
          </div>
        </div>

        <div style={{ height: 1, background: HAIR, margin: '14px 0 4px' }} />

        <Switch on={rule.rollover} onChange={v => onChange({ ...rule, rollover: v })}
          label="Roll unspent into next month" sub="Underspend carries, overspend does not" />
        <Switch on={rule.warn80} onChange={v => onChange({ ...rule, warn80: v })}
          label="Warn at 80%" sub="A quiet nudge here, not a block" />

        {/* Its children, if it has any */}
        <div style={{ height: 1, background: HAIR, margin: '14px 0' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: subs.length ? 8 : 0 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', color: MUTED }}>
            SUB-CATEGORIES
          </span>
          <span style={{ flex: 1 }} />
          <button onClick={onAddSub} style={{ ...PILL, height: 28, fontSize: 12, color: MUTED }}>+ Add</button>
        </div>
        {subs.map(sub => {
          const subSpend = transactions
            .filter(tx => tx.categoryId === sub.id && tx.date.startsWith(monthKey))
            .reduce((s, tx) => s + Math.abs(tx.amount), 0)
          return (
            <button key={sub.id} onClick={() => onEditSub(sub)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '7px 0',
                background: 'none', border: 'none', borderBottom: `1px solid ${HAIR}`,
                cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
              }}>
              <span style={{ fontSize: 15 }}>{sub.icon}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub.name}</span>
              {subSpend > 0 && (
                <span style={{ fontFamily: DISPLAY, fontSize: 12, fontWeight: 600, color: tone, fontVariantNumeric: 'tabular-nums' }}>
                  {fmt(subSpend)}
                </span>
              )}
            </button>
          )
        })}

        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button onClick={onClose} style={{
            ...PILL, flex: 1, justifyContent: 'center', fontWeight: 600,
            background: INK, border: 'none', color: '#FDF8E7',
          }}>
            <Check size={14} strokeWidth={2.5} /> Done
          </button>
          <button onClick={onEditCategory} style={{ ...PILL, color: MUTED }}>Rename…</button>
        </div>
        <div style={{ fontSize: 11, color: GHOST, marginTop: 10, textAlign: 'center' }}>
          Changes save as you make them
        </div>
      </div>
    </div>
  )
}

export { AMBER }

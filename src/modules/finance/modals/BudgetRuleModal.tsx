import { useEffect, useRef, useState } from 'react'
import { X, ChevronDown, Check } from 'lucide-react'
import type { Category, Transaction } from '../types'
import { IconPicker } from '../components/IconPicker'

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
  starts: string          // YYYY-MM — the first month it applies to
  /** The last month it applies to. Absent means it runs on. */
  ends?: string           // YYYY-MM
  /** What the amount is denominated in. There are no exchange rates in this
   *  app, so it is also which transactions the envelope counts. */
  currency?: string
  fixedType: 'fixed' | 'flexible'
}

export const FREQ_OPTS: { v: Frequency; label: string; per: number }[] = [
  { v: 'weekly',         label: 'Weekly',        per: 52 / 12 },
  { v: 'monthly',        label: 'Monthly',       per: 1 },
  { v: 'every_2_months', label: 'Every 2 months', per: 1 / 2 },
  { v: 'quarterly',      label: 'Quarterly',     per: 1 / 3 },
  { v: 'yearly',         label: 'Annual',        per: 1 / 12 },
]

/** The four worth offering. Every-2-months stays in the table above so a rule
 *  already set to it still reads and still divides correctly — it is just not
 *  something else to scroll past when picking. */
const FREQ_CHOICES: Frequency[] = ['weekly', 'monthly', 'quarterly', 'yearly']

export function defaultRule(): BudgetRule {
  const d = new Date()
  return {
    amount: 0, frequency: 'monthly', rollover: false, warn80: true,
    starts: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
    fixedType: 'flexible',
  }
}

/** Whether this budget is one that applies to the month being looked at.
 *  Both ends were collected and neither was consulted: a budget starting in
 *  September was compared against January's spending as readily as
 *  September's, and one that had ended never stopped. */
export function activeIn(rule: Pick<BudgetRule, 'starts' | 'ends'> | undefined, monthKey: string): boolean {
  if (!rule) return false
  if (rule.starts && monthKey < rule.starts) return false
  if (rule.ends   && monthKey > rule.ends)   return false
  return true
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

/** An honest dropdown. The interval was a native select under a pill, which
 *  works but does not look like anything you can press. */
function IntervalPicker({ value, onChange }: { value: Frequency; onChange: (f: Frequency) => void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  const current = FREQ_OPTS.find(f => f.v === value) ?? FREQ_OPTS[1]
  // Whatever it is set to is always offered, even if it is not one of the four.
  const choices = FREQ_CHOICES.includes(value) ? FREQ_CHOICES : [...FREQ_CHOICES, value]

  useEffect(() => {
    if (!open) return
    const away = (e: Event) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  return (
    <span ref={box} style={{ position: 'relative', display: 'flex', flexShrink: 0 }}>
      <button type="button" onClick={() => setOpen(o => !o)} title="How often this budget renews"
        style={{ ...PILL, gap: 5, color: MUTED, whiteSpace: 'nowrap' }}>
        {current.label}
        <ChevronDown size={13} strokeWidth={2} style={{ color: GHOST }} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 46, right: 0, minWidth: 168, zIndex: 30, padding: 5,
          background: '#FFFFFF', border: `1px solid ${LINE}`, borderRadius: 12,
          boxShadow: '0 12px 32px rgba(25,23,18,0.18)',
        }}>
          {choices.map(v => {
            const opt = FREQ_OPTS.find(f => f.v === v)!
            const on = v === value
            return (
              <button key={v} type="button" onClick={() => { onChange(v); setOpen(false) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 10px',
                  border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
                  background: on ? 'rgba(245,209,78,0.18)' : 'transparent',
                  fontSize: 13.5, color: INK, textAlign: 'left',
                }}>
                <span style={{ flex: 1 }}>{opt.label}</span>
                {on && <Check size={14} strokeWidth={2.5} style={{ color: '#8A6D0B' }} />}
              </button>
            )
          })}
        </div>
      )}
    </span>
  )
}

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
  /** Clear the budget entirely, as opposed to setting it to nothing. */
  onDelete: () => void
  /** Name and icon are edited here rather than in a second window. */
  onRename: (patch: Partial<Category>) => void
  onEditCategory: () => void
  onAddSub: () => void
  onEditSub: (sub: Category) => void
  onDrill: () => void
  onClose: () => void
}

export function BudgetRuleModal({
  category, rule, subs, transactions, monthKey, currency,
  onChange, onDelete, onRename, onEditCategory, onAddSub, onEditSub, onDrill, onClose,
}: Props) {
  const box = useRef<HTMLDivElement>(null)
  // Held locally while it is being typed, so every keystroke is not a write.
  const [name, setName] = useState(category.name)
  useEffect(() => { setName(category.name) }, [category.id, category.name])

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

  const cur = rule.currency ?? currency
  const wanted = category.txType === 'income' ? 'income' : 'expense'
  const ids = new Set([category.id, ...subs.map(s => s.id)])
  const mine = transactions.filter(tx =>
    tx.type === wanted && tx.categoryId && ids.has(tx.categoryId) && tx.date.startsWith(monthKey))
  // Only what the budget is denominated in. Adding 117 USD to 64,000 EGP as
  // though they were the same number is worse than leaving it out and saying so.
  const spent  = mine.filter(tx => tx.currency === cur).reduce((s, tx) => s + Math.abs(tx.amount), 0)
  const others = [...new Set(mine.filter(tx => tx.currency !== cur).map(tx => tx.currency))]

  const running = activeIn(rule, monthKey)
  const budget = running ? monthlyAmount(rule) : 0
  const pct    = budget > 0 ? Math.min(spent / budget, 1) : 0
  const over   = budget > 0 && spent > budget
  const near   = budget > 0 && !over && rule.warn80 && spent / budget >= 0.8
  const tone   = category.txType === 'income' ? OLIVE : RUST

  const fmt = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 0 })
  const monthLabel = (m: string) => new Date(m + '-01T12:00:00').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })

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
          {/* The icon is the picker — a logo you have uploaded, or an emoji */}
          <IconPicker
            value={category.icon}
            onChange={icon => onRename({ icon })}
            trigger={onClick => (
              <button onClick={onClick} title="Change the icon"
                style={{
                  width: 40, height: 40, borderRadius: 11, flexShrink: 0, padding: 0,
                  border: `1px solid ${LINE}`, background: '#FAF7EC', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                }}>
                {category.icon.startsWith('data:') || category.icon.startsWith('http')
                  ? <img src={category.icon} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <span style={{ fontSize: 21, lineHeight: 1 }}>{category.icon}</span>}
              </button>
            )}
          />
          <div style={{ minWidth: 0, flex: 1 }}>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              onBlur={() => { const n = name.trim(); if (n && n !== category.name) onRename({ name: n }); else setName(category.name) }}
              onKeyDown={e => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') { setName(category.name); (e.target as HTMLInputElement).blur() }
              }}
              placeholder="Name this category"
              title="Click to rename"
              style={{
                width: '100%', boxSizing: 'border-box', padding: '2px 6px', marginLeft: -6,
                background: 'transparent', border: '1px solid transparent', borderRadius: 7,
                fontFamily: DISPLAY, fontSize: 19, fontWeight: 600, letterSpacing: '-0.02em',
                color: INK, outline: 'none',
              }}
              onFocus={e => { e.target.style.background = '#FAF7EC'; e.target.style.borderColor = LINE }}
              onBlurCapture={e => { e.target.style.background = 'transparent'; e.target.style.borderColor = 'transparent' }}
            />
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
              {budget > 0
                ? `of ${cur} ${fmt(budget)} this month`
                : rule.amount > 0 && !running
                  ? `budget not running this month`
                  : 'no budget set'}
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
                {over  ? `Over by ${cur} ${fmt(spent - budget)}`
                 : near ? `${cur} ${fmt(budget - spent)} left — past 80%`
                        : `${cur} ${fmt(budget - spent)} left`}
              </div>
            </>
          )}
        </div>

        {others.length > 0 && (
          <div style={{ fontSize: 11.5, color: GHOST, marginTop: 8, lineHeight: 1.5 }}>
            {others.join(' and ')} spending in this category is not counted — there are no
            exchange rates here, so only {cur} is measured against a {cur} budget.
          </div>
        )}

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
                <span style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: MUTED, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                    {cur}<ChevronDown size={10} strokeWidth={2.5} style={{ color: GHOST }} />
                  </span>
                  <select value={cur} onChange={e => onChange({ ...rule, currency: e.target.value })}
                    title="What this budget is in"
                    style={{ position: 'absolute', inset: -6, opacity: 0, width: 'calc(100% + 12px)', height: 'calc(100% + 12px)', cursor: 'pointer', border: 'none' }}>
                    {['EGP', 'USD', 'AED'].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </span>
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
              <IntervalPicker value={rule.frequency} onChange={f => onChange({ ...rule, frequency: f })} />
            </span>
          </div>

          {rule.frequency !== 'monthly' && rule.amount > 0 && (
            <div style={{ ...ROW, marginTop: -4 }}>
              <span style={LABEL} />
              <span style={{ fontSize: 11.5, color: GHOST }}>
                {cur} {fmt(budget)} a month, which is what the envelope is measured against
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
            <span style={LABEL}>Runs</span>
            <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
              <label style={{ ...PILL, flex: 1, position: 'relative', justifyContent: 'center' }} title="First month this budget applies to">
                {monthLabel(rule.starts)}
                <input type="month" value={rule.starts} onChange={e => onChange({ ...rule, starts: e.target.value })}
                  style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', border: 'none', padding: 0 }} />
              </label>
              <span style={{ fontSize: 11.5, color: GHOST, flexShrink: 0 }}>to</span>
              <label style={{ ...PILL, flex: 1, position: 'relative', justifyContent: 'center' }} title="Last month it applies to">
                <span style={{ color: rule.ends ? INK : GHOST }}>{rule.ends ? monthLabel(rule.ends) : 'no end'}</span>
                <input type="month" value={rule.ends ?? ''} min={rule.starts}
                  onChange={e => onChange({ ...rule, ends: e.target.value || undefined })}
                  style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', border: 'none', padding: 0 }} />
              </label>
              {rule.ends && (
                <button onClick={() => onChange({ ...rule, ends: undefined })} title="Let it run on"
                  style={{ ...ROUND, width: 26, height: 26 }}><X size={12} /></button>
              )}
            </span>
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
          <button onClick={onEditCategory} title="Colour, type, parent, delete"
            style={{ ...PILL, color: MUTED }}>More…</button>
        </div>
        <div style={{ fontSize: 11, color: GHOST, marginTop: 10, textAlign: 'center' }}>
          Name, icon and budget save as you change them
        </div>

        {rule.amount > 0 && (
          <button
            onClick={() => { onDelete(); onClose() }}
            title="Remove the budget — the category and its transactions stay"
            style={{
              marginTop: 12, width: '100%', height: 34, borderRadius: 9,
              background: 'none', border: 'none', fontFamily: 'inherit',
              color: RUST, fontSize: 12.5, cursor: 'pointer',
            }}>
            Remove this budget
          </button>
        )}
      </div>
    </div>
  )
}

export { AMBER }

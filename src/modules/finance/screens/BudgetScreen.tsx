import { useState, useMemo } from 'react'
import { useFinanceStore } from '../financeStore'
import type { Category } from '../types'

// ─── 16G · Budget Builder ─────────────────────────────────────────────────────
// Categories tree with budget rules: amount, frequency, roll unspent,
// warn at 80%, auto-raise with inflation, guilt-free flag

const OLIVE = '#5F7038'
const RUST  = '#B4523A'
const AMBER = '#F5D14E'

type Frequency = 'weekly' | 'monthly' | 'every_2_months' | 'quarterly' | 'yearly'

const FREQ_OPTS: { v: Frequency; label: string }[] = [
  { v: 'weekly',        label: 'Weekly' },
  { v: 'monthly',       label: 'Monthly' },
  { v: 'every_2_months',label: 'Every 2 months' },
  { v: 'quarterly',     label: 'Quarterly' },
  { v: 'yearly',        label: 'Yearly' },
]

interface BudgetRule {
  amount: number
  frequency: Frequency
  rollover: boolean
  warn80: boolean
  autoRaise: boolean
  guiltFree: boolean
  starts: string   // YYYY-MM
  fixedType: 'fixed' | 'flexible'
}

function defaultRule(): BudgetRule {
  const d = new Date()
  const starts = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}`
  return { amount: 0, frequency: 'monthly', rollover: false, warn80: true, autoRaise: false, guiltFree: false, starts, fixedType: 'flexible' }
}

// ─── Amount display in the left list ─────────────────────────────────────────

function fmtAmt(v: number) {
  if (!v) return '–'
  return 'EGP ' + v.toLocaleString('en-US')
}

// ─── Toggle switch ────────────────────────────────────────────────────────────

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div
      onClick={() => onChange(!on)}
      style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '8px 0' }}
    >
      <div style={{
        width: 36, height: 20, borderRadius: 999, flexShrink: 0,
        background: on ? '#191712' : '#D8D3C8',
        position: 'relative', transition: 'background .2s',
      }}>
        <div style={{
          position: 'absolute', top: 2, left: on ? 18 : 2,
          width: 16, height: 16, borderRadius: '50%',
          background: '#FFFFFF', transition: 'left .2s',
          boxShadow: '0 1px 3px rgba(0,0,0,.25)',
        }} />
      </div>
      <span style={{ fontSize: 13, color: '#191712' }}>{label}</span>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function BudgetScreen(_props?: any) {
  const { categories, transactions } = useFinanceStore()

  // Parent categories only (for list)
  const parents = useMemo(
    () => categories.filter(c => !c.parentId).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [categories],
  )

  // Sub-categories
  const subs = useMemo(
    () => (parentId: string) => categories.filter(c => c.parentId === parentId),
    [categories],
  )

  // Budget rules stored locally (keyed by category id)
  const [rules, setRules] = useState<Record<string, BudgetRule>>(() => {
    try { return JSON.parse(localStorage.getItem('finance-budget-rules') ?? '{}') } catch { return {} }
  })
  function saveRule(catId: string, rule: BudgetRule) {
    const next = { ...rules, [catId]: rule }
    setRules(next)
    localStorage.setItem('finance-budget-rules', JSON.stringify(next))
  }

  const [selectedId, setSelectedId] = useState<string | null>(parents[0]?.id ?? null)
  const selectedCat = parents.find(p => p.id === selectedId) ?? null
  const rule = selectedId ? (rules[selectedId] ?? defaultRule()) : null

  // Monthly spend for selected category (current month)
  const today = new Date()
  const monthPrefix = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2,'0')}`
  const monthSpend = useMemo(() => {
    if (!selectedId) return 0
    return transactions
      .filter(tx => tx.type === 'expense' && tx.categoryId === selectedId && tx.date.startsWith(monthPrefix))
      .reduce((s, tx) => s + Math.abs(tx.amount), 0)
  }, [transactions, selectedId, monthPrefix])

  const budget = rule?.amount ?? 0
  const pct = budget > 0 ? Math.min((monthSpend / budget) * 100, 100) : 0
  const overBudget = budget > 0 && monthSpend > budget
  const nearBudget = budget > 0 && pct >= 80 && !overBudget

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: '#F7F4EA' }}>

      {/* Left — categories list */}
      <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid #E8E1CE', display: 'flex', flexDirection: 'column', background: '#FCFAF4', overflow: 'hidden' }}>

        {/* Left header */}
        <div style={{ flexShrink: 0, borderBottom: '1px solid #E8E1CE', padding: '14px 18px 12px' }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', color: '#6C6553', display: 'block', marginBottom: 4 }}>MONEY · SET UP</span>
          <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', color: '#191712', display: 'block' }}>Budget builder</span>
          <span style={{ fontSize: 11.5, color: '#9B9180', display: 'block', marginTop: 2 }}>
            {parents.length} categories · click to configure
          </span>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 0' }}>
          {parents.map(cat => {
            const r = rules[cat.id]
            const active = selectedId === cat.id
            const subCount = subs(cat.id).length
            return (
              <div
                key={cat.id}
                onClick={() => setSelectedId(cat.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 18px', cursor: 'pointer',
                  background: active ? '#F5D14E22' : 'transparent',
                  borderLeft: `3px solid ${active ? AMBER : 'transparent'}`,
                  borderBottom: '1px solid #F0EBDC',
                }}
              >
                <span style={{ fontSize: 18, flexShrink: 0 }}>{cat.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500, color: '#191712' }}>{cat.name}</div>
                  {subCount > 0 && (
                    <div style={{ fontSize: 11, color: '#9B9180', marginTop: 1 }}>{subCount} sub-categories</div>
                  )}
                </div>
                <span style={{ fontSize: 12, color: r?.amount ? '#191712' : '#C5BCA8', fontFamily: 'Outfit, sans-serif', fontWeight: 600, flexShrink: 0 }}>
                  {r ? fmtAmt(r.amount) : '–'}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Right — budget rule editor */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '28px 36px' }}>

        {!selectedCat || !rule ? (
          <div style={{ fontSize: 13, color: '#9B9180', textAlign: 'center', marginTop: 60 }}>
            Select a category to configure its budget
          </div>
        ) : (
          <div style={{ maxWidth: 520 }}>

            {/* Category title */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
              <span style={{ fontSize: 32 }}>{selectedCat.icon}</span>
              <div>
                <div style={{ fontFamily: 'Outfit, sans-serif', fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', color: '#191712' }}>
                  {selectedCat.name}
                </div>
                <div style={{ fontSize: 12, color: '#9B9180', marginTop: 2 }}>
                  {subs(selectedCat.id).length} sub-categories
                </div>
              </div>
            </div>

            {/* Spend progress */}
            {budget > 0 && (
              <div style={{ marginBottom: 28, background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 12, padding: '14px 18px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: 12, color: '#6C6553' }}>This month</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: overBudget ? RUST : nearBudget ? '#E8A94A' : '#191712', fontFamily: 'Outfit, sans-serif' }}>
                    EGP {monthSpend.toLocaleString('en-US')} / {budget.toLocaleString('en-US')}
                  </span>
                </div>
                <div style={{ height: 8, borderRadius: 999, background: '#EDE7D9', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 999, transition: 'width .3s',
                    width: `${pct}%`,
                    background: overBudget ? RUST : nearBudget ? '#E8A94A' : OLIVE,
                  }} />
                </div>
                {(overBudget || nearBudget) && (
                  <div style={{ fontSize: 11.5, marginTop: 6, color: overBudget ? RUST : '#E8A94A' }}>
                    {overBudget
                      ? `Over budget by EGP ${(monthSpend - budget).toLocaleString('en-US')}`
                      : `${Math.round(pct)}% used — approaching limit`}
                  </div>
                )}
              </div>
            )}

            {/* Budget Amount */}
            <Field label="BUDGET AMOUNT">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 13, color: '#6C6553', fontWeight: 700 }}>EGP</span>
                <input
                  type="number"
                  value={rule.amount || ''}
                  onChange={e => saveRule(selectedId!, { ...rule, amount: parseFloat(e.target.value) || 0 })}
                  placeholder="0"
                  style={{ flex: 1, background: '#FAF7EC', border: '1px solid #E8E1CE', borderRadius: 8, padding: '8px 12px', fontSize: 20, fontFamily: 'Outfit, sans-serif', fontWeight: 600, color: '#191712', outline: 'none' }}
                />
                <span style={{ fontSize: 12, color: '#9B9180' }}>
                  / {FREQ_OPTS.find(f => f.v === rule.frequency)?.label?.toLowerCase() ?? 'month'}
                </span>
              </div>
            </Field>

            {/* Category type */}
            <Field label="CATEGORY TYPE">
              <div style={{ display: 'flex', gap: 8 }}>
                {(['fixed', 'flexible'] as const).map(t => (
                  <button key={t} onClick={() => saveRule(selectedId!, { ...rule, fixedType: t })}
                    style={{
                      flex: 1, padding: '8px 0', borderRadius: 8, border: '1px solid #E8E1CE', cursor: 'pointer',
                      background: rule.fixedType === t ? '#191712' : '#FAF7EC',
                      color: rule.fixedType === t ? '#FDF8E7' : '#6C6553',
                      fontSize: 12.5, fontWeight: rule.fixedType === t ? 600 : 400,
                    }}>
                    {t === 'fixed' ? 'Fixed commitment' : 'Flexible budget'}
                  </button>
                ))}
              </div>
            </Field>

            {/* Frequency */}
            <Field label="REPEATS">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {FREQ_OPTS.map(({ v, label }) => (
                  <button key={v} onClick={() => saveRule(selectedId!, { ...rule, frequency: v })}
                    style={{
                      padding: '6px 12px', borderRadius: 999, border: '1px solid #E8E1CE', cursor: 'pointer',
                      background: rule.frequency === v ? AMBER : '#FAF7EC',
                      color: rule.frequency === v ? '#191712' : '#6C6553',
                      fontSize: 12, fontWeight: rule.frequency === v ? 600 : 400,
                    }}>
                    {label}
                  </button>
                ))}
              </div>
            </Field>

            {/* Start date */}
            <Field label="STARTS">
              <input type="month" value={rule.starts}
                onChange={e => saveRule(selectedId!, { ...rule, starts: e.target.value })}
                style={{ background: '#FAF7EC', border: '1px solid #E8E1CE', borderRadius: 8, padding: '7px 12px', fontSize: 13, color: '#191712', outline: 'none' }} />
            </Field>

            {/* Toggles */}
            <div style={{ borderTop: '1px solid #E8E1CE', paddingTop: 16, marginBottom: 8 }}>
              <Toggle on={rule.rollover} onChange={v => saveRule(selectedId!, { ...rule, rollover: v })}
                label="Roll unspent into next month" />
              <div style={{ fontSize: 11.5, color: '#9B9180', marginLeft: 46, marginTop: -4, marginBottom: 8 }}>
                Underspend carries, overspend does not
              </div>

              <Toggle on={rule.warn80} onChange={v => saveRule(selectedId!, { ...rule, warn80: v })}
                label="Warn at 80% of the envelope" />
              <div style={{ fontSize: 11.5, color: '#9B9180', marginLeft: 46, marginTop: -4, marginBottom: 8 }}>
                A quiet nudge, not a block
              </div>

              <Toggle on={rule.autoRaise} onChange={v => saveRule(selectedId!, { ...rule, autoRaise: v })}
                label="Auto-raise with inflation (+10% every Jan)" />
              <div style={{ fontSize: 11.5, color: '#9B9180', marginLeft: 46, marginTop: -4, marginBottom: 8 }}>
                {rule.autoRaise && rule.amount > 0
                  ? `Next January: EGP ${Math.round(rule.amount * 1.1).toLocaleString('en-US')}`
                  : 'Keeps pace with rising costs automatically'}
              </div>

              <Toggle on={rule.guiltFree} onChange={v => saveRule(selectedId!, { ...rule, guiltFree: v })}
                label="Count toward guilt-free spend" />
              <div style={{ fontSize: 11.5, color: '#9B9180', marginLeft: 46, marginTop: -4, marginBottom: 8 }}>
                {rule.fixedType === 'fixed' ? 'Excluded — fixed commitment' : 'Included in discretionary totals'}
              </div>
            </div>

            {/* Sub-categories */}
            {subs(selectedId!).length > 0 && (
              <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid #E8E1CE' }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.1em', color: '#9B9180', marginBottom: 12 }}>
                  SUB-CATEGORIES OF {selectedCat.name.toUpperCase()}
                </div>
                {subs(selectedId!).map(sub => {
                  const subSpend = transactions
                    .filter(tx => tx.type === 'expense' && tx.categoryId === sub.id && tx.date.startsWith(monthPrefix))
                    .reduce((s, tx) => s + Math.abs(tx.amount), 0)
                  return (
                    <div key={sub.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #F0EBDC' }}>
                      <span style={{ fontSize: 16 }}>{sub.icon}</span>
                      <span style={{ flex: 1, fontSize: 13, color: '#191712' }}>{sub.name}</span>
                      {subSpend > 0 && (
                        <span style={{ fontSize: 12, color: RUST, fontFamily: 'Outfit, sans-serif', fontWeight: 600 }}>
                          EGP {subSpend.toLocaleString('en-US')}
                        </span>
                      )}
                    </div>
                  )
                })}
                <div style={{ fontSize: 11.5, color: '#9B9180', marginTop: 8 }}>
                  Any sub can move to another parent — amounts, receipts and history move with it
                </div>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  )
}

// ── Helper ────────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.12em', color: '#9B9180', marginBottom: 7 }}>{label}</div>
      {children}
    </div>
  )
}

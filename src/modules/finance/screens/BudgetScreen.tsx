import { useState, useMemo } from 'react'
import { useFinanceStore } from '../financeStore'
import type { Category, Transaction } from '../types'

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

  // 20E — Envelope drill-down state
  const [drillOpen, setDrillOpen] = useState(false)
  const [drillPeriod, setDrillPeriod] = useState<'month' | '3months' | '6months' | 'year'>('month')
  // Decision flags: { [txId]: 'approved' | 'review' | 'excluded' }
  type TxFlag = 'approved' | 'review' | 'excluded'
  const [txFlags, setTxFlags] = useState<Record<string, TxFlag>>(() => {
    try { return JSON.parse(localStorage.getItem('finance-tx-flags') ?? '{}') } catch { return {} }
  })
  function setFlag(txId: string, flag: TxFlag | null) {
    const next = { ...txFlags }
    if (flag === null) delete next[txId]
    else next[txId] = flag
    setTxFlags(next)
    localStorage.setItem('finance-tx-flags', JSON.stringify(next))
  }
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: overBudget ? RUST : nearBudget ? '#E8A94A' : '#191712', fontFamily: 'Outfit, sans-serif' }}>
                      EGP {monthSpend.toLocaleString('en-US')} / {budget.toLocaleString('en-US')}
                    </span>
                    {monthSpend > 0 && (
                      <button
                        onClick={() => setDrillOpen(true)}
                        style={{ fontSize: 11, fontWeight: 600, color: OLIVE, background: '#E9EFD9', border: '1px solid #C8D9A8', borderRadius: 6, padding: '3px 9px', cursor: 'pointer' }}
                      >
                        View all →
                      </button>
                    )}
                  </div>
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

      {/* ─── 20E · Envelope Drill-Down Overlay ───────────────────────────────── */}
      {drillOpen && selectedCat && (() => {
        // Determine date range from drillPeriod
        const now = new Date()
        let cutoff: string
        if (drillPeriod === 'month') {
          cutoff = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2,'0')}`
        } else if (drillPeriod === '3months') {
          const d = new Date(now); d.setMonth(d.getMonth() - 2)
          cutoff = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}`
        } else if (drillPeriod === '6months') {
          const d = new Date(now); d.setMonth(d.getMonth() - 5)
          cutoff = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}`
        } else {
          const d = new Date(now); d.setMonth(d.getMonth() - 11)
          cutoff = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}`
        }
        const thisCatIds = new Set([selectedId!, ...subs(selectedId!).map(s => s.id)])
        const drillTxs = transactions
          .filter((tx: Transaction) =>
            tx.type === 'expense' &&
            tx.categoryId && thisCatIds.has(tx.categoryId) &&
            tx.date >= cutoff
          )
          .sort((a: Transaction, b: Transaction) => b.date.localeCompare(a.date))

        // Group by sub-category (or parent itself)
        const subGroups: Record<string, { cat: Category | undefined; txs: Transaction[] }> = {}
        for (const tx of drillTxs) {
          const key = tx.categoryId ?? selectedId!
          if (!subGroups[key]) {
            const cat = categories.find(c => c.id === key)
            subGroups[key] = { cat, txs: [] }
          }
          subGroups[key].txs.push(tx)
        }

        const totalSpend = drillTxs.reduce((s: number, tx: Transaction) => s + Math.abs(tx.amount), 0)
        const excludedSpend = drillTxs
          .filter((tx: Transaction) => txFlags[tx.id] === 'excluded')
          .reduce((s: number, tx: Transaction) => s + Math.abs(tx.amount), 0)
        const netSpend = totalSpend - excludedSpend

        const PERIOD_LABELS: Record<string, string> = {
          month: 'This month', '3months': 'Last 3 months',
          '6months': 'Last 6 months', year: 'This year'
        }

        const FLAG_STYLES: Record<TxFlag, { bg: string; color: string; border: string; label: string }> = {
          approved: { bg: '#E9EFD9', color: '#5F7038', border: '#C8D9A8', label: '✓ OK' },
          review:   { bg: '#FEF3C7', color: '#92400E', border: '#FCD34D', label: '⚑ Review' },
          excluded: { bg: '#FBEAE4', color: '#B4523A', border: '#E5BBAC', label: '✗ Exclude' },
        }

        return (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(25,23,18,.45)', backdropFilter: 'blur(2px)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end',
          }}
            onClick={() => setDrillOpen(false)}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                width: 520, height: '100%', background: '#F7F4EA',
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
                boxShadow: '-8px 0 40px rgba(25,23,18,.15)',
              }}
            >
              {/* Drill header */}
              <div style={{ flexShrink: 0, borderBottom: '1px solid #E8E1CE', padding: '18px 24px 14px', background: '#FCFAF4' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <span style={{ fontSize: 28 }}>{selectedCat.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: 'Outfit, sans-serif', fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', color: '#191712' }}>
                      {selectedCat.name}
                    </div>
                    <div style={{ fontSize: 11, color: '#9B9180', marginTop: 1 }}>{drillTxs.length} transactions</div>
                  </div>
                  <button onClick={() => setDrillOpen(false)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6C6553', padding: 4, display: 'flex' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  </button>
                </div>

                {/* Period selector */}
                <div style={{ display: 'flex', gap: 5 }}>
                  {(['month', '3months', '6months', 'year'] as const).map(p => (
                    <button key={p} onClick={() => setDrillPeriod(p)}
                      style={{
                        padding: '5px 11px', borderRadius: 999, border: '1px solid #E8E1CE', cursor: 'pointer',
                        background: drillPeriod === p ? '#191712' : '#FAF7EC',
                        color: drillPeriod === p ? '#FDF8E7' : '#6C6553',
                        fontSize: 11.5, fontWeight: drillPeriod === p ? 600 : 400,
                      }}
                    >{PERIOD_LABELS[p]}</button>
                  ))}
                </div>
              </div>

              {/* Sub-category summary row */}
              {Object.keys(subGroups).length > 1 && (
                <div style={{ flexShrink: 0, display: 'flex', gap: 8, padding: '12px 24px', borderBottom: '1px solid #E8E1CE', overflowX: 'auto', background: '#F7F4EA' }}>
                  {Object.entries(subGroups).map(([key, { cat, txs }]) => {
                    const total = txs.reduce((s: number, tx: Transaction) => s + Math.abs(tx.amount), 0)
                    return (
                      <div key={key} style={{ flexShrink: 0, background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 10, padding: '8px 12px', minWidth: 100 }}>
                        <div style={{ fontSize: 14, marginBottom: 3 }}>{cat?.icon ?? '📂'}</div>
                        <div style={{ fontSize: 11, color: '#6C6553', marginBottom: 3, whiteSpace: 'nowrap' }}>{cat?.name ?? selectedCat.name}</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: RUST, fontFamily: 'Outfit, sans-serif' }}>
                          EGP {total.toLocaleString('en-US')}
                        </div>
                        <div style={{ fontSize: 10, color: '#9B9180' }}>{txs.length} txns</div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Transaction list */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '8px 24px 16px' }}>
                {drillTxs.length === 0 ? (
                  <div style={{ textAlign: 'center', color: '#9B9180', padding: '48px 0', fontSize: 13 }}>
                    No transactions in this period
                  </div>
                ) : (
                  drillTxs.map((tx: Transaction) => {
                    const flag = txFlags[tx.id] as TxFlag | undefined
                    const subCat = tx.categoryId ? categories.find(c => c.id === tx.categoryId) : undefined
                    return (
                      <div key={tx.id} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '10px 0', borderBottom: '1px solid #F0EBDC',
                        opacity: flag === 'excluded' ? 0.5 : 1,
                      }}>
                        {/* Sub-cat icon */}
                        <span style={{ fontSize: 18, flexShrink: 0, width: 28, textAlign: 'center' }}>
                          {subCat?.icon ?? selectedCat.icon}
                        </span>

                        {/* Main info */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#191712', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: flag === 'excluded' ? 'line-through' : 'none' }}>
                            {tx.payee}
                          </div>
                          <div style={{ fontSize: 10.5, color: '#9B9180', marginTop: 1, display: 'flex', gap: 6 }}>
                            <span>{new Date(tx.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                            {subCat && subCat.id !== selectedId && <span>· {subCat.name}</span>}
                            {tx.note && <span>· {tx.note}</span>}
                          </div>
                        </div>

                        {/* Amount */}
                        <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 14, fontWeight: 700, color: flag === 'excluded' ? '#9B9180' : RUST, flexShrink: 0 }}>
                          EGP {Math.abs(tx.amount).toLocaleString('en-US')}
                        </span>

                        {/* Decision flags */}
                        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                          {(['approved', 'review', 'excluded'] as TxFlag[]).map(f => {
                            const s = FLAG_STYLES[f]
                            const active = flag === f
                            return (
                              <button key={f} title={f}
                                onClick={() => setFlag(tx.id, active ? null : f)}
                                style={{
                                  padding: '3px 7px', borderRadius: 6, border: `1px solid ${active ? s.border : '#E8E1CE'}`,
                                  background: active ? s.bg : 'transparent',
                                  color: active ? s.color : '#C5BCA8',
                                  fontSize: 10, fontWeight: active ? 700 : 400, cursor: 'pointer',
                                  transition: 'all 0.12s',
                                }}>
                                {s.label}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {/* Footer summary */}
              <div style={{ flexShrink: 0, borderTop: '1px solid #E8E1CE', padding: '14px 24px', background: '#FCFAF4', display: 'flex', alignItems: 'center', gap: 20 }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#9B9180' }}>TOTAL</div>
                  <div style={{ fontFamily: 'Outfit, sans-serif', fontSize: 18, fontWeight: 700, color: RUST, letterSpacing: '-0.02em' }}>
                    EGP {totalSpend.toLocaleString('en-US')}
                  </div>
                </div>
                {excludedSpend > 0 && (
                  <>
                    <div style={{ width: 1, alignSelf: 'stretch', background: '#E8E1CE' }} />
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#9B9180' }}>EXCLUDED</div>
                      <div style={{ fontFamily: 'Outfit, sans-serif', fontSize: 18, fontWeight: 700, color: '#9B9180', letterSpacing: '-0.02em' }}>
                        − EGP {excludedSpend.toLocaleString('en-US')}
                      </div>
                    </div>
                    <div style={{ width: 1, alignSelf: 'stretch', background: '#E8E1CE' }} />
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#9B9180' }}>NET</div>
                      <div style={{ fontFamily: 'Outfit, sans-serif', fontSize: 18, fontWeight: 700, color: '#191712', letterSpacing: '-0.02em' }}>
                        EGP {netSpend.toLocaleString('en-US')}
                      </div>
                    </div>
                  </>
                )}
                <span style={{ flex: 1 }} />
                <div style={{ fontSize: 11, color: '#9B9180', textAlign: 'right' }}>
                  {drillTxs.filter((tx: Transaction) => txFlags[tx.id] === 'approved').length} approved ·{' '}
                  {drillTxs.filter((tx: Transaction) => txFlags[tx.id] === 'review').length} to review ·{' '}
                  {drillTxs.filter((tx: Transaction) => txFlags[tx.id] === 'excluded').length} excluded
                </div>
              </div>
            </div>
          </div>
        )
      })()}
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

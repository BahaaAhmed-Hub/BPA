import { useState, useMemo } from 'react'
import { useFinanceStore } from '../financeStore'
import { CategoryModal } from '../modals/CategoryModal'
import {
  BudgetRuleModal, defaultRule, monthlyAmount, type BudgetRule,
} from '../modals/BudgetRuleModal'
import type { Category, Transaction } from '../types'

// ─── 16G · Budget Builder ─────────────────────────────────────────────────────
// Categories tree with budget rules: amount, frequency, roll unspent,
// warn at 80%, auto-raise with inflation, guilt-free flag

const OLIVE = '#5F7038'
const RUST  = '#B4523A'
const AMBER = '#F5D14E'

// ─── A ring that says how much of an envelope is gone ─────────────────────────
// The reference draws every category as a circle whose rim fills as it is
// spent. It reads at a glance in a way a row of bars does not: you see which
// envelopes are nearly empty without reading a single number.

function Ring({ pct, color, over, size = 58, children }: {
  pct: number; color: string; over?: boolean; size?: number; children: React.ReactNode
}) {
  const stroke = 3.5
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const filled = Math.max(0, Math.min(1, pct))
  return (
    <span style={{ position: 'relative', width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg width={size} height={size} style={{ position: 'absolute', inset: 0 }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#EDE7D9" strokeWidth={stroke} />
        {filled > 0 && (
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke={color} strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - filled)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
        {over && (
          // Past the budget the rim is full and cannot say more, so say it again
          // outside it rather than losing the fact.
          <circle cx={size / 2} cy={size / 2} r={r + 3.5} fill="none" stroke={color} strokeWidth={1} opacity={0.45} />
        )}
      </svg>
      <span style={{
        width: size - 14, height: size - 14, borderRadius: '50%', overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#FCFAF4', fontSize: 20, lineHeight: 1,
      }}>{children}</span>
    </span>
  )
}

const MONTH_SHORT = ['J','F','M','A','M','J','J','A','S','O','N','D']

function money(v: number, cur: string) {
  return `${cur} ${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}


function Legend({ swatch, label, line }: { swatch: string; label: string; line?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: '#6C6553' }}>
      <span style={{
        width: 10, height: line ? 1 : 8, borderRadius: line ? 0 : 2,
        background: swatch, flexShrink: 0,
      }} />
      {label}
    </span>
  )
}

interface EnvelopeRow {
  cat: Category
  actual: number
  planned: number
  currencies: string[]
}

function EnvelopeGroup({ title, rows, color, selectedId, onPick, currency, empty }: {
  title: string
  rows: EnvelopeRow[]
  color: string
  selectedId: string | null
  onPick: (id: string) => void
  currency: string
  empty: string
}) {
  const total = rows.reduce((s, r) => s + r.actual, 0)
  return (
    <div style={{ background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 14, boxShadow: '0 1px 3px rgba(25,23,18,0.06)', padding: '15px 18px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 14 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', color: '#6C6553' }}>{title.toUpperCase()}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 14, fontWeight: 600, color, fontVariantNumeric: 'tabular-nums' }}>
          {money(total, currency)}
        </span>
      </div>

      {rows.length === 0 ? (
        <div style={{ fontSize: 11.5, color: '#9B9180', lineHeight: 1.6 }}>{empty}</div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '18px 14px' }}>
          {rows.map(({ cat, actual, planned, currencies }) => {
            const pct  = planned > 0 ? actual / planned : (actual > 0 ? 1 : 0)
            const over = planned > 0 && actual > planned
            const on   = selectedId === cat.id
            const mixed = currencies.filter(c => c !== currency)
            return (
              <button key={cat.id} onClick={() => onPick(cat.id)}
                title={`${cat.name} — ${money(actual, currency)}${planned > 0 ? ` of ${money(planned, currency)}` : ' · no budget set'}`}
                style={{
                  width: 92, padding: '8px 2px 6px', border: 'none', borderRadius: 12,
                  background: on ? 'rgba(245,209,78,0.20)' : 'transparent',
                  fontFamily: 'inherit', cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7,
                }}>
                <span style={{ position: 'relative', display: 'flex' }}>
                  <Ring pct={pct} color={color} over={over}>
                    <span>{cat.icon}</span>
                  </Ring>
                  {mixed.length > 0 && (
                    // Amounts are added up as they were entered; there are no
                    // exchange rates in here. Say so rather than quietly
                    // presenting a total that mixes currencies.
                    <span title={`Also has transactions in ${mixed.join(', ')} — added at face value`}
                      style={{
                        position: 'absolute', bottom: -2, right: -4, height: 14, padding: '0 4px',
                        borderRadius: 999, background: '#FFFFFF', border: '1px solid #E8E1CE',
                        fontSize: 8, fontWeight: 700, color: '#9B9180', display: 'flex', alignItems: 'center',
                      }}>{mixed[0]}</span>
                  )}
                </span>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#191712', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {cat.name}
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.3 }}>
                  <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 12, fontWeight: 600, color: over ? color : '#191712', fontVariantNumeric: 'tabular-nums' }}>
                    {actual.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </span>
                  <span style={{ fontSize: 10, color: '#9B9180', fontVariantNumeric: 'tabular-nums' }}>
                    {planned > 0 ? planned.toLocaleString('en-US', { maximumFractionDigits: 0 }) : 'no budget'}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SummaryLine({ label, actual, planned, color, currency, strong }: {
  label: string; actual: number; planned: number; color: string; currency: string; strong?: boolean
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '11px 0', borderBottom: strong ? 'none' : '1px solid #F0EBDC' }}>
      <span style={{ fontSize: strong ? 12.5 : 11.5, fontWeight: strong ? 600 : 500, color: strong ? '#191712' : '#6C6553', letterSpacing: strong ? 0 : '0.02em' }}>
        {label}
      </span>
      <span style={{ flex: 1 }} />
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
        <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: strong ? 20 : 17, fontWeight: 600, letterSpacing: '-0.02em', color, fontVariantNumeric: 'tabular-nums' }}>
          {actual.toLocaleString('en-US', { maximumFractionDigits: 0 })}
        </span>
        <span style={{ fontSize: 10.5, color: '#9B9180', fontVariantNumeric: 'tabular-nums' }}>
          of {money(planned, currency)}
        </span>
      </span>
    </div>
  )
}

export function BudgetScreen(_props?: any) {
  // CategoryModal has existed, finished, since the module was written and was
  // never mounted anywhere — so there was no way to create a category at all,
  // which left this screen with nothing to configure and every transaction
  // uncategorised.
  const { categories, transactions, upsertCategory, removeCategory } = useFinanceStore()
  const year    = useFinanceStore(s => s.currentYear)
  const setYear = useFinanceStore(s => s.setYear)
  const [catModal, setCatModal] = useState<{ category: Category | null } | null>(null)

  // Which month the envelopes are about. The year lives in the store because it
  // decides what gets fetched; the month only decides what is shown.
  const [monthIdx, setMonthIdx] = useState(() => new Date().getMonth())
  const monthKey = `${year}-${String(monthIdx + 1).padStart(2, '0')}`
  const currency = (() => {
    try { return localStorage.getItem('finance-currency') || 'EGP' } catch { return 'EGP' }
  })()

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

  // Nothing selected to begin with: the point of the screen is the month as a
  // whole, and a category takes the panel only when you ask for one.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedCat = parents.find(p => p.id === selectedId) ?? null
  const rule = selectedId ? (rules[selectedId] ?? defaultRule()) : null

  // Monthly spend for selected category (current month)

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
  // ── The year, month by month ───────────────────────────────────────────────
  // Income above the line, spending below it, and the balance those two leave
  // behind running across the top. One picture answers "how is the year going"
  // before any envelope is read.
  const months = useMemo(() => {
    const out = Array.from({ length: 12 }, (_, m) => {
      const prefix = `${year}-${String(m + 1).padStart(2, '0')}`
      let income = 0, expense = 0
      for (const tx of transactions) {
        if (!tx.date.startsWith(prefix)) continue
        if (tx.type === 'income')  income  += Math.abs(tx.amount)
        if (tx.type === 'expense') expense += Math.abs(tx.amount)
      }
      return { m, income, expense, balance: 0 }
    })
    let running = 0
    for (const row of out) { running += row.income - row.expense; row.balance = running }
    return out
  }, [transactions, year])

  const peak = Math.max(1, ...months.map(x => Math.max(x.income, x.expense)))
  const balances = months.map(x => x.balance)
  const balLo = Math.min(0, ...balances)
  const balHi = Math.max(1, ...balances)

  // ── This month's envelopes ─────────────────────────────────────────────────
  // A category's own transactions plus its children's — money filed under
  // "Groceries · Fruit" is money out of the Groceries envelope.
  const envelopes = useMemo(() => {
    const build = (cat: Category) => {
      const ids = new Set([cat.id, ...categories.filter(c => c.parentId === cat.id).map(c => c.id)])
      const wanted = cat.txType === 'income' ? 'income' : 'expense'
      let actual = 0
      const currencies = new Set<string>()
      for (const tx of transactions) {
        if (!tx.categoryId || !ids.has(tx.categoryId)) continue
        if (tx.type !== wanted) continue
        if (!tx.date.startsWith(monthKey)) continue
        actual += Math.abs(tx.amount)
        currencies.add(tx.currency)
      }
      // Not rules[cat.id].amount: a yearly budget of 12,000 is 1,000 against a
      // month's spending, and comparing it raw made every non-monthly envelope
      // look untouched.
      const planned = monthlyAmount(rules[cat.id])
      return { cat, actual, planned, currencies: [...currencies] }
    }
    const all = parents.map(build)
    return {
      spending: all.filter(e => e.cat.txType !== 'income'),
      earning:  all.filter(e => e.cat.txType === 'income'),
    }
  }, [parents, categories, transactions, rules, monthKey])

  const sum = (rows: { actual: number; planned: number }[]) => ({
    actual:  rows.reduce((s, r) => s + r.actual, 0),
    planned: rows.reduce((s, r) => s + r.planned, 0),
  })
  const outTotal = sum(envelopes.spending)
  const inTotal  = sum(envelopes.earning)

  function stepMonth(by: number) {
    const d = new Date(year, monthIdx + by, 1)
    setMonthIdx(d.getMonth())
    if (d.getFullYear() !== year) void setYear(d.getFullYear())
  }

  const HEAD_PILL: React.CSSProperties = {
    height: 32, padding: '0 12px', borderRadius: 999, border: '1px solid #E8E1CE',
    background: '#FFFFFF', fontFamily: 'inherit', fontSize: 12.5, color: '#191712',
    display: 'flex', alignItems: 'center', cursor: 'pointer',
  }
  const CARD: React.CSSProperties = {
    background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 14,
    boxShadow: '0 1px 3px rgba(25,23,18,0.06)',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#F7F4EA' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ flexShrink: 0, borderBottom: '1px solid #E8E1CE', padding: '14px 26px 14px', display: 'flex', alignItems: 'flex-end', gap: 18 }}>
        <div style={{ minWidth: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', color: '#6C6553', display: 'block', marginBottom: 4 }}>MONEY · BUDGET</span>
          <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 30, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1, color: '#191712', display: 'block' }}>
            {money(months[11]?.balance ?? 0, currency)}
          </span>
          <span style={{ fontSize: 12, color: '#6C6553', display: 'block', marginTop: 3 }}>
            what {year} leaves behind · {parents.length} categor{parents.length === 1 ? 'y' : 'ies'}
          </span>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 3 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: 3, borderRadius: 999, background: '#EDE7D9' }}>
            <button onClick={() => stepMonth(-1)} title="Previous month"
              style={{ ...HEAD_PILL, width: 28, padding: 0, justifyContent: 'center', border: 'none', background: 'transparent', color: '#6C6553' }}>‹</button>
            <span style={{ ...HEAD_PILL, cursor: 'default', boxShadow: '0 1px 3px rgba(25,23,18,0.16)', fontWeight: 600, minWidth: 106, justifyContent: 'center' }}>
              {new Date(year, monthIdx, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
            </span>
            <button onClick={() => stepMonth(1)} title="Next month"
              style={{ ...HEAD_PILL, width: 28, padding: 0, justifyContent: 'center', border: 'none', background: 'transparent', color: '#6C6553' }}>›</button>
          </div>
          <button onClick={() => setCatModal({ category: null })} title="Add a category"
            style={{ height: 34, padding: '0 15px', borderRadius: 999, background: AMBER, border: 'none', color: '#191712', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 2px 0 rgba(25,23,18,0.14)' }}>
            + Category
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '18px 26px 26px' }}>

        {/* ── The year ─────────────────────────────────────────────────────── */}
        <div style={{ ...CARD, padding: '16px 18px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', color: '#6C6553' }}>{year}</span>
            <span style={{ flex: 1 }} />
            <Legend swatch={OLIVE} label="In" />
            <Legend swatch={RUST}  label="Out" />
            <Legend swatch="#C5BCA8" label="Balance" line />
          </div>

          <div style={{ position: 'relative', display: 'flex', alignItems: 'stretch', gap: 6, height: 168 }}>
            {/* The balance, drawn over the columns it comes from */}
            <svg viewBox="0 0 120 100" preserveAspectRatio="none"
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 2 }}>
              <polyline
                points={months.map((x, i) =>
                  `${i * 10 + 5},${100 - ((x.balance - balLo) / (balHi - balLo || 1)) * 88 - 6}`).join(' ')}
                fill="none" stroke="#9B9180" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round"
                vectorEffect="non-scaling-stroke" />
            </svg>

            {months.map(x => {
              const on = x.m === monthIdx
              const up   = (x.income  / peak) * 56
              const down = (x.expense / peak) * 56
              return (
                <button key={x.m} onClick={() => setMonthIdx(x.m)}
                  title={`${new Date(year, x.m, 1).toLocaleDateString('en-GB', { month: 'long' })} · in ${money(x.income, currency)} · out ${money(x.expense, currency)}`}
                  style={{
                    flex: 1, minWidth: 0, padding: 0, border: 'none', cursor: 'pointer',
                    background: on ? 'rgba(245,209,78,0.20)' : '#FAF7EC',
                    borderRadius: 8, position: 'relative', display: 'flex', flexDirection: 'column',
                    justifyContent: 'flex-end', overflow: 'hidden',
                  }}>
                  {/* Income grows up from the middle, spending down from it */}
                  <span style={{ position: 'absolute', left: 0, right: 0, bottom: '50%', height: up, background: OLIVE, opacity: 0.9 }} />
                  <span style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: down, background: RUST, opacity: 0.9 }} />
                  <span style={{ position: 'absolute', left: 0, right: 0, top: '50%', borderTop: '1px solid #E4DCC6' }} />
                  <span style={{
                    position: 'relative', padding: '0 0 5px', fontSize: 9.5,
                    color: on ? '#191712' : '#9B9180', fontWeight: on ? 700 : 500,
                  }}>{MONTH_SHORT[x.m]}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Envelopes, and whatever is open beside them ───────────────────── */}
        <div style={{ display: 'flex', gap: 16, marginTop: 16, alignItems: 'flex-start' }}>

          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <EnvelopeGroup
              title="Spending" rows={envelopes.spending} color={RUST}
              selectedId={selectedId} onPick={setSelectedId} currency={currency}
              empty="No spending categories yet — add one and its envelope appears here." />
            <EnvelopeGroup
              title="Earning" rows={envelopes.earning} color={OLIVE}
              selectedId={selectedId} onPick={setSelectedId} currency={currency}
              empty="No income categories yet." />
          </div>

          <div style={{ width: 340, flexShrink: 0, ...CARD, padding: '18px 20px 20px', alignSelf: 'stretch' }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', color: '#6C6553', marginBottom: 14 }}>
              {new Date(year, monthIdx, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }).toUpperCase()}
            </div>
            <SummaryLine label="Expenses" actual={outTotal.actual} planned={outTotal.planned} color={RUST}  currency={currency} />
            <SummaryLine label="Income"   actual={inTotal.actual}  planned={inTotal.planned}  color={OLIVE} currency={currency} />
            <div style={{ height: 1, background: '#E8E1CE', margin: '4px 0 0' }} />
            <SummaryLine
              label="Left over"
              actual={inTotal.actual - outTotal.actual}
              planned={inTotal.planned - outTotal.planned}
              color={inTotal.actual - outTotal.actual < 0 ? RUST : '#191712'}
              currency={currency} strong />
            <div style={{ fontSize: 11.5, color: '#9B9180', marginTop: 14, lineHeight: 1.55 }}>
              The bold figure is what actually happened this month; the one under it
              is what the envelopes were set to. Pick a category to change its budget.
            </div>
          </div>
        </div>
      </div>


      {/* ─── 20E · Envelope Drill-Down Overlay ───────────────────────────────── */}
      {selectedCat && (
        <BudgetRuleModal
          category={selectedCat}
          rule={rule ?? defaultRule()}
          subs={subs(selectedCat.id)}
          transactions={transactions}
          monthKey={monthKey}
          currency={currency}
          onChange={r => saveRule(selectedCat.id, r)}
          onRename={patch => void upsertCategory({ ...selectedCat, ...patch })}
          onEditCategory={() => setCatModal({ category: selectedCat })}
          onAddSub={() => setCatModal({ category: { id: '', name: '', icon: '📁', color: '#8C8071', parentId: selectedCat.id, isSystem: false, txType: selectedCat.txType } })}
          onEditSub={sub => setCatModal({ category: sub })}
          onDrill={() => setDrillOpen(true)}
          onClose={() => setSelectedId(null)}
        />
      )}

      {catModal && (
        <CategoryModal
          category={catModal.category}
          categories={categories}
          onSave={c => { void upsertCategory(c); setSelectedId(prev => prev ?? c.id); setCatModal(null) }}
          onDelete={id => {
            void removeCategory(id)
            if (selectedId === id) setSelectedId(null)
            setCatModal(null)
          }}
          onClose={() => setCatModal(null)}
        />
      )}

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


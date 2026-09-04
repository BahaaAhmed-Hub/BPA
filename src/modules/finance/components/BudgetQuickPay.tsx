import { useState, useMemo, useEffect } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useFinanceStore } from '../financeStore'
import { CategoryGlyph } from '../components/CategoryGlyph'
import { TransactionModal } from '../modals/TransactionModal'
import { monthlyAmount, activeIn, type BudgetRule } from '../modals/BudgetRuleModal'
import { toBase, baseCurrency } from '../fx'
import type { Category } from '../types'

// ─── Paying an envelope from wherever you are ────────────────────────────────
// Adding a transaction meant opening the form and telling it which category
// this was, every time — while the budget it comes out of was on a different
// screen entirely. This puts the envelopes where the money is being looked at,
// and Pay opens the form already knowing the category, the kind of money and
// the account.

const OLIVE = '#5F7038'
const RUST  = '#B4523A'
const AMBER = '#F5D14E'
const LINE  = '#E8E1CE'
const INK   = '#191712'
const MUTED = '#6C6553'
const GHOST = '#9B9180'

const OPEN_KEY = 'finance-quickpay-open'

interface Envelope {
  cat: Category
  spent: number
  planned: number
}

export function BudgetQuickPay({ compact = false }: { compact?: boolean }) {
  const { categories, transactions, accounts, upsertTransaction } = useFinanceStore()
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(OPEN_KEY) !== 'false' } catch { return true }
  })
  const [payFor, setPayFor] = useState<Category | null>(null)
  const [fxTick, setFxTick] = useState(0)

  useEffect(() => {
    const h = () => setFxTick(n => n + 1)
    window.addEventListener('professor:fxRatesChanged', h)
    return () => window.removeEventListener('professor:fxRatesChanged', h)
  }, [])

  function toggle() {
    setOpen(o => {
      try { localStorage.setItem(OPEN_KEY, String(!o)) } catch { /* quota */ }
      return !o
    })
  }

  const base = baseCurrency()
  const now = new Date()
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const rules: Record<string, BudgetRule> = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('finance-budget-rules') ?? '{}') } catch { return {} }
  }, [])

  const envelopes = useMemo<Envelope[]>(() => {
    const build = (cat: Category): Envelope => {
      const ids = new Set([cat.id, ...categories.filter(c => c.parentId === cat.id).map(c => c.id)])
      const wanted = cat.txType === 'income' ? 'income' : 'expense'
      let spent = 0
      for (const tx of transactions) {
        if (!tx.categoryId || !ids.has(tx.categoryId)) continue
        if (tx.type !== wanted || !tx.date.startsWith(monthKey)) continue
        spent += toBase(Math.abs(tx.amount), tx.currency, base) ?? 0
      }
      const own = activeIn(rules[cat.id], monthKey) ? monthlyAmount(rules[cat.id]) : 0
      const parts = categories.filter(c => c.parentId === cat.id)
        .reduce((n, c) => n + (activeIn(rules[c.id], monthKey) ? monthlyAmount(rules[c.id]) : 0), 0)
      return { cat, spent, planned: own > 0 ? own : parts }
    }
    return categories.filter(c => !c.parentId).map(build)
      // What is budgeted comes first: an envelope with a limit is the one you
      // are deciding against. The rest are still here, just not in the way.
      .sort((a, b) => (b.planned > 0 ? 1 : 0) - (a.planned > 0 ? 1 : 0))
  }, [categories, transactions, rules, monthKey, base, fxTick])

  if (envelopes.length === 0) return null

  const shown = compact && !open ? [] : envelopes
  const budgetedTotal = envelopes.reduce((s, e) => s + e.planned, 0)
  const spentTotal    = envelopes.filter(e => e.cat.txType !== 'income').reduce((s, e) => s + e.spent, 0)
  const fmt = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 0 })

  return (
    <div style={{
      background: '#FFFFFF', border: `1px solid ${LINE}`, borderRadius: 14,
      boxShadow: '0 1px 3px rgba(25,23,18,0.06)', overflow: 'hidden',
    }}>
      <button onClick={toggle}
        title={open ? 'Fold the envelopes away' : 'Show the envelopes'}
        style={{
          display: 'flex', alignItems: 'center', gap: 9, width: '100%',
          padding: '13px 16px', background: 'none', border: 'none', cursor: 'pointer',
          fontFamily: 'inherit', textAlign: 'left',
        }}>
        {open ? <ChevronDown size={14} strokeWidth={2.2} color={GHOST} /> : <ChevronRight size={14} strokeWidth={2.2} color={GHOST} />}
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', color: MUTED }}>BUDGETS</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, color: GHOST }}>
          {budgetedTotal > 0
            ? `${base} ${fmt(spentTotal)} of ${fmt(budgetedTotal)} this month`
            : 'nothing budgeted yet'}
        </span>
      </button>

      {open && (
        <div style={{ borderTop: `1px solid ${LINE}` }}>
          {shown.map(({ cat, spent, planned }) => {
            const income = cat.txType === 'income'
            const tone = income ? OLIVE : RUST
            const pct  = planned > 0 ? Math.min(1, spent / planned) : 0
            const over = planned > 0 && spent > planned
            return (
              <div key={cat.id} style={{
                display: 'flex', alignItems: 'center', gap: 11,
                padding: '10px 16px', borderBottom: `1px solid #F5F1E6`,
              }}>
                <span style={{ display: 'flex', color: tone, flexShrink: 0 }}>
                  <CategoryGlyph icon={cat.icon} size={17} />
                </span>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 500, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {cat.name || 'Untitled'}
                  </div>
                  {planned > 0 ? (
                    <>
                      <div style={{ height: 4, borderRadius: 999, background: '#EDE7D9', marginTop: 5, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct * 100}%`, background: tone, borderRadius: 999 }} />
                      </div>
                      <div style={{ fontSize: 10.5, color: over ? tone : GHOST, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
                        {fmt(spent)} of {fmt(planned)}
                        {over && ` · over by ${fmt(spent - planned)}`}
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: 10.5, color: GHOST, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
                      {fmt(spent)} this month · no budget
                    </div>
                  )}
                </div>

                <button
                  onClick={() => setPayFor(cat)}
                  title={income ? `Record money in under ${cat.name}` : `Record a payment out of ${cat.name}`}
                  style={{
                    flexShrink: 0, height: 28, padding: '0 13px', borderRadius: 999,
                    background: income ? '#E9EFD9' : AMBER,
                    border: income ? '1px solid #C8D9A8' : 'none',
                    color: income ? OLIVE : INK,
                    fontFamily: 'inherit', fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
                  }}>
                  {income ? 'Receive' : 'Pay'}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {payFor && (
        <TransactionModal
          transaction={null}
          // Everything it can already know: which category, and which kind of
          // money. What is left to type is the amount and who it went to.
          initial={{ categoryId: payFor.id, type: payFor.txType === 'income' ? 'income' : 'expense' }}
          accounts={accounts}
          categories={categories}
          history={transactions}
          onSave={tx => { void upsertTransaction(tx); setPayFor(null) }}
          onClose={() => setPayFor(null)}
        />
      )}
    </div>
  )
}

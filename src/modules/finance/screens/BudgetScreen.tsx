import { useState } from 'react'
import { useUIStore } from '@/store/uiStore'
import { getTheme } from '@/lib/themes'
import { useFinanceStore } from '../financeStore'
import { CategoryModal } from '../modals/CategoryModal'
import { TransactionModal } from '../modals/TransactionModal'
import type { Category, Transaction, Budget, Currency } from '../types'

const RED   = '#DA4A3E'
const GREEN = '#2FA869'

// ─── Month helpers ────────────────────────────────────────────────────────────

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

function parseMonth(ym: string): { year: number; month: number } {
  const [y, m] = ym.split('-').map(Number)
  return { year: y, month: m }
}

function formatMonthLabel(ym: string): string {
  const { year, month } = parseMonth(ym)
  return `${MONTH_NAMES[month - 1].slice(0, 3)} ${year}`
}

function addMonth(ym: string, delta: number): string {
  const { year, month } = parseMonth(ym)
  const d = new Date(year, month - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// ─── Section label row ────────────────────────────────────────────────────────

function SectionRow({ label, main, mainColor, sub, borderColor, textDim }: {
  label: string; main: string; mainColor: string; sub: string; borderColor: string; textDim: string
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      marginBottom: 16,
    }}>
      <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.8px', color: borderColor }}>
        {label}
      </span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: mainColor }}>{main}</span>
        <span style={{ fontSize: 14, color: textDim }}>{sub}</span>
      </div>
    </div>
  )
}

// ─── Budget Screen ────────────────────────────────────────────────────────────

export function BudgetScreen() {
  const themeId = useUIStore(s => s.themeId)
  const theme = getTheme(themeId)

  const {
    categories, transactions, accounts, budgets,
    upsertCategory, removeCategory,
    upsertBudget, removeBudget,
    upsertTransaction,
  } = useFinanceStore()

  const [reportMode, setReportMode] = useState<'actual' | 'remaining'>('actual')
  const [currentMonth, setCurrentMonth] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [selectedCatId, setSelectedCatId] = useState<string | null>(null)
  const [rightMode, setRightMode] = useState<'txns' | 'budget'>('txns')
  const [catModal, setCatModal] = useState<{ open: boolean; category: Category | null }>({ open: false, category: null })
  const [txModal, setTxModal] = useState<{ open: boolean; tx: Transaction | null }>({ open: false, tx: null })
  const [budgetEdit, setBudgetEdit] = useState<{
    monthlyAmount: string; currency: Currency; startDate: string; endDate: string; rollover: boolean
  }>({ monthlyAmount: '', currency: 'EGP', startDate: currentMonth, endDate: '', rollover: false })
  const [hoveredCatId, setHoveredCatId] = useState<string | null>(null)

  // ─── Computed helpers ─────────────────────────────────────────────────────

  const topExpenseCats = categories.filter(c => !c.parentId && (c.txType === 'expense' || c.txType === 'both'))
  const topIncomeCats  = categories.filter(c => !c.parentId && (c.txType === 'income'  || c.txType === 'both'))

  // Transactions in current month
  const monthTxns = transactions.filter(tx => tx.date.startsWith(currentMonth))

  function actualByCat(catId: string): number {
    return monthTxns
      .filter(tx => tx.categoryId === catId)
      .reduce((sum, tx) => sum + Math.abs(tx.amount), 0)
  }

  function budgetForCat(catId: string): number {
    const b = budgets.find(b => b.categoryId === catId)
    return b ? b.monthlyAmount : 0
  }

  function budgetObjForCat(catId: string): Budget | undefined {
    return budgets.find(b => b.categoryId === catId)
  }

  const totalExpenseActual = topExpenseCats.reduce((s, c) => s + actualByCat(c.id), 0)
  const totalExpenseBudget = topExpenseCats.reduce((s, c) => s + budgetForCat(c.id), 0)
  const totalIncomeActual  = topIncomeCats.reduce((s, c) => s + actualByCat(c.id), 0)
  const totalIncomeBudget  = topIncomeCats.reduce((s, c) => s + budgetForCat(c.id), 0)

  function fmt(n: number) {
    return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  }

  // ─── Right panel budget edit init ────────────────────────────────────────

  function openBudgetMode(catId: string) {
    const existing = budgetObjForCat(catId)
    setBudgetEdit({
      monthlyAmount: existing ? String(existing.monthlyAmount) : '',
      currency:      existing?.currency ?? 'EGP',
      startDate:     existing?.startDate ?? currentMonth,
      endDate:       existing?.endDate ?? '',
      rollover:      existing?.rollover ?? false,
    })
    setRightMode('budget')
  }

  function saveBudget() {
    if (!selectedCatId) return
    const existing = budgetObjForCat(selectedCatId)
    const b: Budget = {
      id:            existing?.id ?? crypto.randomUUID(),
      categoryId:    selectedCatId,
      monthlyAmount: parseFloat(budgetEdit.monthlyAmount) || 0,
      currency:      budgetEdit.currency,
      startDate:     budgetEdit.startDate || currentMonth,
      endDate:       budgetEdit.endDate || undefined,
      rollover:      budgetEdit.rollover,
    }
    upsertBudget(b)
    setRightMode('txns')
  }

  const selectedCat = selectedCatId ? categories.find(c => c.id === selectedCatId) : null
  const catTxns = selectedCatId
    ? monthTxns.filter(tx => tx.categoryId === selectedCatId)
    : []

  // ─── Timeline data (decorative, from actual month txns) ──────────────────

  const daysInMonth = new Date(
    parseInt(currentMonth.slice(0, 4)),
    parseInt(currentMonth.slice(5, 7)),
    0,
  ).getDate()

  const timelineData: number[] = Array.from({ length: daysInMonth }, (_, i) => {
    const dayStr = `${currentMonth}-${String(i + 1).padStart(2, '0')}`
    const dayTxns = monthTxns.filter(tx => tx.date === dayStr)
    const income = dayTxns.filter(tx => tx.type === 'income').reduce((s, t) => s + t.amount, 0)
    const expense = dayTxns.filter(tx => tx.type === 'expense').reduce((s, t) => s + t.amount, 0)
    return income > 0 ? income : expense > 0 ? -expense : 0
  })

  const maxAbs = Math.max(...timelineData.map(Math.abs), 1)

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flex: 1, height: '100%', overflow: 'hidden', background: theme.bg }}>

      {/* ── LEFT PANEL ── */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>

        {/* Header */}
        <div style={{
          height: 64, flexShrink: 0,
          borderBottom: `1px solid ${theme.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 24px',
        }}>
          {/* Left: Edit + gear */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13, color: theme.textDim, cursor: 'pointer' }}>Edit</span>
            <button
              onClick={() => setCatModal({ open: true, category: null })}
              title="Add Category"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 16, color: theme.textDim, padding: '2px 4px',
                fontFamily: 'inherit', lineHeight: 1,
              }}
            >⚙</button>
          </div>

          {/* Center: month nav */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={() => setCurrentMonth(addMonth(currentMonth, -1))}
              style={{ background: 'none', border: 'none', color: theme.textDim, fontSize: 20, cursor: 'pointer', fontFamily: 'inherit', padding: '2px 6px', lineHeight: 1 }}
            >‹</button>
            <span style={{ fontSize: 18, fontWeight: 600, color: theme.text, minWidth: 90, textAlign: 'center' }}>
              {formatMonthLabel(currentMonth)}
            </span>
            <button
              onClick={() => setCurrentMonth(addMonth(currentMonth, 1))}
              style={{ background: 'none', border: 'none', color: theme.textDim, fontSize: 20, cursor: 'pointer', fontFamily: 'inherit', padding: '2px 6px', lineHeight: 1 }}
            >›</button>
          </div>

          {/* Right: toggle */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setReportMode('actual')}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 12, fontWeight: 600,
                color: reportMode === 'actual' ? theme.accent : theme.textMuted,
              }}
            >Actual / Budget</button>
            <button
              onClick={() => setReportMode('remaining')}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 12, fontWeight: 600,
                color: reportMode === 'remaining' ? theme.accent : theme.textMuted,
              }}
            >Remaining</button>
          </div>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

          {/* Timeline bars */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 12, color: theme.textDim, marginBottom: 8 }}>
              EGP {fmt(totalExpenseActual)}
            </div>
            <div style={{ display: 'flex', alignItems: 'stretch', gap: 3, height: 120 }}>
              {timelineData.map((v, i) => {
                const h = v === 0 ? 0 : Math.max(Math.round(Math.abs(v) / maxAbs * 55), 3)
                return (
                  <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <div style={{ height: 58, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                      {v > 0 && (
                        <div style={{
                          height: h, maxWidth: 16, width: '100%',
                          background: GREEN, borderRadius: '3px 3px 0 0', margin: '0 auto',
                        }} />
                      )}
                    </div>
                    <div style={{ height: 1, background: theme.border, flexShrink: 0 }} />
                    <div style={{ height: 58, display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
                      {v < 0 && (
                        <div style={{
                          height: h, maxWidth: 16, width: '100%',
                          background: RED, borderRadius: '0 0 3px 3px', margin: '0 auto',
                        }} />
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Expenses */}
          <div style={{ marginBottom: 28 }}>
            <SectionRow
              label="Expenses"
              main={fmt(totalExpenseActual)}
              mainColor={RED}
              sub={`/ EGP ${fmt(totalExpenseBudget)}`}
              borderColor={theme.textDim}
              textDim={theme.textMuted}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 8px' }}>
              {topExpenseCats.map(cat => {
                const actual = actualByCat(cat.id)
                const budget = budgetForCat(cat.id)
                const over = actual > budget && budget > 0
                const ringColor = over ? RED : theme.border
                const isSelected = selectedCatId === cat.id
                return (
                  <div
                    key={cat.id}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', width: 72, position: 'relative' }}
                    onMouseEnter={() => setHoveredCatId(cat.id)}
                    onMouseLeave={() => setHoveredCatId(null)}
                  >
                    <div
                      onClick={() => { setSelectedCatId(cat.id); setRightMode('txns') }}
                      style={{
                        width: 64, height: 64, borderRadius: '50%',
                        border: `2.5px solid ${isSelected ? theme.accent : ringColor}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 26, background: theme.surface, cursor: 'pointer',
                        transition: 'border-color 0.15s',
                      }}
                    >
                      {cat.icon}
                    </div>
                    {hoveredCatId === cat.id && (
                      <button
                        onClick={e => { e.stopPropagation(); setCatModal({ open: true, category: cat }) }}
                        style={{
                          position: 'absolute', top: -4, right: 2,
                          background: theme.surface, border: `1px solid ${theme.border}`,
                          borderRadius: '50%', width: 18, height: 18,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          cursor: 'pointer', fontSize: 10, color: theme.textDim, lineHeight: 1,
                        }}
                      >✏</button>
                    )}
                    <div style={{ fontSize: 11, color: theme.text, marginTop: 8, lineHeight: 1.2 }}>{cat.name}</div>
                    <div style={{ fontSize: 12, color: over ? RED : theme.textDim, marginTop: 2 }}>{fmt(actual)}</div>
                    <div style={{ fontSize: 11, color: theme.textMuted, marginTop: 1 }}>{fmt(budget)}</div>
                  </div>
                )
              })}
              {/* + Add button */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', paddingTop: 12 }}>
                <button
                  onClick={() => setCatModal({ open: true, category: null })}
                  style={{
                    width: 40, height: 40, borderRadius: '50%',
                    border: `2px dashed ${theme.border}`,
                    background: 'none', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: theme.textDim, fontSize: 20, lineHeight: 1,
                  }}
                >+</button>
              </div>
            </div>
          </div>

          {/* Income */}
          <div style={{ marginBottom: 28 }}>
            <SectionRow
              label="Income"
              main={fmt(totalIncomeActual)}
              mainColor={GREEN}
              sub={`/ EGP ${fmt(totalIncomeBudget)}`}
              borderColor={theme.textDim}
              textDim={theme.textMuted}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 8px' }}>
              {topIncomeCats.map(cat => {
                const actual = actualByCat(cat.id)
                const budget = budgetForCat(cat.id)
                const ringColor = GREEN
                const isSelected = selectedCatId === cat.id
                return (
                  <div
                    key={cat.id}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', width: 72, position: 'relative' }}
                    onMouseEnter={() => setHoveredCatId(cat.id)}
                    onMouseLeave={() => setHoveredCatId(null)}
                  >
                    <div
                      onClick={() => { setSelectedCatId(cat.id); setRightMode('txns') }}
                      style={{
                        width: 64, height: 64, borderRadius: '50%',
                        border: `2.5px solid ${isSelected ? theme.accent : ringColor}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 26, background: theme.surface, cursor: 'pointer',
                        transition: 'border-color 0.15s',
                      }}
                    >
                      {cat.icon}
                    </div>
                    {hoveredCatId === cat.id && (
                      <button
                        onClick={e => { e.stopPropagation(); setCatModal({ open: true, category: cat }) }}
                        style={{
                          position: 'absolute', top: -4, right: 2,
                          background: theme.surface, border: `1px solid ${theme.border}`,
                          borderRadius: '50%', width: 18, height: 18,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          cursor: 'pointer', fontSize: 10, color: theme.textDim, lineHeight: 1,
                        }}
                      >✏</button>
                    )}
                    <div style={{ fontSize: 11, color: theme.text, marginTop: 8, lineHeight: 1.2 }}>{cat.name}</div>
                    <div style={{ fontSize: 12, color: GREEN, marginTop: 2 }}>{fmt(actual)}</div>
                    <div style={{ fontSize: 11, color: theme.textMuted, marginTop: 1 }}>{fmt(budget)}</div>
                  </div>
                )
              })}
              {/* + Add button */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', paddingTop: 12 }}>
                <button
                  onClick={() => setCatModal({ open: true, category: null })}
                  style={{
                    width: 40, height: 40, borderRadius: '50%',
                    border: `2px dashed ${theme.border}`,
                    background: 'none', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: theme.textDim, fontSize: 20, lineHeight: 1,
                  }}
                >+</button>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* ── RIGHT PANEL ── */}
      {selectedCatId && selectedCat && (
        <div style={{
          width: 340, flexShrink: 0,
          borderLeft: `1px solid ${theme.border}`,
          display: 'flex', flexDirection: 'column',
          background: theme.surface,
          overflow: 'hidden',
        }}>

          {rightMode === 'txns' ? (
            <>
              {/* Txns header */}
              <div style={{
                height: 56, flexShrink: 0, borderBottom: `1px solid ${theme.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '0 16px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    onClick={() => setSelectedCatId(null)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.textDim, fontSize: 18, lineHeight: 1, padding: 2 }}
                  >‹</button>
                  <span style={{ fontSize: 15, fontWeight: 600, color: theme.text }}>
                    {selectedCat.icon} {selectedCat.name}
                  </span>
                </div>
                <button
                  onClick={() => setTxModal({ open: true, tx: null })}
                  style={{
                    background: theme.accentFill, border: `1px solid ${theme.accent}44`,
                    borderRadius: 8, padding: '5px 12px', cursor: 'pointer',
                    fontSize: 13, color: theme.accent, fontFamily: 'inherit', fontWeight: 600,
                  }}
                >+ Add</button>
              </div>

              {/* Transaction list */}
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {catTxns.length === 0 ? (
                  <div style={{ padding: 24, textAlign: 'center', color: theme.textMuted, fontSize: 13 }}>
                    No transactions this month
                  </div>
                ) : catTxns.map(tx => {
                  const acct = accounts.find(a => a.id === tx.accountId)
                  const isExp = tx.type === 'expense'
                  return (
                    <div
                      key={tx.id}
                      onClick={() => setTxModal({ open: true, tx })}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '10px 16px', borderBottom: `1px solid ${theme.border}`,
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{
                        width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
                        background: acct ? `${acct.color}22` : theme.bg,
                        border: `1px solid ${acct ? acct.color + '44' : theme.border}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 16,
                      }}>
                        {acct?.emoji ?? '🏦'}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, color: theme.text, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {tx.payee || 'Unnamed'}
                        </div>
                        <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 2 }}>{tx.date}</div>
                      </div>
                      <span style={{
                        fontSize: 13, fontWeight: 700,
                        color: isExp ? RED : GREEN,
                        background: isExp ? `${RED}18` : `${GREEN}18`,
                        borderRadius: 20, padding: '3px 8px', flexShrink: 0,
                      }}>
                        {isExp ? '-' : '+'}{tx.currency} {Math.abs(tx.amount).toLocaleString()}
                      </span>
                    </div>
                  )
                })}
              </div>

              {/* Footer */}
              <div style={{ borderTop: `1px solid ${theme.border}`, padding: '12px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 10 }}>
                  <span style={{ fontSize: 18, fontWeight: 700, color: RED }}>
                    {fmt(actualByCat(selectedCatId))}
                  </span>
                  <span style={{ fontSize: 13, color: theme.textMuted }}>
                    / EGP {fmt(budgetForCat(selectedCatId))}
                  </span>
                </div>
                <button
                  onClick={() => openBudgetMode(selectedCatId)}
                  style={{
                    width: '100%', padding: '10px 0',
                    background: theme.surface2 ?? theme.bg, border: `1px solid ${theme.border}`,
                    borderRadius: 10, cursor: 'pointer',
                    fontSize: 14, fontWeight: 600, color: theme.text,
                    fontFamily: 'inherit', marginBottom: 8,
                  }}
                >Budget</button>
                <div style={{ textAlign: 'center' }}>
                  <span style={{ fontSize: 12, color: theme.accent, cursor: 'pointer' }}>
                    Show all transactions
                  </span>
                </div>
              </div>
            </>
          ) : (
            /* Budget editor mode */
            <>
              {/* Budget header */}
              <div style={{
                height: 56, flexShrink: 0, borderBottom: `1px solid ${theme.border}`,
                display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center',
                padding: '0 16px',
              }}>
                <button
                  onClick={() => setRightMode('txns')}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.textDim, fontSize: 14, textAlign: 'left', fontFamily: 'inherit', padding: 0 }}
                >Cancel</button>
                <span style={{ fontSize: 15, fontWeight: 700, color: theme.text }}>Budget</span>
                <button
                  onClick={saveBudget}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.accent, fontSize: 14, fontWeight: 700, textAlign: 'right', fontFamily: 'inherit', padding: 0 }}
                >Save</button>
              </div>

              {/* Budget body */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>

                {/* Category name row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: '50%',
                    background: `${selectedCat.color}22`, border: `2px solid ${selectedCat.color}44`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
                  }}>
                    {selectedCat.icon}
                  </div>
                  <input
                    defaultValue={selectedCat.name}
                    onBlur={e => {
                      const newName = e.target.value.trim()
                      if (newName && newName !== selectedCat.name) {
                        upsertCategory({ ...selectedCat, name: newName })
                      }
                    }}
                    style={{
                      flex: 1, background: 'transparent', border: 'none',
                      borderBottom: `1px solid ${theme.border}`, outline: 'none',
                      color: theme.text, fontSize: 16, fontWeight: 600,
                      fontFamily: 'inherit', padding: '4px 0',
                    }}
                  />
                </div>

                {/* Monthly amount */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: `1px solid ${theme.border}` }}>
                  <span style={{ fontSize: 14, color: theme.text }}>Every Month</span>
                  <input
                    type="number"
                    min={0}
                    value={budgetEdit.monthlyAmount}
                    onChange={e => setBudgetEdit(p => ({ ...p, monthlyAmount: e.target.value }))}
                    placeholder="0"
                    style={{
                      width: 100, textAlign: 'right', background: 'transparent',
                      border: 'none', outline: 'none', color: theme.accent,
                      fontSize: 16, fontWeight: 700, fontFamily: 'inherit',
                    }}
                  />
                </div>

                {/* Start / End dates */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: `1px solid ${theme.border}` }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: theme.textMuted, marginBottom: 4 }}>Begin</div>
                    <input
                      type="month"
                      value={budgetEdit.startDate}
                      onChange={e => setBudgetEdit(p => ({ ...p, startDate: e.target.value }))}
                      style={{
                        background: 'transparent', border: 'none', outline: 'none',
                        color: theme.text, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer',
                      }}
                    />
                  </div>
                  <div style={{ width: 1, height: 36, background: theme.border }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: theme.textMuted, marginBottom: 4 }}>End</div>
                    {budgetEdit.endDate ? (
                      <input
                        type="month"
                        value={budgetEdit.endDate}
                        onChange={e => setBudgetEdit(p => ({ ...p, endDate: e.target.value }))}
                        style={{
                          background: 'transparent', border: 'none', outline: 'none',
                          color: theme.text, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer',
                        }}
                      />
                    ) : (
                      <span
                        onClick={() => setBudgetEdit(p => ({ ...p, endDate: addMonth(currentMonth, 1) }))}
                        style={{ fontSize: 13, color: theme.textMuted, cursor: 'pointer' }}
                      >Never</span>
                    )}
                  </div>
                </div>

                {/* Currency */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: `1px solid ${theme.border}` }}>
                  <span style={{ fontSize: 14, color: theme.text }}>Currency</span>
                  <select
                    value={budgetEdit.currency}
                    onChange={e => setBudgetEdit(p => ({ ...p, currency: e.target.value as Currency }))}
                    style={{
                      background: 'transparent', border: 'none', outline: 'none',
                      color: theme.text, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer',
                    }}
                  >
                    <option value="EGP">EGP</option>
                    <option value="USD">USD</option>
                    <option value="AED">AED</option>
                  </select>
                </div>

                {/* Rollover */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: `1px solid ${theme.border}` }}>
                  <span style={{ fontSize: 14, color: theme.text }}>Rollover</span>
                  <input
                    type="checkbox"
                    checked={budgetEdit.rollover}
                    onChange={e => setBudgetEdit(p => ({ ...p, rollover: e.target.checked }))}
                    style={{ width: 18, height: 18, cursor: 'pointer', accentColor: theme.accent }}
                  />
                </div>

                {/* Delete budget */}
                {budgetObjForCat(selectedCatId) && (
                  <button
                    onClick={() => {
                      const b = budgetObjForCat(selectedCatId)
                      if (b) { removeBudget(b.id); setRightMode('txns') }
                    }}
                    style={{
                      marginTop: 20, background: 'none', border: 'none', cursor: 'pointer',
                      color: RED, fontSize: 14, fontFamily: 'inherit', padding: '8px 0',
                      display: 'block', width: '100%', textAlign: 'center',
                    }}
                  >Delete Budget</button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── MODALS ── */}
      {catModal.open && (
        <CategoryModal
          category={catModal.category}
          categories={categories}
          onSave={c => { upsertCategory(c); setCatModal({ open: false, category: null }) }}
          onDelete={id => { removeCategory(id); setCatModal({ open: false, category: null }) }}
          onClose={() => setCatModal({ open: false, category: null })}
        />
      )}

      {txModal.open && (
        <TransactionModal
          transaction={txModal.tx}
          accounts={accounts}
          categories={categories}
          onSave={tx => { upsertTransaction(tx); setTxModal({ open: false, tx: null }) }}
          onDelete={id => {
            useFinanceStore.getState().removeTransaction(id)
            setTxModal({ open: false, tx: null })
          }}
          onClose={() => setTxModal({ open: false, tx: null })}
        />
      )}

    </div>
  )
}

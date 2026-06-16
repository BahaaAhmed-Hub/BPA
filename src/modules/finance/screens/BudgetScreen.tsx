import { useState } from 'react'
import { useUIStore } from '@/store/uiStore'
import { getTheme } from '@/lib/themes'
import { useFinanceStore } from '../financeStore'
import { CategoryModal } from '../modals/CategoryModal'
import { TransactionModal } from '../modals/TransactionModal'
import type { Category, Transaction, Budget, Currency } from '../types'

const RED   = '#DA4A3E'
const GREEN = '#2FA869'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function addMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

export function BudgetScreen() {
  const themeId = useUIStore(s => s.themeId)
  const theme = getTheme(themeId)

  const {
    categories, transactions, accounts, budgets,
    upsertCategory, removeCategory,
    upsertBudget, removeBudget,
    upsertTransaction,
  } = useFinanceStore()

  const todayDate = new Date()
  const currentYear = todayDate.getFullYear()

  const [currentMonth, setCurrentMonth] = useState(() => {
    return `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, '0')}`
  })
  const [selectedCatId, setSelectedCatId] = useState<string | null>(null)
  const [selectedSubCatId, setSelectedSubCatId] = useState<string | null>(null)
  const [rightMode, setRightMode] = useState<'detail' | 'budget'>('detail')
  const [budgetEdit, setBudgetEdit] = useState<{
    monthlyAmount: string; currency: Currency; startDate: string; endDate: string; rollover: boolean
  }>({ monthlyAmount: '', currency: 'EGP', startDate: '', endDate: '', rollover: false })
  const [hoveredCatId, setHoveredCatId] = useState<string | null>(null)
  const [catModal, setCatModal] = useState<{ open: boolean; category: Category | null }>({ open: false, category: null })
  const [txModal, setTxModal] = useState<{ open: boolean; tx: Transaction | null }>({ open: false, tx: null })

  // DnD
  const [draggedCatId, setDraggedCatId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)

  // ─── Data helpers ──────────────────────────────────────────────────────

  function subCatsOf(id: string): Category[] {
    return categories.filter(c => c.parentId === id)
  }

  function txsInMonth(catId: string, ym: string): Transaction[] {
    return transactions.filter(tx => tx.categoryId === catId && tx.date.startsWith(ym))
  }

  function actualInMonth(catId: string, ym: string): number {
    const subs = subCatsOf(catId)
    const ids = [catId, ...subs.map(s => s.id)]
    return transactions
      .filter(tx => ids.includes(tx.categoryId ?? '') && tx.date.startsWith(ym))
      .reduce((s, tx) => s + Math.abs(tx.amount), 0)
  }

  function budgetAmt(catId: string): number {
    const b = budgets.find(b => b.categoryId === catId)
    return b ? b.monthlyAmount : 0
  }

  function budgetObj(catId: string): Budget | undefined {
    return budgets.find(b => b.categoryId === catId)
  }

  const topExpCats = categories.filter(c => !c.parentId && (c.txType === 'expense' || c.txType === 'both'))
  const topIncCats = categories.filter(c => !c.parentId && (c.txType === 'income'  || c.txType === 'both'))

  const totalExpActual = topExpCats.reduce((s, c) => s + actualInMonth(c.id, currentMonth), 0)
  const totalExpBudget = topExpCats.reduce((s, c) => s + budgetAmt(c.id), 0)
  const totalIncActual = topIncCats.reduce((s, c) => s + actualInMonth(c.id, currentMonth), 0)
  const totalIncBudget = topIncCats.reduce((s, c) => s + budgetAmt(c.id), 0)

  // ─── Monthly bars (always visible in left panel) ───────────────────────
  //
  // When no category selected: each bar = net income minus expense for that month
  //   green = net positive, red = net negative
  // When a category/subcat is selected: each bar = that category's monthly actual
  //   colored by category type

  const focusCatId = selectedSubCatId ?? selectedCatId
  const focusCat   = focusCatId ? categories.find(c => c.id === focusCatId) : null

  const barsData: { value: number; color: string }[] = Array.from({ length: 12 }, (_, i) => {
    const ym = `${currentYear}-${String(i + 1).padStart(2, '0')}`
    if (focusCatId) {
      const val = actualInMonth(focusCatId, ym)
      return { value: val, color: focusCat?.txType === 'income' ? GREEN : RED }
    }
    const inc = transactions
      .filter(tx => tx.type === 'income' && tx.date.startsWith(ym))
      .reduce((s, tx) => s + tx.amount, 0)
    const exp = transactions
      .filter(tx => tx.type === 'expense' && tx.date.startsWith(ym))
      .reduce((s, tx) => s + Math.abs(tx.amount), 0)
    const net = inc - exp
    return { value: Math.abs(net), color: net >= 0 ? GREEN : RED }
  })

  const maxBarVal       = Math.max(...barsData.map(b => b.value), 1)
  const currentMonthIdx = parseInt(currentMonth.slice(5, 7)) - 1

  // ─── Right panel derived ───────────────────────────────────────────────

  const selectedCat    = selectedCatId    ? categories.find(c => c.id === selectedCatId)    : null
  const selectedSubCat = selectedSubCatId ? categories.find(c => c.id === selectedSubCatId) : null
  const activeCat      = selectedSubCat ?? selectedCat
  const activeCatId    = selectedSubCatId ?? selectedCatId

  const activeActual = activeCatId ? actualInMonth(activeCatId, currentMonth) : 0
  const activeBudget = activeCatId ? budgetAmt(activeCatId) : 0
  const panelTxns    = activeCatId ? txsInMonth(activeCatId, currentMonth) : []
  const panelSubs    = selectedCatId && !selectedSubCatId ? subCatsOf(selectedCatId) : []

  // ─── Budget save ────────────────────────────────────────────────────────

  function openBudget(catId: string) {
    const ex = budgetObj(catId)
    setBudgetEdit({
      monthlyAmount: ex ? String(ex.monthlyAmount) : '',
      currency:      ex?.currency ?? 'EGP',
      startDate:     ex?.startDate ?? currentMonth,
      endDate:       ex?.endDate ?? '',
      rollover:      ex?.rollover ?? false,
    })
    setRightMode('budget')
  }

  function saveBudget() {
    if (!activeCatId) return
    const ex = budgetObj(activeCatId)
    upsertBudget({
      id:            ex?.id ?? crypto.randomUUID(),
      categoryId:    activeCatId,
      monthlyAmount: parseFloat(budgetEdit.monthlyAmount) || 0,
      currency:      budgetEdit.currency,
      startDate:     budgetEdit.startDate || currentMonth,
      endDate:       budgetEdit.endDate || undefined,
      rollover:      budgetEdit.rollover,
    })
    setRightMode('detail')
  }

  // ─── DnD handlers ────────────────────────────────────────────────────

  function onDragStart(e: React.DragEvent, catId: string) {
    e.dataTransfer.effectAllowed = 'move'
    setDraggedCatId(catId)
  }

  function onDragEnd() {
    setDraggedCatId(null)
    setDropTargetId(null)
  }

  function onDragOver(e: React.DragEvent, targetId: string) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (draggedCatId && draggedCatId !== targetId) setDropTargetId(targetId)
  }

  function onDrop(e: React.DragEvent, targetId: string | null) {
    e.preventDefault()
    if (!draggedCatId) return
    const dragged = categories.find(c => c.id === draggedCatId)
    if (!dragged) return

    if (targetId === null) {
      if (dragged.parentId) upsertCategory({ ...dragged, parentId: undefined })
    } else {
      if (draggedCatId === targetId) return
      const target = categories.find(c => c.id === targetId)
      if (!target || target.parentId === draggedCatId) return
      upsertCategory({ ...dragged, parentId: targetId })
    }

    setDraggedCatId(null)
    setDropTargetId(null)
  }

  // ─── Shared circle renderer ────────────────────────────────────────────

  function renderCircle(
    cat: Category,
    opts: { size?: number; isSelected?: boolean; isIncome?: boolean },
  ) {
    const { size = 64, isSelected = false, isIncome = false } = opts
    const actual  = actualInMonth(cat.id, currentMonth)
    const budget  = budgetAmt(cat.id)
    const over    = actual > budget && budget > 0
    const isDrop  = dropTargetId === cat.id
    const isDrag  = draggedCatId === cat.id
    const ringCol = isDrop ? theme.accent : isSelected ? theme.accent : over ? RED : isIncome ? GREEN : theme.border

    return (
      <div
        key={cat.id}
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          textAlign: 'center' as const, width: size + 8, position: 'relative',
          opacity: isDrag ? 0.35 : 1,
        }}
        onMouseEnter={() => setHoveredCatId(cat.id)}
        onMouseLeave={() => setHoveredCatId(null)}
        onDragOver={e => onDragOver(e, cat.id)}
        onDragLeave={() => { if (dropTargetId === cat.id) setDropTargetId(null) }}
        onDrop={e => onDrop(e, cat.id)}
      >
        <div
          draggable
          onDragStart={e => onDragStart(e, cat.id)}
          onDragEnd={onDragEnd}
          onClick={() => {
            if (cat.parentId) {
              setSelectedSubCatId(cat.id)
            } else {
              setSelectedCatId(cat.id)
              setSelectedSubCatId(null)
            }
            setRightMode('detail')
          }}
          style={{
            width: size, height: size, borderRadius: '50%',
            border: `2.5px solid ${ringCol}`,
            background: isDrop ? `${theme.accent}18` : theme.surface,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: Math.round(size * 0.4), cursor: 'grab',
            transition: 'border-color 0.15s',
            boxShadow: isDrop ? `0 0 0 3px ${theme.accent}33` : 'none',
          }}
        >
          {cat.icon}
        </div>
        {hoveredCatId === cat.id && (
          <button
            onClick={e => { e.stopPropagation(); setCatModal({ open: true, category: cat }) }}
            style={{
              position: 'absolute', top: -4, right: size > 56 ? 2 : 4,
              background: theme.surface, border: `1px solid ${theme.border}`,
              borderRadius: '50%', width: 18, height: 18,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', fontSize: 10, color: theme.textDim, lineHeight: 1, padding: 0,
            }}
          >✏</button>
        )}
        <div style={{ fontSize: 11, color: theme.text, marginTop: 7, lineHeight: 1.2 }}>{cat.name}</div>
        <div style={{ fontSize: 11, color: over ? RED : isIncome ? GREEN : theme.textDim, marginTop: 2 }}>
          {fmt(actual)}
        </div>
        <div style={{ fontSize: 10, color: theme.textMuted }}>{fmt(budget)}</div>
      </div>
    )
  }

  // ─── Render ────────────────────────────────────────────────────────────

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
          <button
            onClick={() => setCatModal({ open: true, category: null })}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: theme.textDim, padding: '2px 4px', lineHeight: 1 }}
          >⚙</button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={() => setCurrentMonth(addMonth(currentMonth, -1))}
              style={{ background: 'none', border: 'none', color: theme.textDim, fontSize: 20, cursor: 'pointer', padding: '2px 6px', lineHeight: 1 }}
            >‹</button>
            <span style={{ fontSize: 18, fontWeight: 600, color: theme.text, minWidth: 90, textAlign: 'center' as const }}>
              {MONTHS[parseInt(currentMonth.slice(5, 7)) - 1]} {currentMonth.slice(0, 4)}
            </span>
            <button
              onClick={() => setCurrentMonth(addMonth(currentMonth, 1))}
              style={{ background: 'none', border: 'none', color: theme.textDim, fontSize: 20, cursor: 'pointer', padding: '2px 6px', lineHeight: 1 }}
            >›</button>
          </div>

          <div style={{ width: 32 }} />
        </div>

        {/* ── Monthly bars — always visible ── */}
        <div style={{ padding: '12px 24px 0', flexShrink: 0, borderBottom: `1px solid ${theme.border}` }}>
          <div style={{ fontSize: 11, color: theme.textMuted, marginBottom: 6 }}>
            {focusCat ? `${focusCat.name} · ${currentYear}` : `Net income vs expense · ${currentYear}`}
          </div>
          <div style={{ display: 'flex', gap: 3, height: 76, alignItems: 'flex-end' }}>
            {barsData.map(({ value, color }, i) => {
              const isSelected = i === currentMonthIdx
              const barH = value > 0 ? Math.max(Math.round(value / maxBarVal * 58), 4) : 0
              return (
                <div
                  key={i}
                  onClick={() => setCurrentMonth(`${currentYear}-${String(i + 1).padStart(2, '0')}`)}
                  style={{
                    flex: 1, display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'flex-end',
                    cursor: 'pointer', gap: 4,
                  }}
                >
                  <div style={{
                    width: '100%', borderRadius: '2px 2px 0 0',
                    background: isSelected ? color : `${color}44`,
                    height: barH || 3,
                    opacity: barH === 0 ? 0.15 : 1,
                    transition: 'background 0.15s',
                    outline: isSelected ? `2px solid ${color}` : 'none',
                    outlineOffset: 1,
                  }} />
                  <div style={{
                    fontSize: 9, paddingBottom: 4,
                    color: isSelected ? color : theme.textMuted,
                    fontWeight: isSelected ? 700 : 400,
                  }}>
                    {MONTHS[i]}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Category circles — drag onto another to reparent, drag to empty area to un-parent */}
        <div
          style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}
          onDragOver={e => { e.preventDefault(); if (dropTargetId !== '__root__') setDropTargetId('__root__') }}
          onDragLeave={e => {
            const t = e.currentTarget as HTMLElement
            if (!t.contains(e.relatedTarget as Node)) setDropTargetId(null)
          }}
          onDrop={e => onDrop(e, null)}
        >
          {/* Expenses */}
          <div style={{ marginBottom: 28 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.8px', color: theme.textDim }}>
                EXPENSES
              </span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: RED }}>{fmt(totalExpActual)}</span>
                <span style={{ fontSize: 14, color: theme.textMuted }}>/ EGP {fmt(totalExpBudget)}</span>
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 8px' }}>
              {topExpCats.map(cat => renderCircle(cat, { isSelected: selectedCatId === cat.id }))}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 12 }}>
                <button
                  onClick={() => setCatModal({ open: true, category: null })}
                  style={{
                    width: 40, height: 40, borderRadius: '50%',
                    border: `2px dashed ${theme.border}`, background: 'none', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: theme.textDim, fontSize: 20, lineHeight: 1,
                  }}
                >+</button>
              </div>
            </div>
          </div>

          {/* Income */}
          <div style={{ marginBottom: 28 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.8px', color: theme.textDim }}>
                INCOME
              </span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: GREEN }}>{fmt(totalIncActual)}</span>
                <span style={{ fontSize: 14, color: theme.textMuted }}>/ EGP {fmt(totalIncBudget)}</span>
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 8px' }}>
              {topIncCats.map(cat => renderCircle(cat, { isSelected: selectedCatId === cat.id, isIncome: true }))}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 12 }}>
                <button
                  onClick={() => setCatModal({ open: true, category: null })}
                  style={{
                    width: 40, height: 40, borderRadius: '50%',
                    border: `2px dashed ${theme.border}`, background: 'none', cursor: 'pointer',
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
      {selectedCatId && activeCat && (
        <div style={{
          width: 340, flexShrink: 0,
          borderLeft: `1px solid ${theme.border}`,
          display: 'flex', flexDirection: 'column',
          background: theme.surface, overflow: 'hidden',
        }}>

          {rightMode === 'detail' ? (
            <>
              {/* Breadcrumb header */}
              <div style={{
                height: 52, flexShrink: 0,
                borderBottom: `1px solid ${theme.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '0 14px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                  <button
                    onClick={() => {
                      if (selectedSubCatId) setSelectedSubCatId(null)
                      else setSelectedCatId(null)
                    }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.textDim, fontSize: 18, lineHeight: 1, padding: '0 4px 0 0', flexShrink: 0 }}
                  >‹</button>
                  {selectedSubCatId && selectedCat && (
                    <span
                      onClick={() => setSelectedSubCatId(null)}
                      style={{ fontSize: 13, color: theme.textMuted, cursor: 'pointer', whiteSpace: 'nowrap' as const }}
                    >
                      {selectedCat.icon} {selectedCat.name} ›{' '}
                    </span>
                  )}
                  <span style={{ fontSize: 15, fontWeight: 600, color: theme.text, whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {activeCat.icon} {activeCat.name}
                  </span>
                </div>
                <span style={{
                  fontSize: 13, fontWeight: 700, flexShrink: 0, marginLeft: 8,
                  color: activeActual > activeBudget && activeBudget > 0 ? RED : theme.accent,
                }}>
                  {fmt(activeActual)} / EGP {fmt(activeBudget)}
                </span>
              </div>

              {/* Body: subcategory circles OR transaction list */}
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {panelSubs.length > 0 ? (
                  <div style={{ padding: '16px 12px' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 6px' }}>
                      {panelSubs.map(sub => renderCircle(sub, {
                        size: 56,
                        isSelected: selectedSubCatId === sub.id,
                      }))}
                      {/* + Add subcategory */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 8 }}>
                        <button
                          onClick={() => setCatModal({ open: true, category: {
                            id: crypto.randomUUID(), name: '', icon: '📁',
                            color: theme.accent, parentId: selectedCatId!,
                            txType: activeCat.txType, isSystem: false,
                          }})}
                          style={{
                            width: 36, height: 36, borderRadius: '50%',
                            border: `2px dashed ${theme.border}`, background: 'none', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: theme.textDim, fontSize: 18, lineHeight: 1,
                          }}
                        >+</button>
                      </div>
                    </div>
                  </div>
                ) : panelTxns.length === 0 ? (
                  <div style={{ padding: 24, textAlign: 'center' as const, color: theme.textMuted, fontSize: 13 }}>
                    No transactions in {MONTHS[parseInt(currentMonth.slice(5, 7)) - 1]}
                  </div>
                ) : panelTxns.map(tx => {
                  const acct  = accounts.find(a => a.id === tx.accountId)
                  const isExp = tx.type === 'expense'
                  return (
                    <div
                      key={tx.id}
                      onClick={() => setTxModal({ open: true, tx })}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '10px 14px', borderBottom: `1px solid ${theme.border}`,
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{
                        width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
                        background: acct ? `${acct.color}22` : theme.bg,
                        border: `1px solid ${acct ? acct.color + '44' : theme.border}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 15,
                      }}>
                        {acct?.emoji ?? '🏦'}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, color: theme.text, fontWeight: 500, whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {tx.payee || 'Unnamed'}
                        </div>
                        <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 2 }}>{tx.date}</div>
                      </div>
                      <span style={{
                        fontSize: 13, fontWeight: 700, flexShrink: 0,
                        color: isExp ? RED : GREEN,
                        background: isExp ? `${RED}18` : `${GREEN}18`,
                        borderRadius: 20, padding: '3px 8px',
                      }}>
                        {isExp ? '−' : '+'}{tx.currency} {Math.abs(tx.amount).toLocaleString()}
                      </span>
                    </div>
                  )
                })}
              </div>

              {/* Footer */}
              <div style={{ borderTop: `1px solid ${theme.border}`, padding: '10px 14px', display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setTxModal({ open: true, tx: null })}
                  style={{
                    flex: 1, padding: '8px 0',
                    background: theme.accentFill, border: `1px solid ${theme.accent}44`,
                    borderRadius: 8, cursor: 'pointer',
                    fontSize: 13, color: theme.accent, fontFamily: 'inherit', fontWeight: 600,
                  }}
                >+ Add</button>
                <button
                  onClick={() => openBudget(activeCatId!)}
                  style={{
                    flex: 1, padding: '8px 0',
                    background: 'transparent', border: `1px solid ${theme.border}`,
                    borderRadius: 8, cursor: 'pointer',
                    fontSize: 13, fontWeight: 600, color: theme.text, fontFamily: 'inherit',
                  }}
                >Budget</button>
              </div>
            </>
          ) : (
            /* ── Budget editor ── */
            <>
              <div style={{
                height: 56, flexShrink: 0, borderBottom: `1px solid ${theme.border}`,
                display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center',
                padding: '0 16px',
              }}>
                <button
                  onClick={() => setRightMode('detail')}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.textDim, fontSize: 14, textAlign: 'left' as const, fontFamily: 'inherit', padding: 0 }}
                >Cancel</button>
                <span style={{ fontSize: 15, fontWeight: 700, color: theme.text }}>Budget</span>
                <button
                  onClick={saveBudget}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.accent, fontSize: 14, fontWeight: 700, textAlign: 'right' as const, fontFamily: 'inherit', padding: 0 }}
                >Save</button>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
                {activeCat && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: '50%',
                      background: `${activeCat.color}22`, border: `2px solid ${activeCat.color}44`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
                    }}>
                      {activeCat.icon}
                    </div>
                    <input
                      key={activeCat.id}
                      defaultValue={activeCat.name}
                      onBlur={e => {
                        const n = e.target.value.trim()
                        if (n && n !== activeCat.name) upsertCategory({ ...activeCat, name: n })
                      }}
                      style={{
                        flex: 1, background: 'transparent', border: 'none',
                        borderBottom: `1px solid ${theme.border}`, outline: 'none',
                        color: theme.text, fontSize: 16, fontWeight: 600,
                        fontFamily: 'inherit', padding: '4px 0',
                      }}
                    />
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: `1px solid ${theme.border}` }}>
                  <span style={{ fontSize: 14, color: theme.text }}>Every Month</span>
                  <input
                    type="number" min={0} value={budgetEdit.monthlyAmount} placeholder="0"
                    onChange={e => setBudgetEdit(p => ({ ...p, monthlyAmount: e.target.value }))}
                    style={{ width: 100, textAlign: 'right' as const, background: 'transparent', border: 'none', outline: 'none', color: theme.accent, fontSize: 16, fontWeight: 700, fontFamily: 'inherit' }}
                  />
                </div>

                <div style={{ display: 'flex', gap: 12, padding: '12px 0', borderBottom: `1px solid ${theme.border}` }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: theme.textMuted, marginBottom: 4 }}>Begin</div>
                    <input
                      type="month" value={budgetEdit.startDate}
                      onChange={e => setBudgetEdit(p => ({ ...p, startDate: e.target.value }))}
                      style={{ background: 'transparent', border: 'none', outline: 'none', color: theme.text, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' }}
                    />
                  </div>
                  <div style={{ width: 1, background: theme.border }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: theme.textMuted, marginBottom: 4 }}>End</div>
                    {budgetEdit.endDate ? (
                      <input
                        type="month" value={budgetEdit.endDate}
                        onChange={e => setBudgetEdit(p => ({ ...p, endDate: e.target.value }))}
                        style={{ background: 'transparent', border: 'none', outline: 'none', color: theme.text, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' }}
                      />
                    ) : (
                      <span
                        onClick={() => setBudgetEdit(p => ({ ...p, endDate: addMonth(currentMonth, 1) }))}
                        style={{ fontSize: 13, color: theme.textMuted, cursor: 'pointer' }}
                      >Never</span>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: `1px solid ${theme.border}` }}>
                  <span style={{ fontSize: 14, color: theme.text }}>Currency</span>
                  <select
                    value={budgetEdit.currency}
                    onChange={e => setBudgetEdit(p => ({ ...p, currency: e.target.value as Currency }))}
                    style={{ background: 'transparent', border: 'none', outline: 'none', color: theme.text, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer' }}
                  >
                    <option value="EGP">EGP</option>
                    <option value="USD">USD</option>
                    <option value="AED">AED</option>
                  </select>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: `1px solid ${theme.border}` }}>
                  <span style={{ fontSize: 14, color: theme.text }}>Rollover</span>
                  <input
                    type="checkbox" checked={budgetEdit.rollover}
                    onChange={e => setBudgetEdit(p => ({ ...p, rollover: e.target.checked }))}
                    style={{ width: 18, height: 18, cursor: 'pointer', accentColor: theme.accent }}
                  />
                </div>

                {activeCatId && budgetObj(activeCatId) && (
                  <button
                    onClick={() => {
                      const b = budgetObj(activeCatId!)
                      if (b) { removeBudget(b.id); setRightMode('detail') }
                    }}
                    style={{
                      marginTop: 20, background: 'none', border: 'none', cursor: 'pointer',
                      color: RED, fontSize: 14, fontFamily: 'inherit', padding: '8px 0',
                      display: 'block', width: '100%', textAlign: 'center' as const,
                    }}
                  >Delete Budget</button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Modals ── */}
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
          onDelete={id => { useFinanceStore.getState().removeTransaction(id); setTxModal({ open: false, tx: null }) }}
          onClose={() => setTxModal({ open: false, tx: null })}
        />
      )}
    </div>
  )
}

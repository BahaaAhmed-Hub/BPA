import { useState } from 'react'
import { useFinanceStore } from '../financeStore'
import { useUIStore } from '@/store/uiStore'
import { getTheme } from '@/lib/themes'
import { TransactionModal } from '../modals/TransactionModal'
import type { Transaction } from '../types'

interface Props {
  onOpenAdd: () => void
}

function Pill({ type, amount, currency }: { type: 'expense' | 'income' | 'transfer'; amount: number; currency: string }) {
  const bg = type === 'expense' ? '#DA4A3E' : type === 'income' ? '#2FA869' : '#EDE6D8'
  const color = type === 'transfer' ? '#1A1714' : '#fff'
  return (
    <span style={{
      display: 'inline-block', padding: '7px 15px', borderRadius: 9,
      fontSize: 13, fontWeight: 600, background: bg, color, whiteSpace: 'nowrap',
    }}>
      {type === 'expense' ? '−' : type === 'income' ? '+' : ''}{currency} {amount.toLocaleString('en-US')}
    </span>
  )
}

const RED   = '#DA4A3E'
const GREEN = '#2FA869'
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

export function TodayScreen({ onOpenAdd }: Props) {
  const themeId = useUIStore(s => s.themeId)
  const theme   = getTheme(themeId)
  const C = {
    bg:        theme.bg,
    surface:   theme.surface,
    border:    theme.border,
    amber:     theme.accent,
    amberBg:   theme.accentFill,
    textPri:   theme.text,
    textMuted: theme.textDim,
    textDim:   theme.textMuted,
    red:       RED,
    green:     GREEN,
  }

  const { transactions, accounts, categories, bills, goals, upsertTransaction, removeTransaction } = useFinanceStore()

  const [txModal,     setTxModal]     = useState<{ open: boolean; tx: Transaction | null }>({ open: false, tx: null })
  const [selectedDay, setSelectedDay] = useState<number | null>(null)

  const today = new Date()
  const [viewYear,  setViewYear]  = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())

  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const startOffset = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7

  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  const cells: (number | null)[] = []
  for (let i = 0; i < startOffset; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const monthPrefix = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`

  // Per-day net: income - expense (for coloring)
  const dayNet: Record<number, number> = {}
  transactions
    .filter(tx => tx.date.startsWith(monthPrefix))
    .forEach(tx => {
      const d = parseInt(tx.date.slice(8, 10))
      if (!dayNet[d]) dayNet[d] = 0
      if (tx.type === 'income')  dayNet[d] += tx.amount
      if (tx.type === 'expense') dayNet[d] -= Math.abs(tx.amount)
    })

  // Bill dots from real bills
  const billDotsMap: Record<number, string[]> = {}
  bills.forEach(bill => {
    if (!bill.isActive) return
    const due = new Date(bill.nextDue)
    if (due.getFullYear() === viewYear && due.getMonth() === viewMonth) {
      const day = due.getDate()
      if (!billDotsMap[day]) billDotsMap[day] = []
      billDotsMap[day].push(bill.isIncome ? GREEN : RED)
    }
  })

  // Planned bills (next 30 days)
  const in30 = new Date(today); in30.setDate(in30.getDate() + 30)
  const plannedBills = bills.filter(b => {
    if (!b.isActive || b.isIncome) return false
    const due = new Date(b.nextDue)
    return due.getTime() >= today.getTime() && due.getTime() <= in30.getTime()
  })

  // Transactions for selected day
  const selectedDayStr = selectedDay !== null
    ? `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`
    : null
  const selectedDayTx = selectedDayStr
    ? transactions.filter(tx => tx.date === selectedDayStr).sort((a, b) => b.date.localeCompare(a.date))
    : []

  // All transactions for the viewed month, sorted by date desc (for default right panel)
  const monthTx = transactions
    .filter(tx => tx.date.startsWith(monthPrefix))
    .sort((a, b) => b.date.localeCompare(a.date))

  const totalExpense = transactions.filter(tx => tx.date.startsWith(monthPrefix) && tx.type === 'expense').reduce((s, tx) => s + tx.amount, 0)
  const totalIncome  = transactions.filter(tx => tx.date.startsWith(monthPrefix) && tx.type === 'income').reduce((s, tx) => s + tx.amount, 0)

  const isViewingCurrentMonth = viewYear === today.getFullYear() && viewMonth === today.getMonth()

  function navigateMonth(delta: number) {
    const d = new Date(viewYear, viewMonth + delta, 1)
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
    setSelectedDay(null)
  }

  function renderTxRow(tx: Transaction) {
    const cat  = tx.categoryId ? categories.find(c => c.id === tx.categoryId) : null
    const acct = tx.accountId  ? accounts.find(a => a.id === tx.accountId)    : null
    const isExp    = tx.type === 'expense'
    const isFuture = tx.date > todayStr
    return (
      <div
        key={tx.id}
        onClick={() => setTxModal({ open: true, tx })}
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 0', borderBottom: `1px solid ${C.border}`,
          cursor: 'pointer',
          opacity: isFuture ? 0.75 : 1,
        }}
      >
        <div style={{
          width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
          background: acct ? `${acct.color}22` : `${isExp ? RED : GREEN}18`,
          border: `1px solid ${acct ? acct.color + '44' : isExp ? RED + '44' : GREEN + '44'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17,
        }}>
          {cat?.icon ?? acct?.emoji ?? (isExp ? '💳' : '💼')}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: C.textPri, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
            {tx.payee?.trim() || cat?.name || 'Transaction'}
            {isFuture && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.7 }}>
                <title>Planned (not yet paid)</title>
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            )}
          </div>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2, display: 'flex', gap: 6 }}>
            <span>{tx.date}</span>
            {cat && tx.payee?.trim() && <span style={{ color: C.textDim }}>· {cat.name}</span>}
          </div>
        </div>
        <Pill
          type={tx.type === 'income' ? 'income' : tx.type === 'transfer' ? 'transfer' : 'expense'}
          amount={tx.amount}
          currency={tx.currency}
        />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{
        height: 48, flexShrink: 0,
        borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 24px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => navigateMonth(-1)}
            style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 18, cursor: 'pointer', padding: '2px 6px', lineHeight: 1 }}
          >‹</button>
          <span style={{ fontSize: 16, fontWeight: 600, color: C.textPri }}>
            {MONTH_NAMES[viewMonth]} {viewYear}
          </span>
          <button
            onClick={() => navigateMonth(1)}
            style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 18, cursor: 'pointer', padding: '2px 6px', lineHeight: 1 }}
          >›</button>
        </div>
        <button
          onClick={onOpenAdd}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth="1.7" strokeLinecap="round">
            <circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="22" y2="22"/>
          </svg>
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ── Left: Calendar ── */}
        <div style={{
          flex: 1.25, overflowY: 'auto', padding: '20px 22px',
          borderRight: `1px solid ${C.border}`,
          display: 'flex', flexDirection: 'column', gap: 0,
        }}>
          {/* Weekday labels */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 5, marginBottom: 5 }}>
            {weekdays.map(d => (
              <div key={d} style={{
                textAlign: 'center', fontSize: 10, fontWeight: 600,
                textTransform: 'uppercase', color: C.textMuted, letterSpacing: '0.5px', padding: '4px 0',
              }}>
                {d}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 5 }}>
            {cells.map((day, idx) => {
              if (day === null) return <div key={`b${idx}`} />
              const isToday    = isViewingCurrentMonth && day === today.getDate()
              const isSelected = selectedDay === day
              const net        = dayNet[day]
              const hasData    = net !== undefined
              const dots       = billDotsMap[day] ?? []

              // Cell border: accent for today or selected, faint otherwise
              const cellBorder = (isToday || isSelected) ? C.amber : C.border
              const cellBg     = isToday ? C.amberBg : 'transparent'

              // Day NUMBER pill: colored background only when there are transactions
              // Today overrides to accent. Selection adds accent border to cell only (no fill).
              let numBg: string | undefined
              let numColor = isViewingCurrentMonth && day > today.getDate() ? C.textDim : C.textMuted
              if (isToday) {
                numBg = C.amber; numColor = theme.bg
              } else if (hasData) {
                numBg = net >= 0 ? `${GREEN}30` : `${RED}30`
                numColor = net >= 0 ? GREEN : RED
              } else if (isSelected) {
                numColor = C.amber
              }

              return (
                <div
                  key={day}
                  onClick={() => setSelectedDay(isSelected ? null : day)}
                  style={{
                    minHeight: 68, borderRadius: 8,
                    border: `1px solid ${cellBorder}`,
                    background: cellBg,
                    padding: '7px 8px',
                    display: 'flex', flexDirection: 'column', gap: 3,
                    cursor: 'pointer', transition: 'border-color 0.1s',
                  }}
                >
                  <span style={{
                    fontSize: 12, fontWeight: (isToday || isSelected || hasData) ? 700 : 400,
                    color: numColor, lineHeight: 1,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    minWidth: 22, height: 22, borderRadius: 6,
                    background: numBg,
                    padding: numBg ? '0 4px' : undefined,
                  }}>
                    {day}
                  </span>
                  {dots.length > 0 && (
                    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 1 }}>
                      {dots.map((color, di) => (
                        <div key={di} style={{ width: 5, height: 5, borderRadius: '50%', background: color }} />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Month totals */}
          <div style={{
            marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.border}`,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontSize: 12, color: RED, fontWeight: 600 }}>
              −EGP {totalExpense.toLocaleString('en-US')}
            </span>
            <span style={{ fontSize: 12, color: C.textDim, fontWeight: 500 }}>
              {MONTH_NAMES[viewMonth]}
            </span>
            <span style={{ fontSize: 12, color: GREEN, fontWeight: 600 }}>
              +EGP {totalIncome.toLocaleString('en-US')}
            </span>
          </div>
        </div>

        {/* ── Right: Context panel ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 0 }}>

          {selectedDay !== null ? (
            /* ─── Selected day view ─── */
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: C.textPri }}>
                  {selectedDay} {MONTH_NAMES[viewMonth]}
                </span>
                <button
                  onClick={() => setTxModal({ open: true, tx: null })}
                  style={{ background: C.amber, border: 'none', borderRadius: 7, padding: '5px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: theme.bg, fontFamily: 'inherit' }}
                >
                  + Add
                </button>
              </div>

              {selectedDayTx.length === 0 ? (
                <div style={{ fontSize: 13, color: C.textDim, textAlign: 'center', padding: '32px 0' }}>
                  No transactions on this day
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {selectedDayTx.map(tx => renderTxRow(tx))}
                </div>
              )}

              {/* Day summary */}
              {selectedDayTx.length > 0 && (() => {
                const dayInc = selectedDayTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
                const dayExp = selectedDayTx.filter(t => t.type === 'expense').reduce((s, t) => s + Math.abs(t.amount), 0)
                const net = dayInc - dayExp
                return (
                  <div style={{
                    marginTop: 16, paddingTop: 12, borderTop: `1px solid ${C.border}`,
                    display: 'flex', justifyContent: 'space-between',
                  }}>
                    {dayExp > 0 && <span style={{ fontSize: 12, color: RED, fontWeight: 600 }}>−EGP {dayExp.toLocaleString('en-US')}</span>}
                    <span style={{ fontSize: 12, color: net >= 0 ? GREEN : RED, fontWeight: 700, marginLeft: 'auto' }}>
                      Net {net >= 0 ? '+' : ''}EGP {net.toLocaleString('en-US')}
                    </span>
                  </div>
                )
              })()}
            </>
          ) : (
            /* ─── Default view ─── */
            <>
              {/* Goals */}
              <div style={{ marginBottom: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: C.textMuted, letterSpacing: '0.8px' }}>Goals</span>
                  <button
                    onClick={() => setTxModal({ open: true, tx: null })}
                    style={{ background: 'none', border: 'none', color: C.amber, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                  >Add</button>
                </div>
                {goals.length === 0 ? (
                  <div style={{ fontSize: 13, color: C.textDim, textAlign: 'center', padding: '16px 0' }}>No goals yet</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {goals.map(goal => (
                      <div key={goal.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: `1px solid ${C.border}` }}>
                        <div style={{ width: 40, height: 40, borderRadius: '50%', background: `${goal.color}22`, border: `1px solid ${goal.color}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
                          {goal.icon}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: C.textPri, marginBottom: 2 }}>{goal.name}</div>
                          <div style={{ fontSize: 12, color: C.textMuted }}>{goal.sub}</div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: goal.color }}>EGP {goal.currentAmount.toLocaleString('en-US')}</div>
                          <div style={{ fontSize: 11, color: C.textDim }}>of {goal.targetAmount.toLocaleString('en-US')}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Planned bills */}
              {plannedBills.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <div style={{ marginBottom: 12 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: C.textMuted, letterSpacing: '0.8px' }}>Planned</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {plannedBills.map(bill => {
                      const dateStr = new Date(bill.nextDue).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                      return (
                        <div key={bill.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: `1px solid ${C.border}` }}>
                          <div style={{ width: 40, height: 40, borderRadius: '50%', background: `${bill.isIncome ? GREEN : RED}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
                            {bill.icon}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 500, color: C.textPri }}>{bill.name}</div>
                            <div style={{ fontSize: 12, color: C.amber, marginTop: 1 }}>{dateStr}</div>
                          </div>
                          <Pill type={bill.isIncome ? 'income' : 'expense'} amount={bill.amount} currency={bill.currency} />
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Month transactions */}
              {monthTx.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <div style={{ marginBottom: 12 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: C.textMuted, letterSpacing: '0.8px' }}>
                      {MONTH_NAMES[viewMonth]}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {monthTx.map(tx => renderTxRow(tx))}
                  </div>
                </div>
              )}
              {monthTx.length === 0 && (
                <div style={{ fontSize: 13, color: C.textDim, textAlign: 'center', padding: '32px 0' }}>
                  No transactions in {MONTH_NAMES[viewMonth]}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {txModal.open && (
        <TransactionModal
          transaction={txModal.tx}
          accounts={accounts}
          categories={categories}
          onSave={tx => { upsertTransaction(tx); setTxModal({ open: false, tx: null }) }}
          onDelete={id => { removeTransaction(id); setTxModal({ open: false, tx: null }) }}
          onClose={() => setTxModal({ open: false, tx: null })}
        />
      )}
    </div>
  )
}

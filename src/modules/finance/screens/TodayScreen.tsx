import { useState } from 'react'
import { useFinanceStore } from '../financeStore'
import { BudgetQuickPay } from '../components/BudgetQuickPay'
import { CategoryGlyph } from '../components/CategoryGlyph'
import type { Transaction, Category, Account } from '../types'

// ── Palette ───────────────────────────────────────────────────────────────────

const RED   = '#E05252'
const GREEN = '#1D9E75'

const C = {
  bg:      '#F7F4EA',
  surface: '#FFFFFF',
  border:  '#E8E1CE',
  textPri: '#191712',
  textDim: '#3D3926',
  textMuted: '#6C6553',
  accent:  '#191712',
}

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

// ── Pill ──────────────────────────────────────────────────────────────────────

function Pill({ type, amount, currency }: { type: 'income' | 'expense' | 'transfer'; amount: number; currency?: string }) {
  const cur = currency ?? 'EGP'
  const isIncome   = type === 'income'
  const isTransfer = type === 'transfer'
  const color = isTransfer ? C.accent : isIncome ? GREEN : RED
  const sign  = isTransfer ? '↔' : isIncome ? '+' : '−'
  return (
    <span style={{
      fontSize: 13, fontWeight: 700,
      color,
      whiteSpace: 'nowrap',
      flexShrink: 0,
    }}>
      {sign}{cur} {Math.abs(amount).toLocaleString('en-US')}
    </span>
  )
}

// ── TxModal ───────────────────────────────────────────────────────────────────

interface TxModalState { open: boolean; tx: Transaction | null }

function TxModal({
  tx,
  categories,
  accounts,
  onClose,
}: {
  tx: Transaction
  categories: Category[]
  accounts: Account[]
  onClose: () => void
}) {
  const cat  = tx.categoryId ? categories.find(c => c.id === tx.categoryId) : null
  const acct = tx.accountId  ? accounts.find(a => a.id === tx.accountId)    : null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 400,
          background: C.surface, border: `1px solid ${C.border}`,
          borderRadius: 14, padding: 24,
          boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.textPri, marginBottom: 4 }}>
              {tx.payee?.trim() || cat?.name || 'Transaction'}
            </div>
            <div style={{ fontSize: 12, color: C.textMuted }}>{tx.date}</div>
          </div>
          <Pill type={tx.type === 'income' ? 'income' : tx.type === 'transfer' ? 'transfer' : 'expense'} amount={tx.amount} currency={tx.currency} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {cat && (
            <div>
              <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Category</div>
              <div style={{ fontSize: 13, color: C.textDim }}>{cat.icon ?? ''} {cat.name}</div>
            </div>
          )}
          {acct && (
            <div>
              <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Account</div>
              <div style={{ fontSize: 13, color: C.textDim }}>{acct.emoji ?? ''} {acct.name}</div>
            </div>
          )}
          {tx.note && (
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Notes</div>
              <div style={{ fontSize: 13, color: C.textDim }}>{tx.note}</div>
            </div>
          )}
        </div>

        <button
          onClick={onClose}
          style={{
            marginTop: 24, width: '100%', padding: '9px 0',
            background: 'transparent', border: `1px solid ${C.border}`,
            borderRadius: 8, fontSize: 13, color: C.textMuted, cursor: 'pointer',
          }}
        >
          Close
        </button>
      </div>
    </div>
  )
}

// ── Money Calendar (16D design) ───────────────────────────────────────────────
// Each cell shows: day number + net daily amount (olive=income, rust=expense, neutral=zero)

function MoneyCalendar({
  year, month,
  selectedDay,
  transactions,
  onSelectDay,
  onPrevMonth,
  onNextMonth,
}: {
  year: number
  month: number
  selectedDay: string | null
  transactions: Transaction[]
  onSelectDay: (d: string) => void
  onPrevMonth: () => void
  onNextMonth: () => void
}) {
  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)

  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const monthPrefix = `${year}-${String(month + 1).padStart(2,'0')}`

  // Build per-day net map
  const dayNetMap = new Map<string, number>()
  const dayTxMap  = new Map<string, string[]>() // dateStr → payee names
  transactions.forEach(tx => {
    if (!tx.date.startsWith(monthPrefix)) return
    const prev = dayNetMap.get(tx.date) ?? 0
    const delta = tx.type === 'income' ? Math.abs(tx.amount) : -Math.abs(tx.amount)
    dayNetMap.set(tx.date, prev + delta)
    const payees = dayTxMap.get(tx.date) ?? []
    if (tx.payee?.trim()) payees.push(tx.payee.trim())
    dayTxMap.set(tx.date, payees)
  })

  const cells: (number | null)[] = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  // Monthly totals
  const monthOut = transactions.filter(t => t.date.startsWith(monthPrefix) && t.type === 'expense').reduce((s, t) => s + Math.abs(t.amount), 0)
  const monthIn  = transactions.filter(t => t.date.startsWith(monthPrefix) && t.type === 'income').reduce((s, t) => s + Math.abs(t.amount), 0)

  return (
    <div style={{ userSelect: 'none' as const }}>
      {/* Month nav + totals */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <button onClick={onPrevMonth} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6C6553', fontSize: 16, padding: '0 4px', lineHeight: 1 }}>‹</button>
        <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 16, fontWeight: 600, color: '#191712', letterSpacing: '-0.02em' }}>
          {MONTH_NAMES[month]} {year}
        </span>
        <button onClick={onNextMonth} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6C6553', fontSize: 16, padding: '0 4px', lineHeight: 1 }}>›</button>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#6C6553', display: 'flex', gap: 12 }}>
          <span>Out <b style={{ fontFamily: 'Outfit, sans-serif', color: '#B4523A', fontVariantNumeric: 'tabular-nums' }}>
            {monthOut > 0 ? `EGP ${monthOut.toLocaleString('en-US')}` : '–'}
          </b></span>
          <span>In <b style={{ fontFamily: 'Outfit, sans-serif', color: '#5F7038', fontVariantNumeric: 'tabular-nums' }}>
            {monthIn > 0 ? `EGP ${monthIn.toLocaleString('en-US')}` : '–'}
          </b></span>
        </span>
      </div>

      {/* Calendar grid */}
      <div style={{ border: '1px solid #E8E1CE', borderRight: 'none', borderBottom: 'none', borderRadius: 14, overflow: 'hidden' }}>
        {/* Day headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {['SAT','SUN','MON','TUE','WED','THU','FRI'].map(d => (
            <div key={d} style={{ padding: '7px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: '#6C6553', borderRight: '1px solid #EFEADB', borderBottom: '1px solid #E8E1CE', boxSizing: 'border-box' as const }}>{d}</div>
          ))}
        </div>
        {/* Cells grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {cells.map((day, i) => {
            if (!day) return (
              <div key={i} style={{ borderRight: '1px solid #EFEADB', borderBottom: '1px solid #EFEADB', minHeight: 72, boxSizing: 'border-box' as const, background: '#FAF7EC' }} />
            )
            const dateStr = `${year}-${String(month + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
            const isToday    = dateStr === todayStr
            const isSelected = dateStr === selectedDay
            const net        = dayNetMap.get(dateStr) ?? 0
            const payees     = dayTxMap.get(dateStr) ?? []
            const netColor   = net > 0 ? '#5F7038' : net < 0 ? '#B4523A' : '#9B9180'
            const netSign    = net > 0 ? '+' : ''

            return (
              <div
                key={i}
                onClick={() => onSelectDay(isSelected ? '' : dateStr)}
                style={{
                  borderRight: '1px solid #EFEADB', borderBottom: '1px solid #EFEADB',
                  padding: '6px 7px', display: 'flex', flexDirection: 'column', gap: 3,
                  minHeight: 72, minWidth: 0, overflow: 'hidden', boxSizing: 'border-box' as const,
                  background: isSelected ? '#FAF5D6' : isToday ? '#FDF8E7' : 'transparent',
                  cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: 11.5, fontWeight: isToday ? 700 : 500, color: isToday ? '#191712' : '#4A4438' }}>
                  {day}
                </span>
                {net !== 0 && (
                  <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 11.5, fontWeight: 600, color: netColor, fontVariantNumeric: 'tabular-nums' }}>
                    {netSign}{net.toLocaleString('en-US')}
                  </span>
                )}
                {payees.slice(0, 2).map((p, pi) => (
                  <span key={pi} style={{ fontSize: 9.5, color: '#6C6553', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p}</span>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}


// ── Main Screen ───────────────────────────────────────────────────────────────

export function TodayScreen() {
  const { transactions, categories, accounts } = useFinanceStore()
  const today      = new Date()
  const todayStr   = today.toISOString().slice(0, 10)

  const [viewYear,  setViewYear]  = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [selectedDay, setSelectedDay] = useState<string>(todayStr)
  const [txModal, setTxModal] = useState<TxModalState>({ open: false, tx: null })

  const monthPrefix = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`

  // All transactions for the viewed month, sorted by date asc (earliest first)
  const monthTx = transactions
    .filter(tx => tx.date.startsWith(monthPrefix))
    .sort((a, b) => a.date.localeCompare(b.date))

  const selectedDayTx = selectedDay
    ? transactions
        .filter(tx => tx.date === selectedDay)
        .sort((a, b) => a.date.localeCompare(b.date))
    : []

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) }
    else setViewMonth(m => m - 1)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
    else setViewMonth(m => m + 1)
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
          {cat ? <CategoryGlyph icon={cat.icon} size={18} /> : (acct?.emoji ?? (isExp ? '💳' : '💼'))}
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
            {cat && tx.payee?.trim() && <span style={{ color: C.textMuted }}>· {cat.name}</span>}
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

  const todayTx = transactions.filter(tx => tx.date === todayStr)
  const todayExp = todayTx.filter(t => t.type === 'expense').reduce((s, t) => s + Math.abs(t.amount), 0)
  const todayInc = todayTx.filter(t => t.type === 'income').reduce((s, t) => s + Math.abs(t.amount), 0)

  return (
    <div style={{ display: 'flex', height: '100%', background: C.bg, flexDirection: 'column' }}>

      {/* Header bar */}
      <div style={{ flexShrink: 0, borderBottom: `1px solid ${C.border}`, padding: '12px 26px 14px', display: 'flex', alignItems: 'flex-end', gap: 20 }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', color: '#6C6553', display: 'block', marginBottom: 3 }}>MONEY</span>
          <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 26, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1, color: '#191712' }}>Today</span>
        </div>
        {todayTx.length > 0 && (
          <div style={{ display: 'flex', gap: 16, paddingBottom: 3 }}>
            <span style={{ fontSize: 12, color: '#B4523A', fontWeight: 600 }}>−EGP {todayExp.toLocaleString('en-US')}</span>
            <span style={{ fontSize: 12, color: '#5F7038', fontWeight: 600 }}>+EGP {todayInc.toLocaleString('en-US')}</span>
          </div>
        )}
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      {/* Left panel — calendar */}
      <div style={{
        width: 340, flexShrink: 0, borderRight: `1px solid ${C.border}`,
        padding: '20px 24px', overflowY: 'auto',
      }}>
        <MoneyCalendar
          year={viewYear}
          month={viewMonth}
          selectedDay={selectedDay}
          transactions={transactions}
          onSelectDay={setSelectedDay}
          onPrevMonth={prevMonth}
          onNextMonth={nextMonth}
        />

        {/* The envelopes, where the money is actually being looked at */}
        <div style={{ marginTop: 18 }}>
          <BudgetQuickPay />
        </div>

        {/* Selected day summary */}
        {selectedDay && selectedDayTx.length > 0 && (
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: C.textMuted, letterSpacing: '0.8px', marginBottom: 10 }}>
              {selectedDay}
            </div>
            {selectedDayTx.map(tx => {
              const cat = tx.categoryId ? categories.find(c => c.id === tx.categoryId) : null
              const isExp = tx.type === 'expense'
              return (
                <div
                  key={tx.id}
                  onClick={() => setTxModal({ open: true, tx })}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '6px 0', borderBottom: `1px solid ${C.border}`,
                    cursor: 'pointer', gap: 8,
                  }}
                >
                  <span style={{ fontSize: 12, color: C.textDim, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {cat?.icon ?? (isExp ? '💳' : '💼')} {tx.payee?.trim() || cat?.name || 'Tx'}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: isExp ? RED : GREEN, flexShrink: 0 }}>
                    {isExp ? '−' : '+'}{(tx.currency ?? 'EGP')} {Math.abs(tx.amount).toLocaleString('en-US')}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Right panel — the month */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>

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
            <div style={{ fontSize: 13, color: C.textMuted, textAlign: 'center', padding: '32px 0' }}>
              No transactions in {MONTH_NAMES[viewMonth]}
            </div>
          )}

          {/* Net cashflow summary */}
          {monthTx.length > 0 && (() => {
            const inc = monthTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
            const exp = monthTx.filter(t => t.type === 'expense').reduce((s, t) => s + Math.abs(t.amount), 0)
            const net = inc - exp
            return (
              <div style={{
                marginTop: 16, paddingTop: 12,
                borderTop: `1px solid ${C.border}`,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <span style={{ fontSize: 12, color: RED, fontWeight: 600 }}>
                  −EGP {exp.toLocaleString('en-US')}
                </span>
                <span style={{ fontSize: 13, fontWeight: 700, color: net >= 0 ? GREEN : RED }}>
                  Net {net >= 0 ? '+' : ''}EGP {Math.abs(net).toLocaleString('en-US')}
                </span>
                <span style={{ fontSize: 12, color: GREEN, fontWeight: 600 }}>
                  +EGP {inc.toLocaleString('en-US')}
                </span>
              </div>
            )
          })()}
      </div>

      </div>{/* end Main content flex */}

      {/* Transaction detail modal */}
      {txModal.open && txModal.tx && (
        <TxModal
          tx={txModal.tx}
          categories={categories}
          accounts={accounts}
          onClose={() => setTxModal({ open: false, tx: null })}
        />
      )}
    </div>
  )
}

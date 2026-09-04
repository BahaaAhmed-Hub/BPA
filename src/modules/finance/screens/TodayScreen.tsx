import { useState } from 'react'
import { useFinanceStore } from '../financeStore'
import { CategoryGlyph } from '../components/CategoryGlyph'
import { TransactionModal } from '../modals/TransactionModal'
import type { Transaction } from '../types'
import { POSITIVE, NEGATIVE, POSITIVE_TINT, NEGATIVE_TINT } from '../../../lib/moneyColors'
import { acct, group } from '../format'

// ── Palette ───────────────────────────────────────────────────────────────────

const RED   = NEGATIVE
const GREEN = POSITIVE

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
  const signed = isIncome || isTransfer ? Math.abs(amount) : -Math.abs(amount)
  return (
    <span style={{
      fontSize: 13, fontWeight: 700,
      color,
      whiteSpace: 'nowrap',
      flexShrink: 0,
    }}>
      {isTransfer ? '↔ ' : ''}{acct(signed, { currency: cur })}
    </span>
  )
}

interface TxModalState { open: boolean; tx: Transaction | null }

/** A day cell is about six characters wide. Anything past a hundred thousand
 *  gets abbreviated rather than clipped — "100k" reads, "+100…" does not. */
function cellAmount(n: number): string {
  const a = Math.abs(n)
  if (a >= 100000) {
    const k = a / 1000
    return `${k >= 1000 ? `${(k / 1000).toFixed(k % 1000 === 0 ? 0 : 1)}m` : `${k.toFixed(k % 1 === 0 ? 0 : 1)}k`}`
  }
  return group(a)
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

  const ROUND_BTN = {
    width: 28, height: 28, borderRadius: '50%',
    background: '#FFFFFF', border: '1px solid #E8E1CE',
    color: '#6C6553', fontSize: 15, lineHeight: 1, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  } as const

  const chip = (label: string, value: string, color: string, tint: string) => (
    <span style={{
      display: 'inline-flex', alignItems: 'baseline', gap: 5,
      background: tint, borderRadius: 999, padding: '4px 11px',
      fontSize: 10.5, fontWeight: 600, letterSpacing: '0.04em',
      textTransform: 'uppercase' as const, color: '#6C6553',
    }}>
      {label}
      <b style={{ fontFamily: 'Outfit, sans-serif', fontSize: 12.5, letterSpacing: 0, color, fontVariantNumeric: 'tabular-nums' }}>{value}</b>
    </span>
  )

  return (
    <div style={{ userSelect: 'none' as const }}>
      {/* Month nav + totals */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' as const }}>
        <button onClick={onPrevMonth} style={ROUND_BTN} title="Previous month">‹</button>
        <button onClick={onNextMonth} style={ROUND_BTN} title="Next month">›</button>
        <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 21, fontWeight: 600, color: '#191712', letterSpacing: '-0.03em' }}>
          {MONTH_NAMES[month]} <span style={{ color: '#9B9180' }}>{year}</span>
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {chip('Out', monthOut > 0 ? acct(-monthOut) : '–', NEGATIVE, NEGATIVE_TINT)}
          {chip('In',  monthIn  > 0 ? acct(monthIn)   : '–', POSITIVE, POSITIVE_TINT)}
        </span>
      </div>

      {/* Calendar card */}
      <div style={{
        background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 20,
        padding: 14, boxShadow: '0 1px 3px rgba(25,23,18,0.06)',
      }}>
        {/* Day headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, marginBottom: 6 }}>
          {['SAT','SUN','MON','TUE','WED','THU','FRI'].map(d => (
            <div key={d} style={{
              textAlign: 'center' as const, fontSize: 10, fontWeight: 700,
              letterSpacing: '0.1em', color: '#9B9180', padding: '2px 0 6px',
            }}>{d}</div>
          ))}
        </div>
        {/* Cells grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
          {cells.map((day, i) => {
            if (!day) return <div key={i} style={{ minHeight: 78 }} />
            const dateStr = `${year}-${String(month + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
            const isToday    = dateStr === todayStr
            const isSelected = dateStr === selectedDay
            const net        = dayNetMap.get(dateStr) ?? 0
            const payees     = dayTxMap.get(dateStr) ?? []
            const netColor   = net > 0 ? '#0C8140' : net < 0 ? '#C62828' : '#9B9180'

            return (
              <div
                key={i}
                onClick={() => onSelectDay(isSelected ? '' : dateStr)}
                style={{
                  borderRadius: 13, padding: '8px 9px 9px',
                  display: 'flex', flexDirection: 'column', gap: 3,
                  minHeight: 78, minWidth: 0, overflow: 'hidden', boxSizing: 'border-box' as const,
                  background: isSelected ? '#FBF3D2' : '#FAF7EC',
                  border: `1px solid ${isSelected ? '#F5D14E' : '#F3EEE0'}`,
                  boxShadow: isSelected ? '0 1px 4px rgba(25,23,18,0.10)' : 'none',
                  cursor: 'pointer', transition: 'background 120ms, border-color 120ms',
                }}
              >
                <span style={{
                  fontFamily: 'Outfit, sans-serif', fontSize: 12.5, fontWeight: 600,
                  width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  marginLeft: -2,
                  background: isToday ? '#191712' : 'transparent',
                  color: isToday ? '#FFFFFF' : '#4A4438',
                }}>
                  {day}
                </span>
                {net !== 0 && (
                  <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 12.5, fontWeight: 600, color: netColor, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {net < 0 ? `(${cellAmount(net)})` : cellAmount(net)}
                  </span>
                )}
                {payees.slice(0, 2).map((p, pi) => (
                  <span key={pi} style={{ fontSize: 10, color: '#8A8271', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p}</span>
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
  const { transactions, categories, accounts, upsertTransaction, removeTransaction } = useFinanceStore()
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
          <CategoryGlyph icon={cat?.icon ?? acct?.emoji ?? (isExp ? '💳' : '💼')} size={18} />
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
            <span style={{ fontSize: 12, color: NEGATIVE, fontWeight: 600 }}>{acct(-todayExp, { currency: 'EGP' })}</span>
            <span style={{ fontSize: 12, color: POSITIVE, fontWeight: 600 }}>{acct(todayInc, { currency: 'EGP' })}</span>
          </div>
        )}
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      {/* Left panel — calendar */}
      <div style={{
        flex: '0 1 52%', minWidth: 360, maxWidth: 780,
        borderRight: `1px solid ${C.border}`,
        padding: '20px 22px 26px', overflowY: 'auto',
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
                  <span style={{ fontSize: 12, color: C.textDim, flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <CategoryGlyph icon={cat?.icon ?? (isExp ? '💳' : '💼')} size={13} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {tx.payee?.trim() || cat?.name || 'Tx'}
                    </span>
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: isExp ? RED : GREEN, flexShrink: 0 }}>
                    {acct(isExp ? -Math.abs(tx.amount) : Math.abs(tx.amount), { currency: tx.currency ?? 'EGP' })}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Right panel — the month */}
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '24px 28px' }}>

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
                  {acct(-exp, { currency: 'EGP' })}
                </span>
                <span style={{ fontSize: 13, fontWeight: 700, color: net >= 0 ? GREEN : RED }}>
                  Net {acct(net, { currency: 'EGP' })}
                </span>
                <span style={{ fontSize: 12, color: GREEN, fontWeight: 600 }}>
                  {acct(inc, { currency: 'EGP' })}
                </span>
              </div>
            )
          })()}
      </div>

      </div>{/* end Main content flex */}

      {/* Transaction detail modal */}
      {txModal.open && (
        <TransactionModal
          transaction={txModal.tx}
          accounts={accounts}
          categories={categories}
          history={transactions}
          onSave={tx => { void upsertTransaction(tx); setTxModal({ open: false, tx: null }) }}
          onDelete={id => { void removeTransaction(id); setTxModal({ open: false, tx: null }) }}
          onClose={() => setTxModal({ open: false, tx: null })}
        />
      )}
    </div>
  )
}

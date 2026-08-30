import { useState, useMemo } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FinanceCategory {
  id: string
  name: string
  icon?: string
  color?: string
}

export interface FinanceAccount {
  id: string
  name: string
  emoji?: string
  color?: string
}

export interface Transaction {
  id: string
  date: string          // 'YYYY-MM-DD'
  type: 'income' | 'expense' | 'transfer'
  amount: number        // always positive
  payee?: string
  categoryId?: string
  accountId?: string
  currency?: string
  notes?: string
}

// ── Palette ───────────────────────────────────────────────────────────────────

const RED   = '#E05252'
const GREEN = '#1D9E75'

const C = {
  bg:      'var(--sb-page)',
  surface: 'var(--sb-card)',
  border:  'var(--sb-border)',
  textPri: 'var(--sb-ink-1)',
  textDim: 'var(--sb-ink-2)',
  textMuted: 'var(--sb-ink-3)',
  accent:  'var(--sb-ink-1)',
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
  categories: FinanceCategory[]
  accounts: FinanceAccount[]
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
          {tx.notes && (
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Notes</div>
              <div style={{ fontSize: 13, color: C.textDim }}>{tx.notes}</div>
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

// ── Mini Calendar ─────────────────────────────────────────────────────────────

function MiniCalendar({
  year, month,
  selectedDay,
  txDates,
  onSelectDay,
  onPrevMonth,
  onNextMonth,
}: {
  year: number
  month: number
  selectedDay: string | null
  txDates: Set<string>
  onSelectDay: (d: string) => void
  onPrevMonth: () => void
  onNextMonth: () => void
}) {
  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)

  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const cells: (number | null)[] = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div style={{ userSelect: 'none' }}>
      {/* Month nav */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <button onClick={onPrevMonth} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, fontSize: 16, padding: '0 4px' }}>‹</button>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.textPri }}>{MONTH_NAMES[month]} {year}</span>
        <button onClick={onNextMonth} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, fontSize: 16, padding: '0 4px' }}>›</button>
      </div>
      {/* Day headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
        {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: 10, color: C.textMuted, fontWeight: 600 }}>{d}</div>
        ))}
      </div>
      {/* Cells */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
        {cells.map((day, i) => {
          if (!day) return <div key={i} />
          const dateStr = `${year}-${String(month + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
          const isToday    = dateStr === todayStr
          const isSelected = dateStr === selectedDay
          const hasTx      = txDates.has(dateStr)
          return (
            <button
              key={i}
              onClick={() => onSelectDay(isSelected ? '' : dateStr)}
              style={{
                width: '100%', aspectRatio: '1', borderRadius: 6,
                border: isSelected ? `1px solid ${C.accent}` : isToday ? `1px solid ${C.border}` : '1px solid transparent',
                background: isSelected ? `${C.accent}22` : 'transparent',
                color: isToday ? C.accent : C.textDim,
                fontSize: 13, fontWeight: isToday ? 700 : 400,
                cursor: 'pointer', position: 'relative',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {day}
              {hasTx && (
                <span style={{
                  position: 'absolute', bottom: 2, left: '50%', transform: 'translateX(-50%)',
                  width: 4, height: 4, borderRadius: '50%',
                  background: isSelected ? C.accent : C.textMuted,
                }} />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Main Screen ───────────────────────────────────────────────────────────────

interface TodayScreenProps {
  transactions?: Transaction[]
  categories?: FinanceCategory[]
  accounts?: FinanceAccount[]
}

export function TodayScreen({
  transactions = [],
  categories   = [],
  accounts     = [],
}: TodayScreenProps) {
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

  const txDates = useMemo(() => new Set(transactions.map(tx => tx.date)), [transactions])

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

  return (
    <div style={{ display: 'flex', height: '100%', background: C.bg }}>
      {/* Left panel — calendar */}
      <div style={{
        width: 360, flexShrink: 0, borderRight: `1px solid ${C.border}`,
        padding: '24px 24px', overflowY: 'auto',
      }}>
        <MiniCalendar
          year={viewYear}
          month={viewMonth}
          selectedDay={selectedDay}
          txDates={txDates}
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

      {/* Right panel — month list */}
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

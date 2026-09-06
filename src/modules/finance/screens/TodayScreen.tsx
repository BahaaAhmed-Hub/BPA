import { useState, useMemo } from 'react'
import { useFinanceStore } from '../financeStore'
import { CategoryGlyph } from '../components/CategoryGlyph'
import { TransactionModal } from '../modals/TransactionModal'
import type { Transaction } from '../types'
import { POSITIVE, NEGATIVE, POSITIVE_TINT, NEGATIVE_TINT } from '../../../lib/moneyColors'
import { acct, group } from '../format'
import { toBase, baseCurrency, currenciesNeedingRates } from '../fx'
import { findDuplicates } from '../duplicates'
import { DuplicateMark } from '../components/DuplicateMark'
import { isUnpaid, unpaidRow, settled, whenPaid, UNPAID_TITLE } from '../unpaid'
import { isoDate } from '../dates'

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

/** "Thursday, 4 September" — the eyebrow uppercases it. */
function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
}

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
  const todayStr = isoDate(today)

  // The week runs Saturday-first here, but getDay() counts from Sunday, so the
  // first of the month landed one column early and every date sat under the
  // wrong weekday.
  const firstDay = (new Date(year, month, 1).getDay() + 1) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const monthPrefix = `${year}-${String(month + 1).padStart(2,'0')}`

  // Build per-day net map. Everything is converted into the base currency
  // first: a day with 250 USD on it is not a day with 250 EGP on it, and a
  // currency with no rate behind it is left out rather than added at face
  // value.
  const base = baseCurrency()
  const dayNetMap = new Map<string, number>()
  const dayTxMap  = new Map<string, string[]>() // dateStr → payee names
  // A day's figure is what moved that day. An unpaid entry is still in the
  // feed below, marked; it just has not happened yet.
  settled(transactions).forEach(tx => {
    // A day on this calendar is a day money moved, so an entry sits on the day
    // it was paid rather than the day it was owed. The feed below reads the
    // same date — a cell saying 3,500 with nothing under it when you tap it is
    // worse than either choice.
    const day = whenPaid(tx)
    if (!day.startsWith(monthPrefix)) return
    const v = toBase(Math.abs(tx.amount), tx.currency, base)
    if (v === null) return
    const prev = dayNetMap.get(day) ?? 0
    const delta = tx.type === 'income' ? v : -v
    dayNetMap.set(day, prev + delta)
    const payees = dayTxMap.get(day) ?? []
    if (tx.payee?.trim()) payees.push(tx.payee.trim())
    dayTxMap.set(day, payees)
  })

  const cells: (number | null)[] = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  // Monthly totals
  const inBase = (t: Transaction) => toBase(Math.abs(t.amount), t.currency, base) ?? 0
  const monthTxs = settled(transactions).filter(t => whenPaid(t).startsWith(monthPrefix))
  const monthOut = monthTxs.filter(t => t.type === 'expense').reduce((s, t) => s + inBase(t), 0)
  const monthIn  = monthTxs.filter(t => t.type === 'income').reduce((s, t) => s + inBase(t), 0)
  const unrated  = currenciesNeedingRates(monthTxs, base)

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
          {unrated.length > 0 && (
            <span title={`No rate set for ${unrated.join(', ')}, so it is not counted in these totals`}
              style={{
                display: 'inline-flex', alignItems: 'center', borderRadius: 999,
                padding: '4px 10px', background: '#FBF1DC', color: '#8A6D0B',
                fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em',
              }}>{unrated.join(' ')} ?</span>
          )}
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
  const todayStr   = isoDate(today)

  const [viewYear,  setViewYear]  = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [selectedDay, setSelectedDay] = useState<string>(todayStr)
  const [txModal, setTxModal] = useState<TxModalState>({ open: false, tx: null })

  const monthPrefix = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`

  // Entries that look like they were put in twice. Worked out over everything,
  // not just what is on screen, so a pair split across two views still shows.
  const dupes = useMemo(() => findDuplicates(transactions), [transactions])

  // All transactions for the viewed month, sorted by date asc (earliest first)
  const monthTx = transactions
    .filter(tx => whenPaid(tx).startsWith(monthPrefix))
    .sort((a, b) => whenPaid(a).localeCompare(whenPaid(b)))

  const selectedDayTx = selectedDay
    ? transactions
        .filter(tx => whenPaid(tx) === selectedDay)
        .sort((a, b) => whenPaid(a).localeCompare(whenPaid(b)))
    : []

  // The feed follows the calendar: a day while one is picked in the month on
  // screen, the whole month otherwise.
  const showingDay = Boolean(selectedDay) && selectedDay.startsWith(monthPrefix)
  const feed = showingDay ? selectedDayTx : monthTx

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
    const isFuture = whenPaid(tx) > todayStr
    return (
      <div
        key={tx.id}
        onClick={() => setTxModal({ open: true, tx })}
        title={isUnpaid(tx) ? UNPAID_TITLE : undefined}
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 0', borderBottom: `1px solid ${C.border}`,
          cursor: 'pointer',
          opacity: isFuture ? 0.75 : 1,
          ...unpaidRow(isUnpaid(tx)),
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
            <DuplicateMark scope={dupes.get(tx.id)} />
            {isFuture && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.7 }}>
                <title>Planned (not yet paid)</title>
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            )}
          </div>
          <div style={{
            fontSize: 12, color: C.textMuted, marginTop: 2, display: 'flex', gap: 6,
            minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {/* The row is filed by the day the money moved, so that is the
                date it shows. Where the two differ, the due date is on hover. */}
            <span style={{ flexShrink: 0 }}
              title={isUnpaid(tx) ? `Due ${tx.date}, not paid` : tx.paidAt && tx.paidAt !== tx.date ? `Due ${tx.date}` : undefined}>
              {whenPaid(tx)}
              {tx.paidAt && tx.paidAt !== tx.date && (
                <span style={{ color: C.textMuted, opacity: 0.75 }}> · due {tx.date}</span>
              )}
            </span>
            {cat && tx.payee?.trim() && <span style={{ color: C.textMuted, flexShrink: 0 }}>· {cat.name}</span>}
            {/* The note is an aside about the entry, so it reads as one. */}
            {tx.note?.trim() && (
              <span title={tx.note.trim()} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                ({tx.note.trim()})
              </span>
            )}
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

  const todayTx = settled(transactions).filter(tx => whenPaid(tx) === todayStr)
  const base = baseCurrency()
  const conv = (t: Transaction) => toBase(Math.abs(t.amount), t.currency, base) ?? 0
  const todayExp = todayTx.filter(t => t.type === 'expense').reduce((s, t) => s + conv(t), 0)
  const todayInc = todayTx.filter(t => t.type === 'income').reduce((s, t) => s + conv(t), 0)

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
            <span style={{ fontSize: 12, color: NEGATIVE, fontWeight: 600 }}>{acct(-todayExp, { currency: base })}</span>
            <span style={{ fontSize: 12, color: POSITIVE, fontWeight: 600 }}>{acct(todayInc, { currency: base })}</span>
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

      </div>

      {/* Right panel — the day picked on the calendar, or the whole month */}
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '24px 28px' }}>

          {/* Which day the calendar is pointing at. A day from another month
              stops applying the moment the calendar is paged away from it. */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: C.textMuted, letterSpacing: '0.8px' }}>
              {showingDay ? dayLabel(selectedDay) : MONTH_NAMES[viewMonth]}
            </span>
            {showingDay && (
              <button
                onClick={() => setSelectedDay('')}
                style={{
                  marginLeft: 'auto', background: 'none', border: 'none', padding: 0,
                  fontSize: 11.5, color: C.textMuted, cursor: 'pointer', textDecoration: 'underline',
                }}>
                All of {MONTH_NAMES[viewMonth]}
              </button>
            )}
          </div>

          {feed.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 24 }}>
              {feed.map(tx => renderTxRow(tx))}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: C.textMuted, textAlign: 'center', padding: '32px 0' }}>
              {showingDay
                ? `Nothing on ${dayLabel(selectedDay)}`
                : `No transactions in ${MONTH_NAMES[viewMonth]}`}
            </div>
          )}

          {/* Net cashflow over whatever is being shown — read down the column:
              what came in, what went out, what is left. */}
          {feed.length > 0 && (() => {
            const moved = settled(feed)
            const inc = moved.filter(t => t.type === 'income').reduce((s, t) => s + conv(t), 0)
            const exp = moved.filter(t => t.type === 'expense').reduce((s, t) => s + conv(t), 0)
            const net = inc - exp
            const waiting = feed.length - moved.length
            const line = (label: string, value: string, color: string, strong = false) => (
              <div style={{
                display: 'flex', alignItems: 'baseline', gap: 12,
                padding: strong ? '10px 0 0' : '5px 0',
                borderTop: strong ? `1px solid ${C.border}` : 'none',
                marginTop: strong ? 6 : 0,
              }}>
                <span style={{
                  fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em',
                  textTransform: 'uppercase' as const, color: C.textMuted,
                }}>{label}</span>
                <span style={{
                  marginLeft: 'auto', fontFamily: 'Outfit, sans-serif',
                  fontSize: strong ? 17 : 14.5, fontWeight: strong ? 700 : 600,
                  letterSpacing: '-0.02em', color, fontVariantNumeric: 'tabular-nums',
                }}>{value}</span>
              </div>
            )
            return (
              <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
                {line('In',  acct(inc, { currency: base }), GREEN)}
                {line('Out', acct(-exp, { currency: base }), RED)}
                {line('Net', acct(net, { currency: base }), net >= 0 ? GREEN : RED, true)}
                {waiting > 0 && (
                  <div style={{ fontSize: 10.5, color: RED, marginTop: 7, textAlign: 'right' }}>
                    {waiting} not paid yet, so not counted
                  </div>
                )}
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

import { useState, useEffect, useMemo } from 'react'
import { X, Plus, Trash2, Check } from 'lucide-react'
import type { Transaction, Account, Category, Currency } from '../types'
import { MoneyInput } from '../components/MoneyInput'
import { rememberPayee } from '../payees'
import { acct } from '../format'
import { todayISO, shiftDaysISO } from '../dates'
import { baseCurrency } from '../fx'
import { useFinanceStore } from '../financeStore'
import { ICON, STROKE } from '@/lib/type'
import {
  DISPLAY,
  PILL, ROUND, PillPicker, categoryOptions,
} from './pickers'
import { Segmented } from '@/components/ui'

/** One line being typed. What the whole batch shares — which way the money
 *  went — lives above the grid. The account and the currency are up there too,
 *  but as a *setter* rather than a fact about the batch: they fill every line
 *  and every line can then be changed, because a page of receipts typed up at
 *  once comes off whichever card was in your hand.
 *
 *  A line can also stand for the same entry repeated: `from` to `to` at
 *  `every`. `to` follows `from` until it is touched, so a line is a single
 *  entry unless it is deliberately made otherwise, and `every` starts empty —
 *  a range with no interval is still one entry, and the count in the footer
 *  says so before anything is written. */
interface Draft {
  key: string
  from: string
  to: string
  /** Until the end date is edited it mirrors the start, so moving the start
   *  moves both rather than leaving an accidental range behind. */
  toTouched: boolean
  every: Interval
  payee: string
  categoryId: string
  amount: number
  /** Which account this line leaves from or lands in. A batch used to be one
   *  account for every line, which is right for a month of card spending and
   *  wrong for a page of receipts typed up at once — those come off whichever
   *  card was in your hand. The picker at the top sets every line, the way the
   *  Paid control does; a line can still be changed after. */
  accountId: string
  /** Follows the line's own account, because an entry is stored in the money
   *  it was actually in. A USD card's entry filed as EGP is not wrong by much
   *  on one line and is nonsense on a page of them. */
  currency: Currency
  /** Whether the money has actually moved. Unpaid entries carry no payment
   *  date at all, which is what every screen reads to mark them. */
  paid: boolean
  /** The day it was paid. Mirrors the start date until it is touched, the
   *  same way the end date does — an entry is usually paid on the day it is
   *  filed, and typing the date twice for every line is a tax. */
  paidOn: string
  paidOnTouched: boolean
}

type Interval = '' | 'week' | 'fortnight' | 'month' | 'quarter' | 'year'

const INTERVALS: { id: Interval; label: string }[] = [
  { id: '',          label: 'once' },
  { id: 'week',      label: 'week' },
  { id: 'fortnight', label: '2 weeks' },
  { id: 'month',     label: 'month' },
  { id: 'quarter',   label: 'quarter' },
  { id: 'year',      label: 'year' },
]

const BLANK_ROWS = 5

function blank(date: string, paid: boolean, accountId: string, currency: Currency): Draft {
  return {
    key: crypto.randomUUID(), from: date, to: date, toTouched: false, every: '',
    payee: '', categoryId: '', amount: 0, accountId, currency,
    paid, paidOn: date, paidOnTouched: false,
  }
}

/** Adding a month to the 31st has to land somewhere: the last day of the month
 *  it lands in, so a rent line dated the 31st does not skip February. */
function step(iso: string, every: Exclude<Interval, ''>, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (every === 'week')      return shiftDays(iso, 7 * n)
  if (every === 'fortnight') return shiftDays(iso, 14 * n)
  const months = every === 'month' ? n : every === 'quarter' ? 3 * n : 12 * n
  const target = new Date(y, m - 1 + months, 1)
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  const day = Math.min(d, last)
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const shiftDays = shiftDaysISO

/** Every date one line stands for. No interval means the line is what it looks
 *  like: one entry, on its start date. */
export function datesFor(row: Pick<Draft, 'from' | 'to' | 'every'>): string[] {
  if (!row.from) return []
  if (!row.every) return [row.from]
  const end = row.to && row.to >= row.from ? row.to : row.from
  const out: string[] = []
  for (let n = 0; n < 400; n++) {
    const d = step(row.from, row.every, n)
    if (d > end) break
    out.push(d)
  }
  return out.length > 0 ? out : [row.from]
}

const CELL: React.CSSProperties = {
  height: 'var(--sb-h-pill)', boxSizing: 'border-box', padding: '0 10px', borderRadius: 'var(--sb-r-sm)',
  background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-1)',
  fontSize: 'var(--sb-t-body-s)', fontFamily: 'inherit', outline: 'none', minWidth: 0, width: '100%',
}

/** The seven tracks, written once so the heads and the lines cannot drift
 *  apart. A grid item defaults to min-width:auto, which lets a control wider
 *  than its track paint straight over the next one — a date field spelling out
 *  "5 Sep 2026" did exactly that — so every cell below sets minWidth: 0 and the
 *  whole grid scrolls sideways rather than collapsing. */
// The date tracks are sized for the longest thing a browser puts in one:
// Safari spells it "5 Sep 2026" and adds a picker glyph, where Chromium shows
// a narrower 09/05/2026.
const COLS = '142px 142px 100px minmax(140px, 1fr) minmax(150px, 186px) minmax(150px, 186px) 108px 158px 30px'
const GRID_MIN = 1196
const CELL_BOX: React.CSSProperties = { minWidth: 0, display: 'flex' }

export function BulkEntryModal({ accounts, categories, onSave, onClose }: {
  accounts: Account[]
  categories: Category[]
  onSave: (txs: Transaction[]) => void
  onClose: () => void
}) {
  const today = todayISO()
  const year  = useFinanceStore(s => s.currentYear)

  const [kind, setKind]           = useState<'expense' | 'income'>('expense')
  // Which account is not something to guess. Preselecting the first in the
  // list filed whole batches against whatever happened to sort first — the
  // entries were saved, they were simply nowhere the person who typed them
  // thought to look. So it starts empty and nothing can be written until it is
  // answered, unless there is only one account and there is nothing to get
  // wrong. The difference now is that this fills the lines rather than
  // standing for them: each line carries its own, and the footer says when
  // they differ.
  const only = accounts.length === 1 ? accounts[0] : undefined
  const [accountId, setAccountId] = useState(only?.id ?? '')
  const [currency, setCurrency]   = useState<Currency>(
    (only?.currency ?? baseCurrency()) as Currency)
  // What a new line starts as. Bulk entry is mostly things already paid, so
  // that is the default — but a batch of bills that are only due is one press
  // away, and either way a line can be set on its own afterwards.
  const [batchPaid, setBatchPaid] = useState(true)
  const [rows, setRows]           = useState<Draft[]>(() =>
    Array.from({ length: BLANK_ROWS }, () =>
      blank(today, true, only?.id ?? '', (only?.currency ?? baseCurrency()) as Currency)))

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])

  const options = useMemo(() => categoryOptions(categories, kind), [categories, kind])
  const tone    = kind === 'income' ? 'var(--sb-positive)' : 'var(--sb-negative)'

  // A line with nothing in it is not an entry, it is an empty row waiting to be
  // used — only what has an amount gets written. A line that repeats counts
  // once per date it stands for.
  const ready = rows
    .filter(r => r.amount > 0)
    .map(r => ({ row: r, dates: datesFor(r) }))
  const count = ready.reduce((n, r) => n + r.dates.length, 0)
  // One total per currency. Lines can now sit on different accounts, and
  // adding 250 USD to 4,000 EGP gives a number that is true of nothing — the
  // one rule this module has never broken.
  const totals = new Map<string, number>()
  for (const r of ready) {
    totals.set(r.row.currency, (totals.get(r.row.currency) ?? 0) + r.row.amount * r.dates.length)
  }
  const unpaid = ready.filter(r => !r.row.paid).reduce((n, r) => n + r.dates.length, 0)
  // Every line that will be written needs an account of its own; the header's
  // is only what fills them in.
  const noAccount = ready.filter(r => !r.row.accountId).length
  const spread = new Set(ready.map(r => r.row.accountId)).size
  const whereOne = accounts.find(a => a.id === ready[0]?.row.accountId)?.name ?? 'one account'
  const canSave = count > 0 && noAccount === 0

  // Everything in this app is fetched a year at a time. A line dated outside
  // the year on screen is saved and then shows up nowhere, which reads as
  // though it was thrown away — so say where the batch is going to land
  // before it is written. (Saving follows it there; this is the chance to
  // notice it was not meant.)
  const elsewhere = [...new Set(
    ready.flatMap(r => r.dates).map(d => Number(d.slice(0, 4))).filter(y => y !== year),
  )].sort()

  function patch(key: string, change: Partial<Draft>) {
    setRows(rs => rs.map(r => {
      if (r.key !== key) return r
      const next = { ...r, ...change }
      // The end date and the payment date both follow the start until
      // somebody moves them.
      if (change.from !== undefined && !r.toTouched) next.to = change.from
      if (change.from !== undefined && !r.paidOnTouched) next.paidOn = change.from
      return next
    }))
  }
  function addRow() {
    // A new line picks up where the last one left off — its date, and the
    // account and currency it was on. Typing five receipts from one card and
    // having the sixth land back on the batch default is the kind of small
    // wrongness nobody checks for.
    setRows(rs => {
      const last = rs[rs.length - 1]
      return [...rs, blank(last?.from ?? today, batchPaid, last?.accountId ?? accountId, last?.currency ?? currency)]
    })
  }
  function dropRow(key: string) {
    setRows(rs => (rs.length > 1 ? rs.filter(r => r.key !== key) : [blank(today, batchPaid, accountId, currency)]))
  }
  /** The batch control sets every line; a line can still be changed after. */
  function setAllPaid(paid: boolean) {
    setBatchPaid(paid)
    setRows(rs => rs.map(r => ({ ...r, paid })))
  }
  /** Same contract as Paid: fill every line, then let any line differ. The
   *  currency goes with it, because it is a fact about the account. */
  function setAllAccount(id: string) {
    setAccountId(id)
    const a = accounts.find(x => x.id === id)
    if (a) setCurrency(a.currency)
    setRows(rs => rs.map(r => ({ ...r, accountId: id, ...(a ? { currency: a.currency } : {}) })))
  }
  function setAllCurrency(c: Currency) {
    setCurrency(c)
    setRows(rs => rs.map(r => ({ ...r, currency: c })))
  }

  function handleSave() {
    if (!canSave) return
    const stamp = new Date().toISOString()
    onSave(ready.flatMap(({ row, dates }) => {
      rememberPayee(row.payee)
      return dates.map(date => ({
        id:         crypto.randomUUID(),
        accountId:  row.accountId,
        amount:     row.amount,
        currency:   row.currency,
        type:       kind,
        payee:      row.payee.trim(),
        categoryId: row.categoryId || undefined,
        date,
        // No payment date is what "not paid" is: every screen reads that, and
        // an entry without one is money still owed. A line that repeats is
        // paid on each occurrence's own day — one date cannot stand for
        // twelve months — so a hand-set payment date applies to a single
        // entry only.
        paidAt:     row.paid ? (row.paidOnTouched && dates.length === 1 ? row.paidOn : date) : undefined,
        isCleared:  row.paid,
        isRecurring: dates.length > 1,
        createdAt:  stamp,
      }))
    }))
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'var(--sb-scrim)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 1100, maxHeight: '88vh', display: 'flex', flexDirection: 'column',
          background: 'var(--sb-header)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-card)',
          boxShadow: 'var(--sb-shadow-frame)', padding: '18px 20px 20px',
        }}>

        {/* Eyebrow + close */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            background: 'var(--sb-accent-tint)', borderRadius: 'var(--sb-r-pill)', padding: '5px 12px',
            fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: 'var(--sb-ink-3)',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: 'var(--sb-r-pill)', background: tone }} />
            Bulk entry
          </span>
          <button onClick={onClose} title="Close" style={{ ...ROUND, marginLeft: 'auto' }}><X size={ICON.sm} /></button>
        </div>

        {/* What the whole batch shares */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <Segmented
            size="lg"
            aria-label="What this batch is"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'expense' as const, label: 'Expenses' },
              { value: 'income'  as const, label: 'Income' },
            ]}
          />

          <Segmented
            size="lg"
            aria-label="Whether the batch is paid"
            value={batchPaid === true ? 'paid' : batchPaid === false ? 'unpaid' : ''}
            onChange={v => setAllPaid(v === 'paid')}
            options={[
              { value: 'paid'   as const, label: 'Paid',     title: 'Sets every line; a line can still be changed on its own' },
              { value: 'unpaid' as const, label: 'Not paid', title: 'Sets every line; a line can still be changed on its own' },
            ]}
          />

          {/* Fills every line, the way Paid does — not a fact about the batch.
              Outlined while any line that would be written still has no
              account, because that is the one thing that cannot be guessed. */}
          <span style={{
            flex: 1, minWidth: 200, display: 'flex', borderRadius: 'var(--sb-r-nav)',
            boxShadow: noAccount === 0 ? 'none' : `0 0 0 2px var(--sb-accent)`,
          }}>
            <PillPicker
              value={accountId}
              onChange={setAllAccount}
              placeholder="Put every line on…"
              compact
              options={accounts.map(a => ({ id: a.id, label: a.name, glyph: a.emoji, tint: a.color }))} />
          </span>

          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <span style={{ ...PILL, height: 'var(--sb-h-pill)', padding: '0 12px', fontSize: 'var(--sb-t-body-s)', fontWeight: 600 }}>{currency}</span>
            <select value={currency} onChange={e => setAllCurrency(e.target.value as Currency)}
              style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', cursor: 'pointer', border: 'none' }}>
              {['EGP', 'USD', 'AED'].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </span>
        </div>

        <div style={{ height: 1, background: 'var(--sb-hairline)', margin: '16px 0 10px' }} />

        {/* Heads and lines share one sideways scroller, so they stay in step */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', margin: '0 -2px', padding: '0 2px' }}>
        <div style={{ minWidth: GRID_MIN }}>
        <div style={{
          display: 'grid', gridTemplateColumns: COLS, gap: 8,
          fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.1em', color: 'var(--sb-ink-4)',
          textTransform: 'uppercase', padding: '0 2px 7px',
          position: 'sticky', top: 0, background: 'var(--sb-header)', zIndex: 1,
        }}>
          <span style={{ minWidth: 0 }}>Starts</span>
          <span style={{ minWidth: 0 }}>Ends</span>
          <span style={{ minWidth: 0 }} title="Leave this empty and the line is a single entry on its start date">Every</span>
          <span style={{ minWidth: 0 }}>Paid to</span>
          <span style={{ minWidth: 0 }}>Category</span>
          <span style={{ minWidth: 0 }} title="Which account this line leaves from or lands in">Account</span>
          <span style={{ textAlign: 'right', minWidth: 0 }}>Amount</span>
          <span style={{ minWidth: 0 }} title="Clear the tick and the entry is money still owed">Paid</span>
          <span />
        </div>
          {rows.map((r, i) => {
            const repeats = r.amount > 0 ? datesFor(r).length : datesFor(r).length
            return (
            <div key={r.key} style={{
              display: 'grid', gridTemplateColumns: COLS,
              gap: 8, alignItems: 'center', marginBottom: 6,
            }}>
              <span style={CELL_BOX}>
                <input type="date" value={r.from} onChange={e => patch(r.key, { from: e.target.value })}
                  style={{ ...CELL, fontFamily: DISPLAY, padding: '0 8px' }} />
              </span>
              <span style={CELL_BOX}>
                <input type="date" value={r.to} min={r.from}
                  onChange={e => patch(r.key, { to: e.target.value, toTouched: true })}
                  title={r.toTouched ? undefined : 'Following the start date until you change it'}
                  style={{
                    ...CELL, fontFamily: DISPLAY, padding: '0 8px',
                    color: r.toTouched ? 'var(--sb-ink-1)' : 'var(--sb-ink-4)',
                    borderStyle: r.toTouched ? 'solid' : 'dashed',
                  }} />
              </span>
              <span style={{ position: 'relative', display: 'flex', minWidth: 0 }}>
                <span style={{
                  ...CELL, display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between',
                  color: r.every ? 'var(--sb-ink-1)' : 'var(--sb-ink-4)',
                }}>
                  {INTERVALS.find(x => x.id === r.every)?.label ?? 'once'}
                  {repeats > 1 && (
                    <span style={{ fontSize: 'var(--sb-t-micro)', fontWeight: 700, color: 'var(--sb-ink-3)' }}>×{repeats}</span>
                  )}
                </span>
                <select value={r.every} onChange={e => patch(r.key, { every: e.target.value as Interval })}
                  style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', cursor: 'pointer', border: 'none' }}>
                  {INTERVALS.map(o => <option key={o.id || 'once'} value={o.id}>{o.label}</option>)}
                </select>
              </span>
              <span style={CELL_BOX}>
                <input value={r.payee} onChange={e => patch(r.key, { payee: e.target.value })}
                  placeholder="Who it went to" style={CELL} />
              </span>
              <span style={CELL_BOX}>
                <PillPicker value={r.categoryId} onChange={id => patch(r.key, { categoryId: id })}
                  placeholder="Uncategorised" compact options={options} />
              </span>
              <span style={{
                ...CELL_BOX, borderRadius: 'var(--sb-r-sm)',
                // Only a line that would actually be written is asked for one.
                boxShadow: !r.accountId && r.amount > 0 ? '0 0 0 2px var(--sb-accent)' : 'none',
              }}>
                <PillPicker
                  value={r.accountId}
                  onChange={id => {
                    const a = accounts.find(x => x.id === id)
                    patch(r.key, { accountId: id, ...(a ? { currency: a.currency } : {}) })
                  }}
                  placeholder="Which account?"
                  compact
                  options={accounts.map(a => ({ id: a.id, label: a.name, glyph: a.emoji, tint: a.color }))} />
              </span>
              <span style={CELL_BOX}>
              <MoneyInput
                value={r.amount}
                min={0}
                onChange={n => patch(r.key, { amount: n })}
                onKeyDown={e => { if (e.key === 'Enter' && i === rows.length - 1) addRow() }}
                placeholder="0"
                style={{
                  ...CELL, textAlign: 'right', fontFamily: DISPLAY, fontWeight: 600,
                  fontVariantNumeric: 'tabular-nums',
                  color: r.amount > 0 ? tone : 'var(--sb-ink-4)',
                }} />
              </span>
              <span style={{ ...CELL_BOX, alignItems: 'center' }}>
                <span style={{
                  ...CELL, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '0 8px',
                  borderStyle: r.paid ? 'solid' : 'dotted',
                  borderColor: r.paid ? 'var(--sb-border)' : 'var(--sb-negative)',
                }}>
                  <button
                    onClick={() => patch(r.key, { paid: !r.paid })}
                    title={r.paid ? 'Paid — click if the money has not moved' : 'Not paid — click once it has'}
                    style={{
                      width: 17, height: 17, flexShrink: 0, padding: 0, borderRadius: 'var(--sb-r-chip)', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: r.paid ? 'var(--sb-ink-1)' : 'transparent',
                      border: `var(--sb-border-emphasis) solid ${r.paid ? 'var(--sb-ink-1)' : 'var(--sb-negative)'}`,
                      color: 'var(--sb-ink-on-dark)',
                    }}>
                    {r.paid && <Check size={ICON.sm} strokeWidth={STROKE.active} />}
                  </button>
                  {r.paid ? (
                    <input type="date" value={r.paidOn}
                      onChange={e => patch(r.key, { paidOn: e.target.value, paidOnTouched: true })}
                      title={r.paidOnTouched ? undefined : 'Following the start date until you change it'}
                      style={{
                        flex: 1, minWidth: 0, height: 30, padding: 0, border: 'none', background: 'transparent',
                        fontFamily: DISPLAY, fontSize: 'var(--sb-t-body-s)', outline: 'none',
                        color: r.paidOnTouched ? 'var(--sb-ink-1)' : 'var(--sb-ink-4)',
                      }} />
                  ) : (
                    <span style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-negative)', fontWeight: 600 }}>Not paid</span>
                  )}
                </span>
              </span>
              <button onClick={() => dropRow(r.key)} title="Remove this line"
                style={{ ...ROUND, width: 28, height: 28, color: 'var(--sb-ink-4)' }}>
                <Trash2 size={ICON.sm} />
              </button>
            </div>
            )
          })}

          <button onClick={addRow}
            style={{
              ...PILL, height: 'var(--sb-h-pill)', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', marginTop: 2,
              background: 'transparent', borderStyle: 'dashed',
            }}>
            <Plus size={ICON.sm} /> Another line
          </button>
        </div>
        </div>

        <div style={{ height: 1, background: 'var(--sb-hairline)', margin: '14px 0' }} />

        {/* What is about to be written */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 'var(--sb-t-body-s)', color: noAccount > 0 && count > 0 ? 'var(--sb-ink-1)' : 'var(--sb-ink-3)' }}>
            {count === 0
              ? 'Nothing to add yet — a line counts once it has an amount'
              : noAccount > 0
                ? `${noAccount} ${noAccount === 1 ? 'line has' : 'lines have'} no account yet`
                : `${count} ${count === 1 ? 'entry' : 'entries'}${
                    count > ready.length ? ` from ${ready.length} ${ready.length === 1 ? 'line' : 'lines'}` : ''
                  } → ${spread === 1 ? whereOne : `${spread} accounts`}${unpaid > 0 ? `, ${unpaid} not paid` : ''}`}
          </span>
          {elsewhere.length > 0 && noAccount === 0 && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 'var(--sb-r-pill)',
              background: 'var(--sb-accent-tint)', border: 'var(--sb-border-width) solid var(--sb-accent)', padding: '4px 11px',
              fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-1)',
            }}>
              dated {elsewhere.join(' & ')}, not {year} — saving goes there
            </span>
          )}
          {/* One figure per currency. Two of them is the honest answer when the
              lines are in two currencies, and it is also the tell that a line
              is on an account you did not mean. */}
          {count > 0 && noAccount === 0 && [...totals].map(([cur, sum]) => (
            <span key={cur} style={{
              fontFamily: DISPLAY, fontSize: 'var(--sb-t-h2)', fontWeight: 700, color: tone,
              fontVariantNumeric: 'tabular-nums',
            }}>
              {acct(kind === 'income' ? sum : -sum, { currency: cur })}
            </span>
          ))}
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={{ ...PILL, height: 38, color: 'var(--sb-ink-3)' }}>Cancel</button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            title={count > 0 && noAccount > 0 ? 'Every line needs an account before it can be written' : undefined}
            style={{
              ...PILL, height: 38, paddingInline: 20, fontWeight: 600,
              background: canSave ? 'var(--sb-ink-1)' : 'var(--sb-field)',
              border: `var(--sb-border-width) solid ${canSave ? 'var(--sb-ink-1)' : 'var(--sb-border)'}`,
              color: canSave ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-4)',
              cursor: canSave ? 'pointer' : 'default',
            }}>
            Add {count || ''} {count === 1 ? 'entry' : 'entries'}
          </button>
        </div>
      </div>
    </div>
  )
}

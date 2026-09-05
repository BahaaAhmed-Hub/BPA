import { useState, useEffect, useMemo } from 'react'
import { X, Plus, Trash2 } from 'lucide-react'
import type { Transaction, Account, Category, Currency } from '../types'
import { MoneyInput } from '../components/MoneyInput'
import { rememberPayee } from '../payees'
import { acct } from '../format'
import {
  INK, MUTED, GHOST, LINE, HAIR, OLIVE, RUST, DISPLAY,
  PILL, ROUND, PillPicker, categoryOptions,
} from './pickers'

/** One line being typed. Everything the whole batch shares — which way the
 *  money went, which account, which currency — lives above the grid, so a line
 *  is only what actually differs between them.
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

function blank(date: string): Draft {
  return { key: crypto.randomUUID(), from: date, to: date, toTouched: false, every: '', payee: '', categoryId: '', amount: 0 }
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

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

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
  height: 34, boxSizing: 'border-box', padding: '0 10px', borderRadius: 9,
  background: '#FFFFFF', border: `1px solid ${LINE}`, color: INK,
  fontSize: 12.5, fontFamily: 'inherit', outline: 'none', minWidth: 0, width: '100%',
}

export function BulkEntryModal({ accounts, categories, onSave, onClose }: {
  accounts: Account[]
  categories: Category[]
  onSave: (txs: Transaction[]) => void
  onClose: () => void
}) {
  const today = new Date().toISOString().slice(0, 10)

  const [kind, setKind]           = useState<'expense' | 'income'>('expense')
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')
  const [currency, setCurrency]   = useState<Currency>(accounts[0]?.currency ?? 'EGP')
  const [rows, setRows]           = useState<Draft[]>(() =>
    Array.from({ length: BLANK_ROWS }, () => blank(today)))

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])

  const options = useMemo(() => categoryOptions(categories, kind), [categories, kind])
  const tone    = kind === 'income' ? OLIVE : RUST

  // A line with nothing in it is not an entry, it is an empty row waiting to be
  // used — only what has an amount gets written. A line that repeats counts
  // once per date it stands for.
  const ready = rows
    .filter(r => r.amount > 0)
    .map(r => ({ row: r, dates: datesFor(r) }))
  const count = ready.reduce((n, r) => n + r.dates.length, 0)
  const total = ready.reduce((s, r) => s + r.row.amount * r.dates.length, 0)

  function patch(key: string, change: Partial<Draft>) {
    setRows(rs => rs.map(r => {
      if (r.key !== key) return r
      const next = { ...r, ...change }
      // The end date follows the start until somebody moves it.
      if (change.from !== undefined && !r.toTouched) next.to = change.from
      return next
    }))
  }
  function addRow() { setRows(rs => [...rs, blank(rs[rs.length - 1]?.from ?? today)]) }
  function dropRow(key: string) {
    setRows(rs => (rs.length > 1 ? rs.filter(r => r.key !== key) : [blank(today)]))
  }

  function handleSave() {
    const stamp = new Date().toISOString()
    onSave(ready.flatMap(({ row, dates }) => {
      rememberPayee(row.payee)
      return dates.map(date => ({
        id:         crypto.randomUUID(),
        accountId,
        amount:     row.amount,
        currency,
        type:       kind,
        payee:      row.payee.trim(),
        categoryId: row.categoryId || undefined,
        date,
        paidAt:     date,
        isCleared:  true,
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
        background: 'rgba(25,23,18,0.42)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 980, maxHeight: '88vh', display: 'flex', flexDirection: 'column',
          background: '#FCFAF4', border: `1px solid ${LINE}`, borderRadius: 20,
          boxShadow: '0 30px 80px rgba(25,23,18,0.28)', padding: '18px 20px 20px',
        }}>

        {/* Eyebrow + close */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            background: '#F3EEE0', borderRadius: 999, padding: '5px 12px',
            fontSize: 11.5, fontWeight: 600, color: MUTED,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: tone }} />
            Bulk entry
          </span>
          <button onClick={onClose} title="Close" style={{ ...ROUND, marginLeft: 'auto' }}><X size={14} /></button>
        </div>

        {/* What the whole batch shares */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', background: '#F1ECDE', borderRadius: 10, padding: 3, gap: 3 }}>
            {(['expense', 'income'] as const).map(k => (
              <button key={k} onClick={() => setKind(k)}
                style={{
                  padding: '0 16px', height: 34, borderRadius: 8, border: 'none', cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: 12.5, fontWeight: kind === k ? 700 : 500,
                  background: kind === k ? '#191712' : 'transparent',
                  color: kind === k ? '#FDF8E7' : MUTED,
                }}>
                {k === 'expense' ? 'Expenses' : 'Income'}
              </button>
            ))}
          </span>

          <span style={{ flex: 1, minWidth: 200, display: 'flex' }}>
            <PillPicker
              value={accountId}
              onChange={id => {
                setAccountId(id)
                const a = accounts.find(x => x.id === id)
                if (a) setCurrency(a.currency)
              }}
              placeholder="Account"
              compact
              options={accounts.map(a => ({ id: a.id, label: a.name, glyph: a.emoji, tint: a.color }))} />
          </span>

          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <span style={{ ...PILL, height: 34, padding: '0 12px', fontSize: 12.5, fontWeight: 600 }}>{currency}</span>
            <select value={currency} onChange={e => setCurrency(e.target.value as Currency)}
              style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', cursor: 'pointer', border: 'none' }}>
              {['EGP', 'USD', 'AED'].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </span>
        </div>

        <div style={{ height: 1, background: HAIR, margin: '16px 0 10px' }} />

        {/* Column heads */}
        <div style={{
          display: 'grid', gridTemplateColumns: '118px 118px 104px 1fr 168px 112px 30px', gap: 8,
          fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: GHOST,
          textTransform: 'uppercase', padding: '0 2px 7px',
        }}>
          <span>Starts</span>
          <span>Ends</span>
          <span title="Leave this empty and the line is a single entry on its start date">Every</span>
          <span>Paid to</span><span>Category</span>
          <span style={{ textAlign: 'right' }}>Amount</span><span />
        </div>

        {/* The lines */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', margin: '0 -2px', padding: '0 2px' }}>
          {rows.map((r, i) => {
            const repeats = r.amount > 0 ? datesFor(r).length : datesFor(r).length
            return (
            <div key={r.key} style={{
              display: 'grid', gridTemplateColumns: '118px 118px 104px 1fr 168px 112px 30px',
              gap: 8, alignItems: 'center', marginBottom: 6,
            }}>
              <input type="date" value={r.from} onChange={e => patch(r.key, { from: e.target.value })}
                style={{ ...CELL, fontFamily: DISPLAY }} />
              <input type="date" value={r.to} min={r.from}
                onChange={e => patch(r.key, { to: e.target.value, toTouched: true })}
                title={r.toTouched ? undefined : 'Following the start date until you change it'}
                style={{
                  ...CELL, fontFamily: DISPLAY,
                  color: r.toTouched ? INK : GHOST,
                  borderStyle: r.toTouched ? 'solid' : 'dashed',
                }} />
              <span style={{ position: 'relative', display: 'flex' }}>
                <span style={{
                  ...CELL, display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between',
                  color: r.every ? INK : GHOST,
                }}>
                  {INTERVALS.find(x => x.id === r.every)?.label ?? 'once'}
                  {repeats > 1 && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: MUTED }}>×{repeats}</span>
                  )}
                </span>
                <select value={r.every} onChange={e => patch(r.key, { every: e.target.value as Interval })}
                  style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', cursor: 'pointer', border: 'none' }}>
                  {INTERVALS.map(o => <option key={o.id || 'once'} value={o.id}>{o.label}</option>)}
                </select>
              </span>
              <input value={r.payee} onChange={e => patch(r.key, { payee: e.target.value })}
                placeholder="Who it went to" style={CELL} />
              <PillPicker value={r.categoryId} onChange={id => patch(r.key, { categoryId: id })}
                placeholder="Uncategorised" compact options={options} />
              <MoneyInput
                value={r.amount}
                min={0}
                onChange={n => patch(r.key, { amount: n })}
                onKeyDown={e => { if (e.key === 'Enter' && i === rows.length - 1) addRow() }}
                placeholder="0"
                style={{
                  ...CELL, textAlign: 'right', fontFamily: DISPLAY, fontWeight: 600,
                  fontVariantNumeric: 'tabular-nums',
                  color: r.amount > 0 ? tone : GHOST,
                }} />
              <button onClick={() => dropRow(r.key)} title="Remove this line"
                style={{ ...ROUND, width: 28, height: 28, color: GHOST }}>
                <Trash2 size={13} />
              </button>
            </div>
            )
          })}

          <button onClick={addRow}
            style={{
              ...PILL, height: 34, fontSize: 12.5, color: MUTED, marginTop: 2,
              background: 'transparent', borderStyle: 'dashed',
            }}>
            <Plus size={13} /> Another line
          </button>
        </div>

        <div style={{ height: 1, background: HAIR, margin: '14px 0' }} />

        {/* What is about to be written */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12.5, color: MUTED }}>
            {count === 0
              ? 'Nothing to add yet — a line counts once it has an amount'
              : `${count} ${count === 1 ? 'entry' : 'entries'}${
                  count > ready.length ? ` from ${ready.length} ${ready.length === 1 ? 'line' : 'lines'}` : ''}`}
          </span>
          {count > 0 && (
            <span style={{
              fontFamily: DISPLAY, fontSize: 17, fontWeight: 700, color: tone,
              fontVariantNumeric: 'tabular-nums',
            }}>
              {acct(kind === 'income' ? total : -total, { currency })}
            </span>
          )}
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={{ ...PILL, height: 38, color: MUTED }}>Cancel</button>
          <button
            onClick={handleSave}
            disabled={count === 0}
            style={{
              ...PILL, height: 38, paddingInline: 20, fontWeight: 600,
              background: count ? '#191712' : '#EDE7D9',
              border: `1px solid ${count ? '#191712' : LINE}`,
              color: count ? '#FDF8E7' : GHOST,
              cursor: count ? 'pointer' : 'default',
            }}>
            Add {count || ''} {count === 1 ? 'entry' : 'entries'}
          </button>
        </div>
      </div>
    </div>
  )
}

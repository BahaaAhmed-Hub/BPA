import { useState, useMemo, useEffect } from 'react'
import { ChevronDown, ChevronRight, ChevronsUpDown, ChevronsDownUp } from 'lucide-react'
import { useFinanceStore } from '../financeStore'
import { CategoryGlyph } from '../components/CategoryGlyph'
import { toBase, baseCurrency, currenciesNeedingRates } from '../fx'
import { acct, outflow } from '../format'

// ─── 16F · Financials YTD ─────────────────────────────────────────────────────
// Spreadsheet-style table: each income/expense category as a row,
// 12 monthly columns, totals + cumulative running cash at the bottom.

/** A header cell that stays put needs its own bottom edge: with
 *  border-collapse the row's border belongs to the cells under it, and those
 *  scroll away. */
const HEAD_EDGE: React.CSSProperties = { boxShadow: 'inset 0 -2px 0 #E8E1CE' }

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const OLIVE = '#0C8140'
const RUST  = '#C62828'

/** Income reads plain, money leaving reads bracketed, an empty cell reads as a
 *  dash — the three things a ledger column does. `fmt` takes the figure as it
 *  is stored (a magnitude for both sections) and `out` says which section it
 *  belongs to. */
function fmt(v: number): string { return acct(v, { zero: '–' }) }
function fmtOut(v: number): string { return v === 0 ? '–' : outflow(v) }

function netColor(v: number) { return v > 0 ? OLIVE : v < 0 ? RUST : '#9B9180' }

// ─── Main ─────────────────────────────────────────────────────────────────────

interface Line { cat: { id: string; name: string; icon: string; color: string }; amounts: number[] }
interface Row extends Line { children: Line[] }

/** One category's line, and — when it is open — its parts underneath. Both
 *  sections drew this twice, with the same markup and slightly different
 *  colours, which is how the income rows kept a stray element the expense ones
 *  did not. */
function CategoryRows({ row, tone, open, hidden, onToggleOpen, onToggleHide, months, ROW_H, numCell, fmt }: {
  row: Row
  tone: string
  open: boolean
  hidden: (id: string) => boolean
  onToggleOpen: (id: string) => void
  onToggleHide: (id: string) => void
  months: number[]
  ROW_H: number
  numCell: (v: number, isNet?: boolean) => React.CSSProperties
  fmt: (v: number) => string
}) {
  const isHidden = hidden(row.cat.id)
  const total = months.reduce((s, v) => s + v, 0)
  const kids = row.children

  return (
    <>
      <tr
        onClick={() => onToggleHide(row.cat.id)}
        title={isHidden ? 'Click to include in totals' : 'Click to hide from totals'}
        style={{ borderBottom: '1px solid #F0EBDC', cursor: 'pointer', background: isHidden ? '#FAF7EC' : 'transparent', opacity: isHidden ? 0.45 : 1 }}
      >
        <td style={{ padding: '0 14px', height: ROW_H, position: 'sticky', left: 0, background: isHidden ? '#FAF7EC' : '#FFFFFF', zIndex: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            {/* The arrow opens the row; it must not also hide it. */}
            {kids.length > 0 ? (
              <button
                onClick={e => { e.stopPropagation(); onToggleOpen(row.cat.id) }}
                title={open ? 'Fold its sub-categories away' : `Show its ${kids.length} sub-categories`}
                style={{
                  width: 16, height: 16, padding: 0, flexShrink: 0, borderRadius: 4,
                  background: 'none', border: 'none', cursor: 'pointer', color: '#9B9180',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                {open ? <ChevronDown size={13} strokeWidth={2.2} /> : <ChevronRight size={13} strokeWidth={2.2} />}
              </button>
            ) : <span style={{ width: 16, flexShrink: 0 }} />}
            <span style={{ display: 'inline-flex', color: row.cat.color }}><CategoryGlyph icon={row.cat.icon} size={12} /></span>
            <span style={{ fontSize: 13, color: isHidden ? '#9B9180' : '#191712', textDecoration: isHidden ? 'line-through' : 'none', fontWeight: 500 }}>
              {row.cat.name}
            </span>
            {kids.length > 0 && !open && (
              <span style={{ fontSize: 10, color: '#C5BCA8' }}>+{kids.length}</span>
            )}
          </div>
        </td>
        {months.map((v, mi) => <td key={mi} style={numCell(v)}>{fmt(v)}</td>)}
        <td style={{ ...numCell(total), fontWeight: 700, color: total === 0 ? '#C5BCA8' : tone }}>{fmt(total)}</td>
      </tr>

      {open && kids.map(kid => {
        const kidHidden = hidden(kid.cat.id) || isHidden
        const kidTotal = kid.amounts.reduce((s, v) => s + v, 0)
        return (
          <tr key={kid.cat.id}
            onClick={() => onToggleHide(kid.cat.id)}
            title={hidden(kid.cat.id) ? 'Click to include in totals' : 'Click to hide from totals'}
            style={{ borderBottom: '1px solid #F5F1E6', cursor: 'pointer', background: kidHidden ? '#FAF7EC' : '#FDFCF7', opacity: kidHidden ? 0.45 : 1 }}
          >
            <td style={{ padding: '0 14px', height: ROW_H - 4, position: 'sticky', left: 0, background: kidHidden ? '#FAF7EC' : '#FDFCF7', zIndex: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, paddingLeft: 23 }}>
                <span style={{ width: 8, height: 1, background: '#DCD3BF', flexShrink: 0 }} />
                <span style={{ display: 'inline-flex', color: kid.cat.color }}><CategoryGlyph icon={kid.cat.icon} size={11} /></span>
                <span style={{ fontSize: 12, color: kidHidden ? '#9B9180' : '#4A4438', textDecoration: hidden(kid.cat.id) ? 'line-through' : 'none' }}>
                  {kid.cat.name}
                </span>
              </div>
            </td>
            {kid.amounts.map((v, mi) => (
              <td key={mi} style={{ ...numCell(v), fontSize: 11.5, color: v === 0 ? '#D8D0BE' : '#6C6553' }}>{fmt(v)}</td>
            ))}
            <td style={{ ...numCell(kidTotal), fontSize: 11.5, fontWeight: 600, color: kidTotal === 0 ? '#D8D0BE' : tone, opacity: 0.85 }}>{fmt(kidTotal)}</td>
          </tr>
        )
      })}
    </>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ReflectionScreen(_props?: any) {
  const { transactions, categories } = useFinanceStore()
  // The year lives in the store because it decides what gets fetched. Held
  // locally, stepping back a year filtered a set of transactions that only
  // ever contained the current one — so the whole grid came back empty and
  // looked like a year with nothing in it.
  const year    = useFinanceStore(s => s.currentYear)
  const setYear = useFinanceStore(s => s.setYear)

  const today = new Date()
  const base = baseCurrency()

  const [fxTick, setFxTick] = useState(0)
  useEffect(() => {
    const h = () => setFxTick(n => n + 1)
    window.addEventListener('professor:fxRatesChanged', h)
    return () => window.removeEventListener('professor:fxRatesChanged', h)
  }, [])

  // Build categoryId → monthly amounts map for given year
  const { incomeRows, expenseRows, monthlyIncome, monthlyExpense } = useMemo(() => {
    // Filter to the selected year
    const yearTx = transactions.filter(tx => tx.date.startsWith(String(year)))

    const wants = (c: { txType: string }, kind: 'income' | 'expense') =>
      c.txType === kind || c.txType === 'both'

    /** A month-by-month row for one category. `ids` is the category plus, for a
     *  parent, its children — money filed under "Groceries · Fruit" is money
     *  out of Groceries, and the parent's row said nothing about it before. */
    function amountsFor(ids: Set<string>, type: 'income' | 'expense') {
      return MONTHS_SHORT.map((_, mi) => {
        const prefix = `${year}-${String(mi + 1).padStart(2, '0')}`
        return yearTx
          .filter(tx => tx.type === type && tx.categoryId && ids.has(tx.categoryId) && tx.date.startsWith(prefix))
          // This added the raw figure whatever it was in, so a salary in USD
          // was counted as though it were the same number of pounds. Converted
          // now; something with no rate is left out and said so below.
          .reduce((s, tx) => s + (toBase(Math.abs(tx.amount), tx.currency, base) ?? 0), 0)
      })
    }

    function buildRows(kind: 'income' | 'expense') {
      return categories
        .filter(c => !c.parentId && wants(c, kind))
        .map(cat => {
          const kids = categories.filter(c => c.parentId === cat.id)
          return {
            cat,
            // The parent's own line covers everything filed beneath it.
            amounts: amountsFor(new Set([cat.id, ...kids.map(k => k.id)]), kind),
            children: kids.map(kid => ({ cat: kid, amounts: amountsFor(new Set([kid.id]), kind) })),
          }
        })
    }

    const incomeRows  = buildRows('income')
    const expenseRows = buildRows('expense')

    const monthly = (type: 'income' | 'expense') => MONTHS_SHORT.map((_, mi) => {
      const prefix = `${year}-${String(mi + 1).padStart(2,'0')}`
      return yearTx.filter(tx => tx.type === type && tx.date.startsWith(prefix))
        .reduce((s, tx) => s + (toBase(Math.abs(tx.amount), tx.currency, base) ?? 0), 0)
    })
    const monthlyIncome  = monthly('income')
    const monthlyExpense = monthly('expense')

    return { incomeRows, expenseRows, monthlyIncome, monthlyExpense }
  }, [transactions, categories, year, base, fxTick])

  // Hidden rows (by category id) — toggling removes row from totals
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set())
  function toggleHide(id: string) {
    setHiddenIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const needRates = useMemo(
    () => currenciesNeedingRates(transactions.filter(t => t.date.startsWith(String(year))), base),
    [transactions, year, base, fxTick],
  )

  // Which parents are showing their parts.
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())
  function toggleOpen(id: string) {
    setOpenIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // Every row that has anything to open. Opening them one at a time is fine
  // for two; with a dozen it is the only thing you do before reading anything.
  const foldable = [...incomeRows, ...expenseRows].filter(r => r.children.length).map(r => r.cat.id)
  const allOpen  = foldable.length > 0 && foldable.every(id => openIds.has(id))
  function toggleAll() {
    setOpenIds(allOpen ? new Set() : new Set(foldable))
  }

  /** A parent's row already includes its children, so a hidden child has to
   *  come off its parent's line too — otherwise hiding one changes nothing and
   *  the totals disagree with the rows they are made of. */
  function rowMonths(row: { cat: { id: string }; amounts: number[]; children: { cat: { id: string }; amounts: number[] }[] }) {
    return row.amounts.map((v, mi) =>
      v - row.children.reduce((s, c) => s + (hiddenIds.has(c.cat.id) ? c.amounts[mi] : 0), 0))
  }

  // Visible income / expense sums per month (respecting hidden rows)
  const visIncome  = MONTHS_SHORT.map((_, mi) => incomeRows.filter(r => !hiddenIds.has(r.cat.id)).reduce((s, r) => s + rowMonths(r)[mi], 0))
  const visExpense = MONTHS_SHORT.map((_, mi) => expenseRows.filter(r => !hiddenIds.has(r.cat.id)).reduce((s, r) => s + rowMonths(r)[mi], 0))
  const netPerMonth = MONTHS_SHORT.map((_, mi) => visIncome[mi] - visExpense[mi])

  // Cumulative (running) cash
  const cumulative: number[] = []
  let cum = 0
  netPerMonth.forEach(n => { cum += n; cumulative.push(cum) })

  const currentMonth = today.getMonth() // 0-indexed
  const throughLabel = MONTHS_SHORT[Math.min(currentMonth, 11)]

  const totalIncome  = visIncome.reduce((s, v) => s + v, 0)
  const totalExpense = visExpense.reduce((s, v) => s + v, 0)
  const totalNet = totalIncome - totalExpense

  const COL_W  = 78
  const ROW_H  = 36
  const NAME_W = 160

  // ── Shared cell style ─────────────────────────────────────────────────────

  function numCell(v: number, isNet = false): React.CSSProperties {
    return {
      width: COL_W, minWidth: COL_W, textAlign: 'right' as const, padding: '0 10px',
      fontFamily: 'Outfit, sans-serif', fontSize: 12.5, fontWeight: isNet ? 700 : 500,
      color: isNet ? netColor(v) : v === 0 ? '#C5BCA8' : '#191712',
      fontVariantNumeric: 'tabular-nums' as const,
      whiteSpace: 'nowrap' as const,
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#F7F4EA', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ flexShrink: 0, borderBottom: '1px solid #E8E1CE', padding: '14px 26px 14px', display: 'flex', alignItems: 'flex-end', gap: 20 }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', color: '#6C6553', display: 'block', marginBottom: 4 }}>FINANCE · REFLECT</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => void setYear(year - 1)} style={{ background: 'none', border: 'none', color: '#6C6553', fontSize: 20, cursor: 'pointer', padding: 0, lineHeight: 1 }}>‹</button>
            <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 28, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1, color: '#191712' }}>
              Financials, {year}
            </span>
            <button onClick={() => void setYear(year + 1)} style={{ background: 'none', border: 'none', color: '#6C6553', fontSize: 20, cursor: 'pointer', padding: 0, lineHeight: 1 }}>›</button>
          </div>
          <span style={{ fontSize: 12, color: '#6C6553', marginTop: 3, display: 'block' }}>
            Every income &amp; expense line by month — hide any row and every total recalculates
            {needRates.length > 0 && (
              <span style={{ color: '#8A6D0B' }}>
                {' · '}{needRates.join(' and ')} left out — no rate set, see Settings → Finance
              </span>
            )}
          </span>
        </div>

        {/* Stats bar */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 20, paddingBottom: 4, alignItems: 'flex-end' }}>
          {hiddenIds.size > 0 && (
            <span style={{ fontSize: 11.5, color: '#9B9180', fontStyle: 'italic' }}>
              {hiddenIds.size} row{hiddenIds.size > 1 ? 's' : ''} hidden
              <button onClick={() => setHiddenIds(new Set())} style={{ marginLeft: 8, background: 'none', border: 'none', color: '#6C6553', cursor: 'pointer', fontSize: 11.5, textDecoration: 'underline', padding: 0 }}>Show all</button>
            </span>
          )}
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, letterSpacing: '0.1em', fontWeight: 700, color: '#9B9180' }}>NET THROUGH {throughLabel}</div>
            <div style={{ fontFamily: 'Outfit, sans-serif', fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: netColor(totalNet) }}>
              {acct(totalNet, { currency: 'EGP', zero: '–' })}
            </div>
          </div>
        </div>
      </div>

      {/* Table scroll area */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', minWidth: NAME_W + COL_W * 12 + 120 }}>

          {/* Column headers */}
          <thead>
            <tr style={{ background: '#FCFAF4' }}>
              <th style={{ width: NAME_W, minWidth: NAME_W, textAlign: 'left', padding: '8px 14px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#9B9180', position: 'sticky', top: 0, left: 0, background: '#FCFAF4', zIndex: 4, ...HEAD_EDGE }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span>CATEGORY</span>
                  {foldable.length > 0 && (
                    <button
                      onClick={toggleAll}
                      title={allOpen ? 'Fold every sub-category away' : `Open all ${foldable.length} that have sub-categories`}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4, height: 20,
                        padding: '0 7px', borderRadius: 999, cursor: 'pointer',
                        background: '#FFFFFF', border: '1px solid #E8E1CE', color: '#6C6553',
                        fontFamily: 'inherit', fontSize: 9.5, fontWeight: 600, letterSpacing: '0.04em',
                      }}>
                      {allOpen ? <ChevronsDownUp size={11} strokeWidth={2.2} /> : <ChevronsUpDown size={11} strokeWidth={2.2} />}
                      {allOpen ? 'COLLAPSE ALL' : 'EXPAND ALL'}
                    </button>
                  )}
                </span>
              </th>
              {MONTHS_SHORT.map(m => (
                <th key={m} style={{ width: COL_W, minWidth: COL_W, textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#9B9180', position: 'sticky', top: 0, background: '#FCFAF4', zIndex: 3, ...HEAD_EDGE }}>{m.toUpperCase()}</th>
              ))}
              <th style={{ width: 100, textAlign: 'right', padding: '8px 14px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#9B9180', position: 'sticky', top: 0, background: '#FCFAF4', zIndex: 3, ...HEAD_EDGE }}>TOTAL</th>
            </tr>
          </thead>

          <tbody>

            {/* ── INCOME section ── */}
            <SectionHeader label="INCOME" colCount={12} colWidth={COL_W} nameWidth={NAME_W}
              monthTotals={monthlyIncome} rowTotal={monthlyIncome.reduce((s, v) => s + v, 0)} />

            {incomeRows.map(row => (
              <CategoryRows key={row.cat.id} row={row} tone={OLIVE}
                open={openIds.has(row.cat.id)} hidden={id => hiddenIds.has(id)}
                onToggleOpen={toggleOpen} onToggleHide={toggleHide}
                months={rowMonths(row)} ROW_H={ROW_H} numCell={numCell} fmt={fmt} />
            ))}

            {/* Total income row */}
            <TotalRow label="Total income" months={visIncome} total={totalIncome} sign={1} COL_W={COL_W} NAME_W={NAME_W} />

            {/* Spacer */}
            <tr style={{ height: 12 }}><td colSpan={14} /></tr>

            {/* ── EXPENSES section ── */}
            <SectionHeader label="EXPENSES" colCount={12} colWidth={COL_W} nameWidth={NAME_W}
              monthTotals={monthlyExpense} rowTotal={monthlyExpense.reduce((s, v) => s + v, 0)} out />

            {expenseRows.map(row => (
              <CategoryRows key={row.cat.id} row={row} tone={RUST}
                open={openIds.has(row.cat.id)} hidden={id => hiddenIds.has(id)}
                onToggleOpen={toggleOpen} onToggleHide={toggleHide}
                months={rowMonths(row)} ROW_H={ROW_H} numCell={numCell} fmt={fmtOut} />
            ))}

            {/* Total expenses row */}
            <TotalRow label="Total expenses" months={visExpense} total={totalExpense} sign={-1} COL_W={COL_W} NAME_W={NAME_W} />

            {/* Spacer */}
            <tr style={{ height: 8 }}><td colSpan={14} /></tr>

            {/* Net per month */}
            <NetRow label="Net by month" months={netPerMonth} total={totalNet} COL_W={COL_W} NAME_W={NAME_W} />

            {/* Cumulative cash */}
            <CumulativeRow months={cumulative} COL_W={COL_W} NAME_W={NAME_W} />

          </tbody>
        </table>
      </div>

    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────

function SectionHeader({ label, colCount: _colCount, colWidth, nameWidth: _nameWidth, monthTotals, rowTotal, out }: {
  label: string; colCount: number; colWidth: number; nameWidth: number
  monthTotals: number[]; rowTotal: number; out?: boolean
}) {
  const f = out ? fmtOut : fmt
  return (
    <tr style={{ background: '#F0EBDC', borderTop: '1px solid #E8E1CE', borderBottom: '1px solid #E8E1CE' }}>
      <td style={{ padding: '5px 14px', position: 'sticky', left: 0, background: '#F0EBDC', zIndex: 2 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.1em', color: '#6C6553' }}>{label}</span>
      </td>
      {monthTotals.map((v, i) => (
        <td key={i} style={{ width: colWidth, textAlign: 'right', padding: '5px 10px', fontFamily: 'Outfit, sans-serif', fontSize: 11, color: v === 0 ? '#C5BCA8' : '#6C6553', fontVariantNumeric: 'tabular-nums' }}>
          {f(v)}
        </td>
      ))}
      <td style={{ width: 100, textAlign: 'right', padding: '5px 14px', fontFamily: 'Outfit, sans-serif', fontSize: 11.5, fontWeight: 700, color: '#6C6553', fontVariantNumeric: 'tabular-nums' }}>
        {f(rowTotal)}
      </td>
    </tr>
  )
}

function TotalRow({ label, months, total, sign, COL_W, NAME_W: _NAME_W }: {
  label: string; months: number[]; total: number; sign: 1 | -1
  COL_W: number; NAME_W: number
}) {
  const col = sign === 1 ? OLIVE : RUST
  return (
    <tr style={{ background: '#F7F4EA', borderTop: '2px solid #E8E1CE', borderBottom: '2px solid #E8E1CE' }}>
      <td style={{ padding: '0 14px', height: 38, position: 'sticky', left: 0, background: '#F7F4EA', zIndex: 2 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#191712' }}>{label}</span>
      </td>
      {months.map((v, mi) => (
        <td key={mi} style={{ width: COL_W, minWidth: COL_W, textAlign: 'right', padding: '0 10px', fontFamily: 'Outfit, sans-serif', fontSize: 13, fontWeight: 700, color: v === 0 ? '#C5BCA8' : col, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {sign === 1 ? fmt(v) : fmtOut(v)}
        </td>
      ))}
      <td style={{ width: 100, textAlign: 'right', padding: '0 14px', fontFamily: 'Outfit, sans-serif', fontSize: 13.5, fontWeight: 700, color: total === 0 ? '#C5BCA8' : col, fontVariantNumeric: 'tabular-nums' }}>
        {sign === 1 ? fmt(total) : fmtOut(total)}
      </td>
    </tr>
  )
}

function NetRow({ label, months, total, COL_W, NAME_W: _NAME_W2 }: {
  label: string; months: number[]; total: number; COL_W: number; NAME_W: number
}) {
  return (
    <tr style={{ background: '#FCFAF4', borderBottom: '1px solid #E8E1CE' }}>
      <td style={{ padding: '0 14px', height: 38, position: 'sticky', left: 0, background: '#FCFAF4', zIndex: 2 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#191712' }}>{label}</span>
      </td>
      {months.map((v, mi) => (
        <td key={mi} style={{ width: COL_W, minWidth: COL_W, textAlign: 'right', padding: '0 10px', fontFamily: 'Outfit, sans-serif', fontSize: 13, fontWeight: 700, color: v === 0 ? '#9B9180' : v > 0 ? OLIVE : RUST, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {fmt(v)}
        </td>
      ))}
      <td style={{ width: 100, textAlign: 'right', padding: '0 14px', fontFamily: 'Outfit, sans-serif', fontSize: 13.5, fontWeight: 700, color: total === 0 ? '#9B9180' : total > 0 ? OLIVE : RUST, fontVariantNumeric: 'tabular-nums' }}>
        {fmt(total)}
      </td>
    </tr>
  )
}

function CumulativeRow({ months, COL_W, NAME_W: _NAME_W3 }: { months: number[]; COL_W: number; NAME_W: number }) {
  return (
    <tr style={{ background: '#191712', borderBottom: '1px solid #2C2920' }}>
      <td style={{ padding: '0 14px', height: 40, position: 'sticky', left: 0, background: '#191712', zIndex: 2 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: '#8A8272' }}>CUMULATIVE CASH</span>
      </td>
      {months.map((v, mi) => (
        <td key={mi} style={{ width: COL_W, minWidth: COL_W, textAlign: 'right', padding: '0 10px', fontFamily: 'Outfit, sans-serif', fontSize: 12.5, fontWeight: 700, color: v === 0 ? '#4A4438' : v > 0 ? '#7EC878' : '#E87A65', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {fmt(v)}
        </td>
      ))}
      <td style={{ width: 100, textAlign: 'right', padding: '0 14px', color: '#4A4438', fontSize: 12 }}>
        YTD
      </td>
    </tr>
  )
}

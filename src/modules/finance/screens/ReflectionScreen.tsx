import { useState, useMemo } from 'react'
import { useFinanceStore } from '../financeStore'

// ─── 16F · Financials YTD ─────────────────────────────────────────────────────
// Spreadsheet-style table: each income/expense category as a row,
// 12 monthly columns, totals + cumulative running cash at the bottom.

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const OLIVE = '#5F7038'
const RUST  = '#B4523A'

function fmt(v: number, showSign = false): string {
  if (v === 0) return '–'
  const s = Math.abs(v).toLocaleString('en-US')
  if (showSign) return (v > 0 ? '+' : '−') + s
  return s
}

function netColor(v: number) { return v > 0 ? OLIVE : v < 0 ? RUST : '#9B9180' }

// ─── Main ─────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ReflectionScreen(_props?: any) {
  const { transactions, categories } = useFinanceStore()

  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())

  // Build categoryId → monthly amounts map for given year
  const { incomeRows, expenseRows, monthlyIncome, monthlyExpense } = useMemo(() => {
    // Filter to the selected year
    const yearTx = transactions.filter(tx => tx.date.startsWith(String(year)))

    // Parent categories only for grouping
    const parentIncome  = categories.filter(c => !c.parentId && (c.txType === 'income' || c.txType === 'both'))
    const parentExpense = categories.filter(c => !c.parentId && (c.txType === 'expense' || c.txType === 'both'))

    // Also gather uncategorized
    function buildRows(catList: typeof categories, types: string[]) {
      return catList.map(cat => {
        const amounts = MONTHS_SHORT.map((_, mi) => {
          const prefix = `${year}-${String(mi + 1).padStart(2,'0')}`
          return yearTx
            .filter(tx => types.includes(tx.type) && tx.categoryId === cat.id && tx.date.startsWith(prefix))
            .reduce((s, tx) => s + Math.abs(tx.amount), 0)
        })
        return { cat, amounts }
      })
    }

    const incomeRows  = buildRows(parentIncome,  ['income'])
    const expenseRows = buildRows(parentExpense, ['expense'])

    const monthlyIncome  = MONTHS_SHORT.map((_, mi) => {
      const prefix = `${year}-${String(mi + 1).padStart(2,'0')}`
      return yearTx.filter(tx => tx.type === 'income' && tx.date.startsWith(prefix)).reduce((s, tx) => s + Math.abs(tx.amount), 0)
    })
    const monthlyExpense = MONTHS_SHORT.map((_, mi) => {
      const prefix = `${year}-${String(mi + 1).padStart(2,'0')}`
      return yearTx.filter(tx => tx.type === 'expense' && tx.date.startsWith(prefix)).reduce((s, tx) => s + Math.abs(tx.amount), 0)
    })

    return { incomeRows, expenseRows, monthlyIncome, monthlyExpense }
  }, [transactions, categories, year])

  // Hidden rows (by category id) — toggling removes row from totals
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set())
  function toggleHide(id: string) {
    setHiddenIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // Visible income / expense sums per month (respecting hidden rows)
  const visIncome  = MONTHS_SHORT.map((_, mi) => incomeRows.filter(r => !hiddenIds.has(r.cat.id)).reduce((s, r) => s + r.amounts[mi], 0))
  const visExpense = MONTHS_SHORT.map((_, mi) => expenseRows.filter(r => !hiddenIds.has(r.cat.id)).reduce((s, r) => s + r.amounts[mi], 0))
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
            <button onClick={() => setYear(y => y - 1)} style={{ background: 'none', border: 'none', color: '#6C6553', fontSize: 20, cursor: 'pointer', padding: 0, lineHeight: 1 }}>‹</button>
            <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 28, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1, color: '#191712' }}>
              Financials, {year}
            </span>
            <button onClick={() => setYear(y => y + 1)} style={{ background: 'none', border: 'none', color: '#6C6553', fontSize: 20, cursor: 'pointer', padding: 0, lineHeight: 1 }}>›</button>
          </div>
          <span style={{ fontSize: 12, color: '#6C6553', marginTop: 3, display: 'block' }}>
            Every income &amp; expense line by month — hide any row and every total recalculates
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
              {fmt(totalNet, true)} EGP
            </div>
          </div>
        </div>
      </div>

      {/* Table scroll area */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', minWidth: NAME_W + COL_W * 12 + 120 }}>

          {/* Column headers */}
          <thead>
            <tr style={{ background: '#FCFAF4', borderBottom: '2px solid #E8E1CE' }}>
              <th style={{ width: NAME_W, minWidth: NAME_W, textAlign: 'left', padding: '8px 14px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#9B9180', position: 'sticky', left: 0, background: '#FCFAF4', zIndex: 2 }}>CATEGORY</th>
              {MONTHS_SHORT.map(m => (
                <th key={m} style={{ width: COL_W, minWidth: COL_W, textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#9B9180' }}>{m.toUpperCase()}</th>
              ))}
              <th style={{ width: 100, textAlign: 'right', padding: '8px 14px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#9B9180' }}>TOTAL</th>
            </tr>
          </thead>

          <tbody>

            {/* ── INCOME section ── */}
            <SectionHeader label="INCOME" colCount={12} colWidth={COL_W} nameWidth={NAME_W}
              monthTotals={monthlyIncome} rowTotal={monthlyIncome.reduce((s, v) => s + v, 0)} />

            {incomeRows.map(({ cat, amounts }) => {
              const hidden = hiddenIds.has(cat.id)
              const total = amounts.reduce((s, v) => s + v, 0)
              return (
                <tr key={cat.id}
                  onClick={() => toggleHide(cat.id)}
                  title={hidden ? 'Click to include in totals' : 'Click to hide from totals'}
                  style={{ borderBottom: '1px solid #F0EBDC', cursor: 'pointer', background: hidden ? '#FAF7EC' : 'transparent', opacity: hidden ? 0.45 : 1 }}
                >
                  <td style={{ padding: '0 14px', height: ROW_H, position: 'sticky', left: 0, background: hidden ? '#FAF7EC' : '#FFFFFF', zIndex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      {hidden && <span style={{ fontSize: 10, color: '#9B9180', textDecoration: 'line-through', marginRight: 2 }} />}
                      <span style={{ fontSize: 12, color: cat.color, marginRight: 2 }}>{cat.icon}</span>
                      <span style={{ fontSize: 13, color: hidden ? '#9B9180' : '#191712', textDecoration: hidden ? 'line-through' : 'none', fontWeight: 500 }}>{cat.name}</span>
                    </div>
                  </td>
                  {amounts.map((v, mi) => (
                    <td key={mi} style={numCell(v)}>{fmt(v)}</td>
                  ))}
                  <td style={{ ...numCell(total), fontWeight: 700, color: total === 0 ? '#C5BCA8' : OLIVE }}>{fmt(total)}</td>
                </tr>
              )
            })}

            {/* Total income row */}
            <TotalRow label="Total income" months={visIncome} total={totalIncome} sign={1} COL_W={COL_W} NAME_W={NAME_W} />

            {/* Spacer */}
            <tr style={{ height: 12 }}><td colSpan={14} /></tr>

            {/* ── EXPENSES section ── */}
            <SectionHeader label="EXPENSES" colCount={12} colWidth={COL_W} nameWidth={NAME_W}
              monthTotals={monthlyExpense} rowTotal={monthlyExpense.reduce((s, v) => s + v, 0)} />

            {expenseRows.map(({ cat, amounts }) => {
              const hidden = hiddenIds.has(cat.id)
              const total = amounts.reduce((s, v) => s + v, 0)
              return (
                <tr key={cat.id}
                  onClick={() => toggleHide(cat.id)}
                  title={hidden ? 'Click to include in totals' : 'Click to hide from totals'}
                  style={{ borderBottom: '1px solid #F0EBDC', cursor: 'pointer', background: hidden ? '#FAF7EC' : 'transparent', opacity: hidden ? 0.45 : 1 }}
                >
                  <td style={{ padding: '0 14px', height: ROW_H, position: 'sticky', left: 0, background: hidden ? '#FAF7EC' : '#FFFFFF', zIndex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ fontSize: 12, color: cat.color, marginRight: 2 }}>{cat.icon}</span>
                      <span style={{ fontSize: 13, color: hidden ? '#9B9180' : '#191712', textDecoration: hidden ? 'line-through' : 'none', fontWeight: 500 }}>{cat.name}</span>
                    </div>
                  </td>
                  {amounts.map((v, mi) => (
                    <td key={mi} style={numCell(v)}>{fmt(v)}</td>
                  ))}
                  <td style={{ ...numCell(total), fontWeight: 700, color: total === 0 ? '#C5BCA8' : RUST }}>{fmt(total)}</td>
                </tr>
              )
            })}

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

function SectionHeader({ label, colCount: _colCount, colWidth, nameWidth: _nameWidth, monthTotals, rowTotal }: {
  label: string; colCount: number; colWidth: number; nameWidth: number
  monthTotals: number[]; rowTotal: number
}) {
  return (
    <tr style={{ background: '#F0EBDC', borderTop: '1px solid #E8E1CE', borderBottom: '1px solid #E8E1CE' }}>
      <td style={{ padding: '5px 14px', position: 'sticky', left: 0, background: '#F0EBDC', zIndex: 1 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.1em', color: '#6C6553' }}>{label}</span>
      </td>
      {monthTotals.map((v, i) => (
        <td key={i} style={{ width: colWidth, textAlign: 'right', padding: '5px 10px', fontFamily: 'Outfit, sans-serif', fontSize: 11, color: v === 0 ? '#C5BCA8' : '#6C6553', fontVariantNumeric: 'tabular-nums' }}>
          {v > 0 ? v.toLocaleString('en-US') : '–'}
        </td>
      ))}
      <td style={{ width: 100, textAlign: 'right', padding: '5px 14px', fontFamily: 'Outfit, sans-serif', fontSize: 11.5, fontWeight: 700, color: '#6C6553', fontVariantNumeric: 'tabular-nums' }}>
        {rowTotal > 0 ? rowTotal.toLocaleString('en-US') : '–'}
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
      <td style={{ padding: '0 14px', height: 38, position: 'sticky', left: 0, background: '#F7F4EA', zIndex: 1 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#191712' }}>{label}</span>
      </td>
      {months.map((v, mi) => (
        <td key={mi} style={{ width: COL_W, minWidth: COL_W, textAlign: 'right', padding: '0 10px', fontFamily: 'Outfit, sans-serif', fontSize: 13, fontWeight: 700, color: v === 0 ? '#C5BCA8' : col, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {v === 0 ? '–' : (sign === 1 ? '+' : '') + v.toLocaleString('en-US')}
        </td>
      ))}
      <td style={{ width: 100, textAlign: 'right', padding: '0 14px', fontFamily: 'Outfit, sans-serif', fontSize: 13.5, fontWeight: 700, color: total === 0 ? '#C5BCA8' : col, fontVariantNumeric: 'tabular-nums' }}>
        {total === 0 ? '–' : (sign === 1 ? '+' : '') + total.toLocaleString('en-US')}
      </td>
    </tr>
  )
}

function NetRow({ label, months, total, COL_W, NAME_W: _NAME_W2 }: {
  label: string; months: number[]; total: number; COL_W: number; NAME_W: number
}) {
  return (
    <tr style={{ background: '#FCFAF4', borderBottom: '1px solid #E8E1CE' }}>
      <td style={{ padding: '0 14px', height: 38, position: 'sticky', left: 0, background: '#FCFAF4', zIndex: 1 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#191712' }}>{label}</span>
      </td>
      {months.map((v, mi) => (
        <td key={mi} style={{ width: COL_W, minWidth: COL_W, textAlign: 'right', padding: '0 10px', fontFamily: 'Outfit, sans-serif', fontSize: 13, fontWeight: 700, color: v === 0 ? '#9B9180' : v > 0 ? OLIVE : RUST, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {v === 0 ? '–' : (v > 0 ? '+' : '−') + Math.abs(v).toLocaleString('en-US')}
        </td>
      ))}
      <td style={{ width: 100, textAlign: 'right', padding: '0 14px', fontFamily: 'Outfit, sans-serif', fontSize: 13.5, fontWeight: 700, color: total === 0 ? '#9B9180' : total > 0 ? OLIVE : RUST, fontVariantNumeric: 'tabular-nums' }}>
        {total === 0 ? '–' : (total > 0 ? '+' : '−') + Math.abs(total).toLocaleString('en-US')}
      </td>
    </tr>
  )
}

function CumulativeRow({ months, COL_W, NAME_W: _NAME_W3 }: { months: number[]; COL_W: number; NAME_W: number }) {
  return (
    <tr style={{ background: '#191712', borderBottom: '1px solid #2C2920' }}>
      <td style={{ padding: '0 14px', height: 40, position: 'sticky', left: 0, background: '#191712', zIndex: 1 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: '#8A8272' }}>CUMULATIVE CASH</span>
      </td>
      {months.map((v, mi) => (
        <td key={mi} style={{ width: COL_W, minWidth: COL_W, textAlign: 'right', padding: '0 10px', fontFamily: 'Outfit, sans-serif', fontSize: 12.5, fontWeight: 700, color: v === 0 ? '#4A4438' : v > 0 ? '#7EC878' : '#E87A65', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {v === 0 ? '–' : (v > 0 ? '+' : '−') + Math.abs(v).toLocaleString('en-US')}
        </td>
      ))}
      <td style={{ width: 100, textAlign: 'right', padding: '0 14px', color: '#4A4438', fontSize: 12 }}>
        YTD
      </td>
    </tr>
  )
}

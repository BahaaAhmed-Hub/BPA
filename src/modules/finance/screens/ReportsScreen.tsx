import { useState, useMemo } from 'react'
import { PALETTE } from '@/lib/palettes'
import { useFinanceStore } from '../financeStore'
import { settled, whenPaid } from '../unpaid'
import { toBase, baseCurrency, currenciesNeedingRates } from '../fx'
import { Segmented } from '@/components/ui'

// ─── Donut chart helpers ───────────────────────────────────────────────────────

const DONUT_R   = 62
const DONUT_CX  = 80
const DONUT_CY  = 80
const DONUT_SW  = 22
const CIRC      = 2 * Math.PI * DONUT_R

function buildSegments(data: { name: string; amt: number; color: string }[], total: number) {
  let offset = 0
  return data.map(d => {
    const pct = d.amt / total
    const dash = pct * CIRC
    const gap  = CIRC - dash
    const seg  = { ...d, pct, dash, gap, offset }
    offset += dash
    return seg
  })
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const monthStart = (d: Date) => iso(new Date(d.getFullYear(), d.getMonth(), 1))
const monthEnd   = (d: Date) => iso(new Date(d.getFullYear(), d.getMonth() + 1, 0))

function addMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(year, month + delta, 1)
  return { year: d.getFullYear(), month: d.getMonth() }
}

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// Ten hues that stay apart from each other and sit on the warm ground the rest
// of the module is built on. Mid-tone throughout, so a slice carries its label
// whichever end of the list it comes from.
const RANGE_FIELD: React.CSSProperties = {
  border: 'none', background: 'transparent', outline: 'none',
  fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-body)', fontWeight: 500,
  color: 'var(--sb-ink-1)', padding: 0, width: 118,
}


/** The colour every category is seeded with. Two categories the same colour is
 *  a chart nobody can read, and all of them arrive this one. */
const SEED_COLOUR = 'var(--sb-ink-4)'

function darken(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const mix = (c: number) => Math.round(c * (1 - amount))
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => mix(c).toString(16).padStart(2, '0')).join('')}`
}

/** A colour per row that never repeats inside one report. A category that has
 *  been given a colour of its own keeps it, so long as it is not the seed and
 *  nothing else in this report is wearing it; everything else takes a palette
 *  slot chosen from its id, so it holds that colour from month to month rather
 *  than changing every time the ranking does. Past ten, the palette runs again
 *  a shade darker. */
function colourFor(rows: { id: string; own?: string }[]): Map<string, string> {
  const shared = new Set<string>()
  const seen = new Set<string>()
  for (const r of rows) {
    if (!r.own || r.own.toUpperCase() === SEED_COLOUR) continue
    if (seen.has(r.own)) shared.add(r.own)
    seen.add(r.own)
  }

  const out = new Map<string, string>()
  const taken = new Set<string>()
  const fromPalette: { id: string }[] = []

  for (const r of rows) {
    const own = r.own && r.own.toUpperCase() !== SEED_COLOUR && !shared.has(r.own) ? r.own : null
    if (own) { out.set(r.id, own); taken.add(own.toUpperCase()) }
    else fromPalette.push(r)
  }

  const slots = new Set<number>()
  for (const r of fromPalette) {
    let h = 0
    for (let i = 0; i < r.id.length; i++) h = (h * 31 + r.id.charCodeAt(i)) >>> 0
    let slot = h % PALETTE.length
    let lap = 0
    for (let n = 0; n < PALETTE.length * 4; n++) {
      const key = `${lap}:${slot}`
      const colour = lap === 0 ? PALETTE[slot] : darken(PALETTE[slot], Math.min(lap * 0.22, 0.6))
      if (!slots.has(Number(`${lap}${slot}`)) && !taken.has(colour.toUpperCase())) {
        slots.add(Number(`${lap}${slot}`)); taken.add(colour.toUpperCase())
        out.set(r.id, colour)
        break
      }
      void key
      slot = (slot + 1) % PALETTE.length
      if (slot === h % PALETTE.length) lap++
    }
    if (!out.has(r.id)) out.set(r.id, PALETTE[0])
  }
  return out
}

// ─── Props ────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ReportsScreen(_props?: any) {
  const C = {
    bg:        'var(--sb-page)',
    surface:   'var(--sb-card)',
    amberBg:   'rgba(var(--sb-accent-rgb),0.12)',
    border:    'var(--sb-border)',
    borderSt:  'var(--sb-border)',
    divFaint:  'var(--sb-border)',
    amber:     'var(--sb-accent)',
    textPri:   'var(--sb-ink-1)',
    textMuted: 'var(--sb-ink-3)',
    textDim:   'var(--sb-ink-4)',
    red:       'var(--sb-negative)',
    green:     'var(--sb-positive)',
  }

  const { transactions, categories } = useFinanceStore()

  const today = new Date()
  // A range, the way the accounts tab keeps one, rather than a month with a
  // decorative label beside it. The month arrows are still here because a month
  // at a time is what this is usually read in; they step the range when it is a
  // whole calendar month and step aside when it is not.
  const [rangeFrom, setRangeFrom] = useState(monthStart(today))
  const [rangeTo,   setRangeTo]   = useState(monthEnd(today))
  const [reportView, setReportView] = useState<'donut' | 'bars'>('donut')

  /** The whole calendar month this range covers, or null when it covers
   *  something else — a fortnight, a quarter, the year. */
  const wholeMonth = useMemo(() => {
    if (!rangeFrom || !rangeTo) return null
    const [y, m, d] = rangeFrom.split('-').map(Number)
    if (d !== 1) return null
    const last = `${y}-${String(m).padStart(2, '0')}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
    return rangeTo === last ? { year: y, month: m - 1 } : null
  }, [rangeFrom, rangeTo])

  const rangeKey = `${rangeFrom}~${rangeTo}`
  // A report covers the money that moved in a period, so an entry falls in the
  // period it was paid in rather than the one it was owed in.
  const inRange = (tx: { date: string; paidAt?: string }) => {
    const d = whenPaid(tx)
    return (!rangeFrom || d >= rangeFrom) && (!rangeTo || d <= rangeTo)
  }

  const base = baseCurrency()
  // A report says where the money went. Money that has not moved has not gone
  // anywhere yet, so an unpaid entry is not in it.
  const expTxns = settled(transactions).filter(tx => tx.type === 'expense' && inRange(tx))
  const byCategory = new Map<string, number>()
  expTxns.forEach(tx => {
    // A dollar is not a pound. Anything with no rate behind it is left out and
    // named under the total rather than added at face value.
    const v = toBase(Math.abs(tx.amount), tx.currency, base)
    if (v === null) return
    const key = tx.categoryId ?? '__none__'
    byCategory.set(key, (byCategory.get(key) ?? 0) + v)
  })
  const reportUnrated = currenciesNeedingRates(expTxns, base)
  const REPORT_DATA = useMemo(() => {
    const rows = [...byCategory.entries()].map(([catId, amt]) => {
      const cat = categories.find(c => c.id === catId)
      return { id: catId, name: cat?.name ?? 'Uncategorised', amt, own: cat?.color }
    })
    const colours = colourFor(rows)
    return rows
      .map(r => ({ ...r, color: colours.get(r.id) ?? PALETTE[0] }))
      .sort((a, b) => b.amt - a.amt)
    // byCategory is rebuilt every render; the month and the data behind it are
    // what actually decide this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, categories, rangeKey, base])
  const TOTAL = REPORT_DATA.reduce((s, d) => s + d.amt, 0)

  const segments = TOTAL > 0 ? buildSegments(REPORT_DATA, TOTAL) : []
  const maxAmt   = Math.max(...REPORT_DATA.map(d => d.amt), 1)

  function navigateMonth(delta: number) {
    if (!wholeMonth) return
    const { year, month } = addMonth(wholeMonth.year, wholeMonth.month, delta)
    const first = new Date(year, month, 1)
    setRangeFrom(monthStart(first))
    setRangeTo(monthEnd(first))
  }


  // Per day over the days actually being looked at. With an open end, the days
  // are the ones the entries themselves span — a per-day rate over "all time"
  // divided by one day is not a rate, it is the total again.
  const spanDays = useMemo(() => {
    const dates = expTxns.map(t => t.date).sort()
    const from = rangeFrom || dates[0]
    const to   = rangeTo   || dates[dates.length - 1]
    if (!from || !to) return 1
    return Math.max(1, Math.round((Date.parse(`${to}T12:00:00`) - Date.parse(`${from}T12:00:00`)) / 864e5) + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey, expTxns.length])
  const dayRate = TOTAL > 0 ? Math.round(TOTAL / spanDays) : 0

  const day = (d: string) => new Date(`${d}T12:00:00`)
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  const wholeYear = rangeFrom.endsWith('-01-01') && rangeTo === `${rangeFrom.slice(0, 4)}-12-31`
  const periodLabel = wholeMonth
    ? `${MONTH_SHORT[wholeMonth.month]} ${wholeMonth.year}`
    : !rangeFrom && !rangeTo ? 'everything'
    : wholeYear ? rangeFrom.slice(0, 4)
    : !rangeFrom ? `up to ${day(rangeTo)}`
    : !rangeTo ? `from ${day(rangeFrom)}`
    : `${day(rangeFrom)} – ${day(rangeTo)}`


  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%', overflow: 'hidden', background: C.bg }}>
      <style>{`
        /* Animations, not transitions: a mark that has only just mounted has no
           previous value to transition from, and asking React to paint a zero
           first showed the finished chart for a frame before it collapsed. */
        @keyframes reportIn { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
        @keyframes reportSweep {
          from { stroke-dasharray: 0 var(--circ) }
          to   { stroke-dasharray: var(--dash) var(--gap) }
        }
        @keyframes reportGrow { from { transform: scaleX(0) } to { transform: scaleX(1) } }
        .report-view { animation: reportIn 340ms cubic-bezier(.22,1,.36,1) both }
        .report-arc  { animation: reportSweep 700ms cubic-bezier(.22,1,.36,1) both }
        .report-bar  { animation: reportGrow 620ms cubic-bezier(.22,1,.36,1) both;
                       transform-origin: left center }
        @media (prefers-reduced-motion: reduce) {
          .report-view, .report-arc, .report-bar { animation-duration: 1ms; animation-delay: 0ms }
        }
      `}</style>

      {/* Header */}
      <div style={{
        flexShrink: 0,
        borderBottom: 'var(--sb-border-width) solid var(--sb-border)',
        padding: '14px 26px 16px',
        display: 'flex', alignItems: 'flex-end', gap: 20,
      }}>
        <div>
          <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 700, letterSpacing: '0.14em', color: 'var(--sb-ink-3)', display: 'block', marginBottom: 4 }}>MONEY</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {wholeMonth && (
              <button onClick={() => navigateMonth(-1)} title="The month before"
                style={{ background: 'none', border: 'none', color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-h2)', cursor: 'pointer', padding: 0, lineHeight: 1 }}>‹</button>
            )}
            <span style={{ fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h1)', fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1, color: 'var(--sb-ink-1)' }}>
              Reports · {periodLabel}
            </span>
            {wholeMonth && (
              <button onClick={() => navigateMonth(1)} title="The month after"
                style={{ background: 'none', border: 'none', color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-h2)', cursor: 'pointer', padding: 0, lineHeight: 1 }}>›</button>
            )}
          </div>
          <span style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', display: 'block', marginTop: 3 }}>
            {TOTAL > 0 ? `${base} ${dayRate.toLocaleString('en-US')}/day · ${REPORT_DATA.length} categories` : 'No expenses logged this month'}
            {reportUnrated.length > 0 && (
              <span title={`No rate set for ${reportUnrated.join(', ')}, so it is not counted`}
                style={{ marginLeft: 6, color: 'var(--sb-warning)' }}>· {reportUnrated.join(' ')} not counted</span>
            )}
          </span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 3 }}>
          {/* View toggle */}
          <Segmented
            aria-label="How to draw the report"
            value={reportView}
            onChange={setReportView}
            options={[
              { value: 'donut' as const, label: 'Donut' },
              { value: 'bars'  as const, label: 'Bars' },
            ]}
          />
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>

        {/* The same period control the accounts tab keeps, and for the same
            reason: the dates were a label describing a month you could not
            change from here. */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '5px 8px 5px 12px',
            background: C.surface, border: `var(--sb-border-width) solid ${C.border}`, borderRadius: 'var(--sb-r-nav)',
          }}>
            <input type="date" value={rangeFrom} max={rangeTo || undefined}
              onChange={e => setRangeFrom(e.target.value)} style={RANGE_FIELD} />
            <span style={{ color: C.textDim }}>›</span>
            <input type="date" value={rangeTo} min={rangeFrom || undefined}
              onChange={e => setRangeTo(e.target.value)} style={RANGE_FIELD} />
            <span style={{ width: 1, alignSelf: 'stretch', background: C.border, margin: '0 2px' }} />
            {([
              ['This month', monthStart(today), monthEnd(today)],
              ['This year', `${today.getFullYear()}-01-01`, `${today.getFullYear()}-12-31`],
              ['All', '', ''],
            ] as const).map(([label, from, to]) => {
              const on = rangeFrom === from && rangeTo === to
              return (
                <button key={label}
                  onClick={() => { setRangeFrom(from); setRangeTo(to) }}
                  style={{
                    padding: '4px 9px', borderRadius: 'var(--sb-r-chip)', border: 'none', cursor: 'pointer',
                    fontFamily: 'inherit', fontSize: 'var(--sb-t-meta)', fontWeight: on ? 700 : 500,
                    background: on ? 'var(--sb-ink-1)' : 'transparent',
                    color: on ? 'var(--sb-ink-on-dark)' : C.textDim,
                  }}>
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        {REPORT_DATA.length === 0 ? (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: 200, color: C.textMuted, fontSize: 'var(--sb-t-body)',
          }}>
            No expenses in {periodLabel}
          </div>
        ) : (
          <>
            {/* ── Donut view ── */}
            {reportView === 'donut' && (
              <div key={`donut-${rangeKey}`} className="report-view" style={{ display: 'flex', gap: 40, alignItems: 'flex-start' }}>

                {/* SVG Donut */}
                <div style={{ position: 'relative', flexShrink: 0, width: 280, height: 280 }}>
                  <svg width={280} height={280} viewBox="0 0 160 160">
                    {/* Track */}
                    <circle
                      cx={DONUT_CX} cy={DONUT_CY} r={DONUT_R}
                      fill="none" stroke={C.divFaint} strokeWidth={DONUT_SW}
                    />
                    {/* Segments */}
                    {segments.map((seg, i) => (
                      <circle
                        key={i}
                        className="report-arc"
                        cx={DONUT_CX} cy={DONUT_CY} r={DONUT_R}
                        fill="none"
                        stroke={seg.color}
                        strokeWidth={DONUT_SW}
                        strokeDasharray={`${seg.dash} ${seg.gap}`}
                        strokeDashoffset={-seg.offset}
                        transform={`rotate(-90 ${DONUT_CX} ${DONUT_CY})`}
                        style={{
                          '--dash': `${seg.dash}`, '--gap': `${seg.gap}`, '--circ': `${CIRC}`,
                          animationDelay: `${i * 70}ms`,
                        } as React.CSSProperties}
                      />
                    ))}
                    {/* Center hole */}
                    <circle
                      cx={DONUT_CX} cy={DONUT_CY} r={40}
                      fill={C.bg}
                      stroke={C.border}
                      strokeWidth={1}
                    />
                  </svg>
                  {/* Center text overlay — per-day rate per 16C design */}
                  <div style={{
                    position: 'absolute', inset: 0,
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    pointerEvents: 'none',
                  }}>
                    <span style={{ fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h3)', fontWeight: 600, color: 'var(--sb-ink-1)', letterSpacing: '-0.02em', lineHeight: 1 }}>
                      {dayRate > 0 ? `${dayRate.toLocaleString('en-US')}` : '–'}
                    </span>
                    <span style={{ fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-3)', marginTop: 2, letterSpacing: '0.08em', fontWeight: 700 }}>
                      EGP/DAY
                    </span>
                    <span style={{ fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)', marginTop: 4 }}>
                      {TOTAL > 0 ? `${(TOTAL / 1000).toFixed(0)}K total` : 'no data'}
                    </span>
                  </div>
                </div>

                {/* Legend */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 8 }}>
                  {segments.map((seg, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 12, height: 12, borderRadius: 'var(--sb-r-chip)', background: seg.color, flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: 'var(--sb-t-body)', color: C.textPri }}>{seg.name}</span>
                      <span style={{ fontSize: 'var(--sb-t-body-s)', color: C.textMuted, marginRight: 8 }}>
                        {Math.round(seg.pct * 100)}%
                      </span>
                      <span style={{ fontSize: 'var(--sb-t-label)', color: C.textPri, fontWeight: 600, minWidth: 72, textAlign: 'right' }}>
                        {seg.amt.toLocaleString('en-US')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Bars view ── */}
            {reportView === 'bars' && (
              <div key={`bars-${rangeKey}`} className="report-view" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {REPORT_DATA.map((d, i) => (
                  <div key={i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 'var(--sb-t-label)', color: C.textPri }}>{d.name}</span>
                      <span style={{ fontSize: 'var(--sb-t-label)', color: C.textPri, fontWeight: 600 }}>
                        {d.amt.toLocaleString('en-US')}
                      </span>
                    </div>
                    <div style={{
                      height: 30,
                      borderRadius: 'var(--sb-r-chip)',
                      background: C.surface,
                      overflow: 'hidden',
                      border: `var(--sb-border-width) solid ${C.border}`,
                    }}>
                      <div
                        className="report-bar"
                        style={{
                          height: '100%',
                          width: `${Math.max((d.amt / maxAmt) * 100, 42 / (maxAmt / 100))}%`,
                          minWidth: 42,
                          background: d.color,
                          borderRadius: 'var(--sb-r-chip)',
                          animationDelay: `${i * 60}ms`,
                        }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

      </div>
    </div>
  )
}

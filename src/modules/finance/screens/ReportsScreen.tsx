import { useState, useMemo } from 'react'
import { useFinanceStore } from '../financeStore'
import { toBase, baseCurrency, currenciesNeedingRates } from '../fx'

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

function addMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(year, month + delta, 1)
  return { year: d.getFullYear(), month: d.getMonth() }
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// Ten hues that stay apart from each other and sit on the warm ground the rest
// of the module is built on. Mid-tone throughout, so a slice carries its label
// whichever end of the list it comes from.
const PALETTE = [
  '#C0563C', '#3F7FA6', '#7A8C3A', '#B4577F', '#D99A2B',
  '#2F8C6E', '#7C6BB0', '#8A6A4F', '#5B8C8C', '#A8892B',
]

/** The colour every category is seeded with. Two categories the same colour is
 *  a chart nobody can read, and all of them arrive this one. */
const SEED_COLOUR = '#8C8071'

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
    bg:        '#F7F4EA',
    surface:   '#FFFFFF',
    amberBg:   'rgba(245,209,78,0.12)',
    border:    '#E8E1CE',
    borderSt:  '#E8E1CE',
    divFaint:  '#E8E1CE',
    amber:     '#F5D14E',
    textPri:   '#191712',
    textMuted: '#6C6553',
    textDim:   '#9B9180',
    red:       '#C62828',
    green:     '#0C8140',
  }

  const { transactions, categories } = useFinanceStore()

  const today = new Date()
  const [reportYear, setReportYear] = useState(today.getFullYear())
  const [reportMonth, setReportMonth] = useState(today.getMonth()) // 0-indexed
  const [reportView, setReportView] = useState<'donut' | 'bars'>('donut')

  const monthPrefix = `${reportYear}-${String(reportMonth + 1).padStart(2, '0')}`

  const base = baseCurrency()
  const expTxns = transactions.filter(tx => tx.type === 'expense' && tx.date.startsWith(monthPrefix))
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
  }, [transactions, categories, monthPrefix, base])
  const TOTAL = REPORT_DATA.reduce((s, d) => s + d.amt, 0)

  const segments = TOTAL > 0 ? buildSegments(REPORT_DATA, TOTAL) : []
  const maxAmt   = Math.max(...REPORT_DATA.map(d => d.amt), 1)

  function navigateMonth(delta: number) {
    const { year, month } = addMonth(reportYear, reportMonth, delta)
    setReportYear(year)
    setReportMonth(month)
  }

  const lastDay = new Date(reportYear, reportMonth + 1, 0).getDate()
  const dateRangeLabel = `1 ${MONTH_SHORT[reportMonth]} ${reportYear} › ${lastDay} ${MONTH_SHORT[reportMonth]} ${reportYear}`

  const daysInMonth = new Date(reportYear, reportMonth + 1, 0).getDate()
  const dayRate = TOTAL > 0 ? Math.round(TOTAL / daysInMonth) : 0


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
        borderBottom: '1px solid #E8E1CE',
        padding: '14px 26px 16px',
        display: 'flex', alignItems: 'flex-end', gap: 20,
      }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', color: '#6C6553', display: 'block', marginBottom: 4 }}>MONEY</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => navigateMonth(-1)} style={{ background: 'none', border: 'none', color: '#6C6553', fontSize: 20, cursor: 'pointer', padding: 0, lineHeight: 1 }}>‹</button>
            <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 28, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1, color: '#191712' }}>
              Reports · {MONTH_SHORT[reportMonth]}
            </span>
            <button onClick={() => navigateMonth(1)} style={{ background: 'none', border: 'none', color: '#6C6553', fontSize: 20, cursor: 'pointer', padding: 0, lineHeight: 1 }}>›</button>
          </div>
          <span style={{ fontSize: 12, color: '#6C6553', display: 'block', marginTop: 3 }}>
            {TOTAL > 0 ? `${base} ${dayRate.toLocaleString('en-US')}/day · ${REPORT_DATA.length} categories` : 'No expenses logged this month'}
            {reportUnrated.length > 0 && (
              <span title={`No rate set for ${reportUnrated.join(', ')}, so it is not counted`}
                style={{ marginLeft: 6, color: '#C08A2E' }}>· {reportUnrated.join(' ')} not counted</span>
            )}
          </span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 3 }}>
          {/* View toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: 3, borderRadius: 999, background: '#EDE7D9' }}>
            {(['donut', 'bars'] as const).map(v => (
              <button key={v} onClick={() => setReportView(v)} style={{
                height: 28, padding: '0 14px', borderRadius: 999, border: 'none',
                background: reportView === v ? '#FFFFFF' : 'transparent',
                color: reportView === v ? '#191712' : '#6C6553',
                fontSize: 11.5, fontWeight: reportView === v ? 600 : 400, cursor: 'pointer',
                boxShadow: reportView === v ? '0 1px 3px rgba(25,23,18,0.16)' : 'none',
                fontFamily: 'inherit',
                transition: 'background 220ms ease, color 220ms ease, box-shadow 220ms ease',
              }}>{v === 'donut' ? 'Donut' : 'Bars'}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>

        {/* Date range pill */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
          <span style={{
            fontSize: 13, color: C.textMuted,
            background: C.surface, border: `1px solid ${C.border}`,
            borderRadius: 20, padding: '6px 16px',
          }}>
            {dateRangeLabel}
          </span>
        </div>

        {REPORT_DATA.length === 0 ? (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: 200, color: C.textMuted, fontSize: 14,
          }}>
            No expense transactions in {MONTH_NAMES[reportMonth]}
          </div>
        ) : (
          <>
            {/* ── Donut view ── */}
            {reportView === 'donut' && (
              <div key={`donut-${monthPrefix}`} className="report-view" style={{ display: 'flex', gap: 40, alignItems: 'flex-start' }}>

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
                    <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 16, fontWeight: 600, color: '#191712', letterSpacing: '-0.02em', lineHeight: 1 }}>
                      {dayRate > 0 ? `${dayRate.toLocaleString('en-US')}` : '–'}
                    </span>
                    <span style={{ fontSize: 9, color: '#6C6553', marginTop: 2, letterSpacing: '0.08em', fontWeight: 700 }}>
                      EGP/DAY
                    </span>
                    <span style={{ fontSize: 9, color: '#9B9180', marginTop: 4 }}>
                      {TOTAL > 0 ? `${(TOTAL / 1000).toFixed(0)}K total` : 'no data'}
                    </span>
                  </div>
                </div>

                {/* Legend */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 8 }}>
                  {segments.map((seg, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 12, height: 12, borderRadius: 3, background: seg.color, flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: 13, color: C.textPri }}>{seg.name}</span>
                      <span style={{ fontSize: 12, color: C.textMuted, marginRight: 8 }}>
                        {Math.round(seg.pct * 100)}%
                      </span>
                      <span style={{ fontSize: 13, color: C.textPri, fontWeight: 600, minWidth: 72, textAlign: 'right' }}>
                        {seg.amt.toLocaleString('en-US')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Bars view ── */}
            {reportView === 'bars' && (
              <div key={`bars-${monthPrefix}`} className="report-view" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {REPORT_DATA.map((d, i) => (
                  <div key={i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 13, color: C.textPri }}>{d.name}</span>
                      <span style={{ fontSize: 13, color: C.textPri, fontWeight: 600 }}>
                        {d.amt.toLocaleString('en-US')}
                      </span>
                    </div>
                    <div style={{
                      height: 30,
                      borderRadius: 6,
                      background: C.surface,
                      overflow: 'hidden',
                      border: `1px solid ${C.border}`,
                    }}>
                      <div
                        className="report-bar"
                        style={{
                          height: '100%',
                          width: `${Math.max((d.amt / maxAmt) * 100, 42 / (maxAmt / 100))}%`,
                          minWidth: 42,
                          background: d.color,
                          borderRadius: 6,
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

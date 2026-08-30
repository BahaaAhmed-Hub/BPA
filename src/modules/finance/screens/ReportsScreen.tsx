import { useState } from 'react'
import { useFinanceStore } from '../financeStore'

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

const PALETTE = ['#4CC76B','#2BA37A','#E8C04A','#C0392B','#E8553A','#46C2D6','#4A90E2','#9B59B6','#F39C12']

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
    red:       '#DA4A3E',
    green:     '#2FA869',
  }

  const { transactions, categories } = useFinanceStore()

  const today = new Date()
  const [reportYear, setReportYear] = useState(today.getFullYear())
  const [reportMonth, setReportMonth] = useState(today.getMonth()) // 0-indexed
  const [reportView, setReportView] = useState<'donut' | 'bars'>('donut')

  const monthPrefix = `${reportYear}-${String(reportMonth + 1).padStart(2, '0')}`

  const expTxns = transactions.filter(tx => tx.type === 'expense' && tx.date.startsWith(monthPrefix))
  const byCategory = new Map<string, number>()
  expTxns.forEach(tx => {
    const key = tx.categoryId ?? '__none__'
    byCategory.set(key, (byCategory.get(key) ?? 0) + Math.abs(tx.amount))
  })
  const REPORT_DATA = [...byCategory.entries()]
    .map(([catId, amt], i) => {
      const cat = categories.find(c => c.id === catId)
      return { name: cat?.name ?? 'Uncategorized', amt, color: cat?.color ?? PALETTE[i % PALETTE.length] }
    })
    .sort((a, b) => b.amt - a.amt)
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%', overflow: 'hidden', background: C.bg }}>

      {/* Header */}
      <div style={{
        height: 64, flexShrink: 0,
        borderBottom: '1px solid #E8E1CE',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 30px',
      }}>
        {/* Month navigator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => navigateMonth(-1)}
            style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 20, cursor: 'pointer', padding: '2px 6px', lineHeight: 1 }}
          >‹</button>
          <span style={{ fontSize: 20, fontWeight: 700, color: C.textPri, minWidth: 140, textAlign: 'center' as const }}>
            {MONTH_NAMES[reportMonth]} {reportYear}
          </span>
          <button
            onClick={() => navigateMonth(1)}
            style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 20, cursor: 'pointer', padding: '2px 6px', lineHeight: 1 }}
          >›</button>
        </div>

        {/* Toggle */}
        <div style={{
          display: 'flex',
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 9,
          overflow: 'hidden',
        }}>
          {(['donut', 'bars'] as const).map(v => (
            <button
              key={v}
              onClick={() => setReportView(v)}
              style={{
                padding: '8px 16px', cursor: 'pointer', fontSize: 12.5,
                border: 'none', fontFamily: 'inherit',
                background: reportView === v ? C.amberBg : 'transparent',
                color: reportView === v ? C.amber : C.textMuted,
                fontWeight: reportView === v ? 600 : 400,
              }}
            >
              {v === 'donut' ? 'Donut' : 'Bars'}
            </button>
          ))}
        </div>

        {/* Export */}
        <button style={{
          padding: '8px 14px', borderRadius: 9,
          border: `1px solid ${C.borderSt}`,
          background: C.amberBg, color: C.amber,
          fontSize: 13, fontWeight: 600,
          cursor: 'pointer', fontFamily: 'inherit',
        }}>
          Export
        </button>
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
              <div style={{ display: 'flex', gap: 40, alignItems: 'flex-start' }}>

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
                        cx={DONUT_CX} cy={DONUT_CY} r={DONUT_R}
                        fill="none"
                        stroke={seg.color}
                        strokeWidth={DONUT_SW}
                        strokeDasharray={`${seg.dash} ${seg.gap}`}
                        strokeDashoffset={-seg.offset}
                        transform={`rotate(-90 ${DONUT_CX} ${DONUT_CY})`}
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
                  {/* Center text overlay */}
                  <div style={{
                    position: 'absolute', inset: 0,
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    pointerEvents: 'none',
                  }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: C.textPri }}>
                      {TOTAL >= 1000 ? `${(TOTAL / 1000).toFixed(0)}K` : TOTAL.toLocaleString('en-US')}
                    </span>
                    <span style={{ fontSize: 10, color: C.textMuted, marginTop: 2, letterSpacing: '0.5px' }}>
                      EXPENSES
                    </span>
                  </div>
                </div>

                {/* Legend */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 8 }}>
                  {segments.map((seg, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 12, height: 12, borderRadius: 2, background: seg.color, flexShrink: 0 }} />
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
                      <div style={{
                        height: '100%',
                        width: `${Math.max((d.amt / maxAmt) * 100, 42 / (maxAmt / 100))}%`,
                        minWidth: 42,
                        background: d.color,
                        borderRadius: 6,
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

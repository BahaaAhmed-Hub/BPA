import { useState } from 'react'

// ─── Colors ───────────────────────────────────────────────────────────────────

const C = {
  bg:        '#0B0A08',
  surface:   '#16120D',
  amberBg:   '#1E1609',
  border:    '#272118',
  borderSt:  '#3A3326',
  divFaint:  '#1B160F',
  amber:     '#C49A3C',
  textPri:   '#F2EBDD',
  textMuted: '#8C8071',
  textDim:   '#565049',
  red:       '#DA4A3E',
  green:     '#2FA869',
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const REPORT_DATA = [
  { name: 'Personal',          amt: 47896, color: '#4CC76B' },
  { name: 'Girls Life',        amt: 37380, color: '#2BA37A' },
  { name: 'Debt',              amt: 27500, color: '#E8C04A' },
  { name: 'Digital Apps',      amt: 9706,  color: '#C0392B' },
  { name: 'DX Business trips', amt: 6796,  color: '#E8553A' },
  { name: 'Misc',              amt: 2620,  color: '#46C2D6' },
  { name: 'Car',               amt: 1095,  color: '#4A90E2' },
]

const TOTAL = REPORT_DATA.reduce((s, d) => s + d.amt, 0)

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

// ─── Props ────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ReportsScreen(_props?: any) {
  const [reportView, setReportView] = useState<'donut' | 'bars'>('donut')

  const segments = buildSegments(REPORT_DATA, TOTAL)
  const maxAmt   = Math.max(...REPORT_DATA.map(d => d.amt))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%', overflow: 'hidden', background: C.bg }}>

      {/* Header */}
      <div style={{
        height: 64, flexShrink: 0,
        borderBottom: '1px solid #211C14',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 30px',
      }}>
        <span style={{ fontSize: 20, fontWeight: 700, color: C.textPri }}>Expenses</span>

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
            1 Jun 2026 › 30 Jun 2026 ···
          </span>
        </div>

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
                  {(TOTAL / 1000).toFixed(0)}K
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

      </div>
    </div>
  )
}

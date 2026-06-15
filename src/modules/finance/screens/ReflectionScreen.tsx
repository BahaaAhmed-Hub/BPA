import { useState } from 'react'

// ─── Colors ───────────────────────────────────────────────────────────────────

const C = {
  bg:        '#0B0A08',
  surface:   '#16120D',
  surfaceEl: '#1E1913',
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
  cyan:      '#46B6C9',
  purple:    '#7E78DD',
}

// ─── Static data ──────────────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const TYPE_COLORS: Record<string, string> = {
  F: '#C49A3C',
  G: '#46B6C9',
  O: '#2FB06C',
  I: '#2FA869',
}

const TYPE_LABELS: Record<string, string> = {
  F: 'Fixed',
  G: 'Guilt-free',
  O: 'Goal',
  I: 'Income',
}

const INC_SERIES = [
  { name: 'Teradix',      data: [120000,140000,140000,140000,140000,140000,140000,140000,140000,140000,140000,140000], color: '#34A86A' },
  { name: 'DXT',          data: [0,0,390000,0,0,156000,546000,0,0,546000,0,546000],                                   color: '#2E8FB0' },
  { name: 'TechLab',      data: [0,0,0,0,0,0,104000,104000,104000,104000,104000,104000],                              color: '#6FB7E0' },
  { name: 'Other income', data: [0,0,0,0,0,105000,65000,0,0,0,0,0],                                                  color: '#A7CF6B' },
]

interface SubRow { name: string; type: string; data: number[] }
interface ExpGroup { name: string; color: string; subs: SubRow[] }

const EXP_GROUPS: ExpGroup[] = [
  { name: 'Home', color: '#C49A3C', subs: [
    { name: 'SuperMarket',    type: 'F', data: [18041,11976,8200,9134,16314,18000,18000,18000,18000,18000,18000,18000] },
    { name: 'Temp Rent',      type: 'F', data: [25000,25000,25000,25000,25000,25000,25000,25000,27500,27500,27500,27500] },
    { name: 'Outing',         type: 'G', data: [2215,11493,4000,7400,1300,12000,12000,12000,12000,12000,12000,12000] },
    { name: 'Takeaway food',  type: 'G', data: [4515,5970,6500,6060,2200,6000,6000,6000,6000,6000,6000,6000] },
    { name: 'Smsm / Gifts',   type: 'F', data: [0,5700,2000,5400,1300,6000,6000,6000,6000,6000,20000,6000] },
    { name: 'Utilities',      type: 'F', data: [0,0,2000,0,0,2500,2500,2500,2500,1500,1500,1500] },
    { name: 'Travel',         type: 'G', data: [0,800,0,0,0,0,0,70000,0,0,0,0] },
  ]},
  { name: 'Girls', color: '#E0644E', subs: [
    { name: 'Schools — Halla', type: 'F', data: [66300,0,0,0,0,25857,0,77571,0,77571,0,77571] },
    { name: 'Schools — Hania', type: 'F', data: [47700,0,0,0,0,18603,0,55809,0,55809,0,55809] },
    { name: 'Girls expenses',  type: 'F', data: [20650,20650,20650,20650,20650,20650,20650,20650,20650,20650,20650,20650] },
    { name: 'Home rent',       type: 'F', data: [12000,12000,12000,12000,12000,12000,12000,12000,20000,20000,20000,20000] },
    { name: 'Girls with me',   type: 'F', data: [5130,2313,5678,7440,2500,12000,12000,12000,12000,12000,12000,12000] },
    { name: 'Girls clothes',   type: 'G', data: [20609,1000,11500,0,3700,20000,0,0,0,20000,0,0] },
  ]},
  { name: 'Me', color: '#46B6C9', subs: [
    { name: 'Apps',            type: 'F', data: [4667,8650,6230,8000,20900,8000,8000,8000,8000,8000,8000,8000] },
    { name: 'Clothes',         type: 'G', data: [0,1050,0,24000,2750,0,20000,0,20000,0,20000,0] },
    { name: 'My expenses',     type: 'F', data: [3020,3000,5025,7030,5300,10000,10000,10000,10000,10000,10000,10000] },
    { name: 'Transport / Gas', type: 'F', data: [2560,4400,11495,3450,7580,3500,3500,3500,3500,3500,3500,3500] },
    { name: 'Car insurance',   type: 'F', data: [0,0,0,0,0,0,0,0,50000,5000,0,0] },
    { name: 'Phone bill',      type: 'F', data: [0,5544,1244,3330,0,6080,0,0,0,0,0,0] },
  ]},
  { name: 'Finance', color: '#7E78DD', subs: [
    { name: 'Loans',          type: 'F', data: [0,34500,17250,17250,17250,17250,17250,17250,17250,17250,17250,17250] },
    { name: 'CC minimum 5%',  type: 'F', data: [13800,13000,0,0,5000,0,0,0,0,0,0,0] },
    { name: 'Premium cards',  type: 'F', data: [850,850,850,850,850,850,850,850,850,850,850,850] },
  ]},
  { name: 'Others', color: '#8C8071', subs: [
    { name: 'DX / TX',         type: 'F', data: [86242,9779,9360,11289,9880,10000,10000,10000,10000,10000,10000,10000] },
    { name: 'Fines / donation', type: 'G', data: [200,10560,2000,1650,2600,5000,5000,5000,5000,5000,5000,5000] },
    { name: 'Baba money',       type: 'F', data: [0,0,0,0,0,0,5000,5000,5000,5000,5000,5000] },
  ]},
]

const GOALS_SUBS: SubRow[] = [
  { name: 'Savings',    type: 'O', data: [0,0,0,0,0,0,0,0,60000,180000,0,200000] },
  { name: 'Investment', type: 'O', data: [0,0,0,0,0,0,0,0,60000,180000,0,200000] },
]

const NOTES: Record<string, string> = {
  'Travel|7':          'Family trip — Dubai',
  'Car insurance|8':   'Annual policy renewal',
  'DXT|2':             'Q1 milestone payment (390K)',
  'DXT|5':             'H1 settlement',
  'Schools — Halla|0': 'Term-1 deposit',
  'Apps|4':            'AI tooling spike',
  'Girls clothes|0':   'Back-to-school season',
  'Loans|1':           'New car loan begins',
  'Smsm / Gifts|10':   'Eid gifting',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0)
const addArrs = (arrs: number[][]) => arrs.reduce((acc, a) => acc.map((v, i) => v + a[i]), Array(12).fill(0) as number[])
const fmt = (v: number) => v ? v.toLocaleString('en-US') : '·'

// ─── Derived totals ───────────────────────────────────────────────────────────

function getIncomeByMonth(): number[] {
  return addArrs(INC_SERIES.map(s => s.data))
}

function getExpByMonth(): number[] {
  const allSubs = EXP_GROUPS.flatMap(g => g.subs)
  return addArrs(allSubs.map(s => s.data))
}

function getGoalsByMonth(): number[] {
  return addArrs(GOALS_SUBS.map(s => s.data))
}

function getGroupTotal(g: ExpGroup): number[] {
  return addArrs(g.subs.map(s => s.data))
}

// ─── Donut SVG for table view ─────────────────────────────────────────────────

function ShareDonut() {
  const groups = EXP_GROUPS.map(g => ({ name: g.name, color: g.color, total: sum(getGroupTotal(g)) }))
  const goalsTotal = sum(getGoalsByMonth())
  const all = [...groups, { name: 'Goals', color: '#2FB06C', total: goalsTotal }]
  const grandTotal = all.reduce((s, g) => s + g.total, 0)

  const r = 52, cx = 75, cy = 75, sw = 16
  const circ = 2 * Math.PI * r
  let offset = 0
  const segs = all.map(g => {
    const pct = g.total / grandTotal
    const dash = pct * circ
    const seg = { ...g, pct, dash, gap: circ - dash, offset }
    offset += dash
    return seg
  })

  return (
    <div style={{ display: 'flex', gap: 34, alignItems: 'center' }}>
      {/* SVG */}
      <div style={{ position: 'relative', flexShrink: 0, width: 150, height: 150 }}>
        <svg width={150} height={150} viewBox="0 0 150 150">
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={C.divFaint} strokeWidth={sw} />
          {segs.map((seg, i) => (
            <circle
              key={i}
              cx={cx} cy={cy} r={r}
              fill="none"
              stroke={seg.color}
              strokeWidth={sw}
              strokeDasharray={`${seg.dash} ${seg.gap}`}
              strokeDashoffset={-seg.offset}
              transform={`rotate(-90 ${cx} ${cy})`}
            />
          ))}
          <circle cx={cx} cy={cy} r={r - sw / 2 - 4} fill={C.bg} />
        </svg>
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <span style={{ fontSize: 9.5, color: C.textMuted, textAlign: 'center', lineHeight: 1.4 }}>
            Expenses<br />/ share
          </span>
        </div>
      </div>

      {/* Legend grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px' }}>
        {segs.map((seg, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: seg.color, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: C.textMuted }}>{seg.name}</span>
            <span style={{ fontSize: 11, color: C.textDim, marginLeft: 4 }}>
              {Math.round(seg.pct * 100)}%
            </span>
            <span style={{ fontSize: 11, color: C.textPri, marginLeft: 4 }}>
              {(seg.total / 1000).toFixed(0)}K
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Table View ───────────────────────────────────────────────────────────────

function TableView({ openGroups, setOpenGroups }: {
  openGroups: Record<string, boolean>
  setOpenGroups: (fn: (prev: Record<string, boolean>) => Record<string, boolean>) => void
}) {
  const incomeByMonth   = getIncomeByMonth()
  const expByMonth      = getExpByMonth()
  const goalsByMonth    = getGoalsByMonth()

  const totalOutflow    = MONTHS.map((_, mi) => expByMonth[mi] + goalsByMonth[mi])
  const netByMonth      = MONTHS.map((_, mi) => incomeByMonth[mi] - totalOutflow[mi])

  // Cumulative
  const cumulative: number[] = []
  let runningNet = 0
  for (let i = 0; i < 12; i++) {
    runningNet += netByMonth[i]
    cumulative.push(runningNet)
  }

  const grandIncomeTotal = sum(incomeByMonth)
  const grandExpTotal    = sum(expByMonth)
  const grandGoalsTotal  = sum(goalsByMonth)
  const grandNetTotal    = grandIncomeTotal - sum(totalOutflow)

  const cellStyle: React.CSSProperties = {
    flex: 1, minWidth: 56, textAlign: 'right',
    fontSize: 11, padding: '0 5px', position: 'relative',
  }

  function toggleGroup(name: string) {
    setOpenGroups(prev => ({ ...prev, [name]: !prev[name] }))
  }

  return (
    <div>
      {/* Share donut card */}
      <div style={{
        background: C.bg, border: `1px solid ${C.border}`,
        borderRadius: 14, padding: '18px 20px',
        marginBottom: 12,
      }}>
        <ShareDonut />
      </div>

      {/* Data table */}
      <div style={{
        background: C.bg, border: `1px solid ${C.border}`,
        borderRadius: 14, overflow: 'hidden',
        padding: '14px 16px',
      }}>
        <div style={{ minWidth: 1340, overflowX: 'auto' }}>

          {/* Header row */}
          <div style={{
            display: 'flex', alignItems: 'center',
            paddingBottom: 8, borderBottom: `1px solid ${C.border}`,
            marginBottom: 4,
          }}>
            <div style={{ width: 182, flexShrink: 0, fontSize: 11, color: C.textDim }}>EGP</div>
            {MONTHS.map(m => (
              <div key={m} style={{ ...cellStyle, fontSize: 10, color: C.textMuted, fontWeight: 600 }}>{m}</div>
            ))}
            <div style={{ width: 84, textAlign: 'right', fontSize: 10, color: C.textMuted, fontWeight: 600, flexShrink: 0 }}>Total</div>
            <div style={{ width: 46, textAlign: 'right', fontSize: 10, color: C.textMuted, fontWeight: 600, flexShrink: 0 }}>%</div>
          </div>

          {/* ── INCOME section header ── */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${C.divFaint}` }}>
            <div style={{ width: 182, flexShrink: 0, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.7px', color: C.green, textTransform: 'uppercase' as const }}>
              INCOME
            </div>
            {incomeByMonth.map((v, mi) => (
              <div key={mi} style={{ ...cellStyle, color: C.green, fontWeight: 600 }}>{fmt(v)}</div>
            ))}
            <div style={{ width: 84, textAlign: 'right', fontSize: 11.5, fontWeight: 700, color: C.green, flexShrink: 0 }}>
              {fmt(grandIncomeTotal)}
            </div>
            <div style={{ width: 46, textAlign: 'right', fontSize: 10, color: C.textDim, flexShrink: 0 }}>100%</div>
          </div>

          {/* Income sub-rows */}
          {INC_SERIES.map(series => {
            const total = sum(series.data)
            const pct   = grandIncomeTotal > 0 ? Math.round((total / grandIncomeTotal) * 100) : 0
            return (
              <div key={series.name} style={{
                display: 'flex', alignItems: 'center', padding: '4px 0',
                borderBottom: `1px solid ${C.divFaint}`,
              }}>
                <div style={{ width: 182, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 22 }}>
                  <div style={{ width: 7, height: 7, borderRadius: 1, background: series.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: C.textMuted }}>{series.name}</span>
                </div>
                {series.data.map((v, mi) => {
                  const noteKey = `${series.name}|${mi}`
                  const hasNote = !!NOTES[noteKey]
                  return (
                    <div key={mi} style={{ ...cellStyle }} title={hasNote ? NOTES[noteKey] : undefined}>
                      <span style={{ color: v ? C.textPri : C.textDim }}>{fmt(v)}</span>
                      {hasNote && (
                        <span style={{
                          position: 'absolute', top: 0, right: 3,
                          width: 4, height: 4, borderRadius: '50%', background: C.amber,
                        }} />
                      )}
                    </div>
                  )
                })}
                <div style={{ width: 84, textAlign: 'right', fontSize: 11, fontWeight: 600, color: C.textPri, flexShrink: 0 }}>
                  {fmt(total)}
                </div>
                <div style={{ width: 46, textAlign: 'right', fontSize: 10, color: C.textDim, flexShrink: 0 }}>{pct}%</div>
              </div>
            )
          })}

          {/* ── EXPENSES section header ── */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '8px 0 4px', borderBottom: `1px solid ${C.divFaint}` }}>
            <div style={{ width: 182, flexShrink: 0, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.7px', color: C.textMuted, textTransform: 'uppercase' as const }}>
              EXPENSES
            </div>
            {expByMonth.map((v, mi) => (
              <div key={mi} style={{ ...cellStyle, color: C.textMuted }}>{fmt(v)}</div>
            ))}
            <div style={{ width: 84, textAlign: 'right', fontSize: 11.5, fontWeight: 700, color: C.textMuted, flexShrink: 0 }}>
              {fmt(grandExpTotal)}
            </div>
            <div style={{ width: 46, textAlign: 'right', fontSize: 10, color: C.textDim, flexShrink: 0 }}>—</div>
          </div>

          {/* Expense groups */}
          {EXP_GROUPS.map(group => {
            const groupTotals = getGroupTotal(group)
            const groupSum    = sum(groupTotals)
            const isOpen      = openGroups[group.name]
            const pct         = grandExpTotal > 0 ? Math.round((groupSum / grandExpTotal) * 100) : 0

            return (
              <div key={group.name}>
                {/* Group row */}
                <div
                  onClick={() => toggleGroup(group.name)}
                  style={{
                    display: 'flex', alignItems: 'center', padding: '5px 0',
                    cursor: 'pointer',
                    borderBottom: `1px solid ${C.divFaint}`,
                    background: `${group.color}0A`,
                    borderLeft: `3px solid ${group.color}`,
                    paddingLeft: 6,
                  }}
                >
                  <div style={{ width: 182 - 6, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ fontSize: 10, color: C.textMuted }}>{isOpen ? '▾' : '▸'}</span>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: group.color }}>{group.name}</span>
                  </div>
                  {groupTotals.map((v, mi) => (
                    <div key={mi} style={{ ...cellStyle, fontWeight: 600, color: C.textPri }}>{fmt(v)}</div>
                  ))}
                  <div style={{ width: 84, textAlign: 'right', fontSize: 11.5, fontWeight: 700, color: C.textPri, flexShrink: 0 }}>
                    {fmt(groupSum)}
                  </div>
                  <div style={{ width: 46, textAlign: 'right', fontSize: 10, color: C.textDim, flexShrink: 0 }}>{pct}%</div>
                </div>

                {/* Sub-rows */}
                {isOpen && group.subs.map(sub => {
                  const subTotal = sum(sub.data)
                  const subPct   = groupSum > 0 ? Math.round((subTotal / groupSum) * 100) : 0
                  return (
                    <div key={sub.name} style={{
                      display: 'flex', alignItems: 'center', padding: '3px 0',
                      borderBottom: `1px solid ${C.divFaint}`,
                    }}>
                      <div style={{ width: 182, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5, paddingLeft: 22 }}>
                        <div style={{ width: 7, height: 7, borderRadius: 1, background: TYPE_COLORS[sub.type], flexShrink: 0 }} />
                        <span style={{ fontSize: 11, color: C.textMuted }}>{sub.name}</span>
                      </div>
                      {sub.data.map((v, mi) => {
                        const noteKey = `${sub.name}|${mi}`
                        const hasNote = !!NOTES[noteKey]
                        return (
                          <div key={mi} style={{ ...cellStyle }} title={hasNote ? NOTES[noteKey] : undefined}>
                            <span style={{ color: v ? C.textPri : C.textDim }}>{fmt(v)}</span>
                            {hasNote && (
                              <span style={{
                                position: 'absolute', top: 0, right: 3,
                                width: 4, height: 4, borderRadius: '50%', background: C.amber,
                              }} />
                            )}
                          </div>
                        )
                      })}
                      <div style={{ width: 84, textAlign: 'right', fontSize: 11, fontWeight: 600, color: C.textPri, flexShrink: 0 }}>
                        {fmt(subTotal)}
                      </div>
                      <div style={{ width: 46, textAlign: 'right', fontSize: 10, color: C.textDim, flexShrink: 0 }}>{subPct}%</div>
                    </div>
                  )
                })}
              </div>
            )
          })}

          {/* ── GOALS section header ── */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '8px 0 4px', borderBottom: `1px solid ${C.divFaint}` }}>
            <div style={{ width: 182, flexShrink: 0, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.7px', color: C.textMuted, textTransform: 'uppercase' as const }}>
              GOALS
            </div>
            {goalsByMonth.map((v, mi) => (
              <div key={mi} style={{ ...cellStyle, color: C.textMuted }}>{fmt(v)}</div>
            ))}
            <div style={{ width: 84, textAlign: 'right', fontSize: 11.5, fontWeight: 700, color: C.textMuted, flexShrink: 0 }}>
              {fmt(grandGoalsTotal)}
            </div>
            <div style={{ width: 46, textAlign: 'right', fontSize: 10, color: C.textDim, flexShrink: 0 }}>—</div>
          </div>

          {/* Goals sub-rows */}
          {GOALS_SUBS.map(sub => {
            const subTotal = sum(sub.data)
            return (
              <div key={sub.name} style={{
                display: 'flex', alignItems: 'center', padding: '3px 0',
                borderBottom: `1px solid ${C.divFaint}`,
              }}>
                <div style={{ width: 182, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5, paddingLeft: 22 }}>
                  <div style={{ width: 7, height: 7, borderRadius: 1, background: TYPE_COLORS[sub.type], flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: C.textMuted }}>{sub.name}</span>
                </div>
                {sub.data.map((v, mi) => (
                  <div key={mi} style={{ ...cellStyle }}>
                    <span style={{ color: v ? C.textPri : C.textDim }}>{fmt(v)}</span>
                  </div>
                ))}
                <div style={{ width: 84, textAlign: 'right', fontSize: 11, fontWeight: 600, color: C.textPri, flexShrink: 0 }}>
                  {fmt(subTotal)}
                </div>
                <div style={{ width: 46, textAlign: 'right', fontSize: 10, color: C.textDim, flexShrink: 0 }}>—</div>
              </div>
            )
          })}

          {/* ── TOTALS section ── */}
          <div style={{ marginTop: 6, borderRadius: 8, overflow: 'hidden', background: '#15110B' }}>

            {/* Total income row */}
            <div style={{ display: 'flex', alignItems: 'center', padding: '5px 6px' }}>
              <div style={{ width: 182, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: C.green, fontSize: 12 }}>▲</span>
                <span style={{ fontSize: 11, color: C.textMuted }}>Total income</span>
              </div>
              {incomeByMonth.map((v, mi) => (
                <div key={mi} style={{ ...cellStyle, color: C.green, fontWeight: 600 }}>{fmt(v)}</div>
              ))}
              <div style={{ width: 84, textAlign: 'right', fontSize: 11.5, fontWeight: 700, color: C.green, flexShrink: 0 }}>
                {fmt(grandIncomeTotal)}
              </div>
              <div style={{ width: 46, flexShrink: 0 }} />
            </div>

            {/* Total outflow row */}
            <div style={{ display: 'flex', alignItems: 'center', padding: '5px 6px' }}>
              <div style={{ width: 182, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: C.amber, fontSize: 12 }}>▼</span>
                <span style={{ fontSize: 11, color: C.textMuted }}>Total outflow</span>
              </div>
              {totalOutflow.map((v, mi) => (
                <div key={mi} style={{ ...cellStyle, color: C.amber, fontWeight: 600 }}>{fmt(v)}</div>
              ))}
              <div style={{ width: 84, textAlign: 'right', fontSize: 11.5, fontWeight: 700, color: C.amber, flexShrink: 0 }}>
                {fmt(sum(totalOutflow))}
              </div>
              <div style={{ width: 46, flexShrink: 0 }} />
            </div>

            {/* Net month row */}
            <div style={{ display: 'flex', alignItems: 'center', padding: '5px 6px', borderTop: `1px solid ${C.border}` }}>
              <div style={{ width: 182, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: C.textMuted, fontSize: 12 }}>=</span>
                <span style={{ fontSize: 11, color: C.textMuted, fontWeight: 600 }}>Net month</span>
              </div>
              {netByMonth.map((v, mi) => (
                <div key={mi} style={{ ...cellStyle, color: v >= 0 ? C.green : C.red, fontWeight: 600 }}>
                  {v >= 0 ? '' : '−'}{fmt(Math.abs(v))}
                </div>
              ))}
              <div style={{ width: 84, textAlign: 'right', fontSize: 11.5, fontWeight: 700, color: grandNetTotal >= 0 ? C.green : C.red, flexShrink: 0 }}>
                {grandNetTotal >= 0 ? '' : '−'}{fmt(Math.abs(grandNetTotal))}
              </div>
              <div style={{ width: 46, flexShrink: 0 }} />
            </div>

            {/* Cumulative cashflow row */}
            <div style={{ display: 'flex', alignItems: 'center', padding: '5px 6px' }}>
              <div style={{ width: 182, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: C.textMuted, fontSize: 12 }}>∑</span>
                <span style={{ fontSize: 11, color: C.textMuted }}>Cumulative</span>
              </div>
              {cumulative.map((v, mi) => (
                <div key={mi} style={{ ...cellStyle, color: v >= 0 ? C.green : C.red }}>
                  {v >= 0 ? '' : '−'}{fmt(Math.abs(v))}
                </div>
              ))}
              <div style={{ width: 84, flexShrink: 0 }} />
              <div style={{ width: 46, flexShrink: 0 }} />
            </div>

          </div>

        </div>
      </div>
    </div>
  )
}

// ─── Bars View ────────────────────────────────────────────────────────────────

function BarsView({
  detail, by, showValues, hiddenSeries, setHiddenSeries,
}: {
  detail: 'stacked' | 'totals'
  by: 'cat' | 'type'
  showValues: boolean
  hiddenSeries: Record<string, boolean>
  setHiddenSeries: (fn: (prev: Record<string, boolean>) => Record<string, boolean>) => void
}) {
  const incomeByMonth = getIncomeByMonth()
  const expByMonth    = getExpByMonth()
  const goalsByMonth  = getGoalsByMonth()
  const outflowByMonth = MONTHS.map((_, mi) => expByMonth[mi] + goalsByMonth[mi])

  // Income series for stacked
  const visibleIncomeSeries = INC_SERIES.filter(s => !hiddenSeries[s.name])

  // Expense series: by category (groups) or by type
  type BarSeries = { name: string; color: string; data: number[] }
  let expSeries: BarSeries[]
  if (by === 'cat') {
    expSeries = EXP_GROUPS.map(g => ({
      name: g.name, color: g.color,
      data: getGroupTotal(g),
    }))
    expSeries.push({ name: 'Goals', color: '#2FB06C', data: getGoalsByMonth() })
  } else {
    // by type: F, G, O
    const byType: Record<string, number[]> = { F: Array(12).fill(0), G: Array(12).fill(0), O: Array(12).fill(0) }
    for (const g of EXP_GROUPS) {
      for (const sub of g.subs) {
        for (let mi = 0; mi < 12; mi++) {
          byType[sub.type][mi] += sub.data[mi]
        }
      }
    }
    for (const sub of GOALS_SUBS) {
      for (let mi = 0; mi < 12; mi++) {
        byType[sub.type][mi] += sub.data[mi]
      }
    }
    expSeries = Object.entries(byType).map(([type, data]) => ({
      name: TYPE_LABELS[type], color: TYPE_COLORS[type], data,
    }))
  }

  const visibleExpSeries = expSeries.filter(s => !hiddenSeries[s.name])

  const maxValue = Math.max(
    ...MONTHS.map((_, mi) => {
      const incVal = visibleIncomeSeries.reduce((s, ser) => s + ser.data[mi], 0)
      const expVal = visibleExpSeries.reduce((s, ser) => s + ser.data[mi], 0)
      return Math.max(incVal, expVal)
    }),
    1,
  )

  // Totals mode
  const maxTotalsValue = Math.max(...MONTHS.map((_, mi) => Math.max(incomeByMonth[mi], outflowByMonth[mi])), 1)

  // Trend line points helper
  const trendPoints = (vals: number[], maxV: number, height: number, totalWidth: number, cols: number) =>
    vals.map((v, i) => `${((i + 0.5) * (totalWidth / cols)).toFixed(1)},${(height - (v / maxV) * 220).toFixed(1)}`).join(' ')

  const toggleSeries = (name: string) => {
    setHiddenSeries(prev => ({ ...prev, [name]: !prev[name] }))
  }

  return (
    <div style={{
      background: C.bg, border: `1px solid ${C.border}`,
      borderRadius: 14, padding: '20px 22px',
    }}>

      {detail === 'stacked' ? (
        <>
          {/* Stacked legend */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' as const, marginBottom: 16 }}>
            <span style={{ fontSize: 10.5, color: C.textMuted, fontWeight: 700 }}>INCOME</span>
            {INC_SERIES.map(s => (
              <button
                key={s.name}
                onClick={() => toggleSeries(s.name)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 11.5, color: C.textMuted,
                  display: 'flex', alignItems: 'center', gap: 5,
                  textDecoration: hiddenSeries[s.name] ? 'line-through' : 'none',
                  opacity: hiddenSeries[s.name] ? 0.28 : 1,
                }}
              >
                <div style={{ width: 10, height: 10, borderRadius: 2, background: s.color }} />
                {s.name}
              </button>
            ))}
            <div style={{ width: 1, height: 14, background: C.border }} />
            <span style={{ fontSize: 10.5, color: C.textMuted, fontWeight: 700 }}>OUTFLOW</span>
            {expSeries.map(s => (
              <button
                key={s.name}
                onClick={() => toggleSeries(s.name)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 11.5, color: C.textMuted,
                  display: 'flex', alignItems: 'center', gap: 5,
                  textDecoration: hiddenSeries[s.name] ? 'line-through' : 'none',
                  opacity: hiddenSeries[s.name] ? 0.28 : 1,
                }}
              >
                <div style={{ width: 10, height: 10, borderRadius: 2, background: s.color }} />
                {s.name}
              </button>
            ))}
          </div>

          {/* Stacked bar chart */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 8 }}>
            {MONTHS.map((mo, mi) => {
              const incTotal = visibleIncomeSeries.reduce((s, ser) => s + ser.data[mi], 0)
              const expTotal = visibleExpSeries.reduce((s, ser) => s + ser.data[mi], 0)
              const incH = Math.round((incTotal / maxValue) * 240)
              const expH = Math.round((expTotal / maxValue) * 240)

              return (
                <div key={mo} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  {/* Values above */}
                  {showValues && (
                    <div style={{ fontSize: 9, color: C.textDim, marginBottom: 2, textAlign: 'center' }}>
                      {(incTotal / 1000).toFixed(0)}K
                    </div>
                  )}

                  {/* Two bars side by side */}
                  <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 240 }}>
                    {/* Income bar */}
                    <div style={{ width: 30, height: incH, display: 'flex', flexDirection: 'column-reverse', overflow: 'hidden', borderRadius: '3px 3px 0 0' }}>
                      {visibleIncomeSeries.map(ser => {
                        const segH = Math.round((ser.data[mi] / maxValue) * 240)
                        return segH > 0 ? (
                          <div
                            key={ser.name}
                            style={{
                              height: segH, background: ser.color,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              overflow: 'hidden',
                            }}
                          >
                            {showValues && segH >= 15 && (
                              <span style={{ fontSize: 8, color: 'rgba(0,0,0,0.6)', transform: 'rotate(-90deg)', whiteSpace: 'nowrap' as const }}>
                                {(ser.data[mi] / 1000).toFixed(0)}K
                              </span>
                            )}
                          </div>
                        ) : null
                      })}
                    </div>

                    {/* Outflow bar */}
                    <div style={{ width: 30, height: expH, display: 'flex', flexDirection: 'column-reverse', overflow: 'hidden', borderRadius: '3px 3px 0 0' }}>
                      {visibleExpSeries.map(ser => {
                        const segH = Math.round((ser.data[mi] / maxValue) * 240)
                        return segH > 0 ? (
                          <div
                            key={ser.name}
                            style={{
                              height: segH, background: ser.color,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              overflow: 'hidden',
                            }}
                          >
                            {showValues && segH >= 15 && (
                              <span style={{ fontSize: 8, color: 'rgba(0,0,0,0.5)', transform: 'rotate(-90deg)', whiteSpace: 'nowrap' as const }}>
                                {(ser.data[mi] / 1000).toFixed(0)}K
                              </span>
                            )}
                          </div>
                        ) : null
                      })}
                    </div>
                  </div>

                  {/* Month label */}
                  <div style={{ fontSize: 11, color: C.textMuted, marginTop: 6 }}>{mo}</div>
                </div>
              )
            })}
          </div>

          <div style={{ fontSize: 11, color: C.textDim, marginTop: 8 }}>
            Left bar = income · Right bar = outflow
          </div>
        </>
      ) : (
        <>
          {/* Totals mode */}
          {/* Legend */}
          <div style={{ display: 'flex', gap: 18, marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: C.green }} />
              <span style={{ fontSize: 11.5, color: C.textMuted }}>Income</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: C.amber }} />
              <span style={{ fontSize: 11.5, color: C.textMuted }}>Outflow</span>
            </div>
          </div>

          {/* MoM income % row above */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 4 }}>
            {MONTHS.map((_, mi) => {
              if (mi === 0) return <div key={mi} style={{ flex: 1 }} />
              const prev = incomeByMonth[mi - 1]
              const curr = incomeByMonth[mi]
              const pct  = prev > 0 ? Math.round(((curr - prev) / prev) * 100) : 0
              const up   = pct >= 0
              return (
                <div key={mi} style={{ flex: 1, textAlign: 'center', fontSize: 9.5, color: up ? C.green : C.red }}>
                  {up ? '▲' : '▼'}{Math.abs(pct)}%
                </div>
              )
            })}
          </div>

          {/* Bars + trend line */}
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', height: 260, position: 'relative' }}>
              {MONTHS.map((mo, mi) => {
                const incH = Math.round((incomeByMonth[mi] / maxTotalsValue) * 220)
                const expH = Math.round((outflowByMonth[mi] / maxTotalsValue) * 220)
                return (
                  <div key={mo} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    {showValues && (
                      <div style={{ fontSize: 9, color: C.textDim, marginBottom: 2 }}>
                        {(incomeByMonth[mi] / 1000).toFixed(0)}K
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 240 }}>
                      <div style={{ width: 30, height: incH, background: C.green, borderRadius: '3px 3px 0 0' }} />
                      <div style={{ width: 30, height: expH, background: C.amber, borderRadius: '3px 3px 0 0' }} />
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Trend line SVG */}
            <svg
              style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: 260, pointerEvents: 'none' }}
              viewBox="0 0 1200 260"
              preserveAspectRatio="none"
            >
              <polyline
                points={trendPoints(incomeByMonth, maxTotalsValue, 260, 1200, 12)}
                fill="none" stroke="#67D6A0" strokeWidth={1.5} strokeLinejoin="round"
              />
              <polyline
                points={trendPoints(outflowByMonth, maxTotalsValue, 260, 1200, 12)}
                fill="none" stroke="#E0C57E" strokeWidth={1.5} strokeLinejoin="round"
              />
            </svg>
          </div>

          {/* Month labels */}
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            {MONTHS.map(mo => (
              <div key={mo} style={{ flex: 1, textAlign: 'center', fontSize: 11, color: C.textMuted }}>{mo}</div>
            ))}
          </div>

          {/* MoM outflow % row */}
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            {MONTHS.map((_, mi) => {
              if (mi === 0) return <div key={mi} style={{ flex: 1 }} />
              const prev = outflowByMonth[mi - 1]
              const curr = outflowByMonth[mi]
              const pct  = prev > 0 ? Math.round(((curr - prev) / prev) * 100) : 0
              const up   = pct >= 0
              return (
                <div key={mi} style={{ flex: 1, textAlign: 'center', fontSize: 9.5, color: up ? C.red : C.green }}>
                  {up ? '▲' : '▼'}{Math.abs(pct)}%
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Reflection Screen ────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ReflectionScreen(_props?: any) {
  const [view,       setView]       = useState<'table' | 'bars'>('table')
  const [showValues, setShowValues] = useState(false)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ Income: true, Home: true })
  const [hiddenSeries, setHiddenSeries] = useState<Record<string, boolean>>({})
  const [by,         setBy]         = useState<'cat' | 'type'>('cat')
  const [detail,     setDetail]     = useState<'stacked' | 'totals'>('stacked')

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '26px 30px 60px', background: C.bg }}>

      {/* Top controls bar */}
      <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 12, marginBottom: 16, alignItems: 'flex-end', justifyContent: 'space-between' }}>

        {/* Left: title */}
        <div>
          <div style={{ fontSize: 10, textTransform: 'uppercase' as const, color: C.textMuted, letterSpacing: '0.8px', fontWeight: 700, marginBottom: 4 }}>
            The Professor · Reflect
          </div>
          <div style={{ fontSize: 25, fontWeight: 700, color: C.textPri }}>
            Financials Reflection
          </div>
        </div>

        {/* Right: controls */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' as const }}>

          {/* Bars-only controls */}
          {view === 'bars' && (
            <>
              {/* Stacked/Totals toggle */}
              <div style={{
                display: 'flex', background: C.surface,
                border: `1px solid ${C.border}`, borderRadius: 9, overflow: 'hidden',
              }}>
                {(['stacked', 'totals'] as const).map(v => (
                  <button key={v} onClick={() => setDetail(v)} style={{
                    padding: '7px 13px', border: 'none', cursor: 'pointer',
                    fontFamily: 'inherit', fontSize: 12,
                    background: detail === v ? C.amberBg : 'transparent',
                    color: detail === v ? C.amber : C.textMuted,
                    fontWeight: detail === v ? 600 : 400,
                  }}>
                    {v.charAt(0).toUpperCase() + v.slice(1)}
                  </button>
                ))}
              </div>

              {/* By category/type (only in stacked) */}
              {detail === 'stacked' && (
                <div style={{
                  display: 'flex', background: C.surface,
                  border: `1px solid ${C.border}`, borderRadius: 9, overflow: 'hidden',
                }}>
                  {([['cat', 'By category'], ['type', 'By type']] as const).map(([v, label]) => (
                    <button key={v} onClick={() => setBy(v)} style={{
                      padding: '7px 13px', border: 'none', cursor: 'pointer',
                      fontFamily: 'inherit', fontSize: 12,
                      background: by === v ? C.amberBg : 'transparent',
                      color: by === v ? C.amber : C.textMuted,
                      fontWeight: by === v ? 600 : 400,
                    }}>
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {/* Show values button */}
              <button
                onClick={() => setShowValues(v => !v)}
                style={{
                  padding: '7px 13px', borderRadius: 9,
                  border: `1px solid ${showValues ? C.amber : C.border}`,
                  background: showValues ? C.amberBg : C.surface,
                  color: showValues ? C.amber : C.textMuted,
                  fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Show values
              </button>
            </>
          )}

          {/* View toggle */}
          <div style={{
            display: 'flex', background: C.surface,
            border: `1px solid ${C.border}`, borderRadius: 9, overflow: 'hidden',
          }}>
            {([['table', 'Category table'], ['bars', 'Cashflow bars']] as const).map(([v, label]) => (
              <button key={v} onClick={() => setView(v)} style={{
                padding: '7px 13px', border: 'none', cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 12,
                background: view === v ? C.amberBg : 'transparent',
                color: view === v ? C.amber : C.textMuted,
                fontWeight: view === v ? 600 : 400,
              }}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Type legend */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 20, alignItems: 'center' }}>
        {[
          { label: 'Income',     color: C.green },
          { label: 'Fixed',      color: C.amber },
          { label: 'Guilt-free', color: C.cyan  },
          { label: 'Goal',       color: '#2FB06C' },
        ].map(({ label, color }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: C.textMuted }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Main content */}
      {view === 'table' ? (
        <TableView openGroups={openGroups} setOpenGroups={setOpenGroups} />
      ) : (
        <BarsView
          detail={detail}
          by={by}
          showValues={showValues}
          hiddenSeries={hiddenSeries}
          setHiddenSeries={setHiddenSeries}
        />
      )}
    </div>
  )
}

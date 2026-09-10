import { useMemo, useState } from 'react'
import type { Goal } from '../types'
import type { Schedule, MonthRow } from '../goalPlan'
import { byRank } from '../goalPlan'
import { acct, group } from '../format'

// ─── Every goal on one timeline ──────────────────────────────────────────────
//
//  One lane per goal, one cell per month, and **the cell carries its figure**.
//
//  The stacked stream this replaced answered the wrong question. Money into
//  goals is lumpy — a spare-cash month puts six figures in and the next puts a
//  tenth of that — so one band swallowed the chart and every month after it was
//  a hairline. Stacking also mixes the goals together: the thing you actually
//  want to read off a plan is *this goal, this month, this much*, and a stack
//  can only be read by measuring segments against each other.
//
//  Swimlanes do not have that problem. Each lane is its own row with its own
//  scale, so a goal that takes 3,000 a month is as readable as one taking
//  300,000; and reading down a column compares the goals in one month, which is
//  what the ranking is *for*.
//
//  A cell narrower than its own number cannot carry one, which is why this
//  scrolls sideways rather than squeezing: a figure you have to hover for is a
//  figure you cannot compare to the one beside it.

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** 'Mar 2027' from '2027-03'. */
export function monthName(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return `${MON[(m - 1) % 12]} ${y}`
}

/** A colour per goal, taken from the goal where it has one and spread around
 *  the wheel where it does not — two lanes of the same hue read as one goal. */
function colours(goals: Goal[]): Map<string, string> {
  const out = new Map<string, string>()
  goals.forEach((g, i) => {
    const own = g.color && /^#/.test(g.color) ? g.color : null
    out.set(g.id, own ?? `hsl(${(i * 67) % 360} 52% 46%)`)
  })
  return out
}

interface Cell { row: MonthRow; into: Map<string, number>; total: number }

// The lanes are years wide and they scroll, so anything that has to stay
// readable belongs in the fixed name block. A "lands" column on the far right
// is a column you never see without scrolling past everything it summarises.
const NAME = 210, COL = 58

export function GoalTimeline({ schedule, goals, currency, months = 48 }: {
  schedule: Schedule
  goals: Goal[]
  currency: string
  /** How many months to draw. The plan runs for ten years; nobody reads ten. */
  months?: number
}) {
  const [picked, setPicked] = useState<string | null>(null)

  const ranked = useMemo(() => byRank(goals), [goals])
  const paint = useMemo(() => colours(ranked), [ranked])
  const money = (n: number) => acct(n, { currency })

  // Draw as far as the last goal lands, plus a month of air — a timeline that
  // runs eight years past the last thing on it is mostly empty, and the empty
  // part is what earns the horizontal scroll.
  const cells: Cell[] = useMemo(() => {
    const lands = new Set(schedule.landsIn.values())
    const last = schedule.rows.reduce((n, r, i) => (lands.has(r.month) ? i : n), -1)
    const reach = last >= 0 ? last + 2 : schedule.rows.length
    return schedule.rows.slice(0, Math.min(months, Math.max(6, reach))).map(row => {
      const into = new Map<string, number>()
      for (const s of row.shares) into.set(s.goalId, (into.get(s.goalId) ?? 0) + s.amount)
      return { row, into, total: [...into.values()].reduce((a, b) => a + b, 0) }
    })
  }, [schedule, months])

  if (cells.length === 0 || ranked.length === 0) {
    return (
      <div style={{ color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-body-s)', padding: '8px 0' }}>
        Nothing to draw yet — add a goal and the months it takes appear here.
      </div>
    )
  }

  const width = NAME + cells.length * COL
  const anyOut = cells.some(c => c.row.went > 0)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{
          fontFamily: 'var(--sb-font-display)', fontSize: 'var(--sb-t-h3)', fontWeight: 600,
          letterSpacing: '-0.02em', color: 'var(--sb-ink-1)',
        }}>Every goal on one timeline</span>
        <span style={{ fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)' }}>
          one lane a goal · what goes into it each month
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)' }}>
          {cells.length} month{cells.length === 1 ? '' : 's'} · tap a month for it in full
        </span>
      </div>

      <div style={{ overflowX: 'auto', paddingBottom: 2 }}>
        <div style={{ minWidth: width }}>

          {/* The months, once, above every lane */}
          <div style={{ display: 'flex', alignItems: 'flex-end', height: 26 }}>
            <span style={{ width: NAME, flexShrink: 0 }} />
            {cells.map(c => {
              const [y, m] = c.row.month.split('-').map(Number)
              const on = c.row.month === picked
              return (
                <button key={c.row.month}
                  onClick={() => setPicked(on ? null : c.row.month)}
                  title={`${monthName(c.row.month)} — tap for the month in full`}
                  style={{
                    width: COL, flexShrink: 0, border: 'none', cursor: 'pointer', padding: '0 0 3px',
                    background: on ? 'var(--sb-accent-tint)' : 'transparent',
                    borderRadius: '4px 4px 0 0', fontFamily: 'var(--sb-font-num)',
                    fontSize: m === 1 ? 10 : 9.5, fontWeight: m === 1 ? 700 : 600,
                    color: m === 1 ? 'var(--sb-ink-2)' : 'var(--sb-ink-4)',
                  }}>
                  {m === 1 ? String(y) : MON[m - 1]}
                </button>
              )
            })}
          </div>

          {/* One lane per goal */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {ranked.map((g, rank) => {
              const per = cells.map(c => c.into.get(g.id) ?? 0)
              const most = Math.max(1, ...per)
              const into = per.reduce((a, b) => a + b, 0)
              const lands = schedule.landsIn.get(g.id) ?? null
              const due = g.deadline ? g.deadline.slice(0, 7) : null
              const late = due && lands ? lands > due : false
              const colour = paint.get(g.id) ?? 'var(--sb-ink-3)'

              return (
                <div key={g.id} style={{ display: 'flex', alignItems: 'stretch' }}>
                  {/* Who the lane belongs to */}
                  <span style={{
                    width: NAME, flexShrink: 0, alignSelf: 'center', paddingRight: 10,
                    display: 'flex', alignItems: 'center', gap: 8, minWidth: 0,
                  }}>
                    <span style={{
                      width: 18, height: 18, flexShrink: 0, borderRadius: 'var(--sb-r-chip)',
                      background: colour, color: '#fff', display: 'flex', alignItems: 'center',
                      justifyContent: 'center', fontFamily: 'var(--sb-font-num)', fontSize: 10, fontWeight: 700,
                    }}>{rank + 1}</span>
                    <span style={{ minWidth: 0, fontSize: 'var(--sb-t-meta)', fontWeight: 600, lineHeight: 1.25 }}>
                      <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {g.name}
                      </span>
                      <span style={{
                        display: 'block', fontWeight: 400, fontSize: 'var(--sb-t-micro)',
                        fontFamily: 'var(--sb-font-num)', fontVariantNumeric: 'tabular-nums',
                        color: 'var(--sb-ink-4)',
                      }}>
                        <b style={{
                          fontWeight: 700,
                          color: lands ? (late ? 'var(--sb-negative)' : 'var(--sb-positive)') : 'var(--sb-ink-4)',
                        }}>{lands ? monthName(lands) : 'not reached'}</b>
                        {due ? ` · ${late ? 'due' : 'by'} ${monthName(due)}` : ''}
                        {' · '}{group(Math.round(into))} of {group(Math.round(g.targetAmount))}
                      </span>
                    </span>
                  </span>

                  {/* The lane itself */}
                  <div style={{
                    display: 'flex', flex: 1, minHeight: 36, borderRadius: 'var(--sb-r-chip)',
                    background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-hairline)',
                    overflow: 'hidden',
                  }}>
                    {cells.map((c, i) => {
                      const amt = per[i]
                      const on = c.row.month === picked
                      const isLand = lands === c.row.month
                      const isDue = due === c.row.month
                      return (
                        <button key={c.row.month}
                          onClick={() => setPicked(on ? null : c.row.month)}
                          title={amt > 0
                            ? `${monthName(c.row.month)} — ${money(amt)} into ${g.name}${isLand ? ', and it lands' : ''}`
                            : c.row.went > 0 ? `${monthName(c.row.month)} — nothing into ${g.name}; ${money(c.row.went)} left on its own date`
                            : lands && c.row.month > lands ? `${monthName(c.row.month)} — ${g.name} already landed`
                            : `${monthName(c.row.month)} — nothing into ${g.name} yet`}
                          style={{
                            width: COL, flexShrink: 0, position: 'relative', cursor: 'pointer', padding: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: on ? 'var(--sb-accent-tint)' : 'transparent',
                            border: 'none',
                            // The month a goal lands gets its own edge, so the
                            // end of a lane is visible without reading the
                            // figures along it.
                            borderRight: isLand ? `2px solid ${colour}` : isDue ? `2px dashed ${colour}` : undefined,
                            fontFamily: 'inherit',
                          }}>
                          {amt > 0 && (
                            <span style={{
                              position: 'absolute', left: 2, right: 2, bottom: 2, zIndex: 0,
                              height: Math.max(4, (amt / most) * 30), background: colour, opacity: 0.3,
                              borderRadius: 3,
                            }} />
                          )}
                          <span style={{
                            position: 'relative', zIndex: 1, fontFamily: 'var(--sb-font-num)',
                            fontSize: 9.5, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                            fontWeight: amt > 0 ? 600 : 400,
                            color: amt > 0 ? 'var(--sb-ink-1)' : 'var(--sb-ink-4)',
                            opacity: amt > 0 ? 1 : 0.45,
                          }}>{amt > 0 ? group(Math.round(amt)) : '·'}</span>
                        </button>
                      )
                    })}
                  </div>

                </div>
              )
            })}
          </div>

          {/* What left on a date of its own — a lane too, because it is the
              reason a month above it is empty, and that belongs on the same
              row of months rather than in a second chart. */}
          {anyOut && (
            <div style={{ display: 'flex', alignItems: 'stretch', marginTop: 8 }}>
              <span style={{
                width: NAME, flexShrink: 0, alignSelf: 'center', paddingRight: 10,
                fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: 'var(--sb-ink-3)', lineHeight: 1.25,
              }}>
                Left on its own date
                <span style={{ display: 'block', fontWeight: 400, fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)' }}>
                  instalments, not goals
                </span>
              </span>
              <div style={{
                display: 'flex', flex: 1, minHeight: 28, borderRadius: 'var(--sb-r-chip)',
                background: 'var(--sb-negative-tint)', border: 'var(--sb-border-width) solid var(--sb-hairline)',
                overflow: 'hidden',
              }}>
                {cells.map(c => {
                  const on = c.row.month === picked
                  return (
                    <button key={c.row.month} onClick={() => setPicked(on ? null : c.row.month)}
                      title={c.row.went > 0 ? `${monthName(c.row.month)} — ${money(c.row.went)} left on its own date` : monthName(c.row.month)}
                      style={{
                        width: COL, flexShrink: 0, cursor: 'pointer', padding: 0, border: 'none',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: on ? 'var(--sb-accent-tint)' : 'transparent', fontFamily: 'var(--sb-font-num)',
                        fontSize: 9.5, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                        fontWeight: c.row.went > 0 ? 600 : 400,
                        color: c.row.went > 0 ? 'var(--sb-negative)' : 'var(--sb-ink-4)',
                        opacity: c.row.went > 0 ? 1 : 0.45,
                      }}>
                      {c.row.went > 0 ? group(Math.round(c.row.went)) : '·'}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <MonthFace cell={picked ? cells.find(c => c.row.month === picked) ?? null : null}
        goals={ranked} paint={paint} money={money} cells={cells} onPick={setPicked} />
    </div>
  )
}

// ─── The month, in full ──────────────────────────────────────────────────────
//
//  Every cell in every lane opens this, because the question a lane raises is
//  always about one month and a lane on its own cannot answer it: what came in,
//  what left on its own date, and where the rest went.

function MonthFace({ cell, goals, paint, money, cells, onPick }: {
  cell: Cell | null; goals: Goal[]; paint: Map<string, string>
  money: (n: number) => string
  cells: Cell[]; onPick: (m: string | null) => void
}) {
  if (!cell) return null
  const at = cells.findIndex(c => c.row.month === cell.row.month)
  const step = (n: number) => { const next = cells[at + n]; if (next) onPick(next.row.month) }
  const SUM: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 14, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }
  const NUM: React.CSSProperties = { fontFamily: 'var(--sb-font-num)', fontVariantNumeric: 'tabular-nums', color: 'var(--sb-ink-1)', fontWeight: 600 }
  const nav: React.CSSProperties = {
    width: 26, height: 26, borderRadius: 'var(--sb-r-chip)', cursor: 'pointer',
    border: 'var(--sb-border-width) solid var(--sb-border)', background: 'var(--sb-card)',
    color: 'var(--sb-ink-3)', fontFamily: 'var(--sb-font-display)', fontWeight: 600, fontSize: 13,
  }

  return (
    <div style={{
      marginTop: 12, padding: '12px 14px', display: 'flex', flexWrap: 'wrap', gap: '14px 26px',
      alignItems: 'flex-start', background: 'var(--sb-field)',
      border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-nav)',
    }}>
      <div style={{ minWidth: 104 }}>
        <div style={{ fontFamily: 'var(--sb-font-display)', fontSize: 'var(--sb-t-body)', fontWeight: 600, letterSpacing: '-0.02em' }}>
          {monthName(cell.row.month)}
        </div>
        <span style={{ display: 'block', fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)' }}>
          {at === 0 ? 'this month' : `${at} month${at === 1 ? '' : 's'} out`}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 210, flex: 1 }}>
        {goals.map(g => {
          const amt = cell.into.get(g.id) ?? 0
          return (
            <div key={g.id} style={{
              display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--sb-t-meta)',
              color: amt > 0 ? 'var(--sb-ink-1)' : 'var(--sb-ink-4)',
            }}>
              <i style={{ width: 9, height: 9, borderRadius: 3, background: paint.get(g.id), flexShrink: 0, opacity: amt > 0 ? 1 : 0.4 }} />
              {g.name}
              <b style={{ marginLeft: 'auto', fontFamily: 'var(--sb-font-num)', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                {amt > 0 ? money(amt) : '–'}
              </b>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 168 }}>
        <div style={SUM}><span>Came in</span><b style={NUM}>{money(cell.row.came)}</b></div>
        {cell.row.went > 0 && (
          <div style={SUM}><span>Left on its own date</span><b style={{ ...NUM, color: 'var(--sb-negative)' }}>{money(-cell.row.went)}</b></div>
        )}
        {cell.row.fromSpare > 0 && (
          <div style={SUM}><span>Out of spare cash</span><b style={NUM}>{money(cell.row.fromSpare)}</b></div>
        )}
        <div style={SUM}><span>Into goals</span><b style={NUM}>{money(cell.total)}</b></div>
        <div style={{ ...SUM, borderTop: 'var(--sb-border-width) solid var(--sb-border)', paddingTop: 5, color: 'var(--sb-ink-1)', fontWeight: 600 }}>
          <span>Carried on</span>
          <b style={{ ...NUM, color: cell.row.carried < 0 ? 'var(--sb-negative)' : 'var(--sb-ink-1)' }}>{money(cell.row.carried)}</b>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
        <button style={{ ...nav, opacity: at <= 0 ? 0.4 : 1 }} disabled={at <= 0}
          onClick={() => step(-1)} title="The month before">‹</button>
        <button style={{ ...nav, opacity: at >= cells.length - 1 ? 0.4 : 1 }} disabled={at >= cells.length - 1}
          onClick={() => step(1)} title="The month after">›</button>
        <button style={nav} onClick={() => onPick(null)} title="Close">×</button>
      </div>
    </div>
  )
}

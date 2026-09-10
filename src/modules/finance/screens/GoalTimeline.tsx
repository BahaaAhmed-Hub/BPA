import { useMemo, useState } from 'react'
import type { Goal } from '../types'
import type { Schedule, MonthRow } from '../goalPlan'
import { byRank } from '../goalPlan'
import { acct, group } from '../format'
import { Segmented } from '@/components/ui'

// ─── Every goal on one timeline ──────────────────────────────────────────────
//
//  The ranked list answers "when does this land?" one goal at a time. It cannot
//  answer the question the ranking exists for — *why* does the laptop wait until
//  July? — because the reason is always another month: a school-fee instalment
//  that took it, or the goal above still being filled. Both are facts about a
//  month, and a list of goals has no month in it.
//
//  So: one row of months, read two ways.
//
//  - **Stream** — what went in, stacked by goal, above the line; what left on a
//    date of its own below it. The shape of a year, in one glance.
//  - **Bars** — one row per goal, one cell per month, and *the cell carries its
//    own figure*. A bar you have to hover to read is a bar you cannot compare.
//
//  Both open the same month underneath, in full, because the point of either is
//  to make you ask about one month and neither can answer on its own.

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** 'Mar 2027' from '2027-03'. */
export function monthName(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return `${MON[(m - 1) % 12]} ${y}`
}

/** A colour per goal, taken from the goal where it has one and spread around
 *  the wheel where it does not — two adjacent bands of the same hue read as
 *  one band twice as tall. */
function colours(goals: Goal[]): Map<string, string> {
  const out = new Map<string, string>()
  goals.forEach((g, i) => {
    const own = g.color && /^#/.test(g.color) ? g.color : null
    out.set(g.id, own ?? `hsl(${(i * 67) % 360} 52% 46%)`)
  })
  return out
}

const shortName = (g: Goal) => g.name.replace(/^Clear (the )?/i, '').split(/\s+/)[0]

interface Cell { row: MonthRow; into: Map<string, number>; total: number }

export function GoalTimeline({ schedule, goals, currency, months = 30 }: {
  schedule: Schedule
  goals: Goal[]
  currency: string
  /** How many months to draw. The plan runs for ten years; nobody reads ten. */
  months?: number
}) {
  const [view, setView] = useState<'stream' | 'bars'>(() => {
    try { return localStorage.getItem('finance-goal-timeline') === 'bars' ? 'bars' : 'stream' }
    catch { return 'stream' }
  })
  function pick(v: 'stream' | 'bars') {
    setView(v)
    try { localStorage.setItem('finance-goal-timeline', v) } catch { /* private mode */ }
  }
  const [picked, setPicked] = useState<string | null>(null)

  const ranked = useMemo(() => byRank(goals), [goals])
  const paint = useMemo(() => colours(ranked), [ranked])
  const money = (n: number) => acct(n, { currency })

  // Draw as far as the last goal lands, plus a month of air — but never past
  // the cap. A timeline that runs eight years beyond the last thing on it is
  // mostly empty, and the empty part is what gets the horizontal scroll.
  const cells: Cell[] = useMemo(() => {
    const lands = [...schedule.landsIn.values()]
    const reach = lands.length
      ? Math.max(...schedule.rows.map((r, i) => (lands.includes(r.month) ? i : -1))) + 2
      : schedule.rows.length
    return schedule.rows.slice(0, Math.min(months, Math.max(6, reach))).map(row => {
      const into = new Map<string, number>()
      for (const s of row.shares) into.set(s.goalId, (into.get(s.goalId) ?? 0) + s.amount)
      return { row, into, total: [...into.values()].reduce((a, b) => a + b, 0) }
    })
  }, [schedule, months])

  const landsAt = useMemo(() => {
    const m = new Map<string, Goal[]>()
    for (const g of ranked) {
      const k = schedule.landsIn.get(g.id)
      if (!k) continue
      m.set(k, [...(m.get(k) ?? []), g])
    }
    return m
  }, [ranked, schedule])

  const dueAt = useMemo(() => {
    const m = new Map<string, Goal[]>()
    for (const g of ranked) {
      if (!g.deadline) continue
      const k = g.deadline.slice(0, 7)
      m.set(k, [...(m.get(k) ?? []), g])
    }
    return m
  }, [ranked])

  if (cells.length === 0) {
    return (
      <div style={{ color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-body-s)', padding: '8px 0' }}>
        Nothing to draw yet — add a goal and the months it takes appear here.
      </div>
    )
  }

  const maxIn  = Math.max(1, ...cells.map(c => c.total))
  const maxOut = Math.max(1, ...cells.map(c => c.row.went))
  const openRow = picked ? cells.find(c => c.row.month === picked) ?? null : null

  const COL = 30
  const width = Math.max(680, cells.length * COL)

  const KEY: React.CSSProperties = {
    display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: 10,
    fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-3)', alignItems: 'center',
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{
          fontFamily: 'var(--sb-font-display)', fontSize: 'var(--sb-t-h3)', fontWeight: 600,
          letterSpacing: '-0.02em', color: 'var(--sb-ink-1)',
        }}>Every goal on one timeline</span>
        <Segmented
          aria-label="How to draw the timeline"
          value={view}
          onChange={v => pick(v as 'stream' | 'bars')}
          options={[
            { value: 'stream', label: 'Stream', title: 'What goes in each month, stacked by goal, and what leaves on a date of its own' },
            { value: 'bars', label: 'Bars', title: 'One row per goal, one cell per month, each cell carrying its own figure' },
          ]} />
        <span style={{ marginLeft: 'auto', fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)' }}>
          {cells.length} month{cells.length === 1 ? '' : 's'} · tap any month for it in full
        </span>
      </div>

      {view === 'stream'
        ? <Stream cells={cells} width={width} maxIn={maxIn} maxOut={maxOut} paint={paint}
            landsAt={landsAt} dueAt={dueAt} picked={picked} onPick={setPicked} money={money} />
        : <Bars cells={cells} goals={ranked} schedule={schedule} paint={paint}
            picked={picked} onPick={setPicked} money={money} />}

      <div style={KEY}>
        {ranked.map(g => (
          <span key={g.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <i style={{ width: 10, height: 10, borderRadius: 3, background: paint.get(g.id), display: 'inline-block' }} />
            {g.name}
          </span>
        ))}
        {maxOut > 0 && view === 'stream' && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--sb-ink-4)' }}>
            <i style={{
              width: 10, height: 10, borderRadius: 3, display: 'inline-block',
              border: '1px solid var(--sb-negative)', background: 'var(--sb-negative-tint)',
            }} />
            below the line: what leaves on a date of its own
          </span>
        )}
      </div>

      <MonthFace cell={openRow} goals={ranked} paint={paint} money={money}
        cells={cells} onPick={setPicked} />
    </div>
  )
}

// ─── The stream ──────────────────────────────────────────────────────────────

function Stream({ cells, width, maxIn, maxOut, paint, landsAt, dueAt, picked, onPick, money }: {
  cells: Cell[]; width: number; maxIn: number; maxOut: number
  paint: Map<string, string>
  landsAt: Map<string, Goal[]>; dueAt: Map<string, Goal[]>
  picked: string | null; onPick: (m: string | null) => void
  money: (n: number) => string
}) {
  const IN_H = 82, OUT_H = 32
  const col = (i: number): React.CSSProperties => ({
    flex: '1 0 24px', minWidth: 24, position: 'relative', cursor: 'pointer',
    background: cells[i].row.month === picked ? 'var(--sb-accent-tint)' : undefined,
    borderRadius: 4,
  })
  const flag = (i: number): React.CSSProperties => ({
    position: 'absolute', left: i < 3 ? 0 : i > cells.length - 4 ? undefined : '50%',
    right: i > cells.length - 4 ? 0 : undefined,
    transform: i < 3 || i > cells.length - 4 ? 'none' : 'translateX(-50%)',
    whiteSpace: 'nowrap', fontFamily: 'var(--sb-font-num)', fontSize: 9.5, fontWeight: 700,
    padding: '2px 6px', borderRadius: 'var(--sb-r-pill)', zIndex: 2,
  })

  return (
    <div style={{ overflowX: 'auto', paddingBottom: 2 }}>
      <div style={{ minWidth: width }}>

        {/* what landed */}
        <div style={{ display: 'flex', gap: 2, height: 22 }}>
          {cells.map((c, i) => {
            const done = landsAt.get(c.row.month)
            return (
              <div key={c.row.month} style={col(i)} onClick={() => onPick(picked === c.row.month ? null : c.row.month)}
                title={`${monthName(c.row.month)} — tap for the month in full`}>
                {done && (
                  <b style={{ ...flag(i), background: paint.get(done[0].id), color: '#fff' }}>
                    {shortName(done[0])} ✓{done.length > 1 ? ` +${done.length - 1}` : ''}
                  </b>
                )}
              </div>
            )
          })}
        </div>

        {/* what went in */}
        <div style={{ display: 'flex', gap: 2, height: IN_H, alignItems: 'flex-end' }}>
          {cells.map((c, i) => (
            <div key={c.row.month} onClick={() => onPick(picked === c.row.month ? null : c.row.month)}
              title={`${monthName(c.row.month)} — ${money(c.total)} into goals`}
              style={{ ...col(i), display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 1 }}>
              {[...c.into.entries()].map(([id, amt]) => (
                <div key={id} style={{
                  height: Math.max(2, (amt / maxIn) * IN_H), background: paint.get(id),
                  borderRadius: 2, minHeight: 2,
                }} />
              ))}
            </div>
          ))}
        </div>

        {/* the line itself, and nothing else on it — a label band between the
            line and the bars below makes them look like they belong to
            something else, which is exactly what they must not */}
        <div style={{ borderTop: '2px solid var(--sb-ink-1)' }} />

        {/* what left on a date of its own */}
        <div style={{ display: 'flex', gap: 2, height: 38, alignItems: 'flex-start' }}>
          {cells.map((c, i) => (
            <div key={c.row.month} style={col(i)} onClick={() => onPick(picked === c.row.month ? null : c.row.month)}
              title={c.row.went > 0 ? `${monthName(c.row.month)} — ${money(c.row.went)} on its own date` : monthName(c.row.month)}>
              {c.row.went > 0 && (
                <div style={{
                  height: Math.max(6, (c.row.went / maxOut) * OUT_H),
                  border: '1px solid var(--sb-negative)', borderTop: 'none', borderRadius: '0 0 3px 3px',
                  background: 'var(--sb-negative-tint)',
                }} />
              )}
            </div>
          ))}
        </div>

        {/* the year, under the line */}
        <div style={{ display: 'flex', gap: 2, height: 15 }}>
          {cells.map((c, i) => {
            const [y, m] = c.row.month.split('-').map(Number)
            const label = m === 1 ? String(y) : m % 3 === 1 ? MON[m - 1] : null
            return (
              <div key={c.row.month} style={col(i)}
                onClick={() => onPick(picked === c.row.month ? null : c.row.month)}>
                {label && (
                  <span style={{
                    position: 'absolute', top: 0, left: 0, whiteSpace: 'nowrap',
                    fontFamily: 'var(--sb-font-num)', fontSize: m === 1 ? 10 : 9,
                    fontWeight: m === 1 ? 700 : 600,
                    color: m === 1 ? 'var(--sb-ink-3)' : 'var(--sb-ink-4)',
                  }}>{label}</span>
                )}
              </div>
            )
          })}
        </div>

        {/* what is due */}
        <div style={{ display: 'flex', gap: 2, height: 24 }}>
          {cells.map((c, i) => {
            const due = dueAt.get(c.row.month)
            return (
              <div key={c.row.month} style={col(i)} onClick={() => onPick(picked === c.row.month ? null : c.row.month)}>
                {due && (
                  <b style={{
                    ...flag(i), background: 'var(--sb-card)', color: paint.get(due[0].id),
                    border: `1px solid ${paint.get(due[0].id)}`,
                  }}>{shortName(due[0])} due</b>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── The bars ────────────────────────────────────────────────────────────────
//
//  48px is the width a five-figure number needs at 9.5px. A cell narrower than
//  its own number cannot carry one, which is why this scrolls rather than
//  squeezing: a bar whose figure you have to hover for is a bar you cannot
//  compare to the one beside it.

function Bars({ cells, goals, schedule, paint, picked, onPick, money }: {
  cells: Cell[]; goals: Goal[]; schedule: Schedule
  paint: Map<string, string>
  picked: string | null; onPick: (m: string | null) => void
  money: (n: number) => string
}) {
  const CELL = 48, NAME = 150, WHEN = 96
  const width = NAME + cells.length * (CELL + 1) + WHEN + 20

  return (
    <div style={{ overflowX: 'auto', paddingBottom: 2 }}>
      <div style={{ minWidth: width, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {goals.map(g => {
          const per = cells.map(c => c.into.get(g.id) ?? 0)
          const into = per.reduce((a, b) => a + b, 0)
          const most = Math.max(1, ...per)
          const lands = schedule.landsIn.get(g.id) ?? null
          const late = g.deadline && lands ? lands > g.deadline.slice(0, 7) : false

          return (
            <div key={g.id} style={{ display: 'flex', alignItems: 'stretch', gap: 10 }}>
              <span style={{ width: NAME, flexShrink: 0, alignSelf: 'center', fontSize: 'var(--sb-t-meta)', fontWeight: 600, lineHeight: 1.3 }}>
                {g.name}
                <span style={{
                  display: 'block', fontWeight: 400, fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)',
                  fontFamily: 'var(--sb-font-num)', fontVariantNumeric: 'tabular-nums',
                }}>
                  {g.currentAmount > 0 ? `${group(Math.round(g.currentAmount))} saved · ` : ''}
                  {group(Math.round(into))} to go of {group(Math.round(g.targetAmount))}
                </span>
              </span>

              <div style={{
                position: 'relative', flex: 1, minHeight: 34, display: 'flex', gap: 1,
                background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-hairline)',
                borderRadius: 'var(--sb-r-chip)', overflow: 'hidden',
              }}>
                {cells.map((c, i) => {
                  const amt = per[i]
                  const on = c.row.month === picked
                  return (
                    <div key={c.row.month}
                      onClick={() => onPick(on ? null : c.row.month)}
                      title={amt > 0 ? `${monthName(c.row.month)} — ${money(amt)} into ${g.name}`
                        : c.row.went > 0 ? `${monthName(c.row.month)} — nothing into ${g.name}; ${money(c.row.went)} left on its own date`
                        : lands && c.row.month > lands ? `${monthName(c.row.month)} — ${g.name} already landed`
                        : `${monthName(c.row.month)} — nothing into ${g.name} yet`}
                      style={{
                        flex: `1 0 ${CELL}px`, minWidth: CELL, position: 'relative', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        outline: on ? '2px solid var(--sb-accent)' : undefined, outlineOffset: -2, borderRadius: 3,
                      }}>
                      {amt > 0 && (
                        <div style={{
                          position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 0, opacity: 0.34,
                          height: Math.max(6, (amt / most) * 32), background: paint.get(g.id),
                        }} />
                      )}
                      <b style={{
                        position: 'relative', zIndex: 2, fontFamily: 'var(--sb-font-num)', fontSize: 9.5,
                        fontWeight: amt > 0 ? 600 : 400, fontVariantNumeric: 'tabular-nums',
                        color: amt > 0 ? 'var(--sb-ink-2)' : 'var(--sb-ink-4)', opacity: amt > 0 ? 1 : 0.5,
                        whiteSpace: 'nowrap',
                      }}>{amt > 0 ? group(Math.round(amt)) : '·'}</b>
                    </div>
                  )
                })}
              </div>

              <span style={{
                width: WHEN, textAlign: 'right', flexShrink: 0, alignSelf: 'center',
                fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-meta)', fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                color: lands ? (late ? 'var(--sb-negative)' : 'var(--sb-positive)') : 'var(--sb-ink-4)',
              }}>{lands ? monthName(lands) : 'not reached'}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── The month, in full ──────────────────────────────────────────────────────
//
//  Every column of every lane opens this, because the question either view
//  raises is always about one month and neither can answer it.

function MonthFace({ cell, goals, paint, money, cells, onPick }: {
  cell: Cell | null; goals: Goal[]; paint: Map<string, string>
  money: (n: number) => string
  cells: Cell[]; onPick: (m: string | null) => void
}) {
  if (!cell) return null
  const at = cells.findIndex(c => c.row.month === cell.row.month)
  const step = (n: number) => {
    const next = cells[at + n]
    if (next) onPick(next.row.month)
  }
  const LINE: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--sb-t-meta)' }
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
            <div key={g.id} style={{ ...LINE, color: amt > 0 ? 'var(--sb-ink-1)' : 'var(--sb-ink-4)' }}>
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
          <span>Carried on</span><b style={{ ...NUM, color: cell.row.carried < 0 ? 'var(--sb-negative)' : 'var(--sb-ink-1)' }}>{money(cell.row.carried)}</b>
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

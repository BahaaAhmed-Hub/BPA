import { useState, useMemo, useEffect, useCallback, useRef, Fragment } from 'react'
import { Button, Card, Segmented } from '@/components/ui'
import { ChevronDown, ChevronRight, ChevronsUpDown, ChevronsDownUp, GripVertical, X, Trash2, Plus, Eye, EyeOff, Pencil, ArrowLeft, Check } from 'lucide-react'
import { useFinanceStore, txFromRow } from '../financeStore'
import type { Category } from '../types'
import { CategoryGlyph } from '../components/CategoryGlyph'
import { toBase, baseCurrency, currenciesNeedingRates } from '../fx'
import { acct, outflow, group } from '../format'
import { findDuplicates } from '../duplicates'
import { loadAcks, acknowledge, forgetAllAcks, isAcknowledged, ACKS_EVENT } from '../duplicateAcks'
import { DuplicateMark } from '../components/DuplicateMark'
import { BudgetMark } from '../components/BudgetMark'
import { isBudgetEntry } from '../budgetEntries'
import { isUnpaid, UNPAID_TITLE } from '../unpaid'
import { TransactionModal } from '../modals/TransactionModal'
import type { Transaction } from '../types'
import { todayISO } from '../dates'
import { loadTransactionsSpan, loadYearBounds } from '../financeDb'
import { ICON, STROKE } from '@/lib/type'
import { TxRow, txDate } from '../components/TxRow'
import { notify } from '@/lib/undo'

// ─── 16F · Financials YTD ─────────────────────────────────────────────────────
// Spreadsheet-style table: each income/expense category as a row,
// 12 monthly columns, totals + cumulative running cash at the bottom.

/** A header cell that stays put needs its own bottom edge: with
 *  border-collapse the row's border belongs to the cells under it, and those
 *  scroll away. */
const HEAD_EDGE: React.CSSProperties = { boxShadow: 'inset 0 -2px 0 var(--sb-border)' }

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const OLIVE = 'var(--sb-positive)'
const RUST  = 'var(--sb-negative)'

/** Income reads plain, money leaving reads bracketed, an empty cell reads as a
 *  dash — the three things a ledger column does. `fmt` takes the figure as it
 *  is stored (a magnitude for both sections) and `out` says which section it
 *  belongs to. */
function fmt(v: number): string { return acct(v, { zero: '–' }) }
function fmtOut(v: number): string { return v === 0 ? '–' : outflow(v) }

function netColor(v: number) { return v > 0 ? OLIVE : v < 0 ? RUST : 'var(--sb-ink-4)' }

/**
 *  The controls a row keeps out of sight until you are on it.
 *
 *  Clicking the row itself used to hide it from the totals, which is a real
 *  thing this table does and the wrong thing for the gesture people reach for
 *  first. A click now *selects*, and the two other jobs get a button each:
 *  the eye hides, the pencil opens what is filed there. Hidden until hover, so
 *  eighty rows are eighty names rather than a wall of icons — and always
 *  present for the row that is hidden or selected, or the way back would be
 *  invisible on a touch screen.
 */
function RowTools({ hidden, on, onHide, onOpen, name, small }: {
  hidden: boolean; on: boolean; onHide: () => void; onOpen: () => void; name: string; small?: boolean
}) {
  const btn: React.CSSProperties = {
    width: small ? 20 : 22, height: small ? 20 : 22, padding: 0, flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: 'var(--sb-r-chip)', cursor: 'pointer',
    background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
    color: 'var(--sb-ink-4)',
  }
  return (
    <span className="sb-row-tools" style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0, marginLeft: 4,
      opacity: hidden || on ? 1 : 0, transition: 'opacity .12s',
    }}>
      <button style={btn} title={hidden ? `Put ${name} back in the totals` : `Take ${name} out of the totals`}
        onClick={e => { e.stopPropagation(); onHide() }}>
        {hidden ? <EyeOff size={ICON.sm} strokeWidth={STROKE.rest} /> : <Eye size={ICON.sm} strokeWidth={STROKE.rest} />}
      </button>
      <button style={btn} title={`Every entry filed under ${name} this year`}
        onClick={e => { e.stopPropagation(); onOpen() }}>
        <Pencil size={ICON.sm} strokeWidth={STROKE.rest} />
      </button>
    </span>
  )
}

// ─── The same year, as lines ─────────────────────────────────────────────────
//
//  A table answers "what did this cost in March?" and answers it exactly. It
//  cannot answer "which of these is climbing?" — twelve columns of figures hide
//  a shape, and a shape is the whole reason to look at a year at once.
//
//  One dotted line per category, or per part of one. Dotted rather than solid
//  because a month is a reading, not a continuum: nothing happened *between*
//  March and April, and a solid line quietly claims it did. The dots are the
//  readings; the line only joins them so the eye can follow one series through
//  a dozen others.

/** How wide the chart may draw, measured rather than assumed. */
function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null)
  const [w, setW] = useState(720)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

interface Series { id: string; name: string; color: string; amounts: number[]; kind: 'income' | 'expense'; under?: string }

/** A tick scale that lands on round numbers, because 47,318 is not an axis.
 *  It runs until it has *covered* the largest reading — stopping at the last
 *  round number below it drew a 62,000 salary above the top gridline and off
 *  the plot. */
function ticksTo(max: number): number[] {
  if (max <= 0) return [0]
  const rough = max / 4
  const mag = Math.pow(10, Math.floor(Math.log10(rough)))
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(v => v >= rough) ?? mag * 10
  const out = [0]
  while (out[out.length - 1] < max) out.push(out[out.length - 1] + step)
  return out
}

/**
 *  Twelve lines in one colour are one line.
 *
 *  A category's colour is its identity on every other screen, so it is kept —
 *  but two categories may share one, and on a table that costs nothing while on
 *  a chart it costs everything. Where a colour repeats, each later one is
 *  lightened a step: near enough to still read as that category, far enough to
 *  follow through the others.
 */
function spread(list: { color: string }[]): string[] {
  const seen = new Map<string, number>()
  return list.map(s => {
    const n = seen.get(s.color) ?? 0
    seen.set(s.color, n + 1)
    if (n === 0) return s.color
    // Alternating up and down, so a third and fourth sharing a colour do not
    // both fade towards the background.
    const step = Math.ceil(n / 2) * 16 * (n % 2 === 1 ? 1 : -1)
    return `color-mix(in srgb, ${s.color} ${Math.max(35, 100 - Math.abs(step))}%, ${step > 0 ? 'white' : 'black'})`
  })
}

function LinesChart({ series, hidden, onToggle, fmt, through }: {
  series: Series[]
  hidden: (id: string) => boolean
  onToggle: (id: string) => void
  fmt: (v: number) => string
  /** The last month there is an answer for. A line drawn flat along zero
   *  through October, November and December says the spending stopped; what
   *  actually happened is that the year has not got there yet. */
  through: number
}) {
  const [box, W] = useWidth()
  const [over, setOver] = useState<{ id: string; m: number } | null>(null)
  const colours = useMemo(() => spread(series), [series])
  const paint = (i: number) => colours[i] ?? series[i].color
  const last = Math.max(0, Math.min(through, 11))
  const shown = series.map((s, i) => ({ ...s, color: paint(i), amounts: s.amounts.slice(0, last + 1) }))
    .filter(s => !hidden(s.id))

  const H = 216, PAD_L = 66, PAD_R = 14, PAD_T = 12, PAD_B = 24
  const iw = Math.max(120, W - PAD_L - PAD_R)
  const ih = H - PAD_T - PAD_B
  const max = Math.max(1, ...shown.flatMap(s => s.amounts))
  const ticks = ticksTo(max)
  const top = ticks[ticks.length - 1] || 1
  const x = (m: number) => PAD_L + (iw * m) / 11
  const y = (v: number) => PAD_T + ih - (ih * v) / top

  return (
    <div ref={box} style={{ width: '100%' }}>
      <svg width={W} height={H} role="img" aria-label="Every category by month" style={{ display: 'block', overflow: 'visible' }}>
        {/* the grid, and what each line of it is worth */}
        {ticks.map(t => (
          <g key={t}>
            <line x1={PAD_L} x2={PAD_L + iw} y1={y(t)} y2={y(t)}
              stroke="var(--sb-hairline)" strokeWidth={1} />
            <text x={PAD_L - 8} y={y(t) + 3.5} textAnchor="end"
              style={{ fontSize: 10, fill: 'var(--sb-ink-4)', fontFamily: 'var(--sb-font-num)', fontVariantNumeric: 'tabular-nums' }}>
              {t === 0 ? '0' : group(Math.round(t))}
            </text>
          </g>
        ))}
        {MONTHS_SHORT.map((m, i) => (
          <text key={m} x={x(i)} y={H - 8} textAnchor="middle"
            style={{ fontSize: 10, fill: 'var(--sb-ink-4)', fontFamily: 'var(--sb-font-num)', opacity: i > last ? 0.35 : 1 }}>{m}</text>
        ))}

        {shown.map(s => {
          const pts = s.amounts.map((v, i) => `${x(i)},${y(v)}`).join(' ')
          const lit = over?.id === s.id
          return (
            <g key={s.id} onClick={() => onToggle(s.id)} style={{ cursor: 'pointer' }}>
              {/* A 2px dotted line is nearly impossible to hit. This one is
                  invisible, 14px wide, and is what the pointer actually lands on. */}
              <polyline points={pts} fill="none" stroke="transparent" strokeWidth={14} />
              <polyline points={pts} fill="none" stroke={s.color}
                strokeWidth={lit ? 2.6 : 1.8} strokeLinecap="round"
                strokeDasharray={s.kind === 'income' ? '1 5' : '5 4'}
                opacity={over && !lit ? 0.28 : 1} />
              {s.amounts.map((v, i) => (
                <circle key={i} cx={x(i)} cy={y(v)} r={lit ? 3.6 : 2.6} fill={s.color}
                  opacity={over && !lit ? 0.28 : 1}
                  onMouseEnter={() => setOver({ id: s.id, m: i })}
                  onMouseLeave={() => setOver(null)}>
                  <title>{`${s.name} · ${MONTHS_SHORT[i]} · ${fmt(v)}`}</title>
                </circle>
              ))}
            </g>
          )
        })}
      </svg>

      {/* The legend is the control: a category is taken off the chart by its own
          name, which is where you are already looking for it. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
        {series.map((raw, i) => {
          const s = { ...raw, color: paint(i) }
          const off = hidden(s.id)
          const total = s.amounts.reduce((n, v) => n + v, 0)
          return (
            <button key={s.id} onClick={() => onToggle(s.id)}
              title={off ? `Put ${s.name} back on the chart` : `Take ${s.name} off the chart · ${fmt(total)} this year`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, height: 24, padding: '0 9px',
                borderRadius: 'var(--sb-r-pill)', cursor: 'pointer', maxWidth: 220,
                background: off ? 'transparent' : 'var(--sb-card)',
                border: `var(--sb-border-width) solid ${off ? 'var(--sb-border)' : s.color}`,
                color: off ? 'var(--sb-ink-4)' : 'var(--sb-ink-2)',
                fontFamily: 'inherit', fontSize: 'var(--sb-t-micro)', fontWeight: 500,
                opacity: off ? 0.55 : 1,
              }}>
              <span aria-hidden style={{
                width: 9, height: 9, borderRadius: 'var(--sb-r-pill)', flexShrink: 0,
                background: off ? 'transparent' : s.color,
                border: `1.5px solid ${s.color}`,
              }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                textDecoration: off ? 'line-through' : 'none' }}>
                {s.under ? `${s.under} · ${s.name}` : s.name}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

interface Line { cat: { id: string; name: string; icon: string; color: string }; amounts: number[] }
interface Row extends Line { children: Line[] }

/** One category's line, and — when it is open — its parts underneath. Both
 *  sections drew this twice, with the same markup and slightly different
 *  colours, which is how the income rows kept a stray element the expense ones
 *  did not. */
/** The order every screen reads a category list in. */
const byOrder = (a: Category, b: Category) =>
  (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name)

/** The handle a row is dragged by.
 *
 *  Pointer events rather than HTML5 drag-and-drop: this table is reordered on
 *  a tablet as often as on a desktop, and `dragstart` never fires for a
 *  finger. `touchAction: none` is what stops the drag from scrolling the page
 *  instead.
 *
 *  A drag does two things, and which one is decided by where in the target row
 *  the pointer is: near an edge it lands *beside* that row, in the middle of a
 *  top-level row it goes *inside* it. One gesture, because reordering and
 *  re-parenting are the same thought — "this belongs there". */
function Grip({ onGrab, lifted }: { onGrab: (e: React.PointerEvent) => void; lifted: boolean }) {
  return (
    <span
      onPointerDown={onGrab}
      onClick={e => e.stopPropagation()}
      title="Drag to reorder — or onto a category to file it inside"
      style={{
        display: 'inline-flex', flexShrink: 0, padding: '4px 1px',
        color: lifted ? 'var(--sb-ink-1)' : 'var(--sb-ink-4)',
        cursor: lifted ? 'grabbing' : 'grab', touchAction: 'none',
      }}>
      <GripVertical size={ICON.sm} strokeWidth={STROKE.rest} />
    </span>
  )
}

export type DropMode = 'before' | 'after' | 'into'

/** The 2px line that says "it lands here". */
const EDGE = '2px solid var(--sb-accent-deep)'
const HAIR = 'var(--sb-border-width) solid var(--sb-hairline)'

/** The pill beside a name during a drag: what dropping here would do, or why
 *  it would not do the thing the pointer is over. Saying nothing at all in the
 *  refused case leaves a reorder happening where a nest was aimed. */
function DropMark({ blocked }: { blocked?: boolean }) {
  return (
    <span style={{
      fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.06em',
      padding: '1px 7px', borderRadius: 'var(--sb-r-pill)', flexShrink: 0,
      background: blocked ? 'var(--sb-field)' : 'var(--sb-accent-deep)',
      color: blocked ? 'var(--sb-ink-4)' : 'var(--sb-card)',
      border: blocked ? 'var(--sb-border-width) solid var(--sb-border)' : 'none',
    }}>{blocked ? 'HAS PARTS OF ITS OWN' : 'INSIDE'}</span>
  )
}

function CategoryRows({ row, tone, open, hidden, onToggleOpen, onToggleHide, onSelect, onOpen, selectedId, onDrill, onGrab, regRow, dragId, overId, overMode, nestBlocked, months, ROW_H, numCell, fmt }: {
  row: Row
  tone: string
  open: boolean
  hidden: (id: string) => boolean
  onToggleOpen: (id: string) => void
  /** The eye. Hiding is a real thing this table does — "hide any row and every
   *  total recalculates" is the promise in its own subtitle — but it was on the
   *  row itself, where it fought with selecting one. */
  onToggleHide: (id: string) => void
  /** Clicking the row. It narrows the chart to this category, and nothing else. */
  onSelect: (id: string) => void
  /** The pencil. Every entry filed here this year. */
  onOpen: (id: string) => void
  selectedId: string | null
  /** A figure is a set of entries. `month` is null for the year column. */
  onDrill: (ids: string[], label: string, month: number | null) => void
  /** Picks a row up. It can only be put down among its own siblings. */
  onGrab: (cat: Category) => (e: React.PointerEvent) => void
  /** Lends the row's element out, so a drag can tell what it is over. */
  regRow: (id: string) => (el: HTMLTableRowElement | null) => void
  /** The row being carried, the row it is over, and what dropping would do:
   *  land beside it, or go inside it. */
  dragId: string | null
  overId: string | null
  overMode: DropMode
  /** The pointer is where a nest would go, and a nest is not possible. */
  nestBlocked: boolean
  months: number[]
  ROW_H: number
  numCell: (v: number, isNet?: boolean) => React.CSSProperties
  fmt: (v: number) => string
}) {
  const isHidden = hidden(row.cat.id)
  const lifted  = dragId === row.cat.id
  const overMe  = overId === row.cat.id && !lifted
  const isOver  = overMe && overMode === 'into'
  const lineTop = overMe && overMode === 'before'
  const lineBot = overMe && overMode === 'after'
  // A dragged-over row is tinted, and the tint has to reach the sticky name
  // cell too — it paints its own background over whatever the row has.
  const picked = selectedId === row.cat.id
  const bg = isOver || picked ? 'var(--sb-accent-tint)' : isHidden ? 'var(--sb-field)' : 'var(--sb-card)'
  const total = months.reduce((s, v) => s + v, 0)
  const kids = row.children
  // A hidden part is taken out of the parent's figure, so it has to be out of
  // the parent's list too, or the two disagree.
  const ownIds = [row.cat.id, ...kids.filter(k => !hidden(k.cat.id)).map(k => k.cat.id)]

  /** A figure worth opening is one with something behind it. The click has to
   *  be stopped here or it reaches the row, whose job is to hide it. */
  const cell = (v: number, ids: string[], label: string, month: number | null, style: React.CSSProperties) =>
    v === 0 ? <td style={style}>{fmt(v)}</td> : (
      <td
        style={{ ...style, cursor: 'pointer' }}
        title={`${label} — see the entries`}
        onClick={e => { e.stopPropagation(); onDrill(ids, label, month) }}
      >
        <span className="sb-underline-hover">
          {fmt(v)}
        </span>
      </td>
    )

  return (
    <>
      <tr
        ref={regRow(row.cat.id)}
        className="sb-fin-row"
        onClick={() => onSelect(row.cat.id)}
        title={picked ? `${row.cat.name} — click again to put every category back on the chart` : `Show only ${row.cat.name} on the chart`}
        style={{
          borderTop: lineTop ? EDGE : undefined,
          borderBottom: lineBot ? EDGE : HAIR, cursor: 'pointer',
          background: isOver ? 'var(--sb-accent-tint)' : picked ? 'var(--sb-accent-tint)' : isHidden ? 'var(--sb-field)' : 'transparent',
          opacity: lifted ? 0.4 : isHidden ? 0.45 : 1,
        }}
      >
        <td style={{ padding: '0 14px', height: ROW_H, position: 'sticky', left: 0, background: bg, zIndex: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <Grip lifted={lifted} onGrab={onGrab(row.cat as Category)} />
            {/* The arrow opens the row; it must not also hide it. */}
            {kids.length > 0 ? (
              <button
                onClick={e => { e.stopPropagation(); onToggleOpen(row.cat.id) }}
                title={open ? 'Fold its sub-categories away' : `Show its ${kids.length} sub-categories`}
                style={{
                  width: 16, height: 16, padding: 0, flexShrink: 0, borderRadius: 'var(--sb-r-chip)',
                  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-ink-4)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                {open ? <ChevronDown size={ICON.sm} strokeWidth={STROKE.active} /> : <ChevronRight size={ICON.sm} strokeWidth={STROKE.active} />}
              </button>
            ) : <span style={{ width: 16, flexShrink: 0 }} />}
            <span style={{ display: 'inline-flex', color: row.cat.color }}><CategoryGlyph icon={row.cat.icon} size={12} /></span>
            <span style={{ fontSize: 'var(--sb-t-body)', color: isHidden ? 'var(--sb-ink-4)' : 'var(--sb-ink-1)', textDecoration: isHidden ? 'line-through' : 'none', fontWeight: 500 }}>
              {row.cat.name}
            </span>
            {kids.length > 0 && !open && (
              <span style={{ fontSize: 'var(--sb-t-micro)', color: 'var(--sb-border)' }}>+{kids.length}</span>
            )}
            {overMe && (isOver || nestBlocked) && <DropMark blocked={nestBlocked} />}
            <span style={{ flex: 1 }} />
            <RowTools name={row.cat.name} hidden={isHidden} on={picked}
              onHide={() => onToggleHide(row.cat.id)} onOpen={() => onOpen(row.cat.id)} />
          </div>
        </td>
        {months.map((v, mi) => (
          <Fragment key={mi}>{cell(v, ownIds, `${row.cat.name} · ${MONTHS_SHORT[mi]}`, mi, numCell(v))}</Fragment>
        ))}
        {cell(total, ownIds, `${row.cat.name} · the year`, null,
          { ...numCell(total), fontWeight: 700, color: total === 0 ? 'var(--sb-border)' : tone })}
      </tr>

      {open && kids.map(kid => {
        const kidHidden = hidden(kid.cat.id) || isHidden
        const kidLifted = dragId === kid.cat.id
        const kidOverMe = overId === kid.cat.id && !kidLifted
        const kidTop    = kidOverMe && overMode === 'before'
        const kidBot    = kidOverMe && overMode === 'after'
        const kidPicked = selectedId === kid.cat.id
        const kidBg = kidHidden ? 'var(--sb-field)' : 'var(--sb-accent-tint)'
        const kidTotal = kid.amounts.reduce((s, v) => s + v, 0)
        return (
          <tr key={kid.cat.id}
            ref={regRow(kid.cat.id)}
            className="sb-fin-row"
            onClick={() => onSelect(kid.cat.id)}
            title={kidPicked ? `${kid.cat.name} — click again to put every category back on the chart` : `Show only ${kid.cat.name} on the chart`}
            style={{
              borderTop: kidTop ? EDGE : undefined,
              borderBottom: kidBot ? EDGE : 'var(--sb-border-width) solid var(--sb-accent-tint)',
              cursor: 'pointer', background: kidPicked ? 'var(--sb-accent)' : kidBg,
              opacity: kidLifted ? 0.4 : kidHidden ? 0.45 : 1,
            }}
          >
            <td style={{ padding: '0 14px', height: ROW_H - 4, position: 'sticky', left: 0, background: kidBg, zIndex: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <Grip lifted={kidLifted} onGrab={onGrab(kid.cat as Category)} />
                <span style={{ width: 16, flexShrink: 0 }} />
                <span style={{ width: 8, height: 1, background: 'var(--sb-border)', flexShrink: 0 }} />
                <span style={{ display: 'inline-flex', color: kid.cat.color }}><CategoryGlyph icon={kid.cat.icon} size={11} /></span>
                <span style={{ fontSize: 'var(--sb-t-body-s)', color: kidHidden ? 'var(--sb-ink-4)' : 'var(--sb-ink-2)', textDecoration: hidden(kid.cat.id) ? 'line-through' : 'none' }}>
                  {kid.cat.name}
                </span>
                <span style={{ flex: 1 }} />
                <RowTools small name={kid.cat.name} hidden={hidden(kid.cat.id)} on={kidPicked}
                  onHide={() => onToggleHide(kid.cat.id)} onOpen={() => onOpen(kid.cat.id)} />
              </div>
            </td>
            {kid.amounts.map((v, mi) => (
              <Fragment key={mi}>
                {cell(v, [kid.cat.id], `${kid.cat.name} · ${MONTHS_SHORT[mi]}`, mi,
                  { ...numCell(v), fontSize: 'var(--sb-t-meta)', color: v === 0 ? 'var(--sb-border)' : 'var(--sb-ink-3)' })}
              </Fragment>
            ))}
            {cell(kidTotal, [kid.cat.id], `${kid.cat.name} · the year`, null,
              { ...numCell(kidTotal), fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: kidTotal === 0 ? 'var(--sb-border)' : tone, opacity: 0.85 })}
          </tr>
        )
      })}
    </>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ReflectionScreen(_props?: any) {
  const { transactions, categories, accounts, upsertTransaction, removeTransaction, upsertCategory } = useFinanceStore()
  // The year lives in the store because it decides what gets fetched. Held
  // locally, stepping back a year filtered a set of transactions that only
  // ever contained the current one — so the whole grid came back empty and
  // looked like a year with nothing in it.
  const year    = useFinanceStore(s => s.currentYear)
  const setYear = useFinanceStore(s => s.setYear)

  const today = new Date()
  const base = baseCurrency()

  // Two ways to read a year, and they are different years.
  //
  //   "due"  — an entry sits in the month it belongs to, whether or not the
  //            money has moved. September's rent is September's, paid or not.
  //   "paid" — an entry sits in the month the money actually left, and an entry
  //            that has not been paid is not in the table at all.
  //
  // Settings holds the default; this remembers what was last looked at here.
  const [basis, setBasis] = useState<'due' | 'paid'>(() => {
    try {
      return (localStorage.getItem('finance-financials-basis')
        ?? localStorage.getItem('finance-count-on')) === 'paid' ? 'paid' : 'due'
    } catch { return 'due' }
  })
  /** A table and a chart answer different questions about the same year, so
   *  the year is not reloaded to switch between them — only redrawn. */
  const [view, setView] = useState<'table' | 'lines'>(() => {
    try { return localStorage.getItem('finance-financials-view') === 'lines' ? 'lines' : 'table' } catch { return 'table' }
  })
  function pickView(v: 'table' | 'lines') {
    setView(v)
    try { localStorage.setItem('finance-financials-view', v) } catch { /* private mode */ }
  }
  /** Whether a line is a category or one of its parts. */
  const [depth, setDepth] = useState<'category' | 'part'>(() => {
    try { return localStorage.getItem('finance-financials-depth') === 'part' ? 'part' : 'category' } catch { return 'category' }
  })
  function pickDepth(d: 'category' | 'part') {
    setDepth(d)
    try { localStorage.setItem('finance-financials-depth', d) } catch { /* private mode */ }
  }

  function pickBasis(b: 'due' | 'paid') {
    setBasis(b)
    try { localStorage.setItem('finance-financials-basis', b) } catch { /* private mode */ }
  }

  /** The date a figure is filed under, or null when this basis cannot place it:
   *  an entry with no payment date has not been paid, and money that has not
   *  moved does not belong in a table of money that has. */
  const filedOn = useCallback(
    (tx: Transaction): string | null => (basis === 'paid' ? tx.paidAt ?? null : tx.date),
    [basis],
  )
  const filedIn = useCallback(
    (tx: Transaction, prefix: string) => { const d = filedOn(tx); return !!d && d.startsWith(prefix) },
    [filedOn],
  )

  // Entries that look like they were put in twice, this year. The rows here are
  // monthly sums, so the flag cannot sit on a figure — it sits in the header,
  // with the list of what to go and look at.
  const [dupesOpen, setDupesOpen] = useState(false)
  const yearTx = useMemo(
    () => transactions.filter(t => filedIn(t, String(year))),
    [transactions, year, filedIn],
  )
  const dupes = useMemo(() => findDuplicates(yearTx), [yearTx])
  // What has already been looked at and left alone. Re-read on the event so
  // acknowledging one updates the chip and the list in the same tick, and on
  // `storage` so another tab's decision arrives too.
  const [acks, setAcks] = useState<Set<string>>(loadAcks)
  useEffect(() => {
    const sync = () => setAcks(loadAcks())
    window.addEventListener(ACKS_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(ACKS_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])
  const flagged = useMemo(
    () => yearTx.filter(t => dupes.has(t.id)).sort((a, b) => b.date.localeCompare(a.date)),
    [yearTx, dupes],
  )
  const suspects = useMemo(() => flagged.filter(t => !isAcknowledged(acks, t)), [flagged, acks])
  const settled = flagged.length - suspects.length

  const [fxTick, setFxTick] = useState(0)
  useEffect(() => {
    const h = () => setFxTick(n => n + 1)
    window.addEventListener('professor:fxRatesChanged', h)
    return () => window.removeEventListener('professor:fxRatesChanged', h)
  }, [])

  // Build categoryId → monthly amounts map for given year
  const { incomeRows, expenseRows, monthlyIncome, monthlyExpense } = useMemo(() => {
    // Filter to the selected year
    const yearTx = transactions.filter(tx => filedIn(tx, String(year)))

    const wants = (c: { txType: string }, kind: 'income' | 'expense') =>
      c.txType === kind || c.txType === 'both'

    /** A month-by-month row for one category. `ids` is the category plus, for a
     *  parent, its children — money filed under "Groceries · Fruit" is money
     *  out of Groceries, and the parent's row said nothing about it before. */
    function amountsFor(ids: Set<string>, type: 'income' | 'expense') {
      return MONTHS_SHORT.map((_, mi) => {
        const prefix = `${year}-${String(mi + 1).padStart(2, '0')}`
        return yearTx
          .filter(tx => tx.type === type && tx.categoryId && ids.has(tx.categoryId) && filedIn(tx, prefix))
          // This added the raw figure whatever it was in, so a salary in USD
          // was counted as though it were the same number of pounds. Converted
          // now; something with no rate is left out and said so below.
          .reduce((s, tx) => s + (toBase(Math.abs(tx.amount), tx.currency, base) ?? 0), 0)
      })
    }

    function buildRows(kind: 'income' | 'expense') {
      return categories
        .filter(c => !c.parentId && wants(c, kind))
        .sort(byOrder)
        .map(cat => {
          const kids = categories.filter(c => c.parentId === cat.id).sort(byOrder)
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
      return yearTx.filter(tx => tx.type === type && filedIn(tx, prefix))
        .reduce((s, tx) => s + (toBase(Math.abs(tx.amount), tx.currency, base) ?? 0), 0)
    })
    const monthlyIncome  = monthly('income')
    const monthlyExpense = monthly('expense')

    return { incomeRows, expenseRows, monthlyIncome, monthlyExpense }
  }, [transactions, categories, year, base, fxTick, filedIn])

  /** Which categories have their parts showing. Declared here because a drop
   *  that nests a row opens the row it landed in. */
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())

  // ─── Dragging a row into place, or into another row ─────────────────────
  //
  //  One gesture does both jobs, because they are the same thought: *this
  //  belongs there*. Where in the target row the pointer sits decides which:
  //
  //    near its top or bottom edge → land **beside** it, as its sibling
  //    in the middle of a top-level row → go **inside** it, as its part
  //
  //  Landing beside a row therefore also un-nests: drop a sub-category beside
  //  a top-level one and it becomes top-level. There is no separate promote.
  //
  //  Only rows in the same section are candidates — spending cannot be filed
  //  inside earning, and the totals would stop meaning anything if it could.
  const rowEls = useRef(new Map<string, HTMLTableRowElement>())
  const [drag, setDrag] = useState<{
    id: string
    kind: 'income' | 'expense'
    over: string | null
    mode: DropMode
    /** True where the pointer is in a row's nest zone but the move is not one
     *  this model can make — one level of nesting is all it has. */
    blocked: boolean
  } | null>(null)
  // A drag ends in a click on whatever was under the finger. That click would
  // otherwise hide the row it landed on.
  const justDragged = useRef(false)

  const regRow = useCallback((id: string) => (el: HTMLTableRowElement | null) => {
    if (el) rowEls.current.set(id, el)
    else rowEls.current.delete(id)
  }, [])

  const grab = useCallback((kind: 'income' | 'expense') => (cat: Category) => (e: React.PointerEvent) => {
    // Without this the row underneath takes the press as a click, and the
    // browser starts selecting text across the table as the pointer moves.
    e.preventDefault()
    e.stopPropagation()
    setDrag({ id: cat.id, kind, over: null, mode: 'before', blocked: false })
  }, [])

  /** Every category drawn in one section: its top-level rows, and the parts of
   *  them. A part belongs to whichever section its parent is in. */
  const sectionOf = useCallback((c: Category, kind: 'income' | 'expense') => {
    const top = c.parentId ? categories.find(x => x.id === c.parentId) : c
    return !!top && (top.txType === kind || top.txType === 'both')
  }, [categories])

  /**
   *  Carry out a drop, or say why it cannot happen. Three rules, and they are
   *  the Budget screen's word for word — the two screens move the same
   *  categories and must not disagree about what is allowed.
   */
  const applyDrop = useCallback((moved: Category, target: Category, mode: DropMode, kind: 'income' | 'expense') => {
    const hasKids = categories.some(c => c.parentId === moved.id)
    const newParent = mode === 'into' ? target.id : (target.parentId ?? undefined)
    if (newParent === moved.id) return
    if ((moved.parentId ?? null) === (newParent ?? null) && mode === 'into') return

    // One level of nesting is all this models, so a category with children of
    // its own cannot itself become a child — its children would need
    // grandparents, and nothing here knows what those are.
    if (newParent && hasKids) {
      notify(`${moved.name} has sub-categories of its own — empty it first, or move those instead.`)
      return
    }
    const parentCat = newParent ? categories.find(c => c.id === newParent) : null
    // Spending inside earning would make the totals lie about which is which.
    if (parentCat && (parentCat.txType === 'income') !== (moved.txType === 'income')) {
      notify(`${moved.name} and ${parentCat.name} are not the same kind of money.`)
      return
    }
    // A part takes its parent's kind, and this table files a row by that kind.
    // So a category set to *both* — which is drawn in each section, summing
    // its own side there — loses the other side's entries the moment it is
    // nested: they are still in the ledger and in no total on this screen.
    // Counting them is the difference between a move and a quiet subtraction.
    if (parentCat && moved.txType === 'both' && parentCat.txType !== 'both') {
      const other = parentCat.txType === 'income' ? 'expense' : 'income'
      const lost = transactions.filter(t => t.categoryId === moved.id && t.type === other).length
      if (lost > 0) {
        notify(`${moved.name} has ${lost} ${other} ${lost === 1 ? 'entry' : 'entries'} — inside ${parentCat.name} only its ${parentCat.txType} side would count.`)
        return
      }
    }

    // The list it lands in, without it, in the order it is drawn.
    const sibs = (newParent
      ? categories.filter(c => c.parentId === newParent)
      : categories.filter(c => !c.parentId && (c.txType === kind || c.txType === 'both'))
    ).filter(c => c.id !== moved.id).sort(byOrder)

    let at = sibs.length
    if (mode !== 'into') {
      const k = sibs.findIndex(c => c.id === target.id)
      if (k >= 0) at = mode === 'before' ? k : k + 1
    }
    const next = [...sibs.slice(0, at), moved, ...sibs.slice(at)]

    const moving = (moved.parentId ?? null) !== (newParent ?? null)
    next.forEach((c, i) => {
      if (c.id === moved.id) {
        if (!moving && c.sortOrder === i) return
        void upsertCategory({
          ...moved, parentId: newParent, sortOrder: i,
          // A part takes its parent's kind, or one section's total would be
          // summed out of the other's rows.
          txType: parentCat ? parentCat.txType : moved.txType,
        })
      } else if (c.sortOrder !== i) {
        void upsertCategory({ ...c, sortOrder: i })
      }
    })
    // Nesting something into a folded row would otherwise look like a delete.
    if (mode === 'into') setOpenIds(prev => new Set(prev).add(target.id))
    if (moving) notify(newParent
      ? `${moved.name} is now inside ${parentCat?.name ?? 'it'}`
      : `${moved.name} is a category of its own again`)
  }, [categories, transactions, upsertCategory])

  useEffect(() => {
    if (!drag) return
    const moved = categories.find(c => c.id === drag.id)
    if (!moved) return
    const hasKids = categories.some(c => c.parentId === drag.id)

    const move = (e: PointerEvent) => {
      let over: string | null = null
      let mode: DropMode = 'before'
      let blocked = false
      for (const c of categories) {
        if (!sectionOf(c, drag.kind)) continue
        const el = rowEls.current.get(c.id)
        if (!el) continue
        const r = el.getBoundingClientRect()
        if (e.clientY < r.top || e.clientY > r.bottom) continue
        const f = (e.clientY - r.top) / Math.max(1, r.height)
        // The middle of a top-level row means *inside it* — but only where
        // that is a move this model can make, or the pointer would promise
        // something the drop then refuses.
        const nestZone = !c.parentId && c.id !== drag.id && f > 0.3 && f < 0.7
        const canNest = nestZone && !hasKids && moved.parentId !== c.id
        over = c.id
        mode = canNest ? 'into' : f < 0.5 ? 'before' : 'after'
        blocked = nestZone && !canNest && hasKids
        break
      }
      setDrag(d => (d && (d.over !== over || d.mode !== mode || d.blocked !== blocked) ? { ...d, over, mode, blocked } : d))
    }

    const up = () => {
      const { id, over, mode, kind } = drag
      const target = over ? categories.find(c => c.id === over) : null
      if (target && target.id !== id) applyDrop(moved, target, mode, kind)
      justDragged.current = true
      setTimeout(() => { justDragged.current = false }, 0)
      setDrag(null)
    }

    // A class rather than a style write: the document's inline style belongs
    // to lib/themes.ts, and this is a state ("something is being dragged")
    // rather than a value.
    document.body.classList.add('sb-dragging')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      document.body.classList.remove('sb-dragging')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [drag, categories, sectionOf, applyDrop])

  /** The one category the chart is narrowed to, if any. Clicking a row picks
   *  it; clicking it again, or anywhere that is not a row, puts them all back. */
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedCat = selectedId ? categories.find(c => c.id === selectedId) ?? null : null
  function pickRow(id: string) {
    if (justDragged.current) return
    setSelectedId(cur => (cur === id ? null : id))
  }

  // Hidden rows (by category id) — toggling removes row from totals
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set())
  function toggleHide(id: string) {
    if (justDragged.current) return
    setHiddenIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const needRates = useMemo(
    () => currenciesNeedingRates(transactions.filter(t => filedIn(t, String(year))), base),
    [transactions, year, base, fxTick, filedIn],
  )

  // ── What is behind a figure ────────────────────────────────────────────────
  // Each cell is a sum; this is the list it was summed from, so an entry filed
  // wrong can be corrected where the wrongness is visible.
  const [drill, setDrill] = useState<
    { ids: string[] | null; label: string; month: number | null; kind: 'income' | 'expense' | 'both' } | null
  >(null)
  const [editing, setEditing] = useState<Transaction | null>(null)
  /** The one entry the panel is showing instead of the list. */
  const [openTx, setOpenTx] = useState<Transaction | null>(null)
  const [adding, setAdding] = useState(false)

  /** The pencil on a row: everything filed under it this year, parts included. */
  function openRow(id: string) {
    const cat = categories.find(c => c.id === id)
    if (!cat) return
    const kids = categories.filter(c => c.parentId === id).map(c => c.id)
    openDrill([id, ...kids], `${cat.name} · ${year}`, null,
      cat.txType === 'income' ? 'income' : 'expense')
  }

  function openDrill(ids: string[] | null, label: string, month: number | null, kind: 'income' | 'expense' | 'both') {
    setOpenTx(null)
    setDrill({ ids, label, month, kind })
  }

  // ── The same category, across every year ──────────────────────────────────
  //
  //  The store holds one year, deliberately: everything that writes depends on
  //  that bound. So "what has school cost me over five years" was a question
  //  the app could not answer at all — the only way to see another year was to
  //  leave this one, and then you were comparing from memory.
  //
  //  This is a *reading*, and it keeps its answer to itself: a separate query,
  //  a separate list, never merged into the store. No write path, no poll and
  //  no year change has to know it exists.
  const [span, setSpan] = useState<number>(1)
  const [history, setHistory] = useState<Transaction[] | null>(null)
  const [bounds, setBounds] = useState<{ first: number; last: number } | null>(null)
  const [loadingSpan, setLoadingSpan] = useState(false)

  // Closing the panel, or opening a different figure, puts it back to this
  // year — a span left set from the last thing you looked at is a surprise.
  useEffect(() => { setSpan(1); setHistory(null) }, [drill?.label])

  useEffect(() => {
    if (!drill) return
    void loadYearBounds().then(setBounds).catch(() => setBounds(null))
  }, [drill])

  useEffect(() => {
    if (!drill || span <= 1) { setHistory(null); return }
    // "All" means every year the ledger has, and that takes a question of its
    // own to answer. Falling back to this year while it is in flight would
    // quietly show one year under a button that says all of them.
    if (span === Infinity && !bounds) { setLoadingSpan(true); return }
    let alive = true
    setLoadingSpan(true)
    const from = span === Infinity ? bounds!.first : year - span + 1
    const to = span === Infinity ? bounds!.last : year
    void loadTransactionsSpan(from, to)
      .then(rows => { if (alive) setHistory(rows.map(txFromRow)) })
      .catch(() => { if (alive) setHistory([]) })
      .finally(() => { if (alive) setLoadingSpan(false) })
    return () => { alive = false }
  }, [drill, span, year, bounds])

  const drillTx = useMemo(() => {
    if (!drill) return []
    const ids = drill.ids ? new Set(drill.ids) : null
    const wanted = (t: string) => drill.kind === 'both' ? (t === 'income' || t === 'expense') : t === drill.kind
    const pick = (list: Transaction[], prefix: string | null) => list
      .filter(tx => wanted(tx.type) && (prefix === null || filedIn(tx, prefix)))
      .filter(tx => (ids ? !!tx.categoryId && ids.has(tx.categoryId) : true))
      .sort((a, b) => b.date.localeCompare(a.date))
    // A span drops the month: "August, over five years" is a different question
    // and not the one the control asks.
    if (history) return pick(history, null)
    const prefix = drill.month === null
      ? String(year)
      : `${year}-${String(drill.month + 1).padStart(2, '0')}`
    return pick(transactions, prefix)
  }, [drill, transactions, history, year, filedIn])

  /** The span's totals, year by year — the shape of the question. A list of
   *  four hundred entries does not answer "is this getting worse". */
  const byYear = useMemo(() => {
    if (!history) return []
    const acc = new Map<string, number>()
    for (const tx of drillTx) {
      const d = filedOn(tx)
      if (!d) continue
      const v = toBase(Math.abs(tx.amount), tx.currency, base)
      if (v === null) continue
      const y = d.slice(0, 4)
      acc.set(y, (acc.get(y) ?? 0) + (tx.type === 'income' ? v : -v))
    }
    return [...acc.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [history, drillTx, filedOn, base])

  /** A figure covering exactly one category can say where a new entry goes; one
   *  covering a whole section cannot, so the entry asks. And a month figure
   *  dates it into that month — the 1st, or today when today is inside it. */
  const addTarget = useMemo(() => {
    if (!drill || !drill.ids || drill.ids.length === 0) return null
    const cat = categories.find(c => c.id === drill.ids![0])
    return cat ? { id: cat.id, name: cat.name } : null
  }, [drill, categories])

  const addDate = useMemo(() => {
    if (!drill) return undefined
    const today = todayISO()
    if (drill.month === null) return today.startsWith(String(year)) ? today : `${year}-01-01`
    const prefix = `${year}-${String(drill.month + 1).padStart(2, '0')}`
    return today.startsWith(prefix) ? today : `${prefix}-01`
  }, [drill, year])

  // Which parents are showing their parts.
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

  /** What the chart draws. A category with no parts of its own is still a line
   *  at the deeper level — otherwise switching to sub-categories makes half the
   *  year's spending disappear, which is not what "show me the parts" means. */
  const series = useMemo<Series[]>(() => {
    const out: Series[] = []
    for (const [rows, kind] of [[incomeRows, 'income'], [expenseRows, 'expense']] as const) {
      for (const row of rows) {
        if (depth === 'category' || row.children.length === 0) {
          out.push({ id: row.cat.id, name: row.cat.name, color: row.cat.color, kind, amounts: rowMonths(row) })
        } else {
          for (const kid of row.children) {
            out.push({ id: kid.cat.id, name: kid.cat.name, color: kid.cat.color, kind, amounts: kid.amounts, under: row.cat.name })
          }
        }
      }
    }
    // One row picked narrows the chart to it — and to its parts, because a
    // category *is* its parts and dropping them would draw a different figure
    // from the one on the row you clicked.
    if (selectedId) {
      const kin = new Set([selectedId, ...categories.filter(c => c.parentId === selectedId).map(c => c.id)])
      const only = out.filter(x => kin.has(x.id))
      if (only.length) return only
    }
    return out
  // rowMonths reads hiddenIds, which is exactly what should redraw this.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomeRows, expenseRows, depth, hiddenIds, selectedId, categories])

  // Visible income / expense sums per month (respecting hidden rows)
  const visIncome  = MONTHS_SHORT.map((_, mi) => incomeRows.filter(r => !hiddenIds.has(r.cat.id)).reduce((s, r) => s + rowMonths(r)[mi], 0))
  const visExpense = MONTHS_SHORT.map((_, mi) => expenseRows.filter(r => !hiddenIds.has(r.cat.id)).reduce((s, r) => s + rowMonths(r)[mi], 0))
  const netPerMonth = MONTHS_SHORT.map((_, mi) => visIncome[mi] - visExpense[mi])

  /** The categories a figure covers: a hidden parent is out entirely, a hidden
   *  part is out of its parent. Same rule the sums above use. */
  const visibleIds = (rows: { cat: { id: string }; children: { cat: { id: string } }[] }[]) =>
    rows.filter(r => !hiddenIds.has(r.cat.id))
      .flatMap(r => [r.cat.id, ...r.children.filter(c => !hiddenIds.has(c.cat.id)).map(c => c.cat.id)])

  // Cumulative (running) cash
  const cumulative: number[] = []
  let cum = 0
  netPerMonth.forEach(n => { cum += n; cumulative.push(cum) })

  const currentMonth = today.getMonth() // 0-indexed
  // Entries the paid view has nothing to place: due this year, never paid.
  const unpaidThisYear = useMemo(
    () => transactions.filter(t => !t.paidAt && t.date.startsWith(String(year))).length,
    [transactions, year],
  )

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
      fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-body-s)', fontWeight: isNet ? 700 : 500,
      color: isNet ? netColor(v) : v === 0 ? 'var(--sb-border)' : 'var(--sb-ink-1)',
      fontVariantNumeric: 'tabular-nums' as const,
      whiteSpace: 'nowrap' as const,
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--sb-page)', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ flexShrink: 0, padding: '14px 26px 14px', display: 'flex', alignItems: 'flex-end', gap: 20 }}>
        {/* The title is what gives way when the row is tight. It has a caption
            that can wrap; the controls beside it cannot, and a control that
            wraps onto a second line is the thing this header kept doing. */}
        <div style={{ minWidth: 0, flexShrink: 1 }}>
          <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 700, letterSpacing: '0.14em', color: 'var(--sb-ink-3)', display: 'block', marginBottom: 4 }}>FINANCE · REFLECT</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => void setYear(year - 1)} style={{ background: 'none', border: 'none', color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-h2)', cursor: 'pointer', padding: 0, lineHeight: 1 }}>‹</button>
            <span style={{ fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h1)', fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1, color: 'var(--sb-ink-1)' }}>
              Financials, {year}
            </span>
            <button onClick={() => void setYear(year + 1)} style={{ background: 'none', border: 'none', color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-h2)', cursor: 'pointer', padding: 0, lineHeight: 1 }}>›</button>
          </div>
          <span style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', marginTop: 3, display: 'block' }}>
            Every income &amp; expense line by month — hide any row and every total recalculates
            {needRates.length > 0 && (
              <span style={{ color: 'var(--sb-accent-deep)' }}>
                {' · '}{needRates.join(' and ')} left out — no rate set, see Settings → Finance
              </span>
            )}
          </span>
        </div>

        {/* Stats bar — one line, always.
            It used to align on `flex-end`, which is only the same line while
            every item is the same height: the net figure is three lines tall
            and the pills are one, so they sat at two different baselines. And
            the unpaid caption hung *below* the basis toggle in absolute
            position, so the row read as two rows whenever it appeared.
            Everything shares one centre line now, and the caption is a chip on
            that line rather than something dangling off it. */}
        <div style={{
          marginLeft: 'auto', display: 'flex', gap: 14, alignItems: 'center',
          // Never wrap. Wrapping is what put the pills on one line and the
          // figures on another, which is the whole complaint. If it genuinely
          // cannot fit it scrolls sideways, which is visible and recoverable;
          // a silently stacked row is neither.
          flexWrap: 'nowrap', flexShrink: 0, maxWidth: '100%', overflowX: 'auto', scrollbarWidth: 'none',
        }}>
          <Segmented
            size="sm"
            aria-label="How to read the year"
            value={view}
            onChange={pickView}
            options={[
              { value: 'table' as const, label: 'Table', title: 'Every figure, by month — what a thing cost, exactly' },
              { value: 'lines' as const, label: 'Lines', title: 'One dotted line each, across the year — which of them is climbing' },
            ]}
          />
          {view === 'lines' && (
            <Segmented
              size="sm"
              aria-label="What a line is"
              value={depth}
              onChange={pickDepth}
              options={[
                { value: 'category' as const, label: 'Categories',     title: 'One line per category, its parts included in it' },
                { value: 'part'     as const, label: 'Sub-categories', title: 'One line per part; a category with no parts keeps its own' },
              ]}
            />
          )}
          <Segmented
            size="sm"
            aria-label="Which date a figure is filed under"
            value={basis}
            onChange={pickBasis}
            options={[
              { value: 'due'  as const, label: 'When it is due',  title: 'Every entry in the month it belongs to, paid or not' },
              { value: 'paid' as const, label: 'When it was paid', title: 'Only money that has actually moved, in the month it moved' },
            ]}
          />
          {/* What this view is leaving out, on the line rather than under it —
              and shaped like the "to check" chip beside it, because both are
              the same kind of thing: a count of entries wanting an answer. */}
          {basis === 'paid' && unpaidThisYear > 0 && (
            <button
              onClick={() => pickBasis('due')}
              title={`${unpaidThisYear} entries have no payment date, so no money has moved for them and this view cannot place them. Click to switch to "When it is due", which counts them.`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, flexShrink: 0,
                padding: '0 11px', borderRadius: 'var(--sb-r-pill)', cursor: 'pointer',
                background: 'var(--sb-negative-tint)', border: 'var(--sb-border-width) solid var(--sb-negative-tint)',
                color: 'var(--sb-negative)', fontFamily: 'inherit', fontSize: 'var(--sb-t-meta)', fontWeight: 700,
                whiteSpace: 'nowrap',
              }}>
              {unpaidThisYear} not paid yet
            </button>
          )}
          {suspects.length > 0 && (
            <span style={{ position: 'relative' }}>
              <button
                onClick={() => setDupesOpen(o => !o)}
                title="Identical entries filed twice on one day, or twice in one month"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, height: 28,
                  padding: '0 11px', borderRadius: 'var(--sb-r-pill)', cursor: 'pointer',
                  background: dupesOpen ? 'var(--sb-accent)' : 'var(--sb-accent-tint)',
                  border: 'var(--sb-border-width) solid var(--sb-accent-border)',
                  color: dupesOpen ? 'var(--sb-accent-ink)' : 'var(--sb-accent-deep)',
                  fontFamily: 'inherit', fontSize: 'var(--sb-t-meta)', fontWeight: 700,
                }}>
                {suspects.length} to check
              </button>
              {dupesOpen && (
                <Card style={{ position: 'absolute', top: 34, right: 0, zIndex: 30, width: 384, maxHeight: 320, overflowY: 'auto', padding: 12, textAlign: 'left' }}>
                  <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.5, marginBottom: 10 }}>
                    Same amount, account, category and payee. Filed twice on one day is
                    usually a slip; twice in one month may be real. Nothing has been changed —
                    open one to edit it, or throw the copy away here.
                  </div>
                  {suspects.map(t => (
                    <div key={t.id} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '5px 0', borderTop: 'var(--sb-border-width) solid var(--sb-accent-tint)', fontSize: 'var(--sb-t-body-s)',
                    }}>
                      {/* The whole line opens the entry — this list is where a
                          duplicate is noticed, so it should also be where it is
                          dealt with rather than a note telling you to go
                          elsewhere. The panel closes first, or it floats behind
                          the editor it just opened. */}
                      <span
                        onClick={() => { setDupesOpen(false); setEditing(t) }}
                        title="Open this entry"
                        className="sb-row-hover"
                        style={{
                          flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 8,
                          cursor: 'pointer', borderRadius: 'var(--sb-r-chip)', padding: '4px 6px', margin: '0 -6px',
                        }}>
                        <span style={{ color: 'var(--sb-ink-4)', fontVariantNumeric: 'tabular-nums' }}>{t.date}</span>
                        <span style={{ flex: 1, minWidth: 0, color: 'var(--sb-ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {t.payee?.trim() || categories.find(c => c.id === t.categoryId)?.name || 'Entry'}
                        </span>
                        <span style={{ color: dupes.get(t.id) === 'day' ? 'var(--sb-accent-deep)' : 'var(--sb-border)', fontSize: 'var(--sb-t-micro)', fontWeight: 700 }}>
                          {dupes.get(t.id) === 'day' ? 'SAME DAY' : 'SAME MONTH'}
                        </span>
                        <span style={{ fontFamily: 'var(--sb-font-num)', fontWeight: 600, color: 'var(--sb-ink-2)', fontVariantNumeric: 'tabular-nums' }}>
                          {acct(Math.abs(t.amount), { currency: t.currency })}
                        </span>
                      </span>
                      {/* Two answers, and only one of them is destructive. Most
                          flagged pairs are fine — a second tank of petrol, a
                          bill paid in halves — and without a way to say so the
                          chip sits at "10 to check" for ever, which is a count
                          you learn to ignore. */}
                      <button
                        onClick={() => acknowledge(t)}
                        title="Checked — this one is fine. It leaves the list; editing it brings it back."
                        style={{
                          width: 24, height: 24, borderRadius: 'var(--sb-r-pill)', padding: 0, flexShrink: 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
                          color: 'var(--sb-positive)', cursor: 'pointer',
                        }}><Check size={ICON.sm} strokeWidth={STROKE.active} /></button>
                      <button
                        onClick={() => {
                          if (!window.confirm(`Delete ${t.payee?.trim() || 'this entry'} of ${acct(Math.abs(t.amount), { currency: t.currency })} on ${t.date}?`)) return
                          void removeTransaction(t.id)
                        }}
                        title="Delete this entry"
                        style={{
                          width: 24, height: 24, borderRadius: 'var(--sb-r-pill)', padding: 0, flexShrink: 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-4)', cursor: 'pointer',
                        }}><Trash2 size={ICON.sm} /></button>
                    </div>
                  ))}
                  {settled > 0 && (
                    <div style={{
                      display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 10, paddingTop: 8,
                      borderTop: 'var(--sb-border-width) solid var(--sb-accent-tint)',
                      fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)',
                    }}>
                      <span>{settled} checked and left alone</span>
                      <button onClick={forgetAllAcks}
                        title="Put every one you have checked back in the list"
                        style={{
                          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                          color: 'var(--sb-ink-3)', textDecoration: 'underline', fontSize: 'var(--sb-t-micro)', fontFamily: 'inherit',
                        }}>show them again</button>
                    </div>
                  )}
                </Card>
              )}
            </span>
          )}
          {hiddenIds.size > 0 && (
            <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', fontStyle: 'italic' }}>
              {hiddenIds.size} row{hiddenIds.size > 1 ? 's' : ''} hidden
              <button onClick={() => setHiddenIds(new Set())} style={{ marginLeft: 8, background: 'none', border: 'none', color: 'var(--sb-ink-3)', cursor: 'pointer', fontSize: 'var(--sb-t-meta)', textDecoration: 'underline', padding: 0 }}>Show all</button>
            </span>
          )}
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 'var(--sb-t-micro)', letterSpacing: '0.1em', fontWeight: 700, color: 'var(--sb-ink-4)' }}>NET THROUGH {throughLabel}</div>
            <div style={{ fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h2)', fontWeight: 700, letterSpacing: '-0.02em', color: netColor(totalNet) }}>
              {acct(totalNet, { currency: base, zero: '–' })}
            </div>
            {/* This is a *flow* — what {year} has netted — and Goals shows a
                *stock*, what the accounts hold. They differ by the opening
                balances and by what Goals holds back, and one is not the other
                being wrong. */}
            <div style={{ fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)' }}
              title={`What ${year} earned less what it spent. It is not what the accounts hold — that is the opening balances plus this, and it is on Balances and on Goals as "spare now".`}>
              what {year} netted, not what is held
            </div>
          </div>
        </div>
      </div>

      {/* The page is now two columns: what you are reading, and what you have
          opened out of it. The entries used to arrive as a modal over the middle
          of the table — which hides the row you clicked, and every figure around
          it that gives it meaning. Docked, like the task panel beside its board. */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
      <div
        style={{
          // The rule under the header is the *table's* — it separates the
          // header from the figures. Run full width it also crossed the top of
          // the docked panel, which is a card floating beside the table, and a
          // line over a floating card reads as a lid somebody forgot to remove.
          flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden',
          borderTop: 'var(--sb-border-width) solid var(--sb-border)',
        }}
        onClick={e => {
          // Anywhere that is not a row puts every category back on the chart.
          if (!(e.target as HTMLElement).closest('.sb-fin-row, .sb-keep-selection')) setSelectedId(null)
        }}>
      {/* Table or chart, one at a time. Stacked, the chart took the top of the
          page and the figures under it were half a screen down — and the two
          answer the same question in two shapes, so you are reading one of
          them. Picking a row still narrows the chart; the selection survives
          the toggle, so you pick in the table and switch to see it. */}
      {view === 'lines' ? (
        <div style={{ flex: 1, overflow: 'auto', padding: '18px 26px 26px' }}>
          <Card style={{ padding: '18px 20px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.12em', color: 'var(--sb-ink-3)' }}>
                {selectedCat
                  ? `${selectedCat.name.toUpperCase()}, ${year}`
                  : `${depth === 'part' ? 'EVERY SUB-CATEGORY' : 'EVERY CATEGORY'}, ${year}`}
              </span>
              {/* The narrowing is done in the table, and with the table hidden
                  a chart of one line looks like a chart with lines missing.
                  This says which row it is and is the way back. */}
              {selectedCat && (
                <button onClick={() => setSelectedId(null)}
                  title="Put every category back on the chart"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5, height: 20, padding: '0 8px',
                    borderRadius: 'var(--sb-r-pill)', cursor: 'pointer',
                    background: 'var(--sb-accent-tint)', border: 'var(--sb-border-width) solid var(--sb-accent-border)',
                    color: 'var(--sb-ink-2)', fontFamily: 'inherit', fontSize: 'var(--sb-t-micro)', fontWeight: 600,
                  }}>
                  picked in the table <X size={11} />
                </button>
              )}
              <span style={{ fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)' }}>
                {series.length - hiddenIds.size > 0
                  ? `${series.filter(x => !hiddenIds.has(x.id)).length} of ${series.length} on the chart · tap a line or its name to take it off`
                  : 'nothing on the chart — tap a name below to put one back'}
              </span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)' }}>
                dashed is spending, dotted is earning · {basis === 'paid' ? 'filed by the day the money moved' : 'filed by the day it is due'}
              </span>
            </div>
            <LinesChart
              series={series}
              hidden={id => hiddenIds.has(id)}
              onToggle={toggleHide}
              through={year === today.getFullYear() ? currentMonth : 11}
              fmt={v => acct(v, { currency: base, zero: '–' })} />
          </Card>
        </div>
      ) : (
      <>
      {/* Table scroll area */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', minWidth: NAME_W + COL_W * 12 + 120 }}>

          {/* Column headers */}
          <thead>
            <tr style={{ background: 'var(--sb-header)' }}>
              <th style={{ width: NAME_W, minWidth: NAME_W, textAlign: 'left', padding: '8px 14px', fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.1em', color: 'var(--sb-ink-4)', position: 'sticky', top: 0, left: 0, background: 'var(--sb-header)', zIndex: 4, ...HEAD_EDGE }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span>CATEGORY</span>
                  {foldable.length > 0 && (
                    <button
                      onClick={toggleAll}
                      title={allOpen ? 'Fold every sub-category away' : `Open all ${foldable.length} that have sub-categories`}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4, height: 20,
                        padding: '0 7px', borderRadius: 'var(--sb-r-pill)', cursor: 'pointer',
                        background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-3)',
                        fontFamily: 'inherit', fontSize: 'var(--sb-t-micro)', fontWeight: 600, letterSpacing: '0.04em',
                      }}>
                      {allOpen ? <ChevronsDownUp size={ICON.sm} strokeWidth={STROKE.active} /> : <ChevronsUpDown size={ICON.sm} strokeWidth={STROKE.active} />}
                      {allOpen ? 'COLLAPSE ALL' : 'EXPAND ALL'}
                    </button>
                  )}
                </span>
              </th>
              {MONTHS_SHORT.map(m => (
                <th key={m} style={{ width: COL_W, minWidth: COL_W, textAlign: 'right', padding: '8px 10px', fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.1em', color: 'var(--sb-ink-4)', position: 'sticky', top: 0, background: 'var(--sb-header)', zIndex: 3, ...HEAD_EDGE }}>{m.toUpperCase()}</th>
              ))}
              <th style={{ width: 100, textAlign: 'right', padding: '8px 14px', fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.1em', color: 'var(--sb-ink-4)', position: 'sticky', top: 0, background: 'var(--sb-header)', zIndex: 3, ...HEAD_EDGE }}>TOTAL</th>
            </tr>
          </thead>

          <tbody>

            {/* ── INCOME section ── */}
            <SectionHeader label="INCOME" colCount={12} colWidth={COL_W} nameWidth={NAME_W}
              monthTotals={monthlyIncome} rowTotal={monthlyIncome.reduce((s, v) => s + v, 0)}
              onDrill={(label, month) => openDrill(null, label, month, 'income')} />

            {incomeRows.map(row => (
              <CategoryRows key={row.cat.id} row={row} tone={OLIVE}
                onGrab={grab('income')} regRow={regRow}
                dragId={drag?.id ?? null} overId={drag?.over ?? null}
                overMode={drag?.mode ?? 'before'} nestBlocked={!!drag?.blocked}
                onSelect={pickRow} onOpen={openRow} selectedId={selectedId}
                open={openIds.has(row.cat.id)} hidden={id => hiddenIds.has(id)}
                onToggleOpen={toggleOpen} onToggleHide={toggleHide}
                months={rowMonths(row)} ROW_H={ROW_H} numCell={numCell} fmt={fmt}
                onDrill={(ids, label, month) => openDrill(ids, label, month, 'income')} />
            ))}

            {/* Total income row */}
            <TotalRow label="Total income" months={visIncome} total={totalIncome} sign={1} COL_W={COL_W} NAME_W={NAME_W}
              onDrill={(label, month) => openDrill(visibleIds(incomeRows), label, month, 'income')} />

            {/* Spacer */}
            <tr style={{ height: 12 }}><td colSpan={14} /></tr>

            {/* ── EXPENSES section ── */}
            <SectionHeader label="EXPENSES" colCount={12} colWidth={COL_W} nameWidth={NAME_W}
              monthTotals={monthlyExpense} rowTotal={monthlyExpense.reduce((s, v) => s + v, 0)} out
              onDrill={(label, month) => openDrill(null, label, month, 'expense')} />

            {expenseRows.map(row => (
              <CategoryRows key={row.cat.id} row={row} tone={RUST}
                onGrab={grab('expense')} regRow={regRow}
                dragId={drag?.id ?? null} overId={drag?.over ?? null}
                overMode={drag?.mode ?? 'before'} nestBlocked={!!drag?.blocked}
                onSelect={pickRow} onOpen={openRow} selectedId={selectedId}
                open={openIds.has(row.cat.id)} hidden={id => hiddenIds.has(id)}
                onToggleOpen={toggleOpen} onToggleHide={toggleHide}
                months={rowMonths(row)} ROW_H={ROW_H} numCell={numCell} fmt={fmtOut}
                onDrill={(ids, label, month) => openDrill(ids, label, month, 'expense')} />
            ))}

            {/* Total expenses row */}
            <TotalRow label="Total expenses" months={visExpense} total={totalExpense} sign={-1} COL_W={COL_W} NAME_W={NAME_W}
              onDrill={(label, month) => openDrill(visibleIds(expenseRows), label, month, 'expense')} />

            {/* Spacer */}
            <tr style={{ height: 8 }}><td colSpan={14} /></tr>

            {/* Net per month */}
            <NetRow label="Net by month" months={netPerMonth} total={totalNet} COL_W={COL_W} NAME_W={NAME_W}
              onDrill={(label, month) => openDrill([...visibleIds(incomeRows), ...visibleIds(expenseRows)], label, month, 'both')} />

            {/* Cumulative cash */}
            <CumulativeRow months={cumulative} COL_W={COL_W} NAME_W={NAME_W} />

          </tbody>
        </table>
      </div>
      </>
      )}
      </div>

      {/* What one figure was summed from, beside it rather than over it. */}
      {drill && (
        <aside
          className="sb-keep-selection"
          style={{
            // A card beside the table, not a wall bolted to its edge — the
            // calendar's panel is a rounded frame floating on the page ground
            // and this is the same object doing the same job.
            width: 'clamp(320px, 31vw, 420px)', flexShrink: 0, display: 'flex', flexDirection: 'column',
            background: 'var(--sb-overlay)', border: 'var(--sb-border-width) solid var(--sb-border)',
            borderRadius: 'var(--sb-r-frame, var(--sb-r-card))',
            boxShadow: 'var(--sb-shadow-control, 0 1px 3px rgba(25,23,18,.10))',
            // The gap on the left is the one that matters: without it the
            // panel's edge sits against the table's own scrollbar and the two
            // read as one surface with a seam down it.
            margin: '10px 12px 12px 18px', padding: '18px 20px 20px', overflowY: 'auto',
          }}>

            {/* The entry form itself, docked. There is one entry form in this
                app and this is it — a second design of the same thing is two
                answers to what an entry is, and they drift. `lead` is the way
                back to the list it was opened from. */}
            {openTx ? (
              <TransactionModal
                key={openTx.id}
                docked
                transaction={openTx}
                accounts={accounts}
                categories={categories}
                history={transactions}
                lead={
                  <button onClick={() => setOpenTx(null)} title="Back to the list"
                    style={{
                      width: 28, height: 28, borderRadius: 'var(--sb-r-pill)', padding: 0, flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                      background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
                      color: 'var(--sb-ink-3)',
                    }}><ArrowLeft size={ICON.sm} /></button>
                }
                onSave={next => { void upsertTransaction(next); setOpenTx(null) }}
                onDelete={id => { void removeTransaction(id) }}
                onClose={() => setOpenTx(null)} />
            ) : adding ? (
              // One more of the same thing lands in the same column. Opened as
              // a modal it covered the list it was being added to, which is
              // the one thing worth seeing while adding to it.
              <TransactionModal
                docked
                transaction={null}
                initial={{
                  categoryId: addTarget?.id,
                  type: drill.kind === 'income' ? 'income' : 'expense',
                  date: addDate,
                }}
                accounts={accounts}
                categories={categories}
                history={transactions}
                lead={
                  <button onClick={() => setAdding(false)} title="Back to the list"
                    style={{
                      width: 28, height: 28, borderRadius: 'var(--sb-r-pill)', padding: 0, flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                      background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
                      color: 'var(--sb-ink-3)',
                    }}><ArrowLeft size={ICON.sm} /></button>
                }
                onSave={tx => { void upsertTransaction(tx); setAdding(false) }}
                onClose={() => setAdding(false)} />
            ) : (<>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                background: 'var(--sb-accent-tint)', borderRadius: 'var(--sb-r-pill)', padding: '5px 12px',
                fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: 'var(--sb-ink-3)',
              }}>
                <span style={{ width: 6, height: 6, borderRadius: 'var(--sb-r-pill)', background: drill.kind === 'income' ? OLIVE : drill.kind === 'expense' ? RUST : 'var(--sb-ink-3)' }} />
                {drill.kind === 'income' ? 'Income' : drill.kind === 'expense' ? 'Spending' : 'In and out'}
              </span>
              <button onClick={() => setDrill(null)} title="Close"
                style={{
                  marginLeft: 'auto', width: 30, height: 30, borderRadius: 'var(--sb-r-pill)', padding: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-3)', cursor: 'pointer',
                }}><X size={ICON.sm} /></button>
            </div>

            <div style={{ flexShrink: 0 }}>
              <div style={{ fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h2)', fontWeight: 600, letterSpacing: '-0.03em', color: 'var(--sb-ink-1)' }}>
                {/* The label carries the year, so a span has to replace it —
                    "School · 2026" over five years of entries is the panel
                    lying about what you are looking at. */}
                {byYear.length > 1
                  ? `${drill.label.replace(/ · \d{4}$/, '')} · ${byYear[0][0]}–${byYear[byYear.length - 1][0]}`
                  : drill.label}
              </div>
              <div style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', marginTop: 3 }}>
                {loadingSpan ? 'reading the other years…' : <>
                  {drillTx.length} {drillTx.length === 1 ? 'entry' : 'entries'} ·{' '}
                  {acct(drillTx.reduce((n, t) => {
                    const v = toBase(Math.abs(t.amount), t.currency, base) ?? 0
                    return n + (t.type === 'income' ? v : -v)
                  }, 0), { currency: base })}
                </>}
              </div>

              {/* How far back to look. The store holds one year on purpose, so
                  this asks the ledger directly and keeps the answer here —
                  nothing else on the screen changes. */}
              {drill.ids && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.1em', color: 'var(--sb-ink-4)' }}>HOW FAR BACK</span>
                  {([[1, 'This year'], [3, '3 years'], [5, '5 years'], [Infinity, 'All']] as const).map(([n, label]) => {
                    const on = span === n
                    const reach = n === Infinity ? bounds : { first: year - Number(n) + 1, last: year }
                    return (
                      <button key={String(n)} onClick={() => setSpan(n as number)}
                        title={n === 1 ? `Only ${year}`
                          : reach ? `${reach.first} to ${reach.last}` : 'every year in the ledger'}
                        style={{
                          height: 24, padding: '0 9px', borderRadius: 'var(--sb-r-pill)', cursor: 'pointer',
                          background: on ? 'var(--sb-ink-1)' : 'var(--sb-card)',
                          border: `var(--sb-border-width) solid ${on ? 'var(--sb-ink-1)' : 'var(--sb-border)'}`,
                          color: on ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-3)',
                          fontFamily: 'inherit', fontSize: 'var(--sb-t-micro)', fontWeight: 600,
                        }}>{label}</button>
                    )
                  })}
                </div>
              )}

              {/* Year by year, because four hundred entries do not answer
                  "is this getting worse" and six figures in a column do. */}
              {byYear.length > 1 && (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {(() => {
                    const most = Math.max(...byYear.map(([, v]) => Math.abs(v)), 1)
                    return byYear.map(([y, v]) => (
                      <div key={y} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--sb-t-meta)' }}>
                        <span style={{ width: 34, flexShrink: 0, fontFamily: 'var(--sb-font-num)', color: 'var(--sb-ink-3)' }}>{y}</span>
                        <span style={{ flex: 1, height: 6, borderRadius: 'var(--sb-r-pill)', background: 'var(--sb-hairline)', overflow: 'hidden' }}>
                          <span style={{
                            display: 'block', height: '100%', width: `${(Math.abs(v) / most) * 100}%`,
                            background: v >= 0 ? OLIVE : RUST, borderRadius: 'var(--sb-r-pill)',
                          }} />
                        </span>
                        <span style={{
                          flexShrink: 0, fontFamily: 'var(--sb-font-num)', fontVariantNumeric: 'tabular-nums',
                          color: v >= 0 ? OLIVE : RUST, fontWeight: 600,
                        }}>{acct(v, { currency: base })}</span>
                      </div>
                    ))
                  })()}
                </div>
              )}
            </div>

            <div style={{ height: 1, background: 'var(--sb-hairline)', margin: '14px 0 2px' }} />

            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', margin: '0 -2px', padding: '0 2px' }}>
              {drillTx.length === 0 && (
                <div style={{ fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-4)', textAlign: 'center', padding: '34px 0' }}>
                  Nothing behind this figure any more
                </div>
              )}
              {drillTx.map(tx => {
                const cat = categories.find(c => c.id === tx.categoryId)
                return (
                  <TxRow
                    key={tx.id}
                    icon={cat?.icon}
                    tone={cat?.color ?? (tx.type === 'income' ? 'var(--sb-positive)' : 'var(--sb-negative)')}
                    title={tx.payee?.trim() || cat?.name || 'Entry'}
                    marks={<>
                      <DuplicateMark scope={dupes.get(tx.id)} />
                      <BudgetMark on={isBudgetEntry(tx)} />
                    </>}
                    meta={<>
                      <span style={{ flexShrink: 0 }}>{txDate(tx.date)}</span>
                      {cat && tx.payee?.trim() && <span style={{ flexShrink: 0 }}>· {cat.name}</span>}
                      {tx.note?.trim() && (
                        <span title={tx.note.trim()} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          ({tx.note.trim()})
                        </span>
                      )}
                    </>}
                    type={tx.type === 'income' ? 'income' : tx.type === 'transfer' ? 'transfer' : 'expense'}
                    amount={tx.amount}
                    currency={tx.currency}
                    unpaid={isUnpaid(tx)}
                    hoverTitle={isUnpaid(tx) ? UNPAID_TITLE : 'Open this entry'}
                    onClick={() => setOpenTx(tx)}
                    trailing={
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          if (!window.confirm(`Delete ${tx.payee?.trim() || 'this entry'} of ${acct(Math.abs(tx.amount), { currency: tx.currency })}?`)) return
                          void removeTransaction(tx.id)
                        }}
                        title="Delete this entry"
                        style={{
                          width: 28, height: 28, borderRadius: 'var(--sb-r-pill)', padding: 0, flexShrink: 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-4)', cursor: 'pointer',
                        }}><Trash2 size={ICON.sm} /></button>
                    }
                  />
                )
              })}
            </div>

            <div style={{ height: 1, background: 'var(--sb-hairline)', margin: '14px 0' }} />

            {/* One more of the same thing, already knowing where it goes.
                The assistant's floating button is fixed to the viewport and
                lands on this corner, so the row keeps it clear. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingRight: 56 }}>
              <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)' }}>
                {addTarget
                  ? `New entries land in ${addTarget.name}${drill.month === null ? '' : `, ${MONTHS_SHORT[drill.month]}`}`
                  : 'Pick the category on the entry itself'}
              </span>
              <span style={{ flex: 1 }} />
              <Button variant="accent" onClick={() => setAdding(true)}>
                <Plus size={ICON.sm} /> Add an entry
              </Button>
            </div>
            </>)}
        </aside>
      )}
      </div>

      {editing && (
        <TransactionModal
          transaction={editing}
          accounts={accounts}
          categories={categories}
          history={transactions}
          onSave={tx => { void upsertTransaction(tx); setEditing(null) }}
          onDelete={id => { void removeTransaction(id); setEditing(null) }}
          onClose={() => setEditing(null)}
        />
      )}

    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────

function SectionHeader({ label, colCount: _colCount, colWidth, nameWidth: _nameWidth, monthTotals, rowTotal, out, onDrill }: {
  label: string; colCount: number; colWidth: number; nameWidth: number
  monthTotals: number[]; rowTotal: number; out?: boolean
  onDrill: (label: string, month: number | null) => void
}) {
  const f = out ? fmtOut : fmt
  return (
    <tr style={{ background: 'var(--sb-hairline)', borderTop: 'var(--sb-border-width) solid var(--sb-border)', borderBottom: 'var(--sb-border-width) solid var(--sb-border)' }}>
      <td style={{ padding: '5px 14px', position: 'sticky', left: 0, background: 'var(--sb-hairline)', zIndex: 2 }}>
        <span style={{ fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.1em', color: 'var(--sb-ink-3)' }}>{label}</span>
      </td>
      {monthTotals.map((v, i) => (
        <td key={i}
          onClick={v === 0 ? undefined : () => onDrill(`${label} · ${MONTHS_SHORT[i]}`, i)}
          style={{ width: colWidth, textAlign: 'right', padding: '5px 10px', fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-meta)', color: v === 0 ? 'var(--sb-border)' : 'var(--sb-ink-3)', fontVariantNumeric: 'tabular-nums', cursor: v === 0 ? 'default' : 'pointer' }}>
          {f(v)}
        </td>
      ))}
      <td
        onClick={rowTotal === 0 ? undefined : () => onDrill(`${label} · the year`, null)}
        style={{ width: 100, textAlign: 'right', padding: '5px 14px', fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-meta)', fontWeight: 700, color: 'var(--sb-ink-3)', fontVariantNumeric: 'tabular-nums', cursor: rowTotal === 0 ? 'default' : 'pointer' }}>
        {f(rowTotal)}
      </td>
    </tr>
  )
}

function TotalRow({ label, months, total, sign, COL_W, NAME_W: _NAME_W, onDrill }: {
  label: string; months: number[]; total: number; sign: 1 | -1
  COL_W: number; NAME_W: number
  onDrill: (label: string, month: number | null) => void
}) {
  const col = sign === 1 ? OLIVE : RUST
  return (
    <tr style={{ background: 'var(--sb-page)', borderTop: 'var(--sb-border-emphasis) solid var(--sb-border)', borderBottom: 'var(--sb-border-emphasis) solid var(--sb-border)' }}>
      <td style={{ padding: '0 14px', height: 38, position: 'sticky', left: 0, background: 'var(--sb-page)', zIndex: 2 }}>
        <span style={{ fontSize: 'var(--sb-t-body-s)', fontWeight: 700, color: 'var(--sb-ink-1)' }}>{label}</span>
      </td>
      {months.map((v, mi) => (
        <td key={mi}
          onClick={v === 0 ? undefined : () => onDrill(`${label} · ${MONTHS_SHORT[mi]}`, mi)}
          style={{ width: COL_W, minWidth: COL_W, textAlign: 'right', padding: '0 10px', fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-label)', fontWeight: 700, color: v === 0 ? 'var(--sb-border)' : col, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', cursor: v === 0 ? 'default' : 'pointer' }}>
          {sign === 1 ? fmt(v) : fmtOut(v)}
        </td>
      ))}
      <td
        onClick={total === 0 ? undefined : () => onDrill(`${label} · the year`, null)}
        style={{ width: 100, textAlign: 'right', padding: '0 14px', fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-label)', fontWeight: 700, color: total === 0 ? 'var(--sb-border)' : col, fontVariantNumeric: 'tabular-nums', cursor: total === 0 ? 'default' : 'pointer' }}>
        {sign === 1 ? fmt(total) : fmtOut(total)}
      </td>
    </tr>
  )
}

function NetRow({ label, months, total, COL_W, NAME_W: _NAME_W2, onDrill }: {
  label: string; months: number[]; total: number; COL_W: number; NAME_W: number
  onDrill: (label: string, month: number | null) => void
}) {
  return (
    <tr style={{ background: 'var(--sb-header)', borderBottom: 'var(--sb-border-width) solid var(--sb-border)' }}>
      <td style={{ padding: '0 14px', height: 38, position: 'sticky', left: 0, background: 'var(--sb-header)', zIndex: 2 }}>
        <span style={{ fontSize: 'var(--sb-t-body-s)', fontWeight: 700, color: 'var(--sb-ink-1)' }}>{label}</span>
      </td>
      {months.map((v, mi) => (
        <td key={mi}
          onClick={v === 0 ? undefined : () => onDrill(`${label} · ${MONTHS_SHORT[mi]}`, mi)}
          style={{ width: COL_W, minWidth: COL_W, textAlign: 'right', padding: '0 10px', fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-label)', fontWeight: 700, color: v === 0 ? 'var(--sb-ink-4)' : v > 0 ? OLIVE : RUST, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', cursor: v === 0 ? 'default' : 'pointer' }}>
          {fmt(v)}
        </td>
      ))}
      <td
        onClick={total === 0 ? undefined : () => onDrill(`${label} · the year`, null)}
        style={{ width: 100, textAlign: 'right', padding: '0 14px', fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-label)', fontWeight: 700, color: total === 0 ? 'var(--sb-ink-4)' : total > 0 ? OLIVE : RUST, fontVariantNumeric: 'tabular-nums', cursor: total === 0 ? 'default' : 'pointer' }}>
        {fmt(total)}
      </td>
    </tr>
  )
}

function CumulativeRow({ months, COL_W, NAME_W: _NAME_W3 }: { months: number[]; COL_W: number; NAME_W: number }) {
  return (
    <tr style={{ background: 'var(--sb-ink-1)', borderBottom: 'var(--sb-border-width) solid var(--sb-ink-1)' }}>
      <td style={{ padding: '0 14px', height: 40, position: 'sticky', left: 0, background: 'var(--sb-ink-1)', zIndex: 2 }}>
        <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 700, letterSpacing: '0.1em', color: 'var(--sb-ink-4)' }}>CUMULATIVE CASH</span>
      </td>
      {months.map((v, mi) => (
        <td key={mi} style={{ width: COL_W, minWidth: COL_W, textAlign: 'right', padding: '0 10px', fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-body-s)', fontWeight: 700, color: v === 0 ? 'var(--sb-ink-2)' : v > 0 ? 'var(--sb-positive-tint)' : 'var(--sb-negative)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {fmt(v)}
        </td>
      ))}
      <td style={{ width: 100, textAlign: 'right', padding: '0 14px', color: 'var(--sb-ink-2)', fontSize: 'var(--sb-t-body-s)' }}>
        YTD
      </td>
    </tr>
  )
}

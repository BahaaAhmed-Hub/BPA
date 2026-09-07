import { useState, useMemo, useRef, useEffect } from 'react'
import { CalendarClock } from 'lucide-react'
import {
  DndContext, pointerWithin, PointerSensor, TouchSensor, useSensor, useSensors,
  useDraggable, useDroppable, DragOverlay, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { useFinanceStore } from '../financeStore'
import { CategoryModal } from '../modals/CategoryModal'
import { CategoryGlyph } from '../components/CategoryGlyph'
import { suggestIcon, isPlaceholderIcon, isLucideIcon } from '../categoryIcons'
import { toBase, rateFor, currenciesNeedingRates } from '../fx'
import { useUIStore } from '@/store/uiStore'
import {
  BudgetRuleModal, defaultRule, monthlyAmount, activeIn, ordinal, type BudgetRule,
} from '../modals/BudgetRuleModal'
import type { Category, Transaction } from '../types'
import { acct } from '../format'
import { findDuplicates } from '../duplicates'
import { DuplicateMark } from '../components/DuplicateMark'
import { BudgetMark } from '../components/BudgetMark'
import { isBudgetEntry } from '../budgetEntries'
import { isUnpaid, unpaidRow, settled, whenPaid, UNPAID_TITLE } from '../unpaid'

// ─── 16G · Budget Builder ─────────────────────────────────────────────────────
// Categories tree with budget rules: amount, frequency, roll unspent,
// warn at 80%, auto-raise with inflation, guilt-free flag

const OLIVE = '#0C8140'
const RUST  = '#C62828'
const AMBER = '#F5D14E'

// ─── A ring that says how much of an envelope is gone ─────────────────────────
// The reference draws every category as a circle whose rim fills as it is
// spent. It reads at a glance in a way a row of bars does not: you see which
// envelopes are nearly empty without reading a single number.

function Ring({ pct, prevPct, color, over, budgeted, size = 58, children }: {
  pct: number
  /** Last month in the same envelope, drawn inside this month's rim. Given, the
   *  ring answers "worse than last month?" as well as "over?" — which is the
   *  question a limit alone cannot answer. */
  prevPct?: number
  color: string; over?: boolean; budgeted?: boolean; size?: number; children: React.ReactNode
}) {
  const stroke = 3.5
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const filled = Math.max(0, Math.min(1, pct))
  return (
    <span style={{ position: 'relative', width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg width={size} height={size} style={{ position: 'absolute', inset: 0 }}>
        {/* The rim itself says whether anything was ever set here: a solid
            track is an envelope with a budget, a broken one is a category
            that has never been given a limit to be measured against. */}
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={budgeted ? '#EDE7D9' : '#DCD3BF'}
          strokeWidth={budgeted ? stroke : 1.5}
          strokeDasharray={budgeted ? undefined : '3 4'}
          strokeLinecap="round" />
        {filled > 0 && (
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke={color} strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - filled)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
        {over && (
          // Past the budget the rim is full and cannot say more, so say it again
          // outside it rather than losing the fact.
          <circle cx={size / 2} cy={size / 2} r={r + 3.5} fill="none" stroke={color} strokeWidth={1} opacity={0.45} />
        )}
        {prevPct !== undefined && (
          <>
            <circle
              cx={size / 2} cy={size / 2} r={r - stroke - 1.5} fill="none"
              stroke="#EDE7D9" strokeWidth={2} />
            {prevPct > 0 && (
              <circle
                cx={size / 2} cy={size / 2} r={r - stroke - 1.5} fill="none"
                stroke="#B5AC98" strokeWidth={2} strokeLinecap="round"
                strokeDasharray={2 * Math.PI * (r - stroke - 1.5)}
                strokeDashoffset={2 * Math.PI * (r - stroke - 1.5) * (1 - Math.max(0, Math.min(1, prevPct)))}
                transform={`rotate(-90 ${size / 2} ${size / 2})`} />
            )}
          </>
        )}
      </svg>
      <span style={{
        width: size - (prevPct !== undefined ? 22 : 14), height: size - (prevPct !== undefined ? 22 : 14),
        borderRadius: '50%', overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#FCFAF4', fontSize: 20, lineHeight: 1,
      }}>{children}</span>
    </span>
  )
}


// ─── The last seven days, as a line ──────────────────────────────────────────
// A dial says how much of the month is gone. It says nothing about whether the
// spending is slowing down or running away, which is the thing you would act
// on. Seven points is enough to see that and small enough to sit under a
// figure. A flat line is a week with nothing spent, not a missing chart.
function Spark({ days, color, width = 76, height = 16 }: {
  days: number[]; color: string; width?: number; height?: number
}) {
  if (days.length < 2) return null
  const peak = Math.max(...days)
  const step = width / (days.length - 1)
  const y = (v: number) => height - 2 - (peak > 0 ? (v / peak) * (height - 4) : 0)
  const d = days.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
  const spent = peak > 0
  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}
      aria-hidden focusable="false">
      <line x1={0} y1={height - 1} x2={width} y2={height - 1} stroke="#EDE7D9" strokeWidth={1} />
      <path d={d} fill="none" stroke={spent ? color : '#D8CFB8'} strokeWidth={1.6}
        strokeLinecap="round" strokeLinejoin="round" opacity={spent ? 0.85 : 0.6} />
      {spent && (
        <circle cx={width} cy={y(days[days.length - 1])} r={2} fill={color} />
      )}
    </svg>
  )
}

/** "a fifth more than last month", or nothing when there is nothing to compare. */
function versusLast(actual: number, prev: number): { text: string; worse: boolean } | null {
  if (prev <= 0) return actual > 0 ? { text: 'nothing last month', worse: true } : null
  const change = (actual - prev) / prev
  if (Math.abs(change) < 0.02) return { text: 'as last month', worse: false }
  const pc = Math.round(Math.abs(change) * 100)
  return { text: `${pc}% ${change > 0 ? 'more' : 'less'} than last month`, worse: change > 0 }
}

const MONTH_SHORT = ['J','F','M','A','M','J','J','A','S','O','N','D']

function money(v: number, cur: string) {
  // Accounting convention, like everywhere else: a negative is bracketed and
  // drops its minus — (EGP 85,875), never −EGP 85,875.
  return acct(v, { currency: cur })
}


function Legend({ swatch, label, line }: { swatch: string; label: string; line?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: '#6C6553' }}>
      <span style={{
        width: 10, height: line ? 1 : 8, borderRadius: line ? 0 : 2,
        background: swatch, flexShrink: 0,
      }} />
      {label}
    </span>
  )
}

/** A category you can pick up. The whole envelope is the handle: a tap still
 *  opens it, because a finger has to hold before dnd-kit calls it a drag. */
function Draggable({ id, disabled, grow, children }: {
  id: string; disabled?: boolean
  /** Fill the space its parent gave it, rather than hugging what is inside —
   *  the mosaic's child strip divides a fixed width between its parts. */
  grow?: boolean
  children: (dragging: boolean) => React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, disabled })
  return (
    <span ref={setNodeRef} {...attributes} {...listeners}
      style={{
        display: 'flex', touchAction: 'none', opacity: isDragging ? 0.4 : 1,
        ...(grow ? { flex: 1, minWidth: 0 } : {}),
      }}>
      {children(isDragging)}
    </span>
  )
}

/** Somewhere to let go. */
function DropZone({ id, disabled, grow, children }: {
  id: string; disabled?: boolean
  /** Take the width it was given, for the views whose rows span the card. */
  grow?: boolean
  children: (over: boolean) => React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled })
  return (
    <span ref={setNodeRef} style={{ display: 'flex', ...(grow ? { width: '100%' } : {}) }}>
      {children(isOver && !disabled)}
    </span>
  )
}

interface EnvelopeRow {
  cat: Category
  actual: number
  planned: number
  /** What this envelope is kept in, which need not be the app's default. */
  cur: string
  plannedFrom: 'own' | 'parts' | 'none'
  /** Converted into the base currency, or null when there is no rate. */
  actualBase: number | null
  plannedBase: number | null
  children: { cat: Category; planned: number; budgeted: boolean; actual: number; inEnvelope: number | null; cur: string }[]
  currencies: string[]
  /** The same envelope last month, for the styles that compare the two. */
  prev: number
  /** Spent on each of the last seven days, oldest first. */
  trend: number[]
}

// ─── Changing the view without leaving the page ──────────────────────────────
// Settings decides what the page opens in; this changes it for the question you
// are asking right now. Both write the same key and fire the same event, so
// whichever you touch, the other agrees — and the choice still follows you to
// your other devices.
const STYLE_PICKS: { id: EnvelopeStyle; label: string; hint: string; icon: React.ReactNode }[] = [
  {
    id: 'dial', label: 'Dial', hint: 'Dial + trend — this month, plus a seven-day line',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
        <path d="M4 17a8 8 0 1 1 16 0" /><path d="M12 17l4.5-4" />
      </svg>
    ),
  },
  {
    id: 'ring', label: 'Rings', hint: 'Double rings — this month against last',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
        <circle cx="12" cy="12" r="8.2" /><circle cx="12" cy="12" r="3.6" />
      </svg>
    ),
  },
  {
    id: 'slip', label: 'Slips', hint: 'Till slips — figures in one column',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
        <path d="M4 6h16M4 11h11M4 16h16M4 21h8" />
      </svg>
    ),
  },
  {
    id: 'mosaic', label: 'Mosaic', hint: 'Proportional mosaic — area is money',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <rect x="3" y="3" width="10" height="10" rx="1.5" />
        <rect x="15" y="3" width="6" height="6" rx="1.5" />
        <rect x="3" y="15" width="6" height="6" rx="1.5" />
        <rect x="11" y="11" width="10" height="10" rx="1.5" />
      </svg>
    ),
  },
]

function StylePicker({ value, onChange }: { value: EnvelopeStyle; onChange: (s: EnvelopeStyle) => void }) {
  return (
    <div role="group" aria-label="How to draw the envelopes"
      style={{ display: 'flex', alignItems: 'center', gap: 2, padding: 3, borderRadius: 999, background: '#EDE7D9' }}>
      {STYLE_PICKS.map(pick => {
        const on = value === pick.id
        return (
          <button key={pick.id} onClick={() => onChange(pick.id)} title={pick.hint} aria-pressed={on}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, height: 28, padding: '0 10px',
              borderRadius: 999, cursor: 'pointer', border: 'none', fontFamily: 'inherit',
              fontSize: 12, fontWeight: on ? 600 : 500,
              background: on ? '#FFFFFF' : 'transparent',
              color: on ? '#191712' : '#6C6553',
              boxShadow: on ? '0 1px 3px rgba(25,23,18,0.16)' : 'none',
            }}>
            {pick.icon}
            <span style={{ display: 'none' }} />
            {on && pick.label}
          </button>
        )
      })}
    </div>
  )
}

// ─── The four ways to look at an envelope ────────────────────────────────────
//
// Settings offers four and, until now, drew one. They are not decoration: each
// answers a different question, and which question you are asking changes month
// to month.
//
//   dial   — how much of the limit is gone, plus the last seven days, so you
//            can see whether it is slowing down or running away.
//   ring   — this month against last month, in two rings. "Over" is not the
//            only bad news; "worse than it was" is the one a limit cannot tell
//            you.
//   slip   — a till receipt. Monospace figures in one column, so comparing two
//            envelopes is one eye movement rather than two circles.
//   mosaic — area is money. The biggest box is the biggest spend, whatever it
//            was budgeted, and rust means it burst its envelope.
//
// All four keep everything that is not the picture: click to select, drag to
// re-parent, the day a bill leaves, the currency badge, the sub-categories.
export type EnvelopeStyle = 'dial' | 'mosaic' | 'slip' | 'ring'

export function loadEnvelopeStyle(): EnvelopeStyle {
  try {
    const v = localStorage.getItem('finance-envelope-style')
    return v === 'mosaic' || v === 'slip' || v === 'ring' ? v : 'dial'
  } catch { return 'dial' }
}

/** A budget's own currency badge, or a currency here that no rate could take
 *  into it. Same sentence in every view. */
function CurBadge({ mixed, cur, currency, offset }: {
  mixed: string[]; cur: string; currency: string; offset?: boolean
}) {
  if (mixed.length === 0) return null
  return (
    <span title={cur !== currency
      ? `This envelope is kept in ${cur}`
      : `Has ${mixed.join(', ')} here with no rate set, so it is not counted`}
      style={{
        ...(offset ? { position: 'absolute', bottom: -2, right: -4 } : {}),
        height: 14, padding: '0 4px', borderRadius: 999,
        background: '#FFFFFF', border: '1px solid #E8E1CE',
        fontSize: 8, fontWeight: 700, color: '#9B9180',
        display: 'flex', alignItems: 'center', flexShrink: 0,
      }}>{mixed[0]}</span>
  )
}

/** The day the money leaves, where there is one. */
function DueChip({ day }: { day: number | undefined }) {
  if (day == null) return null
  return (
    <span title={`The money leaves on the ${ordinal(day)}.`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 9.5, color: '#8A6D0B', whiteSpace: 'nowrap' }}>
      <CalendarClock size={9} strokeWidth={2.2} /> the {ordinal(day)}
    </span>
  )
}

// ─── Till slips ──────────────────────────────────────────────────────────────

function SlipRows({ rows, color, selectedId, onPick, rules, dragging, currency }: {
  rows: EnvelopeRow[]; color: string; selectedId: string | null
  onPick: (id: string) => void; rules: Record<string, BudgetRule>; dragging: string | null
  currency: string
}) {
  const MONO = 'JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace'
  const fig = (n: number) => acct(n)
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {rows.map(row => {
        const { cat, actual, planned, plannedFrom, cur, children } = row
        const budgeted = planned > 0
        const pct  = budgeted ? actual / planned : 0
        const over = budgeted && actual > planned
        const on   = selectedId === cat.id
        const mixed = cur !== currency ? [cur] : row.currencies
        return (
          <div key={cat.id}>
            <DropZone id={`in:${cat.id}`} disabled={!dragging || dragging === cat.id} grow>
              {isOver => (
                <Draggable id={cat.id} grow>
                  {() => (
                    <button onClick={() => onPick(cat.id)}
                      title={`${cat.name} — ${money(actual, cur)}${budgeted ? ` of ${money(planned, cur)}` : ' · no budget set'}`}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                        padding: '7px 8px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                        fontFamily: 'inherit', boxSizing: 'border-box',
                        background: isOver ? 'rgba(12,129,64,0.16)' : on ? 'rgba(245,209,78,0.20)' : 'transparent',
                        border: isOver ? '1px dashed #0C8140' : '1px solid transparent',
                        borderBottom: isOver ? '1px dashed #0C8140' : '1px solid #F4F0E4',
                      }}>
                      <CategoryGlyph icon={cat.icon} size={15} color={color} />
                      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: cat.name ? '#191712' : '#9B9180', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {cat.name || 'Untitled'}
                          </span>
                          <DueChip day={rules[cat.id]?.dueDay} />
                          <CurBadge mixed={mixed} cur={cur} currency={currency} />
                        </span>
                        {/* One thin rule under the name — a receipt does not
                            need a chart, only the proportion. */}
                        <span style={{ position: 'relative', height: 3, borderRadius: 2, background: budgeted ? '#EDE7D9' : 'transparent', border: budgeted ? 'none' : '1px dashed #E0D8C4', boxSizing: 'border-box' }}>
                          {budgeted && pct > 0 && (
                            <span style={{
                              position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 2,
                              width: `${Math.min(1, pct) * 100}%`, background: over ? RUST : color,
                            }} />
                          )}
                        </span>
                      </span>
                      {/* The figures, in one column, right aligned — which is
                          the whole point of this view. */}
                      <span style={{ fontFamily: MONO, fontSize: 11.5, fontVariantNumeric: 'tabular-nums', textAlign: 'right', flexShrink: 0, lineHeight: 1.45 }}>
                        <span style={{ display: 'block', fontWeight: 600, color: over ? RUST : '#191712' }}>{fig(actual)}</span>
                        {budgeted ? (
                          <span style={{ display: 'block', fontSize: 10.5, color: '#9B9180', borderBottom: plannedFrom === 'parts' ? '1px dotted #C5BCA8' : 'none' }}>
                            {fig(planned)}
                          </span>
                        ) : (
                          <span style={{ display: 'block', fontSize: 9.5, color: '#9B9180', fontFamily: 'inherit' }}>no budget</span>
                        )}
                      </span>
                    </button>
                  )}
                </Draggable>
              )}
            </DropZone>

            {children.map(child => {
              const limit = child.inEnvelope && child.inEnvelope > 0 ? child.inEnvelope : planned
              const cOver = limit > 0 && child.actual > limit
              return (
                <Draggable key={child.cat.id} id={child.cat.id} grow>
                  {() => (
                    <button onClick={() => onPick(child.cat.id)}
                      title={`${child.cat.name} — inside ${cat.name}. ${money(child.actual, cur)} spent this month.`}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                        padding: '4px 8px 4px 30px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                        fontFamily: 'inherit', boxSizing: 'border-box', border: '1px solid transparent',
                        background: selectedId === child.cat.id ? 'rgba(245,209,78,0.28)' : 'transparent',
                      }}>
                      <CategoryGlyph icon={child.cat.icon} size={12} />
                      <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: '#6C6553', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {child.cat.name}
                      </span>
                      <DueChip day={rules[child.cat.id]?.dueDay} />
                      <span style={{ fontFamily: MONO, fontSize: 10.5, fontVariantNumeric: 'tabular-nums', color: cOver ? RUST : '#6C6553', flexShrink: 0 }}>
                        {fig(child.actual)}{child.budgeted ? ` / ${fig(child.inEnvelope ?? child.planned)}` : ''}
                      </span>
                    </button>
                  )}
                </Draggable>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

// ─── Proportional mosaic ─────────────────────────────────────────────────────
//
// A treemap, as the artboard draws it: the card is tiled edge to edge, and the
// share of it a category takes **is** the share of the money it took. Squares
// in a row could not do that — they leave gaps, and a gap is space that means
// nothing. The squarified layout keeps cells close to square so their areas
// stay comparable by eye, which is the whole reason for drawing them.
//
// Inside each cell, the envelope fills from the bottom as its budget is spent —
// so a big cell that is nearly empty (a lot of money, well within its limit)
// reads differently from a big cell brimming over. Past the limit the cell is
// rust and says "burst".

interface Tile { id: string; area: number }
interface Placed { id: string; x: number; y: number; w: number; h: number }

/** Squarified treemap (Bruls, Huizing & van Wijk). Lays the biggest first,
 *  filling whichever way keeps the cells nearest to square. */
function squarify(items: Tile[], W: number, H: number): Placed[] {
  const out: Placed[] = []
  if (W <= 0 || H <= 0 || items.length === 0) return out
  const total = items.reduce((s, i) => s + i.area, 0) || 1
  const rest = items
    .map(i => ({ id: i.id, area: (i.area / total) * W * H }))
    .sort((a, b) => b.area - a.area)

  let x = 0, y = 0, w = W, h = H
  let row: { id: string; area: number }[] = []

  const worst = (r: { area: number }[], side: number) => {
    if (r.length === 0 || side <= 0) return Infinity
    const sum = r.reduce((s, i) => s + i.area, 0)
    if (sum <= 0) return Infinity
    const mx = Math.max(...r.map(i => i.area))
    const mn = Math.min(...r.map(i => i.area))
    return Math.max((side * side * mx) / (sum * sum), (sum * sum) / (side * side * mn))
  }

  const place = (r: { id: string; area: number }[]) => {
    const sum = r.reduce((s, i) => s + i.area, 0)
    if (sum <= 0) return
    if (w >= h) {
      const colW = sum / h
      let cy = y
      for (const it of r) { const ih = it.area / colW; out.push({ id: it.id, x, y: cy, w: colW, h: ih }); cy += ih }
      x += colW; w -= colW
    } else {
      const rowH = sum / w
      let cx = x
      for (const it of r) { const iw = it.area / rowH; out.push({ id: it.id, x: cx, y, w: iw, h: rowH }); cx += iw }
      y += rowH; h -= rowH
    }
  }

  while (rest.length > 0) {
    const next = rest[0]
    const side = Math.min(w, h)
    if (row.length === 0 || worst([...row, next], side) <= worst(row, side)) {
      row.push(next); rest.shift()
    } else {
      place(row); row = []
    }
  }
  if (row.length > 0) place(row)
  return out
}

/** The card's own width, so the tiling has real proportions to work with. */
function useMeasuredWidth() {
  const ref = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.getBoundingClientRect().width)
    const ro = new ResizeObserver(entries => setWidth(entries[0].contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

function MosaicBoxes({ rows, color, selectedId, onPick, rules, dragging, currency }: {
  rows: EnvelopeRow[]; color: string; selectedId: string | null
  onPick: (id: string) => void; rules: Record<string, BudgetRule>; dragging: string | null
  currency: string
}) {
  const [ref, width] = useMeasuredWidth()
  const spend = rows.reduce((s, r) => s + Math.max(0, r.actual), 0)
  // An envelope with nothing spent still exists and still has to be clickable,
  // so it takes a small floor rather than no area at all.
  const floor = Math.max(spend * 0.02, 1)
  const tiles: Tile[] = rows.map(r => ({ id: r.cat.id, area: Math.max(r.actual, floor) }))
  // Tall enough for the biggest cell to hold its figures, short enough to see
  // the whole month without scrolling.
  const height = Math.max(240, Math.min(430, Math.round(width * 0.46)))
  const placed = new Map(squarify(tiles, width, height).map(p => [p.id, p]))
  const byId = new Map(rows.map(r => [r.cat.id, r]))

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%', height, minHeight: 240 }}>
      {width > 0 && [...placed.entries()].map(([id, box]) => {
        const row = byId.get(id)
        if (!row) return null
        const { cat, actual, planned, cur, children } = row
        const budgeted = planned > 0
        const over  = budgeted && actual > planned
        const spent = actual > 0
        const fill  = budgeted ? Math.max(0, Math.min(1, actual / planned)) : 0
        const on    = selectedId === cat.id
        // What fits. A sliver gets its glyph and its tooltip and nothing else,
        // rather than three lines of clipped text.
        const roomy  = box.w >= 118 && box.h >= 96
        const middle = box.w >= 78  && box.h >= 58
        const childSpend = children.reduce((n, c) => n + Math.max(0, c.actual), 0)
        const showChildren = children.length > 0 && box.h >= 104 && box.w >= 96
        return (
          <span key={id} style={{
            position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h,
            padding: 3, boxSizing: 'border-box', display: 'flex',
          }}>
            <DropZone id={`in:${cat.id}`} disabled={!dragging || dragging === cat.id} grow>
              {isOver => (
                <Draggable id={cat.id} grow>
                  {() => (
                    <button onClick={() => onPick(cat.id)}
                      title={`${cat.name} — ${money(actual, cur)}${
                        budgeted ? ` of ${money(planned, cur)}${over ? ', over it' : ` · ${Math.round(fill * 100)}% of it gone`}`
                                 : ' · no budget set'}`}
                      style={{
                        position: 'relative', overflow: 'hidden',
                        width: '100%', height: '100%', boxSizing: 'border-box',
                        borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                        padding: middle ? '9px 10px' : 5,
                        display: 'flex', flexDirection: 'column', gap: 3,
                        background: isOver ? 'rgba(12,129,64,0.16)' : over ? '#FAE3E3' : budgeted ? '#EDE7D9' : '#FAF7EC',
                        border: isOver ? '1px dashed #0C8140'
                          : over ? '1px solid rgba(163,28,28,0.55)'
                          : budgeted ? '1px solid #E4DCC6' : '1px dashed #DCD3BF',
                        outline: on ? '2px solid #F5D14E' : 'none', outlineOffset: -1,
                      }}>
                      {/* The envelope filling up, behind everything else. */}
                      {(fill > 0 || over) && (
                        <span aria-hidden style={{
                          position: 'absolute', left: 0, right: 0, bottom: 0,
                          height: `${(over ? 1 : fill) * 100}%`,
                          background: over ? 'rgba(163,28,28,0.42)' : 'rgba(245,209,78,0.72)',
                          pointerEvents: 'none',
                        }} />
                      )}

                      <span style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                        <CategoryGlyph icon={cat.icon} size={middle ? 14 : 12} color={over ? RUST : color} />
                        {middle && <CurBadge mixed={cur !== currency ? [cur] : row.currencies} cur={cur} currency={currency} />}
                      </span>

                      {middle && (
                        <span style={{
                          position: 'relative', fontSize: roomy ? 11.5 : 10.5, fontWeight: 600, color: '#191712',
                          lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{cat.name || 'Untitled'}</span>
                      )}

                      <span style={{ flex: 1 }} />

                      {middle && (
                        <span style={{
                          position: 'relative', fontFamily: 'Outfit, sans-serif',
                          fontSize: roomy ? 16 : 12.5, fontWeight: 600,
                          color: over ? '#8E1B1B' : '#191712', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1,
                        }}>{acct(actual)}</span>
                      )}
                      {roomy && (
                        budgeted ? (
                          <span style={{ position: 'relative', fontSize: 10, color: over ? '#8E1B1B' : '#6C6553', fontVariantNumeric: 'tabular-nums' }}>
                            of {acct(planned)}{over ? ' · burst' : ''}
                          </span>
                        ) : spent ? (
                          <span style={{ position: 'relative', fontSize: 10, color: '#9B9180' }}>no budget</span>
                        ) : null
                      )}
                      {roomy && <span style={{ position: 'relative' }}><DueChip day={rules[cat.id]?.dueDay} /></span>}

                      {/* Its parts, along the bottom, split the same way. */}
                      {showChildren && (
                        <span style={{ position: 'relative', display: 'flex', gap: 2, marginTop: 4, height: 14 }}>
                          {children.map(child => {
                            const share = childSpend > 0 ? Math.max(0, child.actual) / childSpend : 1 / children.length
                            const limit = child.inEnvelope && child.inEnvelope > 0 ? child.inEnvelope : planned
                            const cOver = limit > 0 && child.actual > limit
                            return (
                              <span key={child.cat.id}
                                style={{ flex: `${Math.max(share, 0.06)} 1 0`, minWidth: 5, display: 'flex' }}>
                                <Draggable id={child.cat.id} grow>
                                  {() => (
                                    <button onClick={e => { e.stopPropagation(); onPick(child.cat.id) }}
                                      title={`${child.cat.name} — inside ${cat.name}, ${money(child.actual, cur)} this month`}
                                      style={{
                                        width: '100%', height: 14, borderRadius: 4, cursor: 'pointer',
                                        padding: 0, border: 'none',
                                        background: cOver ? 'rgba(163,28,28,0.5)'
                                          : child.actual > 0 ? 'rgba(25,23,18,0.16)' : 'rgba(25,23,18,0.07)',
                                        outline: selectedId === child.cat.id ? '2px solid #F5D14E' : 'none',
                                      }} />
                                  )}
                                </Draggable>
                              </span>
                            )
                          })}
                        </span>
                      )}
                    </button>
                  )}
                </Draggable>
              )}
            </DropZone>
          </span>
        )
      })}
    </div>
  )
}

function EnvelopeGroup({ title, rows, color, selectedId, onPick, currency, empty, dragging, rules, style }: {
  title: string
  rows: EnvelopeRow[]
  /** Which of the four views Settings has chosen. */
  style: EnvelopeStyle
  /** Only for the day a budget carries; everything else is on the row. */
  rules: Record<string, BudgetRule>
  color: string
  selectedId: string | null
  onPick: (id: string) => void
  currency: string
  empty: string
  /** The id of whatever is currently being dragged, or null. */
  dragging: string | null
}) {
  const total = rows.reduce((s, r) => s + (r.actualBase ?? 0), 0)
  // Envelopes in a currency with no rate: counted, named, never folded in.
  const stranded = [...new Set(rows.filter(r => r.actualBase === null).map(r => r.cur))]
  // Counting the children too: a sub-category with a budget is an envelope
  // like any other, it just lives inside one.
  const all       = rows.length + rows.reduce((n, r) => n + r.children.length, 0)
  const withMoney = rows.filter(r => r.plannedFrom === 'own').length
                  + rows.reduce((n, r) => n + r.children.filter(c => c.budgeted).length, 0)
  return (
    <div style={{ background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 14, boxShadow: '0 1px 3px rgba(25,23,18,0.06)', padding: '15px 18px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 14 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', color: '#6C6553' }}>{title.toUpperCase()}</span>
        {all > 0 && (
          <span style={{ fontSize: 10.5, color: withMoney === all ? '#0C8140' : '#9B9180' }}>
            {withMoney} of {all} budgeted
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 14, fontWeight: 600, color, fontVariantNumeric: 'tabular-nums' }}>
            {money(total, currency)}
          </span>
          {stranded.length > 0 && (
            <span style={{ fontSize: 10, color: '#8A6D0B' }}>
              {stranded.join(' and ')} not added in — no rate set
            </span>
          )}
        </span>
      </div>

      {rows.length === 0 ? (
        <div style={{ fontSize: 11.5, color: '#9B9180', lineHeight: 1.6 }}>{empty}</div>
      ) : style === 'slip' ? (
        <SlipRows rows={rows} color={color} selectedId={selectedId} onPick={onPick}
          rules={rules} dragging={dragging} currency={currency} />
      ) : style === 'mosaic' ? (
        <MosaicBoxes rows={rows} color={color} selectedId={selectedId} onPick={onPick}
          rules={rules} dragging={dragging} currency={currency} />
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '18px 14px' }}>
          {rows.map(({ cat, actual, planned, plannedFrom, cur, children, currencies, prev, trend }) => {
            // Spending with nothing set is not a full envelope. This drew a
            // complete ring for it, which reads as "at its limit" — the one
            // thing it cannot be when no limit exists.
            const budgeted = planned > 0
            const pct = budgeted ? actual / planned : 0
            // Not `over`: the drop zone's render prop is called that, and this
            // one would quietly lose to it inside the ring.
            const spentOut = planned > 0 && actual > planned
            // A budget with a day on it is a bill: say which day, under the
            // figure, where the eye already is.
            const dueDay = rules[cat.id]?.dueDay
            const on   = selectedId === cat.id
            // The badge says what this envelope is kept in when that is not
            // the usual thing, and otherwise names money here that no rate
            // could convert.
            const mixed = cur !== currency ? [cur] : currencies
            return (
              <span key={cat.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, width: 104 }}>
              <DropZone id={`in:${cat.id}`} disabled={!dragging || dragging === cat.id}>
                {over => (
              <Draggable id={cat.id}>
                {() => (
              <button onClick={() => onPick(cat.id)}
                title={`${cat.name} — ${money(actual, cur)}${
                  planned > 0
                    ? ` of ${money(planned, cur)}${plannedFrom === 'parts' ? ', added up from its sub-categories' : ''}`
                    : ' · no budget set'}${dueDay ? ` · paid on the ${ordinal(dueDay)}` : ''}`}
                style={{
                  width: 104, padding: '8px 2px 6px', borderRadius: 12,
                  background: over ? 'rgba(12,129,64,0.16)' : on ? 'rgba(245,209,78,0.20)' : 'transparent',
                  border: over ? '1px dashed #0C8140' : '1px solid transparent',
                  fontFamily: 'inherit', cursor: 'pointer', boxSizing: 'border-box',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7,
                }}>
                <span style={{ position: 'relative', display: 'flex' }}>
                  <Ring pct={pct} color={color} over={spentOut} budgeted={budgeted}
                    prevPct={style === 'ring' ? (planned > 0 ? prev / planned : 0) : undefined}
                    size={style === 'ring' ? 64 : 58}>
                    <CategoryGlyph icon={cat.icon} size={21} color={color} />
                  </Ring>
                  {mixed.length > 0 && (
                    // Amounts are added up as they were entered; there are no
                    // exchange rates in here. Say so rather than quietly
                    // presenting a total that mixes currencies.
                    <span title={cur !== currency
                      ? `This envelope is kept in ${cur}`
                      : `Has ${mixed.join(', ')} here with no rate set, so it is not counted`}
                      style={{
                        position: 'absolute', bottom: -2, right: -4, height: 14, padding: '0 4px',
                        borderRadius: 999, background: '#FFFFFF', border: '1px solid #E8E1CE',
                        fontSize: 8, fontWeight: 700, color: '#9B9180', display: 'flex', alignItems: 'center',
                      }}>{mixed[0]}</span>
                  )}
                </span>
                <span style={{ fontSize: 11, fontWeight: 600, color: cat.name ? '#191712' : '#9B9180', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {cat.name || 'Untitled'}
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.3 }}>
                  <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 12, fontWeight: 600, color: spentOut ? color : '#191712', fontVariantNumeric: 'tabular-nums' }}>
                    {acct(actual)}
                  </span>
                  {budgeted ? (
                    <span style={{
                      fontSize: 10, color: '#9B9180', fontVariantNumeric: 'tabular-nums',
                      // Dotted underline where the figure is the sum of its
                      // parts rather than something set on this category.
                      borderBottom: plannedFrom === 'parts' ? '1px dotted #C5BCA8' : 'none',
                    }}>
                      {acct(planned)}
                    </span>
                  ) : (
                    // Not a fact about the category — something to go and do.
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', height: 16, padding: '0 7px',
                      borderRadius: 999, border: '1px dashed #D8CFB8', color: '#9B9180',
                      fontSize: 9.5, whiteSpace: 'nowrap',
                    }}>set a budget</span>
                  )}
                  {style === 'dial' && (
                    <span style={{ marginTop: 3 }} title="What was spent here on each of the last seven days">
                      <Spark days={trend} color={color} />
                    </span>
                  )}
                  {style === 'ring' && (() => {
                    const said = versusLast(actual, prev)
                    return said ? (
                      <span title={`${money(prev, cur)} last month`}
                        style={{ marginTop: 2, fontSize: 9.5, lineHeight: 1.3, textAlign: 'center', color: said.worse ? RUST : '#0C8140' }}>
                        {said.text}
                      </span>
                    ) : null
                  })()}
                  {dueDay != null && (
                    <span
                      title={`The money leaves on the ${ordinal(dueDay)}. A task is on the board for it.`}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 3, marginTop: 2,
                        fontSize: 9.5, color: '#8A6D0B', whiteSpace: 'nowrap',
                      }}>
                      <CalendarClock size={9} strokeWidth={2.2} /> the {ordinal(dueDay)}
                    </span>
                  )}
                </span>
              </button>
                )}
              </Draggable>
                )}
              </DropZone>

              {/* Its children, so the shape is visible and each one can be
                  dragged somewhere else — including out. */}
              {children.map(({ cat: sub, budgeted: subBudgeted, actual: subActual, inEnvelope: subPlanned }) => {
                // The pill fills as its money is spent, the way the ring above
                // it does — a list of names says which parts exist and nothing
                // about which of them the month has gone into.
                //
                // Against its own budget where it has one. Where it has not,
                // against the envelope it sits in: that is the limit its
                // spending actually comes out of, and a part with no budget
                // and no parent budget has nothing to be a fraction of, so it
                // stays as it was.
                const limit = subPlanned && subPlanned > 0 ? subPlanned : planned
                const subPct = limit > 0 ? subActual / limit : 0
                const filled = Math.max(0, Math.min(1, subPct))
                const subOver = limit > 0 && subActual > limit
                const spent = subActual > 0
                // No room for a chip on a 104px pill, so the day it is paid
                // on is in the title with everything else about it.
                const subDue = rules[sub.id]?.dueDay
                return (
                <Draggable key={sub.id} id={sub.id}>
                  {() => (
                    <button onClick={() => onPick(sub.id)}
                      title={`${sub.name} — inside ${cat.name}${subBudgeted ? '' : ', with no budget of its own'}${subDue ? `, paid on the ${ordinal(subDue)}` : ''}. ${
                        spent
                          ? `${money(subActual, cur)} spent this month${
                              limit > 0
                                ? ` — ${Math.round(subPct * 100)}% of ${money(limit, cur)}${subPlanned && subPlanned > 0 ? '' : ', the envelope it comes out of'}`
                                : ''}. `
                          : 'Nothing spent this month. '
                      }Click to edit it, or drag it out to stand on its own.`}
                      style={{
                        position: 'relative', overflow: 'hidden',
                        display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: 104,
                        height: 24, padding: '0 9px', borderRadius: 999, cursor: 'pointer',
                        background: selectedId === sub.id ? 'rgba(245,209,78,0.28)' : subBudgeted ? '#F4EFE1' : 'transparent',
                        // Same idea as the rings above: solid means a budget,
                        // broken means nothing has been set.
                        border: subBudgeted ? '1px solid #E4DCC6' : '1px dashed #DCD3BF',
                        color: subBudgeted || spent ? '#4A4438' : '#9B9180',
                        fontSize: 11, boxSizing: 'border-box', fontFamily: 'inherit',
                      }}>
                      {/* Behind the label, never over it. */}
                      {filled > 0 && (
                        <span aria-hidden style={{
                          position: 'absolute', left: 0, top: 0, bottom: 0,
                          width: `${filled * 100}%`, borderRadius: 999,
                          background: subOver ? 'rgba(198,40,40,0.22)' : 'rgba(245,209,78,0.42)',
                          pointerEvents: 'none',
                        }} />
                      )}
                      <span style={{ position: 'relative', display: 'flex', flexShrink: 0 }}><CategoryGlyph icon={sub.icon} size={12} /></span>
                      <span style={{ position: 'relative', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub.name}</span>
                    </button>
                  )}
                </Draggable>
                )
              })}
              </span>
            )
          })}

          {/* Only while something is in the air */}
          {/* One per group, and the id has to say which — two droppables with
              the same id means only one of them ever registers, and the drop
              silently goes nowhere. */}
          {dragging && (
            <DropZone id={`top-level:${title}`}>
              {over => (
                <span style={{
                  width: 104, minHeight: 84, borderRadius: 12, boxSizing: 'border-box',
                  border: `1px dashed ${over ? '#0C8140' : '#D8CFB8'}`,
                  background: over ? 'rgba(12,129,64,0.16)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: 8, fontSize: 10.5, color: over ? '#0C8140' : '#9B9180',
                  textAlign: 'center', lineHeight: 1.4,
                }}>
                  Drop here to stand on its own
                </span>
              )}
            </DropZone>
          )}
        </div>
      )}
    </div>
  )
}

function SummaryLine({ label, actual, planned, color, currency, strong }: {
  label: string; actual: number; planned: number; color: string; currency: string; strong?: boolean
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '11px 0', borderBottom: strong ? 'none' : '1px solid #F0EBDC' }}>
      <span style={{ fontSize: strong ? 12.5 : 11.5, fontWeight: strong ? 600 : 500, color: strong ? '#191712' : '#6C6553', letterSpacing: strong ? 0 : '0.02em' }}>
        {label}
      </span>
      <span style={{ flex: 1 }} />
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
        <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: strong ? 20 : 17, fontWeight: 600, letterSpacing: '-0.02em', color, fontVariantNumeric: 'tabular-nums' }}>
          {acct(actual)}
        </span>
        <span style={{ fontSize: 10.5, color: '#9B9180', fontVariantNumeric: 'tabular-nums' }}>
          of {money(planned, currency)}
        </span>
      </span>
    </div>
  )
}

export function BudgetScreen(_props?: any) {
  const setActiveModule = useUIStore(s => s.setActiveModule)
  // CategoryModal has existed, finished, since the module was written and was
  // never mounted anywhere — so there was no way to create a category at all,
  // which left this screen with nothing to configure and every transaction
  // uncategorised.
  const { categories, transactions, accounts, upsertCategory, removeCategory } = useFinanceStore()
  const year    = useFinanceStore(s => s.currentYear)
  const setYear = useFinanceStore(s => s.setYear)
  const [catModal, setCatModal] = useState<{ category: Category | null } | null>(null)

  // Which month the envelopes are about. The year lives in the store because it
  // decides what gets fetched; the month only decides what is shown.
  const [monthIdx, setMonthIdx] = useState(() => new Date().getMonth())

  // Which of the four views Settings chose. It is a shared preference, so it
  // arrives from another device too — hence the listener as well as the read.
  const [envStyle, setEnvStyle] = useState<EnvelopeStyle>(loadEnvelopeStyle)
  function pickStyle(next: EnvelopeStyle) {
    setEnvStyle(next)
    try { localStorage.setItem('finance-envelope-style', next) } catch { /* quota */ }
    // The same event Settings fires, so the two never disagree.
    window.dispatchEvent(new CustomEvent('finance:envelopeStyleChanged', { detail: next }))
  }
  useEffect(() => {
    const h = () => setEnvStyle(loadEnvelopeStyle())
    window.addEventListener('finance:envelopeStyleChanged', h)
    window.addEventListener('storage', h)
    return () => {
      window.removeEventListener('finance:envelopeStyleChanged', h)
      window.removeEventListener('storage', h)
    }
  }, [])

  // Rates live outside React, so nudge everything that depends on them.
  const [fxTick, setFxTick] = useState(0)
  useEffect(() => {
    const h = () => setFxTick(n => n + 1)
    window.addEventListener('professor:fxRatesChanged', h)
    return () => window.removeEventListener('professor:fxRatesChanged', h)
  }, [])

  // ── One pass over what is already there ────────────────────────────────────
  // Categories were carrying emoji — a folder for most of them, because that is
  // what the picker opens on. Each one gets a line icon that means something,
  // once, and only where the name says what it should be. An uploaded picture
  // is left alone: somebody went and found that.
  const reviewed = useRef(false)
  useEffect(() => {
    if (reviewed.current || categories.length === 0) return
    try { if (localStorage.getItem('finance-icons-reviewed') === '1') { reviewed.current = true; return } } catch { /* ignore */ }
    reviewed.current = true

    for (const cat of categories) {
      if (cat.icon?.startsWith('data:') || cat.icon?.startsWith('http')) continue
      if (isLucideIcon(cat.icon)) continue
      const suggested = suggestIcon(cat.name)
      // Nothing sensible to say beats saying the wrong thing, unless what is
      // there is a placeholder — then anything is an improvement.
      const next = suggested ?? (isPlaceholderIcon(cat.icon) ? 'lucide:Folder' : null)
      if (next && next !== cat.icon) void upsertCategory({ ...cat, icon: next })
    }
    try { localStorage.setItem('finance-icons-reviewed', '1') } catch { /* quota */ }
  }, [categories, upsertCategory])
  const monthKey = `${year}-${String(monthIdx + 1).padStart(2, '0')}`
  const currency = (() => {
    try { return localStorage.getItem('finance-currency') || 'EGP' } catch { return 'EGP' }
  })()

  // Parent categories only (for list)
  const parents = useMemo(
    () => categories.filter(c => !c.parentId).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [categories],
  )

  // Sub-categories
  const subs = useMemo(
    () => (parentId: string) => categories.filter(c => c.parentId === parentId),
    [categories],
  )

  // Budget rules stored locally (keyed by category id)
  const [rules, setRules] = useState<Record<string, BudgetRule>>(() => {
    try { return JSON.parse(localStorage.getItem('finance-budget-rules') ?? '{}') } catch { return {} }
  })
  /** A budget can carry the day its money moves, and that day makes a task.
   *  Saying so here is what brings the board in line without waiting for the
   *  next load or the twelve-hour sweep. */
  function putRules(next: Record<string, BudgetRule>) {
    setRules(next)
    localStorage.setItem('finance-budget-rules', JSON.stringify(next))
    window.dispatchEvent(new Event('professor:moneyRemindersChanged'))
  }

  function deleteRule(catId: string) {
    const next = { ...rules }
    delete next[catId]
    putRules(next)
  }

  function saveRule(catId: string, rule: BudgetRule) {
    putRules({ ...rules, [catId]: rule })
  }

  // Nothing selected to begin with: the point of the screen is the month as a
  // whole, and a category takes the panel only when you ask for one.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Not parents.find: clicking a sub-category did nothing, because only a
  // top-level one could ever be the selected one.
  const selectedCat = categories.find(c => c.id === selectedId) ?? null
  const rule = selectedId ? (rules[selectedId] ?? defaultRule()) : null

  // Monthly spend for selected category (current month)

  // 20E — Envelope drill-down state
  const [drillOpen, setDrillOpen] = useState(false)
  const [drillPeriod, setDrillPeriod] = useState<'month' | '3months' | '6months' | 'year'>('month')
  // Decision flags: { [txId]: 'approved' | 'review' | 'excluded' }
  type TxFlag = 'approved' | 'review' | 'excluded'
  const [txFlags, setTxFlags] = useState<Record<string, TxFlag>>(() => {
    try { return JSON.parse(localStorage.getItem('finance-tx-flags') ?? '{}') } catch { return {} }
  })
  function setFlag(txId: string, flag: TxFlag | null) {
    const next = { ...txFlags }
    if (flag === null) delete next[txId]
    else next[txId] = flag
    setTxFlags(next)
    localStorage.setItem('finance-tx-flags', JSON.stringify(next))
  }
  // ── The year, month by month ───────────────────────────────────────────────
  // Income above the line, spending below it, and the balance those two leave
  // behind running across the top. One picture answers "how is the year going"
  // before any envelope is read.
  const months = useMemo(() => {
    const out = Array.from({ length: 12 }, (_, m) => {
      const prefix = `${year}-${String(m + 1).padStart(2, '0')}`
      let income = 0, expense = 0
      // The year chart is money that moved. What is still owed is not a month
      // that has happened.
      for (const tx of settled(transactions)) {
        // Filed in the month the money moved, not the month it was owed in.
        if (!whenPaid(tx).startsWith(prefix)) continue
        // Converted, not added at face value: 3,500 USD is not 3,500 EGP, and
        // a rate nobody has given is left out rather than invented.
        const v = toBase(Math.abs(tx.amount), tx.currency, currency)
        if (v === null) continue
        if (tx.type === 'income')  income  += v
        if (tx.type === 'expense') expense += v
      }
      return { m, income, expense, balance: 0 }
    })
    let running = 0
    for (const row of out) { running += row.income - row.expense; row.balance = running }
    return out
  }, [transactions, year, currency, fxTick])

  const peak = Math.max(1, ...months.map(x => Math.max(x.income, x.expense)))
  const balances = months.map(x => x.balance)
  const balLo = Math.min(0, ...balances)
  const balHi = Math.max(1, ...balances)

  // ── This month's envelopes ─────────────────────────────────────────────────
  // A category's own transactions plus its children's — money filed under
  // "Groceries · Fruit" is money out of the Groceries envelope.
  const envelopes = useMemo(() => {
    // The month before the one on screen, and the seven days ending today —
    // worked out once, not per envelope.
    const [ky, km] = monthKey.split('-').map(Number)
    const before = new Date(ky, km - 2, 1)
    const prevKey = `${before.getFullYear()}-${String(before.getMonth() + 1).padStart(2, '0')}`
    const dayKeys = Array.from({ length: 7 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - (6 - i))
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    })
    const build = (cat: Category) => {
      const rule = rules[cat.id]
      const cur  = rule?.currency ?? currency
      const rate = rateFor(cur, currency)
      const ids = new Set([cat.id, ...categories.filter(c => c.parentId === cat.id).map(c => c.id)])
      const wanted = cat.txType === 'income' ? 'income' : 'expense'
      // Everything filed here, converted into the base currency. This used to
      // keep only what was already in the envelope's own currency and drop the
      // rest — so a salary paid in dollars landed in no envelope, no group
      // total and no summary line anywhere.
      let base = 0
      // The same envelope last month, and the last seven days one at a time.
      // Neither changes what an envelope *is*; they are what the other views
      // are built out of — a limit alone cannot say "worse than last month" or
      // "slowing down".
      let prevBase = 0
      const dayBase = new Array<number>(7).fill(0)
      // What each part has spent, kept apart so a sub-category can show its
      // own filling rather than only counting towards its parent's.
      const byChild = new Map<string, number>()
      const currencies = new Set<string>()
      // An envelope holds what has been spent out of it. A bill that is only
      // due has taken nothing out of it yet.
      for (const tx of settled(transactions)) {
        if (!tx.categoryId || !ids.has(tx.categoryId)) continue
        if (tx.type !== wanted) continue
        const on = whenPaid(tx)
        const thisMonth = on.startsWith(monthKey)
        const lastMonth = on.startsWith(prevKey)
        const dayIndex  = dayKeys.indexOf(on)
        if (!thisMonth && !lastMonth && dayIndex < 0) continue
        const v = toBase(Math.abs(tx.amount), tx.currency, currency)
        if (v === null) { if (thisMonth) currencies.add(tx.currency); continue }  // no rate — say so, never guess
        if (lastMonth) prevBase += v
        if (dayIndex >= 0) dayBase[dayIndex] += v
        if (!thisMonth) continue
        base += v
        if (tx.categoryId !== cat.id) byChild.set(tx.categoryId, (byChild.get(tx.categoryId) ?? 0) + v)
      }
      // ...and back into whatever this envelope is kept in, which is what its
      // budget is written in and therefore what it must be compared against.
      const actual = rate === null ? 0 : base / rate
      // Not rules[cat.id].amount: a yearly budget of 12,000 is 1,000 against a
      // month's spending, and comparing it raw made every non-monthly envelope
      // look untouched. And a budget that has not begun, or has ended, is not
      // a budget this month — both ends were collected and never consulted.
      const own = activeIn(rule, monthKey) ? monthlyAmount(rule) : 0

      // A sub-category keeps its budget in its own currency. Added at face
      // value, a 250 USD sub-budget put 250 onto a 5,000 EGP parent — so each
      // one is converted into what the envelope is kept in, and one that
      // cannot be converted is named rather than counted.
      const children = categories.filter(c => c.parentId === cat.id).map(child => {
        const r = rules[child.id]
        const own = activeIn(r, monthKey) ? monthlyAmount(r) : 0
        const childCur = r?.currency ?? cur
        const inBase = own === 0 ? 0 : toBase(own, childCur, currency)
        if (own > 0 && (inBase === null || rate === null)) currencies.add(childCur)
        return {
          cat: child,
          planned: own,
          cur: childCur,
          /** The same budget expressed in the envelope's currency, or null when
           *  there is no rate to get it there. */
          inEnvelope: inBase === null || rate === null ? null : inBase / rate,
          budgeted: own > 0,
          /** Spent under this part alone, in the envelope's currency, so it
           *  can be compared with the budget written beside it. */
          actual: rate === null ? 0 : (byChild.get(child.id) ?? 0) / rate,
        }
      })
      const fromParts = children.reduce((n, c) => n + (c.inEnvelope ?? 0), 0)

      // A budget on a sub-category is a budget. It was counted nowhere: the
      // envelope showed "set a budget" and the month's total ignored it, so
      // splitting Groceries into its parts made the whole thing look
      // unbudgeted. Its own figure wins where there is one — otherwise the
      // parts add up to it. Never both, or every split would count twice.
      const planned = own > 0 ? own : fromParts
      const plannedFrom: 'own' | 'parts' | 'none' =
        own > 0 ? 'own' : fromParts > 0 ? 'parts' : 'none'

      // Already in the base currency; the planned figure still has to make the
      // trip, since it is written in the envelope's own.
      const actualBase  = rate === null ? null : base
      const plannedBase = rate === null ? null : planned * rate

      return {
        cat, actual, planned, plannedFrom, cur, actualBase, plannedBase, children,
        currencies: [...currencies],
        // Back into the envelope's own currency, like `actual`, so the two are
        // the same kind of number wherever they are shown side by side.
        prev:  rate === null ? 0 : prevBase / rate,
        trend: rate === null ? dayBase.map(() => 0) : dayBase.map(v => v / rate),
      }
    }
    const all = parents.map(build)
    return {
      spending: all.filter(e => e.cat.txType !== 'income'),
      earning:  all.filter(e => e.cat.txType === 'income'),
    }
  }, [parents, categories, transactions, rules, monthKey, currency, fxTick])

  // Everything that can be converted is added up. What cannot is counted, and
  // named, so a total is never quietly short of a currency nobody rated.
  const sum = (rows: { actualBase: number | null; plannedBase: number | null; cur: string }[]) => ({
    actual:  rows.reduce((s, r) => s + (r.actualBase  ?? 0), 0),
    planned: rows.reduce((s, r) => s + (r.plannedBase ?? 0), 0),
    aside:   rows.filter(r => r.actualBase === null).length,
  })
  // Asked of the transactions, not the envelopes: money in a currency can be
  // sitting in a category whose budget is in the base one.
  const needRates = useMemo(
    // A budget written in a currency counts as money here even before anything
    // has been spent in it — otherwise a USD sub-budget silently drops out of
    // its parent's total with nothing on screen asking for a rate.
    () => currenciesNeedingRates([
      ...transactions.filter(t => whenPaid(t).startsWith(monthKey)),
      ...Object.values(rules)
        .filter(r => r && monthlyAmount(r) > 0)
        .map(r => ({ currency: r.currency })),
    ], currency),
    [transactions, monthKey, currency, rules, fxTick],
  )

  const outTotal = sum(envelopes.spending)
  const inTotal  = sum(envelopes.earning)

  // ── Re-parenting by hand ───────────────────────────────────────────────────
  const [dragging, setDragging] = useState<string | null>(null)
  // A drag ends in a click on whatever was under the finger. Ignore it, or
  // letting go of a category opens the very popup you were moving it out of.
  const droppedAt = useRef(0)
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 180, tolerance: 8 } }),
  )

  function onDragEnd(e: DragEndEvent) {
    setDragging(null)
    droppedAt.current = Date.now()
    const { active, over } = e
    if (!over) return
    const moved = categories.find(c => c.id === active.id)
    if (!moved) return

    if (String(over.id).startsWith('top-level')) {
      if (moved.parentId) void upsertCategory({ ...moved, parentId: undefined })
      return
    }

    const targetId = String(over.id).replace(/^in:/, '')
    if (targetId === moved.id) return
    const target = categories.find(c => c.id === targetId)
    if (!target) return

    // One level of nesting is all this models, so a category with children of
    // its own cannot itself become a child — its children would need
    // grandparents, and nothing here knows what those are.
    if (categories.some(c => c.parentId === moved.id)) {
      setNote(`${moved.name} has sub-categories of its own — empty it first, or move those instead.`)
      return
    }
    // Spending inside earning would make the totals lie about which is which.
    if ((target.txType === 'income') !== (moved.txType === 'income')) {
      setNote(`${moved.name} and ${target.name} are not the same kind of money.`)
      return
    }
    if (moved.parentId === target.id) return
    void upsertCategory({ ...moved, parentId: target.id, txType: target.txType })
  }

  /** Said once, under the envelopes, when a drop could not be honoured. */
  const [note, setNote] = useState<string | null>(null)

  /** Adding a category took two windows: one to name it, and then its own to
   *  give it a budget — so the first thing a new envelope ever said was "no
   *  budget". It is made here and opened straight away, and the popup already
   *  edits everything it has: name, icon, type, budget. */
  function addCategory() {
    const id = crypto.randomUUID()
    void upsertCategory({
      id, name: '', icon: 'lucide:Folder', color: '#8C8071', isSystem: false, txType: 'expense',
    })
    setSelectedId(id)
  }

  /** Made and then abandoned. Nothing was named, so nothing was meant. */
  function closeCategory() {
    const open = categories.find(c => c.id === selectedId)
    if (open && !open.name.trim() && !categories.some(c => c.parentId === open.id)) {
      void removeCategory(open.id)
      // A sub abandoned mid-add came from its parent's window; go back there
      // rather than dropping the person on the month.
      setSelectedId(open.parentId ?? null)
      return
    }
    setSelectedId(null)
  }

  function pickCategory(id: string) {
    if (Date.now() - droppedAt.current < 250) return   // that was a drop, not a tap
    setSelectedId(id)
  }

  function stepMonth(by: number) {
    const d = new Date(year, monthIdx + by, 1)
    setMonthIdx(d.getMonth())
    if (d.getFullYear() !== year) void setYear(d.getFullYear())
  }

  const HEAD_PILL: React.CSSProperties = {
    height: 32, padding: '0 12px', borderRadius: 999, border: '1px solid #E8E1CE',
    background: '#FFFFFF', fontFamily: 'inherit', fontSize: 12.5, color: '#191712',
    display: 'flex', alignItems: 'center', cursor: 'pointer',
  }
  const CARD: React.CSSProperties = {
    background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 14,
    boxShadow: '0 1px 3px rgba(25,23,18,0.06)',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#F7F4EA' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ flexShrink: 0, borderBottom: '1px solid #E8E1CE', padding: '14px 26px 14px', display: 'flex', alignItems: 'flex-end', gap: 18 }}>
        <div style={{ minWidth: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', color: '#6C6553', display: 'block', marginBottom: 4 }}>MONEY · BUDGET</span>
          <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 30, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1, color: '#191712', display: 'block' }}>
            {money(months[11]?.balance ?? 0, currency)}
          </span>
          <span style={{ fontSize: 12, color: '#6C6553', display: 'block', marginTop: 3 }}>
            what {year} leaves behind · {parents.length} categor{parents.length === 1 ? 'y' : 'ies'}
          </span>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 3 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: 3, borderRadius: 999, background: '#EDE7D9' }}>
            <button onClick={() => stepMonth(-1)} title="Previous month"
              style={{ ...HEAD_PILL, width: 28, padding: 0, justifyContent: 'center', border: 'none', background: 'transparent', color: '#6C6553' }}>‹</button>
            <span style={{ ...HEAD_PILL, cursor: 'default', boxShadow: '0 1px 3px rgba(25,23,18,0.16)', fontWeight: 600, minWidth: 106, justifyContent: 'center' }}>
              {new Date(year, monthIdx, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
            </span>
            <button onClick={() => stepMonth(1)} title="Next month"
              style={{ ...HEAD_PILL, width: 28, padding: 0, justifyContent: 'center', border: 'none', background: 'transparent', color: '#6C6553' }}>›</button>
          </div>
          <StylePicker value={envStyle} onChange={pickStyle} />
          <button onClick={addCategory} title="Add a category"
            style={{ height: 34, padding: '0 15px', borderRadius: 999, background: AMBER, border: 'none', color: '#191712', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 2px 0 rgba(25,23,18,0.14)' }}>
            + Category
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '18px 26px 26px' }}>

        {/* ── The year ─────────────────────────────────────────────────────── */}
        <div style={{ ...CARD, padding: '16px 18px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', color: '#6C6553' }}>{year}</span>
            <span style={{ flex: 1 }} />
            <Legend swatch={OLIVE} label="In" />
            <Legend swatch={RUST}  label="Out" />
            <Legend swatch="#191712" label="Net" />
            <Legend swatch="#C5BCA8" label="Balance" line />
          </div>

          {/* Rounded bars off a zero line, the way the task strip draws its
              days: income reaches up from the line, spending down from it, and
              the month's net rides the same line — above it when the month kept
              something, below it when it did not. */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'stretch', gap: 7, height: 176 }}>
            {/* The balance, drawn over the columns it comes from */}
            <svg viewBox="0 0 120 100" preserveAspectRatio="none"
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 3 }}>
              <polyline
                points={months.map((x, i) =>
                  `${i * 10 + 5},${100 - ((x.balance - balLo) / (balHi - balLo || 1)) * 88 - 6}`).join(' ')}
                fill="none" stroke="#9B9180" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round"
                vectorEffect="non-scaling-stroke" />
            </svg>

            {months.map(x => {
              const on = x.m === monthIdx
              const net = x.income - x.expense
              // Every bar keeps its rounded cap: a two-pixel sliver still reads
              // as a bar rather than a smudge, which a square one does not.
              const bar = (v: number) => (v > 0 ? Math.max(4, (v / peak) * 58) : 0)
              const up   = bar(x.income)
              const down = bar(x.expense)
              const netH = bar(Math.abs(net))
              const netUp = net >= 0
              return (
                <button key={x.m} onClick={() => setMonthIdx(x.m)}
                  title={`${new Date(year, x.m, 1).toLocaleDateString('en-GB', { month: 'long' })} · in ${money(x.income, currency)} · out ${money(x.expense, currency)} · net ${money(net, currency)}`}
                  style={{
                    flex: 1, minWidth: 0, padding: 0, border: 'none', cursor: 'pointer',
                    background: on ? 'rgba(245,209,78,0.22)' : 'transparent',
                    borderRadius: 12, position: 'relative', display: 'flex', flexDirection: 'column',
                    justifyContent: 'flex-end',
                  }}>
                  {/* The line everything is measured from */}
                  <span style={{
                    position: 'absolute', left: 6, right: 6, top: '50%', height: 1,
                    background: on ? '#E0D5B4' : '#EFEADB',
                  }} />

                  {/* In above the line and out below it, as one pair; what the
                      month kept stands beside them rather than over them, so a
                      net the size of the income does not disappear into it. */}
                  <span style={{
                    position: 'absolute', left: 'calc(50% - 13px)', width: 14,
                    bottom: 'calc(50% + 3px)', height: up,
                    background: OLIVE, borderRadius: '999px 999px 3px 3px',
                  }} />
                  <span style={{
                    position: 'absolute', left: 'calc(50% - 13px)', width: 14,
                    top: 'calc(50% + 3px)', height: down,
                    background: RUST, borderRadius: '3px 3px 999px 999px',
                  }} />
                  <span
                    title={`net ${money(net, currency)}`}
                    style={{
                      position: 'absolute', left: 'calc(50% + 5px)', width: 7, height: netH,
                      [netUp ? 'bottom' : 'top']: 'calc(50% + 3px)',
                      background: '#191712', opacity: net === 0 ? 0 : 0.8,
                      borderRadius: netUp ? '999px 999px 3px 3px' : '3px 3px 999px 999px',
                    } as React.CSSProperties} />

                  <span style={{
                    position: 'relative', padding: '0 0 5px', fontSize: 9.5,
                    color: on ? '#191712' : '#9B9180', fontWeight: on ? 700 : 500,
                  }}>{MONTH_SHORT[x.m]}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Envelopes, and whatever is open beside them ───────────────────── */}
        <div style={{ display: 'flex', gap: 16, marginTop: 16, alignItems: 'flex-start' }}>

          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <DndContext
              sensors={dndSensors}
              // pointerWithin, not closestCenter: the drop targets are wildly
              // different sizes and what matters is what is under the finger,
              // not which box centre the dragged pill happens to sit nearest.
              collisionDetection={pointerWithin}
              onDragStart={(e: DragStartEvent) => { setNote(null); setDragging(String(e.active.id)) }}
              onDragCancel={() => setDragging(null)}
              onDragEnd={onDragEnd}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <EnvelopeGroup
              title="Spending" rows={envelopes.spending} color={RUST}
              selectedId={selectedId} onPick={pickCategory} currency={currency} dragging={dragging}
              rules={rules} style={envStyle}
              empty="No spending categories yet — add one and its envelope appears here." />
            <EnvelopeGroup
              title="Earning" rows={envelopes.earning} color={OLIVE}
              selectedId={selectedId} onPick={pickCategory} currency={currency} dragging={dragging}
              rules={rules} style={envStyle}
              empty="No income categories yet." />
            </div>
            <DragOverlay dropAnimation={null}>
              {dragging && (() => {
                const c = categories.find(x => x.id === dragging)
                return c ? (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 7, height: 34, padding: '0 12px',
                    borderRadius: 999, background: '#FFFFFF', border: '1px solid #E8E1CE',
                    boxShadow: '0 8px 20px rgba(25,23,18,0.18)', fontSize: 12.5, color: '#191712',
                  }}>
                    <CategoryGlyph icon={c.icon} size={14} />{c.name}
                  </span>
                ) : null
              })()}
            </DragOverlay>
            </DndContext>

            {note && (
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 13px',
                borderRadius: 10, background: 'rgba(245,209,78,0.20)', border: '1px solid rgba(245,209,78,0.65)',
                fontSize: 11.5, color: '#3D3926', lineHeight: 1.5,
              }}>
                <span style={{ flex: 1 }}>{note}</span>
                <button onClick={() => setNote(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8A6D0B', padding: 0, fontSize: 13, lineHeight: 1 }}>×</button>
              </div>
            )}
          </div>

          <div style={{ width: 340, flexShrink: 0, ...CARD, padding: '18px 20px 20px', alignSelf: 'stretch' }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', color: '#6C6553', marginBottom: 14 }}>
              {new Date(year, monthIdx, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }).toUpperCase()}
            </div>
            <SummaryLine label="Expenses" actual={outTotal.actual} planned={outTotal.planned} color={RUST}  currency={currency} />
            <SummaryLine label="Income"   actual={inTotal.actual}  planned={inTotal.planned}  color={OLIVE} currency={currency} />
            <div style={{ height: 1, background: '#E8E1CE', margin: '4px 0 0' }} />
            <SummaryLine
              label="Left over"
              actual={inTotal.actual - outTotal.actual}
              planned={inTotal.planned - outTotal.planned}
              color={inTotal.actual - outTotal.actual < 0 ? RUST : '#191712'}
              currency={currency} strong />
            {needRates.length > 0 && (
              <div style={{
                marginTop: 12, padding: '11px 13px', borderRadius: 10,
                background: 'rgba(245,209,78,0.20)', border: '1px solid rgba(245,209,78,0.65)',
              }}>
                <div style={{ fontSize: 11.5, color: '#3D3926', lineHeight: 1.5 }}>
                  There is {needRates.length === 1 ? 'money' : 'money'} here in {needRates.join(' and ')} and
                  nothing to convert {needRates.length === 1 ? 'it' : 'them'} by, so {needRates.length === 1 ? 'it is' : 'they are'} in
                  none of these totals.
                </div>
                <button
                  onClick={() => {
                    // Rates are one setting, not a thing to re-enter per screen.
                    try { localStorage.setItem('settings-active-section', 'finance') } catch { /* private mode */ }
                    setActiveModule('settings')
                  }}
                  style={{
                    marginTop: 10, height: 30, padding: '0 13px', borderRadius: 8,
                    background: '#191712', border: 'none', color: '#FDF8E7',
                    fontFamily: 'inherit', fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
                  }}>
                  Set rates in Settings
                </button>
              </div>
            )}
            <div style={{ fontSize: 11.5, color: '#9B9180', marginTop: 14, lineHeight: 1.55 }}>
              The bold figure is what actually happened this month; the one under it
              is what the envelopes were set to. Pick a category to change its budget.
            </div>
          </div>
        </div>
      </div>


      {/* ─── 20E · Envelope Drill-Down Overlay ───────────────────────────────── */}
      {selectedCat && (
        <BudgetRuleModal
          category={selectedCat}
          parent={selectedCat.parentId ? categories.find(c => c.id === selectedCat.parentId) : null}
          partsBudget={categories
            .filter(c => c.parentId === selectedCat.id)
            .reduce((n, c) => n + (activeIn(rules[c.id], monthKey) ? monthlyAmount(rules[c.id]) : 0), 0)}
          rule={rule ?? defaultRule()}
          subs={subs(selectedCat.id)}
          transactions={transactions}
          monthKey={monthKey}
          currency={currency}
          accounts={accounts}
          onChange={r => saveRule(selectedCat.id, r)}
          onDelete={() => deleteRule(selectedCat.id)}
          onPromote={() => void upsertCategory({ ...selectedCat, parentId: undefined })}
          onRename={patch => {
            const next = { ...selectedCat, ...patch }
            // Named but never given an icon: guess from the name rather than
            // leaving a folder on it.
            if (patch.name && isPlaceholderIcon(next.icon)) {
              next.icon = suggestIcon(patch.name) ?? next.icon
            }
            void upsertCategory(next)
          }}
          onEditCategory={() => setCatModal({ category: selectedCat })}
          onAddSub={() => {
            const id = crypto.randomUUID()
            void upsertCategory({
              id, name: '', icon: 'lucide:Folder', color: selectedCat.color,
              parentId: selectedCat.id, isSystem: false, txType: selectedCat.txType,
            })
            setSelectedId(id)
          }}
          onEditSub={sub => setSelectedId(sub.id)}
          onDrill={() => setDrillOpen(true)}
          onClose={closeCategory}
        />
      )}

      {catModal && (
        <CategoryModal
          category={catModal.category}
          categories={categories}
          onSave={c => { void upsertCategory(c); setSelectedId(prev => prev ?? c.id); setCatModal(null) }}
          onDelete={id => {
            void removeCategory(id)
            if (selectedId === id) setSelectedId(null)
            setCatModal(null)
          }}
          onClose={() => setCatModal(null)}
        />
      )}

      {drillOpen && selectedCat && (() => {
        // Determine date range from drillPeriod
        const now = new Date()
        let cutoff: string
        if (drillPeriod === 'month') {
          cutoff = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2,'0')}`
        } else if (drillPeriod === '3months') {
          const d = new Date(now); d.setMonth(d.getMonth() - 2)
          cutoff = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}`
        } else if (drillPeriod === '6months') {
          const d = new Date(now); d.setMonth(d.getMonth() - 5)
          cutoff = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}`
        } else {
          const d = new Date(now); d.setMonth(d.getMonth() - 11)
          cutoff = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}`
        }
        const thisCatIds = new Set([selectedId!, ...subs(selectedId!).map(s => s.id)])
        const drillTxs = transactions
          .filter((tx: Transaction) =>
            tx.type === 'expense' &&
            tx.categoryId && thisCatIds.has(tx.categoryId) &&
            whenPaid(tx) >= cutoff
          )
          .sort((a: Transaction, b: Transaction) => whenPaid(b).localeCompare(whenPaid(a)))

        // Group by sub-category (or parent itself)
        const subGroups: Record<string, { cat: Category | undefined; txs: Transaction[] }> = {}
        for (const tx of drillTxs) {
          const key = tx.categoryId ?? selectedId!
          if (!subGroups[key]) {
            const cat = categories.find(c => c.id === key)
            subGroups[key] = { cat, txs: [] }
          }
          subGroups[key].txs.push(tx)
        }

        // Converted, like every other total on this screen.
        const inBase = (tx: Transaction) => toBase(Math.abs(tx.amount), tx.currency, currency) ?? 0
        const totalSpend = settled(drillTxs).reduce((s: number, tx: Transaction) => s + inBase(tx), 0)
        const excludedSpend = settled(drillTxs)
          .filter((tx: Transaction) => txFlags[tx.id] === 'excluded')
          .reduce((s: number, tx: Transaction) => s + inBase(tx), 0)
        const drillUnrated = currenciesNeedingRates(drillTxs, currency)
        const dupes = findDuplicates(transactions)
        const netSpend = totalSpend - excludedSpend

        const PERIOD_LABELS: Record<string, string> = {
          month: 'This month', '3months': 'Last 3 months',
          '6months': 'Last 6 months', year: 'This year'
        }

        const FLAG_STYLES: Record<TxFlag, { bg: string; color: string; border: string; label: string }> = {
          approved: { bg: '#E2F0E7', color: '#0C8140', border: '#C8D9A8', label: '✓ OK' },
          review:   { bg: '#FEF3C7', color: '#92400E', border: '#FCD34D', label: '⚑ Review' },
          excluded: { bg: '#FBEAE4', color: '#C62828', border: '#E5BBAC', label: '✗ Exclude' },
        }

        return (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(25,23,18,.45)', backdropFilter: 'blur(2px)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end',
          }}
            onClick={() => setDrillOpen(false)}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                width: 520, height: '100%', background: '#F7F4EA',
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
                boxShadow: '-8px 0 40px rgba(25,23,18,.15)',
              }}
            >
              {/* Drill header */}
              <div style={{ flexShrink: 0, borderBottom: '1px solid #E8E1CE', padding: '18px 24px 14px', background: '#FCFAF4' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <CategoryGlyph icon={selectedCat.icon} size={26} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: 'Outfit, sans-serif', fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', color: '#191712' }}>
                      {selectedCat.name}
                    </div>
                    <div style={{ fontSize: 11, color: '#9B9180', marginTop: 1 }}>{drillTxs.length} transactions</div>
                  </div>
                  <button onClick={() => setDrillOpen(false)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6C6553', padding: 4, display: 'flex' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  </button>
                </div>

                {/* Period selector */}
                <div style={{ display: 'flex', gap: 5 }}>
                  {(['month', '3months', '6months', 'year'] as const).map(p => (
                    <button key={p} onClick={() => setDrillPeriod(p)}
                      style={{
                        padding: '5px 11px', borderRadius: 999, border: '1px solid #E8E1CE', cursor: 'pointer',
                        background: drillPeriod === p ? '#191712' : '#FAF7EC',
                        color: drillPeriod === p ? '#FDF8E7' : '#6C6553',
                        fontSize: 11.5, fontWeight: drillPeriod === p ? 600 : 400,
                      }}
                    >{PERIOD_LABELS[p]}</button>
                  ))}
                </div>
              </div>

              {/* Sub-category summary row */}
              {Object.keys(subGroups).length > 1 && (
                <div style={{ flexShrink: 0, display: 'flex', gap: 8, padding: '12px 24px', borderBottom: '1px solid #E8E1CE', overflowX: 'auto', background: '#F7F4EA' }}>
                  {Object.entries(subGroups).map(([key, { cat, txs }]) => {
                    const total = txs.reduce((s: number, tx: Transaction) => s + inBase(tx), 0)
                    return (
                      <div key={key} style={{ flexShrink: 0, background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 10, padding: '8px 12px', minWidth: 100 }}>
                        <div style={{ marginBottom: 3, color: cat?.color ?? '#6C6553' }}>
                          <CategoryGlyph icon={cat?.icon ?? '📂'} size={15} />
                        </div>
                        <div style={{ fontSize: 11, color: '#6C6553', marginBottom: 3, whiteSpace: 'nowrap' }}>{cat?.name ?? selectedCat.name}</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: RUST, fontFamily: 'Outfit, sans-serif' }}>
                          {acct(total, { currency: 'EGP' })}
                        </div>
                        <div style={{ fontSize: 10, color: '#9B9180' }}>{txs.length} txns</div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Transaction list */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '8px 24px 16px' }}>
                {drillTxs.length === 0 ? (
                  <div style={{ textAlign: 'center', color: '#9B9180', padding: '48px 0', fontSize: 13 }}>
                    No transactions in this period
                  </div>
                ) : (
                  drillTxs.map((tx: Transaction) => {
                    const flag = txFlags[tx.id] as TxFlag | undefined
                    const subCat = tx.categoryId ? categories.find(c => c.id === tx.categoryId) : undefined
                    return (
                      <div key={tx.id}
                        title={isUnpaid(tx) ? UNPAID_TITLE : undefined}
                        style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '10px 0', borderBottom: '1px solid #F0EBDC',
                        opacity: flag === 'excluded' ? 0.5 : 1,
                        ...unpaidRow(isUnpaid(tx)),
                      }}>
                        {/* Sub-cat icon */}
                        <span style={{ fontSize: 18, flexShrink: 0, width: 28, textAlign: 'center' }}>
                          <CategoryGlyph icon={subCat?.icon ?? selectedCat.icon} size={14} />
                        </span>

                        {/* Main info */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#191712', display: 'flex', alignItems: 'center', gap: 6, textDecoration: flag === 'excluded' ? 'line-through' : 'none' }}>
                            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.payee}</span>
                            <DuplicateMark scope={dupes.get(tx.id)} />
                            <BudgetMark on={isBudgetEntry(tx)} />
                          </div>
                          <div style={{ fontSize: 10.5, color: '#9B9180', marginTop: 1, display: 'flex', gap: 6, minWidth: 0 }}>
                            <span title={isUnpaid(tx) ? `Due ${tx.date}, not paid` : `Paid ${whenPaid(tx)}`}>
                              {new Date(whenPaid(tx) + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </span>
                            {subCat && subCat.id !== selectedId && <span>· {subCat.name}</span>}
                            {tx.note?.trim() && (
                              <span title={tx.note.trim()} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                ({tx.note.trim()})
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Amount */}
                        <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 14, fontWeight: 700, color: flag === 'excluded' ? '#9B9180' : RUST, flexShrink: 0 }}>
                          {tx.currency ?? currency} {Math.abs(tx.amount).toLocaleString('en-US')}
                        </span>

                        {/* Decision flags */}
                        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                          {(['approved', 'review', 'excluded'] as TxFlag[]).map(f => {
                            const s = FLAG_STYLES[f]
                            const active = flag === f
                            return (
                              <button key={f} title={f}
                                onClick={() => setFlag(tx.id, active ? null : f)}
                                style={{
                                  padding: '3px 7px', borderRadius: 6, border: `1px solid ${active ? s.border : '#E8E1CE'}`,
                                  background: active ? s.bg : 'transparent',
                                  color: active ? s.color : '#C5BCA8',
                                  fontSize: 10, fontWeight: active ? 700 : 400, cursor: 'pointer',
                                  transition: 'all 0.12s',
                                }}>
                                {s.label}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {/* Footer summary */}
              <div style={{ flexShrink: 0, borderTop: '1px solid #E8E1CE', padding: '14px 24px', background: '#FCFAF4', display: 'flex', alignItems: 'center', gap: 20 }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#9B9180' }}>
                    TOTAL{drillUnrated.length > 0 && (
                      <span title={`No rate set for ${drillUnrated.join(', ')}, so it is not counted here`}
                        style={{ marginLeft: 5, color: '#C08A2E' }}>· {drillUnrated.join(' ')}</span>
                    )}
                  </div>
                  <div style={{ fontFamily: 'Outfit, sans-serif', fontSize: 18, fontWeight: 700, color: RUST, letterSpacing: '-0.02em' }}>
                    {acct(totalSpend, { currency: 'EGP' })}
                  </div>
                </div>
                {excludedSpend > 0 && (
                  <>
                    <div style={{ width: 1, alignSelf: 'stretch', background: '#E8E1CE' }} />
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#9B9180' }}>EXCLUDED</div>
                      <div style={{ fontFamily: 'Outfit, sans-serif', fontSize: 18, fontWeight: 700, color: '#9B9180', letterSpacing: '-0.02em' }}>
                        {acct(-excludedSpend, { currency: 'EGP' })}
                      </div>
                    </div>
                    <div style={{ width: 1, alignSelf: 'stretch', background: '#E8E1CE' }} />
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#9B9180' }}>NET</div>
                      <div style={{ fontFamily: 'Outfit, sans-serif', fontSize: 18, fontWeight: 700, color: '#191712', letterSpacing: '-0.02em' }}>
                        {acct(netSpend, { currency: 'EGP' })}
                      </div>
                    </div>
                  </>
                )}
                <span style={{ flex: 1 }} />
                <div style={{ fontSize: 11, color: '#9B9180', textAlign: 'right' }}>
                  {drillTxs.filter((tx: Transaction) => txFlags[tx.id] === 'approved').length} approved ·{' '}
                  {drillTxs.filter((tx: Transaction) => txFlags[tx.id] === 'review').length} to review ·{' '}
                  {drillTxs.filter((tx: Transaction) => txFlags[tx.id] === 'excluded').length} excluded
                </div>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}


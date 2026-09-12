import type { CSSProperties, ReactNode } from 'react'
import { acct } from '../format'
import { CategoryGlyph } from './CategoryGlyph'
import { useInkOnKeeping } from '@/lib/ink'

// ─── One entry, in every feed that lists entries ─────────────────────────────
// There were four of these — Today, Balances, and the Budget and Financials
// drill-downs — written four times. They agreed on what an entry *is* and on
// nothing else: 32px medallion or 40px, tinted or plain, the amount as a soft
// pill or as bare bold text, the date as "29 Sept" or as 2026-09-07, the note
// in brackets or not at all. So the same entry looked like a different kind of
// thing depending on which figure you had opened.
//
// This is the Balances row, which was the fullest of the four, as a component
// the other three take. What differs between feeds is passed in: the trailing
// controls (the flag buttons, the delete), whether the row opens an editor,
// and whether it is dimmed or struck out.

export interface TxRowProps {
  /** The medallion: a category or account glyph, and the colour it is tinted. */
  icon?: string
  tone?: string
  title: ReactNode
  /** Duplicate and budget marks — anything that sits beside the name. */
  marks?: ReactNode
  /** The second line: a date, a category, a note. */
  meta: ReactNode
  /** What the amount is, so the pill knows which way the money went. */
  type: 'expense' | 'income' | 'transfer'
  amount: number
  currency?: string
  /** A transfer read from one account's side: out of it, or into it. */
  direction?: 'out' | 'in'
  /** Controls at the end of the row — flags, a delete. */
  trailing?: ReactNode
  /** Dotted red edge: filed, but nothing has been paid. */
  unpaid?: boolean
  /** Planned, excluded — present but not counted. */
  faded?: boolean
  /** Excluded from a total: the name is struck out and the figure goes grey. */
  struck?: boolean
  onClick?: () => void
  hoverTitle?: string
  style?: CSSProperties
}

/** The amount as a soft pill: a tint of its own colour with the figure in that
 *  colour, never white text on a slab. Out is bracketed by `acct`. */
export function AmountPill({ type, amount, currency, direction, muted }: {
  type: 'expense' | 'income' | 'transfer'
  amount: number
  currency?: string
  direction?: 'out' | 'in'
  /** Not counted in anything, so it does not carry a colour either. */
  muted?: boolean
}) {
  const out = type === 'expense' || (type === 'transfer' && direction === 'out')
  const inn = type === 'income'  || (type === 'transfer' && direction === 'in')
  const bg = muted ? 'var(--sb-field)'
    : out ? 'color-mix(in srgb, var(--sb-negative) 12%, transparent)'
    : inn ? 'color-mix(in srgb, var(--sb-positive) 12%, transparent)'
    : 'var(--sb-field)'
  const color = muted ? 'var(--sb-ink-4)'
    : out ? 'var(--sb-negative)' : inn ? 'var(--sb-positive)' : 'var(--sb-ink-3)'
  return (
    <span style={{
      display: 'inline-block', flexShrink: 0,
      padding: '6px 13px', borderRadius: 'var(--sb-r-sm)',
      fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-label)', fontWeight: 700,
      fontVariantNumeric: 'tabular-nums',
      background: bg, color, whiteSpace: 'nowrap',
    }}>
      {type === 'transfer' && !direction ? '↔ ' : ''}
      {acct(out ? -Math.abs(amount) : Math.abs(amount), { currency })}
    </span>
  )
}

/** "29 Sept" — the same date in every feed. An entry is filed by the day the
 *  money moved, so that is the day the caller passes. */
export function txDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export function TxRow({
  icon, tone, title, marks, meta, type, amount, currency, direction,
  trailing, unpaid, faded, struck, onClick, hoverTitle, style,
}: TxRowProps) {
  const inkKeeping = useInkOnKeeping()
  const medallion = tone ?? (type === 'income' ? 'var(--sb-positive)' : 'var(--sb-negative)')
  const disc = `color-mix(in srgb, ${medallion} 14%, transparent)`
  return (
    <div
      onClick={onClick}
      title={hoverTitle}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '11px 0', borderBottom: 'var(--sb-border-width) solid var(--sb-border)',
        cursor: onClick ? 'pointer' : 'default',
        opacity: faded ? 0.6 : 1,
        // The dotted edge replaces the row's bottom hairline, so it is spread
        // after the row's own style rather than before it.
        ...(unpaid
          ? {
              border: 'var(--sb-border-width) dashed var(--sb-negative)',
              borderRadius: 'var(--sb-r-nav)',
              padding: '10px 11px',
            }
          : null),
        ...style,
      }}
    >
      <span style={{
        width: 40, height: 40, borderRadius: 'var(--sb-r-pill)', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: disc,
        // The glyph keeps the category's own colour wherever it can still be
        // read on that colour's own tint — which is every light theme. On a
        // dark ground the tint composites to a muddy near-black and the
        // full-strength colour lands within a whisker of it, so the icon was
        // there and invisible. inkOnKeeping measures it rather than guessing.
        color: inkKeeping(medallion, disc),
      }}>
        <CategoryGlyph icon={icon} size={18} />
      </span>

      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 'var(--sb-t-body)', fontWeight: 500, color: 'var(--sb-ink-1)',
          textDecoration: struck ? 'line-through' : 'none',
        }}>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </span>
          {marks}
        </span>
        <span style={{
          display: 'flex', gap: 6, marginTop: 1, minWidth: 0,
          fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-4)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {meta}
        </span>
      </span>

      <AmountPill type={type} amount={amount} currency={currency} direction={direction} muted={struck} />
      {trailing}
    </div>
  )
}

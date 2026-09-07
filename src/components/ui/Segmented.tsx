import type { CSSProperties, ReactNode } from 'react'

// ─── Segmented ───────────────────────────────────────────────────────────────
// One of a small, fixed set — a view switch, a range, a filter with three or
// four answers. A track in the field colour holding the options, and the one
// in force raised out of it on a card-coloured pill. It is the shape the app
// already used on the habits header, in fifteen slightly different hand-built
// copies: different heights, different paddings, three different shadows, and
// two that had no raised pill at all.
//
// Every state is CSS (`.sb-segmented*` in index.css) — nothing here writes a
// style on hover or on press.
//
// Not for a toggle (two states, one of which is "off") and not for a long list
// — a select is the right shape past about five.

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  /** The accessible name, when `label` is an icon or an abbreviation. */
  title?: string
  disabled?: boolean
}

export interface SegmentedProps<T extends string> {
  value: T
  onChange: (value: T) => void
  options: readonly SegmentedOption<T>[]
  /** sm 24px · md 28px (the default) · lg 30px, all inside a 3px track. */
  size?: 'sm' | 'md' | 'lg'
  /** Fill the width, each option an equal share. */
  block?: boolean
  className?: string
  style?: CSSProperties
  'aria-label'?: string
}

export function Segmented<T extends string>({
  value, onChange, options, size = 'md', block, className, style, ...rest
}: SegmentedProps<T>) {
  return (
    <div
      role="tablist"
      data-size={size}
      data-block={block ? '' : undefined}
      className={['sb-segmented', className].filter(Boolean).join(' ')}
      style={style}
      {...rest}
    >
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          role="tab"
          title={o.title}
          disabled={o.disabled}
          aria-selected={o.value === value}
          data-active={o.value === value ? '' : undefined}
          className="sb-segmented-opt"
          onClick={() => { if (!o.disabled) onChange(o.value) }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

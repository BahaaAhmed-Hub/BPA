import type { ButtonHTMLAttributes } from 'react'

// ─── Pill ────────────────────────────────────────────────────────────────────
// A control that is either on or off — a filter, a segment, a view switch. One
// height (--sb-h-pill) and one radius (--sb-r-pill); on is ink-filled, off is a
// bordered card. Both states are CSS.

export interface PillProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  on?: boolean
}

export function Pill({ on = false, className, type = 'button', ...rest }: PillProps) {
  return (
    <button
      type={type}
      data-on={on ? '' : undefined}
      aria-pressed={on}
      className={['sb-pill', className].filter(Boolean).join(' ')}
      {...rest}
    />
  )
}

import type { HTMLAttributes } from 'react'

// ─── Card ────────────────────────────────────────────────────────────────────
// The app's one surface: card fill, hairline border, the card radius and the
// control shadow. `interactive` is the version you can click — it lifts under
// the pointer, from CSS, so a reduced-motion setting can hold it still.

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'static' | 'interactive'
}

export function Card({ variant = 'static', className, ...rest }: CardProps) {
  return (
    <div
      data-variant={variant}
      className={['sb-card-surface', className].filter(Boolean).join(' ')}
      {...rest}
    />
  )
}

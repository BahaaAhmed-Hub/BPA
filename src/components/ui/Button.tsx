import type { ButtonHTMLAttributes, ReactNode } from 'react'

// ─── Button ──────────────────────────────────────────────────────────────────
// Every state this button has — hover, focus, disabled — is a CSS rule on
// `.sb-btn` in index.css. Nothing here writes a colour, and nothing anywhere
// writes one into `element.style` on mouseenter: a handler that paints cannot
// be caught by `prefers-reduced-motion`, cannot be a `:focus-visible` state,
// and re-states the palette one component at a time.
//
// **primary is ink; accent is for making something new.**
// The app had it both ways — ink for the sign-in button and the balance
// screen's action, amber for Finance's add-entry and the calendar's "+ Event" —
// which left amber meaning "primary" on one screen and "create" on the next.
// One rule: a solid ink button is the important action on a screen, and a solid
// amber one adds a thing that was not there before. If a screen has both, the
// amber one is the one that creates.
//
//   primary    ink fill, ink-on-dark label      the screen's main action
//   accent     amber fill, accent-ink label     new task, new event, add entry
//   secondary  card fill, border, ink label     the other action beside it
//   ghost      no fill until hovered            toolbars, icon rows, menus
//   danger     negative ink, tinted on hover    delete, revoke, sign out

export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  /** sm 28px · md 34px (--sb-h-pill). */
  size?: ButtonSize
  /** Fills its container — a form's submit, a menu row. */
  block?: boolean
  /** A round icon-only button: square, and the label is the title. */
  iconOnly?: boolean
  children?: ReactNode
}

export function Button({
  variant = 'secondary', size = 'md', block, iconOnly, className, type = 'button', ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      data-variant={variant}
      data-size={size}
      data-block={block ? '' : undefined}
      data-icon-only={iconOnly ? '' : undefined}
      className={['sb-btn', className].filter(Boolean).join(' ')}
      {...rest}
    />
  )
}

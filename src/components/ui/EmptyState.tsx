import type { ReactNode } from 'react'

// ─── EmptyState ──────────────────────────────────────────────────────────────
// "There is nothing here yet", said the same way everywhere. It was said in 48
// hand-written ways: centred and left-aligned, ink-3, ink-4 and — in one place —
// the *border* colour, which is 1.3:1 on the card and so was not said at all.
//
// `compact` is for inside a card or a settings row: left-aligned, one line of
// muted text. The default is for a whole panel or list: centred, with room, and
// an optional title and action — an empty screen should say what to do next.
//
// Text is ink-3 in both, the muted step that clears 4.5:1 on every ground.

export interface EmptyStateProps {
  title?: ReactNode
  children?: ReactNode
  action?: ReactNode
  compact?: boolean
  className?: string
}

export function EmptyState({ title, children, action, compact, className }: EmptyStateProps) {
  return (
    <div className={['sb-empty', className].filter(Boolean).join(' ')} data-compact={compact ? '' : undefined}>
      {title && <div className="sb-empty-title">{title}</div>}
      {children && <div className="sb-empty-body">{children}</div>}
      {action && <div className="sb-empty-action">{action}</div>}
    </div>
  )
}

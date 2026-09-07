import type { ButtonHTMLAttributes, ComponentType, ReactNode } from 'react'

// ─── NavRow ──────────────────────────────────────────────────────────────────
// One row in a navigation list, and one drawing of "you are here": an accent
// tint behind it, ink for the label, and a 4px dot at the end.
//
// There were three. The sidebar used the tint and the dot; the top nav used a
// white pill with a shadow and no fill at all, so "active" there was ink text
// beside muted text; the finance sub-nav filled the whole row solid amber. Two
// of those are gone. A person moving between the three navigations of one app
// should not have to learn what selected looks like three times.
//
// Collapsed drops the label and the dot and centres the icon — the dot has
// nowhere to sit once the row is a square, and the tint says it instead.

export interface NavRowProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
  collapsed?: boolean
  Icon?: ComponentType<{ size?: number; strokeWidth?: number; color?: string; style?: React.CSSProperties }>
  /** A glyph that is already an element — the top nav draws its own SVGs. */
  icon?: ReactNode
  label: string
  /** A count or a chip at the end of the row, in place of the dot. */
  trailing?: ReactNode
}

export function NavRow({
  active = false, collapsed = false, Icon, icon, label, trailing, className, type = 'button', ...rest
}: NavRowProps) {
  return (
    <button
      type={type}
      data-active={active ? '' : undefined}
      data-collapsed={collapsed ? '' : undefined}
      title={collapsed ? label : rest.title}
      className={['sb-nav-row', className].filter(Boolean).join(' ')}
      {...rest}
    >
      {Icon ? <Icon size={18} strokeWidth={active ? 2.25 : 1.75} style={{ flexShrink: 0 }} /> : icon}
      {!collapsed && <span className="sb-nav-row-label">{label}</span>}
      {!collapsed && (trailing ?? (active ? <span className="sb-nav-row-dot" /> : null))}
    </button>
  )
}

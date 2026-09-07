// ─── Shared inline controls ──────────────────────────────────────────────────
// A card or row shows an attribute as an icon; clicking that icon has to change
// the attribute rather than open the task. A native control laid invisibly over
// the icon keeps that behaviour keyboard- and mobile-friendly.

/** `data-nm` marks the element as "not the card body", so the row's own click
 *  handler ignores it and the task detail panel stays closed. */
const OVERLAY: React.CSSProperties = {
  position: 'absolute', inset: 0, width: '100%', height: '100%',
  opacity: 0, cursor: 'pointer', border: 'none', padding: 0, margin: 0,
}

export function OverlaySelect({ value, onChange, options, title }: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  title?: string
}) {
  return (
    <select
      data-nm
      title={title}
      value={value}
      onChange={e => onChange(e.target.value)}
      onClick={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      style={OVERLAY}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

export function OverlayTime({ value, onChange, title }: {
  value: string
  onChange: (v: string) => void
  title?: string
}) {
  return (
    <input
      data-nm
      type="time"
      title={title}
      value={value}
      onChange={e => onChange(e.target.value)}
      onClick={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      style={OVERLAY}
    />
  )
}

/** Wraps an icon so an overlay control can sit on top of it. */
export function ControlSlot({ size, children }: { size: number; children: React.ReactNode }) {
  return (
    <span data-nm style={{ position: 'relative', display: 'inline-flex', width: size, height: size, flexShrink: 0 }}>
      {children}
    </span>
  )
}

/** Any count in the module reads as a badge, never a loose number. */
export function CountBadge({ value, tone }: { value: number; tone?: 'dark' }) {
  return (
    <span style={{
      minWidth: 20, height: 20, boxSizing: 'border-box', padding: '0 6px',
      borderRadius: 'var(--sb-r-pill)', flexShrink: 0,
      background: tone === 'dark' ? 'color-mix(in srgb, var(--sb-ink-on-dark) 14%, transparent)' : 'var(--sb-field)',
      color: tone === 'dark' ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-3)',
      fontSize: 'var(--sb-t-micro)', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    }}>{value}</span>
  )
}

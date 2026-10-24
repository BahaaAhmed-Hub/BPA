
// ─── Design primitives (11A artboard) ────────────────────────────────────────

/** Cream pill used for both read-outs and small actions. */
export const PILL_BASE: React.CSSProperties = {
  background: 'var(--sb-field)',
  border: 'var(--sb-border-width) solid var(--sb-border)',
  borderRadius: 'var(--sb-r-sm)',
  color: 'var(--sb-ink-1)',
  fontSize: 'var(--sb-t-body)',
  fontWeight: 500,
  padding: '8px 14px',
  fontFamily: 'inherit',
  lineHeight: 1.2,
  whiteSpace: 'nowrap' as const,
  outline: 'none',
}

/** Native select dressed as a cream pill (keeps keyboard + full option list). */
export const pillSelectStyle: React.CSSProperties = {
  ...PILL_BASE,
  cursor: 'pointer',
  appearance: 'none' as const,
  WebkitAppearance: 'none' as const,
  paddingRight: 14,
  maxWidth: 260,
  textOverflow: 'ellipsis',
}

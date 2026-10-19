import type { CSSProperties } from 'react'

// ─── Fields — one input, in two densities ────────────────────────────────────
// Five modules each wrote their own `inputStyle`, and they disagreed on the
// radius (6, 8 and 9px), the ground (field in four, page in one), the height
// and the padding — so the same form looked different in Settings, the Library
// and Finance. These are the two shapes the app actually needs.
//
// None of them sets `outline`. An inline `outline: none` beats the global
// :focus-visible ring (an inline style outranks a stylesheet rule), which left
// every field that carried one with no focus indicator at all.

/** The default: a form field in a panel, a modal or a settings row. */
export const inputStyle: CSSProperties = {
  width: '100%', minWidth: 0, boxSizing: 'border-box',
  minHeight: 'max(var(--sb-h-min), var(--sb-h-pill))', padding: '6px 11px',
  borderRadius: 'var(--sb-r-chip)', border: 'var(--sb-border-width) solid var(--sb-border)',
  background: 'var(--sb-field)', color: 'var(--sb-ink-1)',
  fontFamily: 'var(--sb-font-ui)', fontSize: 'var(--sb-t-body)',
}

/** Inside a dense editor row (a shopping item, a store) where the default would crowd its neighbours. */
export const inputDenseStyle: CSSProperties = {
  ...inputStyle,
  minHeight: 'var(--sb-h-min)', padding: '4px 8px', fontSize: 'var(--sb-t-body-s)',
}

/** A select is an input that is not stretched to its row. */
export const selectStyle: CSSProperties = { ...inputStyle, width: 'auto', cursor: 'pointer' }

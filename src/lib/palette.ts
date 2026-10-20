// ─── One palette ─────────────────────────────────────────────────────────────
// Nine screens each kept their own `const C = {…}` of the same tokens under
// different names (`bg`/`page`, `surface`/`card`, `textPri`/`ink1`, `green`/
// `pos`…). Every value here is a `var(--sb-*)` string and nothing else, so a
// theme change reaches every screen and a colour is never typed twice.
//
// Add a key only for a token that has none; do not add a token to suit a key.
export const C = {
  // ground
  page:   'var(--sb-page)',
  card:   'var(--sb-card)',
  field:  'var(--sb-field)',
  /** The inset field and the muted chip, a shade between field and card. */
  inset:  'color-mix(in srgb, var(--sb-field) 88%, var(--sb-card))',
  border: 'var(--sb-border)',
  dashed: 'color-mix(in srgb, var(--sb-border) 78%, var(--sb-ink-4))',
  hair:   'var(--sb-hairline)',
  // ink
  ink1:   'var(--sb-ink-1)',
  ink2:   'var(--sb-ink-2)',
  ink3:   'var(--sb-ink-3)',
  /** Placeholders, disabled states and dividers only — never text to be read. */
  ink4:   'var(--sb-ink-4)',
  onInk:  'var(--sb-ink-on-dark)',
  onFill: 'var(--sb-ink-on-fill)',
  // accent
  accent:       'var(--sb-accent)',
  accentDeep:   'var(--sb-accent-deep)',
  accentTint:   'var(--sb-accent-tint)',
  accentTint2:  'var(--sb-accent-tint2)',
  accentBorder: 'var(--sb-accent-border)',
  accentWash:   'rgba(var(--sb-accent-rgb),0.12)',
  // meaning
  pos:      'var(--sb-positive)',
  posDeep:  'var(--sb-positive-deep)',
  posTint:  'var(--sb-positive-tint)',
  neg:      'var(--sb-negative)',
  negDeep:  'var(--sb-negative-deep)',
  negTint:  'var(--sb-negative-tint)',
  warn:     'var(--sb-warning)',
  warnTint: 'var(--sb-warning-tint)',
  info:     'var(--sb-info)',
  infoTint: 'var(--sb-info-tint)',
} as const

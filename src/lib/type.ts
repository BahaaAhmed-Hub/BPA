// ─── Type scale ──────────────────────────────────────────────────────────────
// Nine steps and nothing between them. The sizes are tokens (`--sb-t-*` in
// index.css) so a step can be moved once; the weight, tracking and case that
// go with a step live here, because a style object is what a call site can
// actually spread.
//
//   micro    10    700  .12em  uppercase   gutters, capsed captions
//   meta     11.5  500                     times, notes, the second line
//   body-s   12.5  400                     dense body — rows, feeds
//   body     13.5  400                     the default
//   label    13.5  600                     a value's name, a button
//   h3       15    600                     a section inside a panel
//   h2       18    600  -.02em             a form's heading, a day number
//   h1       27    600  -.03em             a page's own name
//   display  30    600  -.03em             the one figure a screen is about
//
// Two faces: Outfit sets anything that names a screen, a section or a figure;
// Instrument Sans says everything else. The step from h3 to label is a change
// of face as well as size, so 15 → 13.5 reads as a level rather than the
// pixel and a half it looks like on paper.
//
// A call site that spreads a level and then sets its own weight is overriding
// it deliberately — that is allowed, and it is why weight is not folded into
// the size token.

export const SANS = 'var(--sb-font-ui)'
export const DISPLAY = 'var(--sb-font-num)'
export const MONO = 'var(--sb-font-mono)'

export const T = {
  micro:   { fontFamily: SANS,    fontSize: 'var(--sb-t-micro)',   fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', lineHeight: 1.35 },
  meta:    { fontFamily: SANS,    fontSize: 'var(--sb-t-meta)',    fontWeight: 500, lineHeight: 1.4 },
  bodyS:   { fontFamily: SANS,    fontSize: 'var(--sb-t-body-s)',  fontWeight: 400, lineHeight: 1.45 },
  body:    { fontFamily: SANS,    fontSize: 'var(--sb-t-body)',    fontWeight: 400, lineHeight: 1.5 },
  label:   { fontFamily: SANS,    fontSize: 'var(--sb-t-label)',   fontWeight: 600, lineHeight: 1.4 },
  h3:      { fontFamily: DISPLAY, fontSize: 'var(--sb-t-h3)',      fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.3 },
  h2:      { fontFamily: DISPLAY, fontSize: 'var(--sb-t-h2)',      fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.25 },
  h1:      { fontFamily: DISPLAY, fontSize: 'var(--sb-t-h1)',      fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1.15 },
  display: { fontFamily: DISPLAY, fontSize: 'var(--sb-t-display)', fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1.1 },
} as const satisfies Record<string, React.CSSProperties>

/** A capsed caption — the eyebrow over a section, a day name in a header. It
 *  is the micro level, which is capsed by definition. */
export const CAPS: React.CSSProperties = T.micro

/** Figures line up column to column, whatever the digits. */
export const TABULAR: React.CSSProperties = { fontVariantNumeric: 'tabular-nums' }

// ─── Icons ───────────────────────────────────────────────────────────────────
// Three sizes, mirroring --sb-icon-* in index.css: lucide sets width and height
// as attributes, and an attribute cannot hold a var(). Two strokes — an icon
// that is only labelling something, and one that is carrying a state.
//
//   sm  14  inside a row, beside text
//   md  16  a control's own icon
//   lg  18  chrome — the nav rail, the top bar

export const ICON = { sm: 14, md: 16, lg: 18 } as const
export const STROKE = { rest: 1.75, active: 2.25 } as const

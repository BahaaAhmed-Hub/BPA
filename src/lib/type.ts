// ─── Type scale ──────────────────────────────────────────────────────────────
// Sunlit Bento runs on two faces and six sizes. Outfit sets things that name a
// screen or a section; Instrument Sans says everything else. Anything picking a
// size or a face by hand drifts, which is how one file ended up with sixteen
// sizes and four family declarations.
//
//   display  27  Outfit    the page's own name, an event's title
//   title    18  Outfit    a day number, a form's heading
//   heading  15  Outfit    a section within a panel — Attendees, Notes
//   body   13.5  Instrument Sans   field values, labels, names, buttons
//   small  11.5  Instrument Sans   meta beside or beneath body — times, notes
//   micro    10  Instrument Sans   the gutter, a card's time, capsed captions
//
// The step from heading to body is a change of face as well as size, so 15 → 13.5
// reads as a real level rather than the half-pixel it looks like on paper.

export const SANS = "'Instrument Sans', system-ui, sans-serif"
export const DISPLAY = "'Outfit', system-ui, sans-serif"

export const T = {
  display: { fontFamily: DISPLAY, fontSize: 27, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.12 },
  title:   { fontFamily: DISPLAY, fontSize: 18, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.2 },
  heading: { fontFamily: DISPLAY, fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.3 },
  body:    { fontFamily: SANS,    fontSize: 13.5, fontWeight: 500, lineHeight: 1.4 },
  small:   { fontFamily: SANS,    fontSize: 11.5, fontWeight: 500, lineHeight: 1.4 },
  micro:   { fontFamily: SANS,    fontSize: 10,   fontWeight: 500, lineHeight: 1.35 },
} as const satisfies Record<string, React.CSSProperties>

/** A capsed caption — the eyebrow over a section, a day name in a header. */
export const CAPS: React.CSSProperties = {
  ...T.micro, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
}

/** Ink, in the three weights the palette gives you. */
export const INK = '#191712'
export const MUTED = '#6C6553'
export const GHOST = '#9B9180'

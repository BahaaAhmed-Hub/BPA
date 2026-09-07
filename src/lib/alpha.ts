// ─── One colour at less than full strength ───────────────────────────────────
// A colour was made translucent by sticking two hex digits on the end of it —
// `${color}18` — which works only while `color` is a six-digit hex. The moment
// it became a token (`var(--sb-info)18`) the declaration was invalid, and an
// invalid declaration is not an error anybody sees: the border simply was not
// drawn, and the box it was on lost two pixels of height.
//
// `alpha()` says the same thing in a form that does not care which it is given.
// The percentages are the old hex suffixes converted once — 18 → 9.4%, 30 →
// 18.8%, CC → 80% — so nothing changed but the notation.

export function alpha(color: string, pct: number): string {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`
}

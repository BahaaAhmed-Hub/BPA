// ─── The ink that reads on a given background ────────────────────────────────
//
// A theme token cannot answer this. `--sb-ink-on-fill` is one value per theme,
// and it is the right answer for a *theme* fill — the primary button, the solid
// nav pill — because there the fill is a token too and the pair was chosen
// together. It is the wrong answer the moment the background is a **colour
// somebody chose**: an avatar's swatch, a company's dot, a calendar's colour, a
// category's. Those come out of `palettes.ts` or out of Google, they do not move
// when the theme does, and one fixed ink over a palette of a dozen hues is
// guaranteed to be unreadable on some of them.
//
// That is not hypothetical. The attendee avatars in the event panel drew their
// initials in `--sb-ink-1` — near-black — on `--sb-accent`, which is a
// terracotta in Warm Minimal and a deep green in Evergreen: 3.66 and 2.30
// against a required 4.5. In Glass the same row went the other way, near-white
// on a light violet at 2.31.
//
// So the ink is derived from the background, by measuring both candidates and
// taking the better one. A luminance threshold — "over 0.5 is light" — is the
// usual shortcut and it is wrong through the middle of the range, which is
// exactly where a mid-tone accent sits.

import { useSyncExternalStore } from 'react'

/** White, and an ink dark enough to carry 4.5 on anything white cannot. */
const LIGHT = '#FFFFFF'
const DARK  = '#14120E'

interface Rgb { r: number; g: number; b: number; a: number }

// ─── Resolving a colour ──────────────────────────────────────────────────────
//
// The strings this is handed are rarely hexes: they are `var(--sb-accent)`, or
// a `color-mix()` of two tokens. Only the browser can say what those come to,
// and only for an element that is *in the document* — a detached node inherits
// no custom properties, so `var()` resolves to nothing.

let probe: HTMLSpanElement | null = null
let cache = new Map<string, Rgb | null>()

// Three separate things move the tokens — the theme picker, the accent picker
// and the behavioral mode — and all three go through `applyThemeVars`. So the
// version is bumped there rather than being derived from any one of them, and a
// component that subscribes to it re-inks for all three.
let version = 0
const listeners = new Set<() => void>()

/** Called when the theme's tokens change: every `var()` answer just moved. */
export function resetInkCache(): void {
  cache = new Map()
  version += 1
  for (const fn of listeners) fn()
}

/**
 * `inkOn`, in a component that should redraw when the tokens move.
 *
 * The plain function is right for a fixed hex out of `palettes.ts` — that
 * answer cannot change. This is for anything resolved through a `var()`, where
 * the answer is only true of the theme that is on right now.
 */
export function useInkOn(): typeof inkOn {
  useTokenVersion()
  return inkOn
}

/** `inkOnKeeping`, for a component that should redraw when the tokens move. */
export function useInkOnKeeping(): typeof inkOnKeeping {
  useTokenVersion()
  return inkOnKeeping
}

function useTokenVersion(): number {
  return useSyncExternalStore(
    fn => { listeners.add(fn); return () => { listeners.delete(fn) } },
    () => version,
    () => version,
  )
}

function resolve(css: string): Rgb | null {
  if (cache.has(css)) return cache.get(css) ?? null
  let out: Rgb | null = null

  if (typeof document !== 'undefined') {
    if (!probe) {
      probe = document.createElement('span')
      probe.setAttribute('aria-hidden', 'true')
      probe.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none'
      document.body.appendChild(probe)
    }
    // `color` rather than `background-color`: both resolve the same functions,
    // and an invalid value leaves `color` at its inherited value rather than at
    // a transparent that cannot be told from a deliberate one.
    probe.style.color = 'rgb(1, 2, 3)'
    probe.style.color = css
    const got = parse(getComputedStyle(probe).color)
    // The sentinel coming back means the value was not understood.
    if (got && !(got.r === 1 && got.g === 2 && got.b === 3)) out = got
  }

  // No DOM, or nothing came back: a plain hex is still worth reading, since
  // that is what every colour in `palettes.ts` is.
  if (!out) out = fromHex(css)

  cache.set(css, out)
  return out
}

/**
 * A computed colour, in either form Chrome hands back.
 *
 * `color-mix()` does **not** come back as `rgb()`. Chrome computes it to
 * `color(srgb 0.9 0.8 0.75)` — the same three channels, but 0..1 rather than
 * 0..255. Reading those as 0..255 makes every mix a near-black, which is how a
 * pale tint ends up being told it wants white ink. The older `aa-theme.mjs`
 * audit had to learn the same thing.
 */
function parse(css: string): Rgb | null {
  const srgb = /^color\(srgb\s+([^)]+)\)$/i.exec(css.trim())
  if (srgb) {
    const p = srgb[1].split(/[\s/]+/).filter(Boolean).map(Number)
    if (p.length < 3 || p.some(Number.isNaN)) return null
    return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: p[3] === undefined ? 1 : p[3] }
  }
  const rgb = /rgba?\(([^)]+)\)/.exec(css)
  if (rgb) {
    const p = rgb[1].split(/[,\s/]+/).filter(Boolean).map(Number)
    if (p.length < 3 || p.some(Number.isNaN)) return null
    return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] }
  }
  return null
}

function fromHex(css: string): Rgb | null {
  const s = css.trim()
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s)
  if (!m) return null
  const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1]
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 }
}

// ─── Contrast ────────────────────────────────────────────────────────────────

function channel(v: number): number {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(c: Rgb): number {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
}

function composite(fg: Rgb, bg: Rgb): Rgb {
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  }
}

/** WCAG contrast between two opaque colours. */
export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// ─── What this is all for ────────────────────────────────────────────────────

/**
 * The colour `c` actually comes to, once everything behind it is mixed in.
 *
 * One layer is not enough. Glass & Depth's `--sb-field` is
 * `rgba(255,255,255,.035)`, so a 28% mix with the accent lands at alpha 0.31 —
 * and the card it sits on is translucent as well. Compositing once and then
 * treating the result as opaque reads that stack as a *pale* colour and asks
 * for near-black ink on a dark violet, which is the failure this whole file
 * exists to stop. So the chain runs until something opaque answers, and the
 * theme's own base is the backstop: nothing is behind the page.
 */
function solidify(c: Rgb, under: string): Rgb {
  if (c.a >= 1) return c
  const dark = typeof document !== 'undefined'
    && document.documentElement.getAttribute('data-theme') === 'dark'
  const base: Rgb = dark ? { r: 12, g: 11, b: 18, a: 1 } : { r: 255, g: 255, b: 255, a: 1 }

  let out = c
  for (const layer of [under, 'var(--sb-page)']) {
    const l = resolve(layer)
    if (!l) continue
    out = composite(out, l.a < 1 ? { ...l, a: 1 } : l)
    if (l.a >= 1) return out
    // The layer was translucent too: keep its own alpha for the next round.
    out = { ...out, a: Math.min(1, c.a + l.a) }
    if (out.a >= 1) return { ...out, a: 1 }
  }
  return composite(out, base)
}

/**
 * The ink to draw on `bg`: white where the background is dark, near-black where
 * it is light, decided by measuring both rather than by a luminance threshold.
 *
 * `under` is what the background sits on, and matters whenever it is not
 * opaque — a 28% tint of an accent is a pale colour on a pale ground and a dark
 * one on a dark ground, and the accent alone cannot say which.
 */
export function inkOn(bg: string, under = 'var(--sb-card)'): string {
  const c = resolve(bg)
  // Nothing could be read. Near-black is the safer guess than white: the
  // grounds in this app are pale in three themes out of four, and a wrong
  // white is invisible where a wrong black is merely heavy.
  if (!c) return DARK
  const solid = solidify(c, under)
  const light = resolve(LIGHT)!
  const dark = resolve(DARK)!
  return contrast(solid, light) >= contrast(solid, dark) ? LIGHT : DARK
}

/**
 * `preferred` where it can be read on `bg`, and the ink that can where it
 * cannot.
 *
 * For a glyph that carries a colour on purpose — the assistant's mark is drawn
 * in the accent — but whose purpose does not survive being invisible. The
 * accent is an amber on a near-black fill in Sunlit and reads at 9:1; the same
 * pairing in Evergreen is a deep green on near-black at 2.3, and in Glass a
 * light violet on a light fill at 2.31. This keeps the first and replaces the
 * other two.
 *
 * `min` is 3 for a glyph or a large label, 4.5 for ordinary text.
 */
export function inkOnKeeping(preferred: string, bg: string, min = 3, under = 'var(--sb-card)'): string {
  const c = resolve(bg)
  const p = resolve(preferred)
  if (!c || !p) return inkOn(bg, under)
  const solid = solidify(c, under)
  const ink = p.a < 1 ? composite(p, solid) : p
  return contrast(ink, solid) >= min ? preferred : inkOn(bg, under)
}

/**
 * How well a pair actually reads, for a screen that wants to say so — and for
 * the audit, which is the only reason to trust any of the above.
 */
export function contrastOf(fg: string, bg: string): number | null {
  const f = resolve(fg), b = resolve(bg)
  if (!f || !b) return null
  return contrast(f.a < 1 ? composite(f, b) : f, b)
}

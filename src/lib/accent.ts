// ─── The accent colour ───────────────────────────────────────────────────────
// The accent is the part of a theme that a person can move without leaving it:
// one colour, used for every highlight, chip, bar and today-marker in the app.
//
// This file computes and remembers it; it does not apply it. Writing to the
// document is `lib/themes.ts`'s job and only its job — an accent that painted
// itself could land before or after a theme depending on which ran last, and
// the tints would then belong to whichever won.
//
// The tints are computed rather than listed: an accent's tint is that accent
// against the surface behind it, and asking anybody to pick six of them is
// asking them to do the design system's job.

import type { SbToken } from './themes'

const KEY = 'professor-accent'
export const ACCENT_EVENT = 'professor:accentChanged'
export const DENSITY_EVENT = 'professor:densityChanged'

export interface Accent {
  id: string
  name: string
  hex: string
}

/** Warm, muted, and legible against every light theme's page. */
export const ACCENTS: Accent[] = [
  { id: 'amber',  name: 'Amber',  hex: '#F5D14E' },
  { id: 'coral',  name: 'Coral',  hex: '#EF8A63' },
  { id: 'sage',   name: 'Sage',   hex: '#8FB08A' },
  { id: 'sky',    name: 'Sky',    hex: '#7FA9D8' },
  { id: 'lilac',  name: 'Lilac',  hex: '#AE96D8' },
  { id: 'clay',   name: 'Clay',   hex: '#D68F6A' },
]

/** No accent picked is a real answer, and it is the default one: the theme's
 *  own accent stands. Only an explicit pick overrides it — otherwise choosing
 *  Evergreen got you Evergreen's surfaces under Sunlit's amber. */
export const NO_ACCENT = ''

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** `amount` of the accent, the rest whatever it is being mixed towards. */
function mix(hex: string, amount: number, towards: [number, number, number]): string {
  const [r, g, b] = rgb(hex)
  const out = [r, g, b].map((c, i) => Math.round(towards[i] + (c - towards[i]) * amount))
  return `#${out.map(c => c.toString(16).padStart(2, '0')).join('')}`
}

const PAPER: [number, number, number] = [255, 255, 255]
const INK:   [number, number, number] = [25, 23, 18]
/** Glass & Depth's page, which is what a tint on a dark theme sits on. */
const NIGHT: [number, number, number] = [14, 17, 22]

/** WCAG relative luminance — the one honest way to ask whether a fill is light
 *  or dark, rather than eyeballing the hex. */
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map(c => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** The accent family derived from one colour: the fills, the tints, the border
 *  and — the part that is not a matter of taste — what a label drawn *on* the
 *  accent has to be, which flips as soon as the accent is darker than the ink
 *  midpoint. Returned as a token overlay for `applyThemeVars` to merge. */
export function accentTokens(hex: string, isDark = false): Partial<Record<SbToken, string>> {
  const ground = isDark ? NIGHT : PAPER
  return {
    '--sb-accent':        hex,
    '--sb-accent-rgb':    rgb(hex).join(','),
    '--sb-accent-ink':    luminance(hex) > 0.32 ? '#191712' : '#F7F8FC',
    '--sb-accent-deep':   isDark ? mix(hex, 0.72, PAPER) : mix(hex, 0.70, INK),
    '--sb-accent-tint':   mix(hex, isDark ? 0.18 : 0.14, ground),
    '--sb-accent-tint2':  mix(hex, isDark ? 0.24 : 0.17, ground),
    '--sb-accent-border': mix(hex, isDark ? 0.42 : 0.45, ground),
  }
}

export function accentById(id: string): Accent | undefined {
  return ACCENTS.find(a => a.id === id)
}

/** The picked accent's id, or `''` for "whatever the theme says". */
export function loadAccent(): string {
  try { return localStorage.getItem(KEY) || NO_ACCENT } catch { return NO_ACCENT }
}

/** Remember it and say so. `lib/themes.ts` is listening and does the writing. */
export function saveAccent(id: string): void {
  try { localStorage.setItem(KEY, id) } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent(ACCENT_EVENT, { detail: id }))
}

// ─── Density ─────────────────────────────────────────────────────────────────
// Every spacing in this app is a pixel inside a style object, so the honest way
// to tighten all of it at once is to scale the page — which is what a browser's
// own zoom does, and what the setting means.

const DENSITY_KEY = 'professor-compact'
export const COMPACT_SCALE = 0.9

export function loadCompact(): boolean {
  try { return localStorage.getItem(DENSITY_KEY) === '1' } catch { return false }
}

export function saveCompact(on: boolean): void {
  try { localStorage.setItem(DENSITY_KEY, on ? '1' : '0') } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent(DENSITY_EVENT, { detail: on }))
}

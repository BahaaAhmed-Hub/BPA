// ─── The accent colour ───────────────────────────────────────────────────────
// Appearance offered five dark themes the app cannot draw — every module is
// painted in the Sunlit palette, in hex, in about eighteen hundred places — so
// picking one changed nothing anybody could see. The accent is the part of that
// palette that *can* move: one colour, used for every highlight, chip, bar and
// today-marker in the app. So it is a real setting, and it is applied the only
// way a setting can be applied to a thousand hard-coded styles — the hexes were
// replaced by `var(--sb-accent)` and this writes that variable.
//
// The tints are computed rather than listed: an accent's tint is that accent
// against paper, and asking anybody to pick five of them is asking them to do
// the design system's job.

const KEY = 'professor-accent'
export const ACCENT_EVENT = 'professor:accentChanged'

export interface Accent {
  id: string
  name: string
  hex: string
}

/** Warm, muted, and all legible against the Sunlit page. */
export const ACCENTS: Accent[] = [
  { id: 'amber',  name: 'Amber',  hex: '#F5D14E' },
  { id: 'coral',  name: 'Coral',  hex: '#EF8A63' },
  { id: 'sage',   name: 'Sage',   hex: '#8FB08A' },
  { id: 'sky',    name: 'Sky',    hex: '#7FA9D8' },
  { id: 'lilac',  name: 'Lilac',  hex: '#AE96D8' },
  { id: 'clay',   name: 'Clay',   hex: '#D68F6A' },
]

export const DEFAULT_ACCENT = 'amber'

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** `amount` of the accent, the rest paper (or ink, for a negative amount). */
function mix(hex: string, amount: number, towards: [number, number, number]): string {
  const [r, g, b] = rgb(hex)
  const out = [r, g, b].map((c, i) => Math.round(towards[i] + (c - towards[i]) * amount))
  return `#${out.map(c => c.toString(16).padStart(2, '0')).join('')}`
}

const PAPER: [number, number, number] = [255, 255, 255]
const INK:   [number, number, number] = [25, 23, 18]

export function accentById(id: string): Accent {
  return ACCENTS.find(a => a.id === id) ?? ACCENTS[0]
}

export function loadAccent(): string {
  try { return localStorage.getItem(KEY) || DEFAULT_ACCENT } catch { return DEFAULT_ACCENT }
}

export function saveAccent(id: string): void {
  try { localStorage.setItem(KEY, id) } catch { /* private mode */ }
  applyAccent(id)
  window.dispatchEvent(new CustomEvent(ACCENT_EVENT, { detail: id }))
}

/** Write the accent and everything derived from it onto the document. */
export function applyAccent(id: string = loadAccent()): void {
  const { hex } = accentById(id)
  const s = document.documentElement.style
  s.setProperty('--sb-accent', hex)
  s.setProperty('--sb-accent-rgb', rgb(hex).join(','))
  s.setProperty('--sb-accent-tint',   mix(hex, 0.14, PAPER))
  s.setProperty('--sb-accent-tint2',  mix(hex, 0.17, PAPER))
  s.setProperty('--sb-accent-border', mix(hex, 0.45, PAPER))
  s.setProperty('--sb-accent-deep',   mix(hex, 0.70, INK))
}

// ─── Density ─────────────────────────────────────────────────────────────────
// "Compact" was saved and read by nothing. Every spacing in this app is written
// in pixels inside a style object, so the honest way to tighten all of it at
// once is to scale the page — which is what a browser's own zoom does, and what
// the setting means.

const DENSITY_KEY = 'professor-compact'
export const COMPACT_SCALE = 0.9

export function loadCompact(): boolean {
  try { return localStorage.getItem(DENSITY_KEY) === '1' } catch { return false }
}

export function applyCompact(on: boolean = loadCompact()): void {
  // `zoom` and not `transform`: a transform would take the fixed-position
  // panels and the popovers out of alignment with what they are anchored to.
  document.documentElement.style.zoom = on ? String(COMPACT_SCALE) : ''
}

export function saveCompact(on: boolean): void {
  try { localStorage.setItem(DENSITY_KEY, on ? '1' : '0') } catch { /* private mode */ }
  applyCompact(on)
}

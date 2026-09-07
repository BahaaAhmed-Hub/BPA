// ─── Themes: one token contract ──────────────────────────────────────────────
// A theme is a map from `--sb-*` names to values, and nothing else. Adding a
// token means adding it to `SbToken`; every theme then has to answer for it,
// which is the point of a contract.
//
// The set below is exactly the THEME-DEPENDENT half of index.css's `:root` —
// surfaces, the ink ramp, the accent, the semantics, the shadows, the two
// faces and the surface blur. The other half of that block (radii, the type
// scale, control heights, icon sizes, border weights, the mono face) is the
// shape of the app rather than its colour: no theme writes it, so it is not
// here.
//
// This file is also the only thing in the app that writes to
// `document.documentElement.style`. Two writers meant the accent picker could
// win against the theme and a behavioural mode could win against both, in an
// order that depended on which one happened to run last.

import { accentById, accentTokens, loadAccent, loadCompact, COMPACT_SCALE } from './accent'
import { useBehavioralStore, type BehavioralMode } from '@/store/behavioralStore'

/** Every `--sb-*` token a theme owns. */
export type SbToken =
  // Surfaces
  | '--sb-page'
  | '--sb-header'
  | '--sb-card'
  | '--sb-field'
  | '--sb-border'
  | '--sb-hairline'
  // Ink ramp
  | '--sb-ink-1'
  | '--sb-ink-2'
  | '--sb-ink-3'
  | '--sb-ink-4'
  /** The ink that reads on an `--sb-ink-1` *fill* — the primary button, the
   *  inverted panel, the solid pill. On a light theme that fill is near-black
   *  and this is near-white; on a dark one the fill is near-white and this is
   *  near-black. It is named for the light-theme case it was born in. */
  | '--sb-ink-on-dark'
  /** What a label on a solid *semantic* fill is drawn in — a tick on green, a
   *  count on red. Near-white where the semantics are saturated and dark,
   *  near-black on Glass & Depth, where they are bright. */
  | '--sb-ink-on-fill'
  // Accent
  | '--sb-accent'
  /** Components, not a colour: `rgba(var(--sb-accent-rgb), .2)`. */
  | '--sb-accent-rgb'
  /** What a label on a solid accent fill is drawn in. Dark on a bright accent,
   *  light on a dark one — see Evergreen, whose accent is darker than the ink
   *  midpoint and whose buttons therefore carry pale text. */
  | '--sb-accent-ink'
  /** The accent at text weight against its own tint — deeper on a light theme,
   *  brighter on a dark one. */
  | '--sb-accent-deep'
  | '--sb-accent-tint'
  | '--sb-accent-tint2'
  | '--sb-accent-border'
  // Semantics
  | '--sb-positive'
  | '--sb-positive-deep'
  | '--sb-positive-tint'
  | '--sb-negative'
  | '--sb-negative-deep'
  | '--sb-negative-tint'
  | '--sb-info'
  | '--sb-info-tint'
  | '--sb-warning'
  | '--sb-warning-tint'
  // Shadows — four heights, a sideways one for panels, and the hard offset
  // under an accent pill, which is a shape rather than a height.
  | '--sb-shadow-control'
  | '--sb-shadow-hover'
  | '--sb-shadow-menu'
  | '--sb-shadow-frame'
  | '--sb-shadow-panel'
  | '--sb-shadow-accent'
  // Faces. The mono face is fixed across themes and lives in index.css.
  | '--sb-font-ui'
  | '--sb-font-num'
  /** How much the surfaces blur what is behind them. `0px` on an opaque theme,
   *  which the browser can skip entirely. */
  | '--sb-surface-blur'

export interface AppTheme {
  id: string
  name: string
  isDark: boolean
  tokens: Record<SbToken, string>
}

export const THEMES: AppTheme[] = [
  // ── Sunlit Bento ──────────────────────────────────────────────────────────
  // The default, and verbatim index.css's `:root` — applying it has to be a
  // no-op, or the app would repaint itself on the way in.
  {
    id: 'sunlit-bento', name: 'Sunlit Bento', isDark: false,
    tokens: {
      '--sb-page':          '#F7F4EA',
      '--sb-header':        '#FCFAF4',
      '--sb-card':          '#FFFFFF',
      '--sb-field':         '#FAF7EC',
      '--sb-border':        '#E8E1CE',
      '--sb-hairline':      '#F0EBDC',
      '--sb-ink-1':         '#191712',
      '--sb-ink-2':         '#4A4438',
      '--sb-ink-3':         '#6C6553',
      '--sb-ink-4':         '#756F60',
      '--sb-ink-on-dark':   '#FDF8E7',
      '--sb-ink-on-fill':   '#FFFFFF',
      '--sb-accent':        '#F5D14E',
      '--sb-accent-rgb':    '245,209,78',
      '--sb-accent-ink':    '#191712',
      '--sb-accent-deep':   '#7A5F09',
      '--sb-accent-tint':   '#FEF7DE',
      '--sb-accent-tint2':  '#FDF6DE',
      '--sb-accent-border': '#EFE1B4',
      '--sb-positive':      '#0C8140',
      '--sb-positive-deep': '#0A6B36',
      '--sb-positive-tint': '#E2F0E7',
      '--sb-negative':      '#C62828',
      '--sb-negative-deep': '#A31C1C',
      '--sb-negative-tint': '#FAE3E3',
      '--sb-info':          '#685FD7',
      '--sb-info-tint':     '#EDEBFA',
      '--sb-warning':       '#B26A00',
      '--sb-warning-tint':  '#FBEEDC',
      '--sb-shadow-control': '0 1px 3px rgba(25,23,18,.14)',
      '--sb-shadow-hover':   '0 4px 12px -6px rgba(48,40,20,.4)',
      '--sb-shadow-menu':    '0 12px 32px -12px rgba(48,40,20,.28)',
      '--sb-shadow-frame':   '0 26px 64px -34px rgba(48,40,20,.5)',
      '--sb-shadow-panel':  '-8px 0 40px -12px rgba(48,40,20,.28)',
      '--sb-shadow-accent':  '0 2px 0 rgba(120,92,0,.25)',
      '--sb-font-ui':       "'Instrument Sans', system-ui, sans-serif",
      '--sb-font-num':      "'Outfit', system-ui, sans-serif",
      '--sb-surface-blur':  '0px',
    },
  },

  // ── Glass & Depth ─────────────────────────────────────────────────────────
  // The only dark theme, and the only one whose surfaces are translucent: the
  // card, the header and the fields are washes over the page rather than
  // colours of their own, so `--sb-surface-blur` has something to do. Every
  // tint is an rgba for the same reason — a solid tint over a translucent card
  // would read as a hole in it.
  {
    id: 'glass-depth', name: 'Glass & Depth', isDark: true,
    tokens: {
      '--sb-page':          '#0E1116',
      '--sb-header':        'rgba(23,28,36,.72)',
      '--sb-card':          'rgba(26,32,41,.66)',
      '--sb-field':         'rgba(9,12,17,.55)',
      '--sb-border':        'rgba(233,240,252,.12)',
      '--sb-hairline':      'rgba(233,240,252,.07)',
      '--sb-ink-1':         '#F2F5FA',
      '--sb-ink-2':         '#C6CEDA',
      '--sb-ink-3':         '#A7B1BF',
      '--sb-ink-4':         '#939DAC',
      '--sb-ink-on-dark':   '#0B0F14',
      '--sb-ink-on-fill':   '#08121C',
      '--sb-accent':        '#6BA8FF',
      '--sb-accent-rgb':    '107,168,255',
      '--sb-accent-ink':    '#07121F',
      '--sb-accent-deep':   '#A6C9FF',
      '--sb-accent-tint':   'rgba(107,168,255,.16)',
      '--sb-accent-tint2':  'rgba(107,168,255,.22)',
      '--sb-accent-border': 'rgba(107,168,255,.42)',
      '--sb-positive':      '#4ADE95',
      '--sb-positive-deep': '#84EFB8',
      '--sb-positive-tint': 'rgba(74,222,149,.16)',
      '--sb-negative':      '#FF7B7B',
      '--sb-negative-deep': '#FFA9A9',
      '--sb-negative-tint': 'rgba(255,123,123,.16)',
      '--sb-info':          '#9AACFF',
      '--sb-info-tint':     'rgba(154,172,255,.16)',
      '--sb-warning':       '#E8B24C',
      '--sb-warning-tint':  'rgba(232,178,76,.16)',
      '--sb-shadow-control': '0 1px 3px rgba(0,0,0,.55)',
      '--sb-shadow-hover':   '0 4px 14px -6px rgba(0,0,0,.7)',
      '--sb-shadow-menu':    '0 12px 36px -12px rgba(0,0,0,.75)',
      '--sb-shadow-frame':   '0 26px 70px -34px rgba(0,0,0,.85)',
      '--sb-shadow-panel':  '-8px 0 44px -12px rgba(0,0,0,.7)',
      '--sb-shadow-accent':  '0 2px 0 rgba(7,18,31,.45)',
      '--sb-font-ui':       "'Plus Jakarta Sans', system-ui, sans-serif",
      '--sb-font-num':      "'Plus Jakarta Sans', system-ui, sans-serif",
      '--sb-surface-blur':  '18px',
    },
  },

  // ── Evergreen ─────────────────────────────────────────────────────────────
  // A light theme whose accent is *darker* than the ink midpoint, which
  // inverts the polarity every accent fill in the app assumed: a label on
  // green has to be pale. `--sb-accent-ink` is what says so.
  {
    id: 'evergreen', name: 'Evergreen', isDark: false,
    tokens: {
      '--sb-page':          '#F1F5F1',
      '--sb-header':        '#F8FBF7',
      '--sb-card':          '#FFFFFF',
      '--sb-field':         '#F3F8F2',
      '--sb-border':        '#DBE5D9',
      '--sb-hairline':      '#EBF1E9',
      '--sb-ink-1':         '#101E19',
      '--sb-ink-2':         '#33453D',
      '--sb-ink-3':         '#4F6259',
      '--sb-ink-4':         '#546960',
      '--sb-ink-on-dark':   '#F1F8F3',
      '--sb-ink-on-fill':   '#FFFFFF',
      '--sb-accent':        '#155E4B',
      '--sb-accent-rgb':    '21,94,75',
      '--sb-accent-ink':    '#F1F8F3',
      '--sb-accent-deep':   '#0E4437',
      '--sb-accent-tint':   '#E2EFEA',
      '--sb-accent-tint2':  '#D8E9E2',
      '--sb-accent-border': '#B0CFC3',
      '--sb-positive':      '#0C8140',
      '--sb-positive-deep': '#0A6B36',
      '--sb-positive-tint': '#E0F0E6',
      '--sb-negative':      '#B4302A',
      '--sb-negative-deep': '#93211C',
      '--sb-negative-tint': '#F7E2E1',
      '--sb-info':          '#2A5DA8',
      '--sb-info-tint':     '#E4EBF6',
      '--sb-warning':       '#8A5A12',
      '--sb-warning-tint':  '#F3EBDC',
      '--sb-shadow-control': '0 1px 3px rgba(16,30,25,.14)',
      '--sb-shadow-hover':   '0 4px 12px -6px rgba(16,44,34,.4)',
      '--sb-shadow-menu':    '0 12px 32px -12px rgba(16,44,34,.28)',
      '--sb-shadow-frame':   '0 26px 64px -34px rgba(16,44,34,.5)',
      '--sb-shadow-panel':  '-8px 0 40px -12px rgba(16,44,34,.28)',
      '--sb-shadow-accent':  '0 2px 0 rgba(8,44,34,.3)',
      '--sb-font-ui':       "'Instrument Sans', system-ui, sans-serif",
      '--sb-font-num':      "'Plus Jakarta Sans', system-ui, sans-serif",
      '--sb-surface-blur':  '0px',
    },
  },

  // ── Ink & Paper ───────────────────────────────────────────────────────────
  // Nothing warm and nothing coloured but the accent, which is also darker
  // than the ink midpoint — the second theme that inverts accent polarity, and
  // the reason that is a token rather than a special case.
  {
    id: 'ink-paper', name: 'Ink & Paper', isDark: false,
    tokens: {
      '--sb-page':          '#F5F5F3',
      '--sb-header':        '#FBFBFA',
      '--sb-card':          '#FFFFFF',
      '--sb-field':         '#F3F3F1',
      '--sb-border':        '#E2E2DE',
      '--sb-hairline':      '#EFEFEC',
      '--sb-ink-1':         '#14161A',
      '--sb-ink-2':         '#3B4048',
      '--sb-ink-3':         '#585E67',
      '--sb-ink-4':         '#5D636B',
      '--sb-ink-on-dark':   '#F7F7F5',
      '--sb-ink-on-fill':   '#FFFFFF',
      '--sb-accent':        '#1F3A8A',
      '--sb-accent-rgb':    '31,58,138',
      '--sb-accent-ink':    '#F7F8FC',
      '--sb-accent-deep':   '#172C69',
      '--sb-accent-tint':   '#E7EAF4',
      '--sb-accent-tint2':  '#DDE2F0',
      '--sb-accent-border': '#B6C0E0',
      '--sb-positive':      '#0A7439',
      '--sb-positive-deep': '#0A6B36',
      '--sb-positive-tint': '#E1EFE7',
      '--sb-negative':      '#C62828',
      '--sb-negative-deep': '#A31C1C',
      '--sb-negative-tint': '#F8E3E3',
      '--sb-info':          '#2A5DA8',
      '--sb-info-tint':     '#E4EAF5',
      '--sb-warning':       '#8A5A12',
      '--sb-warning-tint':  '#F2EBDD',
      '--sb-shadow-control': '0 1px 3px rgba(20,22,26,.14)',
      '--sb-shadow-hover':   '0 4px 12px -6px rgba(20,22,26,.4)',
      '--sb-shadow-menu':    '0 12px 32px -12px rgba(20,22,26,.26)',
      '--sb-shadow-frame':   '0 26px 64px -34px rgba(20,22,26,.5)',
      '--sb-shadow-panel':  '-8px 0 40px -12px rgba(20,22,26,.26)',
      '--sb-shadow-accent':  '0 2px 0 rgba(12,20,48,.3)',
      '--sb-font-ui':       "'Outfit', system-ui, sans-serif",
      '--sb-font-num':      "'Outfit', system-ui, sans-serif",
      '--sb-surface-blur':  '0px',
    },
  },
]

export const DEFAULT_THEME_ID = 'sunlit-bento'

// Every theme that came before this one was a set of dark background values
// sitting behind cards and text painted in fixed light-theme hexes, so all
// eleven of them rendered as an unreadable mixture. There is nothing in them
// worth migrating to: whatever was saved, the answer is the default.
const LEGACY_MAP: Record<string, string> = {
  'dark-warm': DEFAULT_THEME_ID,
  'dark-cool': DEFAULT_THEME_ID,
  'navy-night': DEFAULT_THEME_ID,
  'midnight': DEFAULT_THEME_ID,
  'obsidian': DEFAULT_THEME_ID,
  'forest': DEFAULT_THEME_ID,
  'crimson': DEFAULT_THEME_ID,
  'violet': DEFAULT_THEME_ID,
  'amber': DEFAULT_THEME_ID,
  'teal': DEFAULT_THEME_ID,
  'rose': DEFAULT_THEME_ID,
  'light': DEFAULT_THEME_ID,
}

export function resolveThemeId(id: string): string {
  return LEGACY_MAP[id] ?? (THEMES.some(t => t.id === id) ? id : DEFAULT_THEME_ID)
}

export function getTheme(id: string): AppTheme {
  const resolved = resolveThemeId(id)
  return THEMES.find(t => t.id === resolved) ?? THEMES[0]
}

// ─── The one writer ──────────────────────────────────────────────────────────

/** A behavioural mode moves the accent and nothing else. It is a token overlay
 *  merged before the write, not a second thing that paints the document after
 *  the theme has — which is what it used to be, in a component, as a hard-coded
 *  logo background that no other accent-coloured thing on screen agreed with. */
const MODE_ACCENT: Record<BehavioralMode, string> = {
  samurai: '#A32320',
  pharaoh: '#C89B25',
  astral:  '#6659D8',
}

export type TokenOverlay = Partial<Record<SbToken, string>>

/** The whole of theming: write the tokens. `html, body` already read
 *  `var(--sb-page)` and `var(--sb-ink-1)`, so there is nothing to paint by
 *  hand, and no second vocabulary to keep in step. */
export function applyThemeVars(theme: AppTheme, overlay?: TokenOverlay): void {
  const style = document.documentElement.style
  const tokens = overlay ? { ...theme.tokens, ...overlay } : theme.tokens
  for (const [token, value] of Object.entries(tokens)) {
    style.setProperty(token, value)
  }
  // Not a colour write: `color-scheme` is how the native date pickers,
  // scrollbars and autofill find out which way round the theme is.
  document.documentElement.setAttribute('data-theme', theme.isDark ? 'dark' : 'light')
}

function persistedThemeId(): string {
  // Zustand's persist keeps `{ state: {...}, version }`; read it directly so
  // the theme is on the document before React — and before the store — exists.
  try {
    const raw = localStorage.getItem('professor-ui')
    return raw ? (JSON.parse(raw)?.state?.themeId ?? DEFAULT_THEME_ID) : DEFAULT_THEME_ID
  } catch { return DEFAULT_THEME_ID }
}

function persistedBehavioral(): { enabled: boolean; mode: BehavioralMode } {
  try {
    const raw = localStorage.getItem('professor-behavioral')
    const s = raw ? JSON.parse(raw)?.state : null
    return { enabled: !!s?.enabled, mode: (s?.mode as BehavioralMode) ?? 'samurai' }
  } catch { return { enabled: false, mode: 'samurai' } }
}

export interface Appearance {
  themeId?: string
  accentId?: string
  /** `null` for none — which is what leaving a mode has to pass, or the base
   *  theme's own accent never comes back. */
  mode?: BehavioralMode | null
}

/** Compose the theme, the accent and the behavioural mode into one set of
 *  values and write it once. Anything not passed is read from where it was
 *  persisted, so this is also what runs before the first paint. */
export function applyAppearance(a: Appearance = {}): void {
  const theme = getTheme(a.themeId ?? persistedThemeId())

  const behavioral = persistedBehavioral()
  const mode = a.mode !== undefined ? a.mode : (behavioral.enabled ? behavioral.mode : null)

  // A mode's accent outranks a picked one — it is the louder statement, and it
  // goes back the moment the mode does. With neither, the theme's own accent
  // stands: an unpicked accent is not amber, it is nothing to say.
  const accentId = a.accentId ?? loadAccent()
  const hex = mode ? MODE_ACCENT[mode] : accentById(accentId)?.hex

  const overlay: TokenOverlay =
    !hex || hex.toUpperCase() === theme.tokens['--sb-accent'].toUpperCase()
      ? {}
      : accentTokens(hex, theme.isDark)

  applyThemeVars(theme, overlay)
  applyDensity()
}

/** Density is a page zoom rather than a token — every spacing in this app is a
 *  pixel inside a style object — but it is still a write to the document, and
 *  those all live here. */
export function applyDensity(on: boolean = loadCompact()): void {
  // `zoom` and not `transform`: a transform would take the fixed-position
  // panels and the popovers out of alignment with what they are anchored to.
  document.documentElement.style.zoom = on ? String(COMPACT_SCALE) : ''
}

/** Keep the document in step with the three things that move it. Called once,
 *  from main.tsx. */
export function initAppearance(): void {
  applyAppearance()
  window.addEventListener('professor:accentChanged', () => applyAppearance())
  window.addEventListener('professor:densityChanged', () => applyDensity())
  // The mode is passed rather than re-read: persist writes the store to
  // localStorage from the same set(), and a listener that read it back could
  // arrive first and paint the mode you just left.
  let last = ''
  useBehavioralStore.subscribe(s => {
    const key = `${s.enabled}:${s.mode}`
    if (key === last) return
    last = key
    applyAppearance({ mode: s.enabled ? s.mode : null })
  })
}

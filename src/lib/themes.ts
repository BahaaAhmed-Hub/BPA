// ─── Themes: one token contract ──────────────────────────────────────────────
// A theme is a map from `--sb-*` names to values, and nothing else. Adding a
// token means adding it to `SbToken`; every theme then has to answer for it,
// which is the point of a contract.
//
// The set below is exactly the THEME-DEPENDENT half of index.css's `:root`.
// The other half of that block — radii, the type scale, control heights, icon
// sizes, border weights, the mono face — is the shape of the app rather than
// its colour: no theme writes it, so it is not here.
//
// This file is also the only thing in the app that writes to
// `document.documentElement.style`. Two writers meant the accent picker could
// win against the theme and a behavioural mode could win against both, in an
// order that depended on which one happened to run last.

import { accentById, accentTokens, loadAccent, loadCompact, COMPACT_SCALE } from './accent'
import { useBehavioralStore, type BehavioralMode } from '@/store/behavioralStore'

/** Every `--sb-*` token a theme owns. */
export type SbToken =
  | '--sb-page' | '--sb-header' | '--sb-card' | '--sb-field'
  | '--sb-border' | '--sb-hairline' | '--sb-surface-blur'
  | '--sb-ink-1' | '--sb-ink-2' | '--sb-ink-3' | '--sb-ink-4' | '--sb-ink-on-dark'
  /** What a label on a solid *semantic* fill is drawn in — a tick on green, a
   *  count on red. Near-white where those fills are saturated and dark,
   *  near-black on a theme whose greens and reds are bright. */
  | '--sb-ink-on-fill'
  | '--sb-accent' | '--sb-accent-ink' | '--sb-accent-tint' | '--sb-accent-tint2'
  | '--sb-accent-border'
  /** Components, not a colour: `rgba(var(--sb-accent-rgb), .2)`. */
  | '--sb-accent-rgb'
  /** The accent at text weight against its own tint — deeper on a light theme,
   *  brighter on a dark one. */
  | '--sb-accent-deep'
  | '--sb-positive' | '--sb-positive-deep' | '--sb-positive-tint'
  | '--sb-negative' | '--sb-negative-deep' | '--sb-negative-tint'
  /** Six colours that only have to stay apart from each other — the task
   *  types, and anything else that is a set rather than a scale of meaning.
   *  Each is at or above 4.5:1 on its theme's --sb-card. */
  | '--sb-cat-1' | '--sb-cat-2' | '--sb-cat-3'
  | '--sb-cat-4' | '--sb-cat-5' | '--sb-cat-6'
  | '--sb-info' | '--sb-info-tint'
  | '--sb-warning' | '--sb-warning-tint'
  | '--sb-shadow-frame' | '--sb-shadow-hover' | '--sb-shadow-control'
  | '--sb-shadow-menu' | '--sb-shadow-panel' | '--sb-shadow-accent'
  | '--sb-font-ui' | '--sb-font-num'

export interface AppTheme {
  id: string
  name: string
  isDark: boolean
  tokens: Record<SbToken, string>
}

// Each theme is given in two parts. The first is the theme as specified. The
// second, marked *derived*, is the rest of the contract: eleven tokens the app
// reads in 453 places — the accent as components, the accent at text weight,
// the ink on a semantic fill, an informational and a warning hue with their
// tints, and two more shadows. They are not extras: a `var()` naming a
// property nobody set is an invalid declaration, and an invalid declaration is
// not an error anybody sees — the text is simply not drawn.

export const THEMES: AppTheme[] = [
  {
    id: 'sunlit-bento', name: 'Sunlit Bento', isDark: false,
    tokens: {
      '--sb-page': '#F7F4EA', '--sb-header': '#FCFAF4',
      '--sb-card': '#FFFFFF', '--sb-field': '#FAF7EC',
      '--sb-border': '#E8E1CE', '--sb-hairline': '#F0EBDC',
      '--sb-surface-blur': '0px',
      '--sb-ink-1': '#191712', '--sb-ink-2': '#4A4438',
      '--sb-ink-3': '#6C6553', '--sb-ink-4': '#7C7565',
      '--sb-ink-on-dark': '#FDF8E7',
      '--sb-accent': '#F5D14E', '--sb-accent-ink': '#191712',
      '--sb-accent-tint': '#FEF7DE', '--sb-accent-tint2': '#FDF6DE',
      '--sb-accent-border': '#EFE1B4',
      '--sb-positive': '#0C8140', '--sb-positive-deep': '#0A6B36',
      '--sb-positive-tint': '#E2F0E7',
      '--sb-negative': '#C62828', '--sb-negative-deep': '#A31C1C',
      '--sb-negative-tint': '#FAE3E3',
      '--sb-shadow-frame':   '0 26px 64px -34px rgba(48,40,20,.5)',
      '--sb-shadow-hover':   '0 4px 12px -6px rgba(48,40,20,.4)',
      '--sb-shadow-control': '0 1px 3px rgba(25,23,18,.14)',
      '--sb-shadow-menu':    '0 12px 32px -12px rgba(48,40,20,.28)',
      '--sb-font-ui':  "'Instrument Sans', system-ui, sans-serif",
      '--sb-font-num': "'Outfit', system-ui, sans-serif",
      // derived
      '--sb-ink-on-fill':   '#FFFFFF',
      '--sb-accent-rgb':    '245,209,78',
      '--sb-accent-deep':   '#7A5F09',
      '--sb-cat-1':       '#685FD7',
      '--sb-cat-2':       '#177C5B',
      '--sb-cat-3':       '#C77A3E',
      '--sb-cat-4':       '#3E6FA3',
      '--sb-cat-5':       '#8B5FA8',
      '--sb-cat-6':       '#2F8C6E',
      '--sb-info':          '#685FD7', '--sb-info-tint':    '#EDEBFA',
      '--sb-warning':       '#B26A00', '--sb-warning-tint': '#FBEEDC',
      '--sb-shadow-panel':  '-8px 0 40px -12px rgba(48,40,20,.28)',
      '--sb-shadow-accent': '0 2px 0 rgba(120,92,0,.25)',
    },
  },
  {
    id: 'warm-minimal', name: 'Warm Minimal', isDark: false,
    tokens: {
      '--sb-page': '#F4F1EA', '--sb-header': '#FAF8F3',
      '--sb-card': '#FFFFFF', '--sb-field': '#FBFAF6',
      '--sb-border': '#E7E2D8', '--sb-hairline': '#EFEBE1',
      '--sb-surface-blur': '0px',
      '--sb-ink-1': '#1A1814', '--sb-ink-2': '#54503F',
      '--sb-ink-3': '#6E6656', '--sb-ink-4': '#7F7768',   // darkened from #A39C8C for AA
      '--sb-ink-on-dark': '#F4F1EA',
      '--sb-accent': '#C4633F', '--sb-accent-ink': '#FFF6F0',
      '--sb-accent-tint': '#F6E3D8', '--sb-accent-tint2': '#F6EFE3',
      '--sb-accent-border': '#E5DBCF',
      '--sb-positive': '#3C5A46', '--sb-positive-deep': '#2E4636',
      '--sb-positive-tint': '#E9EFE7',
      '--sb-negative': '#9A4A2E', '--sb-negative-deep': '#7E3A22',
      '--sb-negative-tint': '#F6E3D8',
      '--sb-shadow-frame':   '0 26px 64px -34px rgba(40,34,20,.42)',
      '--sb-shadow-hover':   '0 4px 12px -6px rgba(40,34,20,.34)',
      '--sb-shadow-control': '0 1px 3px rgba(26,24,20,.12)',
      '--sb-shadow-menu':    '0 12px 32px -12px rgba(40,34,20,.24)',
      '--sb-font-ui':  "'Plus Jakarta Sans', system-ui, sans-serif",
      '--sb-font-num': "'Plus Jakarta Sans', system-ui, sans-serif",
      // derived
      '--sb-ink-on-fill':   '#FFFFFF',
      '--sb-accent-rgb':    '196,99,63',
      '--sb-accent-deep':   '#8E4227',   // 5.71:1 on its own tint
      // Warm Minimal was not given a ramp: these are the Sunlit six pulled
      // towards its warmer ground, each still at or above 4.5:1 on white.
      '--sb-cat-1':       '#5A51C4',
      '--sb-cat-2':       '#3C5A46',
      '--sb-cat-3':       '#B0602D',
      '--sb-cat-4':       '#3B6797',
      '--sb-cat-5':       '#80569B',
      '--sb-cat-6':       '#2C7F63',
      '--sb-info':          '#4A5BA8', '--sb-info-tint':    '#E8EAF3',
      '--sb-warning':       '#7E5410', '--sb-warning-tint': '#F3EADC',
      '--sb-shadow-panel':  '-8px 0 40px -12px rgba(40,34,20,.24)',
      '--sb-shadow-accent': '0 2px 0 rgba(120,60,30,.28)',
    },
  },
  {
    id: 'glass-depth', name: 'Glass & Depth', isDark: true,
    tokens: {
      '--sb-page': '#0B0A12', '--sb-header': 'rgba(255,255,255,.035)',
      '--sb-card': 'rgba(255,255,255,.05)', '--sb-field': 'rgba(255,255,255,.035)',
      '--sb-border': 'rgba(255,255,255,.08)', '--sb-hairline': 'rgba(255,255,255,.045)',
      '--sb-surface-blur': '20px',
      '--sb-ink-1': '#EDEBF5', '--sb-ink-2': '#D6D2EA',
      '--sb-ink-3': '#A5A1BC', '--sb-ink-4': '#8F8BAB',   // lifted from #7C7899 for AA
      '--sb-accent': '#A78BFA', '--sb-accent-ink': '#1B1330',
      '--sb-accent-tint': 'rgba(167,139,250,.20)',
      '--sb-accent-tint2': 'rgba(167,139,250,.13)',
      '--sb-accent-border': 'rgba(167,139,250,.32)',
      '--sb-positive': '#4ADE80',                          // derived: concept had no green
      '--sb-positive-deep': '#22C55E',
      '--sb-positive-tint': 'rgba(74,222,128,.16)',
      '--sb-negative': '#F472B6', '--sb-negative-deep': '#EC4899',
      '--sb-negative-tint': 'rgba(244,114,182,.18)',
      '--sb-shadow-frame':   '0 30px 80px -40px rgba(0,0,0,.75)',
      '--sb-shadow-hover':   '0 6px 18px -8px rgba(0,0,0,.6)',
      '--sb-shadow-control': '0 1px 3px rgba(0,0,0,.5)',
      '--sb-shadow-menu':    '0 16px 40px -14px rgba(0,0,0,.7)',
      '--sb-font-ui':  "'Instrument Sans', system-ui, sans-serif",
      '--sb-font-num': "'Outfit', system-ui, sans-serif",
      // derived. --sb-ink-on-dark was specified as #F1EEFF; it is the ink that
      // reads on an --sb-ink-1 *fill* — the primary button, the inverted
      // panel, the solid pill — and here that fill is #EDEBF5, so a near-white
      // ink on it is 1:1. The name is the light theme's; the value has to
      // follow the meaning.
      '--sb-ink-on-dark':   '#12101C',
      '--sb-ink-on-fill':   '#12101C',
      '--sb-accent-rgb':    '167,139,250',
      '--sb-accent-deep':   '#C4B5FD',
      '--sb-cat-1':       '#9AACFF',
      '--sb-cat-2':       '#4ADE95',
      '--sb-cat-3':       '#E8B24C',
      '--sb-cat-4':       '#6BA8FF',
      '--sb-cat-5':       '#C79BFF',
      '--sb-cat-6':       '#55D6C0',
      '--sb-info':          '#9AACFF', '--sb-info-tint':    'rgba(154,172,255,.16)',
      '--sb-warning':       '#E8B24C', '--sb-warning-tint': 'rgba(232,178,76,.16)',
      '--sb-shadow-panel':  '-8px 0 44px -12px rgba(0,0,0,.7)',
      '--sb-shadow-accent': '0 2px 0 rgba(27,19,48,.45)',
    },
  },
  {
    id: 'evergreen', name: 'Evergreen', isDark: false,
    tokens: {
      '--sb-page': '#F5F7F6', '--sb-header': '#FBFCFB',
      '--sb-card': '#FFFFFF', '--sb-field': '#F1F4F2',
      '--sb-border': '#DCE7E3', '--sb-hairline': '#EDF1EF',
      '--sb-surface-blur': '0px',
      '--sb-ink-1': '#131A17', '--sb-ink-2': '#3E4842',
      '--sb-ink-3': '#5D675F', '--sb-ink-4': '#757E77',   // darkened from #9AA29C for AA
      '--sb-ink-on-dark': '#EAF6F0',
      '--sb-accent': '#155E4B', '--sb-accent-ink': '#EAF6F0',
      '--sb-accent-tint': '#E4EFE8', '--sb-accent-tint2': '#EAF3EF',
      '--sb-accent-border': '#C9DCD4',
      '--sb-positive': '#1F4A3A', '--sb-positive-deep': '#163828',
      '--sb-positive-tint': '#E4EFE8',
      '--sb-negative': '#B4574A', '--sb-negative-deep': '#934136',
      '--sb-negative-tint': '#F3E3DA',
      '--sb-shadow-frame':   '0 26px 64px -34px rgba(19,26,23,.4)',
      '--sb-shadow-hover':   '0 4px 12px -6px rgba(19,26,23,.32)',
      '--sb-shadow-control': '0 1px 3px rgba(19,26,23,.12)',
      '--sb-shadow-menu':    '0 12px 32px -12px rgba(19,26,23,.22)',
      '--sb-font-ui':  "'Outfit', system-ui, sans-serif",
      '--sb-font-num': "'Outfit', system-ui, sans-serif",
      // derived
      '--sb-ink-on-fill':   '#FFFFFF',
      '--sb-accent-rgb':    '21,94,75',
      '--sb-accent-deep':   '#0E4437',
      '--sb-cat-1':       '#2A5DA8',
      '--sb-cat-2':       '#155E4B',
      '--sb-cat-3':       '#8A5A12',
      '--sb-cat-4':       '#3F7A6E',
      '--sb-cat-5':       '#6357A8',
      '--sb-cat-6':       '#4A7A34',
      '--sb-info':          '#3F5AA6', '--sb-info-tint':    '#E7EBF4',
      '--sb-warning':       '#7E5410', '--sb-warning-tint': '#F2EBDC',
      '--sb-shadow-panel':  '-8px 0 40px -12px rgba(19,26,23,.22)',
      '--sb-shadow-accent': '0 2px 0 rgba(8,44,34,.3)',
    },
  },
]

export const DEFAULT_THEME_ID = 'sunlit-bento'

// Every theme that came before these was a set of dark background values
// sitting behind cards and text painted in fixed light-theme hexes, so all
// eleven of them rendered as an unreadable mixture. There is nothing in them
// worth migrating to: whatever was saved, the answer is the default.
const LEGACY_MAP: Record<string, string> = Object.fromEntries(
  ['dark-warm', 'dark-cool', 'navy-night', 'midnight', 'obsidian', 'forest',
   'crimson', 'violet', 'amber', 'teal', 'rose', 'light', 'ink-paper']
    .map(id => [id, DEFAULT_THEME_ID]),
)

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
  // Not a colour write, and the only other thing this function does: it is how
  // `color-scheme` reaches the native date pickers, scrollbars and autofill,
  // and how index.css knows whether a surface has anything to blur.
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

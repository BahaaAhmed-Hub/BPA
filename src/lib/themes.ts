// ─── Themes: one token contract ──────────────────────────────────────────────
// A theme used to be a bag of colour fields with names of its own — bg,
// surface2, accentFill, sidebarBg — which `applyThemeVars` then wrote out under
// three different variable prefixes (`--color-*`, `--bg-*`, `--accent`). The
// app's actual design tokens are the `--sb-*` set in index.css, so there were
// two vocabularies for one idea and no way to tell which one a component meant.
//
// A theme is now a map from `--sb-*` names to values, and nothing else. Adding
// a token means adding it to `SbToken`; every theme then has to answer for it,
// which is the point of a contract.

/** Every `--sb-*` token a theme owns. The rest of the `--sb-*` set — radii,
 *  type, control heights, shadows — does not vary by theme and stays in
 *  index.css's `:root`. */
export type SbToken =
  | '--sb-page'
  | '--sb-header'
  | '--sb-card'
  | '--sb-field'
  | '--sb-border'
  | '--sb-hairline'
  | '--sb-ink-1'
  | '--sb-ink-2'
  | '--sb-ink-3'
  | '--sb-ink-4'
  | '--sb-ink-on-dark'
  | '--sb-accent'
  /** Components, not values: `rgba(var(--sb-accent-rgb), .2)`. */
  | '--sb-accent-rgb'
  | '--sb-accent-tint'
  | '--sb-accent-tint2'
  | '--sb-accent-border'
  /** The accent at text weight against its own tint — deeper on a light theme,
   *  brighter on a dark one. */
  | '--sb-accent-deep'
  | '--sb-positive'
  | '--sb-positive-deep'
  | '--sb-positive-tint'
  | '--sb-negative'
  | '--sb-negative-deep'
  | '--sb-negative-tint'

export interface AppTheme {
  id: string
  name: string
  /** How the theme is picked out of a grid — not a colour, so it stays. */
  emoji: string
  isDark: boolean
  tokens: Record<SbToken, string>
}

export const THEMES: AppTheme[] = [
  {
    id: 'navy-night', name: 'Navy Night', emoji: '🌃', isDark: true,
    tokens: {
      '--sb-page': '#0D0F1A',
      '--sb-header': '#161929',
      '--sb-card': '#161929',
      '--sb-field': '#0D0F1A',
      '--sb-border': '#252A3E',
      '--sb-hairline': '#1A1E2E',
      '--sb-ink-1': '#E8EAF6',
      '--sb-ink-2': '#94A3B8',
      '--sb-ink-3': '#94A3B8',
      '--sb-ink-4': '#4B5563',
      '--sb-ink-on-dark': '#E8EAF6',
      '--sb-accent': '#60A5FA',
      '--sb-accent-rgb': '96,165,250',
      '--sb-accent-tint': '#23324F',
      '--sb-accent-tint2': '#263857',
      '--sb-accent-border': '#375887',
      '--sb-accent-deep': '#93C5FD',
      '--sb-positive': '#4ADE80',
      '--sb-positive-deep': '#22C55E',
      '--sb-positive-tint': '#1F3C39',
      '--sb-negative': '#F87171',
      '--sb-negative-deep': '#EF4444',
      '--sb-negative-tint': '#3F2936',
    },
  },
  {
    id: 'midnight', name: 'Midnight', emoji: '🌑', isDark: true,
    tokens: {
      '--sb-page': '#07090F',
      '--sb-header': '#0E1117',
      '--sb-card': '#0E1117',
      '--sb-field': '#07090F',
      '--sb-border': '#1C2030',
      '--sb-hairline': '#131621',
      '--sb-ink-1': '#F1F5F9',
      '--sb-ink-2': '#94A3B8',
      '--sb-ink-3': '#94A3B8',
      '--sb-ink-4': '#4B5563',
      '--sb-ink-on-dark': '#F1F5F9',
      '--sb-accent': '#818CF8',
      '--sb-accent-rgb': '129,140,248',
      '--sb-accent-tint': '#232740',
      '--sb-accent-tint2': '#272C48',
      '--sb-accent-border': '#42487C',
      '--sb-accent-deep': '#A5B4FC',
      '--sb-positive': '#4ADE80',
      '--sb-positive-deep': '#22C55E',
      '--sb-positive-tint': '#19362A',
      '--sb-negative': '#F87171',
      '--sb-negative-deep': '#EF4444',
      '--sb-negative-tint': '#382227',
    },
  },
  {
    id: 'obsidian', name: 'Obsidian', emoji: '⬛', isDark: true,
    tokens: {
      '--sb-page': '#0A0A0D',
      '--sb-header': '#111115',
      '--sb-card': '#111115',
      '--sb-field': '#0A0A0D',
      '--sb-border': '#1E1E2E',
      '--sb-hairline': '#15151F',
      '--sb-ink-1': '#EDE9FE',
      '--sb-ink-2': '#A78BFA',
      '--sb-ink-3': '#A78BFA',
      '--sb-ink-4': '#4B5563',
      '--sb-ink-on-dark': '#EDE9FE',
      '--sb-accent': '#A78BFA',
      '--sb-accent-rgb': '167,139,250',
      '--sb-accent-tint': '#2C273E',
      '--sb-accent-tint2': '#322C47',
      '--sb-accent-border': '#54487C',
      '--sb-accent-deep': '#C4B5FD',
      '--sb-positive': '#4ADE80',
      '--sb-positive-deep': '#22C55E',
      '--sb-positive-tint': '#1B3628',
      '--sb-negative': '#F87171',
      '--sb-negative-deep': '#EF4444',
      '--sb-negative-tint': '#3B2226',
    },
  },
  {
    id: 'forest', name: 'Forest', emoji: '🌲', isDark: true,
    tokens: {
      '--sb-page': '#091410',
      '--sb-header': '#101E18',
      '--sb-card': '#101E18',
      '--sb-field': '#091410',
      '--sb-border': '#163524',
      '--sb-hairline': '#10261B',
      '--sb-ink-1': '#ECFDF5',
      '--sb-ink-2': '#6EE7B7',
      '--sb-ink-3': '#6EE7B7',
      '--sb-ink-4': '#374151',
      '--sb-ink-on-dark': '#ECFDF5',
      '--sb-accent': '#34D399',
      '--sb-accent-rgb': '52,211,153',
      '--sb-accent-tint': '#163F2F',
      '--sb-accent-tint2': '#184634',
      '--sb-accent-border': '#206F52',
      '--sb-accent-deep': '#6EE7B7',
      '--sb-positive': '#4ADE80',
      '--sb-positive-deep': '#22C55E',
      '--sb-positive-tint': '#1A412B',
      '--sb-negative': '#F87171',
      '--sb-negative-deep': '#EF4444',
      '--sb-negative-tint': '#3A2D28',
    },
  },
  {
    id: 'crimson', name: 'Crimson', emoji: '🔴', isDark: true,
    tokens: {
      '--sb-page': '#130A0A',
      '--sb-header': '#1C0F0F',
      '--sb-card': '#1C0F0F',
      '--sb-field': '#130A0A',
      '--sb-border': '#351515',
      '--sb-hairline': '#261010',
      '--sb-ink-1': '#FEF2F2',
      '--sb-ink-2': '#FCA5A5',
      '--sb-ink-3': '#FCA5A5',
      '--sb-ink-4': '#4B5563',
      '--sb-ink-on-dark': '#FEF2F2',
      '--sb-accent': '#F87171',
      '--sb-accent-rgb': '248,113,113',
      '--sb-accent-tint': '#442121',
      '--sb-accent-tint2': '#4C2525',
      '--sb-accent-border': '#7F3B3B',
      '--sb-accent-deep': '#FCA5A5',
      '--sb-positive': '#4ADE80',
      '--sb-positive-deep': '#22C55E',
      '--sb-positive-tint': '#243423',
      '--sb-negative': '#F87171',
      '--sb-negative-deep': '#EF4444',
      '--sb-negative-tint': '#442121',
    },
  },
  {
    id: 'violet', name: 'Violet', emoji: '💜', isDark: true,
    tokens: {
      '--sb-page': '#0D091A',
      '--sb-header': '#150F24',
      '--sb-card': '#150F24',
      '--sb-field': '#0D091A',
      '--sb-border': '#261840',
      '--sb-hairline': '#1B112F',
      '--sb-ink-1': '#EDE9FE',
      '--sb-ink-2': '#C4B5FD',
      '--sb-ink-3': '#C4B5FD',
      '--sb-ink-4': '#4B5563',
      '--sb-ink-on-dark': '#EDE9FE',
      '--sb-accent': '#A78BFA',
      '--sb-accent-rgb': '167,139,250',
      '--sb-accent-tint': '#2F254B',
      '--sb-accent-tint2': '#352A53',
      '--sb-accent-border': '#574784',
      '--sb-accent-deep': '#C4B5FD',
      '--sb-positive': '#4ADE80',
      '--sb-positive-deep': '#22C55E',
      '--sb-positive-tint': '#1F3435',
      '--sb-negative': '#F87171',
      '--sb-negative-deep': '#EF4444',
      '--sb-negative-tint': '#3E2132',
    },
  },
  {
    id: 'amber', name: 'Amber', emoji: '🌅', isDark: true,
    tokens: {
      '--sb-page': '#150E04',
      '--sb-header': '#1F1607',
      '--sb-card': '#1F1607',
      '--sb-field': '#150E04',
      '--sb-border': '#382208',
      '--sb-hairline': '#281906',
      '--sb-ink-1': '#FFFBEB',
      '--sb-ink-2': '#FDE68A',
      '--sb-ink-3': '#FDE68A',
      '--sb-ink-4': '#6B5E3A',
      '--sb-ink-on-dark': '#FFFBEB',
      '--sb-accent': '#FCD34D',
      '--sb-accent-rgb': '252,211,77',
      '--sb-accent-tint': '#473814',
      '--sb-accent-tint2': '#504016',
      '--sb-accent-border': '#826B26',
      '--sb-accent-deep': '#FDE68A',
      '--sb-positive': '#4ADE80',
      '--sb-positive-deep': '#22C55E',
      '--sb-positive-tint': '#273A1D',
      '--sb-negative': '#F87171',
      '--sb-negative-deep': '#EF4444',
      '--sb-negative-tint': '#46261A',
    },
  },
  {
    id: 'teal', name: 'Teal', emoji: '🌊', isDark: true,
    tokens: {
      '--sb-page': '#051210',
      '--sb-header': '#0B1C1A',
      '--sb-card': '#0B1C1A',
      '--sb-field': '#051210',
      '--sb-border': '#0E2E2A',
      '--sb-hairline': '#0A211E',
      '--sb-ink-1': '#F0FDFA',
      '--sb-ink-2': '#5EEAD4',
      '--sb-ink-3': '#5EEAD4',
      '--sb-ink-4': '#374151',
      '--sb-ink-on-dark': '#F0FDFA',
      '--sb-accent': '#2DD4BF',
      '--sb-accent-rgb': '45,212,191',
      '--sb-accent-tint': '#113D38',
      '--sb-accent-tint2': '#12443E',
      '--sb-accent-border': '#1A6F64',
      '--sb-accent-deep': '#5EEAD4',
      '--sb-positive': '#4ADE80',
      '--sb-positive-deep': '#22C55E',
      '--sb-positive-tint': '#163F2C',
      '--sb-negative': '#F87171',
      '--sb-negative-deep': '#EF4444',
      '--sb-negative-tint': '#362B2A',
    },
  },
  {
    id: 'rose', name: 'Rose', emoji: '🌸', isDark: true,
    tokens: {
      '--sb-page': '#130810',
      '--sb-header': '#1D0E18',
      '--sb-card': '#1D0E18',
      '--sb-field': '#130810',
      '--sb-border': '#37102E',
      '--sb-hairline': '#270C20',
      '--sb-ink-1': '#FFF1F2',
      '--sb-ink-2': '#FDA4AF',
      '--sb-ink-3': '#FDA4AF',
      '--sb-ink-4': '#4B5563',
      '--sb-ink-on-dark': '#FFF1F2',
      '--sb-accent': '#FB7185',
      '--sb-accent-rgb': '251,113,133',
      '--sb-accent-tint': '#45202C',
      '--sb-accent-tint2': '#4E2430',
      '--sb-accent-border': '#813B49',
      '--sb-accent-deep': '#FDA4AF',
      '--sb-positive': '#4ADE80',
      '--sb-positive-deep': '#22C55E',
      '--sb-positive-tint': '#25332B',
      '--sb-negative': '#F87171',
      '--sb-negative-deep': '#EF4444',
      '--sb-negative-tint': '#442028',
    },
  },
  {
    id: 'light', name: 'Light', emoji: '☀️', isDark: false,
    tokens: {
      '--sb-page': '#F8FAFC',
      '--sb-header': '#F1F5F9',
      '--sb-card': '#FFFFFF',
      '--sb-field': '#F1F5F9',
      '--sb-border': '#E2E8F0',
      '--sb-hairline': '#F0F4F8',
      '--sb-ink-1': '#0F172A',
      '--sb-ink-2': '#475569',
      '--sb-ink-3': '#475569',
      '--sb-ink-4': '#64748B',
      '--sb-ink-on-dark': '#F8FAFC',
      '--sb-accent': '#1E40AF',
      '--sb-accent-rgb': '30,64,175',
      '--sb-accent-tint': '#E0E4F4',
      '--sb-accent-tint2': '#D9DFF1',
      '--sb-accent-border': '#9AA9DB',
      '--sb-accent-deep': '#3B82F6',
      '--sb-positive': '#0C8140',
      '--sb-positive-deep': '#0A6B36',
      '--sb-positive-tint': '#DDEDE4',
      '--sb-negative': '#C62828',
      '--sb-negative-deep': '#A31C1C',
      '--sb-negative-tint': '#F7E1E1',
    },
  },
  {
    id: 'sunlit-bento', name: 'Sunlit Bento', emoji: '🌤️', isDark: false,
    // Verbatim from index.css's :root — applying the default theme has to be a
    // no-op, or the app would repaint itself on the way in.
    tokens: {
      '--sb-page': '#F7F4EA',
      '--sb-header': '#FCFAF4',
      '--sb-card': '#FFFFFF',
      '--sb-field': '#FAF7EC',
      '--sb-border': '#E8E1CE',
      '--sb-hairline': '#F0EBDC',
      '--sb-ink-1': '#191712',
      '--sb-ink-2': '#4A4438',
      '--sb-ink-3': '#6C6553',
      '--sb-ink-4': '#756F60',
      '--sb-ink-on-dark': '#FDF8E7',
      '--sb-accent': '#F5D14E',
      '--sb-accent-rgb': '245,209,78',
      '--sb-accent-tint': '#FEF7DE',
      '--sb-accent-tint2': '#FDF6DE',
      '--sb-accent-border': '#EFE1B4',
      '--sb-accent-deep': '#7A5F09',
      '--sb-positive': '#0C8140',
      '--sb-positive-deep': '#0A6B36',
      '--sb-positive-tint': '#E2F0E7',
      '--sb-negative': '#C62828',
      '--sb-negative-deep': '#A31C1C',
      '--sb-negative-tint': '#FAE3E3',
    },
  },
]

export const DEFAULT_THEME_ID = 'sunlit-bento'

// Migrate old theme IDs saved before the 10-theme update
const LEGACY_MAP: Record<string, string> = {
  'dark-warm': 'navy-night',
  'dark-cool': 'midnight',
}

export function resolveThemeId(id: string): string {
  return LEGACY_MAP[id] ?? (THEMES.some(t => t.id === id) ? id : DEFAULT_THEME_ID)
}

export function getTheme(id: string): AppTheme {
  const resolved = resolveThemeId(id)
  return THEMES.find(t => t.id === resolved) ?? THEMES[0]
}

/** The whole of theming: write the tokens. `html, body` already read
 *  `var(--sb-page)` and `var(--sb-ink-1)`, so there is nothing to paint by
 *  hand, and no second vocabulary to keep in step. */
export function applyThemeVars(theme: AppTheme): void {
  const style = document.documentElement.style
  for (const [token, value] of Object.entries(theme.tokens)) {
    style.setProperty(token, value)
  }
  // Not a colour write: the one hook a CSS rule has for asking which way round
  // the theme is. Nothing reads it yet.
  document.documentElement.setAttribute('data-theme', theme.isDark ? 'dark' : 'light')
}

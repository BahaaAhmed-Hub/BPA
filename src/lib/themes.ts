// ─── Theme definitions & CSS variable applicator ─────────────────────────────

export interface AppTheme {
  id: string
  name: string
  emoji: string
  bg: string
  surface: string
  surface2: string
  border: string
  /** Bright accent — used for text/icons on dark backgrounds */
  accent: string
  /** Dimmer accent fill — used as button/badge backgrounds */
  accentFill: string
  /** Even lighter accent — labels, secondary accents */
  accentBright: string
  text: string
  textDim: string
  textMuted: string
  sidebarBg: string
  isDark: boolean
}

export const THEMES: AppTheme[] = [
  {
    id: 'navy-night', name: 'Navy Night', emoji: '🌃',
    bg: '#0D0F1A', surface: '#161929', surface2: '#0D0F1A',
    border: '#252A3E',
    accent: '#60A5FA', accentFill: 'rgba(59,130,246,0.18)', accentBright: '#93C5FD',
    text: '#E8EAF6', textDim: '#94A3B8', textMuted: '#4B5563',
    sidebarBg: '#161929', isDark: true,
  },
  {
    id: 'midnight', name: 'Midnight', emoji: '🌑',
    bg: '#07090F', surface: '#0E1117', surface2: '#07090F',
    border: '#1C2030',
    accent: '#818CF8', accentFill: 'rgba(129,140,248,0.18)', accentBright: '#A5B4FC',
    text: '#F1F5F9', textDim: '#94A3B8', textMuted: '#4B5563',
    sidebarBg: '#0E1117', isDark: true,
  },
  {
    id: 'obsidian', name: 'Obsidian', emoji: '⬛',
    bg: '#0A0A0D', surface: '#111115', surface2: '#0A0A0D',
    border: '#1E1E2E',
    accent: '#A78BFA', accentFill: 'rgba(167,139,250,0.18)', accentBright: '#C4B5FD',
    text: '#EDE9FE', textDim: '#A78BFA', textMuted: '#4B5563',
    sidebarBg: '#111115', isDark: true,
  },
  {
    id: 'forest', name: 'Forest', emoji: '🌲',
    bg: '#091410', surface: '#101E18', surface2: '#091410',
    border: '#163524',
    accent: '#34D399', accentFill: 'rgba(52,211,153,0.18)', accentBright: '#6EE7B7',
    text: '#ECFDF5', textDim: '#6EE7B7', textMuted: '#374151',
    sidebarBg: '#101E18', isDark: true,
  },
  {
    id: 'crimson', name: 'Crimson', emoji: '🔴',
    bg: '#130A0A', surface: '#1C0F0F', surface2: '#130A0A',
    border: '#351515',
    accent: '#F87171', accentFill: 'rgba(248,113,113,0.18)', accentBright: '#FCA5A5',
    text: '#FEF2F2', textDim: '#FCA5A5', textMuted: '#4B5563',
    sidebarBg: '#1C0F0F', isDark: true,
  },
  {
    id: 'violet', name: 'Violet', emoji: '💜',
    bg: '#0D091A', surface: '#150F24', surface2: '#0D091A',
    border: '#261840',
    accent: '#A78BFA', accentFill: 'rgba(167,139,250,0.18)', accentBright: '#C4B5FD',
    text: '#EDE9FE', textDim: '#C4B5FD', textMuted: '#4B5563',
    sidebarBg: '#150F24', isDark: true,
  },
  {
    id: 'amber', name: 'Amber', emoji: '🌅',
    bg: '#150E04', surface: '#1F1607', surface2: '#150E04',
    border: '#382208',
    accent: '#FCD34D', accentFill: 'rgba(252,211,77,0.18)', accentBright: '#FDE68A',
    text: '#FFFBEB', textDim: '#FDE68A', textMuted: '#6B5E3A',
    sidebarBg: '#1F1607', isDark: true,
  },
  {
    id: 'teal', name: 'Teal', emoji: '🌊',
    bg: '#051210', surface: '#0B1C1A', surface2: '#051210',
    border: '#0E2E2A',
    accent: '#2DD4BF', accentFill: 'rgba(45,212,191,0.18)', accentBright: '#5EEAD4',
    text: '#F0FDFA', textDim: '#5EEAD4', textMuted: '#374151',
    sidebarBg: '#0B1C1A', isDark: true,
  },
  {
    id: 'rose', name: 'Rose', emoji: '🌸',
    bg: '#130810', surface: '#1D0E18', surface2: '#130810',
    border: '#37102E',
    accent: '#FB7185', accentFill: 'rgba(251,113,133,0.18)', accentBright: '#FDA4AF',
    text: '#FFF1F2', textDim: '#FDA4AF', textMuted: '#4B5563',
    sidebarBg: '#1D0E18', isDark: true,
  },
  {
    id: 'light', name: 'Light', emoji: '☀️',
    bg: '#F8FAFC', surface: '#FFFFFF', surface2: '#F1F5F9',
    border: '#E2E8F0',
    accent: '#1E40AF', accentFill: 'rgba(30,64,175,0.1)', accentBright: '#3B82F6',
    text: '#0F172A', textDim: '#475569', textMuted: '#94A3B8',
    sidebarBg: '#F1F5F9', isDark: false,
  },
]

export const DEFAULT_THEME_ID = 'navy-night'

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

export function applyThemeVars(theme: AppTheme): void {
  const s = document.documentElement.style
  s.setProperty('--color-bg',           theme.bg)
  s.setProperty('--color-surface',      theme.surface)
  s.setProperty('--color-surface2',     theme.surface2)
  s.setProperty('--color-border',       theme.border)
  s.setProperty('--color-accent',       theme.accent)
  s.setProperty('--color-accent-fill',  theme.accentFill)
  s.setProperty('--color-accent-bright',theme.accentBright)
  s.setProperty('--color-text',         theme.text)
  s.setProperty('--color-text-dim',     theme.textDim)
  s.setProperty('--color-text-muted',   theme.textMuted)
  s.setProperty('--color-sidebar',      theme.sidebarBg)
  document.body.style.background = theme.bg
}

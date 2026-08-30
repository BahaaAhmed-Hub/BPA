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
    text: '#0F172A', textDim: '#475569', textMuted: '#64748B',
    sidebarBg: '#F1F5F9', isDark: false,
  },
  {
    id: 'sunlit-bento', name: 'Sunlit Bento', emoji: '🌤️',
    bg: '#F7F4EA', surface: '#FFFFFF', surface2: '#FAF7EC',
    border: '#E8E1CE',
    accent: '#F5D14E', accentFill: 'rgba(245,209,78,0.12)', accentBright: '#D4A827',
    text: '#191712', textDim: '#6C6553', textMuted: '#9B9180',
    sidebarBg: '#FCFAF4', isDark: false,
  },
]

export function applySamuraiModeOverride(): void {
  const s = document.documentElement.style
  s.setProperty('--color-bg',           '#0C0B09')
  s.setProperty('--color-surface',      '#131210')
  s.setProperty('--color-surface2',     '#0C0B09')
  s.setProperty('--color-border',       '#1E1C18')
  s.setProperty('--color-accent',       '#8B1A1A')
  s.setProperty('--color-accent-fill',  'rgba(139,26,26,0.15)')
  s.setProperty('--color-accent-bright','#C0392B')
  s.setProperty('--color-text',         '#EDE4D3')
  s.setProperty('--color-text-dim',     '#7A6E5E')
  s.setProperty('--color-text-muted',   '#3C3530')
  s.setProperty('--color-sidebar',      '#131210')
  s.setProperty('--bg-base',            '#0C0B09')
  s.setProperty('--bg-surface',         '#131210')
  s.setProperty('--border-color',       '#1E1C18')
  s.setProperty('--text-primary',       '#EDE4D3')
  s.setProperty('--accent',             '#8B1A1A')
  document.documentElement.setAttribute('data-theme', 'dark')
  document.body.style.background = '#0C0B09'
  document.body.style.color = '#EDE4D3'
}

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

export function applyThemeVars(theme: AppTheme): void {
  const s = document.documentElement.style
  // New CSS variable names (used by components via var())
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
  // Legacy CSS variable names (used in older CSS rules)
  s.setProperty('--bg-base',      theme.bg)
  s.setProperty('--bg-surface',   theme.surface)
  s.setProperty('--bg-surface2',  theme.surface2)
  s.setProperty('--border-color', theme.border)
  s.setProperty('--text-primary', theme.text)
  s.setProperty('--text-muted',   theme.textMuted)
  s.setProperty('--accent',       theme.accent)
  // Set data-theme for CSS selector-based overrides
  document.documentElement.setAttribute('data-theme', theme.isDark ? 'dark' : 'light')
  document.body.style.background = theme.bg
  document.body.style.color = theme.text
}

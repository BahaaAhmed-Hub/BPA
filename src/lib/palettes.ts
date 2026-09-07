// ─── Colour data ─────────────────────────────────────────────────────────────
// Not design tokens: the colours somebody *chose*. A company's colour, a
// habit's, a category's, the swatch behind an avatar, a chart's series — these
// are values that get written to the database and read back, and a token would
// mean the row changed meaning when the theme did. They live here rather than
// in the components so that a component holds no colour at all.

/** PlanningAssistant.tsx */
export const CALENDAR_COLORS = [
  '#E53935','#8E24AA','#3949AB','#039BE5',
  '#0B8043','#E4C441','#F4511E','#616161',
]


/** Step4Habits.tsx */
export const HABIT_COLORS = ['#7F77DD','#60A5FA','#1D9E75','#E05252','#F97316','#A855F7','#EC4899','#FBBF24']


/** Step3Companies.tsx */
export const COMPANY_COLOR_CHOICES = [
  '#7F77DD','#60A5FA','#1D9E75','#E05252','#F97316',
  '#A855F7','#EC4899','#FBBF24','#22D3EE','#6366F1','#10B981','#EF4444',
]


/** CategoryModal.tsx */
export const SWATCHES = [
  '#C62828', '#C77A3E', '#C9A227', '#0C8140', '#3F7A6E',
  '#3E6FA3', '#6357A8', '#9B4F86', '#8C8071', '#4A4438',
]


/** ReportsScreen.tsx */
export const PALETTE = [
  '#C0563C', '#3F7FA6', '#7A8C3A', '#B4577F', '#D99A2B',
  '#2F8C6E', '#7C6BB0', '#8A6A4F', '#5B8C8C', '#A8892B',
]


/** CalendarIntelligence.tsx */
export const CAL_COLORS = [
  '#FF3B30', '#FF9500', '#FFCC00', '#34C759',
  '#5AC8FA', '#007AFF', '#5856D6', '#AF52DE',
  '#FF2D55', '#A2845E', '#8E8E93',
]


/** InboxModule.tsx */
export const AVATAR_COLORS = ['#7F77DD','#7F77DD','#1D9E75','#E05252','#E0944A','#7C3AED','#0891B2','#059669']


/** InboxModule.tsx */
export const ACCOUNT_COLORS = ['#2E3FBF', '#0C8140', '#C0761E', '#8B2FBF', '#C62828', '#3B7A8A']

/** HabitsModule.tsx */
export const WALL_PALETTE = [
  '#E8E4D8','#D9E4C8','#D8E0E4','#E4D9D8','#E4E0D8',
  '#DDD8E4','#D8E4E0','#E4DDD8','#D8E0D8',
]



/** Settings.tsx */
export const C_COLORS     = ['#7F77DD','#7F77DD','#1D9E75','#E05252','#888780','#5B9BD5','#E0944A']

/** Settings.tsx */
export const STATUS_COLORS_PRESETS = ['#6B7280','#3B82F6','#F59E0B','#EF4444','#F97316','#10B981','#8B5CF6','#EC4899','#14B8A6','#F97316']


/** The Be mark's three colourways — brand artwork rather than theme tokens.
 *  Each pairing (ground, word, dot) is contrast-checked as a set, so they are
 *  not to be mixed and they do not follow the theme. */
export const BE_COLOURWAYS = {
  white: { bg: '#FAF6F6', border: '#E8E8EE', word: '#000000', dot: '#FAD10C', radius: 14 },
  black: { bg: '#000000', border: '#E8E8EE', word: '#E8E8EE', dot: '#F8D31E', radius: 14 },
  amber: { bg: '#E9A23B', border: null,      word: '#050505', dot: '#F2F2F8', radius: 16 },
} as const

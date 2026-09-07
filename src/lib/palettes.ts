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
/** Twelve hues at two weights, so a person with a dozen companies still gets a
 *  colour they can tell from the others. Every one of them is legible as a dot
 *  or a chip on both a cream ground and a dark one, which is why the deep row
 *  is not simply the bright row darkened. */
export const COMPANY_COLOR_CHOICES = [
  // deep
  '#B03A3A', '#C2622B', '#B07C12', '#7F8B1E', '#3F7A34', '#1D8A6A',
  '#1F7A96', '#2F63A8', '#4A54B8', '#6B4BB0', '#96409A', '#B03A73',
  // bright
  '#E05252', '#F0863C', '#E8B028', '#B6C63C', '#4FB05A', '#2FBF9C',
  '#35A9CC', '#4E8FE0', '#7B84E8', '#A276E0', '#C664CC', '#E062A0',
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
/** Google's own eleven, and then a deeper row of the same hues: the bright
 *  set is what Google hands back, and a calendar drawn in it is a pale block
 *  whichever way its card is tinted. Twenty-two is also enough that a person
 *  with a dozen calendars is not reusing one. */
export const CAL_COLORS = [
  '#FF3B30', '#FF9500', '#FFCC00', '#34C759',
  '#5AC8FA', '#007AFF', '#5856D6', '#AF52DE',
  '#FF2D55', '#A2845E', '#8E8E93',
  '#B0342B', '#B4651A', '#A6820D', '#237D3C',
  '#2E7EA6', '#0B4F9E', '#3B3A94', '#7A369B',
  '#B01F42', '#6E5A41', '#5C5C60',
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



/** Settings.tsx — the company picker. Seven swatches, one of which was the
 *  same violet twice, so it was six; it is the full set now, shared with the
 *  wizard's picker so a company gets the same choice wherever it is made. */
export const C_COLORS = COMPANY_COLOR_CHOICES

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

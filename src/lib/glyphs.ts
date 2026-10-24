// ─── Glyphs that are data, not interface ─────────────────────────────────────
// Emoji belongs in the interface nowhere (use a lucide icon). It belongs in the
// data where a person *picked* it — a habit's icon, a category's, a shopping
// list's — and those pickers need a starting value and a fallback for a row
// that has none. They live here, outside src/modules/, so that the one place
// the rule has an exception is a file and not a scatter of `ui-guard` marks.
// Plain typographic symbols (a star for a rating, an arrow out) are here too.
export const DEFAULT_HABIT_EMOJI    = '🎯'
export const DEFAULT_GOAL_ICON      = '🎯'
export const DEFAULT_ACCOUNT_EMOJI  = '🏦'
export const DEFAULT_CATEGORY_ICON  = '📁'
export const DEFAULT_SHOP_ICON      = '🛒'
export const FALLBACK_BOARD_ICON    = '📥'
export const FALLBACK_EXPENSE_ICON  = '💳'
export const FALLBACK_INCOME_ICON   = '💼'

export const GLYPH = {
  star: '★',
  external: '↗',
  transfer: '↔',
  flag: '⚑',
} as const
export const DEFAULT_PICK_EMOJI     = '💡'

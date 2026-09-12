// ─── Filtering a list you are looking at ─────────────────────────────────────
// Every dropdown in the app narrows the same way, so the rules live here rather
// than being re-decided at each list. Three of them matter:
//
// - **A short list is not searched.** A filter box over three options costs a
//   decision and saves nothing; it also pushes the options themselves down the
//   panel. `SEARCH_FROM` is the count at which a list earns one.
// - **Diacritics and case are noise.** "Café" is found by typing "cafe", and a
//   category typed in Arabic is found by whatever the person actually types.
// - **Every word has to land, in any order.** "cib world" finds "World
//   Mastercard — CIB", which a plain substring test does not. Each term is
//   matched against the whole haystack rather than against one field, so a
//   sub-category is reachable by its parent's name and an account by what it
//   holds.

/** Below this, a list is short enough to read, and a search box is furniture. */
export const SEARCH_FROM = 8

/** Lower-cased, stripped of accents, and collapsed to single spaces. */
export function foldText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** The terms a query breaks into. An empty query is no terms, which matches
 *  everything — callers do not need a separate "not searching" branch. */
export function searchTerms(query: string): string[] {
  return foldText(query).split(' ').filter(Boolean)
}

/** Does this row answer the query? `fields` is everything about the row a
 *  person might type: its label, the parent it sits under, the hint beside it. */
export function matchesTerms(terms: string[], ...fields: (string | undefined)[]): boolean {
  if (terms.length === 0) return true
  const hay = foldText(fields.filter(Boolean).join(' '))
  return terms.every(t => hay.includes(t))
}

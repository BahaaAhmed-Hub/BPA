// ─── Hiding the words worth remembering ──────────────────────────────────────
// A review card is the quote with a few of its words blanked. Which ones are
// chosen from the quote's own text — longer words that are not the small
// connective ones — and **differently each time it comes round** (the seed
// carries the number of times it has been answered), so what you learn is the
// sentence and not the shape of one gap. Deterministic for a given seed, so the
// front and the reveal agree and a test can pin it.

export interface Piece { text: string; blank: boolean }

const STOP = new Set(('about above after again against almost also always another around because become becomes before being below between both cannot could does doing down during each ' +
  'every from further have having here however into itself just might more most never often only other ought over rather same should since some still such than that their theirs them ' +
  'then there these they this those though through together under until very were what whatever when whenever where whether which while whom whose will with within without would your yours').split(' '))

// Letters and digits, with an apostrophe or hyphen inside a word — in any script.
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu
const MIN_LETTERS = 5

/** FNV-1a: small, stable across runs and browsers, and nothing here needs more. */
function hash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return h >>> 0
}

interface Word { start: number; end: number; text: string }
const wordsOf = (text: string): Word[] => [...text.matchAll(WORD)].map(m => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, text: m[0] }))

/** How many to hide: a short line gives up one word, a paragraph three. */
export const blanksFor = (wordCount: number): number => (wordCount < 10 ? 1 : wordCount < 25 ? 2 : 3)

export function makeCloze(text: string, seed: string): Piece[] {
  const words = wordsOf(text)
  if (!words.length) return [{ text, blank: false }]
  const k = Math.min(blanksFor(words.length), words.length)
  const good = words.filter(w => w.text.length >= MIN_LETTERS && !STOP.has(w.text.toLowerCase()))
  // Nothing worth hiding (a line of short words): hide the last ones, which is where a line lands.
  const chosen = good.length
    ? [...good].sort((a, b) => hash(`${seed}:${a.start}`) - hash(`${seed}:${b.start}`)).slice(0, k)
    : words.slice(-k)
  const pick = new Set(chosen.map(w => w.start))
  const out: Piece[] = []
  let at = 0
  for (const w of words) {
    if (!pick.has(w.start)) continue
    if (w.start > at) out.push({ text: text.slice(at, w.start), blank: false })
    out.push({ text: text.slice(w.start, w.end), blank: true })
    at = w.end
  }
  if (at < text.length) out.push({ text: text.slice(at), blank: false })
  return out
}

export const blanksOf = (pieces: Piece[]): string[] => pieces.filter(p => p.blank).map(p => p.text)

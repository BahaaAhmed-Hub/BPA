// ─── Reading the spines in a shelf photograph ────────────────────────────────
// Each tile goes to Claude vision, which lists the books whose titles it can
// actually read. The key is Settings → AI, as everywhere in the Library.
//
// **What comes back is a draft, and the model is told to under-claim.** A spine
// half hidden by its neighbour, or too small to read, is not a title; guessing
// one from a fragment would put a confident wrong book on the shelf. So the
// prompt asks for what is readable, with how sure it is, and counts what it
// could not read instead of making something up. The caller shows every row for
// checking before anything is added.
import { anthropic, anthropicKey } from '@/lib/professor'
import { AiFailure, describeAiFailure } from './aiFailure'
import type { Tile } from './shelfTiles'

export type Sureness = 'high' | 'medium' | 'low'

export interface Spine {
  title: string
  author?: string
  sureness: Sureness
  /** The model's guess at what it is — one of your categories if one fits, else a short genre. Judged from the title alone. */
  category?: string
}

export interface ShelfRead {
  books: Spine[]
  /** Spines the model saw and could not read, summed over the pieces. */
  unreadable: number
  /** Pieces that could not be read at all (a failed call), so the screen can say so. */
  failedParts: number
  parts: number
  /** Set when *every* piece failed: the reason, in words. */
  error?: string
}

export const MAX_BOOKS = 300
const MAX_TITLE = 200

const systemFor = (categories: string[]) => `You read book spines in a photograph of a shelf.

List EVERY book whose TITLE you can read on its spine or cover — go along the shelf spine by spine and do not stop early: a shelf often holds thirty books or more, and a short list is a wrong answer. Include small, angled, sideways and partly covered spines too, marked by sureness rather than left out. Reply with ONLY a JSON object:
{"books": [{"title": string, "author": string | null, "sureness": "high" | "medium" | "low", "category": string | null}], "unreadable": number}

Rules:
- Copy the title as printed, in its own language. Do not translate, correct, complete or guess from a fragment. If you can only read part of a title, do not list it — count it in "unreadable".
- "author" only if it is printed on that spine. Never fill it from what you know of the book.
- "sureness": "high" = every word clear; "medium" = clear but small, angled or partly covered; "low" = you can read most of the title but are not certain of a word. A title read in full that you are unsure of is "low", not "unreadable".
- "unreadable" is the number of spines you can see but truly cannot read any title from.
- Do not list the same book twice. Ignore ornaments, bookends, boxes, magazines without a clear title, and anything that is not a book.
- If the photo shows no books, return {"books": [], "unreadable": 0}.
- "category": what kind of book it is, judged from the title and author alone — never from the spine's colour or design. ${categories.length
    ? `The reader's own categories are: ${categories.map(c => `"${c}"`).join(', ')}. If one fits, use it EXACTLY as written. Only if none fits, give a short genre name of one to three words in Title Case (for example "Biography" or "Self-Help").`
    : 'The reader has no categories yet, so give a short genre name of one to three words in Title Case (for example "Biography" or "Self-Help").'}
  Use null when you cannot tell. Do not invent a category for a title you are unsure of.`

const clean = (s: unknown, max: number): string => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '')

/** Tolerant of fences and of a model that forgets the JSON: no JSON is no books, never an exception. */
export function parseSpines(raw: string): { books: Spine[]; unreadable: number } {
  const cleaned = raw.trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim()
  try {
    const j = JSON.parse(cleaned) as { books?: unknown; unreadable?: unknown }
    const books: Spine[] = []
    for (const b of Array.isArray(j.books) ? j.books : []) {
      const o = b as { title?: unknown; author?: unknown; sureness?: unknown }
      const title = clean(o?.title, MAX_TITLE)
      if (!title) continue
      const author = clean(o?.author, 120) || undefined
      const category = clean((o as { category?: unknown }).category, 40) || undefined
      books.push({ title, ...(author ? { author } : {}), sureness: o.sureness === 'high' || o.sureness === 'medium' ? o.sureness : 'low', ...(category ? { category } : {}) })
    }
    const unreadable = typeof j.unreadable === 'number' && j.unreadable >= 0 && j.unreadable < 1000 ? Math.round(j.unreadable) : 0
    return { books, unreadable }
  } catch {
    return { books: [], unreadable: 0 }
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const RANK: Record<Sureness, number> = { high: 3, medium: 2, low: 1 }

/** Tiles overlap, so the same spine is read twice. One row per book: the surer reading wins, and an author seen once is kept. */
export function mergeSpines(parts: Spine[][]): Spine[] {
  const byKey = new Map<string, Spine>()
  for (const s of parts.flat()) {
    const key = norm(s.title)
    if (!key) continue
    const have = byKey.get(key)
    if (!have) { byKey.set(key, { ...s }); continue }
    const better = RANK[s.sureness] > RANK[have.sureness] ? s : have
    const author = have.author ?? s.author, category = better.category ?? have.category ?? s.category
    byKey.set(key, { title: better.title, sureness: better.sureness, ...(author ? { author } : {}), ...(category ? { category } : {}) })
  }
  return [...byKey.values()].slice(0, MAX_BOOKS)
}

export const ShelfError = AiFailure

async function readTile(tile: Tile, categories: string[]): Promise<{ books: Spine[]; unreadable: number }> {
  const msg = await anthropic().messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 6000,
    system: systemFor(categories),
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: tile.mediaType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif', data: tile.data } },
        { type: 'text', text: `Read the spines in ${tile.label}.` },
      ],
    }],
  })
  return parseSpines(msg.content.find(b => b.type === 'text')?.text ?? '')
}

/**
 * Reads every tile, one after another (a shelf is a handful, and in parallel a
 * rate limit would take them all at once), and merges. A piece that fails costs
 * its piece, not the rest: the books from the others are still returned, with
 * `failedParts` saying so. Only when every piece fails is it an `error`.
 */
export async function readShelf(tiles: Tile[], onProgress?: (done: number, of: number) => void, categories: string[] = []): Promise<ShelfRead> {
  if (!anthropicKey()) {
    throw new ShelfError('Add an Anthropic key under Settings → AI to have the shelf read for you. You can still add books by hand.')
  }
  const found: Spine[][] = []
  let unreadable = 0, failed = 0
  let lastErr: AiFailure | null = null
  for (const [i, t] of tiles.entries()) {
    onProgress?.(i, tiles.length)
    try {
      const r = await readTile(t, categories)
      found.push(r.books); unreadable += r.unreadable
    } catch (e) {
      failed++; lastErr = describeAiFailure(e, 'Reading the shelf', 'You can still add books by hand.')
      // A refused key will be refused by every other piece too: stop spending on it.
      const status = (e as { status?: number })?.status
      if (status === 401 || status === 403) { failed = tiles.length; break }
    }
  }
  onProgress?.(tiles.length, tiles.length)
  const out: ShelfRead = { books: mergeSpines(found), unreadable, failedParts: failed, parts: tiles.length }
  if (failed === tiles.length && lastErr) out.error = lastErr.message
  return out
}

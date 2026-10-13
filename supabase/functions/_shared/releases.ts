// ─── What counts as a new release — the server's copy ────────────────────────
// Pure: no Deno, no imports, so the test runs the real module. Deno cannot import
// the app's bundle, so these rules exist twice — here and in
// `src/modules/library/followCheck.ts` + `bookLookup.ts` — and
// `scripts/library-releases-agree.mjs` runs the same fixtures through both and
// fails on any disagreement (the `mail-rules-agree` arrangement).

export interface Candidate {
  /** Open Library's work key, `/works/OL123W`. */
  key: string
  title: string
  authors: string[]
  isbn?: string
  year?: number
  coverUrl?: string
}
export interface ShelfBook { title: string; authors: string[]; isbn?: string }

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

interface Doc {
  key?: string; title?: string; author_name?: string[]; first_publish_year?: number
  isbn?: string[]; cover_i?: number
}

/** Open Library `search.json` docs → candidates. A doc with no title is not a book. */
export function parseDocs(data: unknown): Candidate[] {
  const docs = (data as { docs?: Doc[] } | null)?.docs
  if (!Array.isArray(docs)) return []
  const out: Candidate[] = []
  for (const d of docs) {
    if (!d || typeof d.title !== 'string' || !d.title.trim()) continue
    out.push({
      key: typeof d.key === 'string' ? d.key : '',
      title: d.title, authors: Array.isArray(d.author_name) ? d.author_name : [],
      isbn: d.isbn?.find(i => i.length === 13) ?? d.isbn?.[0],
      year: d.first_publish_year,
      coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : undefined,
    })
  }
  return out
}

export const workKey = (c: Pick<Candidate, 'key' | 'title'>): string => c.key || c.title.toLowerCase()

/** The ISBN is the sure answer; failing that the same title by the same first author, punctuation and case aside. */
export function onShelf(shelf: ShelfBook[], c: Pick<Candidate, 'title' | 'authors' | 'isbn'>): boolean {
  const key = norm(c.title) + '|' + norm(c.authors[0] ?? '')
  return shelf.some(b => (c.isbn && b.isbn && b.isbn === c.isbn) || norm(b.title) + '|' + norm(b.authors[0] ?? '') === key)
}

/** What the follow's question returns now that it has not seen, that is not twice in the answer, and is not on the shelf. */
export function freshReleases(seenKeys: string[], found: Candidate[], shelf: ShelfBook[]): Candidate[] {
  const seen = new Set(seenKeys)
  // A work the catalogue lists twice is owned if either listing is on the shelf.
  const owned = new Set(found.filter(c => onShelf(shelf, c)).map(workKey))
  const have = new Set<string>()
  const out: Candidate[] = []
  for (const c of found) {
    const k = workKey(c)
    if (seen.has(k) || have.has(k) || owned.has(k)) continue
    have.add(k); out.push(c)
  }
  return out
}

/** The request a follow's saved question becomes. Newest first, the way the app asks. */
export function searchUrl(query: string, limit = 40): string {
  const fields = 'key,title,subtitle,author_name,first_publish_year,isbn,cover_i,number_of_pages_median,publisher,language'
  return `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&sort=new&limit=${limit}&fields=${fields}`
}

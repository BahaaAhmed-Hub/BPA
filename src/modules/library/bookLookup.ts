// ─── Finding a book by what you can remember of it ───────────────────────────
// Open Library and Google Books, asked together. Neither needs a key for this,
// and both answer CORS, so the browser can ask them directly — nothing here
// passes through our own server.
//
// **Two sources because each is bad at something the other is good at.** Open
// Library has the author's other works and free-to-read editions (Phase 3);
// Google Books has the better description and cover for a recent title. The
// results are merged and de-duplicated rather than shown as two lists.
//
// **A failed source is not an empty one.** If one is down the other still
// answers, and the caller is told which failed — "no results" about a book
// that exists is a lie the person will believe.

import type { BookSource } from './types'

export interface BookCandidate {
  title: string
  subtitle?: string
  authors: string[]
  isbn?: string
  publisher?: string
  publishedYear?: number
  pages?: number
  language?: string
  description?: string
  coverUrl?: string
  source: BookSource
  sourceKey?: string
}

export interface LookupResult {
  candidates: BookCandidate[]
  /** Sources that could not be reached, by name. */
  failed: string[]
}

const get = async (url: string, signal?: AbortSignal) => {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(String(res.status))
  return res.json() as Promise<unknown>
}

// Open Library's `fields` keeps the response to what is used.
async function openLibrary(q: string, limit: number, signal?: AbortSignal, sort?: string): Promise<BookCandidate[]> {
  const fields = 'key,title,subtitle,author_name,first_publish_year,isbn,cover_i,number_of_pages_median,publisher,language'
  const data = await get(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}${sort ? `&sort=${sort}` : ''}&limit=${limit}&fields=${fields}`, signal) as {
    docs?: {
      key: string; title: string; subtitle?: string; author_name?: string[]; first_publish_year?: number
      isbn?: string[]; cover_i?: number; number_of_pages_median?: number; publisher?: string[]; language?: string[]
    }[]
  }
  return (data.docs ?? []).map(d => ({
    title: d.title, subtitle: d.subtitle, authors: d.author_name ?? [],
    // Prefer a 13-digit ISBN where one is listed.
    isbn: d.isbn?.find(i => i.length === 13) ?? d.isbn?.[0],
    publisher: d.publisher?.[0], publishedYear: d.first_publish_year, pages: d.number_of_pages_median,
    language: d.language?.[0],
    coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : undefined,
    source: 'openlibrary' as const, sourceKey: d.key,
  }))
}

async function googleBooks(q: string, limit: number, signal?: AbortSignal): Promise<BookCandidate[]> {
  const data = await get(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=${limit}&printType=books`, signal) as {
    items?: { id: string; volumeInfo: {
      title: string; subtitle?: string; authors?: string[]; publisher?: string; publishedDate?: string
      description?: string; pageCount?: number; language?: string
      industryIdentifiers?: { type: string; identifier: string }[]
      imageLinks?: { thumbnail?: string; smallThumbnail?: string }
    } }[]
  }
  return (data.items ?? []).map(({ id, volumeInfo: v }) => {
    const ids = v.industryIdentifiers ?? []
    const thumb = v.imageLinks?.thumbnail ?? v.imageLinks?.smallThumbnail
    return {
      title: v.title, subtitle: v.subtitle, authors: v.authors ?? [],
      isbn: ids.find(i => i.type === 'ISBN_13')?.identifier ?? ids[0]?.identifier,
      publisher: v.publisher, publishedYear: Number.parseInt(v.publishedDate ?? '', 10) || undefined,
      pages: v.pageCount || undefined, language: v.language, description: v.description,
      // Google answers http, which a https page will not load as an image.
      // `zoom=2` asks for the larger of its two sizes.
      coverUrl: thumb?.replace(/^http:/, 'https:').replace('&edge=curl', '').replace('zoom=1', 'zoom=2'),
      source: 'google' as const, sourceKey: id,
    }
  })
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** The same book from two sources is one candidate that borrows from both. */
function merge(all: BookCandidate[]): BookCandidate[] {
  const out: BookCandidate[] = []
  for (const c of all) {
    const key = norm(c.title) + '|' + norm(c.authors[0] ?? '')
    const hit = out.find(o => (c.isbn && o.isbn === c.isbn) || norm(o.title) + '|' + norm(o.authors[0] ?? '') === key)
    if (!hit) { out.push({ ...c }); continue }
    // Keep the first source's identity; fill what it lacked from the second.
    hit.coverUrl ??= c.coverUrl
    hit.description ??= c.description
    hit.pages ??= c.pages
    hit.publisher ??= c.publisher
    hit.isbn ??= c.isbn
    hit.language ??= c.language
    hit.publishedYear ??= c.publishedYear
  }
  return out
}

/** One book by its ISBN. Both catalogues index it directly, so this is the
 *  precise question where `lookupBooks` is the fuzzy one. The tell between "no
 *  catalogue knows this" and "no catalogue could be reached" is `failed`. */
export async function lookupByIsbn(isbn: string, signal?: AbortSignal): Promise<LookupResult> {
  const [ol, gb] = await Promise.allSettled([openLibrary(`isbn:${isbn}`, 3, signal), googleBooks(`isbn:${isbn}`, 3, signal)])
  const failed: string[] = []
  if (ol.status === 'rejected') failed.push('Open Library')
  if (gb.status === 'rejected') failed.push('Google Books')
  const all = [...(ol.status === 'fulfilled' ? ol.value : []), ...(gb.status === 'fulfilled' ? gb.value : [])]
  return { candidates: merge(all).slice(0, 1), failed }
}

export async function lookupBooks(query: string, signal?: AbortSignal, limit = 8): Promise<LookupResult> {
  const q = query.trim()
  if (q.length < 2) return { candidates: [], failed: [] }
  const [ol, gb] = await Promise.allSettled([openLibrary(q, limit, signal), googleBooks(q, limit, signal)])
  const failed: string[] = []
  if (ol.status === 'rejected') failed.push('Open Library')
  if (gb.status === 'rejected') failed.push('Google Books')
  // Interleave so neither source buries the other in the first screenful.
  const a = ol.status === 'fulfilled' ? ol.value : []
  const b = gb.status === 'fulfilled' ? gb.value : []
  const mixed: BookCandidate[] = []
  for (let i = 0; i < Math.max(a.length, b.length); i++) { if (a[i]) mixed.push(a[i]); if (b[i]) mixed.push(b[i]) }
  return { candidates: merge(mixed).slice(0, limit), failed }
}

// ─── Discover: an author, and everything they wrote ──────────────────────────
// Open Library only. It is the source that knows an author as a thing with a
// key rather than a string on a book, which is what "show me their other books"
// needs; Google's `inauthor:` is a text match and would return anyone sharing
// the name.

export interface AuthorHit {
  /** Open Library's id, `OL23919A`. */
  key: string
  name: string
  topWork?: string
  workCount?: number
  born?: string
}

export async function searchAuthors(query: string, signal?: AbortSignal, limit = 12): Promise<AuthorHit[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const data = await get(`https://openlibrary.org/search/authors.json?q=${encodeURIComponent(q)}&limit=${limit}`, signal) as {
    docs?: { key: string; name: string; top_work?: string; work_count?: number; birth_date?: string }[]
  }
  return (data.docs ?? []).filter(d => d.key && d.name).map(d => ({
    key: d.key.replace(/^\/authors\//, ''), name: d.name, topWork: d.top_work, workCount: d.work_count, born: d.birth_date,
  }))
}

/** An author's books by their key, most-edited first — which is a decent proxy
 *  for the ones people actually mean. A key is not free text, so it is checked
 *  before it goes into a query string. */
export async function booksByAuthor(key: string, signal?: AbortSignal, limit = 40): Promise<BookCandidate[]> {
  if (!/^OL\d+A$/.test(key)) return []
  const fields = 'key,title,subtitle,author_name,first_publish_year,isbn,cover_i,number_of_pages_median,publisher,language'
  const data = await get(`https://openlibrary.org/search.json?q=${encodeURIComponent(`author_key:${key}`)}&sort=editions&limit=${limit}&fields=${fields}`, signal) as {
    docs?: { key: string; title: string; subtitle?: string; author_name?: string[]; first_publish_year?: number; isbn?: string[]
      cover_i?: number; number_of_pages_median?: number; publisher?: string[]; language?: string[] }[]
  }
  return (data.docs ?? []).map(d => ({
    title: d.title, subtitle: d.subtitle, authors: d.author_name ?? [],
    isbn: d.isbn?.find(i => i.length === 13) ?? d.isbn?.[0],
    publisher: d.publisher?.[0], publishedYear: d.first_publish_year, pages: d.number_of_pages_median, language: d.language?.[0],
    coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : undefined,
    source: 'openlibrary' as const, sourceKey: d.key,
  }))
}

/** Newest first, for the question "what has this author put out lately". Open
 *  Library only (see above), and it **throws** on failure: unlike a search box,
 *  a follow check must tell "nothing new" from "could not look". */
export const latestWorks = (q: string, limit = 40, signal?: AbortSignal): Promise<BookCandidate[]> => openLibrary(q, limit, signal, 'new')

/** Is this candidate already on the shelf? The ISBN is the sure answer; failing
 *  that, the same title by the same first author. Titles are compared with
 *  punctuation and case stripped, since two catalogues never agree on those. */
export function shelfMatch<T extends { id: string; title: string; authors: string[]; isbn?: string }>(books: T[], c: BookCandidate): T | undefined {
  const key = norm(c.title) + '|' + norm(c.authors[0] ?? '')
  return books.find(b => (c.isbn && b.isbn && b.isbn === c.isbn) || norm(b.title) + '|' + norm(b.authors[0] ?? '') === key)
}

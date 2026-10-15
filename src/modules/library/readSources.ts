// ─── Where this book can really be read for free ─────────────────────────────
// A shop's or library's search page is a promise the site may not keep: the Open Library page for a book it does
// not have says "No matching books". So nothing is offered until the source has been **asked**, and a source that
// does not have this book is not shown at all.
//
// Five rules, each with a reason:
//  - **Strict match.** The title must match whole (or once a subtitle is set aside) and the author's surname must be
//    a whole word — `Dune` is not `Dune Messiah`, a different edition's listing is not this book. A title under four
//    characters must match exactly.
//  - **Legal only.** Open Library counts only what it says can be read or borrowed (`ebook_access` public or
//    borrowable — its own lending, which is not "print-disabled only"); the Internet Archive only its lending
//    library or works published before 1930; Gutenberg is public domain by definition; Google Books only a
//    preview it marks as viewable. A community upload of a recent book is not offered.
//  - **The link goes to the book**, not to a search page.
//  - **A source that could not be asked is named, never counted as "does not have it".**
//  - **WorldCat is not here.** It has no public check, so it could only ever be a search page — the thing this
//    replaces.

export interface ReadLink { id: 'openlibrary' | 'archive' | 'gutenberg' | 'googlebooks'; label: string; how: string; href: string }
export interface ReadResult { found: ReadLink[]; failed: string[] }
export interface Readable { title: string; authors: string[]; isbn?: string }
export type Json = (url: string, signal?: AbortSignal) => Promise<unknown>

const defaultJson: Json = async (url, signal) => {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(String(res.status))
  return res.json()
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const surname = (a: string) => {
  // "Herbert, Frank" and "Frank Herbert" both end up as "herbert".
  const comma = a.split(',')
  return norm(comma.length > 1 ? comma[0] : a).split(' ').filter(Boolean).pop() ?? ''
}
const bare = (t: string) => norm(t.split(/[:–—]| - /)[0])
const wholeWord = (hay: string, w: string) => !!w && new RegExp(`(^| )${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(hay)

/** Is `got` this book? Title whole (a subtitle may be set aside either way), author surname a whole word. */
export function isThisBook(want: Readable, got: { title?: string; authors?: string[] }): boolean {
  if (!got.title) return false
  const a = norm(want.title), b = norm(got.title)
  if (!a || !b) return false
  const titleOk = a === b || (bare(want.title).length >= 4 && bare(want.title) === bare(got.title))
  if (!titleOk) return false
  const w = want.authors[0] ? surname(want.authors[0]) : ''
  if (!w) return true
  return (got.authors ?? []).some(g => wholeWord(norm(g), w))
}

const enc = encodeURIComponent
const digits = (s?: string) => (s ?? '').replace(/[^0-9X]/gi, '').toUpperCase()

async function openLibrary(b: Readable, json: Json, signal?: AbortSignal): Promise<ReadLink | null> {
  const isbn = digits(b.isbn)
  const q = isbn ? `isbn:${isbn}` : `title:"${b.title.replace(/"/g, '')}"${b.authors[0] ? ` author:"${b.authors[0].replace(/"/g, '')}"` : ''}`
  const d = await json(`https://openlibrary.org/search.json?q=${enc(q)}&fields=key,title,author_name,ebook_access&limit=10`, signal) as {
    docs?: { key: string; title: string; author_name?: string[]; ebook_access?: string }[]
  }
  const hit = (d.docs ?? []).find(x => (x.ebook_access === 'public' || x.ebook_access === 'borrowable') && (isbn || isThisBook(b, { title: x.title, authors: x.author_name })))
  if (!hit || !/^\/works\/OL\d+W$/.test(hit.key)) return null
  return { id: 'openlibrary', label: 'Open Library', how: hit.ebook_access === 'public' ? 'Read online' : 'Borrow', href: `https://openlibrary.org${hit.key}` }
}

async function internetArchive(b: Readable, json: Json, signal?: AbortSignal): Promise<ReadLink | null> {
  const t = b.title.replace(/["\\()]/g, ' ').trim()
  const au = b.authors[0] ? ` AND creator:(${surname(b.authors[0])})` : ''
  // Its lending library, or old enough to be out of copyright — never a community upload of a recent book.
  const q = `title:(${t})${au} AND mediatype:texts AND (collection:inlibrary OR date:[0001-01-01 TO 1929-12-31])`
  const d = await json(`https://archive.org/advancedsearch.php?q=${enc(q)}&fl[]=identifier&fl[]=title&fl[]=creator&rows=10&output=json`, signal) as {
    response?: { docs?: { identifier: string; title?: string | string[]; creator?: string | string[] }[] }
  }
  const one = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v)
  const many = (v?: string | string[]) => (Array.isArray(v) ? v : v ? [v] : [])
  const hit = (d.response?.docs ?? []).find(x => /^[A-Za-z0-9._-]+$/.test(x.identifier) && isThisBook(b, { title: one(x.title), authors: many(x.creator) }))
  return hit ? { id: 'archive', label: 'Internet Archive', how: 'Borrow or read', href: `https://archive.org/details/${hit.identifier}` } : null
}

async function gutenberg(b: Readable, json: Json, signal?: AbortSignal): Promise<ReadLink | null> {
  const d = await json(`https://gutendex.com/books?search=${enc(`${b.title} ${b.authors[0] ?? ''}`.trim())}`, signal) as {
    results?: { id: number; title: string; authors?: { name: string }[] }[]
  }
  const hit = (d.results ?? []).find(x => isThisBook(b, { title: x.title, authors: (x.authors ?? []).map(a => a.name) }))
  return hit ? { id: 'gutenberg', label: 'Project Gutenberg', how: 'Free to keep', href: `https://www.gutenberg.org/ebooks/${hit.id}` } : null
}

async function googleBooks(b: Readable, json: Json, signal?: AbortSignal): Promise<ReadLink | null> {
  const isbn = digits(b.isbn)
  const q = isbn ? `isbn:${isbn}` : `intitle:"${b.title.replace(/"/g, '')}"${b.authors[0] ? `+inauthor:"${b.authors[0].replace(/"/g, '')}"` : ''}`
  const d = await json(`https://www.googleapis.com/books/v1/volumes?q=${enc(q).replace(/%2B/g, '+')}&maxResults=8&printType=books`, signal) as {
    items?: { id: string; volumeInfo?: { title?: string; authors?: string[]; industryIdentifiers?: { identifier: string }[] }; accessInfo?: { viewability?: string; embeddable?: boolean } }[]
  }
  const hit = (d.items ?? []).find(x => (x.accessInfo?.viewability === 'PARTIAL' || x.accessInfo?.viewability === 'ALL_PAGES')
    && (isbn ? (x.volumeInfo?.industryIdentifiers ?? []).some(i => digits(i.identifier) === isbn) : isThisBook(b, { title: x.volumeInfo?.title, authors: x.volumeInfo?.authors })))
  if (!hit || !/^[A-Za-z0-9_-]+$/.test(hit.id)) return null
  return { id: 'googlebooks', label: 'Google Books', how: hit.accessInfo?.viewability === 'ALL_PAGES' ? 'Read free' : 'Read a sample', href: `https://books.google.com/books?id=${hit.id}` }
}

const SOURCES: [string, (b: Readable, j: Json, s?: AbortSignal) => Promise<ReadLink | null>][] = [
  ['Open Library', openLibrary], ['Internet Archive', internetArchive], ['Project Gutenberg', gutenberg], ['Google Books', googleBooks],
]

/** Asks every source at once. Only sources that have this book come back, in a fixed order. */
export async function findReadable(b: Readable, signal?: AbortSignal, json: Json = defaultJson): Promise<ReadResult> {
  const out = await Promise.allSettled(SOURCES.map(([, ask]) => ask(b, json, signal)))
  const found: ReadLink[] = [], failed: string[] = []
  out.forEach((r, i) => {
    if (r.status === 'fulfilled') { if (r.value) found.push(r.value) }
    // A 404 from a catalogue is "does not have it"; anything else is "could not ask".
    else if ((r.reason as Error)?.message !== '404' && (r.reason as Error)?.name !== 'AbortError') failed.push(SOURCES[i][0])
  })
  return { found, failed }
}

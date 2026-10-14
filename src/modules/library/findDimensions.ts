// ─── Finding a book's real size online ───────────────────────────────────────
// Asks several places and lets `settleDims` decide what to believe. The sources:
//   Open Library's edition record for the ISBN  (`physical_dimensions`, binding, pages)
//   Google Books for the same ISBN               (`dimensions`, page count)
//   the cover pictures themselves                (the book's true proportions)
// A catalogue entry only counts when it is for **this** book: the ISBN must be
// in the answer, or (with no ISBN) the title must match whole and the author's
// surname must too — a wrong edition's size is worse than an honest estimate.
// A source that cannot be reached is named, not treated as "no dimensions".

import { agreeAspect, parseDimensions, settleDims, type Binding, type Reading, type Settled } from './bookDimensions'

export interface DimsDeps {
  json(url: string, signal?: AbortSignal): Promise<unknown>
  /** Width / height of a cover picture, or null if it cannot be loaded or is a placeholder. */
  imageAspect(url: string): Promise<number | null>
}

const defaults: DimsDeps = {
  async json(url, signal) {
    const res = await fetch(url, { signal })
    if (!res.ok) throw new Error(String(res.status))
    return res.json()
  },
  imageAspect: url => new Promise(resolve => {
    const img = new Image()
    const done = (v: number | null) => { img.onload = img.onerror = null; resolve(v) }
    const timer = setTimeout(() => done(null), 6000)
    img.onload = () => { clearTimeout(timer); done(img.naturalHeight >= 120 ? img.naturalWidth / img.naturalHeight : null) }   // a 1×1 "no cover" gif is a miss
    img.onerror = () => { clearTimeout(timer); done(null) }
    img.src = url
  }),
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const surname = (a: string) => norm(a).split(' ').pop() ?? ''
const digits = (s?: string) => (s ?? '').replace(/[^0-9x]/gi, '').toUpperCase()

export interface Found {
  settled: Settled
  pages?: number
  /** Sources that could not be reached. */
  failed: string[]
}

export async function findDimensions(
  b: { isbn?: string; title: string; authors: string[]; pages?: number; coverUrl?: string },
  signal?: AbortSignal, deps: DimsDeps = defaults,
): Promise<Found> {
  const failed: string[] = []
  const readings: Reading[] = []
  const covers: string[] = b.coverUrl ? [b.coverUrl] : []
  let pages = b.pages
  let binding: Binding | undefined
  const isbn = digits(b.isbn)

  const tasks: Promise<void>[] = []
  if (isbn) {
    tasks.push((async () => {
      try {
        const e = await deps.json(`https://openlibrary.org/isbn/${isbn}.json`, signal) as {
          physical_dimensions?: string; physical_format?: string; number_of_pages?: number
        }
        const d = parseDimensions(e.physical_dimensions)
        if (d) readings.push({ dims: d, from: 'Open Library' })
        if (/hard|cloth|board/i.test(e.physical_format ?? '')) binding = 'hardcover'
        else if (/paper|soft|mass/i.test(e.physical_format ?? '')) binding = 'paperback'
        pages ??= e.number_of_pages || undefined
        covers.push(`https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`)
      } catch (err) {
        // A 404 is "Open Library does not have this edition", not "could not reach".
        if ((err as Error).message !== '404') failed.push('Open Library')
      }
    })())
  }
  tasks.push((async () => {
    try {
      const q = isbn ? `isbn:${isbn}` : `intitle:"${b.title.replace(/"/g, '')}"${b.authors[0] ? `+inauthor:"${b.authors[0].replace(/"/g, '')}"` : ''}`
      const data = await deps.json(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q).replace(/%2B/g, '+')}&maxResults=5&printType=books`, signal) as {
        items?: { volumeInfo: { title?: string; authors?: string[]; pageCount?: number
          industryIdentifiers?: { identifier: string }[]
          dimensions?: { height?: string; width?: string; thickness?: string }
          imageLinks?: { thumbnail?: string } } }[]
      }
      const hit = (data.items ?? []).map(i => i.volumeInfo).find(v => isbn
        ? (v.industryIdentifiers ?? []).some(i => digits(i.identifier) === isbn)
        : norm(v.title ?? '') === norm(b.title) && (!b.authors[0] || (v.authors ?? []).some(a => surname(a) === surname(b.authors[0]))))
      if (!hit) return
      const d = parseDimensions(hit.dimensions)
      if (d) readings.push({ dims: d, from: 'Google Books' })
      pages ??= hit.pageCount || undefined
      if (hit.imageLinks?.thumbnail) covers.push(hit.imageLinks.thumbnail.replace(/^http:/, 'https:').replace('&edge=curl', ''))
    } catch { failed.push('Google Books') }
  })())
  await Promise.all(tasks)

  const aspects = (await Promise.all(covers.map(u => deps.imageAspect(u)))).filter((a): a is number => a !== null)
  const coverAspect = agreeAspect(aspects) ?? undefined
  const settled = settleDims(readings, { pages, coverAspect, binding })
  if (aspects.length > 1 && coverAspect === undefined) settled.notes.push('cover pictures disagree, so the cover shape was not used')
  return { settled, pages, failed }
}

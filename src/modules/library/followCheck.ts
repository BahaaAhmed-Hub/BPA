// ─── What counts as new, for an author or a series you follow ────────────────
// A follow is a saved Open Library question plus the works that existed when it
// was asked (`seenKeys`). "New" is what the question returns now that is not in
// that set and is not already on your shelf.
//
// **Following snapshots first, and refuses if it cannot.** A snapshot that failed
// would be an empty set, and an empty set makes every book the author ever wrote
// "new" — the opposite of the feature. So nothing is created until the snapshot
// has been read.
//
// **A series is matched by name**, because no catalogue has a dependable series
// field: `title:"Name"`, optionally narrowed to one author. That is honest about
// being a search, and the screen says so beside the form rather than presenting a
// guess as a fact.
import { latestWorks, shelfMatch, type BookCandidate } from './bookLookup'
import type { Follow } from './types'

const AUTHOR_KEY = /^OL\d+A$/

export function authorQuery(key: string): string | null {
  return AUTHOR_KEY.test(key) ? `author_key:${key}` : null
}

/** `title:"Name"`, optionally `AND author_key:…`. Quotes and backslashes in the
 *  name are removed rather than escaped — a name is a name, and one that breaks
 *  the query syntax would otherwise be a search for something else. */
export function seriesQuery(name: string, authorKey?: string): string | null {
  const n = name.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  if (n.length < 2) return null
  const by = authorKey && AUTHOR_KEY.test(authorKey) ? ` AND author_key:${authorKey}` : ''
  return `title:"${n}"${by}`
}

export const workKey = (c: BookCandidate): string => c.sourceKey ?? c.title.toLowerCase()

/** What the follow's question returns today. Throws if the catalogue cannot be read. */
export async function releasesOf(query: string, limit = 40, signal?: AbortSignal): Promise<BookCandidate[]> {
  return latestWorks(query, limit, signal)
}

/** The set a new follow starts from: everything the question returns now. */
export async function snapshotKeys(query: string, signal?: AbortSignal): Promise<string[]> {
  return (await releasesOf(query, 100, signal)).map(workKey)
}

export function newReleases<B extends { id: string; title: string; authors: string[]; isbn?: string }>(
  f: Pick<Follow, 'seenKeys'>, found: BookCandidate[], books: B[],
): BookCandidate[] {
  const seen = new Set(f.seenKeys)
  const out: BookCandidate[] = []
  const have = new Set<string>()
  for (const c of found) {
    const k = workKey(c)
    if (seen.has(k) || have.has(k) || shelfMatch(books, c)) continue
    have.add(k); out.push(c)
  }
  return out
}

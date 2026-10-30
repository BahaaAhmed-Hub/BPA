/** The server answers any single read with at most 1,000 rows (PostgREST `max-rows`) whatever was
 *  asked for, and says nothing when it has cut the answer short. A plain `select` on a table that
 *  grows every day is therefore *correct until the day it passes 1,000 rows*, and from then on it
 *  returns the oldest 1,000 — for `habit_logs`, the record minus its newest days, which then
 *  replaced the device's own copy at every sync ("I can't find my logs for the last 5 days").
 *  Read in pages instead, in an order that cannot shuffle between pages, until a page is empty.
 *  The step is what came back rather than a fixed 1,000, so a lower server ceiling skips nothing. */
export async function readEvery<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>,
  /** Identifies a row, so a server that ignores the range and answers the same rows again is noticed
   *  (a page with nothing new in it is the last one) rather than asked for ever. */
  keyOf?: (row: T) => string,
  size = 1000,
): Promise<{ data: T[] | null; error: { message: string; code?: string } | null }> {
  const all: T[] = []
  const seen = new Set<string>()
  // A ceiling, not an expectation: 500 pages is half a million rows.
  for (let pages = 0, from = 0; pages < 500; pages++) {
    const { data, error } = await page(from, from + size - 1)
    if (error) return { data: null, error }
    if (!data || data.length === 0) return { data: all, error: null }
    if (keyOf) {
      const fresh = data.filter(r => { const k = keyOf(r); if (seen.has(k)) return false; seen.add(k); return true })
      if (fresh.length === 0) return { data: all, error: null }
      all.push(...fresh)
    } else {
      all.push(...data)
    }
    from += data.length
  }
  return { data: null, error: { message: 'a read did not end (500 pages)' } }
}

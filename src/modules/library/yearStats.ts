// ─── A year of reading, counted from what is already there ───────────────────
// Nothing is stored for this: it is the finished books, the session log and the
// quotes, read for one calendar year. A book belongs to the year it was
// *finished* in — by its finish date — so a book with no date is in no year, and
// the review says how many such books it left out rather than quietly losing them.
import { daysBetween, streaks } from './trackerStats'
import { todayISO } from './readingStats'
import type { Book, ListBook, LibList, Quote, ReadingSession } from './types'

export interface Ratings {
  rated: number
  unrated: number
  /** Mean of the rated ones, to one decimal; null when none are rated. */
  avg: number | null
  /** Index 0 is one star, index 4 is five. */
  dist: [number, number, number, number, number]
}

export interface YearReview {
  year: number
  finished: Book[]
  count: number
  /** Pages of the finished books whose page count is known, and how many of them that is. */
  pages: number
  pagesKnown: number
  readMinutes: number
  listenMinutes: number
  daysRead: number
  longestStreak: number
  /** Books finished in each month, January first. */
  months: number[]
  busiest: { month: number; count: number } | null
  ratings: Ratings
  /** Finished this year with the top rating, in the order finished (at most five). */
  top: Book[]
  longest: Book | null
  shortest: Book | null
  fastest: { book: Book; days: number } | null
  slowest: { book: Book; days: number } | null
  topAuthor: { name: string; count: number } | null
  quotes: number
  categories: { name: string; count: number }[]
  /** Finished books that have no finish date at all, so belong to no year. */
  undated: number
}

const yearOf = (iso?: string) => (iso ? Number(iso.slice(0, 4)) : NaN)

export function ratingsOf(books: Pick<Book, 'rating'>[]): Ratings {
  const dist: Ratings['dist'] = [0, 0, 0, 0, 0]
  let sum = 0, rated = 0
  for (const b of books) {
    if (b.rating >= 1 && b.rating <= 5) { dist[b.rating - 1]++; sum += b.rating; rated++ }
  }
  return { rated, unrated: books.length - rated, avg: rated ? Math.round((sum / rated) * 10) / 10 : null, dist }
}

/** Ties go to the earlier-finished book, so the answer does not depend on the order the server returned them in. */
const pickBy = <T,>(xs: T[], score: (x: T) => number, better: (a: number, b: number) => boolean): T | null => {
  let best: T | null = null, bs = 0
  for (const x of xs) { const s = score(x); if (best === null || better(s, bs)) { best = x; bs = s } }
  return best
}

export function yearReview(
  year: number, books: Book[], sessions: ReadingSession[], quotes: Quote[],
  links: ListBook[], lists: LibList[], today: string = todayISO(),
): YearReview {
  const finished = books
    .filter(b => yearOf(b.finishedOn) === year)
    .sort((a, b) => (a.finishedOn ?? '').localeCompare(b.finishedOn ?? '') || a.title.localeCompare(b.title))
  const mine = sessions.filter(s => yearOf(s.on) === year && s.on <= today)

  let pages = 0, pagesKnown = 0
  for (const b of finished) if (b.pages) { pages += b.pages; pagesKnown++ }
  let readMinutes = 0, listenMinutes = 0
  for (const s of mine) { if (s.kind === 'read') readMinutes += s.minutes; else listenMinutes += s.minutes }

  const months = Array<number>(12).fill(0)
  for (const b of finished) months[Number((b.finishedOn ?? '').slice(5, 7)) - 1]++
  const top = Math.max(0, ...months)
  const busiest = top > 0 ? { month: months.indexOf(top), count: top } : null

  const sized = finished.filter(b => b.pages)
  const timed = finished.flatMap(b => {
    if (!b.startedOn || !b.finishedOn || b.startedOn > b.finishedOn) return []
    return [{ book: b, days: daysBetween(b.startedOn, b.finishedOn) + 1 }]
  })

  const authors = new Map<string, number>()
  for (const b of finished) { const a = b.authors[0]?.trim(); if (a) authors.set(a, (authors.get(a) ?? 0) + 1) }
  const topAuthors = [...authors].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const topAuthor = topAuthors[0] && topAuthors[0][1] >= 2 ? { name: topAuthors[0][0], count: topAuthors[0][1] } : null

  const catName = new Map(lists.filter(l => l.kind === 'category').map(l => [l.id, l.name]))
  const cats = new Map<string, number>()
  for (const b of finished) for (const l of links) if (l.bookId === b.id && catName.has(l.listId)) cats.set(catName.get(l.listId)!, (cats.get(catName.get(l.listId)!) ?? 0) + 1)

  const lastDay = `${year}-12-31`
  return {
    year, finished, count: finished.length, pages, pagesKnown, readMinutes, listenMinutes,
    daysRead: new Set(mine.map(s => s.on)).size,
    longestStreak: streaks(mine, today < lastDay ? today : lastDay).longest,
    months, busiest, ratings: ratingsOf(finished),
    top: finished.filter(b => b.rating === 5).slice(0, 5),
    longest: pickBy(sized, b => b.pages!, (a, c) => a > c), shortest: pickBy(sized, b => b.pages!, (a, c) => a < c),
    fastest: pickBy(timed, t => t.days, (a, c) => a < c), slowest: pickBy(timed, t => t.days, (a, c) => a > c),
    topAuthor,
    // createdAt is a UTC instant; the year it belongs to is the one on the reader's calendar when it was saved, or a
    // quote saved at 00:30 on 1 January in Cairo would be counted in the year before.
    quotes: quotes.filter(q => new Date(q.createdAt).getFullYear() === year).length,
    categories: [...cats].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 5),
    undated: books.filter(b => b.status === 'finished' && !b.finishedOn).length,
  }
}

export const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const hours = (m: number) => (m >= 60 ? `${Math.round(m / 6) / 10} h` : `${m} min`)

/** The review as plain Markdown, to paste into a note or a message. Only what is true is said: no zero lines. */
export function yearMarkdown(r: YearReview): string {
  const out: string[] = [`# ${r.year} in books`, '']
  if (!r.count) { out.push(`No books finished in ${r.year} yet.`); return out.join('\n') }
  out.push(`- **${r.count}** book${r.count === 1 ? '' : 's'} finished${r.pagesKnown ? `, about **${r.pages.toLocaleString('en-US')}** pages${r.pagesKnown < r.count ? ` (${r.pagesKnown} with a page count)` : ''}` : ''}`)
  if (r.readMinutes) out.push(`- **${hours(r.readMinutes)}** reading${r.listenMinutes ? ` and **${hours(r.listenMinutes)}** listening` : ''}, over **${r.daysRead}** day${r.daysRead === 1 ? '' : 's'}`)
  else if (r.listenMinutes) out.push(`- **${hours(r.listenMinutes)}** listening, over **${r.daysRead}** day${r.daysRead === 1 ? '' : 's'}`)
  if (r.longestStreak > 1) out.push(`- A longest streak of **${r.longestStreak}** days`)
  if (r.busiest) out.push(`- Busiest month: **${MONTH[r.busiest.month]}** (${r.busiest.count})`)
  if (r.ratings.avg !== null) out.push(`- Average rating **${r.ratings.avg}** ★ across ${r.ratings.rated} rated`)
  if (r.longest && r.shortest && r.longest.id !== r.shortest.id) out.push(`- Longest: *${r.longest.title}* (${r.longest.pages} pages) · shortest: *${r.shortest.title}* (${r.shortest.pages})`)
  if (r.fastest && r.slowest && r.fastest.book.id !== r.slowest.book.id) out.push(`- Fastest: *${r.fastest.book.title}* (${r.fastest.days} day${r.fastest.days === 1 ? '' : 's'}) · slowest: *${r.slowest.book.title}* (${r.slowest.days})`)
  if (r.topAuthor) out.push(`- Most read: **${r.topAuthor.name}** (${r.topAuthor.count} books)`)
  if (r.quotes) out.push(`- **${r.quotes}** quote${r.quotes === 1 ? '' : 's'} saved`)
  if (r.top.length) { out.push('', '## Five stars', ...r.top.map(b => `- ${b.title}${b.authors[0] ? ` — ${b.authors[0]}` : ''}`)) }
  out.push('', '## Finished', ...r.finished.map(b => `- ${b.finishedOn}  ${b.title}${b.authors[0] ? ` — ${b.authors[0]}` : ''}${b.rating ? `  ${'★'.repeat(b.rating)}` : ''}`))
  return out.join('\n')
}

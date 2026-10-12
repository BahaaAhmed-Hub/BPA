// ─── Where to get a book ─────────────────────────────────────────────────────
// Links, not prices. Every one opens a store's or library's *own search page*
// for this book — nothing here asks whether it is in stock or what it costs
// (the price watch is a later phase), and it says so on screen.
//
// **Free means legal.** Open Library and the Internet Archive lend scanned
// editions; Project Gutenberg has books out of copyright; Google Books shows a
// preview; WorldCat finds the nearest library that will lend you the real thing.
// There are no "free PDF" sites in this list and there will not be: a link to a
// pirated copy is not something a reading app should hand over, however often it
// is asked for.
//
// **The country picks the storefront**, because the same title is a different
// price, a different edition and sometimes a different availability by country.
// The list of regions is a few dozen the stores actually serve; their *names*
// come from `Intl.DisplayNames`, never a hand-typed table (the mistake the
// shopping currency list made).

export interface BookLink { id: string; label: string; href: string; note: string }
export interface LinkSet { free: BookLink[]; buy: BookLink[] }
export interface Findable { title: string; authors: string[]; isbn?: string }

/** Amazon's storefront per region. A region with none falls through to .com,
 *  which ships abroad, and the note says so. */
const AMAZON: Record<string, string> = {
  US: 'com', GB: 'co.uk', CA: 'ca', AU: 'com.au', DE: 'de', FR: 'fr', ES: 'es', IT: 'it', NL: 'nl', SE: 'se', PL: 'pl',
  JP: 'co.jp', IN: 'in', BR: 'com.br', MX: 'com.mx', AE: 'ae', SA: 'sa', EG: 'eg', TR: 'com.tr', SG: 'sg', BE: 'com.be', IE: 'ie',
}
/** Regions where Jamalon, an Arabic-and-English bookseller, delivers. */
const JAMALON = new Set(['EG', 'SA', 'AE', 'KW', 'QA', 'BH', 'OM', 'JO', 'LB', 'IQ'])
const BOOKSHOP = new Set(['US', 'GB'])

export const COUNTRY_CODES: string[] = [
  ...new Set([...Object.keys(AMAZON), ...JAMALON]),
].sort()

export function countryName(code: string): string {
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code } catch { return code }
}

/** The region the browser is set to ("en-GB" → GB), or US when it names none
 *  ("en", "ar"): a guess, shown, and changeable on the card. */
export function defaultCountry(lang: string = typeof navigator === 'undefined' ? '' : navigator.language): string {
  const m = /[-_]([A-Za-z]{2})\b/.exec(lang)
  return m ? m[1].toUpperCase() : 'US'
}

const enc = encodeURIComponent

export function linksFor(book: Findable, countryCode: string): LinkSet {
  const cc = /^[A-Z]{2}$/.test(countryCode) ? countryCode : 'US'
  const isbn = book.isbn?.replace(/[^0-9Xx]/g, '')
  const q = enc(isbn || [book.title, book.authors[0]].filter(Boolean).join(' '))
  const text = enc([book.title, book.authors[0]].filter(Boolean).join(' '))
  const tld = AMAZON[cc]

  const free: BookLink[] = [
    { id: 'openlibrary', label: 'Open Library', note: 'Borrow or read a scanned copy online',
      href: isbn ? `https://openlibrary.org/isbn/${enc(isbn)}` : `https://openlibrary.org/search?q=${text}&mode=everything` },
    { id: 'archive', label: 'Internet Archive', note: 'Borrow a digital copy, or read it if it is out of copyright',
      href: `https://archive.org/search?query=${q}` },
    { id: 'gutenberg', label: 'Project Gutenberg', note: 'Free to keep — books whose copyright has ended',
      href: `https://www.gutenberg.org/ebooks/search/?query=${text}` },
    { id: 'googlebooks', label: 'Google Books preview', note: 'Read a sample',
      href: isbn ? `https://books.google.com/books?vid=ISBN${enc(isbn)}` : `https://www.google.com/search?tbm=bks&q=${text}` },
    { id: 'worldcat', label: 'A library near you', note: 'WorldCat finds the nearest library that holds it',
      href: `https://search.worldcat.org/search?q=${q}` },
  ]

  const buy: BookLink[] = [
    { id: 'amazon', label: `Amazon${tld ? `.${tld}` : '.com'}`, note: tld ? 'Print and Kindle' : 'Ships to many countries',
      href: `https://www.amazon.${tld ?? 'com'}/s?k=${q}&i=stripbooks` },
    { id: 'play', label: 'Google Play Books', note: 'E-book and audiobook',
      href: `https://play.google.com/store/search?q=${q}&c=books&gl=${cc}` },
    { id: 'kobo', label: 'Kobo', note: 'E-book',
      href: `https://www.kobo.com/ww/en/search?query=${q}` },
    { id: 'abebooks', label: 'AbeBooks', note: 'Used and out-of-print',
      href: isbn ? `https://www.abebooks.com/servlet/SearchResults?isbn=${enc(isbn)}` : `https://www.abebooks.com/servlet/SearchResults?kn=${text}` },
  ]
  if (BOOKSHOP.has(cc)) buy.splice(1, 0, { id: 'bookshop', label: 'Bookshop.org', note: 'Supports independent bookshops',
    href: `https://bookshop.org/search?keywords=${q}` })
  if (JAMALON.has(cc)) buy.splice(1, 0, { id: 'jamalon', label: 'Jamalon', note: 'Arabic and English books, delivered in your region',
    href: `https://www.jamalon.com/en/catalogsearch/result/?q=${text}` })

  return { free, buy }
}

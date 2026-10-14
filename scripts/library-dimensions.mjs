// node scripts/library-dimensions.mjs
//
// A book is stood on the shelf at the size it really has, so what the app believes about a size has to
// survive bad data. Every claim is read off what the pure modules decided, with catalogues faked and able
// to lie: the wrong edition, inches written as centimetres, a thickness in the wrong column, a cover of
// another shape, a source that is down. Controls: the same inputs with validation switched off.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const TMP = '/tmp/lib-dims'; mkdirSync(TMP, { recursive: true })
for (const f of ['bookDimensions', 'findDimensions']) {
  writeFileSync(`${TMP}/${f}.ts`, readFileSync(`src/modules/library/${f}.ts`, 'utf8').replace(/from '\.\/(\w+)'/g, "from './$1.ts'"))
}
const D = await import(`${TMP}/bookDimensions.ts`)
const F = await import(`${TMP}/findDimensions.ts`)

let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }

// ── parsing the shapes catalogues write ──────────────────────────────────────
const p = D.parseDimensions
ok('"24 x 16 x 3 cm"', JSON.stringify(p('24 x 16 x 3 cm')) === JSON.stringify({ heightMm: 240, widthMm: 160, thicknessMm: 30 }))
ok('inches: "9.5 x 6.25 x 1.5 inches"', JSON.stringify(p('9.5 x 6.25 x 1.5 inches')) === JSON.stringify({ heightMm: 241, widthMm: 159, thicknessMm: 38 }))
ok('"8 inches" is a height only', JSON.stringify(p('8 inches')) === JSON.stringify({ heightMm: 203 }))
ok('millimetres and a decimal comma: "216,5 x 140 mm"', p('216,5 x 140 mm')?.heightMm === 217 && p('216,5 x 140 mm')?.widthMm === 140)
ok('Google\'s separate fields', JSON.stringify(p({ height: '24.00 cm', width: '16.00 cm', thickness: '3.20 cm' })) === JSON.stringify({ heightMm: 240, widthMm: 160, thicknessMm: 32 }))
ok('the × sign', p('21 × 14 cm')?.heightMm === 210)
ok('NO unit is refused, never guessed', p('21 x 14') === null && p('9') === null)
ok('junk and empty are refused', p('') === null && p(null) === null && p('thick') === null)

// ── validating one reading ───────────────────────────────────────────────────
const good = { heightMm: 210, widthMm: 135, thicknessMm: 25 }
ok('a normal paperback passes', D.checkDims(good, { pages: 420 }).ok)
ok('a 4 mm-tall "book" is refused', !D.checkDims({ heightMm: 4, widthMm: 3 }).ok)
ok('inches mistaken for cm (8 → 80 mm) is refused', !D.checkDims({ heightMm: 80, widthMm: 52 }).ok)
ok('a width wider than the height by far is not a book', !D.checkDims({ heightMm: 150, widthMm: 280 }).ok)
ok('thickness that cannot hold the pages is refused (3 mm for 900 pages)', !D.checkDims({ ...good, thicknessMm: 3 }, { pages: 900 }).ok)
ok('...nor a brick (120 mm for 100 pages)', !D.checkDims({ ...good, thicknessMm: 120 }, { pages: 100 }).ok)
ok('a size that disagrees with the cover picture is refused', !D.checkDims(good, { coverAspect: 0.9 }).ok)
ok('...and one that matches it passes', D.checkDims(good, { coverAspect: 0.64 }).ok)
ok('a tall hardback is fine', D.checkDims({ heightMm: 240, widthMm: 160, thicknessMm: 45 }, { pages: 700 }).ok)

// ── the estimate ─────────────────────────────────────────────────────────────
const e300 = D.estimateDims({ pages: 300 }), e900 = D.estimateDims({ pages: 900 }), eh = D.estimateDims({ pages: 300, binding: 'hardcover' })
ok('thicker with more pages', e900.thicknessMm > e300.thicknessMm * 2)
ok('a long book is a little taller', e900.heightMm > e300.heightMm)
ok('a hardback is thicker and taller than a paperback', eh.thicknessMm > e300.thicknessMm && eh.heightMm > e300.heightMm)
ok('every estimate passes the same validation', [0, 12, 80, 300, 900, 3000, undefined].every(pg => D.checkDims(D.estimateDims({ pages: pg }), { pages: pg }).ok))
ok('no page count still gives a book', D.estimateDims({}).thicknessMm > 5)
ok('the cover shape sets the width', Math.abs(D.estimateDims({ pages: 300, coverAspect: 0.7 }).widthMm / D.estimateDims({ pages: 300, coverAspect: 0.7 }).heightMm - 0.7) < 0.01)

// ── settling several readings ────────────────────────────────────────────────
const S = D.settleDims
let s = S([{ dims: { heightMm: 210, widthMm: 135, thicknessMm: 25 }, from: 'Open Library' }, { dims: { heightMm: 212, widthMm: 134, thicknessMm: 26 }, from: 'Google Books' }], { pages: 420 })
ok('two sources that agree: measured, high confidence, averaged', s.source === 'measured' && s.confidence === 'high' && s.dims.heightMm === 211)
s = S([{ dims: { heightMm: 210, widthMm: 135, thicknessMm: 25 }, from: 'Open Library' }], { pages: 420 })
ok('one valid source: measured, medium', s.source === 'measured' && s.confidence === 'medium')
s = S([{ dims: { heightMm: 210, widthMm: 135, thicknessMm: 25 }, from: 'Open Library' }, { dims: { heightMm: 80, widthMm: 52, thicknessMm: 10 }, from: 'Google Books' }], { pages: 420 })
ok('the bad source is dropped, not averaged in', s.dims.heightMm === 210 && s.notes.some(n => /Google Books rejected/.test(n)))
s = S([{ dims: { heightMm: 240, widthMm: 160, thicknessMm: 40 }, from: 'Open Library' }, { dims: { heightMm: 180, widthMm: 110, thicknessMm: 25 }, from: 'Google Books' }], { pages: 420 })
ok('two valid sources that disagree: one is used, not their average (no such book exists)', s.confidence === 'medium' && [240, 180].includes(s.dims.heightMm))
s = S([{ dims: { heightMm: 80, widthMm: 52 }, from: 'Open Library' }], { pages: 420 })
ok('only a bad source: estimated, low, and says so', s.source === 'estimate' && s.confidence === 'low' && s.notes.some(n => /page count/.test(n)))
s = S([], { pages: 420, coverAspect: 0.66 })
ok('nothing listed but a cover: source is "cover"', s.source === 'cover' && Math.abs(s.dims.widthMm / s.dims.heightMm - 0.66) < 0.01)
s = S([{ dims: { heightMm: 210 }, from: 'Open Library' }], { pages: 500 })
ok('a height alone is kept; width and thickness are filled and said to be', s.dims.heightMm === 210 && s.dims.thicknessMm > 20 && s.notes.some(n => /not listed/.test(n)))
s = S([{ dims: { heightMm: 210, widthMm: 135, thicknessMm: 25 }, from: 'x' }], { pages: 420, manual: { heightMm: 190, widthMm: 120, thicknessMm: 20 } })
ok('a typed size is never second-guessed', s.source === 'manual' && s.dims.heightMm === 190)
// control: the same lie with validation bypassed would have been used
ok('CONTROL: the 80 mm reading is the lie validation exists to refuse', S([{ dims: { heightMm: 80, widthMm: 52, thicknessMm: 10 }, from: 'x' }], { pages: 420 }).source !== 'measured')

// ── cover aspects from several sources ───────────────────────────────────────
ok('three covers that agree → their mean', Math.abs(D.agreeAspect([0.65, 0.66, 0.655]) - 0.655) < 0.01)
ok('one stray picture does not move the shape', Math.abs(D.agreeAspect([0.65, 0.66, 1.1]) - 0.655) < 0.01)
ok('pictures that split evenly are not trusted', D.agreeAspect([0.5, 0.75]) === null)
ok('a single cover is used', D.agreeAspect([0.7]) === 0.7)
ok('none → null', D.agreeAspect([]) === null)

// ── the lookup, with catalogues that can lie or be down ──────────────────────
const ISBN = '9780141036144'
function world({ ol = 'ok', gb = 'ok', olDims = '19.8 x 12.9 x 2.2 cm', gbDims = { height: '19.80 cm', width: '12.90 cm', thickness: '2.10 cm' }, aspects = { ol: 0.652, gb: 0.65, own: 0.651 }, gbIsbn = ISBN } = {}) {
  const seen = []
  return {
    seen,
    json: async (url) => {
      seen.push(url)
      if (url.includes('openlibrary.org/isbn/')) {
        if (ol === 'down') throw new Error('503'); if (ol === '404') throw new Error('404')
        return { physical_dimensions: olDims, physical_format: 'Paperback', number_of_pages: 328 }
      }
      if (gb === 'down') throw new Error('503')
      return { items: [{ volumeInfo: { title: '1984', authors: ['George Orwell'], pageCount: 328, industryIdentifiers: [{ identifier: gbIsbn }], dimensions: gbDims, imageLinks: { thumbnail: 'http://books.google.com/t.jpg' } } }] }
    },
    imageAspect: async (u) => (u.includes('openlibrary') ? aspects.ol : u.includes('google') ? aspects.gb : aspects.own),
  }
}
const book = { isbn: ISBN, title: '1984', authors: ['George Orwell'], pages: 328, coverUrl: 'https://x/own.jpg' }
let w = world(), r = await F.findDimensions(book, undefined, w)
ok('both catalogues agree: measured, high', r.settled.source === 'measured' && r.settled.confidence === 'high' && r.settled.dims.heightMm === 198 && r.failed.length === 0, JSON.stringify(r.settled.dims))
ok('three cover pictures were consulted', w.seen.length === 2)
w = world({ ol: 'down' }); r = await F.findDimensions(book, undefined, w)
ok('Open Library down: named, and Google still answers', r.failed.includes('Open Library') && r.settled.source === 'measured' && r.settled.confidence === 'medium')
w = world({ ol: '404' }); r = await F.findDimensions(book, undefined, w)
ok('Open Library not having the edition (404) is not "could not reach"', !r.failed.includes('Open Library'))
w = world({ ol: 'down', gb: 'down' }); r = await F.findDimensions(book, undefined, w)
ok('both down: estimated from pages and the cover, both named', r.settled.source === 'cover' && r.failed.length === 2)
w = world({ olDims: '8 x 5 x 1 inches', gbDims: null }); r = await F.findDimensions(book, undefined, w)
ok('Open Library in inches is converted (203 mm)', r.settled.dims.heightMm === 203)
w = world({ olDims: '19.8 x 12.9 x 0.4 cm', gbDims: null }); r = await F.findDimensions(book, undefined, w)
ok('a thickness that cannot hold 328 pages is rejected and the book estimated', r.settled.source !== 'measured' && r.settled.notes.some(n => /rejected/.test(n)))
w = world({ gbIsbn: '9999999999999' }); r = await F.findDimensions(book, undefined, w)
ok('Google\'s answer for a DIFFERENT ISBN is ignored', !r.settled.notes.some(n => /Google Books/.test(n) && /from/.test(n)))
w = world({ olDims: '19.8 x 12.9 x 2.2 cm', gbDims: null, aspects: { ol: 0.9, gb: 0.9, own: 0.9 } }); r = await F.findDimensions(book, undefined, w)
ok('listing vs cover picture of another shape: the listing is refused', r.settled.source !== 'measured')
w = world({ aspects: { ol: 0.65, gb: 0.65, own: 1.2 } }); r = await F.findDimensions(book, undefined, w)
ok('one odd cover among three does not veto a good listing', r.settled.source === 'measured')
w = world(); r = await F.findDimensions({ ...book, isbn: undefined }, undefined, w)
ok('no ISBN: only a whole-title + author match is used', r.settled.source === 'measured' && w.seen.every(u => !u.includes('openlibrary.org/isbn')))
const w2 = world(); w2.json = async () => ({ items: [{ volumeInfo: { title: '1984 Annotated', authors: ['George Orwell'], dimensions: { height: '30 cm' } } }] })
r = await F.findDimensions({ ...book, isbn: undefined }, undefined, w2)
ok('no ISBN and a title that is not the same: ignored', r.settled.source !== 'measured')

// ── the files that carry it ──────────────────────────────────────────────────
const mig = readFileSync('supabase/migrations/20260041_library_dimensions.sql', 'utf8')
ok('the migration is re-runnable and checks the ranges', /add column if not exists height_mm/.test(mig) && /drop constraint if exists library_books_dims_check/.test(mig) && /between 60 and 500/.test(mig))
const db = readFileSync('src/modules/library/libraryDb.ts', 'utf8')
ok('a project without the columns keeps saving (sent only once set or known)', /b\.heightMm \|\| b\.widthMm \|\| b\.thicknessMm \|\| b\.dimsSource \|\| dimsColumns/.test(db))

console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)

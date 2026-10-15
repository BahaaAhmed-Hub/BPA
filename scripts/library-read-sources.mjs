// node scripts/library-read-sources.mjs
// "Read or borrow" only lists places that have been ASKED and have this book. Catalogues are faked and able to lie:
// a different edition, an in-copyright upload, a title that is a prefix, a source that is down.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
mkdirSync('/tmp/lib-read', { recursive: true })
writeFileSync('/tmp/lib-read/readSources.ts', readFileSync('src/modules/library/readSources.ts', 'utf8'))
const R = await import('/tmp/lib-read/readSources.ts')
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }

// ── matching ─────────────────────────────────────────────────────────────────
const dune = { title: 'Dune', authors: ['Frank Herbert'] }
ok('same title and author', R.isThisBook(dune, { title: 'Dune', authors: ['Frank Herbert'] }))
ok('case and punctuation do not matter', R.isThisBook({ title: 'Rich Dad, Poor Dad', authors: ['Robert T. Kiyosaki'] }, { title: 'rich dad poor dad', authors: ['Kiyosaki, Robert T.'] }))
ok('"Surname, First" form (Gutenberg) matches', R.isThisBook(dune, { title: 'Dune', authors: ['Herbert, Frank'] }))
ok('Dune is not Dune Messiah', !R.isThisBook(dune, { title: 'Dune Messiah', authors: ['Frank Herbert'] }))
ok('a subtitle may be set aside', R.isThisBook({ title: 'Atomic Habits', authors: ['James Clear'] }, { title: 'Atomic Habits: An Easy & Proven Way', authors: ['James Clear'] }))
ok('...in the other direction too', R.isThisBook({ title: 'Atomic Habits: Tiny Changes', authors: ['James Clear'] }, { title: 'Atomic Habits', authors: ['James Clear'] }))
ok('surname is a whole word (Clear is not Clearwater)', !R.isThisBook({ title: 'Atomic Habits', authors: ['James Clear'] }, { title: 'Atomic Habits', authors: ['Ann Clearwater'] }))
ok('another author with the same title is refused', !R.isThisBook(dune, { title: 'Dune', authors: ['Someone Else'] }))
ok('a short title must match exactly ("It" is not "It: A Novel")', !R.isThisBook({ title: 'It', authors: ['Stephen King'] }, { title: 'It: A Novel', authors: ['Stephen King'] }))

// ── a world where every source can answer, and every answer can be wrong ─────
const W = (o = {}) => {
  const seen = []
  return {
    seen,
    json: async (url) => {
      seen.push(url)
      const host = new URL(url).host
      const down = o[host] === 'down'
      if (down) throw new Error('503')
      if (o[host] === '404') throw new Error('404')
      if (host === 'openlibrary.org') return { docs: o.ol ?? [{ key: '/works/OL1W', title: 'Dune', author_name: ['Frank Herbert'], ebook_access: 'borrowable' }] }
      if (host === 'archive.org') return { response: { docs: o.ia ?? [{ identifier: 'dune00herb', title: 'Dune', creator: ['Herbert, Frank'] }] } }
      if (host === 'gutendex.com') return { results: o.gu ?? [] }
      return { items: o.gb ?? [{ id: 'abc123', volumeInfo: { title: 'Dune', authors: ['Frank Herbert'] }, accessInfo: { viewability: 'PARTIAL' } }] }
    },
  }
}
const run = async (o, b = dune) => { const w = W(o); const r = await R.findReadable(b, undefined, w.json); return { ...r, w, ids: r.found.map(l => l.id) } }

let r = await run({})
ok('sources that have it are shown (Open Library, Internet Archive, Google)', r.ids.join() === 'openlibrary,archive,googlebooks', r.ids.join())
ok('and Gutenberg, which had nothing, is not', !r.ids.includes('gutenberg'))
ok('links go to the book, not a search page', r.found.every(l => !/search/.test(l.href)) && r.found[0].href === 'https://openlibrary.org/works/OL1W')
ok('Open Library says Borrow for a lent book, Read online for a public one', r.found[0].how === 'Borrow' && (await run({ ol: [{ key: '/works/OL1W', title: 'Dune', author_name: ['Frank Herbert'], ebook_access: 'public' }] })).found[0].how === 'Read online')
ok('every source was asked', r.w.seen.length === 4)

// the cases the old buttons got wrong
r = await run({ ol: [{ key: '/works/OL2W', title: 'Dune', author_name: ['Frank Herbert'], ebook_access: 'no_ebook' }] })
ok('Open Library: a book it lists but cannot lend is NOT offered', !r.ids.includes('openlibrary'))
r = await run({ ol: [{ key: '/works/OL2W', title: 'Dune', author_name: ['Frank Herbert'], ebook_access: 'printdisabled' }] })
ok('Open Library: print-disabled access only is NOT offered', !r.ids.includes('openlibrary'))
r = await run({ ol: [{ key: '/works/OL3W', title: 'Dune Messiah', author_name: ['Frank Herbert'], ebook_access: 'public' }] })
ok('Open Library: a different book is NOT offered', !r.ids.includes('openlibrary'))
r = await run({ ol: [] })
ok('Open Library: nothing found → not shown at all (the screenshot case)', !r.ids.includes('openlibrary') && r.failed.length === 0)
r = await run({ ol: [{ key: '/evil"><script>', title: 'Dune', author_name: ['Frank Herbert'], ebook_access: 'public' }] })
ok('a malformed catalogue key is never put in a link', !r.ids.includes('openlibrary'))
r = await run({ ia: [{ identifier: 'dune-copy', title: 'Dune Messiah', creator: 'Frank Herbert' }] })
ok('Internet Archive: a different title is NOT offered', !r.ids.includes('archive'))
r = await run({ ia: [{ identifier: 'bad id/<x>', title: 'Dune', creator: 'Frank Herbert' }] })
ok('Internet Archive: an odd identifier is never put in a link', !r.ids.includes('archive'))
const iaUrl = r.w.seen.find(u => u.includes('archive.org'))
ok('Internet Archive is asked only for its lending library or pre-1930 works (never a recent upload)', /collection%3Ainlibrary/.test(iaUrl) && /1929-12-31/.test(iaUrl) && /mediatype%3Atexts/.test(iaUrl))
r = await run({ gu: [{ id: 345, title: 'Dracula', authors: [{ name: 'Stoker, Bram' }] }] }, { title: 'Dracula', authors: ['Bram Stoker'] })
ok('Gutenberg: found by title and "Surname, First"', r.found.find(l => l.id === 'gutenberg')?.href === 'https://www.gutenberg.org/ebooks/345')
r = await run({ gu: [{ id: 9, title: 'Dracula', authors: [{ name: 'Someone, Else' }] }] }, { title: 'Dracula', authors: ['Bram Stoker'] })
ok('Gutenberg: same title by another author is NOT offered', !r.ids.includes('gutenberg'))
r = await run({ gb: [{ id: 'zz', volumeInfo: { title: 'Dune', authors: ['Frank Herbert'] }, accessInfo: { viewability: 'NO_PAGES' } }] })
ok('Google Books: no viewable preview → not shown', !r.ids.includes('googlebooks'))
r = await run({ gb: [{ id: 'zz', volumeInfo: { title: 'Dune', authors: ['Frank Herbert'] }, accessInfo: { viewability: 'ALL_PAGES' } }] })
ok('Google Books: a fully viewable book says Read free', r.found.find(l => l.id === 'googlebooks')?.how === 'Read free')
r = await run({ gb: [{ id: 'a/b', volumeInfo: { title: 'Dune', authors: ['Frank Herbert'] }, accessInfo: { viewability: 'PARTIAL' } }] })
ok('Google Books: an odd id is never put in a link', !r.ids.includes('googlebooks'))
r = await run({}, { ...dune, isbn: '9780441172719' })
ok('with an ISBN the question is the ISBN, not the words', r.w.seen.some(u => /isbn%3A9780441172719/.test(u)))
r = await run({ gb: [{ id: 'q', volumeInfo: { title: 'Dune', authors: ['Frank Herbert'], industryIdentifiers: [{ identifier: '9999999999999' }] }, accessInfo: { viewability: 'PARTIAL' } }] }, { ...dune, isbn: '9780441172719' })
ok('Google Books: a preview of another ISBN is NOT offered', !r.ids.includes('googlebooks'))
ok('WorldCat is not among the sources (it cannot be checked)', !r.found.some(l => l.id === 'worldcat') && !r.w.seen.some(u => /worldcat/.test(u)))

// failures are named, never "does not have it"
r = await run({ 'openlibrary.org': 'down' })
ok('a source that is down is named, the others still answer', r.failed.join() === 'Open Library' && r.ids.includes('archive'))
r = await run({ 'openlibrary.org': '404' })
ok('a 404 means "does not have it", not "could not ask"', r.failed.length === 0 && !r.ids.includes('openlibrary'))
r = await run({ 'openlibrary.org': 'down', 'archive.org': 'down', 'gutendex.com': 'down', 'www.googleapis.com': 'down' })
ok('all down: nothing found, all four named', r.found.length === 0 && r.failed.length === 4)
// control: the old behaviour offered a link whatever the answer was
const old = await run({ ol: [], ia: [], gu: [], gb: [] })
ok('CONTROL: a book none of them has yields no links at all', old.found.length === 0 && old.failed.length === 0)

console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0)

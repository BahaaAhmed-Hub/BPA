// node scripts/library-releases-agree.mjs   — needs a dev server on 5199
//
// Library 7e: the rules for "what is a new release" exist twice — the app's
// (followCheck.ts + bookLookup.ts) and the server's (_shared/releases.ts), because
// Deno cannot import the app's bundle. Both are run here over the same fixtures
// and any disagreement fails. The app's side is driven through its real fetch
// path (latestWorks, with fetch answered by the fixture), not through a restatement.
import { chromium } from 'playwright-core'

const DOCS = [
  { key: '/works/OL1W', title: 'Deep Work', author_name: ['Cal Newport'], first_publish_year: 2016, isbn: ['1455586692', '9781455586691'], cover_i: 11 },
  { key: '/works/OL2W', title: 'So Good They Can’t Ignore You', author_name: ['Cal Newport'], first_publish_year: 2012, isbn: ['9781455509126'] },
  { key: '/works/OL3W', title: 'Digital Minimalism', author_name: ['Cal Newport'], first_publish_year: 2019 },
  { key: '/works/OL3W', title: 'Digital Minimalism (duplicate listing)', author_name: ['Cal Newport'], first_publish_year: 2019 },
  { key: '/works/OL4W', title: 'A World Without Email!', author_name: ['Cal Newport'], first_publish_year: 2021, isbn: ['9780525536550'] },
  { key: '/works/OL5W', title: 'Slow Productivity', author_name: ['Cal  Newport'], first_publish_year: 2024, cover_i: 55 },
  { key: '/works/OL6W', title: 'Orphan With No Author', first_publish_year: 2000 },
  { title: 'No Key At All', author_name: ['Someone'] },
]
const SEEN = [
  [], ['/works/OL1W'], ['/works/OL1W', '/works/OL2W', '/works/OL3W', '/works/OL4W', '/works/OL5W', '/works/OL6W', 'no key at all'], ['/works/OLZZW'],
]
const SHELVES = [
  [],
  [{ title: 'deep work', authors: ['cal newport'] }],
  [{ title: 'Slow Productivity!', authors: ['Cal Newport'] }, { title: 'A world without email', authors: ['CAL NEWPORT'] }],
  [{ title: 'Something else entirely', authors: ['Cal Newport'], isbn: '9781455509126' }],
  [{ title: 'Orphan With No Author', authors: [] }],
  [{ title: 'Deep Work', authors: ['Someone Else'] }],
  [{ title: 'Digital Minimalism', authors: ['Cal Newport'] }],
  [{ title: 'Digital Minimalism (duplicate listing)', authors: ['Cal Newport'] }],
]

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctx = await b.newContext()
await ctx.route('**://placeholder.supabase.co/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
const p = await ctx.newPage()
await p.goto('http://localhost:5199/BPA/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(3000)

const res = await p.evaluate(async ([docs, seens, shelves]) => {
  const app = await import('/BPA/src/modules/library/followCheck.ts')
  const book = await import('/BPA/src/modules/library/bookLookup.ts')
  const srv = await import('/BPA/supabase/functions/_shared/releases.ts')
  const realFetch = window.fetch
  let url = ''
  window.fetch = async u => { url = String(u); return new Response(JSON.stringify({ docs }), { status: 200, headers: { 'content-type': 'application/json' } }) }
  const found = await app.releasesOf('author_key:OL1A', 40)
  const appUrl = url
  window.fetch = realFetch
  const parsed = srv.parseDocs({ docs })
  const out = { appUrl, srvUrl: srv.searchUrl('author_key:OL1A', 40), n: [found.length, parsed.length], cands: [], fresh: [], bad: srv.parseDocs(null).length + srv.parseDocs({ docs: 5 }).length + srv.parseDocs({}).length }
  out.cands = found.map((c, i) => ({ a: [c.title, c.authors.join('|'), c.isbn ?? '', c.publishedYear ?? '', c.coverUrl ?? '', app.workKey(c)], s: [parsed[i].title, parsed[i].authors.join('|'), parsed[i].isbn ?? '', parsed[i].year ?? '', parsed[i].coverUrl ?? '', srv.workKey(parsed[i])] }))
  for (const seen of seens) for (const shelf of shelves) {
    const a = app.newReleases({ seenKeys: seen }, found, shelf.map((x, i) => ({ id: String(i), ...x }))).map(app.workKey)
    const s = srv.freshReleases(seen, parsed, shelf).map(srv.workKey)
    out.fresh.push({ a, s })
  }
  return out
}, [DOCS, SEEN, SHELVES])

let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
ok('both sides ask for the same newest-first question', res.appUrl === res.srvUrl, res.appUrl + '\n   vs ' + res.srvUrl)
ok('both read the same number of works from one answer', res.n[0] === res.n[1] && res.n[0] === DOCS.length, res.n.join(' vs '))
const bad = res.cands.filter(c => JSON.stringify(c.a) !== JSON.stringify(c.s))
ok('every work is read the same way: title, authors, ISBN-13 preferred, year, cover, key', bad.length === 0, JSON.stringify(bad[0]))
const dis = res.fresh.map((f, i) => ({ f, i })).filter(({ f }) => JSON.stringify(f.a) !== JSON.stringify(f.s))
ok(`what is new agrees across ${res.fresh.length} seen × shelf combinations`, dis.length === 0, dis[0] ? JSON.stringify(dis[0]) : '')
// the control: the fixtures actually exercise the rules, so agreement means something
const lens = new Set(res.fresh.map(f => f.s.length))
ok('the fixtures are not vacuous: they produce different answers (some empty, some not)', lens.size >= 4 && res.fresh.some(f => f.s.length === 0) && res.fresh.some(f => f.s.length > 4), [...lens].sort().join(','))
const allNew = res.fresh[0].s
ok('with nothing seen and an empty shelf: each work once (the duplicate listing and the key-less work included)', allNew.length === 7 && new Set(allNew).size === 7, allNew.join(' | '))
ok('malformed answers give nothing, not a crash', res.bad === 0)
console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails ? 1 : 0)

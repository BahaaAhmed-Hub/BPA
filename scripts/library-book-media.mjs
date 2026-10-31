// node scripts/library-book-media.mjs — needs a dev server on 5199 (npx vite --port 5199 --strictPort).
//   CHROME=/path/to/chrome overrides the default /opt/pw-browsers/chromium.
// The Videos and Summary buttons in the book panel, measured in a browser against fakes that can REFUSE:
//   • the `library-videos` function: ok, not switched on, quota spent, down, an older cached answer — and an ok answer
//     that carries hostile ids and a hostile thumbnail URL, which must never reach the page;
//   • Claude: an outline, then sections (one cut off by max_tokens), a refused key, "I do not know this book";
//   • PostgREST for library_summaries, including "the migration has not run".
// Read off what was SENT (function bodies, Anthropic requests, upserts), not off the screen alone.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'

const now = new Date().toISOString()
const ID = '00000000-0000-4000-8000-0000000000d1'
const books = [{ id: ID, user_id: user.id, title: 'Dune', authors: ['Frank Herbert'], pages: 600, source: 'manual', status: 'reading', format: 'print', rating: 0, shelf_order: 0, added_at: now, updated_at: now, cover_url: null, description: 'A desert planet and the spice. BLURB-MARK' }]
let summaries = []
let marks = []            // library_video_marks, as the server holds them
const state = { vid: 'ok', ai: 'ok', delay: 0, missing: false, trunc: 0, failAt: 0, marksMissing: false, marksFail: false, moreFail: '' }
const fnBodies = [], aiCalls = [], saves = [], markSaves = [], markDeletes = []

// The function marks each video `strict` (its title names THIS book). Page 1: 17 strict + 2 loose. Page 2 (Search for more): 6 more strict.
const GOOD = [
  // The real function has already unescaped the title; markup in it must still be shown as text, never run.
  { id: 'dQw4w9WgXcQ', title: 'Dune & the <i>spice</i>', channel: 'Reads', publishedAt: '2024-05-01T10:00:00Z', strict: true },
  { id: 'aaaaaaaaaaa', title: 'Dune in 10 minutes', channel: 'Brief', publishedAt: '2023-01-01T00:00:00Z', strict: true },
  { id: 'bbbbbbbbbbb', title: 'Frank Herbert on Dune', channel: 'Talks', publishedAt: '2022-03-03T00:00:00Z', strict: true },
]
const mkVid = (prefix, n, strict) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${String(i).padStart(11 - prefix.length, '0')}`, title: strict ? `Dune explained ${prefix}${i}` : `Deep Work summary ${prefix}${i}`, channel: 'Chan', publishedAt: '2021-01-01T00:00:00Z', strict }))
const EXTRA = mkVid('e', 14, true)        // with GOOD: 17 strict
const LOOSE = mkVid('l', 2, false)        // titles that do not name the book
const PAGE2 = mkVid('p', 6, true)
const PAGE1 = [...GOOD, ...EXTRA, ...LOOSE]
const HOSTILE = [{ id: 'x"><img src=x>', title: 'evil one', channel: 'c' }, { id: 'short', title: 'evil two', channel: 'c' }]
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true })
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET, OPTIONS, DELETE' }
const json = (r, x, s = 200, h = {}) => r.fulfill({ status: s, contentType: 'application/json', headers: h, body: JSON.stringify(x) })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const until = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(60) } return false }

await ctx.route('**://placeholder.supabase.co/**', async r => {
  const q = r.request(), u = new URL(q.url()), m = q.method()
  if (u.pathname.startsWith('/functions/v1/library-videos')) {
    if (m === 'OPTIONS') return r.fulfill({ status: 204, headers: cors })
    const body = JSON.parse(q.postData() || '{}'); fnBodies.push(body)
    // The fake can refuse: a request with no title is a 400, as the real function answers.
    if (!body.title) return json(r, { error: 'a title is needed' }, 400, cors)
    if (body.more === true) {
      // The next page of the same search. Refuses when the caller says nothing about which search it is.
      if (!body.topic) return json(r, { error: 'which search?' }, 400, cors)
      if (state.moreFail) return json(r, { status: 'ok', items: PAGE1, canMore: true, cached: true, moreStatus: state.moreFail }, 200, cors)
      return json(r, { status: 'ok', items: [...PAGE1, ...PAGE2], canMore: false, cached: false }, 200, cors)
    }
    switch (state.vid) {
      case 'ok': return json(r, { status: 'ok', items: [...HOSTILE, ...PAGE1.map(g => ({ ...g, thumb: 'https://evil.example/t.jpg' }))], canMore: true, cached: false }, 200, cors)
      case 'stale': return json(r, { status: 'ok', items: GOOD, canMore: false, cached: true, stale: true }, 200, cors)
      case 'not_configured': case 'quota': case 'unreachable': return json(r, { status: state.vid, items: [] }, 200, cors)
      case 'down': return json(r, { error: 'boom' }, 500, cors)
    }
  }
  if (u.pathname === '/auth/v1/user') return json(r, user)
  if (u.pathname.startsWith('/auth/v1/token')) return json(r, { ...session })
  if (u.pathname.startsWith('/auth/v1')) return json(r, {})
  if (u.pathname.endsWith('/rpc/my_modules')) return json(r, [{ module_id: 'library', label: 'Library', enabled: true }])
  const t = u.pathname.split('/').pop()
  if (t === 'library_books') return m === 'GET' ? json(r, books) : json(r, [], 201)
  if (t === 'library_video_marks') {
    if (state.marksMissing) return json(r, { code: 'PGRST205', message: "Could not find the table 'public.library_video_marks'" }, 404)
    if (m === 'GET') return json(r, marks.filter(x => u.searchParams.get('book_id') === `eq.${x.book_id}`).sort((a, b) => b.created_at.localeCompare(a.created_at)))
    if (state.marksFail) return json(r, { code: '500', message: 'boom' }, 500)
    if (m === 'POST') {
      const body = JSON.parse(q.postData() || '{}'); const row = Array.isArray(body) ? body[0] : body
      // The table's own CHECKs: an 11-character id, and one of two marks.
      if (!/^[A-Za-z0-9_-]{11}$/.test(row.video_id || '') || !['favorite', 'hidden'].includes(row.mark)) return json(r, { code: '23514', message: 'check constraint' }, 400)
      markSaves.push(row)
      marks = [...marks.filter(x => !(x.book_id === row.book_id && x.video_id === row.video_id)), row]
      return json(r, [], 201)
    }
    if (m === 'DELETE') {
      const vid = (u.searchParams.get('video_id') || '').replace(/^eq\./, ''), bid = (u.searchParams.get('book_id') || '').replace(/^eq\./, '')
      markDeletes.push({ bid, vid }); marks = marks.filter(x => !(x.book_id === bid && x.video_id === vid)); return json(r, [])
    }
  }
  if (t === 'library_summaries') {
    if (state.missing) return json(r, { code: 'PGRST205', message: "Could not find the table 'public.library_summaries'" }, 404)
    if (m === 'GET') {
      const rows = summaries.filter(x => u.searchParams.get('book_id') === `eq.${x.book_id}`)
      if ((q.headers()['accept'] || '').includes('vnd.pgrst.object')) return rows[0] ? json(r, rows[0]) : json(r, { code: 'PGRST116', message: 'no rows' }, 406)
      return json(r, rows)
    }
    if (m === 'POST') {
      const row = JSON.parse(q.postData() || '{}'); saves.push(row)
      summaries = [...summaries.filter(x => x.book_id !== row.book_id), { ...row, created_at: now }]
      return json(r, [], 201)
    }
    if (m === 'DELETE') { summaries = []; return json(r, []) }
  }
  return json(r, [])
})
await ctx.route('https://i.ytimg.com/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }))

await ctx.route('https://api.anthropic.com/**', async r => {
  const q = r.request()
  if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors })
  const sent = JSON.parse(q.postData() || '{}')
  const user0 = String(sent.messages?.[0]?.content ?? '')
  const reply = (text, stop = 'end_turn') => json(r, { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', stop_reason: stop, stop_sequence: null, content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 10 } }, 200, cors)
  // Recorded when the request ARRIVES, then held: a request sent before Stop must still count as sent.
  const arrived = () => state.delay ? sleep(state.delay) : null
  if (String(sent.system).startsWith('You plan a written summary')) {
    aiCalls.push({ kind: 'outline', sent, user: user0 }); await arrived()
    if (state.ai === 'unknown') return reply('{"unknown": true}')
    if (state.ai === '401') return json(r, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401, cors)
    const n = Number(user0.match(/Plan exactly (\d+) sections/)?.[1] ?? 5)
    return reply(JSON.stringify({ premise: 'A saga of ecology, power and prophecy on a desert world.', sections: Array.from({ length: n }, (_, i) => ({ title: `Part ${i + 1} title`, focus: `What part ${i + 1} covers` })) }))
  }
  if (String(sent.system).startsWith('You write one section')) {
    const [, i, of] = user0.match(/section (\d+) of (\d+)/).map(Number)
    aiCalls.push({ kind: 'section', i, of, sent, user: user0 }); await arrived()
    if (state.failAt === i) return json(r, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401, cors)
    if (state.trunc === i) return reply(`Whole sentence in SEC-${i} stays and is long enough to pass the half rule here okay. Cut mid-sen`, 'max_tokens')
    return reply(`Sentence one of SEC-${i}. Second sentence here.\n\nSecond paragraph of SEC-${i}. Another one.`)
  }
  return json(r, {}, 200, cors)
})

await ctx.addInitScript(s => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('bpa-wizard-done', '1')   // the stub account is brand new; the setup guide would take the clicks
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'library', themeId: 'sunlit-bento' }, version: 0 }))
  localStorage.setItem('professor-ai-config', JSON.stringify({ provider: 'anthropic', anthropicKey: 'sk-ant-test-key' }))
} catch {} }, session)

const p = await ctx.newPage()
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }

const open = async () => { await p.getByRole('button', { name: /^Dune by/ }).click({ timeout: 25000 }); await p.getByRole('complementary').waitFor() }
await p.goto('http://localhost:5199/BPA/', { waitUntil: 'domcontentloaded' })
await open()
const panel = p.getByRole('complementary')
const dlg = p.getByRole('dialog')

/* ── the buttons ───────────────────────────────────────────────────────── */
const rect = async name => panel.getByRole('button', { name }).boundingBox()
const [bv, bs, bd] = [await rect('Videos about this book'), await rect('Summary of this book'), await rect('Delete this book')]
ok('both buttons exist in the panel header', !!bv && !!bs && !!bd)
ok('Videos, Summary, then Delete, left to right', bv && bs && bd && bv.x < bs.x && bs.x < bd.x)
ok('on one row (same top, within 2px)', bv && bd && Math.abs(bv.y - bd.y) <= 2 && Math.abs(bs.y - bd.y) <= 2)
ok('each is a touch-sized target (≥ 28px)', bv && bs && Math.min(bv.width, bv.height, bs.width, bs.height) >= 28, `${bv?.width}×${bv?.height}`)

/* ── videos: every way it can fail still leaves the link ───────────────── */
const fail = async (mode, re, label) => {
  state.vid = mode
  await panel.getByRole('button', { name: 'Videos about this book' }).click()
  await dlg.waitFor()
  ok(`${label}: says why`, await until(async () => re.test(await dlg.innerText())))
  ok(`${label}: no video cards`, await dlg.locator('ul img').count() === 0)
  const link = dlg.getByRole('link', { name: /Search on YouTube/ })
  const lh = await link.getAttribute('href')
  ok(`${label}: the plain YouTube search link is still there, and asks for the quoted title`, await link.count() === 1 && lh.includes('results?search_query=%22Dune%22%20Frank%20Herbert'), lh)
  await p.keyboard.press('Escape'); await dlg.waitFor({ state: 'detached' })
}
await fail('not_configured', /not switched on/, 'no key set')
await fail('quota', /have all been used/, 'quota spent')
await fail('down', /not available right now/, 'function down (500)')
ok('the three failures were asked once each, none cached', fnBodies.length === 3)
ok('every request carried the title, authors and topic', fnBodies.every(x => x.title === 'Dune' && x.authors?.[0] === 'Frank Herbert' && x.topic === 'review'))

state.vid = 'ok'
const openVideos = async () => { await panel.getByRole('button', { name: 'Videos about this book' }).click(); await dlg.waitFor() }
const closeDlg = async () => { await p.keyboard.press('Escape'); await dlg.waitFor({ state: 'detached' }) }
const cards = () => dlg.locator('ul[aria-label="Videos"] > li')
const card = id => dlg.locator(`li[data-video="${id}"]`)
const text = async () => await dlg.innerText()
await openVideos()
ok('cards appear', await until(async () => await cards().count() === 12))
const dbox = await dlg.boundingBox()
ok('the dialog fits inside the window (its height is in the app’s own viewport unit, not raw vh)', dbox && dbox.y >= 0 && dbox.y + dbox.height <= 1000 && dbox.height > 300, `${Math.round(dbox?.y)}…${Math.round(dbox?.y + dbox?.height)} of 1000`)
ok('the first page is 12 of the 17 that name the book; the two hostile ids are dropped', await cards().count() === 12 && !(await text()).includes('evil'))
ok('the count says so', (await dlg.locator('[data-count]').innerText()).includes('Showing 12 of 17'))
const srcs = await dlg.locator('ul img').evaluateAll(a => a.map(i => i.getAttribute('src')))
ok('thumbnails are derived from the id', srcs[0] === 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg', srcs[0])
ok('the response’s own thumbnail address is never used', srcs.every(s => !s.includes('evil.example')))
ok('and they really render (naturalWidth > 0)', await until(() => dlg.locator('ul img').first().evaluate(i => i.complete && i.naturalWidth > 0)))
const href = await dlg.locator('ul a').first().getAttribute('href')
ok('a card opens the video on YouTube', href === 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', href)
ok('in a new tab, without opener', (await dlg.locator('ul a').first().getAttribute('target')) === '_blank' && /noopener/.test(await dlg.locator('ul a').first().getAttribute('rel')))
ok('a title is shown as text: its ampersand and its tag characters, literally', (await text()).includes('Dune & the <i>spice</i>'))
ok('and the markup in it was not turned into an element', await dlg.locator('ul i').count() === 0)
ok('the search asks for the book by its quoted title’s own request (title, authors, topic, no "more")', fnBodies.at(-1).title === 'Dune' && fnBodies.at(-1).topic === 'review' && fnBodies.at(-1).more === undefined)

/* exact: videos that do not name this book are kept out, and one press away */
ok('the 2 looser matches are NOT in the list', !(await text()).includes('Deep Work summary'))
ok('and the person is told they exist', (await text()).includes('Show looser matches (2)'))

/* see more — free, what was already fetched */
const reqsBefore = fnBodies.length
await dlg.getByRole('button', { name: /^Show more/ }).click()
ok('Show more reveals the other 5', await until(async () => await cards().count() === 17))
ok('…without asking YouTube again', fnBodies.length === reqsBefore)
ok('…and the button goes when there is nothing left to reveal', await dlg.getByRole('button', { name: /^Show more/ }).count() === 0)

/* search for more — the next page of the same search */
const more = dlg.getByRole('button', { name: 'Search for more' })
ok('Search for more is offered (the function said another page exists)', await more.count() === 1)
await more.click()
ok('it asks for the next page of the same search', await until(async () => fnBodies.at(-1)?.more === true) && fnBodies.at(-1).title === 'Dune' && fnBodies.at(-1).topic === 'review')
ok('and the 6 new videos arrive (17 + 6 name the book)', await until(async () => (await dlg.locator('[data-count]').innerText()).includes('of 23')))
ok('they are shown straight away (a search for more is asked for in order to see them), the rest still there', await until(async () => await cards().count() === 23))
ok('with no further page, Search for more goes and the end is said', await dlg.getByRole('button', { name: 'Search for more' }).count() === 0 && (await text()).includes('everything YouTube returned'))

/* looser matches, on request, and labelled */
await dlg.getByRole('button', { name: /Show looser matches \(2\)/ }).click()
ok('Show looser matches adds the 2, and the count follows', await until(async () => (await dlg.locator('[data-count]').innerText()).includes('of 25')))
await until(async () => (await text()).includes('Deep Work summary l0'))
const looseLabels = await dlg.getByText(/Looser match —/).allInnerTexts()
ok('each is labelled as a looser match', (await text()).includes('Deep Work summary l0') && looseLabels.length === 2, `${looseLabels.length} labels; cards ${await cards().count()}`)
await dlg.getByRole('button', { name: /Hide looser matches/ }).click()
ok('and they can be put away again', await until(async () => !(await text()).includes('Deep Work summary')))

/* favourite */
await card('dQw4w9WgXcQ').locator('[data-act="favourite"]').click()
ok('the star shows it is on', await until(async () => (await card('dQw4w9WgXcQ').locator('[data-act="favourite"]').getAttribute('aria-pressed')) === 'true'))
ok('the server got one favourite row, for this book and this video, as the owner', await until(() => markSaves.length === 1) && markSaves[0].mark === 'favorite' && markSaves[0].video_id === 'dQw4w9WgXcQ' && markSaves[0].book_id === ID && markSaves[0].user_id === user.id)
ok('with the title kept (a later search may not return it)', markSaves[0].title === 'Dune & the <i>spice</i>' && markSaves[0].channel === 'Reads')
ok('the tab counts it', await dlg.getByRole('tab', { name: /Favourites \(1\)/ }).count() === 1)

/* remove, and bring back */
await card('aaaaaaaaaaa').locator('[data-act="remove"]').click()
ok('Remove takes the card off the list at once', await until(async () => await card('aaaaaaaaaaa').count() === 0))
ok('the server got a hidden mark for it', await until(() => markSaves.length === 2) && markSaves[1].mark === 'hidden' && markSaves[1].video_id === 'aaaaaaaaaaa')
ok('the list says how many are removed, and the count of what is left follows', (await dlg.locator('[data-count]').innerText()).includes('1 removed') && (await dlg.locator('[data-count]').innerText()).includes('of 22'))
await dlg.getByRole('tab', { name: /Removed \(1\)/ }).click()
ok('it waits under Removed, by name', await until(async () => await card('aaaaaaaaaaa').count() === 1) && (await card('aaaaaaaaaaa').innerText()).includes('Dune in 10 minutes'))
await card('aaaaaaaaaaa').locator('[data-act="restore"]').click()
ok('Bring back deletes the mark', await until(() => markDeletes.some(d => d.vid === 'aaaaaaaaaaa' && d.bid === ID)))
await dlg.getByRole('tab', { name: 'Results' }).click()
ok('and the video is in the results again', await until(async () => await card('aaaaaaaaaaa').count() === 1))

/* favourites live on their own, whatever YouTube says */
await dlg.getByRole('tab', { name: /Favourites/ }).click()
ok('Favourites lists it, from the saved title', await until(async () => await card('dQw4w9WgXcQ').count() === 1) && (await card('dQw4w9WgXcQ').innerText()).includes('Dune & the <i>spice</i>'))
await closeDlg()
ok('Escape closes the dialog and leaves the book panel open', await panel.count() === 1)
state.vid = 'down'
await p.reload({ waitUntil: 'domcontentloaded' }); await open()
await openVideos()
ok('with YouTube down, the results say so', await until(async () => /not available right now/.test(await text())))
await dlg.getByRole('tab', { name: /Favourites/ }).click()
ok('…and the favourite is still there after a reload (it was read from the server, not from the search)', await until(async () => await card('dQw4w9WgXcQ').count() === 1))
ok('…and it is still a favourite (the star is on)', (await card('dQw4w9WgXcQ').locator('[data-act="favourite"]').getAttribute('aria-pressed')) === 'true')
await card('dQw4w9WgXcQ').locator('[data-act="favourite"]').click()
const gone = await until(async () => await card('dQw4w9WgXcQ').count() === 0, 5000)
const deleted = await until(() => markDeletes.some(d => d.vid === 'dQw4w9WgXcQ'), 8000)   // the card goes at once; the request follows
ok('pressing the star in Favourites takes it off the list and deletes the mark', gone && deleted, `gone=${gone} deletes=${JSON.stringify(markDeletes.map(d => d.vid))} note=${JSON.stringify((await text()).match(/(could not be saved|put back)[^.]*/)?.[0] ?? '')}`)
await closeDlg()

/* a failing save is put back, and said */
state.vid = 'ok'; state.marksFail = true
await openVideos()
await until(async () => await cards().count() === 12)
const savesBefore = markSaves.length
await card('dQw4w9WgXcQ').locator('[data-act="favourite"]').click()
ok('a save the server refuses is put back (the star is off again)', await until(async () => (await text()).includes('could not be saved')) && (await card('dQw4w9WgXcQ').locator('[data-act="favourite"]').getAttribute('aria-pressed')) === 'false')
ok('and nothing was kept', markSaves.length === savesBefore)
await closeDlg()
state.marksFail = false

/* the migration has not run: videos still show, favourites say why */
state.marksMissing = true
await openVideos()
ok('without 20260047 the dialog names it', await until(async () => (await text()).includes('20260047_library_video_marks.sql')))
ok('the videos still show', await until(async () => await cards().count() === 12))
ok('and the star and the remove button are disabled', await card('dQw4w9WgXcQ').locator('[data-act="favourite"]').isDisabled() && await card('dQw4w9WgXcQ').locator('[data-act="remove"]').isDisabled())
await closeDlg()
state.marksMissing = false

/* a "more" that fails changes nothing and says why */
await p.reload({ waitUntil: 'domcontentloaded' }); await open()
state.moreFail = 'quota'
await openVideos()
await until(async () => await cards().count() === 12)
await dlg.getByRole('button', { name: 'Search for more' }).click()
ok('the quota being spent is said', await until(async () => (await text()).includes('have all been used')))
ok('the list is unchanged and Search for more is still offered', await cards().count() === 12 && await dlg.getByRole('button', { name: 'Search for more' }).count() === 1)
state.moreFail = ''

/* the author topic, and an older cached answer */
state.vid = 'stale'
await dlg.getByRole('tab', { name: /The author/ }).click()
ok('the author tab asks for the author topic', await until(async () => fnBodies.at(-1)?.topic === 'author'))
ok('an older cached answer is shown, and said to be older', await until(async () => (await text()).includes('earlier search')) && await cards().count() === 3)
await closeDlg()

/* ── summary: the whole path ───────────────────────────────────────────── */
const openSummary = async () => { await panel.getByRole('button', { name: 'Summary of this book' }).click(); await dlg.waitFor() }
state.ai = 'ok'; state.trunc = 2
await openSummary()
ok('nothing is spent by opening it', await until(async () => /how long/i.test(await dlg.innerText())) && aiCalls.length === 0)
ok('three lengths are offered', await dlg.getByRole('tab').count() === 3)
ok('Standard is the default, and the cost is stated up front', (await dlg.innerText()).includes('8 sections') && (await dlg.innerText()).includes('9 requests'))
await dlg.getByRole('tab', { name: /Short/ }).click()
ok('Short says 5 sections, 6 requests', (await dlg.innerText()).includes('5 sections') && (await dlg.innerText()).includes('6 requests'))
await dlg.getByRole('button', { name: 'Write the summary' }).click()
ok('it writes all 5 sections', await until(async () => await dlg.locator('article h3').count() === 5, 20000))
await until(() => saves.length >= 6)
ok('one outline call and five section calls, in order', aiCalls.length === 6 && aiCalls[0].kind === 'outline' && aiCalls.slice(1).every((c, k) => c.kind === 'section' && c.i === k + 1 && c.of === 5), aiCalls.map(c => c.i ?? 'o').join(','))
ok('the outline request carries the blurb', aiCalls[0].user.includes('BLURB-MARK'))
ok('section 3 is handed the whole outline and its place in it', aiCalls[3].user.includes('section 3 of 5') && aiCalls[3].user.includes('1. Part 1 title') && aiCalls[3].user.includes('5. Part 5 title'))
ok('each section’s token ceiling fits its 500 words (over 1.35 a word) without being open-ended (under 4 a word)', aiCalls.slice(1).every(c => c.sent.max_tokens > 500 * 1.35 && c.sent.max_tokens < 500 * 4), String(aiCalls[1].sent.max_tokens))
ok('each step was saved: 1 outline + 5 sections = 6 upserts', saves.length === 6, String(saves.length))
ok('the last upsert holds all 5 sections, length short', saves.at(-1).sections.length === 5 && saves.at(-1).length === 'short' && saves.at(-1).book_id === ID)
ok('and every upsert is the owner’s', saves.every(s => s.user_id === user.id))
const body = await dlg.locator('article').innerText()
ok('section 2 was cut by max_tokens, so it ends on its last whole sentence', body.includes('SEC-2 stays') && !body.includes('Cut mid-sen'))
ok('the notice says it is not from the text', body.includes('not from its text'))
ok('the premise is shown', body.includes('A saga of ecology'))
ok('a page count is shown once complete', /About \d+ pages/.test(body))

const [dl] = await Promise.all([p.waitForEvent('download'), dlg.getByRole('button', { name: /Download \.md/ }).click()])
const chunks = []; for await (const c of await dl.createReadStream()) chunks.push(c)
const md = Buffer.concat(chunks).toString()
ok('the download is named for the book, ASCII-safe', dl.suggestedFilename() === 'Dune - summary.md', dl.suggestedFilename())
ok('and is Markdown with the title and numbered sections', md.startsWith('# Dune — summary') && md.includes('## 5. Part 5 title'))

/* ── summary: it is kept, and replacing it asks first ──────────────────── */
await p.keyboard.press('Escape'); await dlg.waitFor({ state: 'detached' })
await p.reload({ waitUntil: 'domcontentloaded' }); await open()
const calls0 = aiCalls.length
await openSummary()
ok('after a reload the summary is read back from the server, not rewritten', await until(async () => await dlg.locator('article h3').count() === 5) && aiCalls.length === calls0)
await dlg.getByRole('button', { name: /Write again/ }).click()
ok('Write again asks, and says it replaces', (await dlg.innerText()).includes('replaces the summary'))
await dlg.getByRole('button', { name: 'Keep this one' }).click()
ok('Keep this one spends nothing and keeps the text', aiCalls.length === calls0 && await dlg.locator('article h3').count() === 5)
await p.keyboard.press('Escape'); await dlg.waitFor({ state: 'detached' })

/* ── summary: a failure partway keeps what was written ─────────────────── */
summaries = []; saves.length = 0; aiCalls.length = 0
state.trunc = 0; state.failAt = 3
await openSummary()
await dlg.getByRole('tab', { name: /Short/ }).click()
await dlg.getByRole('button', { name: 'Write the summary' }).click()
ok('a refused key says where to fix it', await until(async () => (await dlg.innerText()).includes('Settings → AI')))
ok('sections 1 and 2 are on screen and saved', await dlg.locator('article h3').count() === 2 && saves.at(-1)?.sections.length === 2, String(saves.at(-1)?.sections.length))
ok('the third section was attempted once and not retried', aiCalls.filter(c => c.i === 3).length === 1)
const keptText = saves.at(-1).sections[0].text
const cont = dlg.getByRole('button', { name: /Continue \(2 of 5 written\)/ })
ok('Continue is offered with the true count', await cont.count() === 1)
state.failAt = 0; aiCalls.length = 0
await cont.click()
ok('continuing finishes the other three', await until(async () => await dlg.locator('article h3').count() === 5, 20000))
ok('and asks only for sections 3, 4, 5 — never the outline again', aiCalls.length === 3 && aiCalls.every(c => c.kind === 'section') && aiCalls.map(c => c.i).join() === '3,4,5', aiCalls.map(c => c.i ?? 'o').join())
ok('the sections already written were not rewritten', saves.at(-1).sections[0].text === keptText)
await p.keyboard.press('Escape'); await dlg.waitFor({ state: 'detached' })

/* ── summary: Stop ─────────────────────────────────────────────────────── */
summaries = []; saves.length = 0; aiCalls.length = 0; state.delay = 500
await openSummary()
await dlg.getByRole('tab', { name: /Short/ }).click()
await dlg.getByRole('button', { name: 'Write the summary' }).click()
await until(() => saves.length >= 2)
await dlg.getByRole('button', { name: /Stop/ }).click()
ok('after Stop, Continue is offered', await until(async () => await dlg.getByRole('button', { name: /Continue/ }).count() === 1, 10000))
const stopped = aiCalls.length; await sleep(1500)
ok('and nothing more is asked once stopped', aiCalls.length === stopped, `${stopped} → ${aiCalls.length}`)
ok('what was written before Stop is saved', saves.at(-1).sections.length >= 1 && saves.at(-1).sections.length < 5, String(saves.at(-1).sections.length))
state.delay = 0
await p.keyboard.press('Escape'); await dlg.waitFor({ state: 'detached' })

/* ── summary: refusals leave nothing behind ────────────────────────────── */
summaries = []; saves.length = 0; aiCalls.length = 0; state.ai = 'unknown'
await openSummary()
await dlg.getByRole('button', { name: 'Write the summary' }).click()
ok('a book the AI does not know is said plainly', await until(async () => (await dlg.innerText()).includes('does not know this book')))
ok('no section was asked for, and nothing was stored', aiCalls.every(c => c.kind === 'outline') && saves.length === 0)
ok('and the person can try again', await dlg.getByRole('button', { name: 'Write the summary' }).count() === 1)
state.ai = 'ok'
await p.evaluate(() => localStorage.removeItem('professor-ai-config'))
aiCalls.length = 0
await dlg.getByRole('button', { name: 'Write the summary' }).click()
ok('no Anthropic key: names Settings → AI', await until(async () => (await dlg.innerText()).includes('Add an Anthropic key')))
ok('and sends nothing', aiCalls.length === 0 && saves.length === 0)
await p.keyboard.press('Escape'); await dlg.waitFor({ state: 'detached' })

/* ── summary: the migration has not run ────────────────────────────────── */
state.missing = true
await openSummary()
ok('without 20260046 the dialog names it', await until(async () => (await dlg.innerText()).includes('20260046_library_book_media.sql')))
ok('and offers no way to spend money on something that cannot be kept', await dlg.getByRole('button', { name: 'Write the summary' }).count() === 0)
await p.keyboard.press('Escape'); await dlg.waitFor({ state: 'detached' })
ok('the rest of the panel still works', await panel.getByRole('button', { name: 'Videos about this book' }).count() === 1)

await b.close()
console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)

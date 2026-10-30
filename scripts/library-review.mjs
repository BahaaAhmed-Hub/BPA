// node scripts/library-review.mjs   — needs a dev server on 5199 (restart it after editing src)
// (VITE_SUPABASE_URL=https://placeholder.supabase.co)
//
// Library 7b: spaced review of quotes. The scheduler is a TABLE of expected
// values (read off it, not re-derived), the cloze maker is asked what it must
// always preserve, and the sitting is driven end to end against a PostgREST fake
// that enforces the table's CHECKs and persists, so a reload sees what was answered.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'

const now = new Date().toISOString()
const iso = (d = 0) => { const x = new Date(); x.setHours(12); x.setDate(x.getDate() + d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }
const A = '00000000-0000-4000-8000-0000000000a1', B = '00000000-0000-4000-8000-0000000000b2'
const book = (id, title, authors) => ({ id, user_id: user.id, title, authors, pages: 300, source: 'manual', status: 'reading', format: 'print', rating: 0, shelf_order: 0, added_at: now, updated_at: now })
const BODIES = [
  'Habits are the compound interest of self-improvement',            // q01
  'Discipline equals freedom when practised every single morning',   // q02
  'Attention is the rarest and purest form of generosity',           // q03
  'What you cannot name you cannot master or measure',               // q04
  'Slow progress compounds into extraordinary results over decades', // q05
  'Clarity precedes success in almost every serious endeavour',      // q06
  'Simplicity is the ultimate sophistication of thoughtful design',  // q07
  'Courage grows by walking directly toward what frightens you',     // q08
  'Patience transforms ordinary effort into remarkable craftsmanship', // q09
  'Focus means saying no to a hundred good ideas today',             // q10
]
const qid = n => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`
const quote = (n, body, extra = {}) => ({ id: qid(n), user_id: user.id, book_id: n % 2 ? A : B, kind: body === null ? 'image' : 'text', body, image_path: body === null ? 'u/x.png' : null, page: n === 1 ? 12 : null, line: null, color: null, created_at: `2026-01-${String(n).padStart(2, '0')}T00:00:00Z`, updated_at: now, ...extra })
const review = (n, extra) => ({ quote_id: qid(n), user_id: user.id, due_on: iso(0), interval_days: 3, ease: 2.5, reps: 2, lapses: 0, first_on: iso(-10), last_on: iso(-3), ...extra })
const T = { library_books: [book(A, 'Alpha', ['Ann Author']), book(B, 'Bravo', [])], library_lists: [], library_list_books: [], library_quotes: [], library_notes: [], library_bookmarks: [], library_follows: [], library_sessions: [], library_plans: [], library_goals: [], library_quote_reviews: [] }
let missing = false, ops = [], refused = []

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const json = (r, x, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) })
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET, OPTIONS' }
async function open({ quotes, reviews }) {
  T.library_quotes = quotes; T.library_quote_reviews = reviews; ops = []; refused = []
  const ctx = await b.newContext({ viewport: { width: 1300, height: 1500 } })
  await ctx.route('**://placeholder.supabase.co/**', async r => {
    const q = r.request(); const u = new URL(q.url()); const m = q.method()
    if (u.pathname === '/auth/v1/user') return json(r, user)
    if (u.pathname.startsWith('/auth/v1/token')) return json(r, { ...session })
    if (u.pathname.startsWith('/auth/v1')) return json(r, {})
    if (u.pathname.endsWith('/rpc/my_modules')) return json(r, [{ module_id: 'library', label: 'Library', enabled: true }])
    const t = u.pathname.split('/').pop()
    if (!(t in T)) return json(r, [])
    if (t === 'library_quote_reviews' && missing) return json(r, { code: 'PGRST205', message: 'no table' }, 404)
    if (m === 'GET') return json(r, T[t])
    if (m === 'POST') {
      const rows = [].concat(JSON.parse(q.postData() || '[]'))
      if (t === 'library_quote_reviews') for (const row of rows) {
        const bad = !(row.ease >= 1.3 && row.ease <= 3) || !(row.interval_days >= 0 && row.interval_days <= 3650) || row.reps < 0 || row.lapses < 0 || !row.due_on || !row.first_on
        const orphan = !T.library_quotes.some(x => x.id === row.quote_id)
        if (bad || orphan) { refused.push(row); return json(r, { code: orphan ? '23503' : '23514', message: 'constraint' }, 400) }
        ops.push({ op: 'upsert', row })
        const i = T[t].findIndex(x => x.quote_id === row.quote_id); if (i >= 0) T[t][i] = row; else T[t].push(row)
        return json(r, [], 201)
      }
      for (const row of rows) { const i = T[t].findIndex(x => x.id === row.id); if (i >= 0) T[t][i] = { ...T[t][i], ...row }; else T[t].push(row) }
      return json(r, [], 201)
    }
    if (m === 'DELETE') {
      const qv = u.searchParams.get('quote_id')?.replace(/^eq\./, '')
      if (t === 'library_quote_reviews' && qv) { ops.push({ op: 'delete', quote_id: qv }); T[t] = T[t].filter(x => x.quote_id !== qv) }
      const id = u.searchParams.get('id')?.replace(/^eq\./, '')
      if (id) { T[t] = T[t].filter(x => x.id !== id); if (t === 'library_quotes') T.library_quote_reviews = T.library_quote_reviews.filter(x => x.quote_id !== id) }
      return json(r, [])
    }
    return json(r, [])
  })
  await ctx.route('https://api.anthropic.com/**', r => r.request().method() === 'OPTIONS' ? r.fulfill({ status: 204, headers: cors }) : json(r, { id: 'm', type: 'message', role: 'assistant', model: 'x', stop_reason: 'end_turn', stop_sequence: null, content: [{ type: 'text', text: '{}' }], usage: { input_tokens: 1, output_tokens: 1 } }))
  await ctx.route('https://covers.openlibrary.org/**', r => r.fulfill({ status: 404, body: '' }))
  await ctx.addInitScript(s => { try {
    localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
    localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'library', themeId: 'sunlit-bento' }, version: 0 }))
    localStorage.setItem('library-view', 'quotes'); localStorage.setItem('library-quote-mode', 'review')
  } catch {} }, session)
  const p = await ctx.newPage()
  p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
  await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(4500)
  return { p, ctx }
}
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }

const ALL = BODIES.map((body, i) => quote(i + 1, body)).concat([quote(11, null)])
let { p, ctx } = await open({ quotes: ALL, reviews: [] })
const wait = ms => p.waitForTimeout(ms)

// ── the scheduler, read off a table ─────────────────────────────────────────
const u = await p.evaluate(async () => {
  const s = await import('/src/modules/library/srs.ts')
  const c = await import('/src/modules/library/cloze.ts')
  const row = (st, g) => { const n = s.next(st, g); return [n.intervalDays, Math.round(n.ease * 100) / 100, n.reps, n.lapses] }
  const chain = (grades, st = null) => { const out = []; for (const g of grades) { st = s.next(st, g); out.push(st.intervalDays) } return out }
  const known = { intervalDays: 10, ease: 2.0, reps: 4, lapses: 1 }
  const T0 = '2026-10-13'
  const Q = (id, body, createdAt) => ({ id, body, createdAt, bookId: 'b', kind: 'text' })
  const R = (id, due, first = '2026-10-01') => ({ quoteId: id, dueOn: due, intervalDays: 3, ease: 2.5, reps: 2, lapses: 0, firstOn: first, lastOn: '2026-10-10' })
  const qs = [Q('a', 'one', '1'), Q('b', 'two', '2'), Q('c', 'three', '3'), Q('d', 'four', '4'), Q('e', 'five', '5'), Q('f', 'six', '6'), Q('g', 'seven', '7'), Q('h', 'eight', '8'), Q('i', null, '9'), Q('j', '  ', '10')]
  const q1 = s.buildQueue(qs, [R('a', '2026-10-12'), R('b', '2026-10-13'), R('c', '2026-10-14'), R('d', '2026-10-01'), R('zzz', '2026-10-01')], T0)
  const q2 = s.buildQueue(qs, [R('a', '2026-10-20', T0), R('b', '2026-10-20', T0), R('c', '2026-10-20', T0)], T0)
  const q3 = s.buildQueue(qs, [R('a', '2026-10-20', T0), R('b', '2026-10-20', T0), R('c', '2026-10-20', T0), R('d', '2026-10-20', T0), R('zzz', '2026-10-20', T0)], T0)
  const many = Array.from({ length: 30 }, (_, i) => Q('m' + String(i).padStart(2, '0'), 'word', String(i).padStart(2, '0')))
  const q4 = s.buildQueue(many, many.map((m, i) => R(m.id, i % 2 ? '2026-10-01' : '2026-10-13')), T0)
  const sched = s.schedule('x', R('x', '2026-10-13', '2026-09-01'), 'good', '2026-10-13')
  const words = n => Array.from({ length: n }, (_, i) => 'sample' + 'abcdefghijklmnopqrstuvwxyz'[i % 26] + 'xyz').join(' ')
  const joined = ps => ps.map(p => p.text).join('')
  const seeds = Array.from({ length: 24 }, (_, i) => c.makeCloze('Habits are the compound interest of self-improvement and discipline', 's' + i).filter(p => p.blank).map(p => p.text).join('|'))
  const long = 'Whoever fights monsters should see to it that in the process he does not become a monster, and when you look long into an abyss the abyss looks into you'
  return {
    t: { newAgain: row(null, 'again'), newHard: row(null, 'hard'), newGood: row(null, 'good'), newEasy: row(null, 'easy'), kAgain: row(known, 'again'), kHard: row(known, 'hard'), kGood: row(known, 'good'), kEasy: row(known, 'easy') },
    good3: chain(['good', 'good', 'good', 'good']), easy3: chain(['easy', 'easy', 'easy']), lapse: chain(['good', 'good', 'good', 'again', 'good', 'good']),
    floor: (() => { let st = null; for (let i = 0; i < 20; i++) st = s.next(st, 'again'); return st.ease })(),
    ceil: (() => { let st = null; for (let i = 0; i < 20; i++) st = s.next(st, 'easy'); return st.ease })(),
    cap: (() => { let st = { intervalDays: 300, ease: 3, reps: 9, lapses: 0 }; return [s.next(st, 'good').intervalDays, s.next(st, 'easy').intervalDays, s.next(st, 'hard').intervalDays] })(),
    lapsesNew: s.next({ intervalDays: 1, ease: 2.5, reps: 0, lapses: 0 }, 'again').lapses,
    sched,
    labels: [1, 2, 29, 30, 60, 364, 365, 1000, 0].map(s.intervalLabel), previewsNew: s.previews(null),
    q1: { due: q1.due.map(x => x.id), fresh: q1.fresh.map(x => x.id), session: q1.session.map(x => x.id), next: q1.nextDue, waiting: q1.waiting },
    q2: { fresh: q2.fresh.map(x => x.id), waiting: q2.waiting }, q3: { fresh: q3.fresh.map(x => x.id) }, q4: { session: q4.session.length, waiting: q4.waiting, first: q4.session.slice(0, 3).map(x => x.id) },
    cl: {
      det: JSON.stringify(c.makeCloze(long, 'k')) === JSON.stringify(c.makeCloze(long, 'k')), distinct: new Set(seeds).size,
      rejoin: [long, 'Don’t stop — ever.', 'self-discipline wins', '  leading and trailing  ', 'الكتب هي أصدقاؤنا الحقيقيون في الحياة', 'a\nb\n\nc'].every(t => joined(c.makeCloze(t, 'x')) === t),
      counts: [words(5), words(15), words(30)].map(t => c.makeCloze(t, 's').filter(p => p.blank).length), few: c.makeCloze('it is a go to be', 's').filter(p => p.blank).map(p => p.text),
      stop: Array.from({ length: 30 }, (_, i) => c.blanksOf(c.makeCloze('would should about whether discipline compounds slowly', 'z' + i))).flat().some(w => ['would', 'should', 'about', 'whether'].includes(w)),
      none: c.makeCloze('!!! ???', 's'), hyphen: c.blanksOf(c.makeCloze('self-discipline', 's')), arabic: c.blanksOf(c.makeCloze('الكتب هي أصدقاؤنا الحقيقيون في الحياة', 's')),
    },
  }
})
ok('first answers on a new quote: again 1d, hard 1d, good 1d, easy 4d — and ease moves by -0.2 / -0.15 / 0 / +0.15', JSON.stringify(u.t.newAgain) === '[1,2.3,0,0]' && JSON.stringify(u.t.newHard) === '[1,2.35,1,0]' && JSON.stringify(u.t.newGood) === '[1,2.5,1,0]' && JSON.stringify(u.t.newEasy) === '[4,2.65,1,0]', JSON.stringify(u.t))
ok('a known quote (10 days, ease 2.0, 4 right): again → 1d and a lapse; hard ×1.2; good ×ease; easy ×ease×1.3', JSON.stringify(u.t.kAgain) === '[1,1.8,0,2]' && JSON.stringify(u.t.kHard) === '[12,1.85,5,1]' && JSON.stringify(u.t.kGood) === '[20,2,5,1]' && JSON.stringify(u.t.kEasy) === '[26,2.15,5,1]', JSON.stringify([u.t.kAgain, u.t.kHard, u.t.kGood, u.t.kEasy]))
ok('good, good, good, good walks 1 → 3 → 8 → 20 days', u.good3.join() === '1,3,8,20', u.good3.join())
ok('easy, easy, easy is 4 → 7 → longer', u.easy3[0] === 4 && u.easy3[1] === 7 && u.easy3[2] > 7 + 1, u.easy3.join())
ok('a lapse starts the climb again from one day', u.lapse.slice(3).join() === '1,1,3', u.lapse.join())
ok('a NEW quote answered "again" has not lapsed — only a known one can', u.lapsesNew === 0 && u.t.newAgain[3] === 0 && u.t.kAgain[3] === 2)
ok('ease never falls below 1.3 or climbs above 3.0', Math.abs(u.floor - 1.3) < 1e-9 && Math.abs(u.ceil - 3) < 1e-9, `${u.floor} ${u.ceil}`)
ok('a gap never exceeds a year', u.cap.every(d => d <= 365) && u.cap[0] === 365, u.cap.join())
ok('scheduling sets the due day from today, keeps the first day, stamps the last', u.sched.dueOn === '2026-10-21' && u.sched.firstOn === '2026-09-01' && u.sched.lastOn === '2026-10-13' && u.sched.intervalDays === 8, JSON.stringify(u.sched))
ok('labels: 1 day, 2 days, 29 days, 1 mo, 2 mo, 12 mo, 1 y', u.labels.join('|') === '1 day|2 days|29 days|1 mo|2 mo|12 mo|1 y|1 y|1 day', u.labels.join('|'))
ok('buttons on a new quote promise 1 day / 1 day / 1 day / 4 days', JSON.stringify(u.previewsNew) === '{"again":"1 day","hard":"1 day","good":"1 day","easy":"4 days"}')
ok('due: today or earlier, most overdue first; a future one and an orphan review are not', u.q1.due.join() === 'd,a,b', u.q1.due.join())
ok('new: never reviewed, with words, oldest first (blank and photo-only quotes excluded)', u.q1.fresh.join() === 'e,f,g,h' && u.q1.waiting === 7, u.q1.fresh.join())
ok('the sitting is due then new; the next date is the earliest in the future', u.q1.session.join() === 'd,a,b,e,f,g,h' && u.q1.next === '2026-10-14')
ok('"new today" counts what was first reviewed today: three already taken leaves room for two', u.q2.fresh.join() === 'd,e' && u.q2.waiting === 2, u.q2.fresh.join())
ok('and a review whose quote is gone does not use up the room (4 real + 1 orphan today leaves room for one)', u.q3.fresh.join() === 'e', u.q3.fresh.join())
ok('a sitting is capped at 20; the tab counts everything waiting', u.q4.session === 20 && u.q4.waiting === 30 && u.q4.first.join() === 'm01,m03,m05', JSON.stringify(u.q4))
ok('cloze: deterministic for a seed, and different seeds blank different words', u.cl.det && u.cl.distinct >= 4, String(u.cl.distinct))
ok('cloze: the pieces always rejoin to exactly the original (punctuation, dashes, newlines, Arabic)', u.cl.rejoin)
ok('cloze: 1 blank in a short line, 2 in a sentence, 3 in a paragraph', u.cl.counts.join() === '1,2,3', u.cl.counts.join())
ok('cloze: a line of short words still hides something — its last word', u.cl.few.join() === 'be', u.cl.few.join())
ok('cloze: connective words are not chosen when a better one exists', !u.cl.stop)
ok('cloze: no words is no blanks; a hyphenated word is one word; Arabic is blanked too', u.cl.none.length === 1 && !u.cl.none[0].blank && u.cl.hyphen.join() === 'self-discipline' && u.cl.arabic.length >= 1)
await ctx.close()

// ── the sitting ─────────────────────────────────────────────────────────────
// q01 overdue by a day, q03 due today, q02 not due until tomorrow; q04–q10 are new; q11 is a photo.
const seeded = [review(1, { due_on: iso(-1) }), review(3, { due_on: iso(0) }), review(2, { due_on: iso(1) })]
;({ p, ctx } = await open({ quotes: ALL, reviews: JSON.parse(JSON.stringify(seeded)) }))
const board = () => p.locator('body').innerText()
const hidden = () => p.getByRole('img', { name: 'hidden word' })
const rowOf = n => T.library_quote_reviews.find(r => r.quote_id === qid(n))
ok('the Review tab carries what is waiting: 2 due + 5 new (of 7 unseen, five a day)', await p.getByRole('tab', { name: 'Review (7)' }).count() === 1)
ok('the idle screen says what and how many, and has asked the server for no writes', /7 quotes to review/.test(await board()) && /2 due · 5 new/.test(await board()) && ops.length === 0)
await p.getByRole('button', { name: /^Start/ }).click(); await wait(300)
ok('the first card is the most overdue (q01), with its book, author and page', /Alpha · Ann Author · p\. 12/.test(await board()) && /1 of 7\b/.test(await board()))
const front = await p.getByRole('blockquote').or(p.locator('blockquote')).first().innerText()
const nBlank = await hidden().count()
ok('words are hidden, and the front does not give them away', nBlank >= 1 && nBlank <= 2)
await p.keyboard.press('3'); await wait(200)
ok('digits do nothing until the words are shown', ops.length === 0)
await p.keyboard.press('Space'); await wait(200)
const marks = await p.locator('blockquote mark').allInnerTexts()
ok('Space shows the words: exactly the hidden ones are marked, and the sentence is whole', marks.length === nBlank && BODIES[0].includes(marks[0]) && (await p.locator('blockquote').innerText()) === BODIES[0], JSON.stringify(marks))
const btn = n => p.getByRole('group', { name: 'How did it go?' }).getByRole('button', { name: new RegExp(`^${n}`) })
ok('each answer promises its gap — known quote, 3 days at 2.5: 1 day / 4 days / 8 days / 10 days', /see it again in 1 day/.test(await btn('Forgot').getAttribute('aria-label')) && /in 4 days/.test(await btn('Hard').getAttribute('aria-label')) && /in 8 days/.test(await btn('Good').getAttribute('aria-label')) && /in 10 days/.test(await btn('Easy').getAttribute('aria-label')))
await p.keyboard.press('3'); await wait(900)
const r1 = rowOf(1)
ok('3 answers Good: one upsert, interval 8, reps 3, due in 8 days, first day kept', ops.length === 1 && r1.interval_days === 8 && r1.reps === 3 && r1.due_on === iso(8) && r1.first_on === iso(-10) && r1.last_on === iso(0), JSON.stringify(r1))
ok('the next card is q03 (due today) and the bar moved', /2 of /.test(await board()))
await p.keyboard.press('Space'); await btn('Forgot').click(); await wait(900)
const r3 = rowOf(3)
ok('Forgot: back tomorrow, ease down, reps reset, one lapse', r3.interval_days === 1 && r3.due_on === iso(1) && r3.reps === 0 && r3.lapses === 1 && Math.abs(r3.ease - 2.3) < 1e-9, JSON.stringify(r3))
ok('a forgotten card is asked once more this sitting — the count grew by one', /of 8/.test(await board()), (await board()).match(/\d+ of \d+/)?.[0])
// the five new ones
for (let i = 0; i < 5; i++) { await p.keyboard.press('Space'); await p.keyboard.press('3'); await wait(500) }
const newRows = [4, 5, 6, 7, 8].map(rowOf)
ok('five new quotes got their first review today: interval 1, first_on today, ease 2.5', newRows.every(r => r && r.interval_days === 1 && r.first_on === iso(0) && r.reps === 1 && Math.abs(r.ease - 2.5) < 1e-9), JSON.stringify(newRows.map(r => r?.first_on)))
ok('quotes 9 and 10 stayed new: five a day', !rowOf(9) && !rowOf(10))
// the repeat of q03
ok('the forgotten card comes round again at the end', /8 of 8/.test(await board()))
await p.keyboard.press('Space'); await p.keyboard.press('3'); await wait(800)
const r3b = rowOf(3)
ok('and Good on the repeat brings it to a day, with the lapse remembered', r3b.interval_days === 1 && r3b.reps === 1 && r3b.lapses === 1 && Math.abs(r3b.ease - 2.3) < 1e-9, JSON.stringify(r3b))
const summary = await board()
ok('the sitting ends with a count: 8 answered, 1 forgotten', /Reviewed 8 cards/.test(summary) && /1 forgotten/.test(summary) && /7 remembered/.test(summary), summary.match(/Reviewed[^\n]*\n[^\n]*/)?.[0])
ok('no more waiting today, so it says when the next one is — and the tab shows no count', /Next review/.test(summary) && await p.getByRole('tab', { name: 'Review', exact: true }).count() === 1)
ok('the server never refused a row', refused.length === 0, JSON.stringify(refused))
await p.getByRole('button', { name: 'Done' }).click(); await wait(300)
ok('Done goes back to the idle screen: nothing today (2 are still new, but five a day is five a day)', /Nothing to review today/.test(await board()))
await p.reload({ waitUntil: 'domcontentloaded' }); await wait(4500)
ok('and that survives a reload — the limit is counted from the rows, not from memory', /Nothing to review today/.test(await board()) && await p.getByRole('tab', { name: 'Review', exact: true }).count() === 1)
await ctx.close()

// ── undo ────────────────────────────────────────────────────────────────────
;({ p, ctx } = await open({ quotes: ALL, reviews: JSON.parse(JSON.stringify(seeded)) }))
const before = JSON.stringify(rowOf(1))
await p.getByRole('button', { name: /^Start/ }).click(); await wait(300)
await p.keyboard.press('Space'); await p.keyboard.press('4'); await wait(800)
ok('an answer is written', rowOf(1).interval_days === 10)
await p.keyboard.press('Control+z'); await wait(1000)
ok('⌘Z takes it back to exactly what it was', JSON.stringify(rowOf(1)) === before, JSON.stringify(rowOf(1)))
// a new quote answered, then undone, is no row at all
await ctx.close()
;({ p, ctx } = await open({ quotes: ALL, reviews: [] }))
await p.getByRole('button', { name: /^Start/ }).click(); await wait(300)
await p.keyboard.press('Space'); await p.keyboard.press('3'); await wait(800)
ok('a first answer creates a row', T.library_quote_reviews.length === 1)
await p.keyboard.press('Control+z'); await wait(1000)
ok('and undoing it removes the row — a new quote is new again', T.library_quote_reviews.length === 0 && ops.some(o => o.op === 'delete'))
await ctx.close()

// ── the cap, and a quote that disappears ────────────────────────────────────
const lots = Array.from({ length: 25 }, (_, i) => quote(i + 1, `Persistence number ${i + 1} outlasts talent whenever talent grows complacent`))
;({ p, ctx } = await open({ quotes: lots, reviews: lots.map((q, i) => review(i + 1, { due_on: iso(-1 - (i % 3)) })) }))
ok('25 due: the tab says 25, the sitting is 20 at a time', await p.getByRole('tab', { name: 'Review (25)' }).count() === 1 && /20 at a time/.test(await board()))
await p.getByRole('button', { name: /^Start/ }).click(); await wait(300)
ok('the sitting is 20 cards', /1 of 20/.test(await board()))
// delete the quote on screen from "another device"
const gone = await p.evaluate(async () => {
  const st = (await import('/src/modules/library/libraryStore.ts')).useLibraryStore
  const shown = document.querySelector('blockquote')?.textContent ?? ''
  const q = st.getState().quotes.find(x => shown.replace(/\s+/g, ' ').trim().length && x.body && x.body.split(' ').slice(0, 2).join(' ') === shown.split(' ').slice(0, 2).join(' '))
  const id = q?.id ?? st.getState().quotes[0].id
  st.getState().deleteQuote(id)
  return { id, reviews: st.getState().reviews.length }
})
await wait(600)
ok('deleting a quote takes its review (the server cascades it) and the sitting does not show a blank card', gone.reviews === 24 && !(await board()).includes('undefined') && await p.locator('blockquote').count() <= 1)
for (let i = 0; i < 25; i++) { if (await p.getByText(/^Reviewed \d+ cards?$/).count()) break; await p.keyboard.press('Space'); await p.keyboard.press('3'); await wait(150) }
await wait(500)
ok('the sitting ends after the cap, and says how many more are waiting', /Reviewed 19 cards/.test(await board()) && /5 more are waiting/.test(await board()) && await p.getByRole('button', { name: 'Review 5 more' }).count() === 1, (await board()).match(/Reviewed[^\n]*\n[^\n]*/)?.[0])
await ctx.close()

// ── migration not run ───────────────────────────────────────────────────────
missing = true
;({ p, ctx } = await open({ quotes: ALL, reviews: [] }))
ok('without 20260034 the review screen names the migration', /20260034_library_quote_reviews/.test(await board()))
await p.getByRole('tab', { name: 'Cards' }).click(); await wait(500)
ok('and the quotes themselves are untouched', (await p.locator('body').innerText()).includes('Habits are the compound interest'))
await ctx.close()

console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails ? 1 : 0)

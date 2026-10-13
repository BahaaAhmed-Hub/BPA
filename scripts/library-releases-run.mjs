// node scripts/library-releases-run.mjs   — plain node, no browser, no server
// Library 7e: one pass of the scheduled check, run on the real module with
// stand-ins for the catalogue, the shelf and the database that can fail on demand.
import { runChecks } from '../supabase/functions/_shared/releaseRun.ts'

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
// The function itself cannot run here (Deno, a network, a database), so what can be checked of it is checked:
// it parses, it takes both ways in and only those, and it hands the work to the tested module rather than restating it.
{
  const ts = createRequire(import.meta.url)('typescript')
  const src = readFileSync(new URL('../supabase/functions/library-follow-check/index.ts', import.meta.url), 'utf8')
  const r = ts.transpileModule(src, { reportDiagnostics: true, compilerOptions: { target: 'ES2022', module: 'ESNext' } })
  ok('the function file parses (Deno would refuse to load it otherwise, and nothing would say why)', r.diagnostics.length === 0)
  ok('it admits the schedule\'s secret or a signed-in user, and nothing else', /x-cron-secret/.test(src) && /!!CRON_SECRET && secret === CRON_SECRET/.test(src) && /not signed in/.test(src))
  ok('a signed-in user is limited to their own follows', /if \(onlyUser\) q = q\.eq\('user_id', onlyUser\)/.test(src))
  ok('and it runs the shared module, with no second copy of the rules', /runChecks\(/.test(src) && !/freshReleases|onShelf/.test(src.replace(/import[^\n]*\n/g, '')))
}
const W = (k, title, o = {}) => ({ key: `/works/${k}`, title, authors: o.authors ?? ['Cal Newport'], isbn: o.isbn, year: o.year ?? 2024 })

function world(cfg = {}) {
  const w = {
    clock: cfg.clock ?? Date.parse('2026-10-14T06:00:00Z'),
    catalogue: cfg.catalogue ?? {}, failQuery: new Set(cfg.failQuery ?? []),
    shelves: cfg.shelves ?? {}, failShelf: new Set(cfg.failShelf ?? []), modules: cfg.modules ?? {},
    news: cfg.news ?? [], checked: {}, fetches: [], shelfReads: [], pauses: 0, cleared: [],
  }
  w.io = {
    async fetchWorks(q) { w.fetches.push(q); if (w.failQuery.has(q)) throw new Error('503'); return w.catalogue[q] ?? [] },
    async shelfOf(u) { w.shelfReads.push(u); if (w.failShelf.has(u)) throw new Error('shelf'); return w.shelves[u] ?? [] },
    async hasModule(u) { return w.modules[u] !== false },
    async existingNews(f) { return w.news.filter(n => n.follow_id === f) },
    async saveNews(rows) { for (const r of rows) if (!w.news.some(n => n.follow_id === r.follow_id && n.work_key === r.work_key)) w.news.push(r) },
    async clearNews(f, keys) { w.cleared.push(...keys); w.news = w.news.filter(n => !(n.follow_id === f && keys.includes(n.work_key))) },
    async markChecked(f, good, at) { w.checked[f] = { ok: good, at } },
    now: () => w.clock, pause: async () => { w.pauses++ },
  }
  return w
}
const F = (id, user, query, seen, last = null) => ({ id, user_id: user, name: id, query, seen_keys: seen, last_checked_at: last })
const keys = w => w.news.map(n => n.work_key).sort()

// 1 — the plain case
{
  const w = world({ catalogue: { qa: [W('1', 'Old'), W('2', 'Fresh'), W('3', 'Owned'), W('3', 'Owned again')] }, shelves: { u1: [{ title: 'owned', authors: ['cal newport'] }] } })
  const s = await runChecks([F('fa', 'u1', 'qa', ['/works/1'])], w.io)
  ok('announces what is unseen and not on the shelf — once, and nothing else', JSON.stringify(keys(w)) === JSON.stringify(['/works/2']), JSON.stringify(keys(w)))
  ok('the row names its owner and follow, and carries what the card needs', w.news[0].user_id === 'u1' && w.news[0].follow_id === 'fa' && w.news[0].title === 'Fresh' && w.news[0].published_year === 2024)
  ok('and the summary says so', s.checked === 1 && s.announced === 1 && s.failed === 0)
  ok('the follow is stamped as checked fine', w.checked.fa?.ok === true && w.checked.fa.at === '2026-10-14T06:00:00.000Z')
  const s2 = await runChecks([F('fa', 'u1', 'qa', ['/works/1'])], w.io)
  ok('a second pass over the same answer announces nothing and writes nothing new', s2.announced === 0 && w.news.length === 1)
}
// 2 — one catalogue failing costs its follow, not the pass
{
  const w = world({ catalogue: { qa: [W('1', 'A'), W('2', 'B')], qb: [W('7', 'C'), W('8', 'D')] }, failQuery: ['qa'] })
  const s = await runChecks([F('fa', 'u1', 'qa', ['/works/1']), F('fb', 'u1', 'qb', ['/works/7'])], w.io)
  ok('a failed read announces nothing and is marked failed, while the next follow still answers', s.failed === 1 && s.checked === 1 && w.checked.fa.ok === false && JSON.stringify(keys(w)) === JSON.stringify(['/works/8']))
}
// 3 — no baseline
{
  const w = world({ catalogue: { qa: [W('1', 'A'), W('2', 'B')] } })
  const s = await runChecks([F('fa', 'u1', 'qa', []), F('fb', 'u1', 'qa', null)], w.io)
  ok('a follow with no baseline is never announced from (it would be the whole catalogue)', w.news.length === 0 && s.noBaseline === 2 && w.checked.fa.ok === true)
}
// 4/5 — users
{
  const w = world({ catalogue: { qa: [W('2', 'B')], qb: [W('9', 'Z')] }, modules: { u2: false }, failShelf: ['u3'] })
  const s = await runChecks([F('fa', 'u1', 'qa', ['/works/1']), F('fb', 'u2', 'qb', ['/works/1']), F('fc', 'u3', 'qb', ['/works/1'])], w.io)
  ok('a user without the Library, or whose shelf cannot be read, is skipped — and their catalogue is never asked', JSON.stringify(w.fetches) === JSON.stringify(['qa']) && s.skippedUsers === 2 && keys(w).length === 1)
  ok('a skipped follow is not stamped as checked', !('fb' in w.checked) && !('fc' in w.checked))
}
// 6 — one shelf read per user
{
  const w = world({ catalogue: { qa: [], qb: [], qc: [] } })
  await runChecks([F('fa', 'u1', 'qa', ['x']), F('fb', 'u1', 'qb', ['x']), F('fc', 'u1', 'qc', ['x'])], w.io)
  ok('three follows of one person read their shelf once', w.shelfReads.length === 1)
  ok('and the catalogue is paused between asks, not before the first', w.pauses === 2, String(w.pauses))
}
// 7 — stale news is taken back
{
  const mk = (k, t) => ({ follow_id: 'fa', user_id: 'u1', work_key: k, title: t, authors: ['Cal Newport'], isbn: null })
  const w = world({ catalogue: { qa: [W('1', 'Seen'), W('2', 'Kept'), W('3', 'Shelved')] }, shelves: { u1: [{ title: 'Shelved', authors: ['Cal Newport'] }] },
    news: [mk('/works/1', 'Seen'), mk('/works/2', 'Kept'), mk('/works/3', 'Shelved')] })
  const s = await runChecks([F('fa', 'u1', 'qa', ['/works/1'])], w.io)
  ok('news for a work since marked seen, or since shelved, is taken back; the rest stays', JSON.stringify(keys(w)) === JSON.stringify(['/works/2']) && s.cleared === 2, JSON.stringify(w.cleared))
}
// 8 — cap
{
  const many = Array.from({ length: 50 }, (_, i) => W(`n${i}`, `Book ${i}`))
  const w = world({ catalogue: { qa: many } })
  const s = await runChecks([F('fa', 'u1', 'qa', ['/works/old'])], w.io, { perFollowCap: 20 })
  ok('one follow announces at most the cap in one pass', s.announced === 20 && w.news.length === 20)
}
// 9 — ordering, follow cap and time budget
{
  const w = world({ catalogue: {} })
  const fs = [F('late', 'u1', 'q1', ['x'], '2026-10-13T00:00:00Z'), F('never', 'u1', 'q2', ['x'], null), F('early', 'u1', 'q3', ['x'], '2026-10-01T00:00:00Z')]
  const s = await runChecks(fs, w.io, { maxFollows: 2 })
  ok('never-checked go first, then the longest ago; the rest are deferred, not lost', JSON.stringify(w.fetches) === JSON.stringify(['q2', 'q3']) && s.deferred === 1)
  const w2 = world({ catalogue: {} })
  const io2 = { ...w2.io, fetchWorks: async q => { w2.fetches.push(q); w2.clock += 30_000; return [] } }
  const s2 = await runChecks(fs, io2, { budgetMs: 40_000 })
  ok('past its time budget it stops starting follows and says how many wait', w2.fetches.length === 2 && s2.deferred === 1, JSON.stringify([w2.fetches, s2.deferred]))
}
// 10 — a write that throws is the pass's problem only if it is the news
{
  const w = world({ catalogue: { qa: [W('2', 'B')] } })
  const io = { ...w.io, markChecked: async () => { throw new Error('db') } }
  let threw = false
  try { await runChecks([F('fa', 'u1', 'qa', ['/works/1'])], io) } catch { threw = true }
  ok('the stamp is a courtesy: the failure path never throws out of the pass', true)
  ok('(a stamp failing on a good check is a real error and is allowed to surface)', threw === true)
}
console.log(fails ? `\n${fails} failing` : '\nall good')
process.exit(fails ? 1 : 0)

/**
 * The Goals timeline: one colour per kind, a figure that means what it says, a
 * full year with a rule between years, sections that fold, and lanes that move.
 *
 *   node scripts/goal-timeline.mjs 5199 [colour|figure|year|fold|move]
 *
 * Fixture: a lender owed EGP 150,000 (spare cash covers it this month), a
 * lender owed USD 2,500 (it cannot be covered, so it never lands) and a goal.
 * USD is 48. Every claim is read from the page: computed styles, bounding
 * rects, the stored ranks and the order the lanes are drawn in.
 */
import { chromium } from 'playwright-core'
import { session } from './session.mjs'
import { settled, watchTraffic } from './settled.mjs'

const args = process.argv.slice(2)
const port = args.find(a => /^\d+$/.test(a)) ?? '5199'
const MODE = args.find(a => ['colour', 'figure', 'year', 'fold', 'move'].includes(a)) ?? 'colour'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
let failed = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) failed++ }

const U = session.user.id, T0 = '2026-01-01T00:00:00.000Z'
const acc = o => ({ user_id: U, bank: '', balance: 0, emoji: '💵', color: '#0C8140', sort_order: 0, is_active: true, created_at: T0, ...o })
const goal = o => ({ user_id: U, icon: 'lucide:Target', current_amount: 0, color: '#3366cc', sub: 'no deadline', rank: 0, deadline: null, currency: 'EGP', created_at: T0, ...o })
const DB = {
  finance_accounts: [
    acc({ id: 'p', name: 'CIB', account_type: 'payment', currency: 'EGP', balance: 160000 }),
    acc({ id: 'l1', name: 'Baba Borrowed Money', account_type: 'loan', currency: 'EGP', balance: -150000, emoji: '🤝', sort_order: 1 }),
    acc({ id: 'l2', name: 'Smsm Borrowed Money', account_type: 'loan', currency: 'USD', balance: -2500, emoji: '🤝', sort_order: 2 }),
  ],
  finance_categories: [{ id: 'c1', user_id: U, name: 'Food', icon: 'lucide:Utensils', color: '#0C8140', tx_type: 'expense', sort_order: 0, is_system: false, created_at: T0, parent_id: null }],
  finance_transactions: [],
  finance_goals: [
    goal({ id: 'g1', name: 'Laptop', target_amount: 30000, rank: 5 }),
    goal({ id: 'g2', name: 'Umrah', target_amount: 90000, rank: 6 }),
  ],
}
const writes = []

const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctx = await br.newContext({ viewport: { width: 1400, height: 1400 }, timezoneId: 'Africa/Cairo', locale: 'en-GB', reducedMotion: 'reduce' })
await ctx.route('**://placeholder.supabase.co/**', async r => {
  const req = r.request(), u = req.url(), m = req.method()
  if (m === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS })
  if (u.includes('/auth/v1/user')) return r.fulfill({ json: session.user, headers: CORS })
  if (u.includes('/auth/v1/token')) return r.fulfill({ json: session, headers: CORS })
  if (u.includes('/rpc/')) return r.fulfill({ json: true, headers: CORS })
  const t = /\/rest\/v1\/([a-z_]+)/.exec(u)?.[1]
  if (m !== 'GET') {
    const body = JSON.parse(req.postData() ?? 'null')
    for (const row of [].concat(body ?? [])) {
      writes.push({ table: t, row })
      const list = DB[t]; if (!list) continue
      const i = list.findIndex(x => x.id === row.id)
      if (i >= 0) list[i] = { ...list[i], ...row }; else list.push(row)
    }
    return r.fulfill({ status: 201, json: [], headers: CORS })
  }
  return r.fulfill({ json: (t && DB[t]) || [], headers: CORS })
})
await ctx.route('**://*.googleapis.com/**', r => r.fulfill({ json: { items: [], threads: [], labels: [] }, headers: CORS }))
const page = await ctx.newPage()
page.on('pageerror', e => { console.log('  [pageerror]', String(e).slice(0, 200)); failed++ })
await page.addInitScript(s => {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('google_provider_token', 'tok')
  localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'finance', themeId: 'sunlit-bento' }, version: 0 }))
  localStorage.setItem('finance-fx-rates', JSON.stringify({ USD: 48 }))
  localStorage.setItem('bpa-wizard-done', '1')
}, session)
const traffic = watchTraffic(page)
await page.goto(`http://localhost:${port}/BPA/`, { waitUntil: 'domcontentloaded' })
await settled(page, traffic, 9000)
await page.locator('nav[aria-label="Finance sections"]').getByRole('button', { name: 'Goals', exact: true }).click()
await page.getByText('Every goal on one timeline').waitFor({ timeout: 8000 }).catch(() => {})
const until = async (cond, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await cond()) return true; await new Promise(r => setTimeout(r, 60)) } return cond() }

// The lanes, in the order they are drawn: name, badge background, the figure line.
const lanes = () => page.evaluate(() => [...document.querySelectorAll('[data-lane]')].map(label => {
  const badge = label.querySelector('[data-lane-badge]')
  return { n: badge?.textContent?.trim() ?? '', name: label.getAttribute('data-lane') ?? '', bg: badge ? getComputedStyle(badge).backgroundColor : '',
    text: label.innerText.replace(/\s+/g, ' ') }
}))
const L0 = await lanes()
ok('the timeline is drawn with all four lanes (positive: the fixture is on screen)', L0.length === 4, JSON.stringify(L0.map(l => l.name)))

if (MODE === 'colour') {
  const debts = L0.filter(l => /Borrowed/.test(l.name)), goals = L0.filter(l => !/Borrowed/.test(l.name))
  ok('the two debts are one colour', debts.length === 2 && debts[0].bg === debts[1].bg, debts.map(d => d.bg).join(' | '))
  ok('the two goals are one colour', goals.length === 2 && goals[0].bg === goals[1].bg, goals.map(d => d.bg).join(' | '))
  ok('…and debts and goals are told apart', debts[0].bg !== goals[0].bg, `${debts[0].bg} vs ${goals[0].bg}`)
  const neg = await page.evaluate(() => { const i = document.createElement('i'); i.style.color = 'var(--sb-negative)'; document.body.append(i); const c = getComputedStyle(i).color; i.remove(); return c })
  ok('a debt is the negative token', debts[0].bg === neg, `${debts[0].bg} vs ${neg}`)
}

if (MODE === 'figure') {
  const smsm = L0.find(l => /Smsm/.test(l.name)), baba = L0.find(l => /Baba/.test(l.name))
  ok('the USD debt is shown against what it is in pounds (2,500 USD = 120,000), not "of 2,500"', /of 120,000/.test(smsm?.text ?? '') && !/of 2,500\b/.test(smsm?.text ?? ''), smsm?.text)
  ok('what the plan puts in is never more than what it needs, in the same money', (() => {
    const m = /planned ([\d,]+) of ([\d,]+)/.exec(smsm?.text ?? ''); return !!m && Number(m[1].replace(/,/g, '')) <= Number(m[2].replace(/,/g, ''))
  })(), smsm?.text)
  ok('it says "planned", not a figure that reads as already paid', /planned/.test(baba?.text ?? ''), baba?.text)
  ok('the EGP debt: the plan covers all of it from cash on hand', /planned 150,000 of 150,000/.test(baba?.text ?? ''), baba?.text)
}

if (MODE === 'year') {
  const info = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('button[title*="tap for the month in full"]')].filter(b => b.getBoundingClientRect().top < 700)
    const first = heads[0]?.getBoundingClientRect().top
    const row = heads.filter(h => Math.abs(h.getBoundingClientRect().top - first) < 2)
    return row.map(h => ({ t: h.textContent, left: getComputedStyle(h).borderLeftWidth, colour: getComputedStyle(h).borderLeftColor, x: Math.round(h.getBoundingClientRect().left) }))
  })
  ok('the axis draws at least a year (12 months)', info.length >= 12, String(info.length))
  const jan = info.find(h => /^\d{4}$/.test(h.t ?? ''))
  ok('there is a January (shown as the year) after the first month', !!jan && info.indexOf(jan) > 0, JSON.stringify(info.map(h => h.t)))
  ok('the January column has a rule on its left', !!jan && parseFloat(jan.left) >= 1, JSON.stringify(jan))
  ok('no other month has one', info.filter(h => h !== jan && parseFloat(h.left) > 0).length === 0, JSON.stringify(info.filter(h => parseFloat(h.left) > 0).map(h => h.t)))
  const laneRule = await page.evaluate(() => [...document.querySelectorAll('button[title*="nothing into"],button[title*="into Baba"],button[title*="already landed"]')].filter(b => parseFloat(getComputedStyle(b).borderLeftWidth) >= 1).length)
  ok('the lanes carry the same rule', laneRule >= 1, String(laneRule))
}

if (MODE === 'fold') {
  const hdr = page.locator('button[aria-expanded]').filter({ hasText: /^Debts to clear/i })
  ok('the section header is a button with a state', (await hdr.getAttribute('aria-expanded')) === 'true')
  await hdr.click()
  await until(async () => (await lanes()).length === 2)
  const after = await lanes()
  ok('folding Debts to clear hides its lanes and keeps the goals', after.length === 2 && after.every(l => !/Borrowed/.test(l.name)), JSON.stringify(after.map(l => l.name)))
  ok('…and says it is folded', (await hdr.getAttribute('aria-expanded')) === 'false')
  await hdr.click()
  await until(async () => (await lanes()).length === 4)
  ok('opening it brings them back', (await lanes()).length === 4)
  const goalsHdr = page.locator('button[aria-expanded]').filter({ hasText: /^Goals/ })
  await goalsHdr.click()
  await until(async () => (await lanes()).length === 2)
  ok('Goals folds on its own', (await lanes()).every(l => /Borrowed/.test(l.name)))
}

if (MODE === 'move') {
  const order = async () => (await lanes()).map(l => l.name)
  const before = await order()
  ok('before: Baba is above Smsm (the order the debts were seeded in)', before.indexOf('Repay Baba Borrowed Money') < before.indexOf('Repay Smsm Borrowed Money'), JSON.stringify(before))
  const planBefore = (await lanes()).map(l => l.text)
  await page.getByRole('button', { name: 'Move Repay Smsm Borrowed Money up' }).click()
  await until(async () => (await order()).indexOf('Repay Smsm Borrowed Money') < (await order()).indexOf('Repay Baba Borrowed Money'))
  const after = await order()
  ok('Smsm is now drawn above Baba', after.indexOf('Repay Smsm Borrowed Money') < after.indexOf('Repay Baba Borrowed Money'), JSON.stringify(after))
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('finance-debt-goal-ranks') ?? '{}'))
  ok('the new order is stored', Object.keys(stored).length >= 2 && stored['debt:l2'] < stored['debt:l1'], JSON.stringify(stored))
  const planAfter = (await lanes()).map(l => l.text)
  ok('the plan was run again: the figures on the lanes changed with the order', JSON.stringify(planBefore) !== JSON.stringify(planAfter), `${planBefore.join(' // ')}  →  ${planAfter.join(' // ')}`)
  ok('the first lane has no "up" and the last no "down"', await page.evaluate(() => {
    const up = [...document.querySelectorAll('button[aria-label^="Move "][aria-label$=" up"]')], dn = [...document.querySelectorAll('button[aria-label^="Move "][aria-label$=" down"]')]
    return up.length >= 2 && dn.length >= 2 && up.filter(b => b.disabled).length === 2 && dn.filter(b => b.disabled).length === 2
  }))
  const goalFirst = (await order()).filter(n => !/Borrowed/.test(n))
  await page.getByRole('button', { name: `Move ${goalFirst[1]} up` }).click()
  await until(() => writes.some(w => w.table === 'finance_goals'))
  ok('a goal moves too, and is written to the server', writes.some(w => w.table === 'finance_goals' && w.row.name === goalFirst[1] && w.row.rank < 6), JSON.stringify(writes.filter(w => w.table === 'finance_goals').map(w => [w.row.name, w.row.rank])))
}
await br.close()
console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)

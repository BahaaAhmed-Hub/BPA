#!/usr/bin/env node
/**
 * account-rows-uniform — every row on Balances is the same box
 *
 *   npx vite --port 5199 --strictPort
 *   node scripts/account-rows-uniform.mjs [5199]
 *
 * Payment, cash, two cards (one with a name long enough to wrap, one with
 * points and a dated-ahead line) and two loans. Measured with
 * getBoundingClientRect: all rows share one height and one width, and the
 * balance, action and edit columns share their left edge in every group.
 * Control: a row with no limit bar still lines up with one that has it.
 */
import { chromium } from 'playwright-core'
import { session } from './session.mjs'
import { settled, watchTraffic } from './settled.mjs'

const port = process.argv.slice(2).find(a => /^\d+$/.test(a)) ?? '5199'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
let failed = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) failed++ }
const U = session.user.id, T0 = '2026-01-01T00:00:00.000Z'
const acc = (o) => ({ user_id: U, bank: '', balance: 0, emoji: '💵', color: '#0C8140', sort_order: 0, is_active: true, created_at: T0, ...o })
const DB = {
  finance_accounts: [
    acc({ id: 'p1', name: 'QNB Debit', bank: 'QNB', account_type: 'payment', currency: 'EGP', sort_order: 0 }),
    acc({ id: 'p2', name: 'EGP Cash', account_type: 'payment', currency: 'EGP', balance: 1715, sort_order: 1 }),
    acc({ id: 'c1', name: 'Platinum Credit Card Extra Long Name', bank: 'CIB', account_type: 'credit_card', currency: 'EGP', balance: -185708, credit_limit: 200000, sort_order: 2 }),
    acc({ id: 'c2', name: 'World CC', bank: 'CIB', account_type: 'credit_card', currency: 'EGP', balance: -132539, credit_limit: 100000, sort_order: 3 }),
    acc({ id: 'l1', name: 'Baba Borrowed Money', account_type: 'loan', currency: 'EGP', balance: -150000, emoji: '🤝', sort_order: 4 }),
    acc({ id: 'l2', name: 'Smsm Borrowed Money', account_type: 'loan', currency: 'USD', balance: -2500, emoji: '🤝', sort_order: 5 }),
  ],
  finance_categories: [], finance_transactions: [],
}
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctx = await br.newContext({ viewport: { width: +(process.env.W ?? 1300), height: 1000 }, timezoneId: 'Africa/Cairo', locale: 'en-GB', reducedMotion: 'reduce' })
await ctx.route('**://placeholder.supabase.co/**', async r => {
  const req = r.request(), u = req.url(), m = req.method()
  if (m === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS })
  if (u.includes('/auth/v1/user')) return r.fulfill({ json: session.user, headers: CORS })
  if (u.includes('/auth/v1/token')) return r.fulfill({ json: session, headers: CORS })
  if (u.includes('/rpc/')) return r.fulfill({ json: true, headers: CORS })
  const t = /\/rest\/v1\/([a-z_]+)/.exec(u)?.[1]
  if (m !== 'GET') return r.fulfill({ status: 201, json: [], headers: CORS })
  return r.fulfill({ json: (t && DB[t]) || [], headers: CORS })
})
await ctx.route('**://*.googleapis.com/**', r => r.fulfill({ json: { items: [], threads: [], labels: [] }, headers: CORS }))
const page = await ctx.newPage()
page.on('pageerror', e => { console.log('  [pageerror]', String(e).slice(0, 200)); failed++ })
await page.addInitScript(([s]) => {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('google_provider_token', 'tok')
  localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'finance', themeId: 'sunlit-bento' }, version: 0 }))
  localStorage.setItem('bpa-wizard-done', '1')
}, [session])
const traffic = watchTraffic(page)
await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' })
await settled(page, traffic, 9000)
await page.locator('nav[aria-label="Finance sections"]').getByRole('button', { name: 'Balance', exact: true }).click()
await page.getByText('CARDS OWED').waitFor()

const rows = await page.evaluate(() => [...document.querySelectorAll('[role="button"][title^="Show only"], [role="button"][title^="Showing"]')].map(el => {
  const r = el.getBoundingClientRect()
  const kids = [...el.children].map(c => Math.round(c.getBoundingClientRect().left))
  return { name: el.title, h: Math.round(r.height), w: Math.round(r.width), x: Math.round(r.left), kids }
}))
rows.forEach(r => console.log(' ', r.name.padEnd(40), `h=${r.h} w=${r.w} x=${r.x}`, r.kids.slice(-3).join(',')))
ok('all six rows were found', rows.length === 6, String(rows.length))
ok('one height for every row', new Set(rows.map(r => r.h)).size === 1, [...new Set(rows.map(r => r.h))].join('/'))
ok('one width for every row', new Set(rows.map(r => r.w)).size === 1, [...new Set(rows.map(r => r.w))].join('/'))
ok('balance, action and edit columns share a left edge in every row',
  [-3, -2, -1].every(i => new Set(rows.map(r => r.kids[r.kids.length + i])).size === 1))
await page.screenshot({ path: process.env.SHOT ?? '/tmp/rows.png' })
await br.close()
process.exit(failed ? 1 : 0)

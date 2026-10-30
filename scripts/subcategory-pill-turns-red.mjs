#!/usr/bin/env node
/**
 * subcategory-pill-turns-red — a part of an envelope that has gone past its limit is red
 *
 *   npx vite --port 5199 --strictPort
 *   node scripts/subcategory-pill-turns-red.mjs [5199]
 *
 * Food is budgeted at 1,000; its part "Super Market" has spent 1,500 and "Cafe" 100 against a budget of its own (500), so it is the beige budgeted pill.
 * Measured as the pill's own computed background / border / colour: the over pill must
 * read red (`--sb-negative-tint`), the one under its limit must still be the beige accent
 * tint — so "everything went red" cannot pass. The stub can refuse: it answers [] for
 * everything it was not given.
 */
import { chromium } from 'playwright-core'
import { session } from './session.mjs'
import { settled, watchTraffic } from './settled.mjs'

const port = process.argv.slice(2).find(a => /^\d+$/.test(a)) ?? '5199'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
let failed = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) failed++ }

const pad = n => String(n).padStart(2, '0')
const now = new Date()
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
const U = session.user.id, T0 = '2026-01-01T00:00:00.000Z'
const cat = (id, name, extra = {}) => ({ id, user_id: U, name, icon: 'lucide:ShoppingCart', color: '#0C8140', tx_type: 'expense', sort_order: 0, is_system: false, created_at: T0, parent_id: null, ...extra })
const tx = (id, category_id, amount) => ({ id, user_id: U, account_id: 'a1', to_account_id: null, category_id, amount, currency: 'EGP',
  tx_type: 'expense', payee: id, date: today, paid_at: today, note: null, is_cleared: true, is_recurring: false, tags: [], attachments: [], created_at: T0 })
const DB = {
  finance_accounts: [{ id: 'a1', user_id: U, name: 'Cash', bank: '', account_type: 'payment', currency: 'EGP', balance: 0, emoji: '💵', color: '#0C8140', sort_order: 0, is_active: true, created_at: T0 }],
  finance_categories: [cat('c-food', 'Food'), cat('c-super', 'Super Market', { parent_id: 'c-food', sort_order: 1 }), cat('c-cafe', 'Cafe', { parent_id: 'c-food', sort_order: 2 })],
  finance_transactions: [tx('t1', 'c-super', 1500), tx('t2', 'c-cafe', 100)],
}

const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctx = await br.newContext({ viewport: { width: 1500, height: 1050 }, timezoneId: 'Africa/Cairo', locale: 'en-GB', reducedMotion: 'reduce' })
await ctx.route('**://placeholder.supabase.co/**', r => {
  const req = r.request(), u = req.url()
  if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS })
  if (u.includes('/auth/v1/user')) return r.fulfill({ json: session.user, headers: CORS })
  if (u.includes('/auth/v1/token')) return r.fulfill({ json: session, headers: CORS })
  if (u.includes('/rpc/')) return r.fulfill({ json: true, headers: CORS })
  const t = /\/rest\/v1\/([a-z_]+)/.exec(u)?.[1]
  return r.fulfill({ json: (t && DB[t]) || [], headers: CORS })
})
await ctx.route('**://*.googleapis.com/**', r => r.fulfill({ json: { items: [], threads: [], labels: [] }, headers: CORS }))
const page = await ctx.newPage()
page.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 160)))
await page.addInitScript(([s, month]) => {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('google_provider_token', 'tok')
  localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'finance', themeId: 'sunlit-bento' }, version: 0 }))
  localStorage.setItem('finance-active-screen', 'budget')
  localStorage.setItem('finance-budget-rules', JSON.stringify({ 'c-food': { amount: 1000, frequency: 'monthly', rollover: false, warn80: false, currency: 'EGP' }, 'c-cafe': { amount: 500, frequency: 'monthly', rollover: false, warn80: false, currency: 'EGP' } }))
}, [session, `${now.getFullYear()}-${pad(now.getMonth() + 1)}`])
const traffic = watchTraffic(page)
await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' })
await settled(page, traffic, 9000)
await page.getByText('Skip for now').first().click({ timeout: 800 }).catch(() => {})
await page.getByRole('button', { name: /^Budget$/ }).first().click({ timeout: 3000 }).catch(() => {})
await page.locator('button[title^="Super Market — inside Food"]').first().waitFor({ timeout: 8000 }).catch(() => {})

const read = title => page.evaluate(t => {
  const el = document.querySelector(`button[title^="${t}"]`)
  if (!el) return null
  const cs = getComputedStyle(el)
  // A fresh element per token with transitions off: a global `color` transition
  // makes one reused probe report the previous token's colour.
  const resolve = v => { const p = document.createElement('i'); p.style.cssText = `transition:none;color:${v}`; el.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c }
  const r = { bg: cs.backgroundColor, border: cs.borderTopColor, color: cs.color,
    red: resolve('var(--sb-negative-tint)'), tint: resolve('var(--sb-accent-tint)'), deep: resolve('var(--sb-negative-deep)') }
  return r
}, title)

const over = await read('Super Market — inside Food')
const under = await read('Cafe — inside Food')
ok('both pills are on screen', !!over && !!under)
if (over && under) {
  console.log('  over :', JSON.stringify(over)); console.log('  under:', JSON.stringify(under))
  ok('over pill background is the negative tint', over.bg === over.red, `${over.bg} vs ${over.red}`)
  ok('over pill text is negative-deep', over.color === over.deep, `${over.color} vs ${over.deep}`)
  ok('over pill is not the beige accent tint', over.bg !== over.tint)
  ok('pill under its limit keeps the beige accent tint', under.bg === under.tint, `${under.bg} vs ${under.tint}`)
}
await br.close()
console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)

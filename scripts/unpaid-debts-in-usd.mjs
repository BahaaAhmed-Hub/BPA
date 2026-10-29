#!/usr/bin/env node
/**
 * unpaid-debts-in-usd — an unpaid foreign entry says what it is in its own currency, at the
 * rate it was added at, and what settling it today would come to
 *
 *   npx vite --port 5199 --strictPort
 *   node scripts/unpaid-debts-in-usd.mjs [5199] [rows|total]
 *
 * USD is 50 today. On the ledger, all due today:
 *   Landlord  — 100 USD, unpaid, added at 48     (stamped fx:USD/EGP=48)
 *   Plumber   —  40 USD, unpaid, never stamped   (older than the stamp: today's rate)
 *   Pharmacy  — 300 EGP, unpaid                  (the base: nothing to say)
 *   Bakery    —  10 USD, PAID                    (a debt is what is unpaid)
 *   rows  — Today's feed: Landlord reads 'USD 100 @ 48 = EGP 4,800 · today 50 = EGP 5,000',
 *           Plumber 'USD 40 @ 50 = EGP 2,000' (said once — there is no other rate), and
 *           neither Pharmacy nor Bakery carries a note. Each is measured on the row's own text,
 *           after the row is positively on screen.
 *   total — Balance's hero: 'Unpaid: USD 140 (2) = EGP 6,800 at the rates added · EGP 7,000
 *           at today's 50' — and exactly one such line (only USD is foreign).
 * Control, the code before this change: the rows carry no note and the hero has no line.
 */
import { chromium } from 'playwright-core'
import { session } from './session.mjs'
import { settled, watchTraffic } from './settled.mjs'

const args = process.argv.slice(2)
const port = args.find(a => /^\d+$/.test(a)) ?? '5199'
const MODE = args.find(a => a === 'rows' || a === 'total') ?? 'rows'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
let failed = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) failed++ }

const pad = n => String(n).padStart(2, '0')
const now = new Date()
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
const U = session.user.id, T0 = '2026-01-01T00:00:00.000Z'
const row = (id, payee, currency, amount, extra = {}) => ({ id, user_id: U, account_id: 'a1', to_account_id: null, category_id: 'c-rent', amount, currency,
  tx_type: 'expense', payee, date: today, paid_at: null, note: null, is_cleared: false, is_recurring: false, tags: [], attachments: [], created_at: T0, ...extra })
const DB = {
  finance_accounts: [{ id: 'a1', user_id: U, name: 'Cash', bank: '', account_type: 'payment', currency: 'EGP', balance: 0, emoji: '💵', color: '#0C8140', sort_order: 0, is_active: true, created_at: T0 }],
  finance_categories: [{ id: 'c-rent', user_id: U, name: 'Rent', icon: 'lucide:Home', color: '#0C8140', tx_type: 'expense', sort_order: 0, is_system: false, created_at: T0, parent_id: null }],
  finance_transactions: [
    row('t1', 'Landlord', 'USD', 100, { tags: ['fx:USD/EGP=48'] }),
    row('t2', 'Plumber', 'USD', 40),
    row('t3', 'Pharmacy', 'EGP', 300),
    row('t4', 'Bakery', 'USD', 10, { paid_at: today, is_cleared: true, tags: ['fx:USD/EGP=48'] }),
  ],
}

const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctx = await br.newContext({ viewport: { width: 1500, height: 1100 }, timezoneId: 'Africa/Cairo', locale: 'en-GB', reducedMotion: 'reduce' })
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
await page.addInitScript(([s, screen]) => {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('google_provider_token', 'tok')
  localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'finance', themeId: 'sunlit-bento' }, version: 0 }))
  localStorage.setItem('finance-active-screen', screen)
  localStorage.setItem('bpa-wizard-done', '1')   // the stub account is brand new; the setup guide would cover the screen
  localStorage.setItem('finance-fx-rates', JSON.stringify({ USD: 50 }))
}, [session, MODE === 'rows' ? 'today' : 'balance'])
const traffic = watchTraffic(page)
await page.goto(`http://localhost:${port}/BPA/`, { waitUntil: 'domcontentloaded' })
await settled(page, traffic, 9000)

if (MODE === 'rows') {
  // A feed row is the `cursor: pointer` container holding the payee; the calendar cell above
  // also draws the payee, and the feed is below it, so the last match is the row.
  const rowText = async payee => {
    const el = page.locator('div[style*="cursor: pointer"]').filter({ hasText: payee }).last()
    await el.waitFor({ timeout: 8000 })
    return el.innerText()
  }
  const landlord = await rowText('Landlord').catch(() => null)
  const plumber  = await rowText('Plumber').catch(() => null)
  const pharmacy = await rowText('Pharmacy').catch(() => null)
  const bakery   = await rowText('Bakery').catch(() => null)
  console.log('  Landlord:', JSON.stringify(landlord)); console.log('  Plumber:', JSON.stringify(plumber))
  ok('all four rows are on screen', [landlord, plumber, pharmacy, bakery].every(Boolean))
  ok('stamped at 48: says its rate and what settling today comes to', /USD 100 @ 48 = EGP 4,800 · today 50 = EGP 5,000/.test(landlord ?? ''), landlord ?? '')
  ok('never stamped: today\'s rate, said once', /USD 40 @ 50 = EGP 2,000/.test(plumber ?? '') && !/today/.test(plumber ?? ''), plumber ?? '')
  ok('an unpaid entry in the base currency has no note', !/@/.test(pharmacy ?? ''), pharmacy ?? '')
  ok('a paid entry is not a debt and has no note', !/@/.test(bakery ?? ''), bakery ?? '')
}

if (MODE === 'total') {
  await page.getByRole('button', { name: /^Balance$/ }).first().click({ timeout: 3000 }).catch(() => {})
  await page.getByText('NET POSITION').first().waitFor({ timeout: 8000 }).catch(() => {})
  ok('the Balance hero is on screen', await page.getByText('NET POSITION').count() > 0)
  const lines = await page.locator('[data-unpaid-debt]').allInnerTexts()
  console.log('  lines:', JSON.stringify(lines))
  ok('exactly one unpaid line — only USD is foreign', lines.length === 1, String(lines.length))
  ok('USD 140 owed over two entries, EGP 6,800 at the rates added, 7,000 at today\'s 50',
    /Unpaid: USD 140 \(2\)\s*= EGP 6,800 at the rates added\s*· EGP 7,000 at today's 50/.test((lines[0] ?? '').replace(/\s+/g, ' ')), lines[0] ?? '')
}

await br.close()
console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)

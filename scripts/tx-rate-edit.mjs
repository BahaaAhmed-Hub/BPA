#!/usr/bin/env node
/**
 * tx-rate-edit — an entry's exchange rate can be read and corrected in its panel
 *
 *   npx vite --port 5199 --strictPort
 *   node scripts/tx-rate-edit.mjs [5199] [edit|shown|currency]
 *
 * Base is EGP and USD is now 50. Today's entry — 100 USD at the 48 it was added at — and
 * one in EGP are on the ledger.
 *   edit     — the panel for the USD entry has a Rate row reading 48 (not today's 50); it is
 *              changed to 49.5 and saved: the write carries exactly one fx tag, 49.5, the
 *              chips under Tags do not show it, and the description is untouched.
 *   shown    — the EGP entry's panel has no Rate row; the USD one has. (An absence is only
 *              claimed after the panel is positively open.)
 *   currency — changing the USD entry's currency to EGP removes the row; back to USD it
 *              returns empty (a rate typed for one currency is not for another), and a
 *              save with it empty writes the old stamp away so the store stamps today's.
 * The stub keeps what it is sent. Run on the code before this change there is no Rate row.
 */
import { chromium } from 'playwright-core'
import { session } from './session.mjs'
import { settled, watchTraffic } from './settled.mjs'

const args = process.argv.slice(2)
const port = args.find(a => /^\d+$/.test(a)) ?? '5199'
const MODE = args.find(a => ['edit', 'shown', 'currency'].includes(a)) ?? 'edit'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
let failed = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) failed++ }

const pad = n => String(n).padStart(2, '0')
const now = new Date()
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
const U = session.user.id, T0 = '2026-01-01T00:00:00.000Z'
const row = (id, payee, currency, extra = {}) => ({ id, user_id: U, account_id: 'a1', to_account_id: null, category_id: 'c-rent', amount: 100, currency,
  tx_type: 'expense', payee, date: today, paid_at: today, note: 'with Omar', is_cleared: true, is_recurring: false, tags: [], attachments: [], created_at: T0, ...extra })
const DB = {
  finance_accounts: [{ id: 'a1', user_id: U, name: 'Cash', bank: '', account_type: 'payment', currency: 'EGP', balance: 0, emoji: '💵', color: '#0C8140', sort_order: 0, is_active: true, created_at: T0 }],
  finance_categories: [{ id: 'c-rent', user_id: U, name: 'Rent', icon: 'lucide:Home', color: '#0C8140', tx_type: 'expense', sort_order: 0, is_system: false, created_at: T0, parent_id: null }],
  finance_transactions: [row('tx-usd', 'Landlord', 'USD', { tags: ['groceries', 'fx:USD/EGP=48'] }), row('tx-egp', 'Pharmacy', 'EGP')],
}
const writes = []

const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctx = await br.newContext({ viewport: { width: 1500, height: 1100 }, timezoneId: 'Africa/Cairo', locale: 'en-GB', reducedMotion: 'reduce' })
await ctx.route('**://placeholder.supabase.co/**', async r => {
  const req = r.request(), u = req.url(), m = req.method()
  if (m === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS })
  if (u.includes('/auth/v1/user')) return r.fulfill({ json: session.user, headers: CORS })
  if (u.includes('/auth/v1/token')) return r.fulfill({ json: session, headers: CORS })
  if (u.includes('/rpc/')) return r.fulfill({ json: true, headers: CORS })
  const t = /\/rest\/v1\/([a-z_]+)/.exec(u)?.[1]
  if (t === 'finance_transactions' && (m === 'POST' || m === 'PATCH')) {
    for (const w of [].concat(JSON.parse(req.postData() ?? 'null') ?? [])) {
      writes.push(w)
      const i = DB.finance_transactions.findIndex(x => x.id === w.id)
      if (i >= 0) DB.finance_transactions[i] = { ...DB.finance_transactions[i], ...w }
    }
    return r.fulfill({ status: 201, json: [], headers: CORS })
  }
  return r.fulfill({ json: (t && DB[t]) || [], headers: CORS })
})
await ctx.route('**://*.googleapis.com/**', r => r.fulfill({ json: { items: [], threads: [], labels: [] }, headers: CORS }))
const page = await ctx.newPage()
page.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 160)))
await page.addInitScript(([s]) => {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('google_provider_token', 'tok')
  localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'finance', themeId: 'sunlit-bento' }, version: 0 }))
  localStorage.setItem('finance-active-screen', 'today')
  localStorage.setItem('bpa-wizard-done', '1')   // the stub account is brand new; the setup guide would cover the screen
  localStorage.setItem('finance-fx-rates', JSON.stringify({ USD: 50 }))
}, [session])
const traffic = watchTraffic(page)
await page.goto(`http://localhost:${port}/BPA/`, { waitUntil: 'domcontentloaded' })
await settled(page, traffic, 9000)
await page.getByText('Skip for now').first().click({ timeout: 800 }).catch(() => {})

const rateInput = page.locator('input[aria-label^="Exchange rate"]')
const open = async payee => {
  // The payee is drawn twice — in the calendar cell and in the feed under it. The feed's row is what opens the entry.
  await page.getByText(payee, { exact: true }).last().click({ timeout: 8000 })
  await page.getByRole('button', { name: /Save changes/ }).waitFor({ timeout: 8000 })
}

await open('Landlord').catch(() => {})
ok('the USD entry\'s panel is open', await page.getByRole('button', { name: /Save changes/ }).count() > 0)

if (MODE === 'edit') {
  ok('the Rate row is there', await rateInput.count() === 1)
  if (!(await rateInput.count())) { await br.close(); console.log(`\n${failed} FAILED (no Rate row to edit)`); process.exit(1) }
  const shown = await rateInput.inputValue().catch(() => null)
  ok('it reads the rate the entry was added at (48), not today\'s 50', shown === '48', String(shown))
  const chips = await page.evaluate(() => document.body.innerText.includes('fx:USD'))
  ok('the stamp is not drawn as a tag', !chips)
  await rateInput.fill('49.5')
  await page.getByRole('button', { name: /Save changes/ }).click()
  await page.waitForFunction(() => true)
  const deadline = Date.now() + 5000
  while (!writes.some(w => w.id === 'tx-usd') && Date.now() < deadline) await new Promise(r => setTimeout(r, 50))
  const w = writes.find(x => x.id === 'tx-usd')
  console.log('  write:', JSON.stringify({ tags: w?.tags, note: w?.note }))
  ok('a write was sent', !!w)
  ok('exactly one fx tag, at 49.5', (w?.tags ?? []).filter(t => t.startsWith('fx:')).length === 1 && (w?.tags ?? []).includes('fx:USD/EGP=49.5'), JSON.stringify(w?.tags))
  ok('the ordinary tag survived', (w?.tags ?? []).includes('groceries'))
  ok('the description was left alone', w?.note === 'with Omar', String(w?.note))
}

if (MODE === 'shown') {
  ok('the USD entry has a Rate row', await rateInput.count() === 1)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /Save changes/ }).waitFor({ state: 'detached', timeout: 5000 }).catch(() => {})
  await open('Pharmacy').catch(() => {})
  ok('the EGP entry\'s panel is open', await page.getByRole('button', { name: /Save changes/ }).count() > 0)
  ok('…and has no Rate row (the base currency needs none)', await rateInput.count() === 0)
}

if (MODE === 'currency') {
  const sel = page.locator('select').filter({ has: page.locator('option[value="AED"]') }).first()
  await sel.selectOption('EGP')
  ok('changing the currency to the base removes the row', await rateInput.count() === 0)
  await sel.selectOption('USD')
  ok('changing back brings it back', await rateInput.count() === 1)
  ok('…empty, because a rate typed for another currency is not this one\'s', (await rateInput.inputValue()) === '')
  ok('…showing today\'s as the placeholder', (await rateInput.getAttribute('placeholder')) === '50')
  await page.getByRole('button', { name: /Save changes/ }).click()
  const deadline = Date.now() + 5000
  while (!writes.some(w => w.id === 'tx-usd') && Date.now() < deadline) await new Promise(r => setTimeout(r, 50))
  const w = writes.find(x => x.id === 'tx-usd')
  console.log('  write:', JSON.stringify({ tags: w?.tags }))
  ok('saved with the field empty, the old stamp is replaced by today\'s (the store stamps it)', (w?.tags ?? []).filter(t => t.startsWith('fx:')).join() === 'fx:USD/EGP=50', JSON.stringify(w?.tags))
}

await br.close()
console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)

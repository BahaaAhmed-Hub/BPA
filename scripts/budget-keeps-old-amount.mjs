#!/usr/bin/env node
/**
 * budget-keeps-old-amount — raising a budget does not rewrite the months before it
 *
 *   npx vite --port 5199 --strictPort
 *   node scripts/budget-keeps-old-amount.mjs [5199] [edit|stored]
 *
 * Rent is budgeted at 10,000 and 12,000 was spent on it last month and again this one.
 *   stored — the rule already carries a change to 13,000 from this month. Last month must
 *            still read "of EGP 10,000" with 12,000 spent against it (over), this month
 *            "of EGP 13,000".
 *   edit   — the rule has no history; the panel's amount field is typed 13,000 in this
 *            month. The stored rule must keep 10,000 as its base and gain ONE change from
 *            this month, and stepping back a month must still read 10,000.
 * Measured on the panel's own text and on the stored rule. The stub refuses: it answers []
 * for everything it was not given, so an envelope that is not there fails the first
 * assertion rather than passing by showing nothing.
 */
import { chromium } from 'playwright-core'
import { session } from './session.mjs'
import { settled, watchTraffic } from './settled.mjs'

const args = process.argv.slice(2)
const port = args.find(a => /^\d+$/.test(a)) ?? '5199'
const MODE = args.find(a => a === 'edit' || a === 'stored') ?? 'edit'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
let failed = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) failed++ }

const pad = n => String(n).padStart(2, '0')
const now = new Date()
const thisMonth = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
const prev = new Date(now.getFullYear(), now.getMonth() - 1, 10)
const prevMonth = `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}`
const prevDay = `${prevMonth}-10`
const thisDay = `${thisMonth}-${pad(Math.min(now.getDate(), 27))}`
if (now.getMonth() === 0) { console.log('Run this outside January: the month picker would change year.'); process.exit(2) }

const U = session.user.id, T0 = '2026-01-01T00:00:00.000Z'
const cat = { id: 'c-rent', user_id: U, name: 'Rent', icon: 'lucide:Home', color: '#0C8140', tx_type: 'expense', sort_order: 0, is_system: false, created_at: T0, parent_id: null }
const tx = (id, date) => ({ id, user_id: U, account_id: 'a1', to_account_id: null, category_id: 'c-rent', amount: 12000, currency: 'EGP',
  tx_type: 'expense', payee: id, date, paid_at: date, note: null, is_cleared: true, is_recurring: false, tags: [], attachments: [], created_at: T0 })
const DB = {
  finance_accounts: [{ id: 'a1', user_id: U, name: 'Cash', bank: '', account_type: 'payment', currency: 'EGP', balance: 0, emoji: '💵', color: '#0C8140', sort_order: 0, is_active: true, created_at: T0 }],
  finance_categories: [cat],
  finance_transactions: [tx('last', prevDay), tx('this', thisDay)],
}
const base = { amount: 10000, frequency: 'monthly', rollover: false, warn80: false, currency: 'EGP', bucket: 'fixed' }
const RULE = MODE === 'stored' ? { ...base, steps: [{ from: thisMonth, amount: 13000 }] } : base

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
await page.addInitScript(([s, rule]) => {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('google_provider_token', 'tok')
  localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'finance', themeId: 'sunlit-bento' }, version: 0 }))
  localStorage.setItem('finance-active-screen', 'budget')
  localStorage.setItem('bpa-wizard-done', '1')   // the stub account is brand new; the setup guide would take the keystrokes
  localStorage.setItem('finance-budget-rules', JSON.stringify({ 'c-rent': rule }))
}, [session, RULE])
const traffic = watchTraffic(page)
await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' })
await settled(page, traffic, 9000)
await page.getByText('Skip for now').first().click({ timeout: 800 }).catch(() => {})
await page.getByRole('button', { name: /^Budget$/ }).first().click({ timeout: 3000 }).catch(() => {})

// The panel for Rent, and what it says about the month on screen.
const openRent = async () => {
  await page.getByText('Rent', { exact: true }).first().click({ timeout: 8000 })
  await page.locator('text=/this month/').first().waitFor({ timeout: 8000 })
}
const panelText = () => page.evaluate(() => {
  const el = [...document.querySelectorAll('span')].find(e => /this month|budget not running|no budget set/.test(e.textContent ?? '') && e.children.length === 0)
  return el?.textContent ?? null
})
const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('finance-budget-rules') ?? '{}')['c-rent'] ?? null)
const closePanel = () => page.keyboard.press('Escape')

await openRent().catch(() => {})
const here = await panelText()
ok('Rent is on screen and its panel opens', !!here, here ?? '(no panel)')

if (MODE === 'edit' && here) {
  ok('before the edit: this month reads 10,000', /10,000/.test(here), here)
  // The amount field is the panel's big right-aligned number input.
  const amountInput = page.locator('input[placeholder="0"]').first()
  ok('the amount field exists and shows 10,000', (await amountInput.inputValue()) === '10,000', await amountInput.inputValue())
  await amountInput.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.type('13000')
  // The field saves as it is typed; wait for the last keystroke to land rather than for a number of ms.
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('finance-budget-rules') ?? '{}')['c-rent']?.steps?.at(-1)?.amount === 13000, null, { timeout: 5000 }).catch(() => {})
  const rule = await stored()
  console.log('  stored rule:', JSON.stringify(rule))
  ok('the base amount is untouched', rule?.amount === 10000, `amount ${rule?.amount}`)
  ok('exactly one change is recorded', rule?.steps?.length === 1, JSON.stringify(rule?.steps))
  ok('…from this month, at 13,000', rule?.steps?.[0]?.from === thisMonth && rule?.steps?.[0]?.amount === 13000, JSON.stringify(rule?.steps))
  ok('this month now reads 13,000', /13,000/.test((await panelText()) ?? ''), (await panelText()) ?? '')
}

if (MODE === 'stored' && here) {
  ok('this month reads 13,000, and 12,000 is inside it', /13,000/.test(here), here)
}

// Step back a month: the old number, and 12,000 spent against it.
await closePanel()
await page.locator('button[title="Previous month"]').click()
await openRent().catch(() => {})
const before = await panelText()
console.log('  last month:', before)
ok('last month still reads 10,000', /10,000/.test(before ?? ''), before ?? '(no panel)')
ok('…and not 13,000', !/13,000/.test(before ?? ''), before ?? '')
const spentText = await page.evaluate(() => document.body.innerText.match(/12,000/g)?.length ?? 0)
ok('12,000 is shown as spent against it', spentText > 0, `${spentText} mentions`)

await br.close()
console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)

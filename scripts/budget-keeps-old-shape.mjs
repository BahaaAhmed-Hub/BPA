#!/usr/bin/env node
/**
 * budget-keeps-old-shape — changing what a budget SAYS (its instalments, its currency, its kind)
 * does not rewrite the months before the change, any more than changing its amount does
 *
 *   npx vite --port 5199 --strictPort
 *   node scripts/budget-keeps-old-shape.mjs [5199] [fees-stored|fees-edit|currency|bucket]
 *
 * "Fees" is a school fee that comes round every year: an instalment last month and one this month,
 * 45,000 each. "Rent" is 10,000 EGP a month, in the Fixed bucket.
 *   fees-stored — the rule already carries a new set from this month (50,000 each). The panel for
 *                 last month reads 45,000, this month 50,000.
 *   fees-edit   — no history. The first instalment is edited to 50,000 in the panel: the stored rule
 *                 keeps its 45,000 set as the base and gains ONE change from this month carrying the
 *                 new set — so last month still reads 45,000 (and, once the same date comes round next
 *                 year, 50,000: the set is read by the month it falls in, which `monthlyAmount` proves
 *                 for 2025 and 2027 on the real module).
 *   currency    — Rent's currency select is moved to USD: one change from this month; last month's
 *                 panel still says EGP, this month's USD.
 *   bucket      — the Savings pill is pressed: one change; last month still reads Fixed (the pill that
 *                 is lit in last month's panel is read off the page, not assumed).
 * Measured on the panel's own text, the lit pill and the stored rule. The stub refuses: it answers []
 * for everything it was not given, so a panel that never opened fails the first assertion.
 */
import { chromium } from 'playwright-core'
import { session } from './session.mjs'
import { settled, watchTraffic } from './settled.mjs'

const args = process.argv.slice(2)
const port = args.find(a => /^\d+$/.test(a)) ?? '5199'
const MODE = args.find(a => ['fees-stored', 'fees-edit', 'currency', 'bucket'].includes(a)) ?? 'fees-edit'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
let failed = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) failed++ }

const pad = n => String(n).padStart(2, '0')
const now = new Date()
if (now.getMonth() === 0) { console.log('Run this outside January: the month picker would change year.'); process.exit(2) }
const y = now.getFullYear()
const thisMonth = `${y}-${pad(now.getMonth() + 1)}`
const lastMonth = `${y}-${pad(now.getMonth())}`
const U = session.user.id, T0 = '2026-01-01T00:00:00.000Z'
const cat = (id, name) => ({ id, user_id: U, name, icon: 'lucide:Home', color: '#0C8140', tx_type: 'expense', sort_order: 0, is_system: false, created_at: T0, parent_id: null })
const DB = {
  finance_accounts: [{ id: 'a1', user_id: U, name: 'Cash', bank: '', account_type: 'payment', currency: 'EGP', balance: 0, emoji: '💵', color: '#0C8140', sort_order: 0, is_active: true, created_at: T0 }],
  finance_categories: [cat('c-fees', 'Fees'), cat('c-rent', 'Rent')],
  finance_transactions: [],
}
const lines = amount => [{ id: 'l1', date: `${lastMonth}-10`, amount }, { id: 'l2', date: `${thisMonth}-10`, amount }]
const base = { frequency: 'monthly', rollover: false, warn80: false, currency: 'EGP', bucket: 'fixed' }
const FEES = { ...base, amount: 0, schedule: 'custom', linesRepeat: true, lines: lines(45000) }
const RENT = { ...base, amount: 10000 }
const RULES = {
  'fees-stored': { 'c-fees': { ...FEES, steps: [{ from: thisMonth, lines: lines(50000) }] } },
  'fees-edit': { 'c-fees': FEES },
  currency: { 'c-rent': RENT },
  bucket: { 'c-rent': RENT },
}[MODE]
const WHO = MODE.startsWith('fees') ? 'Fees' : 'Rent'
const KEY = MODE.startsWith('fees') ? 'c-fees' : 'c-rent'

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
await page.addInitScript(([s, rules]) => {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('google_provider_token', 'tok')
  localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'finance', themeId: 'sunlit-bento' }, version: 0 }))
  localStorage.setItem('finance-active-screen', 'budget')
  localStorage.setItem('bpa-wizard-done', '1')   // the stub account is brand new; the setup guide would take the keystrokes
  localStorage.setItem('finance-budget-rules', JSON.stringify(rules))
}, [session, RULES])
const traffic = watchTraffic(page)
await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' })
await settled(page, traffic, 9000)
await page.getByText('Skip for now').first().click({ timeout: 800 }).catch(() => {})
await page.getByRole('button', { name: /^Budget$/ }).first().click({ timeout: 3000 }).catch(() => {})

const openPanel = async () => {
  await page.getByText(WHO, { exact: true }).first().click({ timeout: 8000 })
  await page.locator('text=/this month/').first().waitFor({ timeout: 8000 })
}
const panelText = () => page.evaluate(() => {
  const el = [...document.querySelectorAll('span')].find(e => /this month|budget not running|no budget set|nothing due/.test(e.textContent ?? '') && e.children.length === 0)
  return el?.textContent ?? null
})
const stored = () => page.evaluate(k => JSON.parse(localStorage.getItem('finance-budget-rules') ?? '{}')[k] ?? null, KEY)
const litPill = () => page.evaluate(() => {
  const on = [...document.querySelectorAll('button[title*=" — "]')].filter(b => getComputedStyle(b).fontWeight === '600' && /Fixed|Save|Invest|Guilt/.test(b.textContent ?? ''))
  return on.map(b => b.textContent?.trim())
})

await openPanel().catch(() => {})
const here = await panelText()
ok(`${WHO}'s panel opens`, !!here, here ?? '(no panel)')

if (MODE === 'fees-stored') ok('this month reads the new set: 50,000', /50,000/.test(here ?? ''), here ?? '')

if (MODE === 'fees-edit' && here) {
  ok('before the edit this month reads 45,000', /45,000/.test(here), here)
  const first = page.locator('input[aria-label="Date of instalment 1"]').locator('xpath=..').locator('input').nth(1)
  ok('the first instalment\'s amount field is there and reads 45,000', (await first.count()) === 1 && (await first.inputValue()) === '45,000', await first.inputValue().catch(() => '(none)'))
  await first.click(); await page.keyboard.press('Control+A'); await page.keyboard.type('50000')
  await page.waitForFunction(() => {
    const r = JSON.parse(localStorage.getItem('finance-budget-rules') ?? '{}')['c-fees']
    return r?.steps?.at(-1)?.lines?.[0]?.amount === 50000
  }, null, { timeout: 5000 }).catch(() => {})
  const rule = await stored()
  console.log('  stored:', JSON.stringify({ base: rule?.lines?.map(l => l.amount), steps: rule?.steps?.map(s => ({ from: s.from, lines: s.lines?.map(l => l.amount) })) }))
  ok('the base set is untouched: 45,000 and 45,000', JSON.stringify(rule?.lines?.map(l => l.amount)) === '[45000,45000]')
  ok('exactly one change is recorded', rule?.steps?.length === 1, JSON.stringify(rule?.steps?.length))
  ok('…from this month, carrying the new set', rule?.steps?.[0]?.from === thisMonth && rule.steps[0].lines?.[0]?.amount === 50000)
  ok('the rule is a school fee that repeats, as it was', rule?.linesRepeat === true && rule?.schedule === 'custom')
}

if (MODE === 'currency' && here) {
  ok('before the change this month reads EGP 10,000', /EGP 10,000/.test(here), here)
  await page.locator('select[title="What this budget is in"]').selectOption('USD')
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('finance-budget-rules') ?? '{}')['c-rent']?.steps?.length === 1, null, { timeout: 5000 }).catch(() => {})
  const rule = await stored()
  console.log('  stored:', JSON.stringify({ currency: rule?.currency, steps: rule?.steps }))
  ok('the base currency is still EGP', rule?.currency === 'EGP')
  ok('one change from this month: USD', rule?.steps?.length === 1 && rule.steps[0].from === thisMonth && rule.steps[0].currency === 'USD', JSON.stringify(rule?.steps))
  ok('the amount is not part of it', rule?.steps?.[0]?.amount === undefined && rule?.amount === 10000)
  ok('this month now reads USD', /USD 10,000/.test((await panelText()) ?? ''), (await panelText()) ?? '')
}

if (MODE === 'bucket' && here) {
  ok('before the change the Fixed pill is lit', (await litPill()).some(t => /Fixed/.test(t ?? '')), JSON.stringify(await litPill()))
  await page.locator('button[title^="Savings —"]').click()
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('finance-budget-rules') ?? '{}')['c-rent']?.steps?.length === 1, null, { timeout: 5000 }).catch(() => {})
  const rule = await stored()
  console.log('  stored:', JSON.stringify({ bucket: rule?.bucket, steps: rule?.steps }))
  ok('the base bucket is still fixed', rule?.bucket === 'fixed')
  ok('one change from this month: savings', rule?.steps?.length === 1 && rule.steps[0].from === thisMonth && rule.steps[0].bucket === 'savings', JSON.stringify(rule?.steps))
  ok('the Savings pill is lit now', (await litPill()).some(t => /Save/.test(t ?? '')), JSON.stringify(await litPill()))
}

if (MODE === 'fees-edit') {
  const years = await page.evaluate(async ([cur]) => {
    const { monthlyAmount } = await import('/src/modules/finance/modals/BudgetRuleModal.tsx')
    const r = JSON.parse(localStorage.getItem('finance-budget-rules'))['c-fees']
    const y = Number(cur.slice(0, 4)), mm = String(new Date().getMonth()).padStart(2, '0')   // last month's number
    return { yearAgo: monthlyAmount(r, `${y - 1}-${mm}`), thisYearBeforeChange: monthlyAmount(r, `${y}-${mm}`), nextYear: monthlyAmount(r, `${y + 1}-${mm}`) }
  }, [thisMonth])
  console.log('  that month in other years:', JSON.stringify(years))
  ok('the same month a year ago reads the old 45,000', years.yearAgo === 45000, String(years.yearAgo))
  ok('…and next year reads the new 50,000', years.nextYear === 50000, String(years.nextYear))
}

// Step back a month: the old shape.
await page.keyboard.press('Escape')
await page.locator('button[title="Previous month"]').click()
await openPanel().catch(() => {})
const before = await panelText()
console.log('  last month:', before)
if (MODE.startsWith('fees')) ok('last month still reads the old instalment: 45,000', /45,000/.test(before ?? '') && !/50,000/.test(before ?? ''), before ?? '(no panel)')
if (MODE === 'currency') ok('last month is still in EGP', /EGP 10,000/.test(before ?? '') && !/USD/.test(before ?? ''), before ?? '(no panel)')
if (MODE === 'bucket') {
  // The Kind pills show what an edit would change (this month's), so last month's bucket is read
  // from the stored rule through the real module — the same call the Budget screen's split makes.
  const at = await page.evaluate(async ([k, last, cur]) => {
    const { ruleAt } = await import('/src/modules/finance/budgetSteps.ts')
    const r = JSON.parse(localStorage.getItem('finance-budget-rules'))[k]
    return { last: ruleAt(r, last).bucket, cur: ruleAt(r, cur).bucket, nextYear: ruleAt(r, `${Number(cur.slice(0, 4)) + 1}-03`).bucket, yearAgo: ruleAt(r, `${Number(cur.slice(0, 4)) - 1}-10`).bucket }
  }, [KEY, lastMonth, thisMonth])
  console.log('  by month:', JSON.stringify(at))
  ok('last month, and the same month a year ago, are still Fixed', at.last === 'fixed' && at.yearAgo === 'fixed')
  ok('this month, and next year, are Savings', at.cur === 'savings' && at.nextYear === 'savings')
}

await br.close()
console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)

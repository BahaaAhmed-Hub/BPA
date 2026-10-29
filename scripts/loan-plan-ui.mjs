#!/usr/bin/env node
/**
 * loan-plan-ui — a payment plan is the loan's budget line, and its instalments are repayments
 *
 *   npx vite --port 5199 --strictPort
 *   node scripts/loan-plan-ui.mjs [5199] [borrow|edit|envelope]
 *
 *   borrow    — Add → Borrowed → "Ahmed", 10,000, "Set a payment plan", 2,000 monthly from today.
 *               The form says what the plan comes to (5 payments). On save the server receives, in
 *               this order, the lender's account, the "Loan repayments" parent and Ahmed's category
 *               (whose id IS the lender's id), and the borrowing; the rule is at rules[lenderId]; and
 *               the budget writer files the instalments as unpaid TRANSFERS from CIB into the lender,
 *               under that category. The Budget screen shows the line. Control: nothing is written
 *               for a lender borrowed from with the plan left off.
 *   edit      — a lender who already has a plan (account, category, rule, two unpaid instalments).
 *               The account window opens with the plan filled in. Raising it to 2,500 replaces the
 *               unpaid instalments; unticking it removes the rule and the instalments.
 *   envelope  — a repayment already paid, filed under the lender's category, counts as spent in its
 *               envelope; a plain transfer between two accounts does not (control).
 * The stub keeps what it is sent, in order, and refuses a transaction whose account is not there.
 */
import { chromium } from 'playwright-core'
import { session } from './session.mjs'
import { settled, watchTraffic } from './settled.mjs'

const args = process.argv.slice(2)
const port = args.find(a => /^\d+$/.test(a)) ?? '5199'
const MODES = ['borrow', 'edit', 'envelope', 'goals', 'payback', 'separate', 'settle', 'goal']
const MODE = args.find(a => MODES.includes(a)) ?? 'borrow'
// The fixtures that are a loan with a plan, owed from before and with cash behind the account.
const PAY = ['payback', 'separate', 'settle', 'goal'].includes(MODE)
const WITH_PLAN = ['edit', 'goals'].includes(MODE) || PAY
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
let failed = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) failed++ }

const pad = n => String(n).padStart(2, '0')
const now = new Date()
if (now.getMonth() === 0) { console.log('Run this outside January: the fixture borrows "last month", which would be another year.'); process.exit(2) }
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const today = iso(now)
/** The same day, k months on, a short month taking its last day. */
const plusMonths = k => {
  const last = new Date(now.getFullYear(), now.getMonth() + k + 1, 0).getDate()
  return iso(new Date(now.getFullYear(), now.getMonth() + k, Math.min(now.getDate(), last)))
}
// What the writer files: this day and the next three months, inside the loaded year.
const expectedDates = [0, 1, 2, 3].map(plusMonths).filter(d => d.startsWith(String(now.getFullYear())))

const U = session.user.id, T0 = '2026-01-01T00:00:00.000Z'
const acc = (o) => ({ user_id: U, bank: '', balance: 0, emoji: '💵', color: '#0C8140', sort_order: 0, is_active: true, created_at: T0, ...o })
const LOAN = 'aaaaaaaa-0000-4000-8000-000000000001'
const PARENT = 'bbbbbbbb-0000-4000-8000-000000000001'
const cat = (o) => ({ user_id: U, icon: 'lucide:HandCoins', color: '#7C7565', tx_type: 'expense', sort_order: 0, is_system: true, created_at: T0, parent_id: null, ...o })
const txRow = (o) => ({ user_id: U, account_id: 'a1', to_account_id: null, category_id: null, amount: 100, currency: 'EGP', tx_type: 'expense',
  payee: 'x', date: today, paid_at: today, note: null, is_cleared: true, is_recurring: false, tags: [], attachments: [], created_at: T0, ...o })
const planRule = (amount = 2000) => ({
  schedule: 'repeat', amount, frequency: 'monthly', rollover: false, warn80: false, bucket: 'fixed', currency: 'EGP',
  starts: today.slice(0, 7), dueDay: now.getDate(), dueAccountId: 'a1',
})

const DB = {
  finance_accounts: [
    acc({ id: 'a1', name: 'CIB', account_type: 'payment', currency: 'EGP', balance: PAY ? 20000 : 0 }),
    ...(MODE === 'borrow' ? [] : [acc({ id: LOAN, name: 'Ahmed', account_type: 'loan', currency: 'EGP', emoji: '🤝', sort_order: 1,
      // goals: owed from before, with no cash held — so nothing can finish it today and the plan is what pays it.
      balance: MODE === 'goals' || PAY ? (MODE === 'settle' ? -2000 : -10000) : 0 })]),
  ],
  finance_categories: [
    cat({ id: 'c1', name: 'Food', icon: 'lucide:Utensils', is_system: false }),
    ...(MODE === 'borrow' ? [] : [
      cat({ id: PARENT, name: 'Loan repayments' }),
      cat({ id: LOAN, name: 'Ahmed', parent_id: PARENT }),
    ]),
  ],
  finance_transactions: MODE === 'borrow' ? [] : WITH_PLAN ? [
    ...(MODE === 'edit' ? [txRow({ id: 'b0', account_id: LOAN, to_account_id: 'a1', amount: 10000, payee: 'Borrowed from Ahmed', tx_type: 'transfer', date: plusMonths(-1), paid_at: plusMonths(-1) })] : []),
    ...expectedDates.slice(0, 2).map((d, i) => txRow({ id: `plan${i}`, account_id: 'a1', to_account_id: LOAN, category_id: LOAN, amount: 2000, payee: 'Payment to Ahmed',
      tx_type: 'transfer', date: d, paid_at: null, is_cleared: false, is_recurring: true, tags: ['budget'] })),
  ] : [
    txRow({ id: 'b0', account_id: LOAN, to_account_id: 'a1', amount: 10000, payee: 'Borrowed from Ahmed', tx_type: 'transfer', date: plusMonths(-1), paid_at: plusMonths(-1) }),
    // Paid back 2,000 under the lender's category — and a plain move between two accounts for contrast.
    txRow({ id: 'r1', account_id: 'a1', to_account_id: LOAN, category_id: LOAN, amount: 2000, payee: 'Paid back Ahmed', tx_type: 'transfer', date: today, paid_at: today }),
    txRow({ id: 'm1', account_id: 'a1', to_account_id: 'a2', category_id: null, amount: 700, payee: 'Move', tx_type: 'transfer', date: today, paid_at: today }),
  ],
}
if (MODE === 'envelope') DB.finance_accounts.push(acc({ id: 'a2', name: 'Savings', account_type: 'payment', currency: 'EGP', sort_order: 2 }))
const writes = []   // { table, method, row | id } in the order they arrived

const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctx = await br.newContext({ viewport: { width: 1300, height: 900 }, timezoneId: 'Africa/Cairo', locale: 'en-GB', reducedMotion: 'reduce' })
const TABLES = ['finance_accounts', 'finance_categories', 'finance_transactions']
await ctx.route('**://placeholder.supabase.co/**', async r => {
  const req = r.request(), u = req.url(), m = req.method()
  if (m === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS })
  if (u.includes('/auth/v1/user')) return r.fulfill({ json: session.user, headers: CORS })
  if (u.includes('/auth/v1/token')) return r.fulfill({ json: session, headers: CORS })
  if (u.includes('/rpc/')) return r.fulfill({ json: true, headers: CORS })
  const t = /\/rest\/v1\/([a-z_]+)/.exec(u)?.[1]
  if (t && TABLES.includes(t) && m === 'DELETE') {
    const id = /[?&]id=eq\.([^&]+)/.exec(u)?.[1]
    writes.push({ table: t, method: 'DELETE', id })
    DB[t] = DB[t].filter(x => x.id !== id)
    return r.fulfill({ status: 204, headers: CORS })
  }
  if (t && TABLES.includes(t) && (m === 'POST' || m === 'PATCH')) {
    const body = JSON.parse(req.postData() ?? 'null')
    for (const row of [].concat(body ?? [])) {
      // A fixture that cannot refuse proves nothing: a transaction naming an
      // account the server has not got is refused, as the foreign key does.
      if (t === 'finance_transactions') {
        for (const k of ['account_id', 'to_account_id']) {
          if (row[k] && !DB.finance_accounts.some(a => a.id === row[k])) {
            writes.push({ table: t, method: m, row, refused: true })
            return r.fulfill({ status: 409, json: { code: '23503', message: 'violates foreign key constraint' }, headers: CORS })
          }
        }
      }
      writes.push({ table: t, method: m, row })
      const list = DB[t], i = list.findIndex(x => x.id === row.id)
      if (i >= 0) list[i] = { ...list[i], ...row }; else list.push({ is_active: true, ...row })
    }
    return r.fulfill({ status: 201, json: [], headers: CORS })
  }
  return r.fulfill({ json: (t && DB[t]) || [], headers: CORS })
})
await ctx.route('**://*.googleapis.com/**', r => r.fulfill({ json: { items: [], threads: [], labels: [] }, headers: CORS }))
const page = await ctx.newPage()
page.on('pageerror', e => { console.log('  [pageerror]', String(e).slice(0, 200)); failed++ })
await page.addInitScript(([s, rules]) => {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('google_provider_token', 'tok')
  localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'finance', themeId: 'sunlit-bento' }, version: 0 }))
  localStorage.setItem('finance-fx-rates', JSON.stringify({ USD: 48 }))
  localStorage.setItem('bpa-wizard-done', '1')   // the stub account is brand new; the setup guide would cover the screen
  if (rules) localStorage.setItem('finance-budget-rules', JSON.stringify(rules))
}, [session, MODE === 'borrow' ? null : { [LOAN]: planRule() }])
const traffic = watchTraffic(page)
await page.goto(`http://localhost:${port}/BPA/`, { waitUntil: 'domcontentloaded' })
await settled(page, traffic, 9000)

const until = async (cond, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (cond()) return true; await new Promise(r => setTimeout(r, 50)) } return cond() }
const tab = name => page.locator('nav[aria-label="Finance sections"]').getByRole('button', { name, exact: true }).click()
const text = () => page.evaluate(() => document.body.innerText)
const rules = () => page.evaluate(() => JSON.parse(localStorage.getItem('finance-budget-rules') ?? '{}'))
const planned = () => writes.filter(w => w.table === 'finance_transactions' && w.method !== 'DELETE' && (w.row.tags ?? []).includes('budget'))

if (MODE === 'borrow') {
  await tab('Balance')
  await page.getByTitle('Add one entry').click()
  await page.getByRole('button', { name: 'Borrowed', exact: true }).click()
  await page.getByLabel('Who lent it').fill('Ahmed')
  await page.getByPlaceholder('0').first().fill('10000')

  ok('the plan is offered, and off', (await page.getByRole('checkbox').first().getAttribute('aria-checked')) === 'false')
  await page.getByRole('checkbox').first().click()
  ok('ticking it asks how, how often and from where', (await page.getByText('Each', { exact: true }).count()) > 0 && await page.getByLabel('First payment').count() === 1)
  const save = page.getByRole('button', { name: 'Add transaction' })
  ok('a plan with no amount cannot be saved', await save.isDisabled())
  await page.getByLabel('Each payment').fill('2000')
  ok('…and with one it can', await save.isEnabled())
  const summary = await page.locator('[data-plan-summary]').innerText()
  ok('the form says what it comes to: 5 payments', /5 payments/.test(summary), summary)
  await page.getByLabel('First payment').fill(today)

  await save.click()
  await until(() => planned().length >= expectedDates.length)

  const iLoan = writes.findIndex(w => w.table === 'finance_accounts' && w.row?.name === 'Ahmed')
  const iPar = writes.findIndex(w => w.table === 'finance_categories' && w.row?.name === 'Loan repayments')
  const iKid = writes.findIndex(w => w.table === 'finance_categories' && w.row?.name === 'Ahmed')
  const iBorrow = writes.findIndex(w => w.table === 'finance_transactions' && !(w.row.tags ?? []).includes('budget'))
  const loanId = writes[iLoan]?.row.id
  ok('the lender, then its category, then the borrowing, in that order', iLoan >= 0 && iKid > iLoan && iBorrow > iKid, `account ${iLoan}, category ${iKid}, borrowing ${iBorrow}`)
  ok('the parent "Loan repayments" is a system category', writes[iPar]?.row.is_system === true && writes[iPar]?.row.parent_id == null, JSON.stringify(writes[iPar]?.row))
  ok('…and Ahmed\'s category has the LENDER\'S id and hangs under it', writes[iKid]?.row.id === loanId && writes[iKid]?.row.parent_id === writes[iPar]?.row.id)
  const rule = (await rules())[loanId]
  ok('the plan is the lender\'s budget rule', rule?.amount === 2000 && rule?.frequency === 'monthly' && rule?.bucket === 'fixed' && rule?.dueDay === now.getDate() && rule?.dueAccountId === 'a1',
    JSON.stringify(rule))
  ok('the server refused nothing', !writes.some(w => w.refused))

  const inst = planned().map(w => w.row)
  ok('the budget filed the instalments (positive: there are some)', inst.length === expectedDates.length && inst.length > 0, `${inst.length} of ${expectedDates.length}`)
  ok('…on the plan\'s dates', JSON.stringify(inst.map(r => r.date).sort()) === JSON.stringify(expectedDates), inst.map(r => r.date).join(','))
  ok('…each a transfer from CIB into the lender, under its category', inst.every(r => r.tx_type === 'transfer' && r.account_id === 'a1' && r.to_account_id === loanId && r.category_id === loanId),
    JSON.stringify(inst[0] && [inst[0].tx_type, inst[0].account_id, inst[0].to_account_id, inst[0].category_id]))
  ok('…of 2,000, unpaid, so out of every balance until paid', inst.every(r => r.amount === 2000 && !r.paid_at && r.is_cleared === false))

  await tab('Budget')
  await page.getByText('Loan repayments').first().waitFor({ timeout: 6000 }).catch(() => {})
  const budget = await text()
  ok('the Budget has the "Loan repayments" heading over Ahmed\'s line: nothing spent, 2,000 planned', /Loan repayments\s+0\s+2,000\s+Ahmed/.test(budget), budget.match(/Loan repayments[\s\S]{0,40}/)?.[0])
  ok('…as a fixed cost, which is the whole of this month\'s budget', /Fixed costs\s+100%/.test(budget) && /Expenses\s+0\s+of EGP 2,000/.test(budget))
  if (process.env.PEEK) console.log(JSON.stringify(budget.slice(budget.indexOf('Loan repayments') - 200, budget.indexOf('Loan repayments') + 600)))
}

if (MODE === 'edit') {
  const instalments = () => DB.finance_transactions.filter(t => (t.tags ?? []).includes('budget'))
  // The two seeded, and the writer has filled in the rest of the plan's months on boot.
  ok('start: the seeded instalments are there, unpaid, 2,000 (positive: the fixture has them)', ['plan0', 'plan1'].every(id => DB.finance_transactions.find(t => t.id === id)?.amount === 2000) && instalments().every(t => !t.paid_at))
  await tab('Balance')
  await page.getByTitle('Edit Ahmed').click()
  const each = page.getByLabel('Each payment')
  await each.waitFor()
  ok('the account window opens with the plan filled in', (await page.getByRole('checkbox').first().getAttribute('aria-checked')) === 'true' && (await each.inputValue()) === '2,000')
  await each.fill('2500')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await until(() => instalments().length > 0 && instalments().every(t => t.amount === 2500))
  const rule = (await rules())[LOAN]
  ok('the old amount is kept and the raise is a step from this month', rule?.amount === 2000 && rule?.steps?.length === 1 && rule.steps[0].amount === 2500 && rule.steps[0].from === today.slice(0, 7), JSON.stringify([rule?.amount, rule?.steps]))
  ok('the unpaid instalments it had written were removed', writes.some(w => w.table === 'finance_transactions' && w.method === 'DELETE' && w.id === 'plan0') && writes.some(w => w.id === 'plan1'))
  ok('…and written again at 2,500 on the plan\'s dates', JSON.stringify(instalments().map(t => t.date).sort()) === JSON.stringify(expectedDates), instalments().map(t => `${t.date}:${t.amount}`).join(' '))
  ok('the server refused nothing', !writes.some(w => w.refused))

  // Take the plan away.
  await page.getByTitle('Edit Ahmed').click()
  const box = page.getByRole('checkbox').first()
  await box.waitFor()
  ok('it reopens with the new amount', (await each.inputValue()) === '2,500')
  await box.click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await until(() => instalments().length === 0)
  ok('unticked: the rule is gone', (await rules())[LOAN] === undefined)
  ok('…and so are the unpaid instalments (positive: there were some)', instalments().length === 0 && writes.filter(w => w.method === 'DELETE' && w.table === 'finance_transactions').length >= 4)
  ok('…and with nothing ever paid under it, the lender\'s category and the empty parent', writes.some(w => w.table === 'finance_categories' && w.method === 'DELETE' && w.id === LOAN) && writes.some(w => w.table === 'finance_categories' && w.method === 'DELETE' && w.id === PARENT))
  ok('the lender and its borrowing are untouched', DB.finance_accounts.some(a => a.id === LOAN) && DB.finance_transactions.some(t => t.id === 'b0'))
}

if (MODE === 'envelope') {
  await tab('Budget')
  await page.getByText('Loan repayments').first().waitFor({ timeout: 6000 }).catch(() => {})
  const budget = await text()
  ok('the repayment paid under Ahmed\'s category is spent from its envelope: 2,000 of 2,000', /Loan repayments\s+2,000\s+2,000\s+Ahmed/.test(budget), budget.match(/Loan repayments[\s\S]{0,40}/)?.[0])
  ok('control — the plain 700 moved between two accounts is in no envelope', !/2,700|\b700\b/.test(budget.slice(budget.indexOf('SPENDING'), budget.indexOf('EARNING'))))
  ok('and it is spending for the month on screen: 2,000 of 2,000', /Expenses\s+2,000\s+of EGP 2,000/.test(budget), budget.match(/Expenses[\s\S]{0,40}/)?.[0])
}

if (MODE === 'goals') {
  await tab('Goals')
  await page.getByText('Repay Ahmed').first().waitFor({ timeout: 8000 }).catch(() => {})
  const goals = await text()
  if (process.env.PEEK) console.log(JSON.stringify(goals.slice(goals.indexOf('Repay Ahmed') - 300, goals.indexOf('Repay Ahmed') + 900)))
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const at = k => { const d = new Date(now.getFullYear(), now.getMonth() + k, 1); return `${MON[d.getMonth()]} ${d.getFullYear()}` }
  ok('Goals offers "Repay Ahmed" (positive: the screen opened on it)', /Repay Ahmed/.test(goals))
  ok('…and says how it is being paid', new RegExp(`loan · 2,000 EGP every month, from ${now.getDate()} ${MON[now.getMonth()]} ${now.getFullYear()}`).test(goals))
  ok('it cannot be finished today: there is no cash to do it with', !/Can finish today/.test(goals))
  ok('the summary no longer says nothing lands on a date of its own — a loan\'s instalments do', !/nothing in the next year lands on a date of its own/.test(goals) && /of the next year lands on dates of its own/.test(goals), goals.match(/forecast rules applied[^\n]*/)?.[0])
  ok('it asks for what is left once the instalment already filed for today is paid: 8,000 of the 10,000 owed', /STILL OWED\s+EGP 8,000/.test(goals), goals.match(/STILL OWED[\s\S]{0,30}/)?.[0])
  ok('the plan funds it: EGP 2,000 each month', /THEN EACH MONTH\s+EGP 2,000/.test(goals), goals.match(/THEN EACH MONTH[\s\S]{0,30}/)?.[0])
  ok(`…and it lands on the plan's date, four payments on: ${at(4)}`, new RegExp(`there in ${at(4)}`).test(goals), goals.match(/there in [A-Za-z]+ \d+/)?.[0])
  // The rule that does it is one of the forecast's, visible and switchable.
  const closed = await text()
  ok('control — before pressing it the rule is not on screen (the card is folded)', !/payment plan is paid first, on its dates/.test(closed))
  await page.getByText('See the rules').first().click()
  await page.waitForTimeout(300)
  const withRules = await text()
  if (process.env.PEEK) console.log(JSON.stringify(withRules.slice(withRules.indexOf('forecast rules') - 100, withRules.indexOf('forecast rules') + 700)))
  ok('the forecast lists it as a rule: a loan\'s payment plan is paid first', /payment plan is paid first, on its dates/.test(withRules))
}

if (PAY) {
  const payBtn = page.getByRole('button', { name: 'Pay back', exact: true })
  // exact: a substring match finds a goal field whose placeholder is "8,000"
  const amountIn = () => page.getByPlaceholder('0', { exact: true }).first()
  const asyncUntil = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 80)) } return fn() }
  const day = new Date(today + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const paidInto = () => DB.finance_transactions.filter(t => t.to_account_id === LOAN && t.paid_at)

  if (MODE === 'goal') {
    await tab('Goals')
    await page.getByText('Repay Ahmed').first().waitFor({ timeout: 8000 })
    ok('the goal offers Pay back (positive: there is one)', await payBtn.count() === 1)
    await payBtn.click()
  } else {
    await tab('Balance')
    await payBtn.first().waitFor({ timeout: 8000 })
    ok('the lender\'s row offers Pay back (positive: one button)', await payBtn.count() === 1)
    ok('control — no Settle: that is a card\'s button', await page.getByRole('button', { name: 'Settle', exact: true }).count() === 0)
    await payBtn.click()
  }

  await amountIn().waitFor()
  const expected = MODE === 'settle' ? '2,000' : '2,000'
  ok(`it opens with the instalment already in it: ${expected}`, (await amountIn().inputValue()) === expected, await amountIn().inputValue())
  const owedText = MODE === 'settle' ? 'EGP 2,000' : 'EGP 10,000'
  const lender = await page.locator('[data-paying-lender]').innerText()
  ok(`it says who, and what is still owed: ${owedText}`, /Paying Ahmed back/.test(lender) && lender.includes(owedText), lender.replace(/\n/g, ' | '))
  const settles = await page.locator('[data-settles]').innerText().catch(() => '')
  ok(`it says it is the instalment due ${day}, and will be marked paid`, settles.includes(day) && /marked paid/.test(settles), settles)

  if (MODE === 'separate') {
    await page.getByRole('button', { name: 'Record it separately' }).click()
    ok('"Record it separately" takes the claim back and says so', (await page.locator('[data-settles]').count()) === 0 && /Recorded on its own/.test(await page.locator('[data-paying-lender]').innerText()))
  }

  await page.getByRole('button', { name: 'Add transaction' }).click()
  await asyncUntil(() => paidInto().length > 0)
  const before = paidInto()

  if (MODE === 'separate') {
    ok('a new entry was made, not the instalment', before.length === 1 && before[0].id !== 'plan0', before.map(t => t.id).join(','))
    ok('…filed under the loan\'s category so its envelope sees it', before[0].category_id === LOAN)
    ok('the plan\'s instalment is still waiting, unpaid', DB.finance_transactions.find(t => t.id === 'plan0')?.paid_at == null)
  } else {
    const row = DB.finance_transactions.find(t => t.id === 'plan0')
    ok('the instalment itself was settled: paid today, 2,000, still the budget\'s and under the loan\'s category',
      row?.paid_at === today && row.amount === 2000 && (row.tags ?? []).includes('budget') && row.category_id === LOAN, JSON.stringify(row && [row.paid_at, row.amount, row.tags, row.category_id]))
    ok('and it is the only payment: no second entry beside it', before.length === 1 && before[0].id === 'plan0', before.map(t => t.id).join(','))
    ok('the due day it was written for is kept', row?.date === today)
  }
  ok('the server refused nothing', !writes.some(w => w.refused))

  if (MODE === 'settle') {
    // The last of the debt: it is paid back, so its plan goes and what was paid stays.
    ok('the plan is retired: its rule is gone', await asyncUntil(async () => (await rules())[LOAN] === undefined))
    ok('…and so are the instalments still waiting', await asyncUntil(() => DB.finance_transactions.filter(t => (t.tags ?? []).includes('budget') && !t.paid_at && t.to_account_id === LOAN).length === 0))
    ok('what was paid stays, and with it the category it was paid under', paidInto().length === 1 && !writes.some(w => w.table === 'finance_categories' && w.method === 'DELETE' && w.id === LOAN))
    await tab('Balance')
    ok('the loan folds away as paid back', await asyncUntil(async () => /Show 1 paid back/.test(await text())))
  } else {
    await tab('Balance')
    const owed = MODE === 'goal' || MODE === 'payback' || MODE === 'separate' ? '(EGP 8,000)' : ''
    ok(`Ahmed is owed 2,000 less: ${owed}`, await asyncUntil(async () => (await text()).includes(owed)))
    ok('…and CIB holds 2,000 less: 18,000', /CIB[\s\S]{0,120}EGP 18,000/.test(await text()))
    if (MODE === 'payback') {
      await tab('Budget')
      await page.getByText('Loan repayments').first().waitFor({ timeout: 6000 }).catch(() => {})
      ok('the loan\'s envelope holds it: 2,000 spent', /Loan repayments\s+2,000/.test(await text()), (await text()).match(/Loan repayments[\s\S]{0,30}/)?.[0])
    }
  }
}

await br.close()
console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)

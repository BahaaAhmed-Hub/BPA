#!/usr/bin/env node
/**
 * loans-ui — borrowing is cash in and debt out, and the screens say so
 *
 *   npx vite --port 5199 --strictPort
 *   node scripts/loans-ui.mjs [5199] [new|rate|norate|existing]
 *
 *   new       — no lender yet. Add → Borrowed → "Ahmed", 10,000 into CIB. The lender's
 *               account is written to the server BEFORE the entry that names it (a foreign
 *               key), as a `loan`; the entry is a transfer out of it with no category. Balances
 *               gains BORROWED & LOANS OWED with Ahmed at (10,000); the feed marks the row Borrowed and its
 *               amount is neither the positive nor the negative colour, on either account's side.
 *               Today shows a Borrowed chip and leaves In at nothing. Goals offers "Repay Ahmed".
 *   rate      — a USD lender (Omar) and an EGP account, USD at 48: 500 USD shows "24,000 arrives"
 *               with the rate, and the entry saves.
 *   norate    — the same with no rate for USD: the form says so and Save is disabled
 *               (control: `rate` is the same fixture with the rate, and it saves).
 *   existing  — an existing lender is offered; a lender is not offered as an account to spend from
 *               (Expense) but is for a Transfer. Control: CIB is offered in both.
 * The stub keeps what it is sent, in order, and can refuse a transaction whose account is not there.
 */
import { chromium } from 'playwright-core'
import { session } from './session.mjs'
import { settled, watchTraffic } from './settled.mjs'

const args = process.argv.slice(2)
const port = args.find(a => /^\d+$/.test(a)) ?? '5199'
const MODE = args.find(a => ['new', 'rate', 'norate', 'existing'].includes(a)) ?? 'new'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
let failed = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) failed++ }

const U = session.user.id, T0 = '2026-01-01T00:00:00.000Z'
const acc = (o) => ({ user_id: U, bank: '', balance: 0, emoji: '💵', color: '#0C8140', sort_order: 0, is_active: true, created_at: T0, ...o })
const DB = {
  finance_accounts: [
    acc({ id: 'a1', name: 'CIB', account_type: 'payment', currency: 'EGP' }),
    ...(MODE === 'rate' || MODE === 'norate' || MODE === 'existing'
      ? [acc({ id: 'omar', name: 'Omar', account_type: 'loan', currency: 'USD', emoji: '🤝', sort_order: 1 })] : []),
  ],
  finance_categories: [{ id: 'c1', user_id: U, name: 'Food', icon: 'lucide:Utensils', color: '#0C8140', tx_type: 'expense', sort_order: 0, is_system: false, created_at: T0, parent_id: null }],
  finance_transactions: [],
}
const writes = []   // { table, row } in the order they arrived

const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctx = await br.newContext({ viewport: { width: 1300, height: 900 }, timezoneId: 'Africa/Cairo', locale: 'en-GB', reducedMotion: 'reduce' })
await ctx.route('**://placeholder.supabase.co/**', async r => {
  const req = r.request(), u = req.url(), m = req.method()
  if (m === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS })
  if (u.includes('/auth/v1/user')) return r.fulfill({ json: session.user, headers: CORS })
  if (u.includes('/auth/v1/token')) return r.fulfill({ json: session, headers: CORS })
  if (u.includes('/rpc/')) return r.fulfill({ json: true, headers: CORS })
  const t = /\/rest\/v1\/([a-z_]+)/.exec(u)?.[1]
  if (t && (t === 'finance_accounts' || t === 'finance_transactions') && (m === 'POST' || m === 'PATCH')) {
    const body = JSON.parse(req.postData() ?? 'null')
    for (const row of [].concat(body ?? [])) {
      // A fixture that cannot refuse proves nothing: a transaction naming an
      // account the server has not got is refused, as the foreign key does.
      if (t === 'finance_transactions' && row.account_id && !DB.finance_accounts.some(a => a.id === row.account_id)) {
        writes.push({ table: t, row, refused: true })
        return r.fulfill({ status: 409, json: { code: '23503', message: 'violates foreign key constraint' }, headers: CORS })
      }
      writes.push({ table: t, row })
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
await page.addInitScript(([s, rates]) => {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('google_provider_token', 'tok')
  localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'finance', themeId: 'sunlit-bento' }, version: 0 }))
  localStorage.setItem('finance-fx-rates', JSON.stringify(rates))
  localStorage.setItem('bpa-wizard-done', '1')   // the stub account is brand new; the setup guide would cover the screen
}, [session, MODE === 'norate' ? {} : { USD: 48 }])
const traffic = watchTraffic(page)
await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' })
await settled(page, traffic, 9000)

// The finance tabs, not the app's side rail, which has a Today of its own.
const tab = name => page.locator('nav[aria-label="Finance sections"]').getByRole('button', { name, exact: true }).click()
const openAdd = async () => { await page.getByTitle('Add one entry').click(); await page.getByRole('button', { name: 'Borrowed', exact: true }).waitFor() }
const pickFrom = async (placeholderOrLabel, option) => {
  await page.getByRole('button', { name: placeholderOrLabel }).first().click()
  await page.getByRole('button', { name: option }).last().click()
}
const text = () => page.evaluate(() => document.body.innerText)
// Writes are asynchronous: wait for the one being asserted on, with a ceiling.
const until = async (cond, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (cond()) return true; await new Promise(r => setTimeout(r, 50)) } return cond() }
const colourOf = (cssVar) => page.evaluate(v => {
  const p = document.createElement('i'); p.style.color = `var(${v})`; document.body.appendChild(p)
  const c = getComputedStyle(p).color; p.remove(); return c
}, cssVar)

await tab('Balance')

if (MODE === 'new') {
  const before = await text()
  ok('Balances is open (positive: the payment group is there)', /PAYMENT ACCOUNTS/.test(before))
  ok('…and there is no loans group before anything is borrowed', !/BORROWED & LOANS OWED/.test(before))

  await openAdd()
  await page.getByRole('button', { name: 'Borrowed', exact: true }).click()
  ok('Borrowed is the selected kind', (await page.getByRole('button', { name: 'Borrowed', exact: true }).getAttribute('aria-pressed')) === 'true')
  ok('nobody makes a lender by hand: the form reads it from the description', await page.locator('[data-lender-auto]').isVisible())
  ok('…and with nothing written says what it will be called', /“Borrowed money”/.test(await page.locator('[data-lender-auto]').innerText()))
  ok('there is no Category row — a borrowing is not spending', !(await page.getByText('Category', { exact: true }).isVisible().catch(() => false)))
  const save = page.getByRole('button', { name: 'Add transaction' })
  ok('nothing is savable yet (no amount)', await save.isDisabled())
  await page.getByPlaceholder('anything', { exact: false }).or(page.getByPlaceholder('e.g. borrowed from Ahmed')).first().fill('borrowed from Ahmed for the deposit')
  ok('the name is read from the description', /“Ahmed”/.test(await page.locator('[data-lender-auto]').innerText()), await page.locator('[data-lender-auto]').innerText())
  await page.getByPlaceholder('0').fill('10000')
  ok('an amount is all it needs', await save.isEnabled())
  await save.click()
  await page.getByText('BORROWED & LOANS OWED').waitFor({ timeout: 5000 }).catch(() => {})
  await until(() => writes.some(w => w.table === 'finance_transactions'))

  const iAcc = writes.findIndex(w => w.table === 'finance_accounts' && w.row.name === 'Ahmed')
  const iTx  = writes.findIndex(w => w.table === 'finance_transactions')
  const loanRow = writes[iAcc]?.row, txRow = writes[iTx]?.row
  ok('the lender was written as a loan account', loanRow?.account_type === 'loan' && loanRow?.currency === 'EGP' && loanRow?.balance === 0, JSON.stringify(loanRow))
  ok('…and BEFORE the entry that names it', iAcc >= 0 && iTx > iAcc, `account at ${iAcc}, entry at ${iTx}`)
  ok('the server refused nothing', !writes.some(w => w.refused))
  ok('the entry is a transfer out of the lender into CIB', txRow?.tx_type === 'transfer' && txRow?.account_id === loanRow?.id && txRow?.to_account_id === 'a1', JSON.stringify([txRow?.tx_type, txRow?.account_id, txRow?.to_account_id]))
  ok('…of 10,000, with no category and not income', txRow?.amount === 10000 && !txRow?.category_id, JSON.stringify([txRow?.amount, txRow?.category_id]))
  ok('…named for the lender', /Ahmed/.test(txRow?.payee ?? ''), txRow?.payee)
  ok('the description is kept as the note', /deposit/.test(txRow?.note ?? ''), txRow?.note)

  const after = await text()
  ok('Balances gains the loans group', /BORROWED & LOANS OWED/.test(after))
  const ahmedRow = await page.evaluate(() => [...document.querySelectorAll('[role="button"]')].find(e => /Ahmed/.test(e.textContent ?? '') && !/Borrowed/.test(e.textContent ?? ''))?.textContent ?? null)
  ok('…with Ahmed at (EGP 10,000), owed — read from the account row itself', !!ahmedRow && /\(EGP 10,000\)/.test(ahmedRow), String(ahmedRow))
  ok('CIB holds 10,000', /CIB[\s\S]{0,120}EGP 10,000/.test(after))

  // The feed, and the colour of the amount on both sides of the move.
  const POS = await colourOf('--sb-positive'), NEG = await colourOf('--sb-negative')
  const pill = () => page.evaluate(() => {
    const el = [...document.querySelectorAll('span')].find(s => /10,000/.test(s.textContent ?? '') && s.children.length === 0 && getComputedStyle(s).fontWeight === '700')
    return el ? getComputedStyle(el).color : null
  })
  ok('the feed marks the row Borrowed', /BORROWED|Borrowed/.test(after) && (await page.getByText('Borrowed', { exact: true }).count()) >= 1)
  const c0 = await pill()
  ok('the amount exists to be measured', !!c0)
  ok('…and is neither the green nor the red', c0 !== POS && c0 !== NEG, `${c0} vs ${POS} / ${NEG}`)
  await page.getByText('CIB', { exact: true }).first().click()   // the account it landed in: the move is "in"
  const c1 = await pill()
  ok('seen from the account it landed in, still neither green nor red', !!c1 && c1 !== POS && c1 !== NEG, `${c1}`)

  // Today: shown beside In, never inside it.
  await tab('Today')
  const today = await text()
  ok('Today shows a Borrowed chip', /BORROWED/i.test(today) && /10,000/.test(today))
  const inChip = await page.evaluate(() => {
    const el = [...document.querySelectorAll('span')].find(s => /^In/.test((s.firstChild?.textContent ?? '').trim()) && s.querySelector('b'))
    return el?.querySelector('b')?.textContent ?? null
  })
  ok('…and In stays at nothing (positive: the chip exists)', inChip === '–', String(inChip))

  // The debt becomes a goal.
  await tab('Goals')
  await page.getByText('Repay Ahmed').first().waitFor({ timeout: 5000 }).catch(() => {})
  ok('Goals offers "Repay Ahmed"', (await text()).includes('Repay Ahmed'))

  // The name was made from the description, so it is changed on the row.
  await tab('Balance')
  ok('before: nothing named "Ahmed Ali" has been written', !writes.some(w => w.table === 'finance_accounts' && w.row.name === 'Ahmed Ali'))
  await page.getByRole('button', { name: 'Rename Ahmed', exact: true }).first().click()
  const box = page.getByLabel('Rename Ahmed')
  ok('the pencil opens the name in place', await box.isVisible())
  await box.fill('Ahmed Ali')
  await box.press('Enter')
  await until(() => writes.some(w => w.table === 'finance_accounts' && w.row.name === 'Ahmed Ali'))
  const renamed = writes.find(w => w.table === 'finance_accounts' && w.row.name === 'Ahmed Ali')?.row
  ok('the rename is written to the same lender account', !!renamed && renamed.id === loanRow?.id && renamed.account_type === 'loan', JSON.stringify(renamed))
  ok('the row shows the new name and still owes 10,000', /Ahmed Ali[\s\S]{0,80}\(EGP 10,000\)/.test(await text()))

  // The account window.
  await tab('Balance')
  await page.getByRole('button', { name: /Add account/ }).click()
  await page.locator('select').first().selectOption('loan')
  const modal = await text()
  ok('a Loan account asks for a Lender, not a Name', /Lender/.test(modal))
  ok('…has no Bank and no card digits', !/Last 4 digits/.test(modal) && !/CIB \/ NBE/.test(await page.evaluate(() => [...document.querySelectorAll('input')].map(i => i.placeholder).join('|'))))
}

if (MODE === 'rate' || MODE === 'norate') {
  await openAdd()
  await page.getByRole('button', { name: 'Borrowed', exact: true }).click()
  await pickFrom('From the description', 'Omar')
  await page.getByPlaceholder('0').fill('500')
  const body = await text()
  const save = page.getByRole('button', { name: 'Add transaction' })
  ok('the entry follows the lender into USD', await page.getByText('USD', { exact: true }).first().isVisible())
  if (MODE === 'rate') {
    ok('it says what arrives in CIB: 24,000', /24,000/.test(body) && /arrives in CIB/.test(body), body.match(/.{0,40}arrives in CIB.{0,60}/)?.[0])
    ok('…at the rate it will carry', /1 USD = 48 EGP/.test(body))
    ok('…and saves', await save.isEnabled())
    await save.click()
    await until(() => writes.some(w => w.table === 'finance_transactions'))
    const tx = writes.find(w => w.table === 'finance_transactions')?.row
    ok('the entry is 500 USD out of Omar into CIB', tx?.amount === 500 && tx?.currency === 'USD' && tx?.account_id === 'omar' && tx?.to_account_id === 'a1', JSON.stringify(tx && [tx.amount, tx.currency, tx.account_id, tx.to_account_id]))
    ok('…stamped with the rate of the day', (tx?.tags ?? []).includes('fx:USD/EGP=48'), JSON.stringify(tx?.tags))
    await tab('Balance')
    const t = await text()
    ok('CIB holds 24,000 pounds', /CIB[\s\S]{0,120}EGP 24,000/.test(t))
    ok('Omar is owed 500 dollars', /\(USD 500\)/.test(t))
  } else {
    ok('with no USD rate it says so', /no exchange rate/i.test(body), body.match(/.{0,30}no exchange rate.{0,80}/i)?.[0])
    ok('…and Save is disabled, so one end is never silently left out', await save.isDisabled())
    ok('…and nothing was written', writes.length === 0, String(writes.length))
  }
}

if (MODE === 'existing') {
  // Only the open picker's own list: the page behind has Omar on it too.
  const listed = () => page.evaluate(() => [...document.querySelectorAll('body > .sb-blur-surface button')].map(b => (b.textContent ?? '').trim()))
  await openAdd()
  // Expense (the default kind): the lender is not somewhere to spend from.
  await page.locator('button', { hasText: 'CIB' }).first().click()
  const optsExpense = await listed()
  ok('the picker opened (positive: it lists something)', optsExpense.length > 0, JSON.stringify(optsExpense))
  ok('Expense offers CIB (positive control)', optsExpense.some(t => t.includes('CIB')))
  ok('…and does not offer the lender', !optsExpense.some(t => t.includes('Omar')), JSON.stringify(optsExpense))
  // Escape would close the whole window; a click on a label inside it closes only the list.
  await page.getByText('Notes', { exact: true }).click()
  await page.getByRole('button', { name: 'Transfer', exact: true }).click()
  await page.locator('button', { hasText: /Which (card or )?account/ }).first().click()
  const optsTransfer = await listed()
  ok('Transfer offers the accounts (positive: it lists something)', optsTransfer.length > 0, JSON.stringify(optsTransfer))
  ok('…and does offer the lender (that is how it is paid back)', optsTransfer.some(t => t.includes('Omar')), JSON.stringify(optsTransfer))
  ok('…showing it as a loan', optsTransfer.some(t => t.includes('Omar') && /Loan/.test(t)))
}

await br.close()
console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)

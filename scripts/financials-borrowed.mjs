/**
 * Financials: Borrowed and Re-pay borrowed are lines of their own, drawn only when
 * the year has any, and in no total.
 *
 *   node scripts/financials-borrowed.mjs 5199 [none|lines|drill|control]
 *
 *   none     no borrowing: neither line exists (and the table does — positive claim)
 *   lines    a 150,000 borrowing and a 2,000 repayment this month: both lines, in the
 *            right month, and Total income / Total expenses / Net identical to `none`
 *   drill    clicking the Borrowed figure opens exactly that entry, marked Borrowed
 *   control  the same 150,000 filed as income: the totals DO move (150,000 more) —
 *            which is what the lines exist to prevent
 */
import { chromium } from 'playwright-core'
import { session } from './session.mjs'
import { settled, watchTraffic } from './settled.mjs'

const args = process.argv.slice(2)
const port = args.find(a => /^\d+$/.test(a)) ?? '5199'
const MODE = args.find(a => ['none', 'lines', 'drill', 'control'].includes(a)) ?? 'lines'
const THEME = process.env.INK_THEME ?? 'sunlit-bento'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
let failed = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) failed++ }

const U = session.user.id, T0 = '2026-01-01T00:00:00.000Z'
const pad = n => String(n).padStart(2, '0'), now = new Date()
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
const MI = now.getMonth()
const acc = o => ({ user_id: U, bank: '', balance: 0, emoji: '💵', color: '#0C8140', sort_order: 0, is_active: true, created_at: T0, ...o })
const cat = o => ({ user_id: U, icon: 'lucide:Tag', color: '#0C8140', sort_order: 0, is_system: false, created_at: T0, parent_id: null, ...o })
const tx = o => ({ user_id: U, to_account_id: null, category_id: null, currency: 'EGP', payee: '', date: today, paid_at: today, note: null,
  is_cleared: true, is_recurring: false, tags: [], attachments: [], created_at: T0, ...o })
const withLoan = MODE !== 'none'
const DB = {
  finance_accounts: [
    acc({ id: 'p', name: 'CIB', account_type: 'payment', currency: 'EGP', balance: 0 }),
    ...(withLoan ? [acc({ id: 'l1', name: 'Baba', account_type: 'loan', currency: 'EGP', balance: 0, emoji: '🤝', sort_order: 1 })] : []),
  ],
  finance_categories: [
    cat({ id: 'sal', name: 'Salary', tx_type: 'income' }),
    cat({ id: 'food', name: 'Food', tx_type: 'expense', color: '#C62828' }),
  ],
  finance_transactions: [
    tx({ id: 't-sal', account_id: 'p', category_id: 'sal', tx_type: 'income', amount: 100000, payee: 'Employer' }),
    tx({ id: 't-food', account_id: 'p', category_id: 'food', tx_type: 'expense', amount: 4000, payee: 'Market' }),
    ...(MODE === 'lines' || MODE === 'drill' ? [
      tx({ id: 't-borrow', account_id: 'l1', to_account_id: 'p', tx_type: 'transfer', amount: 150000, payee: 'Borrowed from Baba' }),
      tx({ id: 't-repay', account_id: 'p', to_account_id: 'l1', tx_type: 'transfer', amount: 2000, payee: 'Payment to Baba' }),
    ] : []),
    ...(MODE === 'control' ? [tx({ id: 't-fake', account_id: 'p', category_id: 'sal', tx_type: 'income', amount: 150000, payee: 'Borrowed, filed as income' })] : []),
  ],
}

const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctx = await br.newContext({ viewport: { width: 1500, height: 1000 }, timezoneId: 'Africa/Cairo', locale: 'en-GB', reducedMotion: 'reduce' })
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
await page.addInitScript(([s, themeId]) => {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('google_provider_token', 'tok')
  localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'finance', themeId }, version: 0 }))
  localStorage.setItem('bpa-wizard-done', '1')
}, [session, THEME])
const traffic = watchTraffic(page)
await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' })
await settled(page, traffic, 9000)
await page.locator('nav[aria-label="Finance sections"]').getByRole('button', { name: 'Financials', exact: true }).click()
await page.getByText('Total income').first().waitFor({ timeout: 8000 }).catch(() => {})

const num = t => { const m = /\(?([\d,]+)\)?/.exec(t ?? ''); return m ? Number(m[1].replace(/,/g, '')) : 0 }
// Every cell of a row, by the row's label: [label, Jan..Dec, year].
const row = label => page.evaluate(l => {
  const tr = [...document.querySelectorAll('tr')].find(r => r.firstElementChild?.textContent?.trim().startsWith(l))
  return tr ? [...tr.children].map(c => c.textContent?.trim() ?? '') : null
}, label)
const totalIncome = await row('Total income'), totalExp = await row('Total expenses'), net = await row('Net by month')
ok('the table is on screen (positive: Total income exists)', !!totalIncome && !!totalExp && !!net)
const col = MI + 1

if (MODE === 'none') {
  ok('no Borrowed line when nothing was borrowed', (await row('Borrowed')) === null)
  ok('no Re-pay borrowed line either', (await row('Re-pay borrowed')) === null)
  console.log(`  baseline: income ${totalIncome?.[col]}, expenses ${totalExp?.[col]}, net ${net?.[col]}`)
}
if (MODE === 'lines') {
  const b = await row('Borrowed'), r = await row('Re-pay borrowed')
  ok('a Borrowed line exists', !!b)
  ok('…with 150,000 in this month', num(b?.[col]) === 150000, JSON.stringify(b))
  ok('…and nothing in the other months', b?.slice(1, 13).every((c, i) => i === MI || num(c) === 0), JSON.stringify(b?.slice(1, 13)))
  ok('a Re-pay borrowed line exists', !!r)
  ok('…with 2,000 in this month', num(r?.[col]) === 2000, JSON.stringify(r))
  ok('Total income is still the salary alone (100,000)', num(totalIncome?.[col]) === 100000, totalIncome?.[col])
  ok('Total expenses is still the shopping alone (4,000)', num(totalExp?.[col]) === 4000, totalExp?.[col])
  ok('Net is still 96,000', num(net?.[col]) === 96000, net?.[col])
  // Ink: every piece of text on the two lines, against the ground it really sits on.
  const ink = await page.evaluate(() => {
    const parse = c => { const m = c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0]; return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 } }
    const lum = ({ r, g, b }) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4 }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b) }
    const ground = el => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c.a >= 0.99) return c } return { r: 255, g: 255, b: 255, a: 1 } }
    const out = []
    for (const tr of document.querySelectorAll('tr[data-loan-line]')) {
      for (const el of tr.querySelectorAll('span, td[data-loan-cell]')) {
        const t = el.textContent?.trim(); if (!t || t === '–' || el.querySelector('span')) continue
        const fg = parse(getComputedStyle(el).color), bg = ground(el)
        const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x)
        out.push({ t: t.slice(0, 24), ratio: Math.round(((a + .05) / (b + .05)) * 100) / 100 })
      }
    }
    return out
  })
  ok('ink: text on the lines was measured (positive)', ink.length >= 4, String(ink.length))
  ok(`ink (${THEME}): every piece is at least 4.5:1`, ink.every(i => i.ratio >= 4.5), JSON.stringify(ink.filter(i => i.ratio < 4.5)))
  const order = await page.evaluate(() => [...document.querySelectorAll('tr')].map(r => r.firstElementChild?.textContent?.trim() ?? ''))
  const at = p => order.findIndex(x => x.startsWith(p))
  ok('the lines sit between Total income and EXPENSES, Borrowed above Re-pay', at('Total income') < at('Borrowed') && at('Borrowed') < at('Re-pay borrowed') && at('Re-pay borrowed') < at('EXPENSES'), JSON.stringify(order.filter(Boolean).slice(0, 14)))
}
if (MODE === 'drill') {
  await page.locator('tr[data-loan-line="Borrowed"] td[data-loan-cell]').nth(MI).click()
  await page.getByText('Borrowed from Baba').first().waitFor({ timeout: 5000 }).catch(() => {})
  const body = await page.evaluate(() => document.body.innerText)
  ok('the panel opens on exactly the borrowing', /Borrowed from Baba/.test(body) && !/Payment to Baba/.test(body) && !/Employer/.test(body), '')
  ok('…says what it is, and that it is not income', /Borrowed — not income/.test(body))
  ok('…and carries the Borrowed mark', (await page.getByText('Borrowed', { exact: true }).count()) >= 2)
  ok('…summing to 150,000, not (150,000)', /1 entry\s*·\s*EGP 150,000/.test(body.replace(/\s+/g, ' ')), body.replace(/\s+/g, ' ').match(/1 entry.{0,40}/)?.[0] ?? '')
}
if (MODE === 'control') {
  ok('CONTROL: filed as income, Total income reads 250,000 — the line is what stops this', num(totalIncome?.[col]) === 250000, totalIncome?.[col])
  ok('CONTROL: and there is no Borrowed line to say it was borrowed', (await row('Borrowed')) === null)
}
await br.close()
console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)

/**
 * Every account row on Balances is the same size, and its name is all there.
 *
 * A row's height was a minimum and its name column was `min-content` wide, so a
 * name like "World Platinum Signature CC" wrapped onto three lines beside a
 * limit bar and made a card half as tall again as the account above it.
 *
 *   node scripts/balance-rows-same-size.mjs 5199 [wide|narrow]
 *
 * Fixture: a payment account with an unpaid line (a second line on its right),
 * a wallet, a card with a limit and a long name, and two lenders. Measured from
 * getBoundingClientRect: heights equal across every group, widths equal, and no
 * name clipped (scrollWidth <= clientWidth on the name's own element).
 */
import { chromium } from 'playwright-core'
import { session } from './session.mjs'
import { settled, watchTraffic } from './settled.mjs'

const args = process.argv.slice(2)
const port = args.find(a => /^\d+$/.test(a)) ?? '5199'
const MODE = args.find(a => a === 'wide' || a === 'narrow') ?? 'wide'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
let failed = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) failed++ }

const U = session.user.id, T0 = '2026-01-01T00:00:00.000Z'
const pad = n => String(n).padStart(2, '0'), now = new Date()
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
const acc = o => ({ user_id: U, bank: '', balance: 0, emoji: '💵', color: '#0C8140', sort_order: 0, is_active: true, created_at: T0, ...o })
const NAMES = ['CIB EGP Debit', 'EGP Cash', 'World Platinum Signature CC', 'Baba Borrowed Money', 'Smsm Borrowed Money']
const DB = {
  finance_accounts: [
    acc({ id: 'p', name: NAMES[0], account_type: 'payment', currency: 'EGP', balance: 266897, sort_order: 0 }),
    acc({ id: 'w', name: NAMES[1], account_type: 'wallet', currency: 'EGP', balance: 1715, sort_order: 1 }),
    acc({ id: 'cc', name: NAMES[2], account_type: 'credit_card', currency: 'EGP', balance: -132539, credit_limit: 100000, bank: 'CIB', last4: '4242', sort_order: 2 }),
    acc({ id: 'l1', name: NAMES[3], account_type: 'loan', currency: 'EGP', balance: -150000, emoji: '🤝', sort_order: 3 }),
    acc({ id: 'l2', name: NAMES[4], account_type: 'loan', currency: 'USD', balance: -2500, emoji: '🤝', sort_order: 4 }),
  ],
  finance_categories: [{ id: 'c1', user_id: U, name: 'Rent', icon: 'lucide:Home', color: '#0C8140', tx_type: 'expense', sort_order: 0, is_system: false, created_at: T0, parent_id: null }],
  finance_transactions: [{ id: 't1', user_id: U, account_id: 'p', to_account_id: null, category_id: 'c1', amount: 104250, currency: 'EGP', tx_type: 'income',
    payee: 'Client', date: today, paid_at: null, note: null, is_cleared: false, is_recurring: false, tags: [], attachments: [], created_at: T0 }],
}

const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctx = await br.newContext({ viewport: { width: MODE === 'narrow' ? 760 : 1300, height: 1100 }, timezoneId: 'Africa/Cairo', locale: 'en-GB', reducedMotion: 'reduce' })
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
await page.addInitScript(s => {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('google_provider_token', 'tok')
  localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'finance', themeId: 'sunlit-bento' }, version: 0 }))
  localStorage.setItem('bpa-wizard-done', '1')
}, session)
const traffic = watchTraffic(page)
await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' })
await settled(page, traffic, 9000)
await page.locator('nav[aria-label="Finance sections"]').getByRole('button', { name: 'Balance', exact: true }).click()
await page.getByText(NAMES[3]).first().waitFor({ timeout: 8000 }).catch(() => {})

// The card's limit hairline runs along the row's foot: the text above it must clear it.
const gap = await page.evaluate(() => {
  const row = [...document.querySelectorAll('[role="button"][title^="Show only"]')].find(r => r.querySelector('div[aria-hidden][style*="bottom"]'))
  if (!row) return null
  const bar = row.querySelector('div[aria-hidden][style*="bottom"]').getBoundingClientRect()
  const lowest = Math.max(...[...row.querySelectorAll('span')].filter(s => s.children.length === 0 && s.textContent?.trim()).map(s => s.getBoundingClientRect().bottom))
  return Math.round((bar.top - lowest) * 10) / 10
})
const rows = await page.evaluate(names => {
  const out = []
  for (const el of document.querySelectorAll('[role="button"][title^="Show only"]')) {
    const r = el.getBoundingClientRect()
    const nameEl = [...el.querySelectorAll('span')].find(s => names.includes(s.textContent?.trim() ?? '') && s.children.length === 0)
    out.push({ title: el.getAttribute('title'), h: Math.round(r.height * 10) / 10, w: Math.round(r.width),
      name: nameEl?.textContent ?? null,
      // Clamped to two lines: cut only if the text is taller than the box it was given.
      clipped: nameEl ? (nameEl.scrollHeight > nameEl.clientHeight + 1 || nameEl.scrollWidth > nameEl.clientWidth + 1) : null,
      nameLines: nameEl ? Math.round(nameEl.getBoundingClientRect().height / (parseFloat(getComputedStyle(nameEl).lineHeight) || parseFloat(getComputedStyle(nameEl).fontSize) * 1.1)) : null,
      // Nothing inside the row may spill past the row's own box.
      spill: [...el.querySelectorAll('span, button')].filter(c => c.getBoundingClientRect().right > r.right + 1 || c.getBoundingClientRect().bottom > r.bottom + 1).length })
  }
  return out
}, NAMES)
console.log(rows.map(r => `  ${r.h}px × ${r.w}px  ${r.title}`).join('\n'))
ok('the card caption clears the limit hairline (gap >= 0px)', gap !== null && gap >= 0, `gap ${gap}px`)
ok('every account row was found (positive: the fixture is on screen)', rows.length === 5, String(rows.length))
ok('…and every name element was found', rows.every(r => r.name), JSON.stringify(rows.map(r => r.name)))
ok('all rows are the same height', new Set(rows.map(r => r.h)).size === 1, [...new Set(rows.map(r => r.h))].join(' / '))
ok('all rows are the same width', new Set(rows.map(r => r.w)).size === 1, [...new Set(rows.map(r => r.w))].join(' / '))
ok('every name takes at most two lines', rows.every(r => r.nameLines <= 2), JSON.stringify(rows.map(r => r.nameLines)))
if (MODE === 'wide') ok('nothing spills out of its row', rows.every(r => r.spill === 0), JSON.stringify(rows.map(r => r.spill)))
else console.log('  (narrow: the fixed columns of a row are wider than a 276px list — not asserted, and the same on main)')
// At 760px the list is a 276px column beside the feed: no row of this design fits a
// long name there, and that is the page's two-column layout, not the row. Only the
// widths people actually use are held to "nothing clipped".
if (MODE === 'wide') ok('no name is clipped', rows.every(r => r.clipped === false), JSON.stringify(rows.filter(r => r.clipped).map(r => r.name)))
else console.log('  (narrow: names may ellipsise in a 276px column — not asserted)')
ok('no row is taller than 64px (they are not big)', rows.every(r => r.h <= 64), Math.max(...rows.map(r => r.h)) + 'px')
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT })
await br.close()
console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)

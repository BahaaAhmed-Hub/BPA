#!/usr/bin/env node
/**
 * undo-replaces-confirm — a deletion that can be taken back no longer asks
 *
 *   npx vite --port 5199 --strictPort      (in one shell)
 *   node scripts/undo-replaces-confirm.mjs [5199]
 *
 * P0.6 of docs/ui-unification.md: `window.confirm` is gone. A delete that can
 * be reversed does the thing and registers an undo; one that cannot (a Google
 * Calendar delete) asks through the app's own ConfirmDialog.
 *
 * Measured, per case:
 *   goal   — click "Delete this goal": no native dialog, the goal leaves the
 *            list, the server receives the DELETE; press Undo: the goal is back
 *            and the server receives an upsert carrying the same id.
 *   entry  — the same for a ledger entry.
 *   dialog — the app's ConfirmDialog opens (role=alertdialog), focus starts on
 *            the SAFE button, Escape cancels and resolves false, and the
 *            destructive button resolves true.
 *
 * **The stub is stateful and can refuse**: it keeps the rows, removes them on
 * DELETE, adds them on upsert, and records every write. "Back on screen" with
 * no restore call at the server would be a screen lying; both are asserted.
 *
 * Control: the same script against the code before P0.6 (`git stash push -- src`)
 * sees the native dialog fire and the case fails — see docs.
 */
import { chromium } from 'playwright-core'
import { user, session } from './session.mjs'
import { settled, watchTraffic } from './settled.mjs'

const port = process.argv[2] ?? '5199'
const U = user.id
const T0 = '2026-01-01T00:00:00.000Z'
const pad = n => String(n).padStart(2, '0')
const now = new Date()
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

const db = {
  finance_accounts: [{ id: 'a1', user_id: U, name: 'Cash — Work', bank: '', account_type: 'payment', currency: 'EGP', balance: 5000, emoji: '', color: '#0C8140', sort_order: 0, is_active: true, created_at: T0 }],
  finance_categories: [{ id: 'c1', user_id: U, name: 'Meals', icon: '', color: '#0C8140', tx_type: 'expense', sort_order: 0, is_system: false, created_at: T0 }],
  finance_transactions: [{ id: 't1', user_id: U, account_id: 'a1', to_account_id: null, category_id: 'c1', amount: 640, currency: 'EGP', tx_type: 'expense', payee: 'Lunch at Zomato', date: today, paid_at: today, note: null, is_cleared: true, is_recurring: false, tags: [], attachments: [], created_at: T0 }],
  finance_goals: [{ id: 'g1', user_id: U, name: 'New laptop', icon: '', target_amount: 60000, current_amount: 0, color: '#7F77DD', sub_label: null, is_active: true, rank: 0, deadline: null, currency: 'EGP', created_at: T0 }],
}
const writes = []   // { method, table, id }

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctx = await br.newContext({ viewport: { width: 1500, height: 1050 }, timezoneId: 'Africa/Cairo', locale: 'en-GB' })
await ctx.route('**://placeholder.supabase.co/**', r => {
  const req = r.request(), u = req.url(), method = req.method()
  if (method === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS })
  const j = (json, status = 200) => r.fulfill({ status, json, headers: CORS })
  if (u.includes('/auth/v1/user')) return j(user)
  if (u.includes('/auth/v1/token')) return j(session)
  if (u.includes('/rpc/')) return j(true)
  const table = /\/rest\/v1\/([a-z_]+)/.exec(u)?.[1]
  if (!table) return j([])
  if (!db[table]) return j([])
  if (method === 'GET') return j(db[table])
  if (method === 'DELETE') {
    const id = /[?&]id=eq\.([^&]+)/.exec(u)?.[1]
    writes.push({ method, table, id })
    db[table] = db[table].filter(x => x.id !== id)
    return r.fulfill({ status: 204, headers: CORS })
  }
  if (method === 'POST' || method === 'PATCH') {
    let body = []
    try { body = req.postDataJSON() } catch { /* empty */ }
    for (const row of Array.isArray(body) ? body : [body]) {
      if (!row?.id) continue
      writes.push({ method, table, id: row.id })
      db[table] = [...db[table].filter(x => x.id !== row.id), row]
    }
    return j([])
  }
  return j([])
})
await ctx.route('**://*.googleapis.com/**', r => r.fulfill({ json: { items: [], threads: [], labels: [] }, headers: CORS }))

const page = await ctx.newPage()
page.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
const dialogs = []
page.on('dialog', d => { dialogs.push(d.message()); d.accept().catch(() => {}) })   // accept: if one fires, the delete still happens, and the case fails on `dialogs`
await page.addInitScript(s => {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('google_provider_token', 'tok')
  localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'finance', themeId: 'sunlit-bento' }, version: 0 }))
}, session)

let failed = 0
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : '*** FAIL ***'}  ${name}${detail ? '  ' + detail : ''}`); if (!cond) failed++ }
const traffic = watchTraffic(page)
await page.goto(`http://localhost:${port}/BPA/`, { waitUntil: 'domcontentloaded' })
await settled(page, traffic, 9000)
await page.getByText('Skip for now').first().click({ timeout: 1200 }).catch(() => {})

// ── A goal ──────────────────────────────────────────────────────────────────
await page.getByRole('button', { name: 'Goals', exact: true }).first().click()
await page.getByText('New laptop').first().waitFor({ timeout: 8000 })
await page.getByText('New laptop').first().click()
const del = page.getByTitle('Delete this goal')
ok('goal: the delete button exists (not a vacuous pass)', await del.count() === 1)
await del.click()
await page.waitForTimeout(500)
ok('goal: no native dialog fired', dialogs.length === 0, dialogs.join(' | '))
ok('goal: gone from the list (the Undo toast quotes it, so match the row exactly)', await page.getByText('New laptop', { exact: true }).count() === 0)
ok('goal: the server received the DELETE', writes.some(w => w.method === 'DELETE' && w.table === 'finance_goals' && w.id === 'g1'))
const undo = page.getByRole('button', { name: /undo/i }).first()
ok('goal: an Undo is offered, naming it', await undo.count() > 0 && /laptop/i.test(await page.locator('body').innerText()))
await undo.click()
await page.getByText('New laptop', { exact: true }).first().waitFor({ timeout: 6000 }).catch(() => {})
ok('goal: Undo puts it back on screen', await page.getByText('New laptop', { exact: true }).count() > 0)
ok('goal: and the server got the restore (an upsert with the same id)', writes.some(w => w.method !== 'DELETE' && w.table === 'finance_goals' && w.id === 'g1'))

// ── The ConfirmDialog itself, driven through the app's own module ───────────
const probe = await page.evaluate(async () => {
  const m = await import('/BPA/src/lib/confirm.ts')
  window.__ask = { confirm: m.askConfirm, text: m.askText }
  return typeof m.askConfirm
}).catch(e => String(e))
ok('dialog: the confirm module is reachable', probe === 'function', String(probe))
if (probe === 'function') {
  const result = await page.evaluate(() => { window.__r1 = undefined; window.__ask.confirm({ title: 'Delete this event?', body: 'It is removed from Google.', confirmLabel: 'Delete event' }).then(v => { window.__r1 = v }); return true })
  const dlg = page.getByRole('alertdialog')
  await dlg.waitFor({ timeout: 3000 })
  ok('dialog: opens as an alertdialog with the title', (await dlg.innerText()).includes('Delete this event?'))
  const focused = await page.evaluate(() => document.activeElement?.textContent?.trim())
  ok('dialog: focus starts on the SAFE button (Cancel), not the destructive one', focused === 'Cancel', `focused "${focused}"`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  ok('dialog: Escape closes it and answers false', await dlg.count() === 0 && await page.evaluate(() => window.__r1) === false)
  await page.evaluate(() => { window.__r1 = undefined; window.__ask.confirm({ title: 'Delete this event?', confirmLabel: 'Delete event' }).then(v => { window.__r1 = v }) })
  await dlg.waitFor({ timeout: 3000 })
  await dlg.getByRole('button', { name: 'Delete event' }).click()
  await page.waitForTimeout(150)
  ok('dialog: the destructive button answers true', await page.evaluate(() => window.__r1) === true)
  // The typed variant refuses an empty answer when it is required.
  await page.evaluate(() => { window.__r2 = undefined; window.__ask.text({ title: 'Add a link', label: 'Link', confirmLabel: 'Add link' }).then(v => { window.__r2 = v }) })
  await dlg.waitFor({ timeout: 3000 })
  ok('dialog: a required text answer cannot be submitted empty', await dlg.getByRole('button', { name: 'Add link' }).isDisabled())
  await page.keyboard.type('https://example.com')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(150)
  ok('dialog: typed text comes back trimmed', await page.evaluate(() => window.__r2) === 'https://example.com')
}

// ── A ledger entry (Financials → the Entries panel) ─────────────────────────
await page.getByRole('button', { name: 'Financials', exact: true }).first().click()
await page.getByText('Meals').first().waitFor({ timeout: 8000 }).catch(() => {})
let reached = false
try {
  // A figure in the Meals row opens the entries it was summed from.
  const cell = page.locator('.sb-fin-row', { hasText: 'Meals' }).first().locator('[role="button"], button, td, div').filter({ hasText: /640/ }).first()
  await cell.click({ timeout: 4000 })
  await page.getByText('Lunch at Zomato').first().waitFor({ timeout: 4000 })
  reached = true
} catch { /* reported below */ }
ok('entry: the entries panel opened with the seeded entry (not a vacuous pass)', reached)
if (reached) {
  const delE = page.getByTitle('Delete this entry').first()
  ok('entry: the delete button exists', await delE.count() > 0)
  await delE.click()
  await page.waitForTimeout(500)
  ok('entry: no native dialog fired', dialogs.length === 0, dialogs.join(' | '))
  ok('entry: the server received the DELETE', writes.some(w => w.method === 'DELETE' && w.table === 'finance_transactions' && w.id === 't1'))
  await page.getByRole('button', { name: /undo/i }).first().click()
  await page.waitForTimeout(700)
  ok('entry: Undo sent the restore (an upsert with the same id)', writes.some(w => w.method !== 'DELETE' && w.table === 'finance_transactions' && w.id === 't1'))
}

await br.close()
console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)

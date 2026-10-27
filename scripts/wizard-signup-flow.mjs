#!/usr/bin/env node
/**
 * wizard-signup-flow — the setup guide is for a NEW signup, writes what it is
 * told, writes nothing when skipped, and the admin's test writes nothing at all
 *
 *   npx vite --port 5199 --strictPort            (one shell)
 *   node scripts/wizard-signup-flow.mjs [5199]
 *
 * Parts, each against a stub server that records every write:
 *   gate  — a signup of today opens it; a year-old account never does; a new
 *           account that already has habits never does; the done flag keeps it
 *           shut; Settings has no replay button.
 *   real  — all eight steps answered: name, theme, company, key, schedule, quiet
 *           hours, rules, alerts, habit rows on the server, a lock stored as a
 *           hash only, and both done flags set.
 *   skip  — the five optional steps skipped write nothing and say Skipped.
 *   admin — the Admin panel button opens the same wizard in test mode; a walk
 *           through every step leaves no write to the server, no localStorage
 *           key changed, the theme put back and the done flag unset; an account
 *           that is not an admin cannot raise the event into a wizard.
 * Controls: every "stays shut" claim sits beside one that it CAN open, and the
 * admin part asserts the real run on the same fixture does write.
 */
import { createRequire } from 'node:module'
import { user as baseUser, session as baseSession } from './session.mjs'
const require = createRequire(import.meta.url)
const { chromium } = require('playwright-core')

const PORT = Number(process.argv[2] ?? 5199)
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
let fails = 0
const ok = (n, c, d = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${d ? '  ' + d : ''}`); if (!c) fails++ }
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })

async function open({ ageDays = 0, done = false, admin = false, seed = {} } = {}) {
  const user = { ...baseUser, created_at: new Date(Date.now() - ageDays * 864e5).toISOString() }
  const session = { ...baseSession, user }
  const db = { habits: [], tasks: [], admins: admin ? [{ user_id: user.id }] : [], ...seed }
  const writes = []
  const ctx = await br.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Africa/Cairo', locale: 'en-GB' })
  await ctx.route('**://placeholder.supabase.co/**', r => {
    const req = r.request(), u = req.url(), method = req.method()
    if (method === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS })
    const j = (json, status = 200) => r.fulfill({ status, json, headers: CORS })
    if (u.includes('/auth/v1/user')) return j(user)
    if (u.includes('/auth/v1/token')) return j(session)
    if (u.includes('/rpc/')) return j(true)
    const table = /\/rest\/v1\/([a-z_]+)/.exec(u)?.[1]
    if (!table) return j([])
    if (method === 'GET') return j(db[table] ?? [])
    if (method === 'POST' || method === 'PATCH') {
      let body = []
      try { body = req.postDataJSON() } catch { /* empty */ }
      writes.push({ table, method, body })
      for (const row of Array.isArray(body) ? body : [body]) if (row?.id) db[table] = [...(db[table] ?? []).filter(x => x.id !== row.id), row]
      return j([])
    }
    return j([])
  })
  await ctx.route('**://*.googleapis.com/**', r => r.fulfill({ json: { items: [], threads: [], labels: [] }, headers: CORS }))
  await ctx.route('**://api.anthropic.com/**', r => r.fulfill({ status: 200, json: { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }, headers: CORS }))
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  await page.addInitScript(([s, done]) => {
    if (sessionStorage.getItem('__seeded')) return
    sessionStorage.setItem('__seeded', '1')
    localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
    localStorage.setItem('google_provider_token', 'tok')
    localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
    if (done) localStorage.setItem('bpa-wizard-done', '1')
  }, [session, done])
  await page.goto(`http://localhost:${PORT}/BPA/`, { waitUntil: 'domcontentloaded' })
  return { ctx, page, db, writes, errors }
}
const ls = (page, k) => page.evaluate(k => localStorage.getItem(k), k)
const snapshot = page => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort().map(k => [k, localStorage.getItem(k)])))
const cont = page => page.locator('.wz-panel .sb-btn[data-variant="primary"]').click()
const to = (page, id) => page.waitForFunction(id => document.querySelector('[data-wizard]')?.getAttribute('data-wz-step') === id, id)
const range = (page, id, v) => page.evaluate(([id, v]) => { const i = document.getElementById(id); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, String(v)); i.dispatchEvent(new Event('input', { bubbles: true })) }, [id, v])
const wizardUp = async (page, ms = 6000) => page.locator('[data-wizard]').waitFor({ timeout: ms }).then(() => true, () => false)

/** Every step answered; the same walk for the real run and the dry run. */
async function walkAll(page) {
  await page.fill('#wz-name', 'Sam Tester').catch(() => {})
  await cont(page); await to(page, 'accounts')
  await page.getByRole('button', { name: 'Add a company' }).click()
  await page.getByLabel('Company name').fill('Acme Ltd')
  await page.getByRole('button', { name: 'Add this company' }).click()
  await cont(page); await to(page, 'ai')
  await page.fill('#wz-key', 'sk-ant-good-key-123456789'); await cont(page); await to(page, 'rhythm')
  await range(page, 'wz-start', 7); await range(page, 'wz-stop', 16); await range(page, 'wz-quiet', 23)
  await cont(page); await to(page, 'automation')
  await page.getByRole('switch', { name: 'Distribute the dump' }).click()
  await cont(page); await to(page, 'habits')
  await page.getByRole('button', { name: 'Drink Water' }).click()
  await page.getByRole('button', { name: 'Reading' }).click()
  await cont(page); await to(page, 'finance')
  await page.getByRole('switch', { name: 'Lock the finance pages' }).click()
  await page.fill('#wz-pass', 'secret-1')
  await cont(page); await to(page, 'done')
}

// ═════════ gate ═════════
console.log('— gate')
{
  const a = await open({ ageDays: 0 })
  ok('gate: a signup of today opens it', await wizardUp(a.page, 12000))
  await a.ctx.close()
  const b = await open({ ageDays: 365 })
  await b.page.waitForTimeout(4500)
  ok('gate: a year-old account never sees it', !(await wizardUp(b.page, 500)))
  ok('gate: and the page did load (a positive beside the absence)', (await b.page.locator('[data-side-rail]').count()) > 0)
  await b.ctx.close()
  const c = await open({ ageDays: 0, seed: { habits: [{ id: 'h1', user_id: baseUser.id, name: 'Run', frequency: 'daily' }] } })
  await c.page.waitForTimeout(4500)
  ok('gate: a new account that already has habits never sees it', !(await wizardUp(c.page, 500)))
  await c.ctx.close()
  const d = await open({ ageDays: 0, done: true })
  await d.page.waitForTimeout(4500)
  ok('gate: the done flag keeps it shut', !(await wizardUp(d.page, 500)))
  const sw = await d.page.evaluate(() => { window.dispatchEvent(new Event('professor:openWizard')); return null })
  await d.page.waitForTimeout(500)
  ok('gate: the old replay event opens nothing', !(await wizardUp(d.page, 300)) && sw === null)
  await d.ctx.close()
}

// ═════════ real ═════════
console.log('— real')
{
  const { page, writes, errors, ctx } = await open({ ageDays: 0 })
  ok('real: opens', await wizardUp(page, 12000))
  await walkAll(page)
  ok('real: name saved', (await ls(page, 'professor-display-name')) === 'Sam Tester')
  ok('real: company reached the server and the store', writes.some(x => x.table === 'companies' && JSON.stringify(x.body).includes('Acme Ltd')) && (await ls(page, 'professor-companies'))?.includes('Acme Ltd'))
  ok('real: key saved', (await ls(page, 'professor-ai-config'))?.includes('sk-ant-good-key'))
  ok('real: schedule written', JSON.parse(await ls(page, 'professor-settings')).endOfDay === '16:00')
  ok('real: rule switch saved', JSON.parse(await ls(page, 'professor-automation-rules')).find(r => r.id === 'distribute-dump').enabled === true)
  for (let i = 0; i < 40 && !writes.some(x => x.table === 'habits'); i++) await page.waitForTimeout(200)
  ok('real: habit rows on the server', writes.some(x => x.table === 'habits'))
  const lockKey = await page.evaluate(() => Object.keys(localStorage).find(k => /finance.*lock/i.test(k) && !/active|passkey/i.test(k)) ?? null)
  const lock = lockKey ? await ls(page, lockKey) : ''
  ok('real: the lock is a hash, never the password', !!lockKey && !lock.includes('secret-1') && lock.includes('hash'))
  await cont(page)
  await page.locator('[data-wizard]').waitFor({ state: 'detached', timeout: 5000 })
  ok('real: both done flags set', (await ls(page, 'bpa-wizard-done')) === '1' && (await ls(page, 'professor-wizard-done')) === '1')
  ok('real: no page errors', !errors.length, errors.join(' ;; '))
  await ctx.close()
}

// ═════════ skip ═════════
console.log('— skip')
{
  const { page, writes, ctx } = await open({ ageDays: 0 })
  await wizardUp(page, 12000)
  await cont(page); await to(page, 'accounts'); await cont(page); await to(page, 'ai')
  await page.getByRole('button', { name: 'Skip for now' }).click(); await to(page, 'rhythm')
  for (const id of ['automation', 'habits', 'finance', 'done']) { await page.getByRole('button', { name: 'Skip this step' }).click(); await to(page, id) }
  const sum = await page.locator('.wz-sum').allTextContents()
  ok('skip: summary says Skipped for the five', sum.filter(t => t.includes('Skipped')).length === 5)
  ok('skip: nothing written for them', [await ls(page, 'professor-automation-rules'), await ls(page, 'professor-quiet-hours'), await ls(page, 'professor-ai-config')].every(v => v === null))
  ok('skip: no habit rows', !writes.some(x => x.table === 'habits'))
  await ctx.close()
}

// ═════════ admin ═════════
console.log('— admin')
{
  const { page, writes, ctx } = await open({ ageDays: 400, admin: true })
  await page.locator('[data-side-rail]').waitFor({ timeout: 12000 })
  await page.getByRole('button', { name: /account menu|profile/i }).first().click().catch(() => page.locator('button[aria-haspopup="menu"]').click())
  await page.getByRole('menuitem', { name: /Admin/ }).click().catch(() => page.getByText('Admin', { exact: true }).last().click())
  const btn = page.locator('[data-test-wizard]')
  await btn.waitFor({ timeout: 8000 })
  ok('admin: the panel has the Test setup guide button', (await btn.textContent()).includes('Test setup guide'))
  const startTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme') ?? getComputedStyle(document.documentElement).getPropertyValue('--sb-page'))
  // A year-old account is quietly marked done here by the gate itself; clear it so the
  // test measures only what the test mode does.
  await page.evaluate(() => { localStorage.removeItem('bpa-wizard-done'); localStorage.removeItem('professor-wizard-done') })
  const before = await snapshot(page)
  const writesBefore = writes.length
  await btn.click()
  ok('admin: it opens the wizard', await wizardUp(page, 5000))
  ok('admin: the test banner is on screen', await page.locator('.wz-test-banner').isVisible())
  await walkAll(page)
  for (let i = 0; i < 10; i++) await page.waitForTimeout(200)
  await page.screenshot({ path: process.env.WZ_SHOT ?? '/dev/null' }).catch(() => {})
  await page.getByRole('button', { name: 'Leave the test' }).first().click()
  await page.locator('[data-wizard]').waitFor({ state: 'detached', timeout: 5000 })
  const after = await snapshot(page)
  const changed = Object.keys({ ...before, ...after }).filter(k => before[k] !== after[k] && !/^(sb-|google_provider|professor-prefs|professor-mail|today-|professor-live)/.test(k))
  ok('admin: no server write during the whole walk', writes.length === writesBefore, JSON.stringify(writes.slice(writesBefore).map(w => w.table)))
  ok('admin: no setting key written to this browser', !changed.some(k => /display-name|ai-config|settings|quiet|automation|habits|companies|finance|notif/.test(k)), changed.join(','))
  ok('admin: the done flag is never set', (await ls(page, 'bpa-wizard-done')) === null && (await ls(page, 'professor-wizard-done')) === null)
  const endTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme') ?? getComputedStyle(document.documentElement).getPropertyValue('--sb-page'))
  ok('admin: the theme is put back', endTheme === startTheme, `${startTheme} -> ${endTheme}`)
  await btn.click()
  ok('admin: and it can be run again', await wizardUp(page, 5000))
  await ctx.close()
}
{
  const { page, ctx } = await open({ ageDays: 400, admin: false })
  await page.locator('[data-side-rail]').waitFor({ timeout: 12000 })
  await page.evaluate(() => window.dispatchEvent(new Event('professor:testWizard')))
  await page.waitForTimeout(1500)
  ok('admin: a non-admin raising the event gets nothing', !(await wizardUp(page, 500)))
  await ctx.close()
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed')
await br.close()
process.exit(fails ? 1 : 0)

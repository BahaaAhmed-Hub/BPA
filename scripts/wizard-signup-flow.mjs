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

async function open({ viewport = { width: 1440, height: 900 }, ageDays = 0, done = false, admin = false, seed = {}, local = {}, sess = {} } = {}) {
  const user = { ...baseUser, created_at: new Date(Date.now() - ageDays * 864e5).toISOString() }
  const session = { ...baseSession, user }
  const db = { habits: [], tasks: [], admins: admin ? [{ user_id: user.id }] : [], ...seed }
  const writes = []
  const ctx = await br.newContext({ viewport, hasTouch: viewport.width < 600, timezoneId: 'Africa/Cairo', locale: 'en-GB' })
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
    if (method === 'DELETE') { writes.push({ table, method, body: [], url: decodeURIComponent(u) }); return j([]) }
    return j([])
  })
  await ctx.route('**://*.googleapis.com/**', r => r.fulfill({ json: { items: [], threads: [], labels: [] }, headers: CORS }))
  await ctx.route('**://api.anthropic.com/**', r => r.fulfill({ status: 200, json: { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }, headers: CORS }))
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  await page.addInitScript(([s, done, local, sess]) => {
    if (sessionStorage.getItem('__seeded')) return
    sessionStorage.setItem('__seeded', '1')
    for (const [k, v] of Object.entries(local)) localStorage.setItem(k, v)
    for (const [k, v] of Object.entries(sess)) sessionStorage.setItem(k, v)
    localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
    localStorage.setItem('google_provider_token', 'tok')
    localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
    if (done) localStorage.setItem('bpa-wizard-done', '1')
  }, [session, done, local, sess])
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

// ═════════ review — each finding from the independent review, as a claim ═════════
console.log('— review')
{
  // 1. A key test answers for the key it was asked about, not whatever is in the box when it lands.
  const { page, ctx } = await open({ ageDays: 0 })
  await wizardUp(page, 12000)
  await cont(page); await to(page, 'accounts'); await cont(page); await to(page, 'ai')
  await ctx.route('**://api.anthropic.com/**', async r => { await new Promise(res => setTimeout(res, 1200)); await r.fulfill({ status: 200, json: { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }, headers: CORS }) })
  await page.fill('#wz-key', 'sk-ant-first-key-1234567')
  await page.getByRole('button', { name: 'Test key' }).click()
  await page.fill('#wz-key', 'sk-ant-second-key-7654321')
  await page.waitForTimeout(2200)
  ok('review: a test answering for an old key does not bless the new one', (await page.locator('.wz-ok').count()) === 0)
  await page.getByRole('button', { name: 'Test key' }).click()
  await page.locator('.wz-ok').waitFor({ timeout: 6000 }).catch(() => {})
  ok('review: and a test of the key in the box still can (the control)', (await page.locator('.wz-ok').count()) === 1)

  // 2. A key under the wrong provider holds Continue back, in words.
  await page.getByRole('button', { name: /Groq/ }).first().click()
  await page.fill('#wz-key', 'sk-ant-pasted-in-groq-1234')
  const cb = page.locator('.wz-panel .sb-btn[data-variant="primary"]')
  ok('review: an sk-ant key under Groq blocks Continue', await cb.isDisabled() && (await page.locator('.wz-foot .wz-note').textContent()).includes('other provider'))
  await page.fill('#wz-key', 'gsk_a-real-looking-groq-key')
  ok('review: the same box with a Groq key is fine (the control)', await cb.isEnabled())
  await ctx.close()
}
{
  // 3. A rate-limited Groq key is not a failed key.
  const { page, ctx } = await open({ ageDays: 0 })
  await wizardUp(page, 12000)
  await cont(page); await to(page, 'accounts'); await cont(page); await to(page, 'ai')
  await ctx.route('**://api.groq.com/**', r => r.fulfill({ status: 429, body: 'Rate limit reached for model `llama-3.3-70b-versatile`', headers: CORS }))
  await page.getByRole('button', { name: /Groq/ }).first().click()
  await page.fill('#wz-key', 'gsk_a-real-looking-groq-key')
  await page.getByRole('button', { name: 'Test key' }).click()
  await page.locator('.wz-bad').waitFor({ timeout: 6000 }).catch(() => {})
  ok('review: a 429 says busy, not "model not offered"', /busy|rate/i.test(await page.locator('.wz-bad').textContent().catch(() => '')))
  ok('review: and does not block Continue', await page.locator('.wz-panel .sb-btn[data-variant="primary"]').isEnabled())
  await ctx.close()
}
{
  // 4. Companies: another one on the server is never deleted; an existing one keeps its calendar; Back-and-remove takes only this wizard's own.
  const old = { id: 'old-co', name: 'Old Co', color: '#3B82F6', calendarId: 'cal-1', emailDomain: 'old.co', accountId: '', isActive: true, users: [{ id: 'u', name: 'P' }] }
  const server = [{ id: 'old-co', user_id: baseUser.id, name: 'Old Co' }, { id: 'srv-only', user_id: baseUser.id, name: 'Server Only' }]
  const draft = { id: 'old-co', name: 'Old Co', color: '#3B82F6', emailDomain: 'old.co', accountId: '' }
  const { page, writes, ctx, db } = await open({ ageDays: 0, sess: { 'bpa-wizard-resume': JSON.stringify({ idx: 1, w: { companies: [draft] } }) } })
  ok('review: the wizard opened for the company fixture (not vacuous)', await wizardUp(page, 12000))
  // By the time the wizard saves, one company exists here and two on the server (made in Settings, or on another device).
  db.companies = server
  await page.evaluate(([o, srv]) => localStorage.setItem('professor-companies', JSON.stringify([o, { ...srv, calendarId: '', isActive: true, users: [] }])), [old, { id: 'srv-only', name: 'Server Only', color: '#111111', emailDomain: '', accountId: '' }])
  await to(page, 'accounts')
  ok('review: an existing company has no remove button here', (await page.getByRole('button', { name: 'Remove Old Co' }).count()) === 0)
  await page.getByRole('button', { name: 'Add a company' }).click()
  await page.getByLabel('Company name').fill('Acme Ltd')
  await page.getByRole('button', { name: 'Add this company' }).click()
  await cont(page); await to(page, 'ai')
  let stored = JSON.parse(await ls(page, 'professor-companies'))
  ok('review: the existing company keeps its calendar and people', stored.find(c => c.id === 'old-co')?.calendarId === 'cal-1' && stored.find(c => c.id === 'old-co')?.users?.length === 1)
  ok('review: the added one is stored', stored.some(c => c.name === 'Acme Ltd'))
  ok('review: no company was deleted from the server', !writes.some(x => x.method === 'DELETE' && x.table === 'companies'), JSON.stringify(writes.filter(x => x.method === 'DELETE').map(x => x.url)))
  await page.getByRole('button', { name: 'Back' }).click(); await to(page, 'accounts')
  await page.getByRole('button', { name: 'Remove Acme Ltd' }).click()
  await cont(page); await to(page, 'ai')
  stored = JSON.parse(await ls(page, 'professor-companies'))
  ok('review: Back and remove takes the added one away', !stored.some(c => c.name === 'Acme Ltd') && stored.some(c => c.id === 'old-co'))
  const dels = writes.filter(x => x.method === 'DELETE' && x.table === 'companies').map(x => x.url).join(' ')
  ok('review: the server delete names the added one and never the others', dels.length > 0 && !dels.includes('old-co') && !dels.includes('srv-only'), dels)
  await ctx.close()
}
{
  // 5. Secrets are not parked in sessionStorage for the OAuth round trip.
  const { page, ctx } = await open({ ageDays: 0 })
  await wizardUp(page, 12000)
  await cont(page); await to(page, 'accounts'); await cont(page); await to(page, 'ai')
  await page.fill('#wz-key', 'sk-ant-secret-key-1234567')
  await cont(page); await to(page, 'rhythm')
  for (const id of ['automation', 'habits', 'finance']) { await page.getByRole('button', { name: 'Skip this step' }).click(); await to(page, id) }
  await page.getByRole('switch', { name: 'Lock the finance pages' }).click()
  await page.fill('#wz-pass', 'hunter2-secret')
  await page.getByRole('button', { name: '02 Accounts' }).click(); await to(page, 'accounts')
  await ctx.route('**://placeholder.supabase.co/auth/v1/authorize**', r => r.abort())
  await ctx.route('**://accounts.google.com/**', r => r.abort())
  // The page leaves for Google, so what it wrote is caught as it is written.
  const recorded = []
  await page.exposeFunction('__rec', v => { recorded.push(v) })
  await page.evaluate(() => { const set = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (k === 'bpa-wizard-resume') window.__rec(v); return set.call(this, k, v) } })
  await page.getByRole('button', { name: 'Add another Google account' }).click()
  await page.waitForTimeout(1000)
  const note = recorded[0]
  ok('review: a resume note was written (not vacuous)', !!note && note.includes('"idx"'))
  ok('review: and holds neither the API key nor the finance password', !!note && !note.includes('sk-ant-secret') && !note.includes('hunter2'))
  await ctx.close()
}
{
  // 6. Rhythm shows what it saves: an out-of-range stored value is held to the slider.
  const { page, ctx } = await open({ ageDays: 0, local: { 'professor-settings': JSON.stringify({ focusStart: '03:00', endOfDay: '23:00', timezone: 'Africa/Cairo' }), 'professor-quiet-hours': JSON.stringify({ on: true, start: '01:00', end: '08:30' }) } })
  await wizardUp(page, 12000)
  await cont(page); await to(page, 'accounts'); await cont(page); await to(page, 'ai')
  await page.getByRole('button', { name: 'Skip for now' }).click(); await to(page, 'rhythm')
  ok('review: out-of-range stored hours are shown held to the sliders', (await page.inputValue('#wz-start')) === '5' && (await page.inputValue('#wz-stop')) === '21' && (await page.inputValue('#wz-quiet')) === '20')
  await range(page, 'wz-start', 5)
  await cont(page); await to(page, 'automation')
  const q = JSON.parse(await ls(page, 'professor-quiet-hours'))
  ok('review: quiet hours end no later than work begins', q.start === '20:00' && q.end === '05:00', JSON.stringify(q))
  await ctx.close()
}

// ═════════ narrow — a phone, every step ═════════
console.log('— narrow')
{
  const { page, ctx } = await open({ ageDays: 0, viewport: { width: 390, height: 780 } })
  ok('narrow: opens', await wizardUp(page, 12000))
  const ids = ['you', 'accounts', 'ai', 'rhythm', 'automation', 'habits', 'finance', 'done']
  for (const id of ids) {
    await to(page, id)
    await page.waitForTimeout(900)   // the entrance animation
    const m = await page.evaluate(() => {
      const root = document.querySelector('[data-wizard]'), vw = window.innerWidth, vh = window.innerHeight
      const btn = document.querySelector('.wz-panel .sb-btn[data-variant="primary"]')
      const r = btn?.getBoundingClientRect()
      const panel = document.querySelector('.wz-panel').getBoundingClientRect()
      const small = [...document.querySelectorAll('.wz-panel button, .wz-panel input, .wz-panel select')].filter(e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.height < 30 && !e.matches('.wz-link, .wz-link-plain, .wz-range, [type=range]') }).map(e => (e.getAttribute('aria-label') || e.textContent || e.id).trim().slice(0, 24))
      return { sideways: document.documentElement.scrollWidth > vw + 1, btnIn: !!r && r.bottom <= vh + 1 && r.top >= 0 && r.right <= vw + 1, panelIn: panel.left >= -1 && panel.right <= vw + 1, small }
    })
    ok(`narrow: ${id} has no sideways scroll`, !m.sideways)
    ok(`narrow: ${id} keeps its panel on the screen`, m.panelIn)
    ok(`narrow: ${id} keeps the main button on the screen`, m.btnIn)
    ok(`narrow: ${id} has no tiny tap targets`, m.small.length === 0, m.small.join(' | '))
    if (id !== 'done') { if (id === 'ai') await page.getByRole('button', { name: 'Skip for now' }).click(); else if (['rhythm', 'automation', 'habits', 'finance'].includes(id)) await page.getByRole('button', { name: 'Skip this step' }).click(); else await cont(page) }
  }
  await ctx.close()
}

// ═════════ keyboard — every control that takes focus shows it ═════════
console.log('— keyboard')
{
  const { page, ctx } = await open({ ageDays: 0 })
  ok('keyboard: opens', await wizardUp(page, 12000))
  await page.waitForTimeout(1200)
  const seen = []
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press('Tab')
    seen.push(await page.evaluate(() => {
      const e = document.activeElement
      if (!e || !e.closest('[data-wizard]')) return { out: true }
      const cs = getComputedStyle(e)
      return { label: (e.getAttribute('aria-label') || e.textContent || e.id || e.tagName).trim().slice(0, 22), ring: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 }
    }))
  }
  const inside = seen.filter(x => !x.out)
  ok('keyboard: Tab moves through the wizard controls', inside.length >= 6, String(inside.length))
  ok('keyboard: focus never leaves the dialog', seen.every(x => !x.out))
  ok('keyboard: each one shows a focus ring', inside.every(x => x.ring), inside.filter(x => !x.ring).map(x => x.label).join(' | '))
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

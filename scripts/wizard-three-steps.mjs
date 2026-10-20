#!/usr/bin/env node
/**
 * wizard-three-steps — the setup wizard is three steps, and habits and tasks
 * are set up where they live
 *
 *   npx vite --port 5199 --strictPort                                   (one shell)
 *   VITE_TODOIST_CLIENT_ID=x npx vite --port 5198 --strictPort          (another, for the Todoist half)
 *   node scripts/wizard-three-steps.mjs [5199] [5198]
 *
 * P2.5 of docs/ui-unification.md. Measured, per part:
 *   wizard — opens at "Step 1 of 3" with three progress segments; step 1 holds the
 *            name field, the theme tiles AND the accounts card; step 2 is
 *            companies; step 3 is done and has NO habits/tasks count. "Pick your
 *            habits" finishes the wizard (flag set) and lands on Habits.
 *   habits — an empty Habits screen shows the starter; picking two presets and
 *            adding them makes two rows AND sends two habit rows to the server;
 *            with a habit already on the server the starter is not drawn (the
 *            control: it must be able to stay away).
 *   tasks  — (needs the second server) a build that can reach Todoist shows the
 *            import prompt on an empty board; "Not now" removes it and a reload
 *            keeps it away; with a task on the server it is not drawn. On the
 *            first server (no client id) it is never drawn.
 *
 * The stub is stateful and records writes, so "two rows" is the server's word.
 */
import { chromium } from 'playwright-core'
import { user, session } from './session.mjs'
import { settled, watchTraffic } from './settled.mjs'

const port = process.argv[2] ?? '5199'
const todoistPort = process.argv[3]
const U = user.id
const T0 = '2026-01-01T00:00:00.000Z'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }

let failed = 0
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : '*** FAIL ***'}  ${name}${detail ? '  ' + detail : ''}`); if (!cond) failed++ }
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })

async function open({ p = port, seed = {}, module, wizardDone }) {
  const db = { habits: [], tasks: [], ...seed }
  const writes = []
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
    if (method === 'GET') return j(db[table] ?? [])
    if (method === 'POST' || method === 'PATCH') {
      let body = []
      try { body = req.postDataJSON() } catch { /* empty */ }
      for (const row of Array.isArray(body) ? body : [body]) if (row?.id) { writes.push({ table, id: row.id, name: row.name ?? row.title }); db[table] = [...(db[table] ?? []).filter(x => x.id !== row.id), row] }
      return j([])
    }
    return j([])
  })
  await ctx.route('**://*.googleapis.com/**', r => r.fulfill({ json: { items: [], threads: [], labels: [] }, headers: CORS }))
  const page = await ctx.newPage()
  page.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
  await page.addInitScript(([s, mod, done]) => {
    localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
    localStorage.setItem('google_provider_token', 'tok')
    localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
    if (done) localStorage.setItem('bpa-wizard-done', '1'); else localStorage.removeItem('bpa-wizard-done')
    if (!localStorage.getItem('professor-ui')) localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: mod, themeId: 'sunlit-bento' }, version: 0 }))
  }, [session, module ?? 'morning', !!wizardDone])
  const traffic = watchTraffic(page)
  await page.goto(`http://localhost:${p}/BPA/`, { waitUntil: 'domcontentloaded' })
  await settled(page, traffic, 9000)
  return { ctx, page, writes, db }
}
const text = page => page.locator('body').innerText()

// ── The wizard ──────────────────────────────────────────────────────────────
{
  const { ctx, page } = await open({ wizardDone: false })
  // The first-login timer is cancelled by StrictMode's double mount in dev (a ref guards its re-arm), so open it by the Settings door's own event.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('professor:openWizard')))
  await page.getByText('Step 1 of 3').waitFor({ timeout: 8000 }).catch(() => {})
  ok('wizard: opens at "Step 1 of 3" (not 6)', await page.getByText('Step 1 of 3').count() === 1)
  ok('wizard: three progress segments', await page.locator('div[title="Companies"], div[title="Done"], div[title="You & accounts"]').count() === 3)
  ok('wizard: step 1 has the name field', await page.getByPlaceholder('Your name...').count() === 1)
  ok('wizard: step 1 has the theme tiles', await page.getByText('Choose your theme').count() === 1)
  ok('wizard: step 1 has the accounts card too', await page.getByText('Connect your accounts').count() === 1)
  ok('wizard: step 1 has no hero/feature cards (compact)', await page.getByText('AI Prioritization').count() === 0)
  await page.getByRole('button', { name: /^Next/ }).click()
  await page.getByText('Step 2 of 3').waitFor({ timeout: 4000 })
  ok('wizard: step 2 is companies', /compan/i.test(await text(page)) && await page.getByText('Step 2 of 3').count() === 1)
  await page.getByRole('button', { name: /^Next/ }).click()
  await page.getByText('Step 3 of 3').waitFor({ timeout: 4000 })
  const t = await text(page)
  ok('wizard: step 3 is the Done screen', await page.getByText("You're all set").count() === 1)
  ok('wizard: it counts Accounts and Companies', await page.getByText('Accounts', { exact: true }).count() === 1 && await page.getByText('Companies', { exact: true }).count() >= 1)
  ok('wizard: and has no Habits or Tasks count (control: the old Done had both)', await page.getByText('Habits', { exact: true }).count() === 0 && await page.getByText('Tasks', { exact: true }).count() === 0)
  ok('wizard: step 3 offers Pick your habits and Add your tasks', await page.getByRole('button', { name: 'Pick your habits' }).count() === 1 && await page.getByRole('button', { name: 'Add your tasks' }).count() === 1)
  ok('wizard: there is no step 4', await page.getByText('Step 4 of').count() === 0 && await page.getByRole('button', { name: /^Next/ }).count() === 0)
  await page.getByRole('button', { name: 'Pick your habits' }).click()
  await page.waitForTimeout(400)
  ok('wizard: it finished (flag set, overlay gone)', await page.evaluate(() => localStorage.getItem('bpa-wizard-done')) === '1' && await page.getByText('Step 3 of 3').count() === 0)
  ok('wizard: and landed on Habits', await page.locator('[data-side-rail] [aria-current]').first().getAttribute('aria-label').catch(() => '') === 'Habits' || await page.locator('[data-habit-starter]').count() === 1)
  await ctx.close()
}

// ── The Habits first-run prompt ─────────────────────────────────────────────
{
  const { ctx, page, writes } = await open({ module: 'habits', wizardDone: true })
  await page.locator('[data-habit-starter]').first().waitFor({ timeout: 8000 }).catch(() => {})
  ok('habits: an empty screen shows the starter (not a vacuous pass)', await page.locator('[data-habit-starter]').count() >= 1)
  const add = page.getByRole('button', { name: /^Add habits$/ }).first()
  ok('habits: Add is disabled until something is picked', await add.isDisabled())
  await page.getByRole('button', { name: /Drink Water/ }).first().click()
  await page.getByRole('button', { name: /Journaling/ }).first().click()
  const go = page.getByRole('button', { name: 'Add 2 habits' }).first()
  ok('habits: the button counts what was picked', await go.count() === 1)
  await go.click()
  await page.waitForTimeout(2500)
  const rows = writes.filter(w => w.table === 'habits')
  ok('habits: the server received the two habits', new Set(rows.map(r => r.name)).size === 2 && rows.some(r => r.name === 'Drink Water') && rows.some(r => r.name === 'Journaling'), JSON.stringify([...new Set(rows.map(r => r.name))]))
  ok('habits: the starter is gone once there are habits', await page.locator('[data-habit-starter]').count() === 0)
  ok('habits: both are on the screen', /Drink Water/.test(await text(page)) && /Journaling/.test(await text(page)))
  await ctx.close()
}
{
  const seed = { habits: [{ id: 'h1', user_id: U, name: 'Stretch', emoji: '', color: '#7F77DD', type: 'boolean', goal: null, unit: null, frequency: 'daily', is_active: true, sort_order: 0, created_at: T0 }] }
  const { ctx, page } = await open({ module: 'habits', wizardDone: true, seed })
  await page.getByText('Stretch').first().waitFor({ timeout: 8000 }).catch(() => {})
  ok('habits control: with a habit on the server the screen is real', await page.getByText('Stretch').count() > 0)
  ok('habits control: the starter stays away', await page.locator('[data-habit-starter]').count() === 0)
  await ctx.close()
}

// ── The Tasks first-run prompt ──────────────────────────────────────────────
{
  const { ctx, page } = await open({ module: 'tasks', wizardDone: true })
  await page.getByRole('tablist', { name: 'View' }).waitFor({ timeout: 8000 }).catch(() => {})
  ok('tasks: Tasks opened (not a vacuous pass)', await page.getByRole('tablist', { name: 'View' }).count() === 1)
  ok('tasks: a build without a Todoist client id never draws the prompt', await page.locator('[data-todoist-import]').count() === 0)
  await ctx.close()
}
if (todoistPort) {
  const { ctx, page } = await open({ p: todoistPort, module: 'tasks', wizardDone: true })
  await page.locator('[data-todoist-import]').waitFor({ timeout: 8000 }).catch(() => {})
  ok('tasks: with a client id, an empty board shows the Todoist prompt', await page.locator('[data-todoist-import]').count() === 1)
  ok('tasks: it offers Connect Todoist', await page.getByRole('button', { name: 'Connect Todoist' }).count() === 1)
  await page.getByRole('button', { name: 'Not now' }).click()
  ok('tasks: "Not now" removes it', await page.locator('[data-todoist-import]').count() === 0)
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2500)
  ok('tasks: and a reload keeps it away', await page.locator('[data-todoist-import]').count() === 0)
  await ctx.close()
  const seed = { tasks: [{ id: 't1', user_id: U, title: 'Existing task', quadrant: 'do', status: 'open', completed: false, created_at: T0 }] }
  const b = await open({ p: todoistPort, module: 'tasks', wizardDone: true, seed })
  await b.page.waitForTimeout(2500)
  ok('tasks control: with a task on the server the prompt is not drawn', await b.page.locator('[data-todoist-import]').count() === 0)
  await b.ctx.close()
} else console.log('  (skipped the Todoist half: pass a second port running with VITE_TODOIST_CLIENT_ID)')

await br.close()
console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)

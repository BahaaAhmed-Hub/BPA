#!/usr/bin/env node
/**
 * today-is-the-day — the Dashboard is folded into Today
 *
 *   npx vite --port 5199 --strictPort
 *   node scripts/today-is-the-day.mjs [5199]
 *
 * P2.1 of docs/ui-unification.md. Measured:
 *   rail   — no Dashboard button; Today is first. A saved `activeModule` of
 *            'dashboard' (every existing user has one) lands on Today, not on a
 *            blank page with nothing lit in the rail.
 *   strip  — Today's `[data-today-glance]` has four chips. Their figures are the
 *            SERVER's data, counted by the right rule: a seeded fixture with
 *            2 open "Do now" tasks, 1 finished "Do now" task, 1 open Schedule
 *            task, 2 timed events + 1 all-day event, 2 habits with 1 done.
 *            Expected: Do now 2 (the finished one must not count), Open tasks
 *            3, Meetings 2 (the all-day one is not a meeting), Habits 50%.
 *   doors  — each chip opens the module that owns the figure.
 *
 * The control is in the fixture: every wrong rule (counting finished tasks,
 * all-day events) lands on a different number than the right one.
 */
import { chromium } from 'playwright-core'
import { user, session } from './session.mjs'
import { settled, watchTraffic } from './settled.mjs'

const port = process.argv[2] ?? '5199'
const U = user.id
const ME = user.email
const NOW = new Date()
const pad = n => String(n).padStart(2, '0')
const TODAY = `${NOW.getFullYear()}-${pad(NOW.getMonth() + 1)}-${pad(NOW.getDate())}`
const T0 = '2026-01-01T00:00:00.000Z'

const task = (id, title, quadrant, completed) => ({
  id, user_id: U, company_id: null, title, description: null, quadrant, effort_minutes: null, due_date: null,
  status: completed ? 'done' : 'todo', delegated_to: null, done_looks_like: null, created_at: T0, completed_at: completed ? T0 : null,
  planned_time: null, owner_id: null, company_tag: null, completed, task_type: 'research', priority: null, board_status: null,
  calendar_id: null, gcal_event_id: null, parent_task_id: null, captured_via: null, urgent: false, checklist: [], attachments: [], links: [],
})
const habit = (id, name) => ({ id, user_id: U, name, frequency: 'daily', current_streak: 0, longest_streak: 0, is_active: true, emoji: '', color: '#7F77DD', type: 'boolean', goal: null, unit: null, image: null, sort_order: 0, created_at: T0 })
const db = {
  tasks: [
    task('t1', 'Ship the proposal', 'urgent_important', false),
    task('t2', 'Call the bank', 'urgent_important', false),
    task('t3', 'Old urgent thing', 'urgent_important', true),
    task('t4', 'Plan the quarter', 'important_not_urgent', false),
  ],
  habits: [habit('h1', 'Stretch'), habit('h2', 'Read')],
  habit_logs: [{ id: 'l1', habit_id: 'h1', date: TODAY, user_id: U, completed: true, quantity: null }],
}
const EV = (id, title, h) => ({ id, status: 'confirmed', summary: title, start: { dateTime: `${TODAY}T${pad(h)}:00:00+03:00` }, end: { dateTime: `${TODAY}T${pad(h + 1)}:00:00+03:00` } })
const EVENTS = [EV('e1', 'Standup', 9), EV('e2', 'Review', 14), { id: 'e3', status: 'confirmed', summary: 'Holiday', start: { date: TODAY }, end: { date: TODAY } }]
const CACHE = [{ id: ME, summary: 'Me', accountEmail: ME, primary: true, accessRole: 'owner', backgroundColor: '#3B82F6' }]

let failed = 0
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : '*** FAIL ***'}  ${name}${detail ? '  ' + detail : ''}`); if (!cond) failed++ }
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }

async function open(savedModule) {
  const ctx = await br.newContext({ viewport: { width: 1500, height: 1050 }, timezoneId: 'Africa/Cairo', locale: 'en-GB' })
  await ctx.route('**://placeholder.supabase.co/**', r => {
    const req = r.request(), u = new URL(req.url())
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS })
    const j = x => r.fulfill({ status: 200, json: x, headers: CORS })
    if (u.pathname === '/auth/v1/user') return j(user)
    if (u.pathname.startsWith('/auth/v1/token')) return j(session)
    const table = /\/rest\/v1\/([a-z_]+)/.exec(u.pathname)?.[1]
    if (table && req.method() === 'GET') return j(db[table] ?? [])
    return j([])
  })
  await ctx.route('**://www.googleapis.com/**', r => {
    const u = new URL(r.request().url())
    if (/\/calendars\/[^/]+\/events/.test(u.pathname)) return r.fulfill({ status: 200, json: { items: EVENTS }, headers: CORS })
    if (u.pathname.includes('/users/me/calendarList')) return r.fulfill({ status: 200, json: { items: CACHE.map(c => ({ ...c, selected: true })) }, headers: CORS })
    return r.fulfill({ status: 200, json: { items: [], threads: [], labels: [] }, headers: CORS })
  })
  await ctx.route('**://oauth2.googleapis.com/**', r => r.fulfill({ status: 200, json: {}, headers: CORS }))
  const page = await ctx.newPage()
  page.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
  await page.addInitScript(([s, mod, cache]) => {
    localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
    localStorage.setItem('google_provider_token', 'tok')
    localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
    localStorage.setItem('cal-intel-cals-cache', JSON.stringify(cache))
    localStorage.setItem('bpa-wizard-done', '1')
    if (!localStorage.getItem('professor-ui')) localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: mod, themeId: 'sunlit-bento' }, version: 0 }))
  }, [session, savedModule, CACHE])
  const traffic = watchTraffic(page)
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' })
  await settled(page, traffic, 9000)
  return { ctx, page }
}
const chip = (page, label) => page.locator('[data-today-glance] button', { hasText: label })

// ── A saved 'dashboard' lands on Today ──────────────────────────────────────
{
  const { ctx, page } = await open('dashboard')
  await page.locator('[data-today-glance]').waitFor({ timeout: 9000 }).catch(() => {})
  const rail = page.locator('[data-side-rail] button')
  const labels = await rail.evaluateAll(els => els.map(e => e.getAttribute('aria-label')))
  ok('rail: it has real buttons (not a vacuous pass)', labels.includes('Today') && labels.includes('Tasks'), labels.join(','))
  ok('rail: no Dashboard button', !labels.includes('Dashboard'))
  ok('rail: Today is first', labels[0] === 'Today', labels[0])
  ok('rail: a saved "dashboard" lands on Today, lit in the rail', await page.locator('[data-side-rail] button[aria-label="Today"][aria-current]').count() === 1)
  ok('rail: and the store no longer holds "dashboard"', await page.evaluate(() => JSON.parse(localStorage.getItem('professor-ui') || '{}').state?.activeModule) !== 'dashboard')

  // ── The strip ────────────────────────────────────────────────────────────
  await chip(page, 'Open tasks').waitFor({ timeout: 9000 }).catch(() => {})
  ok('strip: four chips', await page.locator('[data-today-glance] button').count() === 4)
  const val = async label => (await chip(page, label).first().innerText()).split('\n')[0].trim()
  await page.waitForTimeout(1500)
  ok('strip: Do now counts the 2 open urgent tasks, not the finished one', await val('Do now') === '2', await val('Do now'))
  ok('strip: Open tasks counts 3 (finished excluded, Schedule included)', await val('Open tasks') === '3', await val('Open tasks'))
  ok('strip: Meetings counts the 2 timed events, not the all-day one', await val('Meetings today') === '2', await val('Meetings today').catch(() => '?'))
  ok('strip: Habits is 50% (1 of 2 done)', await val('Habits today') === '50%', await val('Habits today').catch(() => '?'))
  ok('strip: the Do now glyph carries data-quadrant="do"', await page.locator('[data-today-glance] [data-quadrant="do"]').count() === 1)

  // ── The doors ────────────────────────────────────────────────────────────
  for (const [label, rail] of [['Open tasks', 'Tasks'], ['Meetings today', 'Calendar'], ['Habits today', 'Habits']]) {
    await page.locator('[data-side-rail] button[aria-label="Today"]').click()
    await chip(page, label).first().click()
    await page.waitForTimeout(300)
    ok(`doors: "${label}" opens ${rail}`, await page.locator(`[data-side-rail] button[aria-label="${rail}"][aria-current]`).count() === 1)
  }
  await ctx.close()
}

await br.close()
console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)

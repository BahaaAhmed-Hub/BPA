// node scripts/tick-completes-the-task.mjs [dismiss|cancel|complete]
// Needs a dev server on 5199.
//
// "I mark a task completed and it appears as incomplete." Not yesterday's
// revert — this one never completes at all. `useDeliverableGate.requestComplete`
// opens the DeliverablePrompt for any task whose type is in DELIVERS (`do`,
// `deepwork`), and `inferTaskType` **falls through to `do`**: a title matching
// none of its eight keyword patterns is a deliverable-producing task by
// default. Dismiss that dialog — Cancel, Escape, or a tap on the backdrop —
// and the tick is a no-op with nothing on screen to say so.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
const HOW = process.argv[2] ?? 'dismiss'
// `typed` is the control that stops this fix from being a deletion: a task
// somebody actually filed as `do` must still be asked for its deliverable.
const TYPED = HOW === 'typed' || HOW === 'typed-complete'

// A title that matches none of inferTaskType's patterns → 'do' → the gate.
const PLAIN = 'Water the office plants'
const tasks = [{
  id: 'plain-1', title: PLAIN, company: 'personal',
  quadrant: 'important_not_urgent', status: 'todo', completed: false,
  task_type: TYPED ? 'do' : null, created_at: new Date().toISOString(), user_id: user.id,
}]

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 1000 } })
await ctx.route('**://placeholder.supabase.co/**', r => {
  const u = new URL(r.request().url())
  const j = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) })
  if (u.pathname === '/auth/v1/user') return j(user)
  if (u.pathname.startsWith('/auth/v1/token')) return j({ ...session })
  if (u.pathname.startsWith('/auth/v1')) return j({})
  if (u.pathname === '/rest/v1/tasks') return j(tasks)
  return j([])
})
await ctx.addInitScript(s => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'tasks', themeId: 'sunlit-bento' }, version: 0 }))
  localStorage.setItem('task-view-mode', 'matrix')
} catch {} }, session)

const p = await ctx.newPage()
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 160)))
await p.goto('http://localhost:5199/BPA/', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(6500)

let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
const stored = () => p.evaluate(() => {
  try { const s = JSON.parse(localStorage.getItem('professor-tasks') || '{}')
    const t = (s.state?.tasks || []).find(x => x.id === 'plain-1')
    return t ? { completed: !!t.completed, status: t.status } : null } catch { return null }
})

const card = p.locator('[data-task-node]').filter({ hasText: PLAIN }).last()
ok('the task is on the board', await card.count() > 0)
const before = await stored()
ok('and it starts incomplete', before?.completed === false, JSON.stringify(before))

await card.getByTitle('Complete', { exact: true }).first().click()
await p.waitForTimeout(700)

// Does a dialog stand between the tick and the task?
const asked = await p.evaluate(() =>
  /what did this produce|deliverable|left open/i.test(document.body.innerText))
console.log(`  a dialog opened on the tick: ${asked}`)

if (TYPED) {
  ok('an explicitly-typed task is still asked for its deliverable', asked)
  if (HOW === 'typed-complete') {
    await p.getByRole('button', { name: /Complete/ }).last().click()
    await p.waitForTimeout(1200)
    const after = await stored()
    ok('and Complete finishes it', after?.completed === true, JSON.stringify(after))
  } else {
    await p.getByRole('button', { name: /^Cancel$/ }).first().click()
    await p.waitForTimeout(1200)
    const after = await stored()
    ok('cancelling leaves it open, as designed', after?.completed === false, JSON.stringify(after))
    const said = await p.evaluate(() => /left .* open/i.test(document.body.innerText))
    ok('and the screen says the tick was abandoned', said, `said=${said}`)
  }
  console.log(fails ? `\n${fails} failing` : '\nall good')
  await b.close(); process.exit(fails ? 1 : 0)
}

if (HOW === 'dismiss') {
  await p.keyboard.press('Escape'); await p.waitForTimeout(300)
  const box = p.locator('[data-task-node]').first()
  await box.click({ position: { x: 2, y: 2 } }).catch(() => {})
} else if (HOW === 'cancel') {
  const c = p.getByRole('button', { name: /^Cancel$/ })
  if (await c.count()) await c.first().click()
} else {
  const c = p.getByRole('button', { name: /Complete/ }).last()
  if (await c.count()) await c.click()
}
await p.waitForTimeout(1400)

const after = await stored()
console.log(`  after ${HOW}: ${JSON.stringify(after)}`)
if (HOW === 'complete') {
  ok('pressing Complete in the dialog does complete it', after?.completed === true, JSON.stringify(after))
} else {
  ok(`the tick completes the task even when the dialog is ${HOW === 'cancel' ? 'cancelled' : 'dismissed'}`,
     after?.completed === true, JSON.stringify(after))
  const said = await p.evaluate(() => /left open|not completed|still open/i.test(document.body.innerText))
  ok('…or the screen says the tick was abandoned', after?.completed === true || said, `said=${said}`)
}

console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails ? 1 : 0)

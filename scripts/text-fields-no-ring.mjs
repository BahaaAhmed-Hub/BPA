// node scripts/text-fields-no-ring.mjs [port=5199]     (needs a dev server)
// CHROME=<path> overrides the browser.
//
// Text you type into draws no black ring and no black border (index.css). This
// clicks into every visible text field on every screen — and the composers
// behind each "New …" / "Add …" button, and the assistant — then reads, on the
// field and on three ancestors: outline, box-shadow, and any border that turned
// dark on focus. A border that was already dark before focus is not a focus
// state and is not counted. The count of fields is printed too: 0 fields on a
// screen means the sweep never reached one, not that the screen is clean.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
import { watchTraffic, settled } from './settled.mjs'
const PORT = process.argv[2] ?? '5199'
const now = new Date().toISOString()
const tasks = ['Plan the quarter', 'Reply to Sam', 'Book the flights'].map((title, i) => ({
  id: 't' + i, title, company: 'personal', quadrant: 'schedule', status: 'todo', completed: false, task_type: null, created_at: now, user_id: user.id }))
const T = { tasks }
const b = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } })
const json = (r, x) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) })
await ctx.route('**://placeholder.supabase.co/**', r => {
  const q = r.request(); const u = new URL(q.url())
  if (u.pathname === '/auth/v1/user') return json(r, user)
  if (u.pathname.startsWith('/auth/v1/token')) return json(r, { ...session })
  if (u.pathname.startsWith('/auth/v1')) return json(r, {})
  if (u.pathname.endsWith('/rpc/my_modules')) return json(r, ['morning','calendar','inbox','tasks','habits','finance','library'].map(id => ({ module_id: id, label: id, enabled: true })))
  const t = u.pathname.split('/').pop()
  return json(r, q.method() === 'GET' && t in T ? T[t] : [])
})
for (const host of ['**://www.googleapis.com/**', '**://openlibrary.org/**', '**://oauth2.googleapis.com/**', 'https://covers.openlibrary.org/**'])
  await ctx.route(host, r => json(r, {}))
await ctx.addInitScript(s => { try {
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'morning', themeId: 'sunlit-bento' }, version: 0 }))
} catch {} function process_theme() { return 'sunlit-bento' } }, session)
const p = await ctx.newPage()
const traffic = watchTraffic(p)
p.on('pageerror', () => {})
await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' })
await settled(p, traffic, 6500)

const TEXT = 'textarea, [contenteditable=""], [contenteditable="true"], input:not([type]), input:is([type="text"],[type="search"],[type="number"],[type="email"],[type="password"],[type="tel"],[type="url"],[type="date"],[type="time"],[type="datetime-local"],[type="month"],[type="week"])'
// Read the paint of a field and three ancestors. Runs in the page.
const chainPaint = el => {
  const out = []
  for (let i = 0; i < 4 && el && el !== document.body; i++, el = el.parentElement) {
    const cs = getComputedStyle(el)
    out.push({ tag: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''),
      outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 ? `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}` : '',
      shadow: cs.boxShadow !== 'none' ? cs.boxShadow : '',
      border: [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor] })
  }
  return out
}
const dark = c => { const m = c.match(/[\d.]+/g)?.map(Number); if (!m || m.length < 3) return false; if (m.length > 3 && m[3] < .5) return false
  const [r, g, bl] = m; return (0.2126 * r + 0.7152 * g + 0.0722 * bl) < 70 }

let fields = 0; const bad = []; const measured = []
async function sweep(label, scope = p) {
  const loc = scope.locator(TEXT)
  const n = await loc.count()
  let seen = 0
  for (let i = 0; i < n && i < 40; i++) {
    const f = loc.nth(i)
    if (!(await f.isVisible({ timeout: 1000 }).catch(() => false))) continue
    if (await f.isDisabled().catch(() => false)) continue
    const name = await f.evaluate(e => (e.getAttribute('aria-label') || e.placeholder || e.name || e.tagName).slice(0, 30), null, { timeout: 1500 }).catch(() => null)
    if (name === null) continue   // re-rendered away while we walked
    await p.evaluate(() => document.activeElement?.blur?.())
    await p.waitForTimeout(160)
    const before = await f.evaluate(chainPaint, null, { timeout: 1500 }).catch(() => [])
    await f.click({ timeout: 1500 }).catch(() => {})
    await p.waitForTimeout(220)  // past the 120ms border transition
    if (!(await f.evaluate(e => e === document.activeElement, null, { timeout: 1500 }).catch(() => false))) continue
    seen++; fields++; measured.push(`${label} · ${name}`)
    const after = await p.evaluate(chainPaint, await p.evaluateHandle(() => document.activeElement))
    after.forEach((a, k) => {
      const was = before[k] ?? { outline: '', shadow: '', border: [] }, why = []
      // The field's own outline is always wrong; anything else only if it appeared on focus.
      if (a.outline && (k === 0 || a.outline !== was.outline)) why.push('outline ' + a.outline)
      if (a.shadow && a.shadow !== was.shadow) why.push('shadow appeared ' + a.shadow.slice(0, 48))
      if (a.border.some(dark) && !was.border.some(dark)) why.push('border went dark ' + a.border.find(dark))
      if (why.length) bad.push(`${label} · "${name}" · ${a.tag}: ${why.join('; ')}`)
    })
  }
  return seen
}
async function openers(label) {
  const names = await p.evaluate(() => [...document.querySelectorAll('main button')].filter(b => b.offsetParent && /^(\+|new|add|create|log|edit)\b/i.test((b.textContent || '').trim()))
    .map(b => (b.textContent || '').trim().slice(0, 30)).slice(0, 6))
  for (const t of [...new Set(names)]) {
    await p.locator('main button', { hasText: t }).first().click({ timeout: 1500 }).catch(() => {})
    await p.waitForTimeout(500)
    const s = await sweep(`${label} › ${t}`)
    if (s) console.log(`${(label + ' › ' + t).padEnd(34)} fields: ${String(s).padStart(2)}`)
    await p.keyboard.press('Escape'); await p.waitForTimeout(250)
  }
}
// The first-run guide covers the app for a new account, and it has inputs of its
// own (wizard.css draws a ring on them): measure it, then close it the way
// ink-audit does and carry on.
const guide = await p.locator('[data-wizard]').first().waitFor({ timeout: 8000 }).then(() => true, () => false)
if (guide) {
  const s = await sweep('Setup guide'); console.log(`${'Setup guide'.padEnd(34)} fields: ${String(s).padStart(2)}`)
  await p.evaluate(() => localStorage.setItem('bpa-wizard-done', '1'))
  await p.reload({ waitUntil: 'domcontentloaded' }); await settled(p, traffic, 6500)
}
if (await p.locator('[data-wizard]').count()) { console.log('*** setup guide would not close — NOT MEASURED'); process.exit(2) }
const screens = ['Today', 'Calendar', 'Mail', 'Tasks', 'Habits', 'Finance', 'Library', 'Settings']
for (const label of screens) {
  await p.reload({ waitUntil: 'domcontentloaded' }); await settled(p, traffic, 6500)   // nothing carries over from the last screen
  if (label === 'Settings') {
    await p.locator('button[aria-haspopup="menu"]').first().click(); await p.waitForTimeout(400)
    const item = p.getByRole('menuitem', { name: /Settings/ })
    if (!(await item.count())) { console.log('*** Settings: no menu item — NOT MEASURED'); continue }
    await item.first().click()
  } else {
    const btn = p.locator(`[data-side-rail] button[aria-label="${label}"]`)
    if (!(await btn.count())) { console.log(`*** ${label}: no rail button — NOT MEASURED`); continue }
    await btn.first().click({ force: true })
  }
  await p.waitForTimeout(1500)
  const s = await sweep(label)
  console.log(`${label.padEnd(34)} fields: ${String(s).padStart(2)}`)
  await openers(label)
  // Sub-screens: a field is only on screen once its page is.
  const subs = label === 'Settings' ? ['Profile','Billing','Accounts & companies','AI','Schedule rules','Integrations','Tasks','Habits','Library','Automation','Notifications','Appearance','Behavioral OS','Data & privacy','Finance']
    : label === 'Finance' ? ['Today','Balance','Budget','Goals','Financials','Reports'] : []
  for (const name of subs) {
    const t = p.locator(label === 'Settings' ? 'button' : 'main button, nav button, aside button', { hasText: new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }).last()
    if (!(await t.count())) { console.log(`*** ${label} › ${name}: not found — NOT MEASURED`); continue }
    await t.click({ timeout: 1500 }).catch(() => {}); await p.waitForTimeout(700)
    const n = await sweep(`${label} › ${name}`)
    console.log(`${(label + ' › ' + name).padEnd(34)} fields: ${String(n).padStart(2)}`)
    await openers(`${label} › ${name}`)
  }
}
// Global search lives behind a button in the top-right cluster.
{ const sb = p.locator('[data-you] button[aria-label*="earch" i], [data-you] button[title*="earch" i]').first()
  await p.locator('[data-side-rail] button[aria-label="Today"]').first().click().catch(() => {})
  if (await sb.count()) { await sb.click().catch(() => {}); await p.waitForTimeout(500); const n = await sweep('Search'); console.log(`${'Search'.padEnd(34)} fields: ${String(n).padStart(2)}`); await p.keyboard.press('Escape') }
  else console.log('*** Search: no button — NOT MEASURED') }
// The assistant window.
const fab = p.locator('[data-assistant-fab]')
if (await fab.count()) { await fab.first().click(); await p.waitForTimeout(700)
  await p.getByRole('button', { name: /Not now/ }).first().click({ timeout: 1500 }).catch(() => {}); await p.waitForTimeout(400)
  const s = await sweep('Assistant', p.locator('[data-shown="true"]')); console.log(`${'Assistant'.padEnd(34)} fields: ${String(s).padStart(2)}`) }
else console.log('*** Assistant: no button — NOT MEASURED')
// The box this was reported on. Reaching it is a claim, not an assumption.
if (!measured.some(m => /Assistant · Ask, or drop a file in/.test(m))) { console.log('*** the assistant message box was never measured:', measured.filter(m => m.startsWith('Assistant'))); bad.push('assistant box not reached') }
console.log(`\nTOTAL fields: ${fields}   with a ring or dark border on focus: ${bad.length}`)
for (const x of [...new Set(bad)].slice(0, 40)) console.log('  ' + x)
await b.close()
process.exit(bad.length ? 1 : 0)

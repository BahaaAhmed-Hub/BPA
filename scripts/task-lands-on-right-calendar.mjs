// node scripts/task-lands-on-right-calendar.mjs [panel|planner|planner-ok]
// Needs a dev server on 5199.
//
// A task carrying a company must go on THAT company's calendar, on THAT
// company's Google account — or not be written at all. The dangerous shape is
// a company bound to a connected account with **no calendar of its own**:
// `resolveTaskCalendar` then answers `calendarId: 'primary'` plus that
// account's email, and `'primary'` written with the SIGNED-IN account's token
// is your own personal calendar. So a fallback to the primary token does not
// fail — it silently files the company's work in your own diary.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
const WHICH = process.argv[2] ?? 'panel'
const today = new Date().toISOString().slice(0, 10)
const ACC_A = '33333333-0000-4000-8000-00000000000a'   // Teradix — token dead
const ACC_B = '33333333-0000-4000-8000-00000000000b'   // DX — token live
const posts = []   // { calendarId, bearer }
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox','--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors:true, viewport:{ width:1700, height:1100 } })
await ctx.route('**://placeholder.supabase.co/**', r => { const q=r.request(); const u=new URL(q.url())
  const j=x=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)})
  if(u.pathname==='/auth/v1/user')return j(user)
  if(u.pathname.startsWith('/auth/v1/token'))return j({...session})
  if(u.pathname.startsWith('/auth/v1'))return j({})
  // The token broker. Teradix cannot be refreshed; DX can.
  if(u.pathname.includes('/functions/v1/google-token-refresh')){
    const body = q.postData() || ''
    if (body.includes('teradix')) return r.fulfill({status:400,contentType:'application/json',
      body:JSON.stringify({ error:'refresh token revoked' })})
    return j({ access_token:'tok-dx' })
  }
  if(u.pathname.includes('/functions/v1/'))return r.fulfill({status:400,contentType:'application/json',
    body:JSON.stringify({ error:'no' })})
  return j([]) })
await ctx.route('**://www.googleapis.com/**', r => {
  const q = r.request(); const u = new URL(q.url())
  const j=x=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)})
  const bearer = (q.headers()['authorization'] || '').replace('Bearer ', '')
  const m = u.pathname.match(/calendars\/([^/]+)\/events/)
  if (m && q.method() === 'POST') {
    posts.push({ calendarId: decodeURIComponent(m[1]), bearer })
    return j({ id: 'ev-' + posts.length })
  }
  if (u.pathname.endsWith('/events')) return j({ items: [] })
  if (u.pathname.includes('/users/me/calendarList')) return j({ items: [] })
  return j({})
})
await ctx.addInitScript(([s, day, A, B, which])=>{try{
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({state:{activeModule:'tasks',themeId:'sunlit-bento'},version:0}))
  localStorage.setItem('google_provider_token', 'tok-primary')
  localStorage.setItem('google_provider_token_saved_at', String(Date.now()))
  localStorage.setItem('professor-companies', JSON.stringify([
    // Bound to a connected account, NO calendar of its own — the dangerous shape.
    { id:'teradix', name:'Teradix', color:'#3B82F6', accountId:A },
    // Bound to a connected account WITH its own calendar.
    { id:'dx', name:'DX', color:'#0C8140', accountId:B, calendarId:'dx-cal@group.calendar.google.com' },
  ]))
  localStorage.setItem('professor-connected-accounts', JSON.stringify([
    // No usable token: the hour has passed, or the browser was signed out and back in.
    { id:A, email:'ops@teradix.com', name:'Teradix', providerToken:'', isPrimary:false },
    { id:B, email:'ops@dx.com', name:'DX', providerToken:'tok-dx', providerTokenSavedAt:Date.now(), isPrimary:false },
  ]))
  const all = [
    // No calendar of its own and a dead token: the shape where a fallback to the
    // primary token writes into YOUR diary rather than failing.
    { id:'t-teradix', title:'Send Teradix the signed annex', company:'teradix', companyId:'teradix',
      quadrant:'schedule', status:'open', completed:false, dueDate:day,
      duration:60, createdAt:new Date().toISOString() },
    { id:'t-dx', title:'DX quarterly pack', company:'dx', companyId:'dx',
      quadrant:'schedule', status:'open', completed:false, dueDate:day,
      ...(which === 'planner-ok' ? {} : { plannedTime:'14:00' }),
      duration:60, createdAt:new Date().toISOString() },
  ]
  // In planner mode only the Teradix task is seeded, so any POST at all is
  // unambiguously the drag's — the auto-push refuses that account.
  localStorage.setItem('professor-tasks', JSON.stringify({ state:{
    tasks: which === 'planner' ? [all[0]] : which === 'planner-ok' ? [all[1]] : all,
    activities:[] }, version:0 }))
}catch{}},[session, today, ACC_A, ACC_B, WHICH])
const p = await ctx.newPage()
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0,160)))
p.on('dialog', d => d.accept())
await p.goto('http://localhost:5199/BPA/',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(7000)
let fails=0
const ok=(n,c,x='')=>{console.log(`${c?'PASS':'*** FAIL ***'}  [${WHICH}] ${n}${x?'  '+x:''}`); if(!c)fails++}
const show = () => posts.map(x=>`${x.calendarId}<-${x.bearer||'(none)'}`).join(' · ') || '(no POST)'

if (WHICH === 'panel') {
  // The detail panel's calendar row — the same call App's auto-push makes.
  for (const title of ['Send Teradix the signed annex', 'DX quarterly pack']) {
    const row = p.locator('[data-task-node]').filter({ hasText: title }).last()
    if (await row.count()) { await row.click(); await p.waitForTimeout(1200) }
    const add = p.getByRole('button', { name: /add it to|put it on|schedule/i }).first()
    if (await add.count()) { await add.click(); await p.waitForTimeout(2500) }
    const close = p.getByTitle('Close').first()
    if (await close.count()) { await close.click(); await p.waitForTimeout(500) }
  }
}

if (WHICH === 'planner' || WHICH === 'planner-ok') {
  const plan = p.getByRole('button', { name: /Plan my day/i }).first()
  ok('the planner opens', await plan.count() > 0)
  await plan.click(); await p.waitForTimeout(2500)

  // A droppable hour row is a bare div, so find it by its hour label and drop
  // into the lane beside it. Past hours are disabled, so pick a live row.
  const target = await p.evaluate(() => {
    const spans = [...document.querySelectorAll('span')]
      .filter(x => /^\d{1,2}\s?(AM|PM)$/i.test((x.textContent||'').trim()))
    for (const sp of spans) {
      const row = sp.parentElement?.parentElement
      if (!row) continue
      const cs = getComputedStyle(row)
      if (cs.opacity === '1') {
        const r = row.getBoundingClientRect()
        if (r.height > 20 && r.top > 80) return { x: r.x + r.width * 0.6, y: r.y + r.height / 2, label: (sp.textContent||'').trim() }
      }
    }
    return null
  })
  ok('a live hour row was found to drop on', !!target, target ? target.label : 'none')
  // The Tasks board behind the planner holds a card with the same title, so
  // pick the draggable by geometry: the planner's own list is its right column.
  const a = await p.evaluate(title => {
    const hit = [...document.querySelectorAll('*')].filter(el =>
      (el.textContent||'').includes(title) && el.children.length === 0)
    for (const el of hit) {
      // Walk up to the draggable card dnd-kit put its listeners on.
      let n = el
      for (let i = 0; i < 6 && n; i++, n = n.parentElement) {
        const r = n.getBoundingClientRect()
        if (r.width > 140 && r.height > 28 && r.x > window.innerWidth * 0.5)
          return { x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height }
      }
    }
    return null
  }, WHICH === 'planner-ok' ? 'DX quarterly pack' : 'Send Teradix the signed annex')
  ok('the task is in the planner list', !!a, a ? `at ${Math.round(a.x)},${Math.round(a.y)}` : 'not found')
  if (a) console.log('  [card]', JSON.stringify(a), '[drop]', JSON.stringify(target))
  if (a && target) {
    await p.mouse.move(a.x, a.y)
    await p.mouse.down()
    await p.mouse.move(a.x - 14, a.y + 14, { steps: 5 })
    await p.waitForTimeout(300)
    const engaged = await p.evaluate(() =>
      [...document.querySelectorAll('*')].some(el => getComputedStyle(el).opacity === '0.4'))
    console.log('  [mid-drag] dnd-kit engaged:', engaged)
    await p.mouse.move(target.x, target.y, { steps: 20 })
    await p.waitForTimeout(300)
    await p.mouse.up()
    await p.waitForTimeout(3500)
  }
  const planned = await p.evaluate(() =>
    (JSON.parse(localStorage.getItem('professor-tasks')||'{}').state?.tasks||[])[0]?.plannedTime ?? null)
  ok('the drag actually planned it', !!planned, `plannedTime=${JSON.stringify(planned)}`)
}

// ── What must be true, whichever door was used ────────────────────────────────
//
// `ops@teradix.com` cannot be refreshed in this fixture, so the ONLY correct
// outcome for its task is that nothing is written. A write bearing any token
// other than one obtained for that address is a write to somebody else's
// diary — and with `calendarId: 'primary'` it is specifically yours.
const foreign = posts.filter(x => x.bearer !== 'tok-dx')
ok('the task of an account that cannot be opened is not written anywhere else',
   foreign.length === 0, show())
ok('and in particular not to `primary` on the signed-in account',
   !posts.some(x => x.calendarId === 'primary' && x.bearer !== 'tok-dx'), show())
const dxPost = posts.find(x => x.calendarId === 'dx-cal@group.calendar.google.com')
if (WHICH === 'panel' || WHICH === 'planner-ok') {
  ok('DX went to DX\u2019s calendar with DX\u2019s token', !!dxPost && dxPost.bearer === 'tok-dx', show())
}

console.log('  posts:', show())
console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails?1:0)

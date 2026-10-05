// node scripts/completion-sticks.mjs
// Needs a dev server on 5199.
//
// Tick a task done and it comes back a moment later. `toggleComplete` and
// `setStatus` call `saveTasksToDB` DIRECTLY rather than through
// `scheduleDbSync`, so neither of the two things that protect an edit happens:
//   · `markTasksDirty(next, [id])` — without it the id is not in
//     `professor-tasks-edited`, and `loadFromDB`'s merge is
//     `edited.has(id) ? {...fromDb, ...t} : {...t, ...fromDb}`, so **the
//     server wins every field**, including `completed`.
//   · `markLocalWrite('tasks')` — without it liveSync's 3s quiet window is
//     never armed, so a poll, a focus pull or another device's Realtime event
//     reloads immediately, before the write has landed.
// The comment above the call says "Save immediately — debouncing risks losing
// the change if user refreshes", which is true; swapping the debounce out took
// the bookkeeping with it.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
const U = user.id
const today = new Date().toISOString().slice(0, 10)
// How long the server takes to accept the write. A real round trip, and the
// window the reload has to land in.
const WRITE_MS = Number(process.env.WRITE_MS ?? 2500)
let stored = [{
  id: 'tk-1', user_id: U, company_id: null, title: 'Water the office plants',
  description: null, quadrant: 'important_not_urgent', effort_minutes: null, due_date: null,
  status: 'todo', delegated_to: null, done_looks_like: null,
  created_at: new Date().toISOString(), completed_at: null,
  planned_time: null, owner_id: null, company_tag: null, completed: false,
  task_type: 'research', priority: null, board_status: null, calendar_id: null,
  gcal_event_id: null, parent_task_id: null, captured_via: null, urgent: false,
  checklist: [], attachments: [], links: [],
}]
let upserts = 0
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox','--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors:true, viewport:{ width:1600, height:1000 } })
await ctx.route('**://placeholder.supabase.co/**', async r => { const q=r.request(); const u=new URL(q.url())
  const j=x=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)})
  if(u.pathname==='/auth/v1/user')return j(user)
  if(u.pathname.startsWith('/auth/v1/token'))return j({...session})
  if(u.pathname.startsWith('/auth/v1'))return j({})
  if(u.pathname.endsWith('/tasks')){
    if(q.method()==='GET') return j(u.searchParams.get('select')==='id' ? stored.map(x=>({id:x.id})) : stored)
    if(q.method()==='DELETE') return j([])
    // A real write: accepted, and visible to the next GET — but only once it
    // has actually landed.
    upserts++
    const body = JSON.parse(q.postData() || '[]')
    await new Promise(res => setTimeout(res, WRITE_MS))
    for (const row of body) {
      const at = stored.findIndex(x => x.id === row.id)
      if (at >= 0) stored[at] = { ...stored[at], ...row }; else stored.push(row)
    }
    return j([])
  }
  return j([]) })
await ctx.addInitScript(s=>{try{
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({state:{activeModule:'tasks',themeId:'sunlit-bento'},version:0}))
  localStorage.setItem('task-view-mode','list')
}catch{}},session)
const p = await ctx.newPage()
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0,160)))
await p.goto('http://localhost:5199/BPA/',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(6500)
let fails=0
const ok=(n,c,x='')=>{console.log(`${c?'PASS':'*** FAIL ***'}  ${n}${x?'  '+x:''}`); if(!c)fails++}
const mine = () => p.evaluate(() => {
  const t = (JSON.parse(localStorage.getItem('professor-tasks')||'{}').state?.tasks||[])[0]
  return t ? { completed: !!t.completed, status: t.status } : null
})
const edited = () => p.evaluate(() => {
  try { return JSON.parse(localStorage.getItem('professor-tasks-edited')||'[]') } catch { return [] }
})

ok('the task hydrated, not done', (await mine())?.completed === false)

// Tick it the way the row does.
const tick = p.locator('[data-task-node]').filter({ hasText: 'Water the office plants' })
  .last().getByTitle('Complete').first()
ok('the row offers Complete', await tick.count() === 1, `${await tick.count()} match(es)`)
const box = await tick.boundingBox()
await p.mouse.move(box.x + box.width/2, box.y + box.height/2)
await p.mouse.down(); await p.waitForTimeout(60); await p.mouse.up()
await p.waitForTimeout(900)
ok('it reads as done straight away', (await mine())?.completed === true, JSON.stringify(await mine()))
ok('and the edit is claimed as unpushed', (await edited()).includes('tk-1'),
   `professor-tasks-edited = ${JSON.stringify(await edited())}`)

// Come back to the tab, the way you do. liveSync pulls on focus.
await p.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')) })
await p.waitForTimeout(1200)
ok('it is STILL done while the write is in flight', (await mine())?.completed === true,
   JSON.stringify(await mine()))

// Let the write land and everything settle.
await p.waitForTimeout(WRITE_MS + 3000)
await p.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')) })
await p.waitForTimeout(3000)
ok('and still done once it has landed', (await mine())?.completed === true, JSON.stringify(await mine()))
ok('the server agrees', stored[0].completed === true, `server completed=${stored[0].completed}`)
console.log(`  ${upserts} upsert(s)`)

console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails?1:0)

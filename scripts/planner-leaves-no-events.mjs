// node scripts/planner-leaves-no-events.mjs [remove|leftover|refuses]
// Needs a dev server on 5199.
//
// Removing a task from the plan must take its calendar event with it, and an
// event left behind by the old code must be removable from the grid. The
// control is the same file before the fix: the block leaves the grid and NO
// DELETE is sent, which is the orphan this exists to stop.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
const MODE = process.argv[2] ?? 'remove'        // remove | leftover | refuses
const U = user.id
const TODAY = new Date().toISOString().slice(0,10)
const H = 10
const TASKS = [{ id:'t1', user_id:U, title:'OWI Bulk Closure Fields', quadrant:'do', company_tag:'personal',
  status:'open', completed:false, priority:'P0', effort_minutes:60, created_at:'2026-09-01T09:00:00Z',
  ...(MODE==='remove' ? { due_date:TODAY, planned_time:`${H}:00`, board_status:'planned', gcal_event_id:'ev-planner-1' } : {}) }]
// The event the planner made. `📋` + the note header is what isTaskEvent reads.
const EVENT = { id:'ev-planner-1', status:'confirmed', summary:'📋 OWI Bulk Closure Fields',
  description:'— Scheduled from a task in The Professor —\nTask: OWI Bulk Closure Fields',
  start:{ dateTime:`${TODAY}T${String(H).padStart(2,'0')}:00:00+03:00` },
  end:{ dateTime:`${TODAY}T${String(H+1).padStart(2,'0')}:00:00+03:00` } }
const deletes = []
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox','--ignore-certificate-errors']})
const ctx=await b.newContext({ignoreHTTPSErrors:true,viewport:{width:1500,height:950}})
await ctx.route('**://placeholder.supabase.co/**',r=>{const q=r.request(); const u=new URL(q.url())
 const j=x=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)})
 if(u.pathname==='/auth/v1/user')return j(user)
 if(u.pathname.startsWith('/auth/v1/token'))return j({...session})
 if(u.pathname.startsWith('/auth/v1'))return j({})
 if(u.pathname.endsWith('/tasks')&&q.method()==='GET')return j(TASKS)
 if(u.pathname.endsWith('/tasks'))return j([])
 return j([])})
await ctx.route('**://www.googleapis.com/**', r=>{
  const q=r.request(); const u=new URL(q.url())
  const j=x=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)})
  if (u.pathname.includes('/users/me/calendarList'))
    return j({ items:[{ id:'primary', summary:user.email, primary:true, accessRole:'owner', backgroundColor:'#3B82F6', selected:true }] })
  if (u.pathname.includes('/events')) {
    if (q.method()==='DELETE') { deletes.push(u.pathname)
      return MODE==='refuses'
        ? r.fulfill({status:403,contentType:'application/json',body:'{"error":{"message":"forbiddenForNonOrganizer"}}'})
        : r.fulfill({status:204,body:''}) }
    if (q.method()==='POST') return j({ ...EVENT, id:'ev-new' })
    return j({ items:[EVENT] })
  }
  return j({})
})
await ctx.route('**://oauth2.googleapis.com/**', r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}))
await ctx.addInitScript(s=>{try{
 localStorage.setItem('sb-placeholder-auth-token',JSON.stringify(s))
 localStorage.setItem('professor-ui',JSON.stringify({state:{activeModule:'tasks',themeId:'sunlit-bento'},version:0}))
 localStorage.setItem('google_provider_token','stub-token')
 localStorage.setItem('google_provider_token_saved_at',String(Date.now()))
}catch{}},session)
const p=await ctx.newPage()
p.on('dialog', d => d.accept())
p.on('pageerror',e=>console.log('  [pageerror]',String(e).slice(0,160)))
await p.goto('http://localhost:5199/BPA/',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(5500)
const ok=(n,c,x='')=>{console.log(`${c?'PASS':'*** FAIL ***'}  [${MODE}] ${n}${x?'  '+x:''}`); if(!c)process.exitCode=1}
await p.getByRole('button',{name:/Plan my day/i}).first().click(); await p.waitForTimeout(2500)
const grid = () => p.evaluate(()=>document.body.innerText)
ok('the planner opens', /Smart Day Planner/.test(await grid()))
ok('the block is on the grid', /OWI Bulk Closure Fields/.test(await grid()))
const chip = /left over/i.test(await grid())
if (MODE === 'remove') {
  ok('a claimed event is NOT called left over', !chip)
  const named = p.getByRole('button',{name:/Take ".*" off the plan/}).first()
  const hasNamed = await named.count() > 0
  ok('the block carries a named remove control', hasNamed)
  // Fall back to the bare × so the control run reaches the DELETE assertion
  // on the code before this fix, where the button had no accessible name.
  const rm = hasNamed ? named
    : p.locator('button').filter({ hasText: /^×$/ }).first()
  if (await rm.count()) { await rm.click(); await p.waitForTimeout(1800) }
  else console.log('   no remove control at all')
} else {
  ok('an unclaimed planner event is marked left over', chip)
  const rm = p.getByRole('button',{name:/Remove ".*" from your calendar/}).first()
  ok('and offers to be removed', await rm.count() > 0)
  await rm.click(); await p.waitForTimeout(1800)
}
const after = await grid()
ok('a DELETE reached Google for that event',
   deletes.length === 1 && deletes[0].endsWith('/events/ev-planner-1'), JSON.stringify(deletes))
ok('the planner is still open', /Smart Day Planner/.test(after))
if (MODE === 'refuses') {
  ok('the block is NOT claimed gone when Google refused', /OWI Bulk Closure Fields/.test(after))
  ok('and it says so', /[Cc]ould not remove/.test(after), after.replace(/\n+/g,' | ').slice(0,200))
} else {
  ok('the event is off the grid', !/OWI Bulk Closure Fields/.test(after.split('Tasks')[0] ?? after))
}
await b.close()

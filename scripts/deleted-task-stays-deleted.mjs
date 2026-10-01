// node scripts/deleted-task-stays-deleted.mjs
// Needs a dev server on 5199.
//
// A task deleted here is removed from the store and the push that would delete
// it on the server is 1.5s behind. Nothing anywhere records that it was
// deleted — so `loadFromDB`'s `dbOnly` pass, which appends EVERY server row
// not present locally, hands it straight back, and the hydration push then
// writes the resurrection back out. Offline, a refused push, a tab closed
// inside the window, or a second device reloading first all land here.
//
// A **completed** task is hidden from the board, so the only place its return
// is visible is the Tasks banner: "N closed" over the last six days goes back
// up by one for a task you deleted.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
const U = user.id
const iso = (d) => d.toISOString().slice(0, 10)
const today = new Date()
// Whether the push to the server is allowed to succeed. A refused push is the
// deterministic half of the race, and it is a real case: offline, an expired
// token, an RLS refusal.
const MODE = process.argv[2] ?? 'refused'   // refused | push | undo
const PUSH = MODE === 'push'
const row = (id, title, done) => ({
  id, user_id: U, company_id: null, title, description: null,
  quadrant: 'schedule', effort_minutes: null, due_date: null,
  status: done ? 'done' : 'open', delegated_to: null, done_looks_like: null,
  created_at: today.toISOString(),
  completed_at: done ? `${iso(today)}T12:00:00Z` : null,
  planned_time: null, owner_id: null, company_tag: null, completed: !!done,
  task_type: null, priority: null, board_status: done ? 'done' : 'doing',
  calendar_id: null, gcal_event_id: null, parent_task_id: null,
  captured_via: null, urgent: false, checklist: [], attachments: [], links: [],
})
const GONE = 'Send KFAS the signed annex'
let rows = [row('11111111-0000-4000-8000-000000000001', GONE, true),
            row('11111111-0000-4000-8000-000000000002', 'Draft the Q4 board note', false)]
let deletes = 0
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox','--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors:true, viewport:{ width:1600, height:1000 } })
await ctx.route('**://placeholder.supabase.co/**', r => { const q=r.request(); const u=new URL(q.url())
  const j=(x,s=200)=>r.fulfill({status:s,contentType:'application/json',body:JSON.stringify(x)})
  if(u.pathname==='/auth/v1/user')return j(user)
  if(u.pathname.startsWith('/auth/v1/token'))return j({...session})
  if(u.pathname.startsWith('/auth/v1'))return j({})
  if(u.pathname.endsWith('/tasks')){
    if(q.method()==='GET') return j(u.searchParams.get('select')==='id' ? rows.map(x=>({id:x.id})) : rows)
    if(q.method()==='DELETE'){
      deletes++
      if(!PUSH) return j({ message:'permission denied for table tasks' }, 403)
      // The real delete: ?id=in.(…)
      const m=(u.searchParams.get('id')||'').match(/\(([^)]*)\)/)
      const ids=new Set((m?m[1]:'').split(',').map(s=>s.replace(/"/g,'').trim()))
      rows = rows.filter(x=>!ids.has(x.id))
      return j([])
    }
    if(!PUSH) return j({ message:'permission denied for table tasks' }, 403)
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
p.on('dialog', d => d.accept())
await p.goto('http://localhost:5199/BPA/',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(6000)
let fails=0
const ok=(n,c,x='')=>{console.log(`${c?'PASS':'*** FAIL ***'}  [${MODE}] ${n}${x?'  '+x:''}`); if(!c)fails++}

const store = () => p.evaluate(() =>
  (JSON.parse(localStorage.getItem('professor-tasks')||'{}').state?.tasks||[]))
// "N closed" in the Tasks banner, which is the chart the count is read off.
const closed = () => p.evaluate(() => {
  const m = (document.body.innerText||'').match(/(\d+)\s+closed/)
  return m ? Number(m[1]) : -1
})

ok('both tasks hydrated', (await store()).length === 2, `${(await store()).length}`)
ok('the chart counts the completed one', await closed() === 1, `${await closed()} closed`)

// Delete it from its own row — the row's trash, not another task's.
const theRow = p.locator('[data-task-node]').filter({ hasText: GONE }).last()
ok('the completed task is reachable in the list', await theRow.count() === 1,
   `${await theRow.count()} row(s)`)
const trash = theRow.getByTitle('Delete task').first()
await trash.click(); await p.waitForTimeout(1200)
ok('it is gone from the store', !(await store()).some(t => t.title === GONE),
   (await store()).map(t=>t.title).join(' · ') || '(empty)')
ok('and out of the chart', await closed() === 0, `${await closed()} closed`)

// ⌘Z must lift the tombstone, or undo restores the task for as long as it
// takes the next reload to kill it again — which is worse than no undo.
if (MODE === 'undo') {
  await p.keyboard.press('Control+z'); await p.waitForTimeout(1200)
  ok('undo brings it back', (await store()).some(t => t.title === GONE),
     (await store()).map(t=>t.title).join(' · ') || '(empty)')
  ok('and the chart counts it again', await closed() === 1, `${await closed()} closed`)
}

// Give the push its 1.5s, then make the app reload from the server the way
// liveSync does when the tab comes back.
await p.waitForTimeout(4500)
await p.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')) })
await p.waitForTimeout(5000)

const after = await store()
const want = MODE === 'undo'
ok(want ? 'it is still there after a reload' : 'it does not come back',
   after.some(t => t.title === GONE) === want,
   after.map(t=>t.title).join(' · ') || '(empty)')
ok(`the chart still says ${want ? 1 : 0} closed`, await closed() === (want ? 1 : 0),
   `${await closed()} closed`)
ok('the other task is untouched', after.some(t => t.title === 'Draft the Q4 board note'))
if (PUSH) ok('the server was told to delete it', deletes > 0, `${deletes} DELETE(s)`)

console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails?1:0)

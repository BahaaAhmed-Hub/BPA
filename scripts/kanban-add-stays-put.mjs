// node scripts/kanban-add-stays-put.mjs [status|company|owner|type|scheduled]
// Needs a dev server on 5199.
//
// A task typed into a column must stay in that column. commitAdd wrote
// `quadrant: null` — which is what the brain dump IS — so the status board,
// which draws any dumped task in Brain dump whatever its boardStatus, threw
// every new card straight back to the pile. On the other four boards it wrote
// `boardStatus` for a column that does not mean a status at all, so the card
// joined no column anywhere.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
const BOARD = process.argv[2] ?? 'status'
const U = user.id
const TITLE = 'CTC - KFAS Big Picture Slides'
let written = null
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox','--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors:true, viewport:{ width:1600, height:1000 } })
await ctx.route('**://placeholder.supabase.co/**', r => { const q=r.request(); const u=new URL(q.url())
  const j=x=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)})
  if(u.pathname==='/auth/v1/user')return j(user)
  if(u.pathname.startsWith('/auth/v1/token'))return j({...session})
  if(u.pathname.startsWith('/auth/v1'))return j({})
  if(u.pathname.endsWith('/tasks') && q.method()!=='GET'){ written = q.postData(); return j([]) }
  return j([]) })
await ctx.addInitScript(([s,board])=>{try{
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({state:{activeModule:'tasks',themeId:'sunlit-bento'},version:0}))
  localStorage.setItem('task-board-type', board)
  // Owners come off the companies' own user lists, so the Owners board has
  // only an "Unassigned" column until a company has people on it.
  localStorage.setItem('professor-companies', JSON.stringify([
    { id:'teradix', name:'Teradix', color:'#3B82F6', users:[{ id:'u-omar', name:'Omar' }] },
    { id:'dx',      name:'DX',      color:'#0C8140' },
  ]))
}catch{}},[session,BOARD])
const p = await ctx.newPage()
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0,160)))
await p.goto('http://localhost:5199/BPA/',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(5000)
let fails=0
const ok=(n,c,x='')=>{console.log(`${c?'PASS':'*** FAIL ***'}  [${BOARD}] ${n}${x?'  '+x:''}`); if(!c)fails++}

// Reach the board view.
const boardTab = p.getByRole('button',{name:/^Board$/}).first()
if (await boardTab.count()) { await boardTab.click(); await p.waitForTimeout(1200) }
ok('the board is open', await p.locator('text=Brain dump').count() > 0 || BOARD !== 'status')

// Which column are we adding into? Never the brain dump.
const cols = await p.evaluate(() => [...document.querySelectorAll('button')]
  .filter(x => /Add task/.test(x.textContent||'')).length)
ok('columns offer Add task', cols > 0, `${cols} columns`)
const idx = BOARD === 'status' ? 1 : 0           // status board leads with Brain dump
const addBtns = p.locator('button').filter({ hasText: /Add task/ })
const target = addBtns.nth(idx)
await target.scrollIntoViewIfNeeded(); await target.click(); await p.waitForTimeout(500)
const input = p.locator('input[placeholder="Task title…"]').first()
await input.fill(TITLE); await input.press('Enter'); await p.waitForTimeout(2500)

// Where did it land? Read the store, not the pixels — the card's column is the
// question and the DOM only shows where it was drawn.
const task = await p.evaluate(t => {
  try {
    const raw = JSON.parse(localStorage.getItem('professor-tasks') || '{}')
    const list = raw?.state?.tasks ?? raw?.tasks ?? []
    return list.find(x => x.title === t) ?? null
  } catch { return null }
}, TITLE)
ok('the task was created', !!task, JSON.stringify(task && { q:task.quadrant, bs:task.boardStatus, co:task.companyId, ow:task.owner, ty:task.taskType, due:task.dueDate }))
if (task) {
  ok('it is NOT in the brain dump', task.quadrant != null, `quadrant=${JSON.stringify(task.quadrant)}`)
  if (BOARD === 'status')    ok('it carries the column as its status', !!task.boardStatus, task.boardStatus)
  if (BOARD === 'company')   ok('it carries the column as its company', !!task.companyId, task.companyId)
  // The Unassigned column means exactly no owner, so only a real owner column
  // can prove the field is carried.
  if (BOARD === 'owner')     ok('it carries the column as its owner', task.owner === 'u-omar', String(task.owner))
  if (BOARD === 'type')      ok('it carries the column as its type', !!task.taskType, task.taskType)
  if (BOARD === 'scheduled') ok('it carries the column as a date', 'dueDate' in task, String(task.dueDate))
}
// And it is drawn where it was typed, not in Brain dump.
const inDump = await p.evaluate(t => {
  const heads = [...document.querySelectorAll('*')].filter(e => e.children.length===0 && /Brain dump/.test(e.textContent||''))
  if (!heads.length) return false
  let col = heads[0]; for (let i=0;i<6 && col;i++) { if (/Add task/.test(col.textContent||'')) break; col = col.parentElement }
  return !!col && new RegExp(t.slice(0,18).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).test(col.textContent||'')
}, TITLE)
ok('and it is not drawn in the Brain dump column', !inDump)
ok('it reached the server', !!written && written.includes('KFAS'), written ? 'yes' : 'no write seen')
console.log(fails ? `\n${fails} failing` : '\nall green')
await b.close(); process.exit(fails?1:0)

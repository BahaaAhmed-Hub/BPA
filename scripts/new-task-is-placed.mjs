// node scripts/new-task-is-placed.mjs
// Needs a dev server on 5199.
//
// "New task" in the Tasks header made a task with `quadrant: null` — which is
// what the brain dump IS — and then opened the detail panel on it. So the one
// gesture that says "I am deciding about this right now" filed it in the pile
// of things not yet thought about, and nothing but a due date ever moved it
// out again. Naming it, giving it a company, a priority or an owner all left
// it in Brain dump.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
const U = user.id
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
await ctx.addInitScript(s=>{try{
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({state:{activeModule:'tasks',themeId:'sunlit-bento'},version:0}))
  localStorage.setItem('professor-companies', JSON.stringify([
    { id:'teradix', name:'Teradix', color:'#3B82F6' },
  ]))
}catch{}},session)
const p = await ctx.newPage()
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0,160)))
await p.goto('http://localhost:5199/BPA/',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(5000)
let fails=0
const ok=(n,c,x='')=>{console.log(`${c?'PASS':'*** FAIL ***'}  ${n}${x?'  '+x:''}`); if(!c)fails++}

const before = await p.evaluate(u => {
  try { return (JSON.parse(localStorage.getItem(`professor-tasks`)||'{}').state?.tasks||[]).length } catch { return 0 }
}, U)

const btn = p.getByRole('button',{name:/^New task$/}).first()
ok('the header offers New task', await btn.count() > 0)
await btn.click(); await p.waitForTimeout(1500)

const newest = await p.evaluate(u => {
  const all = JSON.parse(localStorage.getItem(`professor-tasks`)||'{}').state?.tasks||[]
  return [...all].sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0] ?? null
}, U)
ok('a task was made', !!newest && (await p.evaluate(u => (JSON.parse(localStorage.getItem(`professor-tasks`)||'{}').state?.tasks||[]).length, U)) === before + 1)
ok('it is NOT in the brain dump', !!newest && newest.quadrant != null,
   `quadrant=${JSON.stringify(newest?.quadrant)}`)

// The detail panel is open on it — naming it must not send it anywhere either.
const title = p.locator('input[placeholder*="task" i], textarea').first()
if (await title.count()) { await title.fill('CTC — KFAS big picture slides'); await p.waitForTimeout(1600) }
const after = await p.evaluate(id => {
  const u = JSON.parse(localStorage.getItem('professor-ui')||'{}')
  void u
  return null
}, null)
void after
const named = await p.evaluate(([u,id]) => (JSON.parse(localStorage.getItem(`professor-tasks`)||'{}').state?.tasks||[]).find(t=>t.id===id)??null, [U, newest?.id])
ok('naming it leaves it where it is', !!named && named.quadrant != null,
   `quadrant=${JSON.stringify(named?.quadrant)} title=${JSON.stringify(named?.title)}`)

// And it reached the server with that quadrant, not a null one.
ok('the row written to the server carries the quadrant',
   !!written && !/"quadrant":null/.test(written.slice(0,4000)) ,
   written ? written.slice(0,160) : 'nothing written')

console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails?1:0)

// node scripts/on-fire-agrees.mjs
// Needs a dev server on 5199.
//
// The banner says ON FIRE 1 and the board draws two burning flames. They read
// the same field and disagree about the SET: the banner counts only open work
// (`!completed && status !== 'cancelled'`), while the matrix draws every task
// in a quadrant — `hideCompleted` is false by default — and `TaskCard` dims
// only `completed`. So a **cancelled** task is drawn at full strength with a
// full-strength red flame and is in no count: a number beside a thing it does
// not describe.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
const T = (id, title, extra) => ({
  id, title, company: 'personal', quadrant: 'do', status: 'open',
  completed: false, urgent: true, createdAt: new Date().toISOString(), ...extra,
})
const tasks = [
  T('f-open',      'Reply to the KFAS annex'),
  T('f-cancelled', 'Chase the old supplier quote', { status: 'cancelled' }),
  T('f-done',      'Send the signed NDA',          { status: 'done' }),
  T('f-completed', 'Book the Cairo flights',       { completed: true, completedAt: new Date().toISOString().slice(0,10) }),
  T('calm',        'Draft the Q4 board note',      { urgent: false }),
]
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox','--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors:true, viewport:{ width:1700, height:1100 } })
await ctx.route('**://placeholder.supabase.co/**', r => { const q=r.request(); const u=new URL(q.url())
  const j=x=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)})
  if(u.pathname==='/auth/v1/user')return j(user)
  if(u.pathname.startsWith('/auth/v1/token'))return j({...session})
  if(u.pathname.startsWith('/auth/v1'))return j({})
  return j([]) })
await ctx.addInitScript(([s, ts])=>{try{
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({state:{activeModule:'tasks',themeId:'sunlit-bento'},version:0}))
  localStorage.setItem('task-view-mode','matrix')
  localStorage.setItem('professor-tasks', JSON.stringify({ state:{ tasks: ts, activities:[] }, version:0 }))
}catch{}},[session, tasks])
const p = await ctx.newPage()
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0,160)))
await p.goto('http://localhost:5199/BPA/',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(6500)
let fails=0
const ok=(n,c,x='')=>{console.log(`${c?'PASS':'*** FAIL ***'}  ${n}${x?'  '+x:''}`); if(!c)fails++}

// What the banner claims.
const banner = await p.evaluate(() => {
  const m = (document.body.innerText||'').match(/ON FIRE\s*\n?\s*(\d+)/i)
  return m ? Number(m[1]) : -1
})
// What the screen actually draws: a flame whose own title says it is burning.
const lit = await p.evaluate(() =>
  document.querySelectorAll('[title="On fire — click to clear"]').length)
// …and which tasks those flames belong to.
const whose = await p.evaluate(() =>
  [...document.querySelectorAll('[title="On fire — click to clear"]')].map(el => {
    let n = el
    for (let i = 0; i < 8 && n; i++, n = n.parentElement) {
      const t = (n.innerText||'').split('\n')[0]?.trim()
      if (t && t.length > 8) return t
    }
    return '?'
  }))

console.log('  banner says', banner, '· flames drawn', lit)
console.log('  flames on:', whose.join(' · '))
ok('the count and the screen agree', banner === lit, `${banner} counted, ${lit} drawn`)
ok('a cancelled task is not shown as on fire',
   !whose.some(t => /old supplier quote/i.test(t)), whose.join(' · '))
ok('a task marked done is not shown as on fire',
   !whose.some(t => /signed NDA/i.test(t)), whose.join(' · '))
ok('a completed task is not shown as on fire',
   !whose.some(t => /Cairo flights/i.test(t)), whose.join(' · '))
ok('the one open urgent task still is', whose.some(t => /KFAS annex/i.test(t)), whose.join(' · '))
ok('and the count is that one', banner === 1, String(banner))

console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails?1:0)

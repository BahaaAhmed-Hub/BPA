// node scripts/deleted-habit-stays-deleted.mjs [refused|push]
// Needs a dev server on 5199.
//
// The same hole as `deleted-task-stays-deleted`, one store along. Deleting a
// habit takes it out of the list and leaves the push 1.5s behind, and `dirty`
// cannot record it — the habit is not in the list being pushed. Meanwhile
// `loadFromDB` builds its merge from **every** row the server sends, so any
// reload inside that window brings the habit back, and with it the whole
// history keyed under its id. Every figure on the screen counts `habits`, so
// the deleted habit is back in the stats.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
const U = user.id
const MODE = process.argv[2] ?? 'refused'
const PUSH = MODE === 'push'
const today = new Date().toISOString().slice(0, 10)
const KEEP = 'Morning pages'
const GONE = 'Stretch for ten minutes'
const hab = (id, name) => ({
  id, user_id: U, name, frequency: 'daily', is_active: true,
  current_streak: 0, longest_streak: 0, emoji: '🎯', color: '#3B82F6',
  type: 'boolean', goal: null, unit: null, image: null,
  created_at: '2026-01-01T00:00:00Z',
})
const A = '22222222-0000-4000-8000-00000000000a'
const B = '22222222-0000-4000-8000-00000000000b'
let rows = [hab(A, KEEP), hab(B, GONE)]
// Only the one we keep is logged today, so the headline is 50% with both and
// 100% with one — the deleted habit's return is a number you can read.
const logs = [{ id: 'l1', user_id: U, habit_id: A, date: today, quantity: null, completed: true }]
let deletes = 0
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox','--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors:true, viewport:{ width:1600, height:1000 } })
await ctx.route('**://placeholder.supabase.co/**', r => { const q=r.request(); const u=new URL(q.url())
  const j=(x,s=200)=>r.fulfill({status:s,contentType:'application/json',body:JSON.stringify(x)})
  if(u.pathname==='/auth/v1/user')return j(user)
  if(u.pathname.startsWith('/auth/v1/token'))return j({...session})
  if(u.pathname.startsWith('/auth/v1'))return j({})
  if(u.pathname.endsWith('/habits')){
    if(q.method()==='GET') return j(u.searchParams.get('select')==='id' ? rows.map(x=>({id:x.id})) : rows)
    if(q.method()==='DELETE'){
      deletes++
      if(!PUSH) return j({ message:'permission denied for table habits' }, 403)
      const m=(u.searchParams.get('id')||'').match(/\(([^)]*)\)/)
      const ids=new Set((m?m[1]:'').split(',').map(s=>s.replace(/"/g,'').trim()))
      rows = rows.filter(x=>!ids.has(x.id))
      return j([])
    }
    if(!PUSH) return j({ message:'permission denied for table habits' }, 403)
    return j([])
  }
  if(u.pathname.endsWith('/habit_logs')) return j(q.method()==='GET' ? logs : [])
  return j([]) })
await ctx.addInitScript(s=>{try{
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({state:{activeModule:'habits',themeId:'sunlit-bento'},version:0}))
}catch{}},session)
const p = await ctx.newPage()
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0,160)))
p.on('dialog', d => d.accept())
await p.goto('http://localhost:5199/BPA/',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(6500)
let fails=0
const ok=(n,c,x='')=>{console.log(`${c?'PASS':'*** FAIL ***'}  [${MODE}] ${n}${x?'  '+x:''}`); if(!c)fails++}

const names = () => p.evaluate(() => {
  try { return (JSON.parse(localStorage.getItem('professor-habits')||'[]')).map(h=>h.name) } catch { return [] }
})
// The headline: "N% of today done" — the stat a deleted habit must leave.
const pct = () => p.evaluate(() => {
  const m = (document.body.innerText||'').match(/(\d+)%\s+of\s+today\s+done/)
  return m ? Number(m[1]) : -1
})

ok('both habits hydrated', (await names()).length === 2, (await names()).join(' · '))
ok('one of two is done today', await pct() === 50, `${await pct()}%`)

// Delete it from its own row.
const trash = p.getByTitle('Delete', { exact: true }).nth(1)
ok('the row offers Delete', await trash.count() >= 1, `${await p.getByTitle('Delete',{exact:true}).count()} delete control(s)`)
await trash.click(); await p.waitForTimeout(1500)
ok('it is gone from the list', !(await names()).includes(GONE), (await names()).join(' · ') || '(empty)')
ok('and the stat is of what is left', await pct() === 100, `${await pct()}%`)

// Past the push, then the reload liveSync does when the tab comes back.
await p.waitForTimeout(4500)
await p.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')) })
await p.waitForTimeout(5000)

const after = await names()
ok('it does not come back', !after.includes(GONE), after.join(' · ') || '(empty)')
ok('the stat still reads 100%', await pct() === 100, `${await pct()}%`)
ok('the other habit is untouched', after.includes(KEEP))
if (PUSH) ok('the server was told to delete it', deletes > 0, `${deletes} DELETE(s)`)

console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails?1:0)

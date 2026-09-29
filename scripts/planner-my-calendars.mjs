// node scripts/planner-my-calendars.mjs — needs a dev server on 5199.
//
// "My calendars only" must keep every account's OWN main calendar. The
// complaint was a DX event that appeared only with the filter off: DX's own
// main calendar was falling out along with the colleagues' shared ones.
// The fixture deliberately includes a colleague's calendar on which I hold
// `owner`, because sharing can grant that and the role therefore says nothing
// about whose calendar it is.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
const TODAY = new Date().toISOString().slice(0,10)
const ME = user.email                     // the signed-in account
const DX = 'bahaa.ahmed@dx-technologies.net'
// The cache CalendarIntelligence writes, with the fields this file used to drop.
const CACHE = [
  { id: ME,  summary:'Me',      accountEmail: ME, primary:true,  accessRole:'owner',  backgroundColor:'#3B82F6' },
  { id: DX,  summary:'DX',      accountEmail: DX, primary:true,  accessRole:'owner',  backgroundColor:'#0C8140' },
  { id:'colleague@dx-technologies.net', summary:'Omar', accountEmail: DX, accessRole:'owner',  backgroundColor:'#C62828' },
  { id:'reader@dx-technologies.net',    summary:'Hala', accountEmail: DX, accessRole:'reader', backgroundColor:'#F5D14E' },
  { id:'c_mine123@group.calendar.google.com', summary:'DX Projects', accountEmail: DX, accessRole:'owner',  backgroundColor:'#6C6553' },
  { id:'c_team999@group.calendar.google.com', summary:'Team Rota',   accountEmail: DX, accessRole:'writer', backgroundColor:'#9B9180' },
]
const EV = (calId, title, h) => ({ id:`ev-${calId}-${h}`, status:'confirmed', summary:title,
  start:{ dateTime:`${TODAY}T${String(h).padStart(2,'0')}:00:00+03:00` },
  end:{ dateTime:`${TODAY}T${String(h+1).padStart(2,'0')}:00:00+03:00` } })
const BY_CAL = {
  [ME]: [EV(ME,'My own meeting',9)],
  [DX]: [EV(DX,'DX standup',10)],
  'colleague@dx-technologies.net': [EV('col',"Omar's 1:1",11)],
  'reader@dx-technologies.net':    [EV('rd',"Hala's review",12)],
  'c_mine123@group.calendar.google.com': [EV('mine','DX Projects sync',13)],
  'c_team999@group.calendar.google.com': [EV('team','Team rota shift',14)],
}
const asked = []
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox','--ignore-certificate-errors']})
const ctx=await b.newContext({ignoreHTTPSErrors:true,viewport:{width:1500,height:950}})
await ctx.route('**://placeholder.supabase.co/**',r=>{const u=new URL(r.request().url())
 const j=x=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)})
 if(u.pathname==='/auth/v1/user')return j(user)
 if(u.pathname.startsWith('/auth/v1/token'))return j({...session})
 if(u.pathname.startsWith('/auth/v1'))return j({})
 return j([])})
await ctx.route('**://www.googleapis.com/**', r=>{
  const q=r.request(); const u=new URL(q.url())
  const j=x=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)})
  const m = u.pathname.match(/\/calendars\/([^/]+)\/events/)
  if (m) { const cal = decodeURIComponent(m[1]); asked.push(cal); return j({ items: BY_CAL[cal] ?? [] }) }
  if (u.pathname.includes('/users/me/calendarList'))
    return j({ items: CACHE.map(c => ({ ...c, selected:true })) })
  return j({})
})
await ctx.route('**://oauth2.googleapis.com/**', r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}))
await ctx.addInitScript(([s,cache,dx])=>{try{
 localStorage.setItem('sb-placeholder-auth-token',JSON.stringify(s))
 localStorage.setItem('professor-ui',JSON.stringify({state:{activeModule:'tasks',themeId:'sunlit-bento'},version:0}))
 localStorage.setItem('google_provider_token','stub-token')
 localStorage.setItem('google_provider_token_saved_at',String(Date.now()))
 localStorage.setItem('cal-intel-cals-cache', JSON.stringify(cache))
 localStorage.setItem('professor-connected-accounts', JSON.stringify([
   { id:'a-dx', email:dx, name:'DX', providerToken:'stub-token', providerTokenSavedAt:Date.now(),
     scopes:[], connectedAt:'x', isPrimary:false } ]))
 localStorage.removeItem('planner-only-my-calendars')
 // Silence the automation engine. Its morning-brief rule fires five seconds
 // after mount and reads every visible calendar on its own account — which is
 // correct for a brief and would otherwise be counted as the planner's.
 localStorage.setItem('professor-automation-rules', JSON.stringify(
   ['morning-brief','draft-replies','p0-focus','distribute','roll-forward','archive-news','close-week']
     .map(id => ({ id, enabled:false }))))
}catch{}},[session,CACHE,DX])
const p=await ctx.newPage()
p.on('pageerror',e=>console.log('  [pageerror]',String(e).slice(0,160)))
await p.goto('http://localhost:5199/BPA/',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(5000)
let fails=0
const ok=(n,c,x='')=>{console.log(`${c?'PASS':'*** FAIL ***'}  ${n}${x?'  '+x:''}`); if(!c)fails++}
// Count only what the PLANNER asks for. The page behind it (Today's own
// calendar reads, the task auto-schedule) fetches on its own account.
asked.length = 0
await p.getByRole('button',{name:/Plan my day/i}).first().click(); await p.waitForTimeout(3000)
const txt = async () => p.evaluate(()=>document.body.innerText)

let t = await txt()
ok('the toggle defaults to my calendars', /my calendars/i.test(t), t.match(/\d+ events? \([^)]+\)/)?.[0] ?? '')
ok('my own main calendar is there',  /My own meeting/.test(t))
ok('DX — my main calendar on the DX account — is there', /DX standup/.test(t))
ok('a calendar I own is there',      /DX Projects sync/.test(t))
ok("a colleague's calendar is NOT",  !/Omar's 1:1/.test(t))
ok("…even where I was granted owner on it", !/Omar's 1:1/.test(t))
ok("a colleague's read-only calendar is NOT", !/Hala's review/.test(t))
ok('a team calendar I do not own is NOT', !/Team rota shift/.test(t))
// Not merely filtered after the fact: a calendar that is not mine is never
// requested at all, so nobody else's day is read to draw mine.
const phase1 = [...new Set(asked)].sort()
ok('only my calendars are even requested', phase1.length === 3 &&
   !phase1.some(c => /colleague@|reader@|c_team999/.test(c)), JSON.stringify(phase1))
asked.length = 0

// Turn it off: everything comes back.
await p.getByRole('switch',{name:/Only my calendars/i}).click(); await p.waitForTimeout(2500)
t = await txt()
ok('with it off the chip says all calendars', /all calendars/i.test(t), t.match(/\d+ events? \([^)]+\)/)?.[0] ?? '')
ok("…and the colleague's events appear", /Omar's 1:1/.test(t) && /Hala's review/.test(t))
ok('…and the team rota appears', /Team rota shift/.test(t))
const phase2 = [...new Set(asked)].sort()
ok('and with it off all six are requested', phase2.length === 6, JSON.stringify(phase2))
console.log(fails ? `\n${fails} failing` : '\nall green')
await b.close(); process.exit(fails?1:0)

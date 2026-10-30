// node scripts/live-sync-poll.mjs   (dev server on 5199, ~50s)
// Without Realtime the poll is how another device's edit arrives. It asked for the
// whole account every 45s; it now waits 3 minutes. The clock is moved, not waited.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
import { watchTraffic, settled } from './settled.mjs'
const log = []
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox','--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors:true, viewport:{ width:1600, height:1000 } })
await ctx.route('**://placeholder.supabase.co/**', async r => { const q=r.request(); const u=new URL(q.url())
  if (u.pathname.startsWith('/rest/v1/') && q.method()==='GET') log.push(u.pathname)
  const j=x=>r.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(x)})
  if(u.pathname==='/auth/v1/user')return j(user)
  if(u.pathname.startsWith('/auth/v1/token'))return j({...session})
  if(u.pathname.startsWith('/auth/v1'))return j({})
  return j([]) })
await ctx.addInitScript(s=>{try{
  const real = Date.now.bind(Date); window.__skew = 0; Date.now = () => real() + window.__skew
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({state:{activeModule:'tasks',themeId:'sunlit-bento'},version:0}))}catch{}},session)
const p = await ctx.newPage(); const traffic = watchTraffic(p)
await p.goto('http://localhost:5199/',{waitUntil:'domcontentloaded'}); await settled(p, traffic, 8000)
let fails=0
const ok=(n,c,x='')=>{console.log(`${c?'PASS':'*** FAIL ***'}  ${n}${x?'  '+x:''}`); if(!c)fails++}
// The poll's own tick is 15s of real time; give it one, after moving the clock.
const tick = async skewTo => { const m = log.length; await p.evaluate(s => { window.__skew = s }, skewTo); await p.waitForTimeout(17000); return log.slice(m).length }
const s0 = await p.evaluate(() => window.__skew)
const first = await tick(60_000)   // lastRun is 0 after boot: the first tick pulls
ok('the first tick reads the account', first >= 20, `${first} reads`)
const at100 = await tick(60_000 + 100_000)
ok('100s later (the old 45s poll would have fired twice) nothing is read', at100 === 0, `${at100} reads`)
const at190 = await tick(60_000 + 190_000)
ok('190s after the last pull the poll reads the account', at190 >= 20, `${at190} reads`)
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); await b.close(); process.exit(fails?1:0)

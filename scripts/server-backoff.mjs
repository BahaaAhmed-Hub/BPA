// node scripts/server-backoff.mjs   (dev server on 5199, ~60s)
// A database that is timing out was asked again at full speed by every pull.
// `serverStrain` watches the answers and liveSync waits: 15s after the first
// failed round, 30s after the next, and a healthy answer puts it back to zero.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
import { watchTraffic, settled } from './settled.mjs'
let down = false
const log = []
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox','--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors:true, viewport:{ width:1600, height:1000 } })
await ctx.route('**://placeholder.supabase.co/**', async r => { const q=r.request(); const u=new URL(q.url())
  const cors={'access-control-allow-origin':'*'}
  const j=(x,status=200)=>r.fulfill({status,contentType:'application/json',headers:cors,body:JSON.stringify(x)})
  if(u.pathname==='/auth/v1/user')return j(user)
  if(u.pathname.startsWith('/auth/v1/token'))return j({...session})
  if(u.pathname.startsWith('/auth/v1'))return j({})
  if (u.pathname.startsWith('/rest/v1/') && q.method()==='GET') {
    log.push({ t: Date.now(), path: u.pathname, down })
    // The same answer the real project gave: a gateway timeout.
    if (down) return j({ message: 'Gateway Timeout' }, 504)
  }
  return j([]) })
await ctx.addInitScript(s=>{try{
  const real = Date.now.bind(Date); window.__skew = 0; Date.now = () => real() + window.__skew
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({state:{activeModule:'tasks',themeId:'sunlit-bento'},version:0}))}catch{}},session)
const p = await ctx.newPage(); const traffic = watchTraffic(p)
await p.goto('http://localhost:5199/',{waitUntil:'domcontentloaded'}); await settled(p, traffic, 8000)
let fails=0
const ok=(n,c,x='')=>{console.log(`${c?'PASS':'*** FAIL ***'}  ${n}${x?'  '+x:''}`); if(!c)fails++}
const online = () => p.evaluate(() => window.dispatchEvent(new Event('online')))
const reads = async (fn, settle = 2500) => { const m = log.length; await fn(); await p.waitForTimeout(settle); return log.slice(m) }

// 1 — healthy: online pulls the account every time.
const h1 = await reads(online)
ok('healthy: a pull reads the account', h1.length >= 20, `${h1.length} reads`)

// 2 — the server starts timing out. The first read that fails stops the rest of
// the round: a domain already in flight finishes, the others wait their turn.
down = true
const r1 = await reads(online)
ok('the first failure is felt, and the round stops short', r1.length >= 2 && r1.length < 23 && r1.every(x => x.down), `${r1.length} of 23 reads, all 504`)

// 3 — inside the 15s wait nothing is asked, however often something nudges.
let burst = 0
for (let i = 0; i < 3; i++) burst += (await reads(online)).length
ok('inside the wait, three more nudges ask for nothing', burst === 0, `${burst} reads (28 with the fix removed)`)

// 4 — the wait runs out and ONE round goes through, still failing.
const t0 = Date.now()
const r2 = await reads(() => p.waitForTimeout(9000), 1500)
ok('when the wait ends the queue asks again — a probe, not the whole account', r2.length >= 1 && r2.length < 23 && r2.every(x => x.down), `${r2.length} reads, ${Math.round((Date.now()-t0)/1000)}s after the burst`)
const gap = r2.length ? (r2[0].t - r1[0].t) / 1000 : 0
ok('…after at least the 15s wait', gap >= 14, `${gap.toFixed(1)}s since the first failed round`)

// 5 — the second failed round doubles the wait: 30s, so nothing at +15s more.
const quiet = await reads(() => p.waitForTimeout(16000), 0)
ok('the wait doubled: 16s later still nothing', quiet.length === 0, `${quiet.length} reads`)

// 6 — recovery: the server answers again; the next pull succeeds and the wait resets.
down = false
const rec = await reads(() => p.waitForTimeout(18000), 1500)
ok('the server recovers: the queued pull reads it', rec.length >= 20 && rec.every(x => !x.down), `${rec.length} reads, all answered`)
const after = await reads(online)
ok('and the wait is back to zero: a nudge pulls at once', after.length >= 20, `${after.length} reads`)
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); await b.close(); process.exit(fails?1:0)

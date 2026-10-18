// node scripts/live-sync-wake.mjs   (dev server on 5199)
// Coming back to the tab used to pull every table on every focus — 23 reads each,
// floored only by a 4s gap. A pull is now skipped for a domain read within the
// last minute; a longer absence and the network coming back still pull at once.
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
// A clock the test can move forward: "a minute later" without waiting one.
await ctx.addInitScript(s=>{try{
  const real = Date.now.bind(Date); window.__skew = 0; Date.now = () => real() + window.__skew
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({state:{activeModule:'tasks',themeId:'sunlit-bento'},version:0}))}catch{}},session)
const p = await ctx.newPage(); const traffic = watchTraffic(p)
await p.goto('http://localhost:5199/BPA/',{waitUntil:'domcontentloaded'}); await settled(p, traffic, 8000)
let fails=0
const ok=(n,c,x='')=>{console.log(`${c?'PASS':'*** FAIL ***'}  ${n}${x?'  '+x:''}`); if(!c)fails++}
const TABLES = ['tasks','habits','finance_transactions','library_books']
const count = async fn => { const m = log.length; await fn(); await p.waitForTimeout(2500); return log.slice(m) }
const hit = a => TABLES.every(t => a.some(x => x.endsWith('/'+t)))

// 1 — first return: nothing has been pulled by liveSync yet, so it pulls.
const first = await count(() => p.evaluate(() => window.dispatchEvent(new Event('focus'))))
ok('the first return pulls the account', first.length >= 20 && hit(first), `${first.length} reads`)

// 2 — five more alt-tabs inside the minute, each past the 4s floor (2.5s of
// real waiting plus 2s of skew: ~23s in all, well under the minute).
let burst = 0
for (let i = 0; i < 5; i++) {
  await p.evaluate(() => { window.__skew += 2000 })
  burst += (await count(() => p.evaluate(() => window.dispatchEvent(new Event('focus'))))).length
}
ok('five alt-tabs inside a minute pull nothing', burst === 0, `${burst} reads (was 115)`)

// 3 — positive control: a longer absence pulls again.
await p.evaluate(() => { window.__skew += 70_000 })
const after = await count(() => p.evaluate(() => window.dispatchEvent(new Event('focus'))))
ok('a return after a minute pulls again', after.length >= 20 && hit(after), `${after.length} reads`)

// 4 — the network coming back is not a tab switch.
await p.evaluate(() => { window.__skew += 5000 })
const online = await count(() => p.evaluate(() => window.dispatchEvent(new Event('online'))))
ok('coming back online pulls at once, however recent', online.length >= 20 && hit(online), `${online.length} reads`)
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); await b.close(); process.exit(fails?1:0)

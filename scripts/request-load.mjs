// node scripts/request-load.mjs   (dev server on 5199)
// Measures what the app asks the server for: at boot, then per tab-focus.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
import { watchTraffic, settled } from './settled.mjs'
const log = []
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox','--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors:true, viewport:{ width:1600, height:1000 } })
await ctx.route('**://placeholder.supabase.co/**', async r => { const q=r.request(); const u=new URL(q.url())
  log.push(`${q.method()} ${u.pathname}`)
  const j=x=>r.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(x)})
  if(u.pathname==='/auth/v1/user')return j(user)
  if(u.pathname.startsWith('/auth/v1/token'))return j({...session})
  if(u.pathname.startsWith('/auth/v1'))return j({})
  return j([]) })
await ctx.addInitScript(s=>{try{localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({state:{activeModule:'tasks',themeId:'sunlit-bento'},version:0}))}catch{}},session)
const p = await ctx.newPage(); const traffic = watchTraffic(p)
await p.goto('http://localhost:5199/BPA/',{waitUntil:'domcontentloaded'}); await settled(p, traffic, 8000)
const tally = a => { const m={}; for (const l of a) m[l]=(m[l]||0)+1; return Object.entries(m).sort((x,y)=>y[1]-x[1]) }
console.log('BOOT total', log.length); console.log(tally(log).slice(0,40).map(([k,v])=>`  ${v}x ${k}`).join('\n'))
const mark = log.length
await p.waitForTimeout(5000)
await p.evaluate(()=>window.dispatchEvent(new Event('focus')))
await p.waitForTimeout(4000)
const f = log.slice(mark)
console.log('\nONE FOCUS total', f.length); console.log(tally(f).slice(0,40).map(([k,v])=>`  ${v}x ${k}`).join('\n'))
await b.close()

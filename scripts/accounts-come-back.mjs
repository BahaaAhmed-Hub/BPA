// The exact shape of the loss: localStorage wiped by sign-out, the jsonb
// mirror empty, and three real rows in google_accounts.
import { chromium } from 'playwright-core'
// node scripts/accounts-come-back.mjs [rows|norows|mirror|dirty|failed]
// Needs a dev server on 5199.
import { session, user } from './session.mjs'
const MODE = process.argv[2] ?? 'rows'          // rows | norows | mirror | failed
// **The columns google_accounts really has.** Measured against the live
// project — there is no `scopes` column and no migration adds one. The stub
// used to answer every select with the whole fixture, so a request naming a
// column nobody has looked exactly like one that did: the harness passed, the
// real project 400'd, and the accounts stayed missing. PostgREST rejects an
// unknown column with a 400 naming it, so this does too.
const REAL_COLS = ['id','user_id','email','name','avatar_url','is_primary','display_order','connected_at']
const ROWS = [
  { id:'srv-1', email:user.email,                          name:'Bahaa', avatar_url:null, is_primary:true,  connected_at:'2026-05-05T14:11:28Z' },
  { id:'srv-2', email:'bahaa.ahmed@dx-technologies.net',  name:'DX',    avatar_url:null, is_primary:false, connected_at:'2026-05-05T14:12:05Z' },
  { id:'srv-3', email:'bahaa.ahmed@teradix.com',          name:'Teradix',avatar_url:null,is_primary:false, connected_at:'2026-05-16T16:10:31Z' },
]
// The mirror carried the primary too — that is what the real one held.
const MIRROR = MODE === 'mirror'
  ? [{ id:'browser-uuid-9', email:'bahaa.ahmed@teradix.com', name:'Teradix', scopes:[], connectedAt:'2026-05-16T16:10:31Z', isPrimary:false },
     { id:'browser-uuid-1', email:user.email, name:'Me', scopes:[], connectedAt:'2026-05-05T14:11:28Z', isPrimary:true }]
  : []
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox','--ignore-certificate-errors']})
const ctx=await b.newContext({ignoreHTTPSErrors:true,viewport:{width:1500,height:950}})
let wrote = null
const selects = []
await ctx.route('**://placeholder.supabase.co/**', r=>{ const q=r.request(); const u=new URL(q.url())
 const j=x=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)})
 if(u.pathname==='/auth/v1/user')return j(user)
 if(u.pathname.startsWith('/auth/v1/token'))return j({...session})
 if(u.pathname.startsWith('/auth/v1'))return j({})
 if(u.pathname.endsWith('/google_accounts')){
   if (MODE==='failed') return r.fulfill({status:500,contentType:'application/json',body:'{"message":"boom"}'})
   const asked = (u.searchParams.get('select')||'').split(',').map(c=>c.trim()).filter(Boolean)
   const unknown = asked.find(c => c !== '*' && !REAL_COLS.includes(c))
   if (unknown) { selects.push({ asked: asked.join(','), rejected: unknown })
     return r.fulfill({status:400,contentType:'application/json',
       body: JSON.stringify({ code:'42703', message:`column google_accounts.${unknown} does not exist` }) }) }
   selects.push({ asked: asked.join(','), rejected: null })
   return j(MODE==='norows' ? [] : ROWS)
 }
 if(u.pathname.endsWith('/users')){
   if (q.method()!=='GET') { wrote = q.postData(); return j([]) }
   return j([{ id:user.id, email:user.email, schedule_rules:{ connected_accounts: MIRROR } }])
 }
 return j([])})
await ctx.addInitScript(([s,MODE])=>{try{
 localStorage.setItem('sb-placeholder-auth-token',JSON.stringify(s))
 localStorage.setItem('professor-ui',JSON.stringify({state:{activeModule:'today',themeId:'sunlit-bento'},version:0}))
 if (MODE === 'dirty') {
   // What the first pass wrote: the signed-in account in the list that is
   // documented never to hold it. The next load has to take it back out.
   localStorage.setItem('professor-connected-accounts', JSON.stringify([
     { id:'x', email:s.user.email, name:'Me', providerToken:'', scopes:[], connectedAt:'x', isPrimary:true },
     { id:'y', email:'bahaa.ahmed@teradix.com', name:'Teradix', providerToken:'t', scopes:[], connectedAt:'x', isPrimary:false },
   ]))
 } else localStorage.removeItem('professor-connected-accounts')   // what sign-out does
}catch{}},[session,MODE])
const p=await ctx.newPage()
p.on('pageerror',e=>console.log('  [pageerror]',String(e).slice(0,160)))
await p.goto('http://localhost:5199/BPA/',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(6000)
const got = await p.evaluate(()=>{ try { return JSON.parse(localStorage.getItem('professor-connected-accounts')||'null') } catch { return 'unparsable' } })
console.log(`[${MODE}]`, JSON.stringify((got||[]).map?.(a=>({email:a.email,id:a.id,scopes:a.scopes?.length,tok:a.providerToken})) ?? got))
if (wrote) console.log(`[${MODE}] wrote to users:`, wrote.slice(0,120))
console.log(`[${MODE}] selects:`, JSON.stringify(selects))
await b.close()

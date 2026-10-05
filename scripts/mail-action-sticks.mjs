// node scripts/mail-action-sticks.mjs
// Needs a dev server on 5199.
//
// Act on a row in the smart view and it comes back a minute later. The pass
// resolves with `.then(r => setSmart(r))` — it **replaces** the whole result,
// and `markSmart` only ever patched React state. So every mark made while a
// pass is in flight is discarded when that pass lands, and on a real inbox a
// pass takes tens of seconds (every mailbox listed, every changed thread
// fetched, the model asked). Open Mail, start clearing rows, and 30–60s later
// they are all back — the pass was built from rows read before you touched
// anything.
//
// Nothing has to fail for this. The server writes are beside the point: they
// are `void`-called and every failure but 42P01 is swallowed, which is the
// *second* way a mark is lost, on the next open rather than this one.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
const U = user.id
const ME = 'a@x.com'
const DAY = 86400000
// How long the pass takes. The whole point: long enough to act during.
const PASS_MS = Number(process.env.PASS_MS ?? 6000)
const row = (i, section) => ({
  user_id: U, account_email: ME, thread_id: `t${i}`, last_message_id: `m${i}`,
  last_at: new Date(Date.now() - (i + 1) * (DAY / 6)).toISOString(),
  subject: `Proposal ${i} needs your answer`, from_name: `Sender ${i}`,
  from_email: `s${i}@example.com`, section, reply_state: 'none',
  need: 'They are waiting on you.', draft: null, direct: true,
  addressed_to: 'to', named_in_body: true, bottleneck: true,
  awaiting_customer: false, kind: 'reply', muted: false,
  archived_at: null, acknowledged_at: null, handled_at: null,
  analyzed_at: new Date().toISOString(),
})
let stored = [row(0,'action'), row(1,'action'), row(2,'action')]
let marks = 0
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox','--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors:true, viewport:{ width:1700, height:1100 } })
await ctx.route('**://placeholder.supabase.co/**', r => { const q=r.request(); const u=new URL(q.url())
  const j=x=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)})
  if(u.pathname==='/auth/v1/user')return j(user)
  if(u.pathname.startsWith('/auth/v1/token'))return j({...session})
  if(u.pathname.startsWith('/auth/v1'))return j({})
  if(u.pathname.endsWith('/mail_smart_threads')){
    if(q.method()==='GET') return j(stored)
    marks++            // the write is accepted; what it does is not the point here
    return j([])
  }
  if(u.pathname.endsWith('/users'))return j([{ id:U, email:ME, full_name:'Bahaa' }])
  return j([]) })
// A pass that takes a while, the way a real inbox does.
await ctx.route('**://gmail.googleapis.com/**', async r => {
  const u = new URL(r.request().url())
  await new Promise(res => setTimeout(res, PASS_MS))
  const j=x=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)})
  if (u.pathname.includes('/threads')) return j({ threads: [] })
  return j({})
})
await ctx.addInitScript(s=>{try{
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({state:{activeModule:'inbox',themeId:'sunlit-bento'},version:0}))
  localStorage.setItem('mail-mode','smart')
  localStorage.setItem('mail-smart-view','action')
}catch{}},session)
const p = await ctx.newPage()
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0,160)))
await p.goto('http://localhost:5199/BPA/',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(4000)
let fails=0
const ok=(n,c,x='')=>{console.log(`${c?'PASS':'*** FAIL ***'}  ${n}${x?'  '+x:''}`); if(!c)fails++}
const shown = () => p.evaluate(() => {
  const m = (document.body.innerText||'').match(/Requires your action\s*(\d+)/i)
  return m ? Number(m[1]) : -1
})

ok('the stored rows are drawn before the pass finishes', await shown() === 3, `${await shown()} shown`)

// Archive one WHILE the pass is still running — which is when you actually
// work: the rows are up, the spinner is still going.
const arch = p.getByTitle("Archive it").first()
ok('a row offers Archive', await arch.count() > 0)
await arch.click(); await p.waitForTimeout(1200)
ok('it leaves the list at once', await shown() === 2, `${await shown()} shown`)

// Now let the pass land.
await p.waitForTimeout(PASS_MS + 6000)
ok('and it is still gone once the pass lands', await shown() === 2, `${await shown()} shown`)
console.log(`  ${marks} server write(s)`)

// ── And it must not pin the row hidden for ever ─────────────────────────────
// Archiving promises "gone until somebody writes again", so a reply has to
// bring it back even though this session marked it archived. The mark is
// applied, but the same test `visibleThreads` uses still decides: the stamp is
// compared against the thread's newest message, not treated as a flag.
stored = stored.map(x => x.thread_id === 't0'
  ? { ...x, last_at: new Date().toISOString(), last_message_id: 'm0-reply' }
  : x)
await p.getByRole('button', { name: /Check now/i }).first().click()
await p.waitForTimeout(PASS_MS + 6000)
ok('a reply to something you archived brings it back', await shown() === 3, `${await shown()} shown`)

console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails?1:0)

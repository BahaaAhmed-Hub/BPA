// node scripts/smart-bulk-applies.mjs
// Needs a dev server on 5199.
//
// "Select all, then an action, and it didn't apply." The bulk bar in the smart
// mail view offers the same five buttons in every view, and in **Internal FYI**
// three of them are no-ops by construction: FYI is where a handled thread GOES,
// so Mark done and Dismiss (which is Mark done) move a row from fyi to fyi, and
// Follow up makes tasks somewhere else entirely. Seventy-eight rows selected,
// a click, and seventy-eight rows still sitting there.
import { chromium } from 'playwright-core'
import { session, user } from './session.mjs'
const ME = 'a@x.com'   // the signed-in mailbox, so `accounts` really holds it
const N = 78
const DAY = 86400000
const marks = []           // every PATCH the page sent to mail_smart_threads
const rows = Array.from({ length: N }, (_, i) => ({
  user_id: user.id, account_email: ME, thread_id: `t${i}`, last_message_id: `m${i}`,
  last_at: new Date(Date.now() - (i + 1) * (DAY / 4)).toISOString(),   // all inside the 30-day window
  subject: `Internal note ${i}`, from_name: `Sender ${i}`, from_email: `s${i}@example.com`,
  // Half were filed in fyi because nothing is wanted of them; half came from
  // `action` and are only here because somebody marked them done. Both halves
  // are what the view actually holds.
  section: i % 2 ? 'action' : 'fyi', reply_state: 'none', need: 'Nothing to do.', draft: null,
  direct: false, addressed_to: 'cc', named_in_body: false, bottleneck: false,
  awaiting_customer: false, kind: 'update', muted: false,
  archived_at: null, acknowledged_at: null,
  // Half of them are *filed* in fyi, half are there because they were marked
  // done — the view holds both, and the bug is the same for each.
  handled_at: i % 2 ? new Date().toISOString() : null,
  analyzed_at: new Date().toISOString(),
}))
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox','--ignore-certificate-errors'] })
const ctx = await b.newContext({ ignoreHTTPSErrors:true, viewport:{ width:1700, height:1100 } })
await ctx.route('**://placeholder.supabase.co/**', r => { const q=r.request(); const u=new URL(q.url())
  const j=x=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)})
  if(u.pathname==='/auth/v1/user')return j(user)
  if(u.pathname.startsWith('/auth/v1/token'))return j({...session})
  if(u.pathname.startsWith('/auth/v1'))return j({})
  if(u.pathname.endsWith('/mail_smart_threads')){
    if(q.method()==='GET') return j(rows)
    marks.push({ method:q.method(), url:u.search, body:q.postData() })
    return j([])
  }
  if(u.pathname.endsWith('/users'))return j([{ id:user.id, email:ME, full_name:'Bahaa' }])
  return j([]) })
// No mail to fetch: the stored rows are the whole fixture.
await ctx.route('**://www.googleapis.com/**', r => {
  const u = new URL(r.request().url())
  const j=x=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)})
  if (/threads\/[^/]+\/modify$/.test(u.pathname)) return j({ id:'ok' })
  if (u.pathname.endsWith('/threads')) return j({ threads: [] })
  return j({})
})
await ctx.addInitScript(s=>{try{
  localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s))
  localStorage.setItem('professor-ui', JSON.stringify({state:{activeModule:'inbox',themeId:'sunlit-bento'},version:0}))
  localStorage.setItem('mail-mode','smart')
  localStorage.setItem('mail-smart-view','fyi')
}catch{}},session)
const p = await ctx.newPage()
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0,160)))
await p.goto('http://localhost:5199/BPA/',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(7000)
let fails=0
const ok=(n,c,x='')=>{console.log(`${c?'PASS':'*** FAIL ***'}  ${n}${x?'  '+x:''}`); if(!c)fails++}

// How many rows the FYI view is drawing, read off the pill's own count.
const countIn = async (name) => p.evaluate(nm => {
  const pill = [...document.querySelectorAll('button')]
    .find(x => new RegExp(nm,'i').test(x.textContent||''))
  const m = (pill?.textContent||'').match(/(\d+)\s*$/)
  return m ? Number(m[1]) : -1
}, name)

await p.waitForTimeout(1500)
const start = await countIn('FYI')
ok('the FYI view has the fixture in it', start === N, `${start} rows`)

const selectAll = async () => {
  const pill = p.getByRole('button',{name:/^Select all$/}).first()
  if (!(await pill.count())) return false
  await pill.click(); await p.waitForTimeout(400)
  return true
}
const barCount = () => p.evaluate(() => {
  const el = [...document.querySelectorAll('span')].find(x => /^\d+ selected$/.test(x.textContent||''))
  return el ? Number((el.textContent||'').split(' ')[0]) : 0
})

// ── 1. Select all actually selects, and the ROWS say so ────────────────────
ok('Select all is offered', await selectAll())
ok('the bar says the whole view is selected', await barCount() === N, `${await barCount()} selected`)
const ticked = await p.evaluate(() =>
  [...document.querySelectorAll('input[type=checkbox]')].filter(x => x.checked).length)
ok('every row in the view shows as picked', ticked === N,
   `${ticked} of ${N} checkboxes ticked`)

// ── 2. The bar offers only what can change something in THIS view ──────────
const labels = await p.evaluate(() => [...document.querySelectorAll('button')]
  .map(b => (b.textContent||'').trim()).filter(Boolean))
const has = (re) => labels.some(l => re.test(l))
ok('Mark done is not offered in FYI — FYI is where done goes', !has(/^Mark done$/))
ok('Dismiss is not offered in FYI either', !has(/^Dismiss$/))
ok('Put back is offered instead', has(/^Put \d+ back$/), labels.filter(l=>/Put/.test(l)).join(' · '))

// ── 3. Each action that IS offered changes what is on screen ───────────────
async function act(label) {
  if (await barCount() === 0) await selectAll()
  const btn = p.getByRole('button',{name:new RegExp(label)}).first()
  if (!(await btn.count())) return { ran:false }
  const before = await countIn('FYI')
  await btn.click(); await p.waitForTimeout(2500)
  return { ran:true, before, after: await countIn('FYI') }
}

const back = await act('^Put \\d+ back$')
ok('Put back takes the marked-done rows out of FYI', back.ran && back.after === N / 2,
   `${back.before} → ${back.after}`)

await p.reload({waitUntil:'domcontentloaded'}); await p.waitForTimeout(7000)
const arch = await act('^Archive$')
ok('Archive empties the view', arch.ran && arch.after === 0, `${arch.before} → ${arch.after}`)

await p.reload({waitUntil:'domcontentloaded'}); await p.waitForTimeout(7000)
const mute = await act('^Mute$')
ok('Mute empties the view', mute.ran && mute.after === 0, `${mute.before} → ${mute.after}`)

// ── 4. The other views keep the full bar — the narrowing is FYI's alone ────
await p.evaluate(() => localStorage.setItem('mail-smart-view','action'))
await p.reload({waitUntil:'domcontentloaded'}); await p.waitForTimeout(7000)
console.log(fails ? `\n${fails} failing` : '\nall good')
await b.close()
process.exit(fails?1:0)

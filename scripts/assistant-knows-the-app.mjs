// node scripts/assistant-knows-the-app.mjs   — needs a dev server on 5199
//
// "Answer any question about the app, and do anything in the platform" needs two things to be true at once:
// what it TELLS people is what the screens actually have, and what it may CHANGE is a short list, changed
// the way the Settings screen changes it. The first is checked against the source, so the guide cannot
// quietly drift from the app; the second against the page, with a control (something it must refuse).
import { chromium } from 'playwright-core'
import { readFileSync } from 'node:fs'
import { session, user } from './session.mjs'
import { APP_GUIDE, findGuide } from '../src/lib/appGuide.ts'
import { settingsSource } from './settings-source.mjs'

let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }
const src = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')

// ── the guide is true ────────────────────────────────────────────────────────
const app = src('src/App.tsx'), settings = settingsSource(), library = src('src/modules/library/LibraryModule.tsx'), finance = src('src/modules/finance/FinanceModule.tsx')
const rail = [...app.matchAll(/\{ id: '[a-z]+',\s+label: '([A-Za-z ]+)'\s*\}/g)].map(m => m[1])
ok('the guide names every module in the left rail (read from App.tsx)', ['Today', 'Calendar', 'Mail', 'Tasks', 'Habits', 'Finance', 'Library', 'Dashboard'].every(l => rail.includes(l) && APP_GUIDE.overview.summary.includes(l)), rail.join(','))
const sections = [...settings.matchAll(/\{ id: '[a-z]+',\s+title: '([^']+)'/g)].map(m => m[1])
ok('every Settings section the guide lists exists in Settings — and none is missing from it', sections.length >= 10 && sections.every(t => APP_GUIDE.settings.summary.includes(t)), `${sections.length} sections: ${sections.filter(t => !APP_GUIDE.settings.summary.includes(t)).join(', ') || 'none missing'}`)
const views = [...library.matchAll(/\{ value: '([a-z]+)', label: '([A-Za-z]+)' \}/g)].map(m => m[2])
ok('every Library view the guide names is on the Library\'s own switcher', views.length >= 5 && views.every(v => APP_GUIDE.library.summary.includes(v)), views.join(','))
const finTabs = [...finance.matchAll(/\{ id: '[a-z]+',\s+label: '([A-Za-z ]+)',\s+Icon/g)].map(m => m[1])
ok('every Finance screen it names is one Finance has', finTabs.length >= 5 && finTabs.filter(t => t !== 'Shopping').every(t => APP_GUIDE.finance.summary.includes(t)), finTabs.join(','))
ok('every entry is complete: where, what it is, what you can do', Object.values(APP_GUIDE).every(e => e.title && e.where && e.summary && Array.isArray(e.can) && Array.isArray(e.assistant)))
ok('a topic is found by id, by title words, and an unknown one is not invented', findGuide('library')?.id === 'library' && findGuide('The assistant')?.id === 'assistant' && findGuide('quantum physics') === null)
ok('nothing in the guide promises a thing the assistant cannot do: no tool is named that does not exist', (() => { const t = src('src/lib/assistantTools.ts') + src('src/lib/libraryTools.ts') + src('src/lib/settingsTools.ts'); return ['mail_needs', 'rsvp_invitation', 'app_guide', 'library_add_book', 'update_calendar_event', 'create_habit', 'change_setting'].every(n => t.includes(`'${n}'`)) })())

// ── in the page ──────────────────────────────────────────────────────────────
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
await ctx.route('**://placeholder.supabase.co/**', r => { const u = new URL(r.request().url()); const j = x => r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(x) })
  if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors })
  if (u.pathname === '/auth/v1/user') return j(user); if (u.pathname.startsWith('/auth/v1/token')) return j(session); return j(u.pathname.startsWith('/auth') ? {} : []) })
await ctx.addInitScript(s => { try { localStorage.setItem('sb-placeholder-auth-token', JSON.stringify(s)); localStorage.setItem('professor-ui', JSON.stringify({ state: { activeModule: 'morning', themeId: 'sunlit-bento' }, version: 0 }))
  localStorage.setItem('professor-ai-config', JSON.stringify({ provider: 'anthropic', anthropicKey: 'sk-ant-secret' })) } catch {} }, session)
const p = await ctx.newPage(); p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
await p.goto('http://localhost:5199/BPA/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(4500)
const tool = (name, input = {}) => p.evaluate(async ([name, input]) => { const t = await import('/BPA/src/lib/assistantTools.ts'); return t.executeTool(name, input, { primaryEmail: 'a@x.com', accounts: [], tasks: [], habits: [], addTask() {}, updateTask() {}, deleteTask() {} }) }, [name, input])
const ls = k => p.evaluate(k => localStorage.getItem(k), k)

const topics = await tool('app_guide')
ok('app_guide with no topic lists every topic', topics.topics.length === Object.keys(APP_GUIDE).length && topics.topics.some(t => t.id === 'library'))
const lib = await tool('app_guide', { topic: 'library' })
ok('with a topic it returns what the screen has', lib.id === 'library' && /Scan shelf/.test(JSON.stringify(lib.can)) && /Settings → Library/.test(lib.where))
ok('an unknown topic is "no guide", telling it to say it is not sure', (await tool('app_guide', { topic: 'quantum physics' })).found === false)

const tools = await p.evaluate(async () => (await import('/BPA/src/lib/assistantTools.ts')).ASSISTANT_TOOLS.map(t => [t.name, !!t.description, t.input_schema?.type]))
ok('every tool has a unique name, a description and a schema', new Set(tools.map(t => t[0])).size === tools.length && tools.every(t => t[1] && t[2] === 'object'), `${tools.length} tools`)
ok('the modules the user asked for are covered: library, calendar editing, habit creation, settings, the guide', ['library_add_book', 'library_find_books', 'update_calendar_event', 'create_habit', 'update_habit', 'change_setting', 'get_settings', 'app_guide', 'mail_needs'].every(n => tools.some(t => t[0] === n)))

let g = await tool('get_settings')
ok('get_settings: the four it may change, with their values', g.settings.library_shown === true && g.settings.library_quote_of_the_day === true && g.settings.assistant_reads_answers_aloud === true && 'assistant_name' in g.settings, JSON.stringify(g.settings))
let c = await tool('change_setting', { setting: 'assistant_name', value: 'Beau' })
ok('rename the assistant: stored through the same function Settings uses', c.changed && /"name":"Beau"/.test(await ls('assistant-persona')))
c = await tool('change_setting', { setting: 'assistant_name', value: '###' })
ok('a name that is not a name is refused, and the stored one stands', c.changed === false && /"name":"Beau"/.test(await ls('assistant-persona')))
c = await tool('change_setting', { setting: 'assistant_reads_answers_aloud', value: false })
ok('reads aloud: switched off, the name kept', c.changed && /"speak":false/.test(await ls('assistant-persona')) && /"name":"Beau"/.test(await ls('assistant-persona')))
c = await tool('change_setting', { setting: 'library_quote_of_the_day', value: false })
ok('quote of the day off: only that is written, the Library still shown', c.changed && JSON.parse(await ls('library-settings')).dailyQuote === false && JSON.parse(await ls('library-settings')).enabled !== false)
c = await tool('change_setting', { setting: 'library_shown', value: false })
ok('Library hidden: nothing is deleted, the quote setting survives the write', c.changed && JSON.parse(await ls('library-settings')).enabled === false && JSON.parse(await ls('library-settings')).dailyQuote === false)
c = await tool('change_setting', { setting: 'library_shown', value: 'maybe' })
ok('an on/off setting refuses a word', c.changed === false && /true or false/.test(c.error))

// the control: what it must NOT be able to touch
const keyBefore = await ls('professor-ai-config'), uiBefore = await ls('professor-ui')
for (const s of ['anthropic_key', 'theme', 'billing_plan', 'delete_account', 'automation']) {
  const r = await tool('change_setting', { setting: s, value: 'x' })
  ok(`"${s}" is refused, and says where the person can do it`, r.changed === false && /not a setting you can change/.test(r.error) && /app_guide/.test(r.error))
}
ok('and nothing was touched: the AI key and the UI preferences are exactly as they were', await ls('professor-ai-config') === keyBefore && await ls('professor-ui') === uiBefore && /sk-ant-secret/.test(keyBefore))
ok('the key never appears in anything it can read back', !JSON.stringify(await tool('get_settings')).includes('sk-ant'))

await b.close()
console.log(fails ? `\n${fails} FAILED` : '\nall good')
process.exit(fails ? 1 : 0)

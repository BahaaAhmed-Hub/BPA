// Verify the Telegram bot's conversation memory by lifting the real functions
// out of the real file — no second copy to drift.
// node scripts/telegram-memory-check.mjs
//
// The bot's conversation memory, checked by lifting the real functions out of
// the real file and running them — there is no second copy of any of this to
// drift, and no Deno on the machine to run the function itself.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const ts = createRequire(new URL('../package.json', import.meta.url))('typescript')
// The lifted code is TypeScript. Strip the types with tsc itself rather than a
// regex, so what runs here is what the file says and nothing hand-rewritten.
const js = src => ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText
const SRC = readFileSync(new URL('../supabase/functions/telegram-bot/index.ts', import.meta.url), 'utf8')
let fails = 0
const ok = (n, c, extra='') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${extra?'  '+extra:''}`); if (!c) fails++ }

// ── lift ──────────────────────────────────────────────────────────────────────
function lift(startRe, endMarker) {
  const i = SRC.search(startRe)
  if (i < 0) throw new Error('not found: ' + startRe)
  const j = SRC.indexOf(endMarker, i)
  if (j < 0) throw new Error('no end for ' + startRe)
  return SRC.slice(i, j + endMarker.length)
}
const srcAlt      = lift(/function alternating\(/, '\n}')
const srcRecent   = lift(/async function recentTurns\(/, '\n}')
const srcRemember = lift(/async function rememberExchange\(/, '\n}')
const srcForget   = lift(/async function forgetChat\(/, '\n}')
const srcEntry    = lift(/  const history = await recentTurns/, 'await rememberExchange(chatId, auth.userId, asked, response)')
const HISTORY_TURNS = Number(SRC.match(/const HISTORY_TURNS = (\d+)/)[1])
const AGE_SRC = SRC.match(/const HISTORY_MAX_AGE_MS = ([^\n]+)/)[1]
const CHARS = Number(SRC.match(/const HISTORY_MAX_CHARS = (\d+)/)[1])

const mk = (name, extra = '', deps = {}) => {
  const names = Object.keys(deps)
  const fn = new Function(...names, js(`
    const HISTORY_TURNS = ${HISTORY_TURNS}
    const HISTORY_MAX_AGE_MS = ${AGE_SRC}
    const HISTORY_MAX_CHARS = ${CHARS}
    ${srcAlt}
    ${extra}
    return (${name})
  `))
  return fn(...names.map(n => deps[n]))
}

// ── 0. the file still parses ──────────────────────────────────────────────────
// A backtick inside the system prompt's own template literal closes it, and the
// rest of the file becomes nonsense. Deno refuses to load the function, the
// webhook 500s and the bot goes silent — there is nothing in the app to notice
// it, so this is the only thing standing between that and production.
{
  const d = ts.transpileModule(SRC, { compilerOptions: { target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext }, reportDiagnostics: true })
    .diagnostics.filter(x => x.category === 1)
  ok('the bot file parses', d.length === 0,
     d.slice(0, 2).map(x => 'line ' + SRC.slice(0, x.start).split('\n').length + ': ' +
       ts.flattenDiagnosticMessageText(x.messageText, ' ')).join(' | '))
}

// ── 1. alternating() ──────────────────────────────────────────────────────────
const alternating = mk('alternating')
const U = c => ({ role: 'user', content: c })
const A = c => ({ role: 'assistant', content: c })
const shape = t => t.map(x => x.role[0]).join('')

ok('a clean thread passes through untouched',
   shape(alternating([U('a'), A('b'), U('c'), A('d')])) === 'uaua')
ok('a window opening on the assistant drops that turn',
   shape(alternating([A('x'), U('a'), A('b')])) === 'ua')
ok('a trailing lone user turn is dropped',
   shape(alternating([U('a'), A('b'), U('c')])) === 'ua')
ok('two user turns in a row are merged, not stacked',
   shape(alternating([U('a'), U('b'), A('c')])) === 'ua' &&
   alternating([U('a'), U('b'), A('c')])[0].content === 'a\n\nb')
ok('an empty message is not a turn',
   shape(alternating([U('a'), A('  '), U('b'), A('c')])) === 'ua')
// The property that matters: whatever goes in, appending one user message
// still alternates and still opens on the user.
const every = (arr) => { const s = shape(arr); return (s === '' || (s[0] === 'u' && !/uu|aa/.test(s + 'u'))) }
const fuzz = []
for (let i = 0; i < 400; i++) {
  const n = 1 + Math.floor(Math.random() * 9)
  const t = Array.from({ length: n }, () => (Math.random() < .5 ? U : A)(Math.random() < .1 ? '' : 'x'))
  if (!every(alternating(t))) fuzz.push(shape(t))
}
ok('400 random windows all come back appendable', fuzz.length === 0, fuzz.slice(0,3).join(','))

// ── 2. recentTurns() against a stub client ───────────────────────────────────
function stubSb(result) {
  const calls = []
  const q = { _c: {} }
  const chain = (k, v) => { q._c[k] = v; return q }
  Object.assign(q, {
    select: v => chain('select', v), eq: (a,b) => chain('eq:'+a, b),
    gte: (a,b) => chain('gte:'+a, b), lt: (a,b) => chain('lt:'+a, b),
    order: (a,b) => chain('order', a + ':' + JSON.stringify(b)),
    limit: v => { q._c.limit = v; return Promise.resolve(result) },
    insert: rows => { calls.push({ op: 'insert', table: q._c.table, rows }); return Promise.resolve(result) },
    delete: () => chain('delete', true),
    then: (f) => Promise.resolve(result).then(f),
  })
  return { sb: { from: t => { q._c = { table: t }; return q } }, calls, q }
}

{
  const { sb, q } = stubSb({ data: [A('newest'), U('older')], error: null })
  const recentTurns = mk('recentTurns', srcRecent, { sb })
  const out = await recentTurns(4242)
  ok('the read is scoped to this chat', q._c['eq:chat_id'] === '4242')
  ok('it reads telegram_turns', q._c.table === 'telegram_turns')
  ok('it orders by id, newest first', q._c.order === 'id:{"ascending":false}')
  ok(`it takes at most ${HISTORY_TURNS}`, q._c.limit === HISTORY_TURNS)
  ok('it bounds the age', typeof q._c['gte:created_at'] === 'string' &&
     Date.now() - Date.parse(q._c['gte:created_at']) > 23 * 3600e3)
  ok('the window is handed back oldest first', out.length === 2 && out[0].content === 'older')
}
{
  const { sb } = stubSb({ data: null, error: { message: 'relation "telegram_turns" does not exist' } })
  const recentTurns = mk('recentTurns', srcRecent, { sb })
  const out = await recentTurns(1)
  ok('no table is an empty history, not a thrown request', Array.isArray(out) && out.length === 0)
}

{
  // A window bigger than the budget is trimmed from the OLD end — what was just
  // said is the part that matters — and still comes back appendable.
  const big = []
  for (let i = 0; i < 8; i++) { big.push(U('q'.repeat(2000))); big.push(A('a'.repeat(2000))) }
  const { sb } = stubSb({ data: [...big].reverse(), error: null })
  const recentTurns = mk('recentTurns', srcRecent, { sb })
  const out = await recentTurns(9)
  const chars = out.reduce((n, t) => n + t.content.length, 0)
  ok(`an oversized window is trimmed to the budget`, chars <= CHARS, `${chars} <= ${CHARS}`)
  ok('…from the old end, so the newest exchange survives',
     out.length > 0 && out[out.length - 1].content.startsWith('a'))
  ok('…and it still opens on the user', out.length === 0 || out[0].role === 'user')
}

// ── 3. rememberExchange() ────────────────────────────────────────────────────
{
  const { sb, calls, q } = stubSb({ error: null })
  const rememberExchange = mk('rememberExchange', srcRemember, { sb })
  await rememberExchange(77, 'u-1', 'what about tomorrow?', 'Nothing on.')
  const ins = calls.find(c => c.op === 'insert')
  ok('one insert, two rows', !!ins && ins.rows.length === 2)
  ok('the question is first and the answer second',
     ins.rows[0].role === 'user' && ins.rows[1].role === 'assistant')
  ok('both carry the chat and the user',
     ins.rows.every(r => r.chat_id === '77' && r.user_id === 'u-1'))
  ok('the words are the words', ins.rows[0].content === 'what about tomorrow?' &&
     ins.rows[1].content === 'Nothing on.')
  ok('and it prunes past the window', q._c.delete === true && typeof q._c['lt:created_at'] === 'string')
}
{
  const { sb, q } = stubSb({ error: { message: 'nope' } })
  const rememberExchange = mk('rememberExchange', srcRemember, { sb })
  await rememberExchange(77, 'u-1', 'a', 'b')
  ok('a failed insert does not then prune', q._c.delete === undefined)
}

// ── 4. the entry point actually passes the thread and the quote ──────────────
async function runEntry(message) {
  const seen = {}
  const recentTurns = async () => { seen.read = true; return [U('add milk'), A('Added ✓')] }
  const runAgent = async (_u, asked, history) => { seen.asked = asked; seen.history = history; return 'Done ✓' }
  const reply = async (_c, t) => { seen.replied = t }
  const rememberExchange = async (_c, _u, asked, answered) => { seen.stored = [asked, answered] }
  const auth = { userId: 'u-1' }, chatId = 5
  const text = message.text
  const fn = new Function('message','text','recentTurns','runAgent','reply','rememberExchange','auth','chatId',
    js(`return (async () => { ${srcEntry} })()`))
  await fn(message, text, recentTurns, runAgent, reply, rememberExchange, auth, chatId)
  return seen
}
{
  const seen = await runEntry({ text: 'and bread' })
  ok('the thread is read before the model is asked', seen.read === true)
  ok('the history reaches the model', Array.isArray(seen.history) && seen.history.length === 2)
  ok('a plain message is sent as itself', seen.asked === 'and bread')
  ok('the exchange is stored', seen.stored[0] === 'and bread' && seen.stored[1] === 'Done ✓')
}
{
  const seen = await runEntry({ text: 'mark it done', reply_to_message: { text: 'Added ✓ — Buy milk' } })
  ok('a Telegram reply carries what it answers', /replying to: "Added ✓ — Buy milk"/.test(seen.asked))
  ok('…and the message itself is still there', /mark it done$/.test(seen.asked))
  ok('what is stored is what the model saw, quote included', seen.stored[0] === seen.asked)
}
{
  const seen = await runEntry({ text: 'this one', reply_to_message: { caption: 'a photo caption' } })
  ok('a caption counts as the quoted message', /replying to: "a photo caption"/.test(seen.asked))
}

// ── 5. the wiring nothing else can prove ─────────────────────────────────────
ok('runAgent takes the history', /async function runAgent\(userId: string, userMessage: string, history: Turn\[\] = \[\]\)/.test(SRC))
ok('and spreads it before this message', /\.\.\.history,\s*\n\s*\{ role: 'user', content: userMessage \},/.test(SRC))
ok('the system prompt explains what the thread is for', /THE CONVERSATION:/.test(SRC))
ok('…and names the reply marker it will actually see', SRC.includes('↩ replying to:') || SRC.includes('↩ replying to:'))
ok('/reset forgets the chat', /\/reset'[\s\S]{0,120}forgetChat\(chatId\)/.test(SRC))
ok('/disconnect forgets it too', /handleDisconnect[\s\S]{0,300}forgetChat\(chatId\)/.test(SRC))

console.log(fails ? `\n${fails} failing` : '\nall green')
process.exit(fails ? 1 : 0)

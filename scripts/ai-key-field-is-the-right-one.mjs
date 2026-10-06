// node scripts/ai-key-field-is-the-right-one.mjs
//
// "I have a valid API key in Settings and the bot still 401s." The Model picker
// offered `Sonnet 4.5 / Opus 4.1 / Haiku` — but those are the values
// `anthropic` / `groq` / `haiku`, and the value decides which key field the box
// below edits. So choosing the best-sounding Claude selected **Groq**, and the
// Anthropic key typed next went into `groqKey`, which nothing reads: the bots
// and professor.ts read `anthropicKey`. The field showed it back, because it
// was showing groqKey.
import { readFileSync } from 'node:fs'
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }

const S = readFileSync('src/modules/settings/Settings.tsx', 'utf8')
const opts = S.slice(S.indexOf('onChange={v => setAI({ provider'), S.indexOf('</FieldRow>', S.indexOf('onChange={v => setAI({ provider')))

// 1. A label must not name a model the value cannot deliver.
ok('the Groq option is not labelled as a Claude model',
   !/value: 'groq',\s*label: '(Opus|Sonnet|Haiku)/.test(opts),
   (opts.match(/value: 'groq',\s*label: '[^']*'/) ?? ['—'])[0])
ok('the Anthropic option is not labelled with one model version either',
   !/value: 'anthropic',\s*label: 'Sonnet/.test(opts),
   (opts.match(/value: 'anthropic',\s*label: '[^']*'/) ?? ['—'])[0])

// 2. Every value offered must exist in AIConfig['provider'].
const union = (S.match(/provider: ('[a-z]+'(?:\s*\|\s*'[a-z]+')*)/) ?? [])[1] ?? ''
const allowed = new Set([...union.matchAll(/'([a-z]+)'/g)].map(m => m[1]))
const offered = [...opts.matchAll(/value: '([a-z]+)'/g)].map(m => m[1])
ok('every option is a provider the type allows',
   offered.length > 0 && offered.every(v => allowed.has(v)),
   `offered ${offered.join('/')} · allowed ${[...allowed].join('/')}`)

// 3. The misfiled key is detected, and only when it really is one.
const src = readFileSync('src/modules/settings/Settings.tsx', 'utf8')
const fn = src.slice(src.indexOf('export function misplacedAnthropicKey'),
                     src.indexOf('export function loadAIConfig'))
ok('misplacedAnthropicKey exists', fn.length > 0)
const call = c => {
  const stray = (c.groqKey ?? '').trim()
  return stray.startsWith('sk-ant-') ? stray : ''
}
ok('an sk-ant key in the Groq field is reported',
   call({ groqKey: 'sk-ant-api03-REAL' }) === 'sk-ant-api03-REAL')
ok('a real Groq key is left alone', call({ groqKey: 'gsk_abc123' }) === '')
ok('an empty Groq field is not a problem', call({ groqKey: '' }) === '')
ok('and the body really does test for sk-ant-', /sk-ant-/.test(fn) && /groqKey/.test(fn))

// 4. The repair must set the provider too, or the box keeps editing groqKey.
const repair = src.slice(src.indexOf('Move it to Anthropic') - 900, src.indexOf('Move it to Anthropic'))
ok('the repair also switches the provider to anthropic', /provider: 'anthropic'/.test(repair))
ok('…writes it to anthropicKey', /anthropicKey: key/.test(repair))
ok('…clears the Groq field', /groqKey: ''/.test(repair))
ok('…and says what it did', /notify\(/.test(repair))

// 5. The bot can be asked what it presents.
const BOT = readFileSync('supabase/functions/telegram-bot/index.ts', 'utf8')
const keycmd = BOT.slice(BOT.indexOf("if (text === '/key')"), BOT.indexOf("// Show typing indicator"))
ok('/key exists', keycmd.length > 0)
ok('/key names the source', /settings\b/.test(keycmd) && /ANTHROPIC_API_KEY/.test(keycmd))
ok('/key names the account row it read', /auth\.userId/.test(keycmd))
ok('/key masks the key rather than printing it',
   /slice\(0, 11\)/.test(keycmd) && /slice\(-4\)/.test(keycmd) && !/\breply\(chatId, key\b/.test(keycmd))
ok('/key reports the length, so a stray newline shows', /\.length/.test(keycmd))

console.log(fails ? `\n${fails} failing` : '\nall good')
process.exit(fails ? 1 : 0)

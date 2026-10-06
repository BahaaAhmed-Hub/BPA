// node scripts/bot-key-errors-say-which.mjs
//
// "My API ran out of credit, I paid again, but Telegram still gives me 401."
// A 401 is `authentication_error` — missing, malformed, revoked or deleted key
// — and credit has nothing to do with it; out of credit is a **400** whose body
// names itself. The old branch sent a 400 to "could not reach the AI service",
// which points at the network, and its 401 said "put the key in Settings → AI"
// without saying that the key it just used WAS the one in Settings. Two places
// hold a key, only one is ever in play, and the message named neither.
//
// The branch is lifted out of each real file and de-typed with tsc, since there
// is no Deno here to run the function.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const TMP = '/tmp/bot-key-errors'
rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true })

const BOTS = [
  ['telegram', 'supabase/functions/telegram-bot/index.ts'],
  ['siri',     'supabase/functions/professor-siri/index.ts'],
]
let fails = 0
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : '*** FAIL ***'}  ${n}${x ? '  ' + x : ''}`); if (!c) fails++ }

for (const [name, file] of BOTS) {
  const src = readFileSync(file, 'utf8')
  // The first thing worth asserting is that the file parses at all: a stray
  // backtick inside the system prompt's own template literal would make Deno
  // refuse to load the function and the bot would simply go quiet.
  writeFileSync(`${TMP}/${name}-whole.ts`, src)
  let parsed = true
  try {
    execFileSync('npx', ['tsc', '--noEmit', '--target', 'es2022', '--module', 'esnext',
      '--moduleResolution', 'bundler', '--skipLibCheck', '--noResolve', `${TMP}/${name}-whole.ts`],
      { stdio: 'pipe' })
  } catch (e) {
    const out = String(e.stdout ?? '')
    parsed = !/error TS1\d{3}/.test(out)   // TS1xxx are syntax errors
    if (!parsed) console.log(out.split('\n').filter(l => /TS1\d{3}/.test(l)).slice(0, 3).join('\n'))
  }
  ok(`${name}: the function parses`, parsed)

  const from = src.indexOf("if (res.status === 429)")
  const tail = "return `Sorry, I could not reach the AI service (${res.status}). Try again in a moment.`"
  const to = src.indexOf(tail, from)
  ok(`${name}: the error branch was found`, from > 0 && to > from)
  if (from < 0 || to < 0) continue

  const branch = src.slice(from, to + tail.length)
  ok(`${name}: it still handles 429 and 5xx`, /429/.test(branch) && />= 500/.test(branch))

  writeFileSync(`${TMP}/${name}.ts`,
    `export function reply(res: { status: number }, err: string, keyFrom: string): string {\n${branch}\n}\n`)
  execFileSync('npx', ['tsc', '--target', 'es2022', '--module', 'esnext', '--skipLibCheck',
    '--outDir', TMP, `${TMP}/${name}.ts`], { stdio: 'pipe' })
  const { reply } = await import(`${TMP}/${name}.js?v=${Date.now()}`)

  // 1. A 401 on the Settings key must say it was the Settings key.
  const a = reply({ status: 401 }, '{"error":{"message":"invalid x-api-key"}}', 'settings')
  ok(`${name}: a 401 names the Settings key as the one used`, /Settings → AI/.test(a), a.slice(0, 90))
  ok(`${name}: …and says credit does not fix it`, /credit does not fix it/i.test(a))

  // 2. A 401 on the function secret must not send you to Settings as the cause.
  const b = reply({ status: 401 }, '{}', 'secret')
  ok(`${name}: a 401 on the fallback names the function secret`,
     /ANTHROPIC_API_KEY/.test(b) && /nothing is saved under Settings/.test(b), b.slice(0, 110))

  // 3. Out of credit is a 400, and Anthropic's own words are the answer.
  const CREDIT = 'Your credit balance is too low to access the Anthropic API.'
  const c = reply({ status: 400 }, JSON.stringify({ error: { type: 'invalid_request_error', message: CREDIT } }), 'settings')
  ok(`${name}: a 400 quotes Anthropic's own message`, c.includes(CREDIT), c.slice(0, 120))
  ok(`${name}: …and does not blame the network`, !/could not reach/i.test(c), c.slice(0, 80))

  // 4. A 400 with a body nobody can parse still says what happened.
  const d = reply({ status: 400 }, '<html>502</html>', 'settings')
  ok(`${name}: an unreadable 400 says so rather than throwing`, /refused the request \(400\)/.test(d), d.slice(0, 80))
}

console.log(fails ? `\n${fails} failing` : '\nall good')
process.exit(fails ? 1 : 0)

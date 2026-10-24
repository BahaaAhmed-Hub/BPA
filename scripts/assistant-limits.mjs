// node scripts/assistant-limits.mjs
// supabase/functions/_shared/providerLimits.ts (re-exported by src/lib) — the real file — reading the PROVIDER's own remaining-quota headers. The claim is about
// honesty: only what a header actually said is shown; a missing or nonsense header is a bucket that is absent, never a
// guess; a bucket whose reset time has passed is shown as refilled, not as a stale shortfall.
import ts from 'typescript'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-'))
fs.writeFileSync(path.join(dir, 'l.mjs'), ts.transpileModule(fs.readFileSync(new URL('../supabase/functions/_shared/providerLimits.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText)
const L = await import(path.join(dir, 'l.mjs'))
let pass = 0, fail = 0
const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (c || !x ? '' : '  → ' + x)) }
const NOW = 1_800_000_000_000
const get = h => name => h[name.toLowerCase()] ?? null

// durations
{
  const d = L.parseDuration
  ok(d('2m59.56s') === 179560 && d('7.66s') === 7660 && d('1h2m') === 3720000 && d('500ms') === 500 && d('30') === 30000 && d('1m') === 60000, 'Groq\'s duration forms: 2m59.56s, 7.66s, 1h2m, 500ms, a bare 30')
  ok(d('') === null && d(null) === null && d(undefined) === null && d('soon') === null, 'nothing, or words, is null — not zero')
}

// Groq
{
  const l = L.parseLimits('groq', get({ 'x-ratelimit-limit-requests': '14400', 'x-ratelimit-remaining-requests': '14370', 'x-ratelimit-reset-requests': '2m59.56s', 'x-ratelimit-limit-tokens': '6000', 'x-ratelimit-remaining-tokens': '5985', 'x-ratelimit-reset-tokens': '7.66s' }), NOW)
  ok(l.requests.limit === 14400 && l.requests.remaining === 14370 && l.requests.resetAt === NOW + 179560 && l.tokens.limit === 6000 && l.tokens.remaining === 5985 && l.tokens.resetAt === NOW + 7660, 'Groq: requests (a day) and tokens (a minute), each with its limit, remaining and the moment it refills', JSON.stringify(l))
  ok(l.at === NOW && l.retryAfter === undefined, 'stamped with when it was read; no retry-after on a good reply')
  const r = L.parseLimits('groq', get({ 'x-ratelimit-limit-tokens': '6000', 'x-ratelimit-remaining-tokens': '0', 'retry-after': '23' }), NOW)
  ok(r.retryAfter === 23 && r.tokens.remaining === 0, 'a refusal carries retry-after (seconds) beside the empty bucket')
}
// Anthropic
{
  const iso = new Date(NOW + 41_000).toISOString()
  const l = L.parseLimits('anthropic', get({ 'anthropic-ratelimit-requests-limit': '50', 'anthropic-ratelimit-requests-remaining': '49', 'anthropic-ratelimit-requests-reset': iso, 'anthropic-ratelimit-tokens-limit': '40000', 'anthropic-ratelimit-tokens-remaining': '39000', 'anthropic-ratelimit-tokens-reset': iso, 'anthropic-ratelimit-input-tokens-limit': '30000', 'anthropic-ratelimit-input-tokens-remaining': '29000', 'anthropic-ratelimit-output-tokens-limit': '8000', 'anthropic-ratelimit-output-tokens-remaining': '8000' }), NOW)
  ok(l.requests.remaining === 49 && l.tokens.limit === 40000 && l.requests.resetAt === Date.parse(iso) && l.inputTokens.remaining === 29000 && l.outputTokens.resetAt === null, 'Anthropic: requests, tokens, input and output buckets; reset is a timestamp (or absent)', JSON.stringify(l))
}
// honesty
{
  ok(L.parseLimits('groq', get({}), NOW) === null && L.parseLimits('anthropic', get({ 'content-type': 'x' }), NOW) === null, 'a reply with no limit headers (or a browser not allowed to read them) is NULL — nothing is invented')
  ok(L.parseLimits('groq', get({ 'x-ratelimit-limit-tokens': '6000' }), NOW) === null, 'a limit with no "remaining" is not a reading')
  ok(L.parseLimits('groq', get({ 'x-ratelimit-limit-tokens': 'lots', 'x-ratelimit-remaining-tokens': '5' }), NOW) === null && L.parseLimits('groq', get({ 'x-ratelimit-limit-tokens': '0', 'x-ratelimit-remaining-tokens': '0' }), NOW) === null && L.parseLimits('groq', get({ 'x-ratelimit-limit-tokens': '10', 'x-ratelimit-remaining-tokens': '-3' }), NOW) === null, 'non-numeric, zero-limit and negative values are rejected')
  ok(L.parseLimits('groq', get({ 'x-ratelimit-limit-tokens': '100', 'x-ratelimit-remaining-tokens': '250' }), NOW).tokens.remaining === 100, 'remaining can never exceed the limit')
  const only = L.parseLimits('groq', get({ 'x-ratelimit-limit-requests': '14400', 'x-ratelimit-remaining-requests': '10' }), NOW)
  ok(only.requests && !only.tokens, 'a bucket that did not arrive is simply absent')
}
// readings
{
  const mk = (rem, lim, resetIn) => ({ provider: 'groq', at: NOW, tokens: { limit: lim, remaining: rem, resetAt: resetIn === null ? null : NOW + resetIn } })
  const lv = rem => L.readings(mk(rem, 1000, null), NOW)[0].level
  ok(lv(1000) === 'ok' && lv(200) === 'ok' && lv(199) === 'low' && lv(50) === 'low' && lv(49) === 'out' && lv(0) === 'out', 'levels: ok at 20% and above, low below 20%, out below 5%', [1000, 200, 199, 50, 49, 0].map(lv).join())
  const r = L.readings(mk(900, 6000, 7660), NOW)[0]
  ok(r.text === '900 of 6,000 tokens left this minute · refills in 8s' && r.resetsInMs === 7660 && !r.refilled, 'the sentence gives remaining, limit, what the window is, and when it refills', r.text)
  const later = L.readings(mk(900, 6000, 7660), NOW + 9000)[0]
  ok(later.refilled && later.level === 'ok' && later.fraction === 1 && /refilled since/.test(later.text), 'once the reset time has passed the bucket is shown refilled, not as the old shortfall')
  ok(L.readings({ provider: 'groq', at: NOW, requests: { limit: 14400, remaining: 100, resetAt: null } }, NOW)[0].text === '100 of 14,400 requests left today', 'Groq\'s request bucket is a DAY ("today")')
  ok(L.readings({ provider: 'anthropic', at: NOW, requests: { limit: 50, remaining: 5, resetAt: null } }, NOW)[0].text === '5 of 50 requests left this minute', 'Anthropic\'s is a minute')
}
// the view
{
  const g = L.parseLimits('groq', get({ 'x-ratelimit-limit-requests': '14400', 'x-ratelimit-remaining-requests': '14370', 'x-ratelimit-limit-tokens': '6000', 'x-ratelimit-remaining-tokens': '600' }), NOW)
  const v = L.viewLimits(g, NOW + 5000)
  ok(v.line === '14k req/day · 600 tokens/min left' && v.level === 'low' && v.tightest.key === 'tokens' && v.ageMs === 5000, 'the line under the model name, the worst bucket decides the level, and the age is known', JSON.stringify({ line: v.line, level: v.level }))
  const a = { provider: 'anthropic', at: NOW, tokens: { limit: 40000, remaining: 39000, resetAt: null }, inputTokens: { limit: 30000, remaining: 100, resetAt: null } }
  ok(!L.viewLimits(a, NOW).lines.some(x => /input/.test(x)), 'Anthropic: the combined token bucket is the headline; the split ones are not also listed')
  const b = { provider: 'anthropic', at: NOW, inputTokens: { limit: 30000, remaining: 29000, resetAt: null }, outputTokens: { limit: 8000, remaining: 100, resetAt: null } }
  const vb = L.viewLimits(b, NOW)
  ok(vb.lines.length === 2 && vb.level === 'out' && vb.tightest.key === 'outputTokens', '…but with no combined bucket the split ones ARE shown, and the tighter one decides (100 of 8,000 is 1.25%: out)')
  ok(L.viewLimits({ provider: 'groq', at: NOW }, NOW) === null, 'nothing to show → null')
  ok(L.viewLimits({ provider: 'groq', at: NOW, retryAfter: 30 }, NOW).retryAfter === 30, 'a bare retry-after is still worth telling')
}
// stored
{
  ok(L.limitsFromRow(null) === null && L.limitsFromRow('x') === null && L.limitsFromRow({}) === null, 'old rows and junk read as nothing')
  const back = L.limitsFromRow(JSON.parse(JSON.stringify(L.parseLimits('groq', get({ 'x-ratelimit-limit-tokens': '6000', 'x-ratelimit-remaining-tokens': '10', 'x-ratelimit-reset-tokens': '5s' }), NOW))))
  ok(back.tokens.remaining === 10 && back.tokens.resetAt === NOW + 5000 && back.provider === 'groq', 'a reading survives being stored as JSON and read back')
  ok(L.limitsFromRow({ provider: 'groq', at: 1, tokens: { limit: 0, remaining: 5 } }) === null && L.limitsFromRow({ provider: 'groq', at: 1, tokens: { limit: 10, remaining: -1 } }) === null, 'a stored bucket that makes no sense is dropped')
}
ok(L.waitText(30) === '30s' && L.waitText(90) === '1m 30s' && L.waitText(3600) === '1h' && L.waitText(0) === 'under a second', 'wait times in words')
ok(L.waitText(179.56) === '3m' && L.waitText(119.4) === '2m' && L.waitText(59.2) === '1m' && L.waitText(3599.2) === '1h' && L.waitText(5400) === '1h 30m', 'a duration never reads "2m 60s": whole seconds first, then split into units', [179.56, 119.4, 59.2, 3599.2, 5400].map(L.waitText).join())
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)

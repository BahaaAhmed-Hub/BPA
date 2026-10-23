// node scripts/assistant-usage.mjs
// src/lib/aiUsage.ts — the real file — the counter's arithmetic and wording. Tokens are exact; the amount is an
// estimate that says so, can be overridden by the person's own rate, and is NEVER invented for a model with no price.
import ts from 'typescript'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'au-'))
fs.writeFileSync(path.join(dir, 'u.mjs'), ts.transpileModule(fs.readFileSync(new URL('../src/lib/aiUsage.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText)
const U = await import(path.join(dir, 'u.mjs'))
let pass = 0, fail = 0
const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (c || !x ? '' : '  → ' + x)) }
const u = (model, input, output, extra = {}) => ({ model, provider: model.startsWith('claude') ? 'anthropic' : 'groq', input, output, cacheRead: 0, cacheWrite: 0, ...extra })

// formatting
{
  const f = U.formatTokens
  ok([0, 7, 999].map(f).join() === '0,7,999', 'small counts are shown whole')
  ok([1000, 1234, 9999, 12400, 999400].map(f).join() === '1k,1.2k,10k,12k,999k', 'thousands', [1000, 1234, 9999, 12400, 999400].map(f).join())
  ok([999600, 1_000_000, 1_234_567, 1_200_000, 12_500_000].map(f).join() === '1M,1M,1.23M,1.2M,12.5M', 'millions (999,600 is "1M", not "1000k")', [999600, 1_000_000, 1_234_567, 1_200_000, 12_500_000].map(f).join())
  const d = U.formatUsd
  ok([0, 0.004, 0.04, 9.999, 12.34, 1234.5].map(d).join() === '$0.00,<$0.01,$0.04,$10.00,$12.3,$1,235', 'money: sub-cent is "<$0.01", not "$0.00"', [0, 0.004, 0.04, 9.999, 12.34, 1234.5].map(d).join())
}
// prices
{
  ok(U.priceFor('claude-sonnet-4-6')?.price.in === 3 && U.priceFor('claude-sonnet-4-6').source === 'estimate', 'a known family has a built-in price, marked as an estimate')
  ok(U.priceFor('claude-fable-5-1') === null, 'a model nobody has priced has NO price (not a guess)')
  ok(U.priceFor('openai/gpt-oss-120b')?.price.out === 0.75 && U.priceFor('llama-3.3-70b-versatile')?.price.in === 0.59, 'Groq models are priced by family')
  ok(U.priceFor('claude-sonnet-4-6', { 'claude-sonnet-4-6': { in: 2, out: 9 } }).source === 'yours' && U.priceFor('claude-sonnet-4-6', { 'claude-sonnet-4-6': { in: 2, out: 9 } }).price.out === 9, 'the person\'s own rate wins')
  ok(U.priceFor('claude-fable-5-1', { 'claude-fable-5-1': { in: 4, out: 20 } })?.source === 'yours', 'and prices a model the app has never heard of')
  ok(U.priceFor('claude-sonnet-4-6', { 'claude-sonnet-4-6': { in: NaN, out: 9 } }).source === 'estimate' && U.priceFor('claude-sonnet-4-6', { 'claude-sonnet-4-6': { in: -1, out: 9 } }).source === 'estimate', 'CONTROL: a nonsense override (NaN, negative) is ignored, not used')
  ok(U.priceFor('claude-haiku-5-5', { 'claude-sonnet-4-6': { in: 2, out: 9 } }).source === 'estimate', 'an override is for that model only')
}
// cost
{
  ok(Math.abs(U.costOf(u('claude-sonnet-4-6', 1_000_000, 1_000_000)) - 18) < 1e-9, '1M in + 1M out on Sonnet = $3 + $15')
  ok(Math.abs(U.costOf(u('claude-sonnet-4-6', 0, 0, { cacheWrite: 1_000_000, cacheRead: 1_000_000 })) - (1.25 * 3 + 0.1 * 3)) < 1e-9, 'cache writes cost 1.25× and cache reads 0.1× the input rate')
  ok(U.costOf(u('claude-fable-5-1', 1000, 1000)) === null, 'no price → null, never 0')
  ok(U.costOf(u('claude-sonnet-4-6', 1_000_000, 0), { 'claude-sonnet-4-6': { in: 1, out: 1 } }) === 1, 'the override is what is applied')
}
// summing
{
  const s = U.summarise([u('claude-sonnet-4-6', 1000, 200), u('claude-sonnet-4-6', 500, 100)])
  ok(s.total === 1800 && s.tokens.input === 1500 && s.tokens.output === 300 && s.calls === 2 && !s.partial && s.unpriced.length === 0, 'tokens add exactly across requests', JSON.stringify(s))
  ok(Math.abs(s.usd - (1500 * 3 + 300 * 15) / 1e6) < 1e-12, 'and so does the amount')
  const m = U.summarise([u('claude-sonnet-4-6', 1000, 0), u('claude-fable-5-1', 5000, 0)])
  ok(m.total === 6000 && m.partial && m.unpriced.join() === 'claude-fable-5-1' && Math.abs(m.usd - 0.003) < 1e-12, 'a conversation that changed model: tokens all count, dollars only where a price exists, and it says it is partial', JSON.stringify(m))
  const n = U.summarise([u('claude-fable-5-1', 5000, 10)])
  ok(n.usd === null && !n.partial && n.total === 5010, 'only unpriced models: tokens, and no amount at all')
  ok(U.summarise([]).total === 0 && U.summarise([]).usd === null && U.summarise([]).calls === 0, 'nothing used → zero, no amount')
  const z = U.summarise([u('claude-fable-5-1', 0, 0), u('claude-sonnet-4-6', 10, 0)])
  ok(z.unpriced.length === 0 && !z.partial, 'a model with no tokens is not reported as "unpriced"')
  ok(U.summarise([u('claude-sonnet-4-6', 1, 1)], { 'claude-sonnet-4-6': { in: 1, out: 1 } }).usesOwnPrice === true && U.summarise([u('claude-sonnet-4-6', 1, 1)]).usesOwnPrice === false, 'it knows whether the amount came from the person\'s rate')
}
// reading stored rows
{
  ok(U.usageFromRow(null) === null && U.usageFromRow(undefined) === null && U.usageFromRow('x') === null && U.usageFromRow({}) === null, 'old rows (no usage) and junk are nothing, not errors')
  const r = U.usageFromRow({ input: 10, output: 5, model: 'm', provider: 'groq' })
  ok(r.input === 10 && r.output === 5 && r.cacheRead === 0 && r.provider === 'groq', 'a stored usage reads back')
  const bad = U.usageFromRow({ input: -5, output: 'many', cacheRead: NaN, model: 3 })
  ok(bad === null, 'negative, non-numeric and NaN fields count as zero (and an all-zero row is nothing)')
  ok(U.usageFromRow({ input: 7, output: 0 }).provider === 'anthropic' && U.usageFromRow({ input: 7, output: 0 }).model === '', 'missing model/provider do not throw')
}
// the live estimate
{
  ok(U.estimateOutputTokens(0) === 0 && U.estimateOutputTokens(400) === 100 && U.estimateOutputTokens(3) === 1, 'a streaming answer is estimated at ~4 characters a token')
}
// wording
{
  const sum = (list, o) => U.summarise(list, o)
  const a = U.counterText(sum([u('claude-sonnet-4-6', 12000, 400)]))
  ok(a.short === '12k tokens · ≈$0.04', 'beside the model: tokens, and an amount marked ≈ (12,000 in × $3 + 400 out × $15 per million = $0.042)', a.short)
  ok(/estimate from list prices/.test(a.long) && /12,000 in · 400 out/.test(a.long), 'the tooltip gives the breakdown and says the amount is an estimate', a.long)
  const live = U.counterText(sum([u('claude-sonnet-4-6', 100, 50)]), true)
  ok(live.short.startsWith('~') && /still being written/.test(live.long), 'while an answer streams the figure is marked "~" and the tooltip says why')
  const own = U.counterText(sum([u('claude-sonnet-4-6', 1000, 1000)], { 'claude-sonnet-4-6': { in: 1, out: 1 } }))
  ok(!own.short.includes('≈') && /price you set/.test(own.long), 'with the person\'s own rate the amount is not called an estimate')
  const part = U.counterText(sum([u('claude-sonnet-4-6', 1000, 0), u('claude-fable-5-1', 1000, 0)]))
  ok(/\+$/.test(part.short) && /claude-fable-5-1/.test(part.long), 'a partly-priced conversation shows a "+" and names what was not priced')
  const mixed = U.counterText(sum([u('claude-sonnet-4-6', 1_000_000, 0), u('openai/gpt-oss-120b', 1_000_000, 0)], { 'claude-sonnet-4-6': { in: 1, out: 1 } }))
  ok(mixed.short.includes('≈') && /your own price where you set one/.test(mixed.long), 'some figures yours, some estimated: still called an estimate, and the tooltip says which', mixed.short)
  ok(U.counterText(sum([u('llama-3.1-8b-instant', 3000, 100)])).short === '3.1k tokens · <$0.01', 'a sub-cent amount is "<$0.01", with no "≈" in front of it', U.counterText(sum([u('llama-3.1-8b-instant', 3000, 100)])).short)
  const none = U.counterText(sum([u('claude-fable-5-1', 1, 0)]))
  ok(none.short === '1 token' && !/\$/.test(none.short) && /no amount is shown/.test(none.long), 'an unpriced model shows tokens only (and "1 token" is singular)', none.short)
  ok(U.counterText(sum([])).short === '0 tokens', 'nothing yet reads "0 tokens"')
}
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)

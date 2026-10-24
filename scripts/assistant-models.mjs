// node scripts/assistant-models.mjs
// src/lib/modelCatalog.ts — transpiled from the real file — against a fake Groq/Anthropic that can say no.
// The claim: a model the key cannot use ("does not exist or you do not have access to it") is replaced by one that
// works; ANYTHING ELSE that goes wrong (offline, bad key, rate limit) leaves the person's choice alone.
import ts from 'typescript'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-'))
for (const f of ['modelInfo', 'modelCatalog']) {
  let src = fs.readFileSync(new URL(`../src/lib/${f}.ts`, import.meta.url), 'utf8').replace(/from '\.\/modelInfo'/g, "from './modelInfo.mjs'")
  fs.writeFileSync(path.join(dir, f + '.mjs'), ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText)
}
const C = await import(path.join(dir, 'modelCatalog.mjs'))
let pass = 0, fail = 0
const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (c || !x ? '' : '  → ' + x)) }

// a provider whose models and permissions we control
function groq({ models = [], usable = [], listStatus = 200, chatStatus = null, offline = false } = {}) {
  const calls = []
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null, auth: init.headers?.Authorization ?? init.headers?.authorization })
    if (offline) throw new TypeError('Failed to fetch')
    if (/\/models(\?|$)/.test(String(url))) {
      if (listStatus !== 200) return new Response(JSON.stringify({ error: { message: 'Invalid API Key' } }), { status: listStatus })
      return new Response(JSON.stringify({ data: models.map(id => typeof id === 'string' ? { id } : id) }), { status: 200 })
    }
    const model = JSON.parse(init.body).model
    if (chatStatus) return new Response(JSON.stringify({ error: { message: chatStatus.message } }), { status: chatStatus.status })
    if (!usable.includes(model)) return new Response(JSON.stringify({ error: { message: `The model \`${model}\` does not exist or you do not have access to it.` } }), { status: 404 })
    return new Response(JSON.stringify({ choices: [{ message: { content: 'h' } }] }), { status: 200 })
  }
  f.calls = calls
  return f
}
const KEY = 'gsk_abcdefghij'

// listing
{
  const f = groq({ models: ['llama-3.3-70b-versatile', 'whisper-large-v3', 'llama-guard-4-12b', 'playai-tts', { id: 'old-model', active: false }, 'openai/gpt-oss-120b', 'llama-3.3-70b-versatile'] })
  const o = await C.listModels('groq', KEY, f)
  ok(JSON.stringify(o.map(x => x.id)) === '["llama-3.3-70b-versatile","openai/gpt-oss-120b"]', 'only chat models the key can see: speech, guard, TTS and inactive ones are left out, duplicates collapse', JSON.stringify(o.map(x => x.id)))
  ok(o[0].label === 'Llama 3.3 70B' && f.calls[0].auth === `Bearer ${KEY}`, 'each gets a readable label, and the list is asked for with the person\'s own key')
  let msg = ''; try { await C.listModels('groq', KEY, groq({ listStatus: 401 })) } catch (e) { msg = e.message + '|' + e.status }
  ok(msg === 'Invalid API Key|401', 'a refused key says so in the provider\'s own words', msg)
  let none = ''; try { await C.listModels('groq', '', groq()) } catch (e) { none = e.message }
  ok(/No API key/.test(none), 'no key → says so without calling anyone')
  const a = groq({ models: ['claude-sonnet-5-5', 'claude-haiku-5-5', 'something-else'] })
  const ao = await C.listModels('anthropic', 'sk-ant-x', a)
  ok(ao.length === 2 && a.calls[0].url.includes('anthropic.com') && a.calls[0].auth === undefined, 'Anthropic: only claude-* ids, sent with x-api-key and the browser-access header', JSON.stringify(ao))
}

// probing
{
  ok((await C.probeGroq(KEY, 'm', groq({ usable: ['m'] }))).ok === true, 'a model the key can use probes ok')
  const gone = await C.probeGroq(KEY, 'dead', groq({ usable: [] }))
  ok(!gone.ok && gone.missing && !gone.inconclusive && /does not exist or you do not have access/.test(gone.message), 'the exact error in the report is classified as "missing"', JSON.stringify(gone))
  const bad = await C.probeGroq(KEY, 'm', groq({ chatStatus: { status: 401, message: 'Invalid API Key' } }))
  ok(!bad.ok && !bad.missing && bad.inconclusive, 'a refused key says nothing about the model')
  const lim = await C.probeGroq(KEY, 'm', groq({ chatStatus: { status: 429, message: 'Rate limit reached' } }))
  ok(!lim.ok && !lim.missing && lim.inconclusive, 'neither does a rate limit')
  const off = await C.probeGroq(KEY, 'm', groq({ offline: true }))
  ok(!off.ok && !off.missing && off.inconclusive, 'nor being offline')
  const probeBody = groq({ usable: ['m'] }); await C.probeGroq(KEY, 'm', probeBody)
  ok(probeBody.calls[0].body.max_tokens === 1 && probeBody.calls[0].body.model === 'm', 'the probe is one token')
}

// message classifiers
{
  ok(C.isModelMissingMessage('The model `x` does not exist or you do not have access to it.') && C.isModelMissingMessage('model_not_found') && C.isModelMissingMessage('This model has been decommissioned'), 'missing-model wording is recognised')
  ok(!C.isModelMissingMessage('Invalid API Key') && !C.isModelMissingMessage('Rate limit reached for model x'), 'CONTROL: a bad key and a rate limit are not "missing model"')
  ok(C.isBillingMessage('Your credit balance is too low to access the Anthropic API') && C.isBillingMessage('You exceeded your current quota, please check your plan and billing details') && !C.isBillingMessage('Invalid API Key'), 'billing wording is recognised, a bad key is not')
}

// fallback ordering
{
  const order = C.fallbackOrder(['llama-3.1-8b-instant', 'zzz', 'openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'aaa'], 'llama-3.3-70b-versatile')
  ok(order[0] === 'openai/gpt-oss-120b' && order[1] === 'llama-3.1-8b-instant' && !order.includes('llama-3.3-70b-versatile'), 'the failed model is never its own fallback; the better-known models come first', JSON.stringify(order))
  ok(order.slice(2).join() === 'zzz,aaa', 'then whatever else the key has, in the order given')
}

// the self-heal
{
  C._resetProven()
  const f = groq({ models: ['llama-3.1-8b-instant', 'openai/gpt-oss-120b', 'whisper-large-v3'], usable: ['openai/gpt-oss-120b', 'llama-3.1-8b-instant'] })
  const r = await C.ensureWorkingGroqModel(KEY, 'llama-3.3-70b-versatile', f)
  ok(r.model === 'openai/gpt-oss-120b' && r.switched?.from === 'llama-3.3-70b-versatile' && /does not exist or you do not have access/.test(r.switched.reason), 'THE REPORT: the model the key cannot use is replaced by the best one it can, and the reason is kept', JSON.stringify(r))
  const before = f.calls.length
  const again = await C.ensureWorkingGroqModel(KEY, 'openai/gpt-oss-120b', f)
  ok(again.model === 'openai/gpt-oss-120b' && !again.switched && f.calls.length === before, 'a model already proven this session costs no request at all')

  C._resetProven()
  const g = groq({ models: ['llama-3.3-70b-versatile'], usable: ['llama-3.3-70b-versatile'] })
  const same = await C.ensureWorkingGroqModel(KEY, 'llama-3.3-70b-versatile', g)
  ok(same.model === 'llama-3.3-70b-versatile' && !same.switched && g.calls.length === 1, 'CONTROL: a model that works is left alone, after exactly one probe and no list request')

  C._resetProven()
  const off = await C.ensureWorkingGroqModel(KEY, 'llama-3.3-70b-versatile', groq({ offline: true }))
  ok(off.model === 'llama-3.3-70b-versatile' && !off.switched && !off.failed, 'offline: the choice is not touched')
  C._resetProven()
  const lim = await C.ensureWorkingGroqModel(KEY, 'llama-3.3-70b-versatile', groq({ chatStatus: { status: 429, message: 'Rate limit' } }))
  ok(lim.model === 'llama-3.3-70b-versatile' && !lim.switched, 'rate limited: the choice is not touched')
  C._resetProven()
  const nokey = groq({ chatStatus: { status: 401, message: 'Invalid API Key' } })
  const bk = await C.ensureWorkingGroqModel(KEY, 'llama-3.3-70b-versatile', nokey)
  ok(bk.model === 'llama-3.3-70b-versatile' && !bk.switched && nokey.calls.length === 1, 'a refused key: the choice is not touched and nobody keeps guessing')

  C._resetProven()
  const none = groq({ models: ['a', 'b', 'c', 'd', 'e', 'f'], usable: [] })
  const nope = await C.ensureWorkingGroqModel(KEY, 'dead', none)
  ok(nope.model === 'dead' && !!nope.failed && none.calls.filter(c => c.body).length <= 5, 'nothing works: the original is kept so the real error shows, and it stops after a few tries', `chat calls=${none.calls.filter(c => c.body).length}`)
  C._resetProven()
  const nolist = await C.ensureWorkingGroqModel(KEY, 'dead', groq({ listStatus: 500, usable: [] }))
  ok(nolist.model === 'dead' && !!nolist.failed && !nolist.switched, 'model missing and the list unavailable: kept, with the reason')
  C._resetProven()
  const nk = await C.ensureWorkingGroqModel('', 'x', groq())
  ok(nk.model === 'x', 'no key: nothing to check')
}
// labels for ids that carry a publisher
{
  const D = await import(path.join(dir, 'modelInfo.mjs'))
  const l = (id, prov = 'groq') => D.describeModel(prov, id).label
  ok(l('openai/gpt-oss-120b') === 'GPT OSS 120B', 'a publisher prefix is not part of the name, and GPT is an initialism', l('openai/gpt-oss-120b'))
  ok(l('meta-llama/llama-4-scout-17b-16e-instruct') === 'Llama 4 Scout 17B 16e', 'Llama 4 Scout reads as that', l('meta-llama/llama-4-scout-17b-16e-instruct'))
  ok(l('qwen/qwen3-32b') === 'Qwen3 32B', 'Qwen3 32B', l('qwen/qwen3-32b'))
  ok(l('llama-3.3-70b-versatile') === 'Llama 3.3 70B' && l('llama-3.1-8b-instant') === 'Llama 3.1 8B', 'CONTROL: ids with no prefix read as before')
  ok(D.describeModel('groq', 'openai/gpt-oss-120b').id === 'openai/gpt-oss-120b', 'and the id itself is untouched (it is what is sent)')
  ok(l('claude-haiku-5-5', 'anthropic') === 'Haiku 5.5' && l('claude-sonnet-4-6', 'anthropic') === 'Sonnet 4.6', 'Claude labels unchanged')
}
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)

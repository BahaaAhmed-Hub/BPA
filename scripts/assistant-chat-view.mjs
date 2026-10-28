// node scripts/assistant-chat-view.mjs
// src/lib/assistantChatView.ts — the rules the panel lives by, transpiled from the real file.
import ts from 'typescript'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const SRC = new URL('../src/lib/assistantChatView.ts', import.meta.url)
const js = ts.transpileModule(fs.readFileSync(SRC, 'utf8').replace(/^import type .*$/m, ''), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acv-'))
fs.writeFileSync(path.join(dir, 'v.mjs'), js.outputText)
const V = await import(path.join(dir, 'v.mjs'))
let pass = 0, fail = 0
const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (c || !x ? '' : '  → ' + x)) }

const NOW = Date.parse('2026-10-23T12:00:00Z')
const ago = ms => new Date(NOW - ms).toISOString()
const R = (id, role, over = {}) => ({ id, conversation_id: 'c', role, content: '', status: 'complete', updated_at: ago(1000), ...over })

// bubbles
{
  const rows = [
    R(1, 'user', { content: 'hi', client_id: 'u-1', files: [{ name: 'a.pdf', kind: 'pdf' }] }),
    R(2, 'assistant', { content: 'hello' }),
    R(3, 'tool', { tool: 'list_habits', tool_state: 'done', tool_use_id: 'toolu_1' }),
    R(4, 'assistant', { content: 'boom', status: 'error' }),
    R(5, 'assistant', { content: '', status: 'streaming' }),
    R(6, 'assistant', { content: 'half', status: 'streaming', updated_at: ago(V.STALE_ANSWER_MS + 5000) }),
  ]
  const b = V.rowsToBubbles(rows, NOW)
  ok(b[0].id === 'u-1' && b[0].files[0].name === 'a.pdf', 'a user bubble keeps its client id (so the optimistic bubble and the row are one) and its file chip')
  ok(b[2].role === 'tool' && b[2].state === 'done' && b[2].tool === 'list_habits' && b[2].id === 'tool-toolu_1', 'a tool row is a chip with its state')
  ok(b[3].role === 'error' && b[3].content === 'boom', 'an errored answer is an error bubble')
  ok(!b.some(x => x.id === 'row-5'), 'a fresh streaming answer with no words yet draws nothing (the thinking dot stands in)')
  ok(b[4].role === 'error' && /half/.test(b[4].content) && /interrupted/.test(b[4].content), 'a streaming answer untouched for ~100s reads as interrupted, with what it had')
  ok(V.rowsToBubbles([R(1, 'assistant', { content: 'typing…', status: 'streaming' })], NOW)[0].role === 'assistant', 'CONTROL: a streaming answer touched a second ago is just an answer')
}
// busy
{
  ok(V.busyOf([R(1, 'user'), R(2, 'assistant', { status: 'streaming' })], NOW), 'a live streaming answer is busy')
  ok(!V.busyOf([R(1, 'user'), R(2, 'assistant', { status: 'streaming', updated_at: ago(200000) })], NOW), 'a dead one is not')
  ok(V.busyOf([R(1, 'user'), R(2, 'tool', { tool_state: 'running', tool_use_id: 'a' })], NOW), 'a tool waiting to run is busy')
  ok(V.busyOf([R(1, 'user'), R(2, 'tool', { tool_state: 'done', tool_use_id: 'a' })], NOW), 'a tool that has just come back is busy (the next step is about to start)')
  ok(!V.busyOf([R(1, 'user'), R(2, 'tool', { tool_state: 'done', tool_use_id: 'a', updated_at: ago(V.FINISHED_TOOL_GRACE_MS + 1000) })], NOW), 'but not for ever')
  ok(!V.busyOf([R(1, 'user'), R(2, 'tool', { tool_state: 'done', tool_use_id: 'a' }), R(3, 'assistant', { content: 'done' })], NOW), 'CONTROL: a finished answer after the tool is not busy')
}
// claims
{
  const run = (over) => R(2, 'tool', { tool_state: 'running', tool_use_id: 'a', ...over })
  ok(V.claimable([run({})], NOW).length === 1, 'an unclaimed running call may be taken')
  ok(V.claimable([run({ claimed_by: 'x', claimed_at: ago(10000) })], NOW).length === 0, 'one claimed ten seconds ago may not')
  ok(V.claimable([run({ claimed_by: 'x', claimed_at: ago(V.CLAIM_MS + 1000) })], NOW).length === 1, 'one whose claimant has been silent for two minutes may')
  ok(V.claimable([run({ claimed_by: 'me', claimed_at: ago(10000) })], NOW, 'me').length === 1, 'a call claimed by THIS device is reclaimable (the page was reloaded under its approval card)')
  ok(V.claimable([run({ claimed_by: 'someone-else', claimed_at: ago(10000) })], NOW, 'me').length === 0, 'CONTROL: another device\'s fresh claim still is not')
  ok(V.claimable([R(2, 'tool', { tool_state: 'done', tool_use_id: 'a' })], NOW).length === 0, 'a finished call is never retaken')
}
// continue
{
  const t = (id, st) => R(id, 'tool', { tool_state: st, tool_use_id: 't' + id })
  ok(V.awaitingContinue([R(1, 'user'), t(2, 'done'), t(3, 'failed')]) === '2,3', 'every tool back and nothing after: ask for the next step (a signature)')
  ok(V.awaitingContinue([R(1, 'user'), t(2, 'done'), t(3, 'running')]) === null, 'one still running: not yet')
  ok(V.awaitingContinue([R(1, 'user'), t(2, 'done'), R(3, 'assistant', { content: 'x' })]) === null, 'an answer after the tools: the turn moved on')
  ok(V.awaitingContinue([R(1, 'user'), t(2, 'done'), R(3, 'assistant', { status: 'streaming' })]) === null, 'one already streaming: leave it')
  ok(V.awaitingContinue([R(1, 'user')]) === null, 'no tools at all: nothing to continue')
}
// merge
{
  const a = R(1, 'assistant', { content: 'new', updated_at: ago(1000) }), old = { ...a, content: 'old', updated_at: ago(5000) }
  ok(V.mergeRows([a], [old])[0].content === 'new', 'a late, older copy of a row does not undo a newer one')
  ok(V.mergeRows([a], [R(2, 'user')]).map(r => r.id).join() === '1,2', 'new rows are added in conversation order')
  ok(V.mergeRows([R(5, 'user'), R(3, 'user')], []).map(r => r.id).join() === '3,5', 'and always sorted by id')
}
// url
{
  const id = '25f5a489-6449-434e-808e-41d42678781d'
  ok(V.chatIdFromUrl('http://x/BPA/?c=' + id) === id && V.chatIdFromUrl('http://x/BPA/?c=nope') === null && V.chatIdFromUrl('http://x/BPA/') === null, 'the conversation id is read from the address, and only if it is a uuid')
  ok(V.urlWithChat('http://x/BPA/?book=bahaa#top', id) === `/BPA/?book=bahaa&c=${id}#top`, 'setting it keeps the path, other parameters and the hash')
  ok(V.urlWithChat(`http://x/BPA/?book=bahaa&c=${id}#top`, null) === '/BPA/?book=bahaa#top', 'removing it leaves the rest alone')
}
// draft
{
  const store = new Map(); globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) }
  V.saveDraft('half'); ok(V.loadDraft() === 'half', 'a draft is kept')
  V.saveDraft(''); ok(V.loadDraft() === '' && !store.has(V.DRAFT_KEY), 'an empty box removes it')
  globalThis.localStorage = { getItem() { throw new Error('private window') }, setItem() { throw new Error('x') }, removeItem() { throw new Error('x') } }
  ok(V.loadDraft() === '' && (V.saveDraft('x'), true), 'with storage blocked (private window) it neither throws nor loses the box')
  ok(typeof V.deviceId() === 'string' && V.deviceId().length > 5, 'a device id exists even with storage blocked')
}
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)

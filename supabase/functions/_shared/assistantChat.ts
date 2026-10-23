// assistantChat — the web assistant's turn, run on the server.
//
// Pure logic with its dependencies passed in, so it runs unchanged under Deno
// (the `assistant-chat` function) and under Node (scripts/assistant-chat-server.mjs,
// which feeds it a fake database and a fake model that can refuse).
//
// ONE MODEL STEP PER INVOCATION. A turn is a chain of steps: the model answers,
// or asks for tools. Tools run in the BROWSER (they read and write the app's own
// stores and wait on an approval card), so when the model asks for one this file
// parks the call as a row and stops. The browser that claims it runs it and asks
// for the next step. A step that ends with plain text completes the turn.
//
// What is persisted while it runs:
//   · the answer, as a row whose `content` grows (status 'streaming'), written at
//     most every FLUSH_MS and once more at the end;
//   · `conversations.turn` — the provider-format messages of THIS turn only, so a
//     continuation after a tool is exact. Cleared when the turn ends.
// History across turns is plain text (see 20260042): tool_use/tool_result pairs
// from old turns are stale and the API wants them adjacent.

export type Provider = 'anthropic' | 'groq'

export interface Row {
  id: number
  role: 'user' | 'assistant' | 'tool' | 'error'
  content: string
  status: 'streaming' | 'complete' | 'error'
  tool?: string | null
  tool_state?: 'running' | 'done' | 'failed' | null
  tool_use_id?: string | null
  tool_input?: unknown
  tool_result?: string | null
}

export interface ToolCall { id: string; name: string; input: Record<string, unknown> }

/** What one request to the model cost, as the PROVIDER reported it — never estimated here. */
export interface Tokens { input: number; output: number; cacheRead: number; cacheWrite: number }
export interface Usage extends Tokens { model: string; provider: Provider }

export interface Turn {
  provider: Provider
  msgs: unknown[]
  /** tool_use ids the model asked for and has not had answered yet */
  pending: string[]
  steps: number
}

/** What the server needs from storage. The function backs it with Supabase; the
 *  harness backs it with arrays — and a version that can fail. */
export interface ChatDb {
  rows(conversationId: string): Promise<Row[]>
  getTurn(conversationId: string): Promise<Turn | null>
  setTurn(conversationId: string, turn: Turn | null): Promise<void>
  /** Insert the streaming answer row. Resolves null when one already exists
   *  (the unique index): somebody else is answering. */
  startAnswer(conversationId: string): Promise<number | null>
  updateAnswer(id: number, content: string): Promise<void>
  finishAnswer(id: number, status: 'complete' | 'error', content: string, usage?: Usage): Promise<void>
  deleteRow(id: number): Promise<void>
  addToolRows(conversationId: string, calls: ToolCall[]): Promise<void>
  /** Rows of this conversation's tool calls with these ids. */
  toolRows(conversationId: string, ids: string[]): Promise<Row[]>
  /** Streaming rows nobody has touched for a while belong to a dead invocation. */
  sweepStale(conversationId: string, olderThanMs: number): Promise<void>
}

export interface StepParams {
  provider: Provider
  conversationId: string
  mode: 'turn' | 'continue'
  key: string
  model: string
  system: string
  /** Already in the provider's own format (the page owns the tool list). */
  tools: unknown[]
  maxTokens?: number
}

export interface StepDeps {
  db: ChatDb
  fetchFn?: typeof fetch
  now?: () => number
}

export type StepOutcome = 'done' | 'tools' | 'busy' | 'not_ready' | 'nothing' | 'error'

export const FLUSH_MS = 700
export const STALE_MS = 90_000
export const MAX_STEPS = 12
const WINDOW_TURNS = 20
const WINDOW_CHARS = 12_000

// ── History ──────────────────────────────────────────────────────────────────

export interface Msg { role: 'user' | 'assistant'; content: string }

/** Opens on the user, merges a same-role run, never ends on an assistant when a
 *  user turn is coming. The API rejects two of one role in a row. */
export function alternating(turns: Msg[]): Msg[] {
  const out: Msg[] = []
  for (const t of turns) {
    if (!t.content.trim()) continue
    const last = out[out.length - 1]
    if (!last && t.role !== 'user') continue
    if (last && last.role === t.role) last.content += '\n\n' + t.content
    else out.push({ ...t })
  }
  return out
}

/** The messages that start a turn: the finished text of the conversation so
 *  far, newest window, ending on the user message being answered. */
export function turnStart(rows: Row[]): Msg[] {
  const ordered = [...rows].sort((a, b) => a.id - b.id)
  let lastUser = -1
  ordered.forEach((r, i) => { if (r.role === 'user') lastUser = i })
  if (lastUser < 0) return []
  const before: Msg[] = []
  for (const r of ordered.slice(0, lastUser)) {
    if ((r.role === 'user' || r.role === 'assistant') && r.status === 'complete' && r.content.trim()) {
      before.push({ role: r.role, content: r.content })
    }
  }
  let window = before.slice(-WINDOW_TURNS)
  let chars = 0
  const kept: Msg[] = []
  for (let i = window.length - 1; i >= 0; i--) {
    chars += window[i].content.length
    if (chars > WINDOW_CHARS && kept.length) break
    kept.unshift(window[i])
  }
  window = kept
  return alternating([...window, { role: 'user', content: ordered[lastUser].content }])
}

// ── Anthropic: server-sent events ────────────────────────────────────────────

export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let at: number
    while ((at = buf.search(/\r?\n\r?\n/)) >= 0) {
      const block = buf.slice(0, at)
      buf = buf.slice(at).replace(/^\r?\n\r?\n/, '')
      const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('')
      if (!data || data === '[DONE]') continue
      try { yield JSON.parse(data) as Record<string, unknown> } catch { /* a comment or a ping */ }
    }
  }
}

export class ModelError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }

export interface StepResult {
  /** what the provider said this request used (zeros when it said nothing) */
  tokens: Tokens
  text: string
  calls: ToolCall[]
  /** the assistant message to append to the turn, in the provider's format */
  assistant: unknown
  truncated: boolean
}

export async function streamAnthropic(p: {
  key: string; model: string; system: string; tools: unknown[]; messages: unknown[]; maxTokens: number
  fetchFn: typeof fetch; onText: (soFar: string) => void
}): Promise<StepResult> {
  const res = await p.fetchFn('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': p.key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: p.model, max_tokens: p.maxTokens, system: p.system, tools: p.tools, messages: p.messages, stream: true,
    }),
  })
  if (!res.ok || !res.body) {
    let msg = `Anthropic ${res.status}`
    try { const j = await res.json() as { error?: { message?: string } }; if (j.error?.message) msg = j.error.message } catch { /* keep the status */ }
    throw new ModelError(msg, res.status)
  }
  const blocks: Block[] = []
  const json: string[] = []
  const tokens: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  let text = ''
  let stop = ''
  for await (const ev of sseData(res.body)) {
    const type = ev.type as string
    if (type === 'error') {
      const e = ev.error as { message?: string } | undefined
      throw new ModelError(e?.message ?? 'The model stream failed.', 529)
    }
    if (type === 'message_start') {
      const u = (ev.message as { usage?: Record<string, number> } | undefined)?.usage
      if (u) {
        tokens.input = u.input_tokens ?? 0
        tokens.cacheRead = u.cache_read_input_tokens ?? 0
        tokens.cacheWrite = u.cache_creation_input_tokens ?? 0
        tokens.output = u.output_tokens ?? 0
      }
    } else if (type === 'content_block_start') {
      const i = ev.index as number
      const cb = ev.content_block as { type: string; id?: string; name?: string }
      blocks[i] = cb.type === 'tool_use'
        ? { type: 'tool_use', id: cb.id ?? '', name: cb.name ?? '', input: {} }
        : { type: 'text', text: '' }
      json[i] = ''
    } else if (type === 'content_block_delta') {
      const i = ev.index as number
      const d = ev.delta as { type: string; text?: string; partial_json?: string }
      const b = blocks[i]
      if (d.type === 'text_delta' && b?.type === 'text') {
        b.text += d.text ?? ''
        text += d.text ?? ''
        p.onText(text)
      } else if (d.type === 'input_json_delta' && b?.type === 'tool_use') {
        json[i] += d.partial_json ?? ''
      }
    } else if (type === 'content_block_stop') {
      const i = ev.index as number
      const b = blocks[i]
      if (b?.type === 'tool_use') {
        try { b.input = json[i] ? JSON.parse(json[i]) as Record<string, unknown> : {} } catch { b.input = {} }
      }
    } else if (type === 'message_delta') {
      stop = ((ev.delta as { stop_reason?: string } | undefined)?.stop_reason) ?? stop
      // `output_tokens` here is the running total for the message, not an increment.
      const u = ev.usage as { output_tokens?: number } | undefined
      if (u?.output_tokens !== undefined) tokens.output = u.output_tokens
    }
  }
  const kept = blocks.filter(b => b && !(b.type === 'text' && !b.text))
  const calls = kept.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use')
    .map(b => ({ id: b.id, name: b.name, input: b.input }))
  return { tokens, text, calls, assistant: { role: 'assistant', content: kept }, truncated: stop === 'max_tokens' && !calls.length }
}

// ── Groq: one request, one reply ─────────────────────────────────────────────

interface GroqCall { id: string; type: 'function'; function: { name: string; arguments: string } }

export async function callGroq(p: {
  key: string; model: string; system: string; tools: unknown[]; messages: unknown[]; maxTokens: number; fetchFn: typeof fetch
}): Promise<StepResult> {
  const res = await p.fetchFn('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${p.key}` },
    body: JSON.stringify({
      model: p.model, max_tokens: p.maxTokens,
      messages: [{ role: 'system', content: p.system }, ...p.messages],
      tools: p.tools, tool_choice: 'auto',
    }),
  })
  if (!res.ok) {
    let msg = `Groq ${res.status}`
    try { const j = await res.json() as { error?: { message?: string } }; if (j.error?.message) msg = j.error.message } catch { /* keep the status */ }
    throw new ModelError(msg, res.status)
  }
  const data = await res.json() as {
    choices: Array<{ message: { content: string | null; tool_calls?: GroqCall[] }; finish_reason: string }>
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }
  const choice = data.choices[0]
  const calls: ToolCall[] = (choice.message.tool_calls ?? []).map(c => {
    let input: Record<string, unknown> = {}
    try { input = JSON.parse(c.function.arguments || '{}') as Record<string, unknown> } catch { /* leave it empty */ }
    return { id: c.id, name: c.function.name, input }
  })
  const text = (choice.message.content ?? '').trim()
  return {
    tokens: { input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0, cacheRead: 0, cacheWrite: 0 },
    text, calls, truncated: choice.finish_reason === 'length' && !calls.length,
    assistant: { role: 'assistant', content: choice.message.content ?? null, ...(choice.message.tool_calls?.length ? { tool_calls: choice.message.tool_calls } : {}) },
  }
}

// ── Throttled persistence of a growing answer ────────────────────────────────

/** At most one write in flight, at most one per `ms`; the latest text always
 *  wins and `finish()` waits for the last write. */
export function throttledWriter(write: (text: string) => Promise<void>, ms: number, now: () => number = Date.now) {
  let latest = ''
  let written = ''
  let last = 0
  let inflight: Promise<void> = Promise.resolve()
  return {
    push(text: string) {
      latest = text
      if (now() - last < ms) return
      last = now()
      const snap = latest
      inflight = inflight.then(() => write(snap)).then(() => { written = snap }).catch(() => { /* the final write reports */ })
    },
    async finish(): Promise<string> {
      await inflight
      return latest === written ? latest : (await write(latest), latest)
    },
  }
}

// ── The step ─────────────────────────────────────────────────────────────────

/** A sentence that says which kind of failure it was and what to do. */
export function friendlyError(provider: Provider, e: unknown, key: string, model = ''): string {
  const msg = e instanceof Error ? e.message : String(e)
  const name = provider === 'groq' ? 'Groq' : 'Anthropic'
  const status = e instanceof ModelError ? e.status : 0
  // Out of credit is a 400 (Anthropic) or a 402/429 (others), and "the model is gone" is a 404 or a 400 with words in it.
  // Neither is the key's fault and neither is cured by asking again; both are cured in Settings → AI.
  if (/credit balance|billing|payment required|insufficient[_ ]quota|quota (exceeded|has been)/i.test(msg) || status === 402) {
    return `${name} says the account is out of credit or past its billing date. Top it up with ${name}, or choose another provider or model in Settings → AI. It said: ${msg.slice(0, 200)}`
  }
  if (status === 404 || /does not exist|do not have access|don.t have access|model_not_found|decommission|deprecated|no longer (available|supported)/i.test(msg)) {
    return `${name} says your key cannot use the model${model ? ` “${model}”` : ''}. Pick another in Settings → AI — the list there is what your key can use. It said: ${msg.slice(0, 200)}`
  }
  if (status === 401 || status === 403 || /invalid.api.key|authentication/i.test(msg)) {
    const tail = key ? `…${key.slice(-4)}` : '(none)'
    return `${name} refused the key that was sent (${tail}). Check Settings → AI. It said: ${msg.slice(0, 200)}`
  }
  if (status === 429) return `${name} is rate-limiting this key — wait a moment and ask again. It said: ${msg.slice(0, 200)}`
  if (status >= 500) return `${name} had a problem on its side (${status}). Ask again in a moment.`
  return `Error: ${msg.slice(0, 300)}`
}

function resultMessages(turn: Turn, rows: Row[]): unknown[] {
  const by = new Map(rows.map(r => [r.tool_use_id as string, r]))
  const text = (r: Row) => r.tool_state === 'failed'
    ? (r.tool_result ?? 'Error: the tool failed.')
    : (r.tool_result ?? 'null')
  if (turn.provider === 'anthropic') {
    return [{
      role: 'user',
      content: turn.pending.map(id => {
        const r = by.get(id)!
        return { type: 'tool_result', tool_use_id: id, content: text(r), ...(r.tool_state === 'failed' ? { is_error: true } : {}) }
      }),
    }]
  }
  return turn.pending.map(id => ({ role: 'tool', tool_call_id: id, content: text(by.get(id)!) }))
}

const usageOf = (p: StepParams, t: Tokens): Usage => ({ ...t, model: p.model, provider: p.provider })

export async function runStep(deps: StepDeps, p: StepParams): Promise<StepOutcome> {
  const { db } = deps
  const fetchFn = deps.fetchFn ?? fetch
  await db.sweepStale(p.conversationId, STALE_MS)

  let turn: Turn
  if (p.mode === 'turn') {
    const start = turnStart(await db.rows(p.conversationId))
    if (!start.length) return 'nothing'
    turn = { provider: p.provider, msgs: start, pending: [], steps: 0 }
  } else {
    const t = await db.getTurn(p.conversationId)
    if (!t || !t.pending.length) return 'nothing'
    if (t.provider !== p.provider) {
      // The saved messages are in the other provider's format; sending them on would be a 400 at best.
      const id = await db.startAnswer(p.conversationId)
      if (id === null) return 'busy'
      await db.finishAnswer(id, 'error', 'The AI provider was changed while that was still running, so it cannot carry on. Ask again.')
      await db.setTurn(p.conversationId, null)
      return 'error'
    }
    const rows = await db.toolRows(p.conversationId, t.pending)
    const finished = (id: string) => rows.some(r => r.tool_use_id === id && (r.tool_state === 'done' || r.tool_state === 'failed'))
    if (!t.pending.every(finished)) return 'not_ready'
    turn = { ...t, msgs: [...t.msgs, ...resultMessages(t, rows)], pending: [] }
  }

  const answerId = await db.startAnswer(p.conversationId)
  if (answerId === null) return 'busy'

  const writer = throttledWriter(text => db.updateAnswer(answerId, text), FLUSH_MS, deps.now)
  try {
    if (turn.steps >= MAX_STEPS) throw new Error('That took more steps than I will chain in one go. Ask again more narrowly.')
    const maxTokens = p.maxTokens ?? 4096
    const r = p.provider === 'anthropic'
      ? await streamAnthropic({ key: p.key, model: p.model, system: p.system, tools: p.tools, messages: turn.msgs, maxTokens, fetchFn, onText: t => writer.push(t) })
      : await callGroq({ key: p.key, model: p.model, system: p.system, tools: p.tools, messages: turn.msgs, maxTokens, fetchFn })
    const text = r.text + (r.truncated ? ' …' : '')
    await writer.finish().catch(() => '')

    if (r.calls.length) {
      turn = { ...turn, msgs: [...turn.msgs, r.assistant], pending: r.calls.map(c => c.id), steps: turn.steps + 1 }
      // Turn state BEFORE the rows: the moment a row exists a device may ask to continue.
      await db.setTurn(p.conversationId, turn)
      // The row stays even with no words: it is where this request's tokens are kept, and a tool loop is several
      // requests, every one billed. The page draws a complete answer with no text as nothing.
      await db.finishAnswer(answerId, 'complete', text, usageOf(p, r.tokens))
      await db.addToolRows(p.conversationId, r.calls)
      return 'tools'
    }
    await db.finishAnswer(answerId, 'complete', text.trim() ? text : '(The model sent no answer.)', usageOf(p, r.tokens))
    await db.setTurn(p.conversationId, null)
    return 'done'
  } catch (e) {
    await writer.finish().catch(() => '')
    await db.finishAnswer(answerId, 'error', friendlyError(p.provider, e, p.key, p.model)).catch(() => {})
    await db.setTurn(p.conversationId, null).catch(() => {})
    return 'error'
  }
}

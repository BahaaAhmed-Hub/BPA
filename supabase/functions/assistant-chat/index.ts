/**
 * assistant-chat — the web assistant's model call, made on the server.
 *
 * The page used to call Anthropic / Groq itself, so when iPad Safari froze or
 * reloaded a dimmed tab the request died with it and the conversation was gone.
 * Here the answer is written into `assistant_messages` as it arrives and the
 * invocation carries on if the browser goes away; the page reads the rows
 * (Realtime, plus a poll and a refetch when it comes back to the front).
 *
 * POST { conversationId, mode: 'turn' | 'continue', provider, model, system,
 *        tools, key?, maxTokens? }
 *   · 'turn'     — answer the latest user message in the conversation.
 *   · 'continue' — the browser has run the tool calls the last step parked
 *                  (rows with tool_state 'done' | 'failed'); take the next step.
 * Responds 202 at once. ONE model step per invocation; see _shared/assistantChat.ts.
 *
 * The page supplies the system prompt and the tool list because it owns both
 * (the tools run in the browser, against the app's stores, behind an approval
 * card). It is the signed-in person's own key and account, so nothing is gained
 * by pretending the server must second-guess its own caller's prompt.
 *
 * The key: the one in the request if the page has it, else the one saved under
 * Settings → AI (`users.schedule_rules.shared_prefs`, so a device that lost its
 * localStorage still works), else the project's `ANTHROPIC_API_KEY`.
 *
 * Auth: the caller's Supabase JWT (verify_jwt stays ON); the conversation must be theirs.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { cleanKey } from '../_shared/apiKey.ts'
import { runStep, type ChatDb, type Provider, type Row, type ToolCall, type Turn, type Usage } from '../_shared/assistantChat.ts'

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const ANTHROPIC_KEY = cleanKey(Deno.env.get('ANTHROPIC_API_KEY'))

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

/** The key saved under Settings → AI for this person, if any. Never throws. */
async function savedKeys(userId: string): Promise<{ anthropic: string; groq: string }> {
  try {
    const { data } = await sb.from('users').select('schedule_rules').eq('id', userId).maybeSingle()
    const bag = (data as { schedule_rules?: { shared_prefs?: Record<string, string> } } | null)?.schedule_rules?.shared_prefs
    const raw = bag?.['professor-ai-config']
    if (typeof raw === 'string') {
      const c = JSON.parse(raw) as { anthropicKey?: string; groqKey?: string }
      return { anthropic: cleanKey(c.anthropicKey), groq: cleanKey(c.groqKey) }
    }
  } catch (e) {
    console.error('could not read the saved AI key:', e)
  }
  return { anthropic: '', groq: '' }
}

function dbFor(userId: string): ChatDb {
  const must = <T>(r: { data: T | null; error: { message: string } | null }, what: string): T => {
    if (r.error) throw new Error(`${what}: ${r.error.message}`)
    return r.data as T
  }
  return {
    async rows(conversationId) {
      const r = await sb.from('assistant_messages')
        .select('id, role, content, status, tool, tool_state, tool_use_id, tool_input, tool_result')
        .eq('conversation_id', conversationId).order('id', { ascending: false }).limit(200)
      return (must(r, 'read messages') as Row[]).reverse()
    },
    async getTurn(conversationId) {
      const r = await sb.from('assistant_conversations').select('turn').eq('id', conversationId).maybeSingle()
      return ((must(r, 'read turn') as { turn?: Turn | null } | null)?.turn) ?? null
    },
    async setTurn(conversationId, turn) {
      must(await sb.from('assistant_conversations').update({ turn }).eq('id', conversationId).select('id'), 'save turn')
    },
    async startAnswer(conversationId) {
      const r = await sb.from('assistant_messages')
        .insert({ conversation_id: conversationId, user_id: userId, role: 'assistant', status: 'streaming', content: '' })
        .select('id').single()
      if (r.error) {
        if (r.error.code === '23505') return null // the one-streaming-answer lock: somebody is already answering
        throw new Error(`start answer: ${r.error.message}`)
      }
      return (r.data as { id: number }).id
    },
    async updateAnswer(id, content) {
      must(await sb.from('assistant_messages').update({ content }).eq('id', id).select('id'), 'stream answer')
    },
    async finishAnswer(id, status, content, usage?: Usage) {
      must(await sb.from('assistant_messages').update({ status, content, ...(usage ? { usage } : {}) }).eq('id', id).select('id'), 'finish answer')
    },
    async deleteRow(id) {
      must(await sb.from('assistant_messages').delete().eq('id', id).select('id'), 'drop empty answer')
    },
    async addToolRows(conversationId, calls: ToolCall[]) {
      const rows = calls.map(c => ({
        conversation_id: conversationId, user_id: userId, role: 'tool', content: c.name, status: 'complete',
        tool: c.name, tool_state: 'running', tool_use_id: c.id, tool_input: c.input,
      }))
      must(await sb.from('assistant_messages').upsert(rows, { onConflict: 'conversation_id,tool_use_id', ignoreDuplicates: true }).select('id'), 'park tool calls')
    },
    async toolRows(conversationId, ids) {
      const r = await sb.from('assistant_messages')
        .select('id, role, content, status, tool, tool_state, tool_use_id, tool_input, tool_result')
        .eq('conversation_id', conversationId).in('tool_use_id', ids)
      return must(r, 'read tool results') as Row[]
    },
    async sweepStale(conversationId, olderThanMs) {
      const cutoff = new Date(Date.now() - olderThanMs).toISOString()
      await sb.from('assistant_messages')
        .update({ status: 'error', content: 'This answer was interrupted before it finished. Ask again.' })
        .eq('conversation_id', conversationId).eq('status', 'streaming').lt('updated_at', cutoff)
    },
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return reply({ error: 'POST only' }, 405)

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return reply({ error: 'Not signed in' }, 401)
  const { data: who, error: authErr } = await sb.auth.getUser(jwt)
  if (authErr || !who.user) return reply({ error: 'Not signed in' }, 401)
  const userId = who.user.id

  let b: Record<string, unknown>
  try { b = await req.json() } catch { return reply({ error: 'Bad JSON' }, 400) }
  const conversationId = String(b.conversationId ?? '')
  const mode = b.mode === 'continue' ? 'continue' : b.mode === 'turn' ? 'turn' : null
  const provider = b.provider === 'groq' ? 'groq' : b.provider === 'anthropic' ? 'anthropic' : null
  const system = typeof b.system === 'string' ? b.system : ''
  const tools = Array.isArray(b.tools) ? b.tools : []
  if (!/^[0-9a-f-]{36}$/i.test(conversationId) || !mode || !provider) return reply({ error: 'conversationId, mode and provider are required' }, 400)
  if (system.length > 80_000 || JSON.stringify(tools).length > 300_000 || tools.length > 100) return reply({ error: 'Request too large' }, 413)

  // The conversation must be this person's — the service role would otherwise write anywhere.
  const own = await sb.from('assistant_conversations').select('id').eq('id', conversationId).eq('user_id', userId).maybeSingle()
  if (own.error || !own.data) return reply({ error: 'No such conversation' }, 404)

  const saved = await savedKeys(userId)
  const given = typeof b.key === 'string' ? cleanKey(b.key) : ''
  const key = given || (provider === 'groq' ? saved.groq : saved.anthropic || ANTHROPIC_KEY)

  const db = dbFor(userId)
  const model = String(b.model ?? '').slice(0, 100)
  const maxTokens = Math.min(Math.max(Number(b.maxTokens) || 4096, 256), 8192)

  const work = (async () => {
    if (!key) {
      const id = await db.startAnswer(conversationId)
      if (id !== null) await db.finishAnswer(id, 'error', `No ${provider === 'groq' ? 'Groq' : 'Anthropic'} API key set. Go to Settings → AI.`)
      return
    }
    await runStep({ db }, { provider: provider as Provider, conversationId, mode, key, model, system, tools, maxTokens })
  })().catch(e => console.error('assistant-chat step failed:', e))

  // Answer the caller now; the step carries on after the response is sent, and after
  // the caller has gone. Without EdgeRuntime (a local run) wait for it instead.
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(work)
  else await work
  return reply({ accepted: true }, 202)
})

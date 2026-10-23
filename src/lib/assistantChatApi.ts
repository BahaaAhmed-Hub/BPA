// The assistant's conversation on the server: the reads and writes the panel
// makes against `assistant_conversations` / `assistant_messages`, and the call
// that asks the `assistant-chat` function for a model step. Everything here is
// best-effort in one direction: if the tables or the function are not there
// (migration not run, function not deployed) the answer is 'unavailable' and the
// panel carries on exactly as it did before this existed.
import { supabase } from './supabase'
import { CLAIM_MS, ADOPT_WITHIN_MS, mergeRows, type ChatRow } from './assistantChatView'
import { usageFromRow, type ModelUsage } from './aiUsage'

export type StepResult = 'accepted' | 'unavailable' | 'offline'

const COLS = 'id, conversation_id, client_id, role, content, status, tool, tool_state, tool_use_id, tool_input, tool_result, files, created_at, updated_at, claimed_by, claimed_at, usage'

/** Postgres / PostgREST saying the table is not there at all. */
const missing = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || /relation .* does not exist|schema cache/i.test(e.message ?? ''))

export async function createConversation(id: string, userId: string, provider: 'anthropic' | 'groq'): Promise<boolean> {
  const { error } = await supabase.from('assistant_conversations').insert({ id, user_id: userId, provider })
  return !error
}

export async function insertUserMessage(p: { conversationId: string; userId: string; clientId: string; text: string; files?: { name: string; kind: string }[] }): Promise<boolean> {
  const { error } = await supabase.from('assistant_messages').insert({
    conversation_id: p.conversationId, user_id: p.userId, client_id: p.clientId, role: 'user', content: p.text,
    status: 'complete', ...(p.files?.length ? { files: p.files } : {}),
  })
  // A retried insert (the connection dropped after the server had it) lands on the unique index: that is success.
  return !error || error.code === '23505'
}

export async function deleteMessageByClientId(conversationId: string, clientId: string) {
  await supabase.from('assistant_messages').delete().eq('conversation_id', conversationId).eq('client_id', clientId)
}

export async function fetchMessages(conversationId: string): Promise<ChatRow[] | null> {
  const { data, error } = await supabase.from('assistant_messages').select(COLS)
    .eq('conversation_id', conversationId).order('id', { ascending: false }).limit(300)
  if (error || !Array.isArray(data)) return null
  return (data as unknown as ChatRow[]).reverse()
}

export async function fetchConversation(id: string): Promise<{ id: string; archived: boolean } | null> {
  const { data, error } = await supabase.from('assistant_conversations').select('id, archived_at').eq('id', id).maybeSingle()
  if (error || !data || Array.isArray(data)) return null
  return { id: (data as { id: string }).id, archived: !!(data as { archived_at: string | null }).archived_at }
}

/** The newest live conversation of this person, if it is recent — how a second device finds the thread. */
export async function fetchLatestConversationId(userId: string): Promise<string | null> {
  const since = new Date(Date.now() - ADOPT_WITHIN_MS).toISOString()
  const { data, error } = await supabase.from('assistant_conversations').select('id')
    .eq('user_id', userId).is('archived_at', null).gte('updated_at', since)
    .order('updated_at', { ascending: false }).limit(1)
  if (error || !Array.isArray(data) || !data.length) return null
  return (data[0] as { id: string }).id
}

export async function archiveConversation(id: string) {
  await supabase.from('assistant_conversations').update({ archived_at: new Date().toISOString() }).eq('id', id)
}

/** Take a parked tool call, once. The conditional update is the claim: of two open
 *  devices, only one gets a row back. */
export async function claimTool(rowId: number, device: string): Promise<boolean> {
  const now = Date.now()
  const { data, error } = await supabase.from('assistant_messages')
    .update({ claimed_by: device, claimed_at: new Date(now).toISOString() })
    .eq('id', rowId).eq('tool_state', 'running')
    .or(`claimed_at.is.null,claimed_at.lt.${new Date(now - CLAIM_MS).toISOString()},claimed_by.eq.${device}`)
    .select('id')
  return !error && Array.isArray(data) && data.length > 0
}

export async function finishTool(rowId: number, state: 'done' | 'failed', result: string) {
  await supabase.from('assistant_messages').update({ tool_state: state, tool_result: result.slice(0, 100_000) }).eq('id', rowId)
}

/** Mark an answer that nobody is writing any more, so every device agrees it is over. */
export async function markInterrupted(rowId: number) {
  await supabase.from('assistant_messages').update({ status: 'error', content: 'This answer was interrupted before it finished. Ask again.' })
    .eq('id', rowId).eq('status', 'streaming')
}

/** Ask the server for the next model step. Resolves once it has been ACCEPTED (not answered). */
export async function requestStep(body: {
  conversationId: string; mode: 'turn' | 'continue'; provider: 'anthropic' | 'groq'
  model: string; system: string; tools: unknown[]; key?: string
}): Promise<StepResult> {
  try {
    const { data, error } = await supabase.functions.invoke('assistant-chat', { body })
    if (error) {
      const status = (error as { context?: { status?: number } }).context?.status
      // Not deployed, or the gateway refused: use the old path. A dropped connection is a different thing.
      return status ? 'unavailable' : 'offline'
    }
    return (data as { accepted?: boolean } | null)?.accepted === true ? 'accepted' : 'unavailable'
  } catch { return 'offline' }
}

/** Rows arriving for one conversation. Returns the unsubscribe. */
export function subscribeMessages(conversationId: string, onRows: (rows: ChatRow[]) => void, onGone: (id: number) => void): () => void {
  const ch = supabase.channel(`assistant-${conversationId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'assistant_messages', filter: `conversation_id=eq.${conversationId}` }, p => {
      if (p.eventType === 'DELETE') { const id = (p.old as { id?: number }).id; if (typeof id === 'number') onGone(id) }
      else onRows([p.new as ChatRow])
    })
    .subscribe()
  return () => { void supabase.removeChannel(ch) }
}

/** Legacy turns (a message with an attachment, or no function to call) are written
 *  after the fact so the thread still survives a reload — just not mid-flight. */
export async function persistBubbles(conversationId: string, userId: string, rows: Array<{
  clientId: string | null; role: 'user' | 'assistant' | 'tool' | 'error'; content: string
  tool?: string; toolUseId?: string; toolState?: 'running' | 'done' | 'failed'; files?: { name: string; kind: string }[]
  usage?: ModelUsage
}>): Promise<boolean> {
  if (!rows.length) return true
  const { error } = await supabase.from('assistant_messages').insert(rows.map(r => ({
    conversation_id: conversationId, user_id: userId, client_id: r.clientId, role: r.role,
    content: r.content, status: r.role === 'error' ? 'error' : 'complete',
    ...(r.tool ? { tool: r.tool, tool_use_id: r.toolUseId ?? null, tool_state: r.toolState === 'running' ? 'failed' : (r.toolState ?? 'done') } : {}),
    ...(r.files?.length ? { files: r.files } : {}),
    ...(r.usage ? { usage: r.usage } : {}),
  })))
  return !error || missing(error)
}

/** Everything the assistant used since the first of this month, as the rows record it. Null when it could not be read. */
export async function fetchMonthUsage(userId: string, now = new Date()): Promise<ModelUsage[] | null> {
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const { data, error } = await supabase.from('assistant_messages').select('usage')
    .eq('user_id', userId).not('usage', 'is', null).gte('created_at', from).limit(20000)
  if (error || !Array.isArray(data)) return null
  return (data as Array<{ usage: unknown }>).map(r => usageFromRow(r.usage)).filter((u): u is ModelUsage => !!u)
}

export { mergeRows }

/** Keep a claim alive while the person is still deciding on an approval card. */
export async function refreshClaim(rowId: number, device: string) {
  await supabase.from('assistant_messages').update({ claimed_at: new Date().toISOString() })
    .eq('id', rowId).eq('claimed_by', device).eq('tool_state', 'running')
}

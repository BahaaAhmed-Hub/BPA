// Which models a key can actually use — asked of the provider, not remembered.
//
// The Groq model was a hard-coded id (`llama-3.3-70b-versatile`). Providers retire models and gate others by account,
// so "does not exist or you do not have access to it" is a normal day, and a person with no way to pick another model
// is stuck until a developer changes a constant. So: the list comes from the provider with the person's own key, a
// one-token request proves a model works before it is trusted, and when the chosen model does not work the assistant
// moves to one that does and says so.
//
// Everything takes `fetchFn` so it can be measured against a provider that refuses.
import { describeModel } from './modelInfo'

export type Provider = 'anthropic' | 'groq'

export interface ModelOption { id: string; label: string }

export type Probe =
  | { ok: true }
  | { ok: false; message: string; /** the provider said this model is not there / not yours */ missing: boolean; /** nothing to conclude (offline, rate limited, a bad key) */ inconclusive: boolean }

/** What a provider says when a model is gone or not yours. */
export const isModelMissingMessage = (msg: string): boolean =>
  /does not exist|do not have access|don.t have access|model_not_found|not found|decommission|deprecated|no longer (available|supported)|has been (retired|removed)/i.test(msg)

/** How much room to leave for a Groq reply. Groq counts the room a request RESERVES for its answer (`max_tokens`) against the
 *  per-minute token allowance up front — measured in a real message: "Limit 8000, Used 1939, Requested 7776" with 4,096
 *  reserved — so reserving more than answers need turns a small plan's allowance into a wall. Answers here are a table and a
 *  few lines; an answer that does hit this is marked as cut off, not passed off as whole. Claude has no such per-reply
 *  accounting, so it keeps 4,096. */
export const GROQ_MAX_REPLY_TOKENS = 2048

/** Groq lists speech, guard and embedding models beside the chat ones; none of those can answer a message. */
const NOT_CHAT = /whisper|tts|speech|guard|safeguard|playai|orpheus|embed|moderation|transcri|rerank/i

export function isChatModel(provider: Provider, id: string): boolean {
  if (provider === 'anthropic') return /^claude-/i.test(id)
  return !NOT_CHAT.test(id)
}

/** Best first. A fallback is chosen from what the key can use, never from this list alone. */
export const GROQ_PREFERENCE = [
  'llama-3.3-70b-versatile',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'qwen/qwen3-32b',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'llama-3.1-8b-instant',
]

export class ModelListError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

const optionOf = (provider: Provider, id: string): ModelOption => ({ id, label: describeModel(provider, id).label })

/** The chat models this key can see. Throws ModelListError with the provider's own words. */
export async function listModels(provider: Provider, key: string, fetchFn: typeof fetch = fetch): Promise<ModelOption[]> {
  if (!key) throw new ModelListError('No API key yet.', 0)
  const res = provider === 'groq'
    ? await fetchFn('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${key}` } })
    : await fetchFn('https://api.anthropic.com/v1/models?limit=100', {
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      })
  if (!res.ok) {
    let msg = `${provider === 'groq' ? 'Groq' : 'Anthropic'} ${res.status}`
    try { const j = await res.json() as { error?: { message?: string } }; if (j.error?.message) msg = j.error.message } catch { /* keep the status */ }
    throw new ModelListError(msg, res.status)
  }
  const j = await res.json() as { data?: Array<{ id: string; active?: boolean }> }
  const ids = (j.data ?? []).filter(m => m.active !== false).map(m => m.id).filter(id => isChatModel(provider, id))
  return [...new Set(ids)].sort().map(id => optionOf(provider, id))
}

/** One token, to see whether this key may use this model. Groq only: it is free there, and an Anthropic probe would cost. */
export async function probeGroq(key: string, model: string, fetchFn: typeof fetch = fetch): Promise<Probe> {
  let res: Response
  try {
    res = await fetchFn('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
    })
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Could not reach Groq.', missing: false, inconclusive: true }
  }
  if (res.ok) return { ok: true }
  let message = `Groq ${res.status}`
  try { const j = await res.json() as { error?: { message?: string } }; if (j.error?.message) message = j.error.message } catch { /* keep the status */ }
  const missing = res.status === 404 || isModelMissingMessage(message)
  // A 401 is the key, 429 is a rate limit, 5xx is theirs: none of them says anything about the model.
  return { ok: false, message, missing, inconclusive: !missing }
}

/** The models to try instead, best first, never the one that failed. */
export function fallbackOrder(available: string[], failed: string): string[] {
  const rest = available.filter(id => id !== failed)
  const ranked = GROQ_PREFERENCE.filter(id => rest.includes(id))
  return [...ranked, ...rest.filter(id => !ranked.includes(id))]
}

export interface HealResult {
  model: string
  /** set when the model was replaced: what it was, and why */
  switched?: { from: string; reason: string }
  /** set when nothing usable was found — the original is kept so the real error shows */
  failed?: string
}

/** A model proven to work this session, by `key|model`, so the check is one request per model, not one per message. */
const proven = new Set<string>()
export const _resetProven = () => proven.clear()

/**
 * Make sure the Groq model about to be used works with this key; if the provider says it does not exist or is not
 * theirs, find one that does. Only a definite "that model is not available" ever changes anything — an offline page, a
 * rate limit or a bad key leaves the choice alone.
 */
export async function ensureWorkingGroqModel(
  key: string, model: string, fetchFn: typeof fetch = fetch, maxTries = 4,
): Promise<HealResult> {
  if (!key) return { model }
  const tag = `${key.slice(-6)}|`
  if (proven.has(tag + model)) return { model }
  const first = await probeGroq(key, model, fetchFn)
  if (first.ok) { proven.add(tag + model); return { model } }
  if (!first.missing) return { model }                       // inconclusive: do not touch a choice we could not judge
  let available: string[]
  try { available = (await listModels('groq', key, fetchFn)).map(o => o.id) } catch { return { model, failed: first.message } }
  for (const candidate of fallbackOrder(available, model).slice(0, maxTries)) {
    const p = await probeGroq(key, candidate, fetchFn)
    if (p.ok) { proven.add(tag + candidate); return { model: candidate, switched: { from: model, reason: first.message } } }
    if (!p.missing) return { model, failed: p.message }      // the key itself is in trouble; stop guessing
  }
  return { model, failed: first.message }
}

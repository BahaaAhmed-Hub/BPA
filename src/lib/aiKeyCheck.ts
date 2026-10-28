import Anthropic from '@anthropic-ai/sdk'

/**
 * Does this key work, with this model? One real request of a single token — the
 * only honest way to say a key "works". A shape check (`sk-ant-…`) only says it
 * looks like one, and a key that is revoked, out of credit or blocked from this
 * model looks exactly the same.
 *
 * Nothing is saved here and nothing is kept: the key is used for this one call.
 */
export type KeyVerdict =
  | { ok: true }
  | { ok: false; why: 'rejected' | 'model' | 'network' | 'busy' | 'other'; detail: string }

const PING = 'Reply with the single word: ok'

export async function checkKey(provider: 'anthropic' | 'groq', key: string, model: string): Promise<KeyVerdict> {
  if (provider === 'groq') {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: PING }] }),
      })
      if (res.ok) return { ok: true }
      const text = await res.text().catch(() => '')
      if (res.status === 401 || res.status === 403) return { ok: false, why: 'rejected', detail: 'Groq did not accept that key.' }
      if (res.status === 429 || res.status >= 500) return { ok: false, why: 'busy', detail: 'Groq is busy or rate-limiting. Try again in a moment.' }
      if (res.status === 404 || (res.status === 400 && /model/i.test(text))) return { ok: false, why: 'model', detail: 'Groq does not offer that model to this key.' }
      return { ok: false, why: 'other', detail: `Groq answered ${res.status}.` }
    } catch {
      return { ok: false, why: 'network', detail: 'Could not reach Groq. Check your connection.' }
    }
  }
  try {
    await new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true }).messages.create({
      model, max_tokens: 1, messages: [{ role: 'user', content: PING }],
    })
    return { ok: true }
  } catch (e) {
    if (e instanceof Anthropic.APIConnectionError) return { ok: false, why: 'network', detail: 'Could not reach Anthropic. Check your connection.' }
    if (e instanceof Anthropic.APIError) {
      if (e.status === 401 || e.status === 403) return { ok: false, why: 'rejected', detail: 'Anthropic did not accept that key.' }
      if (e.status === 429 || e.status >= 500) return { ok: false, why: 'busy', detail: 'Anthropic is busy or rate-limiting. Try again in a moment.' }
      if (e.status === 404) return { ok: false, why: 'model', detail: 'That key cannot use this model. Pick another.' }
      return { ok: false, why: 'other', detail: e.message.slice(0, 140) }
    }
    return { ok: false, why: 'other', detail: 'The check failed.' }
  }
}

// The provider's own word on how much room is left — read off the headers of every reply, never computed here.
//
// Tokens used (aiUsage.ts) say what THIS APP spent. A limit says what the PROVIDER will still allow the account, which
// includes everything else drawing on the same key or organisation, and is the number that decides whether the next
// message works. Neither provider offers a balance to an ordinary key; these headers are what they do offer, on every
// reply, for free.
//
//   Groq       x-ratelimit-{limit,remaining,reset}-{requests,tokens}     requests = per DAY, tokens = per MINUTE;
//              reset is a duration ("2m59.56s"); retry-after only on a 429.
//   Anthropic  anthropic-ratelimit-{requests,tokens,input-tokens,output-tokens}-{limit,remaining,reset}
//              all per minute; reset is an RFC 3339 time.
//
// Only what is present is reported: a header that did not arrive is a bucket that is not shown, never a guess. In the
// browser a header is readable only if the provider's CORS rules expose it, so the reading from the server function
// (which always sees them) is the dependable one and the page's own is a bonus.

export type Level = 'ok' | 'low' | 'out'
export type Bucket = { limit: number; remaining: number; resetAt: number | null }
export interface Limits {
  provider: 'anthropic' | 'groq'
  /** when the provider said it (ms) — the reading is a moment, and the page says how old it is */
  at: number
  requests?: Bucket
  tokens?: Bucket
  inputTokens?: Bucket
  outputTokens?: Bucket
  /** seconds, only ever present on a refusal */
  retryAfter?: number
}

/** "2m59.56s" → 179560; "7.66s" → 7660; "1h2m" → 3720000; "500ms" → 500; a bare number is seconds. */
export function parseDuration(raw: string | null | undefined): number | null {
  if (!raw) return null
  const s = raw.trim()
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 1000)
  const re = /(\d+(?:\.\d+)?)(ms|h|m|s)/g
  let ms = 0, any = false, m: RegExpExecArray | null
  while ((m = re.exec(s))) { any = true; ms += Number(m[1]) * ({ ms: 1, s: 1000, m: 60_000, h: 3_600_000 } as Record<string, number>)[m[2]] }
  return any ? Math.round(ms) : null
}

type Get = (name: string) => string | null | undefined
const num = (v: string | null | undefined): number | null => (v !== null && v !== undefined && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null)

function bucket(limit: string | null | undefined, remaining: string | null | undefined, resetAt: number | null): Bucket | undefined {
  const l = num(limit), r = num(remaining)
  if (l === null || r === null || l <= 0 || r < 0) return undefined
  return { limit: l, remaining: Math.min(r, l), resetAt }
}

/** Read whatever limit headers the reply carried. Null when it carried none (or the browser was not allowed to see them). */
export function parseLimits(provider: 'anthropic' | 'groq', get: Get, now = Date.now()): Limits | null {
  const out: Limits = { provider, at: now }
  if (provider === 'groq') {
    const d = (k: string) => { const ms = parseDuration(get(`x-ratelimit-reset-${k}`)); return ms === null ? null : now + ms }
    out.requests = bucket(get('x-ratelimit-limit-requests'), get('x-ratelimit-remaining-requests'), d('requests'))
    out.tokens = bucket(get('x-ratelimit-limit-tokens'), get('x-ratelimit-remaining-tokens'), d('tokens'))
  } else {
    const t = (k: string) => { const v = get(`anthropic-ratelimit-${k}-reset`); const ms = v ? Date.parse(v) : NaN; return Number.isFinite(ms) ? ms : null }
    const g = (k: string) => bucket(get(`anthropic-ratelimit-${k}-limit`), get(`anthropic-ratelimit-${k}-remaining`), t(k))
    out.requests = g('requests'); out.tokens = g('tokens'); out.inputTokens = g('input-tokens'); out.outputTokens = g('output-tokens')
  }
  const ra = num(get('retry-after'))
  if (ra !== null && ra >= 0) out.retryAfter = ra
  return out.requests || out.tokens || out.inputTokens || out.outputTokens || out.retryAfter !== undefined ? out : null
}

/** A stored reading, tolerant of anything missing — it comes out of jsonb that an older build may have written. */
export function limitsFromRow(raw: unknown): Limits | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const b = (v: unknown): Bucket | undefined => {
    if (!v || typeof v !== 'object') return undefined
    const x = v as Record<string, unknown>
    return typeof x.limit === 'number' && typeof x.remaining === 'number' && x.limit > 0 && x.remaining >= 0
      ? { limit: x.limit, remaining: Math.min(x.remaining, x.limit), resetAt: typeof x.resetAt === 'number' ? x.resetAt : null } : undefined
  }
  const out: Limits = { provider: r.provider === 'groq' ? 'groq' : 'anthropic', at: typeof r.at === 'number' ? r.at : 0,
    requests: b(r.requests), tokens: b(r.tokens), inputTokens: b(r.inputTokens), outputTokens: b(r.outputTokens),
    ...(typeof r.retryAfter === 'number' ? { retryAfter: r.retryAfter } : {}) }
  return out.requests || out.tokens || out.inputTokens || out.outputTokens ? out : null
}

export const levelOf = (fraction: number): Level => (fraction < 0.05 ? 'out' : fraction < 0.2 ? 'low' : 'ok')

export interface Reading {
  key: 'requests' | 'tokens' | 'inputTokens' | 'outputTokens'
  /** "12,900 of 14,400 requests left today" */
  text: string
  /** just the figure and the unit: "12.9k requests/day" */
  short: string
  fraction: number
  level: Level
  /** the bucket's reset time has passed, so it has refilled since the provider said */
  refilled: boolean
  resetsInMs: number | null
}

const fmt = (n: number): string => (n < 1000 ? String(Math.round(n)) : n < 10_000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : n < 999_500 ? `${Math.round(n / 1000)}k` : `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`)
const full = (n: number) => n.toLocaleString('en-US')
/** Whole seconds first, THEN split into units — rounding the pieces separately gave "2m 60s". */
const dur = (ms: number): string => {
  if (ms < 1000) return 'under a second'
  const total = Math.ceil(ms / 1000)
  if (total < 60) return `${total}s`
  if (total < 3600) { const m = Math.floor(total / 60), s = total % 60; return s ? `${m}m ${s}s` : `${m}m` }
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60)
  return m ? `${h}h ${m}m` : `${h}h`
}

/** What each bucket means differs by provider — Groq's request bucket is a day, Anthropic's is a minute. */
const WHEN = {
  groq:      { requests: 'today',       tokens: 'this minute', inputTokens: 'this minute', outputTokens: 'this minute' },
  anthropic: { requests: 'this minute', tokens: 'this minute', inputTokens: 'this minute', outputTokens: 'this minute' },
} as const
const NOUN = { requests: 'requests', tokens: 'tokens', inputTokens: 'input tokens', outputTokens: 'output tokens' } as const
const UNIT = { groq: { requests: '/day', tokens: '/min' }, anthropic: { requests: '/min', tokens: '/min' } } as const

/** The readings, as of `now`: a bucket whose reset time has passed is shown full, and says so, instead of a stale shortfall. */
export function readings(l: Limits, now = Date.now()): Reading[] {
  const keys: Reading['key'][] = ['requests', 'tokens', 'inputTokens', 'outputTokens']
  const out: Reading[] = []
  for (const key of keys) {
    const b = l[key]
    if (!b) continue
    const refilled = b.resetAt !== null && now >= b.resetAt && b.remaining < b.limit
    const remaining = refilled ? b.limit : b.remaining
    const fraction = remaining / b.limit
    const resetsInMs = !refilled && b.resetAt !== null && b.remaining < b.limit ? Math.max(0, b.resetAt - now) : null
    const unit = (UNIT[l.provider] as Record<string, string>)[key] ?? '/min'
    out.push({
      key, fraction, level: levelOf(fraction), refilled, resetsInMs,
      short: `${fmt(remaining)} ${key === 'requests' ? 'req' : key === 'tokens' ? 'tokens' : NOUN[key]}${unit}`,
      text: `${full(remaining)} of ${full(b.limit)} ${NOUN[key]} left ${WHEN[l.provider][key]}${refilled ? ' (refilled since)' : resetsInMs !== null ? ` · refills in ${dur(resetsInMs)}` : ''}`,
    })
  }
  return out
}

export interface LimitsView {
  /** the worst of the buckets, which is the one that will stop the next message */
  level: Level
  /** the line under the model name: "11k tokens/min · 12.9k req/day left" */
  line: string
  /** one reading per line, for a tooltip or Settings */
  lines: string[]
  /** how old the provider's word is */
  ageMs: number
  /** the bucket that is tightest */
  tightest: Reading | null
  retryAfter?: number
}

export function viewLimits(l: Limits, now = Date.now()): LimitsView | null {
  // Anthropic reports a combined `tokens` bucket and, separately, input and output; the combined one is the headline when
  // it is there, and the split ones are only shown if it is not.
  const all = readings(l, now)
  const shown = l.provider === 'anthropic' && l.tokens ? all.filter(r => r.key !== 'inputTokens' && r.key !== 'outputTokens') : all
  if (!shown.length && l.retryAfter === undefined) return null
  const tightest = shown.length ? shown.reduce((a, b) => (b.fraction < a.fraction ? b : a)) : null
  const level: Level = tightest ? tightest.level : 'ok'
  return {
    level, tightest, retryAfter: l.retryAfter,
    line: shown.length ? `${shown.map(r => r.short).join(' · ')} left` : '',
    lines: shown.map(r => r.text),
    ageMs: Math.max(0, now - l.at),
  }
}

/** "just now", "42s ago", "3m ago" — how old the provider's word is. */
export function ageWords(ms: number): string {
  if (ms < 5000) return 'just now'
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  return `${Math.round(ms / 3_600_000)}h ago`
}

/** Seconds a person should wait, in words. */
export const waitText = (seconds: number): string => dur(seconds * 1000)

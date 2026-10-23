// What the assistant has used, and what that comes to — pure, so it can be measured without a browser.
//
// TOKENS ARE EXACT: they are what the provider reported with each reply (kept on the answer row, see 20260044).
// THE AMOUNT IS AN ESTIMATE: no ordinary API key can ask either provider for a balance or an invoice, so money is
// tokens × a price per million, and a price is only as good as whoever wrote it down. The built-in prices are list
// prices for the model families the app knows and are labelled as estimates wherever they are drawn; a person who has
// their real rate can set it in Settings → AI and that wins. A model with no known price shows tokens and NO amount —
// an invented figure on something that looks like billing would be worse than none.

export interface TokenUsage { input: number; output: number; cacheRead: number; cacheWrite: number }
export interface ModelUsage extends TokenUsage { model: string; provider: 'anthropic' | 'groq' }

/** US dollars per million tokens. */
export interface Price { in: number; out: number }
export type Prices = Record<string, Price>

/** List-price estimates by family. Order matters: the first match wins, so the specific goes before the general. */
const BUILT_IN: Array<{ match: RegExp; price: Price }> = [
  { match: /^claude-.*opus/i,    price: { in: 5,    out: 25   } },
  { match: /^claude-.*sonnet/i,  price: { in: 3,    out: 15   } },
  { match: /^claude-.*haiku/i,   price: { in: 1,    out: 5    } },
  { match: /gpt-oss-120b/i,      price: { in: 0.15, out: 0.75 } },
  { match: /gpt-oss-20b/i,       price: { in: 0.075, out: 0.30 } },
  { match: /llama-3\.3-70b/i,    price: { in: 0.59, out: 0.79 } },
  { match: /llama-3\.1-8b/i,     price: { in: 0.05, out: 0.08 } },
  { match: /llama-4-scout/i,     price: { in: 0.11, out: 0.34 } },
  { match: /llama-4-maverick/i,  price: { in: 0.20, out: 0.60 } },
  { match: /qwen3-32b/i,         price: { in: 0.29, out: 0.59 } },
]

export const builtInPrice = (model: string): Price | null => BUILT_IN.find(b => b.match.test(model))?.price ?? null

/** The person's own price for this exact model if they set one, else the built-in estimate, else nothing. */
export function priceFor(model: string, overrides: Prices = {}): { price: Price; source: 'yours' | 'estimate' } | null {
  const own = overrides[model]
  if (own && Number.isFinite(own.in) && Number.isFinite(own.out) && own.in >= 0 && own.out >= 0) return { price: own, source: 'yours' }
  const b = builtInPrice(model)
  return b ? { price: b, source: 'estimate' } : null
}

export const emptyUsage = (): TokenUsage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
export const totalTokens = (u: TokenUsage): number => u.input + u.output + u.cacheRead + u.cacheWrite

/** Anthropic bills a cache write at 1.25× the input rate and a cache read at 0.1×; Groq reports neither. */
export function costOf(u: ModelUsage, overrides: Prices = {}): number | null {
  const p = priceFor(u.model, overrides)
  if (!p) return null
  const inputEquivalent = u.input + u.cacheWrite * 1.25 + u.cacheRead * 0.1
  return (inputEquivalent * p.price.in + u.output * p.price.out) / 1_000_000
}

export interface Summary {
  tokens: TokenUsage
  total: number
  /** dollars for the models that have a price; null when none of the tokens could be priced */
  usd: number | null
  /** some tokens belong to a model with no price, so `usd` is a floor */
  partial: boolean
  /** which models had no price */
  unpriced: string[]
  /** EVERY priced figure comes from the person's own rate (so the amount is theirs, not an estimate) */
  usesOwnPrice: boolean
  /** at least one comes from their own rate, but not all */
  someOwnPrice: boolean
  calls: number
}

/** Total a list of per-request usages. A model with no price adds tokens but never dollars. */
export function summarise(list: ModelUsage[], overrides: Prices = {}): Summary {
  const tokens = emptyUsage()
  let usd = 0, priced = 0, calls = 0, own = 0
  const unpriced = new Set<string>()
  for (const u of list) {
    tokens.input += u.input; tokens.output += u.output; tokens.cacheRead += u.cacheRead; tokens.cacheWrite += u.cacheWrite
    calls++
    const c = costOf(u, overrides)
    if (c === null) { if (totalTokens(u) > 0) unpriced.add(u.model) } else { usd += c; priced++; if (priceFor(u.model, overrides)?.source === 'yours') own++ }
  }
  return { tokens, total: totalTokens(tokens), usd: priced ? usd : null, partial: unpriced.size > 0 && priced > 0, unpriced: [...unpriced], usesOwnPrice: priced > 0 && own === priced, someOwnPrice: own > 0 && own < priced, calls }
}

/** One usage per model, added up — a turn that spanned two models is two lines, each priced by its own model. */
export function groupByModel(list: ModelUsage[]): ModelUsage[] {
  const by = new Map<string, ModelUsage>()
  for (const u of list) {
    const k = `${u.provider}|${u.model}`
    const g = by.get(k)
    if (g) { g.input += u.input; g.output += u.output; g.cacheRead += u.cacheRead; g.cacheWrite += u.cacheWrite }
    else by.set(k, { ...u })
  }
  return [...by.values()]
}

/** A row's usage as stored (jsonb), tolerant of anything missing — old rows have none, and a bad one must not break the header. */
export function usageFromRow(raw: unknown): ModelUsage | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)
  const model = typeof r.model === 'string' ? r.model : ''
  const provider = r.provider === 'groq' ? 'groq' : 'anthropic'
  const u = { input: n(r.input), output: n(r.output), cacheRead: n(r.cacheRead), cacheWrite: n(r.cacheWrite), model, provider } as ModelUsage
  return totalTokens(u) > 0 ? u : null
}

/**
 * Tokens for an answer that is still being written. The provider only reports its count when the reply ends, so while
 * it streams the best there is is characters ÷ 4 — which is why the header marks a figure that includes one with "~"
 * and replaces it with the real number the moment the row completes.
 */
export const estimateOutputTokens = (chars: number): number => Math.max(0, Math.round(chars / 4))

export function formatTokens(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  if (n < 999_500) return `${Math.round(n / 1000)}k`          // 999,600 is "1M", not "1000k"
  return `${(n / 1_000_000).toFixed(2).replace(/0$/, '').replace(/\.0$/, '')}M`
}

export function formatUsd(usd: number): string {
  if (usd > 0 && usd < 0.01) return '<$0.01'
  if (usd < 10) return `$${usd.toFixed(2)}`
  if (usd < 1000) return `$${usd.toFixed(1)}`
  return `$${Math.round(usd).toLocaleString('en-US')}`
}

export interface CounterText {
  /** what sits beside the model name: "12.4k tokens · ≈$0.04" */
  short: string
  /** the longer account of it, for the tooltip */
  long: string
}

/** "≈$0.04" — an amount is called an estimate unless every figure in it is the person's own rate; a sub-cent amount is
 *  just "<$0.01" (an "≈" in front of that reads as noise). */
export function amountText(s: Pick<Summary, 'usd' | 'usesOwnPrice' | 'partial'>): string {
  if (s.usd === null) return ''
  const amt = formatUsd(s.usd)
  return `${s.usesOwnPrice && !s.partial || amt.startsWith('<') ? '' : '≈'}${amt}${s.partial ? '+' : ''}`
}

/** What the header says. `live` is the estimate for an answer in flight, `extraOutput` its tokens. */
export function counterText(s: Summary, live = false): CounterText {
  const tilde = live ? '~' : ''
  const tok = `${tilde}${formatTokens(s.total)} token${s.total === 1 ? '' : 's'}`
  const money = s.usd === null ? '' : ` · ${amountText(s)}`
  const parts = [
    `Used in this conversation: ${s.total.toLocaleString('en-US')} tokens over ${s.calls} request${s.calls === 1 ? '' : 's'}`,
    `${s.tokens.input.toLocaleString('en-US')} in · ${s.tokens.output.toLocaleString('en-US')} out` + (s.tokens.cacheRead + s.tokens.cacheWrite ? ` · ${(s.tokens.cacheRead + s.tokens.cacheWrite).toLocaleString('en-US')} cached` : ''),
  ]
  if (live) parts.push('Includes an estimate for the answer still being written; the exact figure replaces it when it finishes.')
  if (s.usd !== null) parts.push(s.usesOwnPrice ? 'Amount uses the price you set in Settings → AI; the provider’s invoice is the final word.' : s.someOwnPrice ? 'Amount uses your own price where you set one and an estimate from list prices for the rest; the provider’s invoice is the final word.' : 'Amount is an estimate from list prices; the provider’s invoice is the final word. Set your own rate in Settings → AI.')
  if (s.unpriced.length) parts.push(`No price known for ${s.unpriced.join(', ')}, so ${s.usd === null ? 'no amount is shown' : 'the amount counts only the models that have one'}.`)
  return { short: tok + money, long: parts.join('\n') }
}

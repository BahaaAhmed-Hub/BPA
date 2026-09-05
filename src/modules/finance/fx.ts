// ─── Money in more than one currency ─────────────────────────────────────────
// Every total in this module added `Math.abs(tx.amount)` and stopped there, so
// 3,500 USD and 3,500 EGP counted the same. The Budget screen went the other
// way and left anything not in the envelope's currency out entirely, which is
// at least not a lie but means income in USD appeared in no total anywhere.
//
// Neither is good enough. This holds a rate per currency and converts, and
// where there is no rate it says so rather than guessing — a made-up exchange
// rate is worse than an obvious gap.
//
// Rates are what one unit of that currency is worth in the base currency, so
// USD 48.5 means one dollar buys 48.5 of whatever the base is. They are set by
// hand: there is no rate feed in here, and an EGP rate from a stale cache
// would be its own kind of wrong.

const RATES_KEY = 'finance-fx-rates'

export function baseCurrency(): string {
  try { return localStorage.getItem('finance-currency') || 'EGP' } catch { return 'EGP' }
}

export function loadRates(): Record<string, number> {
  try {
    const raw = localStorage.getItem(RATES_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : {}
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && isFinite(v) && v > 0) out[k.toUpperCase()] = v
    }
    return out
  } catch { return {} }
}

export function saveRates(rates: Record<string, number>): void {
  try { localStorage.setItem(RATES_KEY, JSON.stringify(rates)) } catch { /* quota */ }
  window.dispatchEvent(new Event('professor:fxRatesChanged'))
}

export function setRate(currency: string, rate: number | null): void {
  const next = loadRates()
  if (rate && rate > 0) next[currency.toUpperCase()] = rate
  else delete next[currency.toUpperCase()]
  saveRates(next)
}

/** What one unit of `cur` is worth in the base currency, or null when nobody
 *  has said. The base is always worth one of itself. */
export function rateFor(cur: string | undefined, base = baseCurrency()): number | null {
  const c = (cur || base).toUpperCase()
  if (c === base.toUpperCase()) return 1
  return loadRates()[c] ?? null
}

/** An amount in the base currency, or null when it cannot be known. Callers
 *  have to decide what to do with null — every one of them says something. */
export function toBase(amount: number, cur: string | undefined, base = baseCurrency()): number | null {
  const rate = rateFor(cur, base)
  return rate === null ? null : amount * rate
}

/** From one currency into another, by way of the base. Rates are held against
 *  the base, so USD → EGP is a multiply but EGP → USD is a divide, and neither
 *  is possible unless both ends have a rate. Null means it cannot be known —
 *  the caller decides what to do about that, and no caller guesses. */
export function convert(amount: number, from: string | undefined, to: string | undefined): number | null {
  const base = baseCurrency()
  const f = (from || base).toUpperCase()
  const t = (to || base).toUpperCase()
  if (f === t) return amount
  const rf = rateFor(f, base)
  const rt = rateFor(t, base)
  if (rf === null || rt === null || rt === 0) return null
  return (amount * rf) / rt
}

/** Adds up a mixed pile, and reports what it could not add. */
export function sumInBase(
  rows: { amount: number; currency?: string }[],
  base = baseCurrency(),
): { total: number; unconverted: string[] } {
  let total = 0
  const unconverted = new Set<string>()
  for (const row of rows) {
    const v = toBase(Math.abs(row.amount), row.currency, base)
    if (v === null) unconverted.add((row.currency || base).toUpperCase())
    else total += v
  }
  return { total, unconverted: [...unconverted] }
}

/** Currencies that show up in the data with no rate to convert them by. */
export function currenciesNeedingRates(
  rows: { currency?: string }[],
  base = baseCurrency(),
): string[] {
  const missing = new Set<string>()
  for (const row of rows) {
    const c = (row.currency || base).toUpperCase()
    if (rateFor(c, base) === null) missing.add(c)
  }
  return [...missing]
}

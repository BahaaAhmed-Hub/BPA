/** How money is written down in this module.
 *
 *  Accounting convention: a negative figure is wrapped in parentheses and drops
 *  its minus sign — (67,650), never −67,650 — and a positive never carries a
 *  plus. The brackets and the colour say which way the money went, so a leading
 *  sign on every line is noise.
 *
 *  A figure that is a labelled magnitude ("OUT 72,400", "48,250 held") is not a
 *  signed number and stays as it is; use `outflow` where the label is missing
 *  and the number is money leaving. */

export interface AcctOpts {
  /** Prefixed inside the brackets: (EGP 67,650), not (EGP) 67,650. */
  currency?: string
  /** What to print for zero. A ledger leaves the cell dashed; screens that
   *  want a real "EGP 0" pass it. */
  zero?: string
  decimals?: number
}

/** Thousands-grouped magnitude — no sign, no brackets. */
export function group(n: number, decimals = 0): string {
  return Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/** A magnitude short enough for a chart label or a day cell.
 *
 *  Past a thousand the digits stop carrying information and start costing
 *  space: "1745K" is a number you have to count the characters of to read,
 *  where "1.7M" is one you take in. So each step up the scale keeps three
 *  significant figures at most and switches unit at a thousand of the last:
 *  950 → `950`, 12,200 → `12.2K`, 1,745,000 → `1.7M`, 2,000,000 → `2M`.
 *  A round figure drops its `.0` — `2.0M` claims a precision it does not have.
 */
export function compact(n: number): string {
  const a = Math.abs(n)
  const step = (v: number, unit: string) => {
    const dp = v >= 100 ? 0 : 1
    return `${v.toFixed(dp).replace(/\.0$/, '')}${unit}`
  }
  // Rounding decides the unit, not the raw figure: 999,999 rounds to 1000K,
  // and a thousand of a unit is one of the next one up.
  if (a >= 999_500_000) return step(a / 1_000_000_000, 'B')
  if (a >= 999_500)     return step(a / 1_000_000, 'M')
  if (a >= 999.5)       return step(a / 1_000, 'K')
  return group(a)
}

/** A signed figure in accounting form. */
export function acct(n: number, opts: AcctOpts = {}): string {
  const { currency, zero, decimals = 0 } = opts
  const body = (v: number) => (currency ? `${currency} ${group(v, decimals)}` : group(v, decimals))
  if (n === 0) return zero ?? body(0)
  return n < 0 ? `(${body(n)})` : body(n)
}

/** Money leaving, given as a magnitude. Always bracketed. */
export function outflow(n: number, opts: AcctOpts = {}): string {
  return acct(-Math.abs(n), opts)
}

/** A note, in brackets, ready to sit at the end of a row's second line — or
 *  nothing at all where there is no note. The brackets are what make it read
 *  as an aside rather than as another field: "6 Sep · Cafe (with Omar)". */
export function noted(note: string | undefined | null): string {
  const t = (note ?? '').trim()
  return t ? ` (${t})` : ''
}

/** Type as many digits as you like; the separators keep up. Returns the
 *  grouped string and where the caret should sit afterwards — reformatting
 *  without this jumps the caret to the end on every keystroke. */
export function groupWhileTyping(raw: string, caret: number): { text: string; caret: number } {
  const negative = raw.trimStart().startsWith('-')
  const digitsBefore = raw.slice(0, caret).replace(/[^\d]/g, '').length

  const cleaned = raw.replace(/[^\d.]/g, '')
  const [whole = '', ...rest] = cleaned.split('.')
  const decimals = rest.length ? rest.join('').slice(0, 2) : null

  const grouped = whole === '' ? '' : Number(whole).toLocaleString('en-US')
  const text = `${negative && grouped ? '-' : ''}${grouped}${decimals !== null ? `.${decimals}` : ''}`

  // Walk forward until the same number of digits has gone by.
  let seen = 0, pos = 0
  for (; pos < text.length; pos++) {
    if (/\d/.test(text[pos])) {
      if (seen === digitsBefore) break
      seen++
    }
  }
  if (seen < digitsBefore) pos = text.length
  return { text, caret: pos }
}

/** The number behind a grouped string. */
export function ungroup(text: string): number {
  const n = parseFloat(text.replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

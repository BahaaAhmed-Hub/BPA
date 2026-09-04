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

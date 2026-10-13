// ─── What books cost ─────────────────────────────────────────────────────────
// Pure. Money is summed in whole minor units (cents) so 0.1 + 0.2 is 0.30, and
// it is **never converted**: 40 USD and 900 EGP are two totals, because the only
// rate that would join them is a guess about a day nobody wrote down.
import type { Book } from './types'

/** "12.50", "12,5", "1,299", "1.299,50" → 12.5 / 12.5 / 1299 / 1299.5. Null for anything that is not a non-negative amount.
 *  A separator followed by 1–2 digits is a decimal point; followed by exactly 3 it is a thousands mark; anything else is refused
 *  rather than guessed at — a mistyped price should not become a different price. */
export function parseMoney(raw: string): number | null {
  const t = raw.replace(/\s/g, '')
  if (!/^\d[\d.,]*$/.test(t)) return null
  const grouped = (s: string): boolean => {
    if (!/[.,]/.test(s)) return true
    const sep = s.match(/[.,]/)![0]
    return new RegExp(`^[1-9]\\d{0,2}(\\${sep}\\d{3})+$`).test(s)
  }
  const last = Math.max(t.lastIndexOf('.'), t.lastIndexOf(','))
  let whole: string, frac = ''
  if (last < 0) { whole = t }
  else {
    const sep = t[last], head = t.slice(0, last), tail = t.slice(last + 1)
    const other = sep === '.' ? ',' : '.'
    const kinds = new Set(t.match(/[.,]/g))
    let decimal: boolean
    if (kinds.size === 2) { if (head.includes(sep)) return null; decimal = true }
    else if ((t.match(/[.,]/g) ?? []).length > 1) decimal = false
    else decimal = tail.length <= 2
    if (decimal) { if (!/^\d{1,2}$/.test(tail) || (head.includes(other) === false && /[.,]/.test(head))) return null; whole = head; frac = tail }
    else whole = t
  }
  if (!grouped(whole)) return null
  const n = Number(whole.replace(/[.,]/g, '') + (frac ? `.${frac}` : ''))
  if (!Number.isFinite(n) || n > 9_999_999_999) return null
  return Math.round(n * 100) / 100
}

/** Three capital letters, or null. */
export const parseCurrency = (raw: string): string | null => {
  const t = raw.trim().toUpperCase()
  return /^[A-Z]{3}$/.test(t) ? t : null
}

export interface Spend { currency: string; amount: number; books: number }

const cents = (n: number) => Math.round(n * 100)

/** Books bought in `year` (by the day bought), totalled per currency, largest first. A price with no currency or no date is in no total. */
export function spendInYear(books: Pick<Book, 'paidAmount' | 'paidCurrency' | 'boughtOn'>[], year: number): Spend[] {
  const by = new Map<string, { c: number; n: number }>()
  for (const b of books) {
    if (b.paidAmount === undefined || !b.paidCurrency || !b.boughtOn) continue
    if (Number(b.boughtOn.slice(0, 4)) !== year) continue
    const e = by.get(b.paidCurrency) ?? { c: 0, n: 0 }
    e.c += cents(b.paidAmount); e.n++
    by.set(b.paidCurrency, e)
  }
  return [...by].map(([currency, e]) => ({ currency, amount: e.c / 100, books: e.n }))
    .sort((a, b) => b.amount - a.amount || a.currency.localeCompare(b.currency))
}

/** Books with a price that no total can use, so the screen can say they were left out. */
export const unplaced = (books: Pick<Book, 'paidAmount' | 'paidCurrency' | 'boughtOn'>[]): number =>
  books.filter(b => b.paidAmount !== undefined && (!b.paidCurrency || !b.boughtOn)).length

export const fmtMoney = (amount: number, currency: string): string => {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'code', maximumFractionDigits: 2 }).format(amount).replace(/\s/g, ' ') }
  catch { return `${currency} ${amount.toFixed(2)}` }
}

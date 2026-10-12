// ─── ISBNs: what a barcode or a keyboard hands us, checked ───────────────────
// A scan is a camera guessing at stripes, and a typed number is a person
// guessing at digits; both are wrong often enough that an unchecked ISBN would
// become a confidently wrong book. The check digit is the whole defence, so
// nothing reaches a catalogue without passing it.
//
// Everything is normalised to ISBN-13, which is what a barcode carries, what the
// shelf stores and what the catalogues index. An ISBN-10 is the same book with an
// older check digit (`978` + its first nine digits + a new check).

const strip = (s: string) => s.replace(/[\s-]/g, '').toUpperCase()

const check13 = (d: string): number => {
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(d[i]) * (i % 2 ? 3 : 1)
  return (10 - (sum % 10)) % 10
}

export function isIsbn13(d: string): boolean {
  return /^97[89]\d{10}$/.test(d) && check13(d) === Number(d[12])
}

export function isIsbn10(d: string): boolean {
  if (!/^\d{9}[\dX]$/.test(d)) return false
  let sum = 0
  for (let i = 0; i < 10; i++) sum += (10 - i) * (d[i] === 'X' ? 10 : Number(d[i]))
  return sum % 11 === 0
}

export function toIsbn13(isbn10: string): string {
  const core = '978' + isbn10.slice(0, 9)
  return core + check13(core + '0')
}

/** A valid ISBN-13 from whatever was given (10 or 13, with or without hyphens
 *  and spaces), or `null` when it is not one — a wrong check digit, the wrong
 *  length, or an EAN that is not a book (a 977 magazine, a tin of beans). */
export function parseIsbn(input: string): string | null {
  const d = strip(input)
  if (isIsbn13(d)) return d
  if (isIsbn10(d)) return toIsbn13(d)
  return null
}

// Guests an assistant asked to invite — shared by the bots and the in-app assistant.

/** Guests the model passed, as clean unique addresses. Anything that is not an
 *  address is dropped and reported back, never sent to Google as an attendee —
 *  a name like "Ahmed" is not somebody an invitation can reach. */
export function parseGuests(raw: unknown): { emails: string[]; rejected: string[] } {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,;\s]+/) : []
  const emails: string[] = []
  const rejected: string[] = []
  for (const g of list) {
    const s = String(g ?? '').trim().replace(/^mailto:/i, '')
    if (!s) continue
    if (/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s)) {
      if (!emails.some(e => e.toLowerCase() === s.toLowerCase())) emails.push(s)
    } else rejected.push(s)
  }
  return { emails, rejected }
}

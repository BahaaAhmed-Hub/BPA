// ─── Who you paid, remembered ────────────────────────────────────────────────
// The payee was a free text box that forgot everything the moment it closed, so
// the same shop got typed slightly differently every month and nothing added
// up. This keeps the list.
//
// Two sources, deliberately. The transactions you already have are the
// truthful record and cost nothing to read. The saved list is what survives a
// transaction being deleted, and what lets a name entered on the laptop turn
// up as a suggestion on the iPad.

import type { Transaction } from './types'

const KEY = 'finance-payees'

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []
  } catch { return [] }
}

function write(list: string[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 400))) } catch { /* quota */ }
}

/** Remember one. Case-insensitive, so "Gourmet" does not join "gourmet". */
export function rememberPayee(name: string): void {
  const clean = name.trim()
  if (!clean) return
  const list = read()
  const without = list.filter(p => p.toLowerCase() !== clean.toLowerCase())
  write([clean, ...without])
}

/** Every name known, most recently used first, with the ones actually on
 *  transactions ranked by how often they appear. */
export function knownPayees(transactions: Transaction[]): string[] {
  const counts = new Map<string, { name: string; n: number; last: string }>()
  for (const tx of transactions) {
    const name = tx.payee?.trim()
    if (!name) continue
    const key = name.toLowerCase()
    const seen = counts.get(key)
    if (seen) { seen.n++; if (tx.date > seen.last) seen.last = tx.date }
    else counts.set(key, { name, n: 1, last: tx.date })
  }
  const used = [...counts.values()]
    .sort((a, b) => b.n - a.n || b.last.localeCompare(a.last))
    .map(x => x.name)

  const seen = new Set(used.map(p => p.toLowerCase()))
  const saved = read().filter(p => !seen.has(p.toLowerCase()))
  return [...used, ...saved]
}

/** What to offer for what has been typed so far. A name that starts with the
 *  query comes before one that merely contains it — typing "go" should reach
 *  "Gourmet Market" before "Argos". */
export function matchPayees(all: string[], query: string, limit = 6): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return all.slice(0, limit)
  const starts: string[] = []
  const contains: string[] = []
  for (const p of all) {
    const lower = p.toLowerCase()
    if (lower === q) continue                 // already typed in full
    if (lower.startsWith(q)) starts.push(p)
    else if (lower.includes(q)) contains.push(p)
  }
  return [...starts, ...contains].slice(0, limit)
}

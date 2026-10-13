// ─── Mapping a model's category guess onto the categories you have ───────────
// The model is given your category names and told to use one *exactly* if it
// fits; it still returns "history" for "History", or "Self help" for "Self-Help".
// A near-miss must land on the category that exists, not create a twin of it —
// two "History"s is a shelf nobody can browse. Pure, so it is tested alone.

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

export interface CategoryChoice {
  /** The name to file under: your own spelling when it matches one you have. */
  name: string
  /** True when it matched an existing category; false means filing would create one. */
  existing: boolean
}

export function resolveCategory(suggested: string | undefined, have: string[]): CategoryChoice | null {
  const s = suggested?.replace(/\s+/g, ' ').trim()
  if (!s) return null
  const key = norm(s)
  if (!key) return null
  const hit = have.find(h => norm(h) === key)
  return hit ? { name: hit, existing: true } : { name: s, existing: false }
}

/** The new names a set of choices would create, once each however many books share them. */
export function newCategoryNames(names: string[], have: string[]): string[] {
  const seen = new Set(have.map(norm))
  const out: string[] = []
  for (const n of names) {
    const k = norm(n)
    if (!k || seen.has(k)) continue
    seen.add(k); out.push(n.replace(/\s+/g, ' ').trim())
  }
  return out
}

export { norm as normCategory }

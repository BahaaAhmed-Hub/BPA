#!/usr/bin/env node
/**
 * prune-imports — remove import specifiers the compiler says nothing reads
 *
 *   node scripts/prune-imports.mjs
 *
 * `split-module.mjs` decides what a file needs by matching identifier names,
 * which over-counts (a property called `supabase` is not the import
 * `supabase`). The compiler is the authority: every TS6133 that lands on an
 * import specifier is removed at the exact column it reports, bottom-up so
 * positions stay valid, and an import left empty goes with it. Loops until
 * `tsc -b` reports none. Only imports are touched: an unused local is a finding
 * for a person to read, not something to delete.
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

let total = 0
for (let pass = 0; pass < 8; pass++) {
  let out = ''
  try { execSync('npx tsc -b', { encoding: 'utf8', stdio: 'pipe' }) } catch (e) { out = String(e.stdout ?? '') }
  const byFile = new Map()
  for (const m of out.matchAll(/^(.+?)\((\d+),(\d+)\): error TS6133: '([^']+)' is declared but its value is never read\./gm)) {
    if (!byFile.has(m[1])) byFile.set(m[1], [])
    byFile.get(m[1]).push({ line: +m[2], col: +m[3], name: m[4] })
  }
  let changed = 0
  for (const [f, items] of byFile) {
    const lines = readFileSync(f, 'utf8').split('\n')
    // bottom-up, right-to-left
    items.sort((a, b) => b.line - a.line || b.col - a.col)
    for (const { line, col, name } of items) {
      const L = lines[line - 1]
      // the specifier must sit inside an import statement
      let k = line - 1; while (k > 0 && !/^\s*import\b/.test(lines[k])) k--
      if (!/^\s*import\b/.test(lines[k])) continue
      let at = col - 1
      if (L.slice(at, at + name.length) !== name) {
        // an import whose every specifier is unused is reported at the statement, not the name
        const m = new RegExp(`\\b${name.replace(/[$]/g, '\\$')}\\b`).exec(L)
        if (!m) continue
        at = m.index
      }
      let a = at, b = at + name.length
      const before = L.slice(0, a)
      const t = /(type\s+)$/.exec(before); if (t) a -= t[1].length
      // take the comma after it, else the comma before
      const rest = L.slice(b)
      const after = /^\s*,\s*/.exec(rest)
      if (after) b += after[0].length
      else { const pre = /,\s*$/.exec(L.slice(0, a)); if (pre) a -= pre[0].length }
      lines[line - 1] = L.slice(0, a) + L.slice(b)
      changed++
    }
    // drop any import left with nothing in it
    const text = lines.join('\n').replace(/^import\s+(type\s+)?\{\s*\}\s+from\s+'[^']+'\n/gm, '').replace(/^import\s+(type\s+)?\{\s*\}\s+from\s+'[^']+'$/gm, '')
    writeFileSync(f, text)
  }
  total += changed
  if (!changed) break
}
console.log(total ? `pruned ${total} unused import specifier(s)` : 'nothing to prune')

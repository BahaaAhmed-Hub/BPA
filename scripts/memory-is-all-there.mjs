#!/usr/bin/env node
/**
 *  ─── The split lost nothing ─────────────────────────────────────────────────
 *
 *  `CLAUDE.md` was 4,392 lines and ~75,500 tokens, and it was read on **every
 *  turn**. It is now ~220 lines plus one file per area in `.claude/rules/`,
 *  each loaded only when a file it names is touched.
 *
 *  That is a move worth exactly as much as the guarantee that nothing fell out
 *  of it, and "I was careful" is not a guarantee. So: take the old file out of
 *  git history, cut it at its own `## ` headings, and require every section to
 *  appear **verbatim and exactly once** across the new root and the rule files.
 *
 *    node scripts/memory-is-all-there.mjs [<git-ref>]
 *
 *  The ref defaults to the commit before the split. Pass another to check
 *  against a different point in history.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, existsSync } from 'node:fs'

const REF = process.argv[2] || process.env.MEMORY_REF || 'SPLIT_BASE'
let old
try {
  old = execFileSync('git', ['show', `${REF}:CLAUDE.md`], { encoding: 'utf8', maxBuffer: 1 << 26 })
} catch {
  console.error(`Could not read CLAUDE.md at ${REF}. Pass a ref: ` +
    `node scripts/memory-is-all-there.mjs <ref>`)
  process.exit(2)
}

const lines = old.split('\n')
const starts = []
lines.forEach((l, i) => { if (/^## /.test(l)) starts.push(i) })
const sections = starts.map((s, k) => ({
  heading: lines[s].replace(/^##\s*/, ''),
  text: lines.slice(s, starts[k + 1] ?? lines.length).join('\n').replace(/\n+$/, ''),
}))

const files = { 'CLAUDE.md': readFileSync('CLAUDE.md', 'utf8') }
if (existsSync('.claude/rules')) for (const f of readdirSync('.claude/rules')) {
  if (f.endsWith('.md')) files[`.claude/rules/${f}`] = readFileSync(`.claude/rules/${f}`, 'utf8')
}

let missing = 0, duplicated = 0
const where = {}
for (const s of sections) {
  const hits = Object.entries(files).filter(([, body]) => body.includes(s.text)).map(([n]) => n)
  if (hits.length === 0) { console.log(`MISSING     ${s.heading}`); missing++ }
  else if (hits.length > 1) { console.log(`DUPLICATED  ${s.heading}  → ${hits.join(', ')}`); duplicated++ }
  else (where[hits[0]] ??= []).push(s.heading)
}

console.log(`\n${sections.length} sections in ${REF}:CLAUDE.md`)
for (const [f, hs] of Object.entries(where).sort()) {
  const b = files[f].length
  console.log(`  ${String(hs.length).padStart(3)} in ${f.padEnd(26)} ${b} bytes · ≈${Math.round(b / 4)} tokens`)
}
const perTurn = files['CLAUDE.md'].length
console.log(`\nper-turn cost: ${perTurn} bytes ≈ ${Math.round(perTurn / 4)} tokens ` +
  `(was ${old.length} ≈ ${Math.round(old.length / 4)})`)

if (missing || duplicated) {
  console.error(`\n${missing} missing, ${duplicated} duplicated — the split lost or doubled something.`)
  process.exit(1)
}
console.log('\n✅ every section is present exactly once')

#!/usr/bin/env node
/**
 * split-module — move top-level declarations out of one big .tsx into new files
 *
 *   node scripts/split-module.mjs <source.tsx> <plan.json> [--dry]
 *
 * plan.json: { "targets": { "model.ts": ["AppSettings", "ls", ...], "sections/Profile.tsx": [...] },
 *              "reexport": ["loadAIConfig", ...] }      // names other files import from <source>
 *
 * Built for the Settings split (docs/ui-unification.md, P2.2). It does the part
 * that is easy to get wrong by hand:
 *   - a declaration moves with the comment block above it, in original order;
 *   - a moved name that anything else uses gets `export`;
 *   - each new file gets exactly the imports it uses — original imports are
 *     filtered by use, and names that moved to a sibling are imported from it;
 *   - the source keeps what was not moved, imports the moved names it still
 *     uses, drops imports nothing uses any more, and re-exports `reexport`;
 *   - it REFUSES, naming both sides, if a moved declaration uses something
 *     that stayed behind (that would be a circular import) or if two new files
 *     would import each other.
 * Types are checked afterwards by `tsc -b`; this script does not guess at them.
 */
import ts from 'typescript'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, relative, posix } from 'node:path'

const [srcPath, planPath] = process.argv.slice(2)
const DRY = process.argv.includes('--dry')
const plan = JSON.parse(readFileSync(planPath, 'utf8'))
const srcDir = dirname(srcPath)
const text = readFileSync(srcPath, 'utf8')
const sf = ts.createSourceFile(srcPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

// ── The statements ──────────────────────────────────────────────────────────
const imports = [], decls = []
for (const st of sf.statements) {
  if (ts.isImportDeclaration(st)) { imports.push(st); continue }
  const names = []
  if (ts.isVariableStatement(st)) st.declarationList.declarations.forEach(d => ts.isIdentifier(d.name) && names.push(d.name.text))
  else if ((ts.isFunctionDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st)) && st.name) names.push(st.name.text)
  const exported = !!(ts.getCombinedModifierFlags(st) & ts.ModifierFlags.Export)
  decls.push({ st, names, exported, full: text.slice(st.getFullStart(), st.getEnd()), body: text.slice(st.getStart(), st.getEnd()) })
}
const owner = new Map()      // name -> decl index
decls.forEach((d, i) => d.names.forEach(n => owner.set(n, i)))

// Which target a declaration goes to (by any of its names).
const targetOf = new Map()   // decl index -> target file
for (const [file, names] of Object.entries(plan.targets)) {
  for (const n of names) {
    if (!owner.has(n)) { console.error(`✗ plan names "${n}" for ${file}, but ${srcPath} declares no such top-level name`); process.exit(1) }
    const i = owner.get(n)
    if (targetOf.has(i) && targetOf.get(i) !== file) { console.error(`✗ "${n}" is planned for both ${targetOf.get(i)} and ${file}`); process.exit(1) }
    targetOf.set(i, file)
  }
}

const typeNames = new Set(decls.flatMap(d => (ts.isInterfaceDeclaration(d.st) || ts.isTypeAliasDeclaration(d.st)) ? d.names : []))
const tn = n => (typeNames.has(n) ? `type ${n}` : n)

// ── Who uses what ───────────────────────────────────────────────────────────
function idsIn(node) {
  const s = new Set()
  const walk = n => {
    if (ts.isIdentifier(n)) s.add(n.text)
    ts.forEachChild(n, walk)
  }
  walk(node)
  return s
}
decls.forEach(d => { d.ids = idsIn(d.st) })

const importBindings = []    // { name, decl, kind }
for (const im of imports) {
  const c = im.importClause
  if (!c) continue
  if (c.name) importBindings.push({ name: c.name.text, decl: im, kind: 'default' })
  if (c.namedBindings) {
    if (ts.isNamespaceImport(c.namedBindings)) importBindings.push({ name: c.namedBindings.name.text, decl: im, kind: 'ns' })
    else c.namedBindings.elements.forEach(e => importBindings.push({ name: e.name.text, decl: im, kind: 'named', el: e, typeOnly: c.isTypeOnly || e.isTypeOnly }))
  }
}
const bindingByName = new Map(importBindings.map(b => [b.name, b]))

// The file a name will live in after the split ('' = stays in the source).
const home = n => (owner.has(n) ? (targetOf.get(owner.get(n)) ?? '') : null)

// ── Problems that must stop us ──────────────────────────────────────────────
const problems = []
const fileUses = new Map()      // target -> Set of sibling targets it imports from
for (const [i, d] of decls.entries()) {
  const t = targetOf.get(i)
  if (!t) continue
  for (const id of d.ids) {
    if (!owner.has(id) || owner.get(id) === i) continue
    const h = home(id)
    if (h === '') problems.push(`${t}: "${d.names[0]}" uses "${id}", which stays in ${posix.basename(srcPath)} — that would be a circular import (move "${id}" too, or move it to a shared file)`)
    else if (h !== t) { if (!fileUses.has(t)) fileUses.set(t, new Set()); fileUses.get(t).add(h) }
  }
}
for (const [a, bs] of fileUses) for (const b of bs) if (fileUses.get(b)?.has(a)) problems.push(`${a} and ${b} would import each other`)
if (problems.length) { console.error('✗ cannot split:\n  ' + [...new Set(problems)].join('\n  ')); process.exit(1) }

// ── Build the new files ─────────────────────────────────────────────────────
const spec = (fromFile, toFile) => {
  let r = posix.relative(posix.dirname(fromFile), toFile).replace(/\.(tsx?)$/, '')
  return r.startsWith('.') ? r : './' + r
}
const srcBase = posix.basename(srcPath)
const files = new Map()   // target -> content
const exportNames = new Set()   // moved names that need `export`
for (const [i, d] of decls.entries()) {
  const t = targetOf.get(i); if (!t) continue
  for (const n of d.names) {
    const usedElsewhere = decls.some((o, j) => j !== i && o.ids.has(n) && targetOf.get(j) !== t) || (plan.reexport ?? []).includes(n)
    if (usedElsewhere) exportNames.add(n)
  }
}

function withExport(d) {
  if (d.exported) return d.full
  const need = d.names.some(n => exportNames.has(n))
  if (!need) return d.full
  // insert `export ` before the statement proper, after any leading comments
  const startInFull = d.st.getStart() - d.st.getFullStart()
  return d.full.slice(0, startInFull) + 'export ' + d.full.slice(startInFull)
}

function importLines(forIds, ownFile, ownNames) {
  const lines = []
  // 1) original imports, filtered to what is used
  const byDecl = new Map()
  for (const b of importBindings) if (forIds.has(b.name)) { if (!byDecl.has(b.decl)) byDecl.set(b.decl, []); byDecl.get(b.decl).push(b) }
  for (const im of imports) {
    const used = byDecl.get(im); if (!used) continue
    const mod = im.moduleSpecifier.text
    // a relative import of the source's own siblings is re-pointed from the new file
    const from = mod.startsWith('.') ? spec(ownFile ? posix.join(posix.dirname(srcPath), ownFile) : srcPath, posix.join(posix.dirname(srcPath), mod)) : mod
    const def = used.find(b => b.kind === 'default'), ns = used.find(b => b.kind === 'ns'), named = used.filter(b => b.kind === 'named')
    const typeOnly = im.importClause.isTypeOnly
    const parts = []
    if (def) parts.push(def.name)
    if (ns) parts.push(`* as ${ns.name}`)
    if (named.length) parts.push('{ ' + named.map(b => (b.typeOnly && !typeOnly ? 'type ' : '') + (b.el.propertyName ? `${b.el.propertyName.text} as ${b.name}` : b.name)).join(', ') + ' }')
    lines.push(`import ${typeOnly ? 'type ' : ''}${parts.join(', ')} from '${from}'`)
  }
  return lines
}

for (const target of new Set(targetOf.values())) {
  const mine = decls.filter((_, i) => targetOf.get(i) === target)
  const myNames = new Set(mine.flatMap(d => d.names))
  const ids = new Set(mine.flatMap(d => [...d.ids]))
  const lines = importLines(ids, target, myNames)
  // names that live in a sibling target
  const sib = new Map()
  for (const id of ids) {
    if (myNames.has(id) || !owner.has(id)) continue
    const h = home(id)
    if (h && h !== target) { if (!sib.has(h)) sib.set(h, []); sib.get(h).push(id) }
  }
  for (const [h, ns] of sib) lines.push(`import { ${[...new Set(ns)].sort().map(tn).join(', ')} } from '${spec(posix.join(srcDir, target), posix.join(srcDir, h))}'`)
  const body = mine.map(withExport).join('').replace(/^\s*\n/, '')
  files.set(target, lines.join('\n') + (lines.length ? '\n' : '') + (body.startsWith('\n') ? '' : '\n') + body.replace(/\s*$/, '\n'))
}

// ── The shrunken source ─────────────────────────────────────────────────────
const kept = decls.filter((_, i) => !targetOf.has(i))
const keptIds = new Set(kept.flatMap(d => [...d.ids]))
const need = new Map()    // target -> names the source still needs
for (const id of keptIds) {
  if (!owner.has(id)) continue
  const h = home(id); if (!h) continue
  if (!need.has(h)) need.set(h, []); need.get(h).push(id)
}
const outImports = importLines(keptIds, null, null)
for (const [h, ns] of need) outImports.push(`import { ${[...new Set(ns)].sort().map(tn).join(', ')} } from '${spec(srcPath, posix.join(srcDir, h))}'`)
const reex = new Map()
for (const n of plan.reexport ?? []) { const h = home(n); if (h) { if (!reex.has(h)) reex.set(h, []); reex.get(h).push(n) } }
const reexLines = [...reex].map(([h, ns]) => `export { ${[...new Set(ns)].join(', ')} } from '${spec(srcPath, posix.join(srcDir, h))}'`)
const fixedReex = reexLines.map(l => l.replace(/\{ ([^}]*) \}/, (_, inner) => '{ ' + inner.split(', ').map(n => typeNames.has(n) ? `type ${n}` : n).join(', ') + ' }'))
const keptBody = kept.map(d => (d.exported || !d.names.some(n => exportNames.has(n))) ? d.full : withExport(d)).join('')
const fileLeading = text.slice(0, imports.length ? imports[0].getFullStart() : 0)
const out = fileLeading + outImports.join('\n') + '\n' + (fixedReex.length ? fixedReex.join('\n') + '\n' : '') + keptBody

if (DRY) {
  console.log(`would write ${files.size} file(s); ${srcBase}: ${text.split('\n').length} → ${out.split('\n').length} lines`)
  for (const [f, c] of files) console.log(`  ${f}: ${c.split('\n').length} lines`)
  process.exit(0)
}
for (const [f, c] of files) {
  const p = join(srcDir, f)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, c)
}
writeFileSync(srcPath, out)
console.log(`wrote ${files.size} file(s); ${srcBase}: ${text.split('\n').length} → ${out.split('\n').length} lines`)

// Unused imports the name-matching leaves behind are removed by scripts/prune-imports.mjs (run after this).

// ─── UI guard — a code scan for the UI-unification rules ─────────────────────
//
//   node scripts/ui-guard.mjs                    # the rules turned on so far
//   node scripts/ui-guard.mjs --only=type,dialog # just these, enforced
//   node scripts/ui-guard.mjs --json             # machine-readable
//   node scripts/ui-guard.mjs --self-test        # every rule must catch its fixture
//
// Reads every .ts/.tsx under src/ and counts violations per rule. See
// docs/ui-unification.md (§T0.1) for what each rule means and why.
//
// **Which rules fail the run.** A rule fails the run only when it is *turned
// on* — in ENFORCED below, which a phase adds its rule to in the same PR that
// takes the count to zero — or when it is named with `--only`. The others are
// still counted and printed (`·` rather than `✗`), so the backlog is visible
// and the baseline for a phase is one command.
//
// **A guard that cannot fail proves nothing.** `--self-test` runs every rule
// over scripts/fixtures/ui-guard-bad.tsx, which carries one violation per rule
// (and one *allowed* line per whitelist, which must NOT be counted), and fails
// if a rule misses its violation or flags its allowed line.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const SRC = join(ROOT, 'src')
const FIXTURE = join(ROOT, 'scripts', 'fixtures', 'ui-guard-bad.tsx')

/** Rules that fail a bare `node scripts/ui-guard.mjs`. Add one per phase. */
const ENFORCED = new Set(['type', 'ink', 'hex', 'palette', 'quadrant', 'emoji', 'dialog', 'unfinished'])

const args = process.argv.slice(2)
const flag = n => args.includes(`--${n}`)
const opt = n => args.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3)

// ─── Reading a file the way a rule needs to ──────────────────────────────────
/** Strip a trailing `// …` comment (not one inside a URL) and report whether
 *  the whole line is comment. Block comments are tracked by the caller. */
function codeOf(line) {
  return line.replace(/(^|[^:'"`])\/\/.*$/, '$1')
}

/** Lines of a file with comments blanked out (line and block), keeping line
 *  numbers, plus the untouched raw lines for marker comments. */
function scan(text) {
  const raw = text.split('\n')
  let inBlock = false
  const code = raw.map(l => {
    let s = l
    if (inBlock) {
      const end = s.indexOf('*/')
      if (end === -1) return ''
      inBlock = false
      s = s.slice(end + 2)
    }
    // /* … */ opened on this line
    for (;;) {
      const start = s.indexOf('/*')
      if (start === -1) break
      const end = s.indexOf('*/', start + 2)
      if (end === -1) { inBlock = true; s = s.slice(0, start); break }
      s = s.slice(0, start) + s.slice(end + 2)
    }
    return codeOf(s)
  })
  return { raw, code }
}

const inDir = (rel, ...dirs) => dirs.some(d => rel.startsWith(d))

/** Lines belonging to `const NAME = …` statements named in `names`, by bracket
 *  depth — the user-pickable emoji sets, which are data and are allowed. */
function allowedBlocks(code, names) {
  const ok = new Set()
  const start = new RegExp(`\\bconst\\s+(${names.join('|')})\\b`)
  for (let i = 0; i < code.length; i++) {
    if (!start.test(code[i])) continue
    let depth = 0, seen = false
    for (let j = i; j < code.length; j++) {
      ok.add(j)
      for (const ch of code[j]) {
        if ('[{('.includes(ch)) { depth++; seen = true }
        else if (']})'.includes(ch)) depth--
      }
      if (seen && depth <= 0) break
    }
  }
  return ok
}

// ─── The rules ───────────────────────────────────────────────────────────────
// check(ctx) → [{ line (1-based) }]. ctx: { rel, raw, code }.
const EMOJI = /\p{Extended_Pictographic}/u
// ©  ®  ™ are text symbols that Unicode also files as pictographic; they are
// not what the emoji rule is about.
const TEXT_SYMBOLS = /[©®™]/g

const perLine = (ctx, test) => {
  const out = []
  ctx.code.forEach((l, i) => { if (l && test(l, ctx.raw[i], i)) out.push({ line: i + 1 }) })
  return out
}

const RULES = {
  type: {
    why: 'font sizes under 14px must be a --sb-t-* token (docs §P0.1)',
    check: ctx => perLine(ctx, (l, raw) => {
      // The whole expression, so `tight ? 11.5 : 12.5` is caught as well as
      // `fontSize: 11` — but not `size * 0.5`, which is a ratio, not a size.
      const m = /fontSize\s*[:=]\s*\{?([^,}]*)/.exec(l)
      return !!m && !/ui-guard:\s*type-ok/.test(raw) && /(?<![\w.*/])(9|10|11|12|13)(\.5)?(?![\w.])/.test(m[1])
    }),
  },
  ink: {
    why: '--sb-ink-4 is not for text you are meant to read (docs §P0.2)',
    check: ctx => perLine(ctx, (l, raw) =>
      /(?<![-\w])color:\s*[^,;}]*--sb-ink-4/.test(l) && !/ui-guard:\s*ink-ok/.test(raw)),
  },
  hex: {
    why: 'raw hex in a module — use a --sb-* token (docs §P0.3)',
    check: ctx => {
      if (!inDir(ctx.rel, 'src/modules/', 'src/components/')) return []
      return perLine(ctx, (l, raw) =>
        /#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?\b/.test(l) && !/ui-guard:\s*user-colour/.test(raw))
    },
  },
  palette: {
    why: 'a local `const C = {…}` palette — import it from @/lib/palette (docs §P0.3)',
    check: ctx => ctx.rel === 'src/lib/palette.ts' ? [] : perLine(ctx, l => /^\s*(export )?const C = \{/.test(l)),
  },
  quadrant: {
    why: 'a quadrant colour defined outside src/lib/quadrants.ts (docs §P0.4)',
    check: ctx => {
      if (ctx.rel === 'src/lib/quadrants.ts') return []
      const out = []
      ctx.code.forEach((l, i) => {
        if (!/\b(v|key):\s*'do'/.test(l)) return
        // The object literal: this line to the first line that closes it.
        let span = ''
        for (let j = i; j < Math.min(ctx.code.length, i + 6); j++) {
          span += ctx.code[j] + '\n'
          if (j > i && /^\s*\}/.test(ctx.code[j])) break
          if (j === i && /\}/.test(ctx.code[j].slice(ctx.code[j].search(/\b(v|key):/)))) break
        }
        if (/\bcolor:/.test(span)) out.push({ line: i + 1 })
      })
      return out
    },
  },
  emoji: {
    why: 'emoji in the interface — use a lucide icon (docs §P0.5)',
    check: ctx => {
      if (!inDir(ctx.rel, 'src/modules/')) return []
      if (['src/modules/finance/components/IconPicker.tsx', 'src/modules/finance/shopping/shoppingDb.ts',
           'src/modules/finance/categoryIcons.ts'].includes(ctx.rel)) return []
      const ok = allowedBlocks(ctx.code, ['EMOJIS', 'GROUP_ICONS'])
      // `// ui-guard: emoji-ok` allows its own line; a run of lines between
      // `// ui-guard: emoji-start` and `// ui-guard: emoji-end` is user-pickable
      // data (a preset list, a default) and is allowed as a block.
      let inside = false
      const region = ctx.raw.map(r => {
        if (/ui-guard:\s*emoji-start/.test(r)) inside = true
        const here = inside
        if (/ui-guard:\s*emoji-end/.test(r)) inside = false
        return here
      })
      return perLine(ctx, (l, raw, i) =>
        !ok.has(i) && !region[i] && EMOJI.test(l.replace(TEXT_SYMBOLS, '')) && !/ui-guard:\s*emoji-ok/.test(raw))
    },
  },
  dialog: {
    why: 'native confirm/prompt/alert — use undo or ConfirmDialog (docs §P0.6)',
    check: ctx => perLine(ctx, l => /window\.(confirm|prompt|alert)\(/.test(l)),
  },
  unfinished: {
    why: '"coming soon" or an env-var name shown to users (docs §P1.1)',
    check: ctx => perLine(ctx, l =>
      /coming soon/i.test(l) || /(?<!env\.)(?<!\w)VITE_[A-Z_]+/.test(l) && !/import\.meta\.env/.test(l)),
  },
  loading: {
    why: 'plain "Loading…" text — use <Skeleton> (docs §P1.2)',
    check: ctx => perLine(ctx, l => />\s*Loading(…|\.\.\.)|^\s*Loading(…|\.\.\.)\s*$/.test(l)),
  },
}

// ─── Walking src/ ────────────────────────────────────────────────────────────
function* walk(dir) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (/\.tsx?$/.test(n) && !n.endsWith('.d.ts')) yield p
  }
}

function run(files, relOf) {
  const found = Object.fromEntries(Object.keys(RULES).map(k => [k, []]))
  for (const f of files) {
    const text = readFileSync(f, 'utf8')
    const ctx = { rel: relOf(f), ...scan(text) }
    for (const [id, rule] of Object.entries(RULES)) {
      for (const hit of rule.check(ctx)) found[id].push({ file: ctx.rel, line: hit.line })
    }
  }
  return found
}

// ─── --self-test ─────────────────────────────────────────────────────────────
if (flag('self-test')) {
  const text = readFileSync(FIXTURE, 'utf8')
  // The fixture names which line must trip which rule, and which lines must not:
  //   // expect: type  (or /* expect: type */)   (the NEXT line must be flagged by `type`)
  //   // allow: emoji          (the NEXT line must NOT be flagged by `emoji`)
  // It is checked as a pretend file under src/modules/ so path-scoped rules apply.
  const { raw, code } = scan(text)
  const ctx = { rel: 'src/modules/fixture/Bad.tsx', raw, code }
  let bad = 0
  const expectRules = new Set()
  raw.forEach((l, i) => {
    const e = /(?:\/\/|\/\*)\s*expect: (\w+)/.exec(l), a = /(?:\/\/|\/\*)\s*allow: (\w+)/.exec(l)
    if (!e && !a) return
    const id = (e ?? a)[1]
    if (!RULES[id]) { console.log(`✗ fixture names unknown rule "${id}"`); bad++; return }
    const hits = new Set(RULES[id].check(ctx).map(h => h.line))
    const target = i + 2   // 1-based number of the next line
    if (e) {
      expectRules.add(id)
      const ok = hits.has(target)
      console.log(`${ok ? '✓' : '✗'} ${id.padEnd(10)} catches its fixture (line ${target})`)
      if (!ok) bad++
    } else {
      const ok = !hits.has(target)
      console.log(`${ok ? '✓' : '✗'} ${id.padEnd(10)} lets its allowed line through (line ${target})`)
      if (!ok) bad++
    }
  })
  for (const id of Object.keys(RULES)) {
    if (!expectRules.has(id)) { console.log(`✗ ${id.padEnd(10)} has no violation in the fixture`); bad++ }
  }
  // A rule that flags everything would pass the checks above, so the clean
  // file has to come back clean.
  const clean = scan('const x = 1\nconst y = "plain text"\n')
  const noise = Object.entries(RULES).filter(([, r]) => r.check({ rel: 'src/modules/x.tsx', ...clean }).length)
  for (const [id] of noise) { console.log(`✗ ${id.padEnd(10)} flags a clean file`); bad++ }
  console.log(bad ? `\n${bad} self-test failure(s)` : '\nself-test: every rule catches its fixture and lets its allowed lines through')
  process.exit(bad ? 1 : 0)
}

// ─── The real run ────────────────────────────────────────────────────────────
const only = opt('only')?.split(',').filter(Boolean)
if (only) for (const o of only) if (!RULES[o]) { console.error(`unknown rule "${o}". One of: ${Object.keys(RULES).join(', ')}`); process.exit(2) }

const found = run([...walk(SRC)], f => relative(ROOT, f).split(sep).join('/'))
const shown = only ?? Object.keys(RULES)
const enforced = only ? new Set(only) : ENFORCED

if (flag('json')) {
  console.log(JSON.stringify(Object.fromEntries(shown.map(id => [id, { count: found[id].length, enforced: enforced.has(id), hits: found[id] }])), null, 1))
} else {
  for (const id of shown) {
    const hits = found[id]
    const mark = hits.length === 0 ? '✓' : enforced.has(id) ? '✗' : '·'
    const eg = hits.slice(0, 2).map(h => `${h.file}:${h.line}`).join(', ')
    console.log(`${id.padEnd(11)} ${String(hits.length).padStart(4)}  ${mark}${hits.length ? `   (${eg}${hits.length > 2 ? ', …' : ''})` : ''}${hits.length && !enforced.has(id) ? '  not yet enforced' : ''}`)
  }
}
process.exit(shown.some(id => enforced.has(id) && found[id].length) ? 1 : 0)

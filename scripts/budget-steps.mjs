// A budget keeps the amount it had. Pure logic in src/modules/finance/budgetSteps.ts,
// de-typed with tsc and run here — no browser needed for this layer.
//   node scripts/budget-steps.mjs
import ts from 'typescript'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/modules/finance/budgetSteps.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const m = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
const { amountFor, withAmount, editMonth } = m

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`)
}

const OCT = new Date(2026, 9, 28)         // "today" for every case unless stated
const rule = { amount: 10000, frequency: 'monthly' }

// ── the case that started this ───────────────────────────────────────────────
// The user changes 10K → 13K. July (12K spent) must still be measured on 10K.
const raised = withAmount(rule, 13000, '2026-10', OCT)
eq('change is recorded from the current month', raised.steps, [{ from: '2026-10', amount: 13000 }])
eq('the base is untouched', raised.amount, 10000)
eq('July keeps the old number', amountFor(raised, '2026-07'), 10000)
eq('July: 12,000 spent is over its 10,000', 12000 > amountFor(raised, '2026-07'), true)
eq('September (last month) keeps the old number', amountFor(raised, '2026-09'), 10000)
eq('this month uses the new number', amountFor(raised, '2026-10'), 13000)
eq('November uses the new number', amountFor(raised, '2026-11'), 13000)
eq('a year from now uses the new number', amountFor(raised, '2027-06'), 13000)
eq('last year keeps the old number', amountFor(raised, '2025-12'), 10000)
// No month asked → the real current month. Built from the real clock so it holds on any day.
const nowKey = m.monthKeyOf()
const noMonth = withAmount(rule, 13000, nowKey)
eq('no month asked reads the current month', amountFor(noMonth), 13000)
eq('…and the month before it is the old number', amountFor(noMonth, m.monthKeyOf(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15))), 10000)

// ── a rule that never changed reads exactly as before ────────────────────────
eq('no steps: every month is the amount', [amountFor(rule, '2020-01'), amountFor(rule, '2030-12')], [10000, 10000])
eq('unparseable steps are ignored', withAmount({ amount: 5, steps: [{ from: 'junk', amount: 9 }] }, 5, '2026-10', OCT).steps, undefined)

// ── editing while looking at the past never rewrites it ──────────────────────
const fromJuly = withAmount(rule, 13000, '2026-07', OCT)
eq('edit made while viewing July still starts this month', fromJuly.steps, [{ from: '2026-10', amount: 13000 }])
eq('…and July is still 10,000', amountFor(fromJuly, '2026-07'), 10000)
eq('editMonth: a past month → now', editMonth('2026-07', OCT), '2026-10')
eq('editMonth: a future month on screen is respected', editMonth('2027-01', OCT), '2027-01')
const fromJan = withAmount(rule, 13000, '2027-01', OCT)
eq('edit while viewing January starts in January', fromJan.steps, [{ from: '2027-01', amount: 13000 }])
eq('…so December is still the old number', amountFor(fromJan, '2026-12'), 10000)

// ── typing: the field saves on every keystroke ───────────────────────────────
let typed = rule
for (const n of [1, 13, 130, 1300, 13000]) typed = withAmount(typed, n, '2026-10', OCT)
eq('five keystrokes leave one change', typed.steps, [{ from: '2026-10', amount: 13000 }])
eq('and the past is still the old base', amountFor(typed, '2026-09'), 10000)
// clearing the field then retyping
let cleared = withAmount(rule, 0, '2026-10', OCT)
cleared = withAmount(cleared, 12000, '2026-10', OCT)
eq('clear then retype in one month → one change', cleared.steps, [{ from: '2026-10', amount: 12000 }])

// ── an edit that changes nothing records nothing ─────────────────────────────
eq('same amount → no step', withAmount(rule, 10000, '2026-10', OCT).steps, undefined)
eq('typed away and back within the month → no step', withAmount(withAmount(rule, 13000, '2026-10', OCT), 10000, '2026-10', OCT).steps, undefined)

// ── a later change builds on the earlier one ─────────────────────────────────
const NOV = new Date(2026, 10, 3)
const twice = withAmount(raised, 15000, '2026-11', NOV)
eq('second raise a month later is a second step', twice.steps, [{ from: '2026-10', amount: 13000 }, { from: '2026-11', amount: 15000 }])
eq('October keeps the first raise', amountFor(twice, '2026-10'), 13000)
eq('July is still the original', amountFor(twice, '2026-07'), 10000)
eq('a cut is recorded as well as a raise', amountFor(withAmount(raised, 8000, '2026-11', NOV), '2026-11'), 8000)

// ── "from now on" replaces what was planned for later ────────────────────────
const planned = { amount: 10000, steps: [{ from: '2026-10', amount: 11000 }, { from: '2027-03', amount: 20000 }] }
const over = withAmount(planned, 12000, '2026-10', OCT)
eq('later planned changes are dropped', over.steps, [{ from: '2026-10', amount: 12000 }])
eq('so March no longer jumps', amountFor(over, '2027-03'), 12000)

// ── a first budget has no past to protect ────────────────────────────────────
const first = withAmount({ amount: 0, frequency: 'monthly' }, 5000, '2026-10', OCT)
eq('first amount is just the amount', [first.amount, first.steps], [5000, undefined])
eq('…so it runs in earlier months, as a new budget always did', amountFor(first, '2026-01'), 5000)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

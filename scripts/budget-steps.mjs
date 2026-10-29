// A budget keeps the amount it had. Pure logic in src/modules/finance/budgetSteps.ts,
// de-typed with tsc and run here — no browser needed for this layer.
//   node scripts/budget-steps.mjs
import ts from 'typescript'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/modules/finance/budgetSteps.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const m = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
const { amountFor, withAmount, editMonth, ruleAt, withChange } = m

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

// ═══ the other things a budget says, and school fees that come round every year ═══
const L45 = [{ id: 'a', date: '2026-09-01', amount: 45000 }, { id: 'b', date: '2027-01-15', amount: 45000 }]
const L50 = [{ id: 'a', date: '2026-09-01', amount: 50000 }, { id: 'b', date: '2027-01-15', amount: 50000 }]
const fees = { amount: 0, schedule: 'custom', linesRepeat: true, lines: L45, currency: 'EGP', frequency: 'monthly', bucket: 'fixed', born: '2026-01' }

// ── gap 1: the fee goes up, and last year is not rewritten ───────────────────
const raisedFees = withChange(fees, { lines: L50 }, '2026-10', OCT)
eq('the new set is a change from this month', raisedFees.steps, [{ from: '2026-10', lines: L50 }])
eq('the base still holds the old set', raisedFees.lines, L45)
eq('last September (before the change) reads the old instalment', ruleAt(raisedFees, '2026-09').lines[0].amount, 45000)
eq('September a year on reads the new one', ruleAt(raisedFees, '2027-09').lines[0].amount, 50000)
eq('a year ago reads the old one', ruleAt(raisedFees, '2025-09').lines[0].amount, 45000)
eq('and the identity of a set is stable, so a writer can tell which one is in force', ruleAt(raisedFees, '2027-09').lines === L50, true)
eq('editing the dates twice in a month is one change', withChange(raisedFees, { lines: L45 }, '2026-10', OCT).steps, undefined)

// ── gap 2: currency, frequency and bucket ────────────────────────────────────
const rent = { amount: 10000, currency: 'EGP', frequency: 'monthly', bucket: 'fixed', born: '2026-01' }
const toUsd = withChange(rent, { currency: 'USD' }, '2026-10', OCT)
eq('a currency change is a change from this month', toUsd.steps, [{ from: '2026-10', currency: 'USD' }])
eq('earlier months stay in the old currency', ruleAt(toUsd, '2026-07').currency, 'EGP')
eq('this month and after are in the new one', [ruleAt(toUsd, '2026-10').currency, ruleAt(toUsd, '2027-03').currency], ['USD', 'USD'])
eq('the amount is not touched by a currency change', ruleAt(toUsd, '2026-07').amount, 10000)
const quarterly = withChange(rent, { frequency: 'quarterly' }, '2026-10', OCT)
eq('frequency: earlier months keep monthly', [ruleAt(quarterly, '2026-07').frequency, ruleAt(quarterly, '2026-11').frequency], ['monthly', 'quarterly'])
const saved = withChange(rent, { bucket: 'savings' }, '2026-10', OCT)
eq('bucket: earlier months keep their bucket', [ruleAt(saved, '2026-07').bucket, ruleAt(saved, '2026-11').bucket], ['fixed', 'savings'])

// ── several fields, one month ────────────────────────────────────────────────
const both = withChange(withChange(rent, { currency: 'USD' }, '2026-10', OCT), { amount: 300 }, '2026-10', OCT)
eq('a currency changed this morning is not lost when the amount changes this afternoon', both.steps, [{ from: '2026-10', currency: 'USD', amount: 300 }])
const backAgain = withChange(both, { currency: 'EGP' }, '2026-10', OCT)
eq('putting one field back drops only that field from the change', backAgain.steps, [{ from: '2026-10', amount: 300 }])
const allBack = withChange(backAgain, { amount: 10000 }, '2026-10', OCT)
eq('putting them all back leaves no history', allBack.steps, undefined)

// ── a later change to another field stands; to the same field it is replaced ─
const plannedBoth = { ...rent, steps: [{ from: '2027-03', amount: 20000 }, { from: '2027-06', bucket: 'savings' }] }
const edited = withChange(plannedBoth, { bucket: 'guiltfree' }, '2026-10', OCT)
eq('changing the bucket now leaves the planned raise in March alone',
  edited.steps.find(x => x.from === '2027-03'), { from: '2027-03', amount: 20000 })
eq('…and removes the planned bucket change it overrides', edited.steps.some(x => x.from === '2027-06'), false)

// ── nothing to protect yet ───────────────────────────────────────────────────
const fresh = withChange({ amount: 0, currency: undefined, frequency: 'monthly' }, { bucket: 'fixed' }, '2026-10', OCT)
eq('a rule with nothing in it is set in place and remembers when it was made', [fresh.bucket, fresh.steps, fresh.born], ['fixed', undefined, '2026-10'])
let building = { amount: 0, schedule: 'custom', linesRepeat: true, lines: [] }
for (const n of [1, 2, 3, 4]) building = withChange(building, { lines: Array.from({ length: n }, (_, i) => ({ id: 'x' + i, date: `2026-0${i + 1}-10`, amount: 100 })) }, '2026-10', OCT)
eq('building a school fee up one date at a time in its first month leaves no history', [building.steps, building.lines.length], [undefined, 4])
eq('…so the first date does not appear alone in the months before', ruleAt(building, '2026-02').lines.length, 4)
const nextMonth = withChange(building, { lines: building.lines.slice(0, 3) }, '2026-11', new Date(2026, 10, 3))
eq('the month after it was made, a change is history', nextMonth.steps.length, 1)
eq('a rule from before this field existed (no born) is treated as having a past', withChange({ amount: 10000 }, { currency: 'USD' }, '2026-10', OCT).steps, [{ from: '2026-10', currency: 'USD' }])

// ── steps written before this existed ────────────────────────────────────────
const old = { amount: 10000, steps: [{ from: '2026-10', amount: 13000 }] }
eq('an old amount-only step still reads', [ruleAt(old, '2026-09').amount, ruleAt(old, '2026-10').amount], [10000, 13000])
eq('ruleAt on nothing is nothing', ruleAt(undefined, '2026-10'), undefined)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

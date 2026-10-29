// An entry keeps the exchange rate of the day it was added. Pure logic in
// src/modules/finance/txRates.ts (with fx.ts under it), de-typed with tsc and run here.
//   node scripts/tx-rates.mjs
import ts from 'typescript'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// fx.ts reads localStorage and announces changes on window.
const store = new Map()
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) }
globalThis.window = { dispatchEvent: () => true }
globalThis.Event = class { constructor(t) { this.type = t } }

const dir = mkdtempSync(join(tmpdir(), 'txrates-'))
for (const f of ['fx', 'format', 'txRates']) {
  const src = readFileSync(new URL(`../src/modules/finance/${f}.ts`, import.meta.url), 'utf8')
  const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  writeFileSync(join(dir, `${f}.js`), out.replace(/from '\.\/(fx|format)'/g, "from './$1.js'"))
}
const fx = await import(join(dir, 'fx.js'))
const { frozenRate, txConvert, txIn, stamped, withRate, isFxTag, unpaidRateNote, debtsByCurrency } = await import(join(dir, 'txRates.js'))

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`)
}
const tx = (extra = {}) => ({ id: 't', accountId: 'a', amount: -100, currency: 'USD', type: 'expense', payee: 'p', date: '2026-07-10', isCleared: true, isRecurring: false, createdAt: '', ...extra })
const NOW = new Date(2026, 9, 29)

fx.setRate('USD', 48)

// ── the case that started this ───────────────────────────────────────────────
const july = stamped(tx(), { now: NOW })
eq('a foreign entry is stamped with the rate of the day', july.tags, ['fx:USD/EGP=48'])
fx.setRate('USD', 50)
eq('the rate changes to 50', fx.rateFor('USD'), 50)
eq('the entry added at 48 is still worth 4,800', txIn(july), 4800)
eq('an entry added after the change is worth 5,000', txIn(stamped(tx(), { now: NOW })), 5000)
eq('an entry with no stamp (older than this) uses the current rate', txIn(tx()), 5000)

// ── stamping ─────────────────────────────────────────────────────────────────
fx.setRate('USD', 48)
eq('an entry in the base currency is left alone', stamped(tx({ currency: 'EGP' })).tags, undefined)
eq('a currency nobody gave a rate for is left alone, not guessed', stamped(tx({ currency: 'GBP' })).tags, undefined)
const again = stamped(july)
eq('an already-stamped entry is returned as it is (same object)', again === july, true)
eq('other tags are kept', stamped(tx({ tags: ['budget'] })).tags, ['budget', 'fx:USD/EGP=48'])
eq('a stale stamp for another currency is replaced, not stacked', stamped(tx({ currency: 'USD', tags: ['fx:EUR/EGP=55'] })).tags, ['fx:USD/EGP=48'])

// ── the description ──────────────────────────────────────────────────────────
eq('the rate goes into an empty description', stamped(tx(), { note: true, now: NOW }).note, 'rate 29 Oct 2026: 1 USD = 48 EGP')
eq('…after an existing note, which is kept', stamped(tx({ note: 'with Omar' }), { note: true, now: NOW }).note, 'with Omar rate 29 Oct 2026: 1 USD = 48 EGP')
eq('freezing old entries leaves their notes alone', stamped(tx({ note: 'old' })).note, 'old')

// ── editing the rate ─────────────────────────────────────────────────────────
eq('withRate replaces the stamp and keeps the other tags', withRate(['a', 'fx:USD/EGP=48', 'b'], 'USD', 49.5), ['a', 'b', 'fx:USD/EGP=49.5'])
eq('withRate on no tags', withRate(undefined, 'usd', 49.5), ['fx:USD/EGP=49.5'])
eq('an edited stamp is the one that is read', txIn(tx({ tags: withRate([], 'USD', 49.5) })), 4950)
eq('isFxTag tells a stamp from a tag a person wrote', [isFxTag('fx:USD/EGP=48'), isFxTag('fx:'), isFxTag('groceries')], [true, false, false])

// ── reading ──────────────────────────────────────────────────────────────────
eq('frozenRate reads the tag', frozenRate(tx({ tags: ['fx:USD/EGP=48.5'] })), 48.5)
eq('a stamp for another currency is not this entry\'s', frozenRate(tx({ tags: ['fx:EUR/EGP=55'] })), null)
eq('a stamp against another base means nothing', frozenRate(tx({ tags: ['fx:USD/AED=3.67'] })), null)
eq('malformed tags are ignored', frozenRate(tx({ tags: ['fx:USD/EGP=abc', 'fx:'] })), null)
fx.setRate('EUR', 55)
eq('into another currency: frozen base value over the current rate of the target',
  txConvert(tx({ tags: ['fx:USD/EGP=48'] }), 100, 'EUR'), 4800 / 55)
eq('the sign of an amount is ignored by txIn', txIn(tx({ amount: 100, tags: ['fx:USD/EGP=48'] })), 4800)

// ── unpaid debts, in the currency they are owed in ───────────────────────────
fx.setRate('USD', 50)
eq('a stamped entry says its rate and, where it differs, today\'s', unpaidRateNote(tx({ tags: ['fx:USD/EGP=48'] })), 'USD 100 @ 48 = EGP 4,800 · today 50 = EGP 5,000')
eq('a stamp equal to today\'s says it once', unpaidRateNote(tx({ tags: ['fx:USD/EGP=50'] })), 'USD 100 @ 50 = EGP 5,000')
eq('an entry with no stamp is at today\'s rate, and says so once', unpaidRateNote(tx()), 'USD 100 @ 50 = EGP 5,000')
eq('an entry in the base currency has no note', unpaidRateNote(tx({ currency: 'EGP' })), null)
eq('a currency with no rate and no stamp has no note', unpaidRateNote(tx({ currency: 'GBP' })), null)
eq('cents are kept', unpaidRateNote(tx({ amount: -12.5, tags: ['fx:USD/EGP=48'] })), 'USD 12.50 @ 48 = EGP 600 · today 50 = EGP 625')
const owed = debtsByCurrency([tx({ tags: ['fx:USD/EGP=48'] }), tx({ amount: -40 }), tx({ currency: 'EGP', amount: -300 })])
eq('debts are grouped by foreign currency; the base is left out', owed.map(d => d.currency), ['USD'])
eq('count and amount in that currency', [owed[0].count, owed[0].amount], [2, 140])
eq('at the rates added: 100 at 48 + 40 at the then-current 50', owed[0].atAdded, 6800)
eq('at today\'s rate', [owed[0].atToday, owed[0].todayRate], [7000, 50])
fx.setRate('USD', null)
const unrated = debtsByCurrency([tx({ tags: ['fx:USD/EGP=48'] }), tx()])
eq('with no rate today, only the stamped one is priced: the total is unknown, not guessed', [unrated[0].atAdded, unrated[0].atToday], [null, null])
fx.setRate('USD', 48)

// ── a rate removed later does not un-price what was stamped ──────────────────
fx.setRate('USD', null)
eq('the stamped entry still converts when the rate is later removed', txIn(july), 4800)
eq('an unstamped one then cannot be converted', txIn(tx()), null)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

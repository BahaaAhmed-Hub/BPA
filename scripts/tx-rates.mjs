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
for (const f of ['fx', 'txRates']) {
  const src = readFileSync(new URL(`../src/modules/finance/${f}.ts`, import.meta.url), 'utf8')
  const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  writeFileSync(join(dir, `${f}.js`), out.replace(/from '\.\/fx'/g, "from './fx.js'"))
}
const fx = await import(join(dir, 'fx.js'))
const { frozenRate, txConvert, txIn, stamped } = await import(join(dir, 'txRates.js'))

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

// ── reading ──────────────────────────────────────────────────────────────────
eq('frozenRate reads the tag', frozenRate(tx({ tags: ['fx:USD/EGP=48.5'] })), 48.5)
eq('a stamp for another currency is not this entry\'s', frozenRate(tx({ tags: ['fx:EUR/EGP=55'] })), null)
eq('a stamp against another base means nothing', frozenRate(tx({ tags: ['fx:USD/AED=3.67'] })), null)
eq('malformed tags are ignored', frozenRate(tx({ tags: ['fx:USD/EGP=abc', 'fx:'] })), null)
fx.setRate('EUR', 55)
eq('into another currency: frozen base value over the current rate of the target',
  txConvert(tx({ tags: ['fx:USD/EGP=48'] }), 100, 'EUR'), 4800 / 55)
eq('the sign of an amount is ignored by txIn', txIn(tx({ amount: 100, tags: ['fx:USD/EGP=48'] })), 4800)

// ── a rate removed later does not un-price what was stamped ──────────────────
fx.setRate('USD', null)
eq('the stamped entry still converts when the rate is later removed', txIn(july), 4800)
eq('an unstamped one then cannot be converted', txIn(tx()), null)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

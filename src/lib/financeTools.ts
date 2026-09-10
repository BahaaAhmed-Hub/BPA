// ─── What the assistant may do with the money ────────────────────────────────
//
// The assistant could read your mail, your calendar, your tasks and your habits,
// and knew nothing about the one module where being wrong is expensive. These
// are its finance tools: read the ledger, work things out from it, and write to
// it. Four rules hold the whole file together.
//
// - **The lock is the lock.** The assistant panel opens over every screen, so
//   reading the ledger aloud while Finance is locked would walk straight around
//   the door. Every tool here refuses while `isLocked()`, and says why.
// - **Names, not ids.** "Groceries", "CIB current" — a model handed a uuid
//   guesses, and a guess here files rent under school fees. Everything resolves
//   by name, refuses an ambiguous one, and lists what it found.
// - **The arithmetic is the app's own.** Balances, conversion, what counts as
//   unpaid, duplicates, the goal plan — all imported. A second implementation
//   that rounds differently is a second answer to the same question.
// - **A write is one entry, it says what it did, and it can be taken back.**
//   Deleting asks for `confirm`, deletion goes through the store's undo, and
//   every write calls `notify()` so it lands in the corner where you can see it.

import type Anthropic from '@anthropic-ai/sdk'
import { useFinanceStore } from '@/modules/finance/financeStore'
import { isLocked } from '@/modules/finance/lock'
import { liveBalances } from '@/modules/finance/balances'
import { toBase, baseCurrency, loadRates, setRate, rateFor } from '@/modules/finance/fx'
import { settled, whenPaid, isUnpaid } from '@/modules/finance/unpaid'
import { findDuplicates } from '@/modules/finance/duplicates'
import { capacityFrom, planGoals, debtGoals, isDebtGoal } from '@/modules/finance/goalPlan'
import { loadRules, monthlyAmount, activeIn } from '@/modules/finance/modals/BudgetRuleModal'
import { todayISO } from '@/modules/finance/dates'
import type { Account, Category, Currency, Goal, Transaction, TxType } from '@/modules/finance/types'
import { notify } from '@/lib/undo'

// ─── Guards and resolvers ────────────────────────────────────────────────────

const LOCKED = {
  error: 'The finances are locked on this device. Open Finance and unlock it, '
       + 'then ask again — nothing here can read or write the ledger while it is shut.',
}

function store() { return useFinanceStore.getState() }

/** One place decides whether the ledger may be touched at all. */
function shut(): boolean { return isLocked() }

const norm = (s: string) => s.trim().toLowerCase()

/** By id, then by exact name, then by a name that contains it. An ambiguous
 *  answer is an error naming the candidates, never the first match. */
function pick<T extends { id: string; name: string }>(
  what: string, list: T[], term: string | undefined,
): { hit: T } | { error: string } {
  if (!term) return { error: `Which ${what}? One of: ${list.map(x => x.name).join(', ')}` }
  const byId = list.find(x => x.id === term)
  if (byId) return { hit: byId }
  const exact = list.filter(x => norm(x.name) === norm(term))
  if (exact.length === 1) return { hit: exact[0] }
  const loose = exact.length ? exact : list.filter(x => norm(x.name).includes(norm(term)))
  if (loose.length === 1) return { hit: loose[0] }
  if (loose.length === 0) return { error: `No ${what} called "${term}". There is: ${list.map(x => x.name).join(', ')}` }
  return { error: `"${term}" matches more than one ${what}: ${loose.map(x => x.name).join(', ')}. Use the full name.` }
}

const isErr = <T,>(r: { hit: T } | { error: string }): r is { error: string } => 'error' in r

/** The ledger holds one year at a time, so asking about another one has to go
 *  and get it — otherwise the honest answer is "nothing", about a year that is
 *  simply not loaded. */
async function ensureYear(from?: string, to?: string): Promise<string | null> {
  const years = [from, to].filter(Boolean).map(d => Number((d as string).slice(0, 4))).filter(Number.isFinite)
  if (years.length === 0) return null
  const lo = Math.min(...years), hi = Math.max(...years)
  if (lo !== hi) return `Only one year is loaded at a time, and ${lo}–${hi} spans more than one. Ask about one year.`
  if (lo !== store().currentYear) await store().setYear(lo)
  return null
}

const money = (n: number) => Math.round(n * 100) / 100
const monthOf = (iso: string) => iso.slice(0, 7)

/** Every figure the assistant reports is converted, and says when it could
 *  not be — the same rule the screens follow. */
function inBase(amount: number, currency: string): number | null {
  return toBase(Math.abs(amount), currency, baseCurrency())
}

function catName(id: string | undefined, cats: Category[]): string {
  return cats.find(c => c.id === id)?.name ?? 'Uncategorised'
}

function acctName(id: string | undefined, accts: Account[]): string {
  return accts.find(a => a.id === id)?.name ?? 'unknown account'
}

/** What a transaction looks like to the model: readable, converted, and
 *  carrying the id it needs to change it. */
function txOut(tx: Transaction, cats: Category[], accts: Account[]) {
  return {
    id: tx.id,
    date: tx.date,
    paid_on: tx.paidAt ?? null,
    paid: !isUnpaid(tx),
    type: tx.type,
    payee: tx.payee,
    amount: tx.amount,
    currency: tx.currency,
    in_base: inBase(tx.amount, tx.currency),
    category: catName(tx.categoryId, cats),
    account: acctName(tx.accountId, accts),
    ...(tx.toAccountId ? { to_account: acctName(tx.toAccountId, accts) } : {}),
    ...(tx.note ? { note: tx.note } : {}),
  }
}

// ─── Schemas ─────────────────────────────────────────────────────────────────

const DATES = {
  from: { type: 'string', description: 'YYYY-MM-DD, inclusive. Defaults to the start of this month.' },
  to:   { type: 'string', description: 'YYYY-MM-DD, inclusive. Defaults to today.' },
}

export const FINANCE_TOOLS: Anthropic.Tool[] = [
  {
    name: 'finance_overview',
    description:
      'The whole financial picture in one call: cash and what is owed per account, this month\'s income, '
      + 'spending and net, what is unpaid, the biggest categories, budget envelopes that are over, and the goals '
      + 'with when each lands. Start here for any question about money — it is one call instead of six.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'list_finance_accounts',
    description: 'Every account with its live balance: what is held, what is owed on cards, and what is waiting on unpaid entries.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'list_transactions',
    description:
      'Entries from the ledger, newest first. Filter by date, category, account, payee text, type, or only what is unpaid.',
    input_schema: {
      type: 'object' as const,
      properties: {
        ...DATES,
        category: { type: 'string', description: 'Category name' },
        account:  { type: 'string', description: 'Account name' },
        payee:    { type: 'string', description: 'Text the payee contains' },
        type:     { type: 'string', enum: ['expense', 'income', 'transfer'], description: 'Kind of entry' },
        unpaid_only: { type: 'boolean', description: 'Only entries with no payment date — money owed. Covers the whole year unless dates are given, since most of it is dated ahead.' },
        limit:    { type: 'number', description: 'How many to return (default 40, max 200)' },
      },
      required: [],
    },
  },
  {
    name: 'spending_by_category',
    description:
      'What was spent per category over a period, converted into the base currency, biggest first — with the budget '
      + 'for each where there is one, and how the two compare. This is the tool for "where is the money going".',
    input_schema: {
      type: 'object' as const,
      properties: { ...DATES, income: { type: 'boolean', description: 'Income instead of spending' } },
      required: [],
    },
  },
  {
    name: 'list_budget_envelopes',
    description: 'Every category with a budget: what it allows a month, what has been spent against it, what is left, and the day the money is due.',
    input_schema: {
      type: 'object' as const,
      properties: { month: { type: 'string', description: 'YYYY-MM (defaults to this month)' } },
      required: [],
    },
  },
  {
    name: 'list_goals',
    description:
      'Every goal and the plan for it: what is still to find, what spare cash and each month put in, when it lands, '
      + 'and whether that beats its deadline. Credit cards in the red appear here as goals to clear them.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'find_duplicate_entries',
    description: 'Entries that look like the same thing recorded twice — same payee, amount, account and category, on one day or in one month.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'add_transaction',
    description:
      'Record one entry in the ledger. Use it when the user says they spent, earned or moved money. '
      + 'Amount is always positive — `type` says which way it goes. An entry with no payment date is owed rather than paid, '
      + 'and stays out of every balance until it is marked paid.',
    input_schema: {
      type: 'object' as const,
      properties: {
        amount:   { type: 'number', description: 'A positive amount' },
        type:     { type: 'string', enum: ['expense', 'income', 'transfer'], description: 'Which way the money went' },
        payee:    { type: 'string', description: 'Who it was paid to, or came from' },
        account:  { type: 'string', description: 'Account name (defaults to the first)' },
        to_account: { type: 'string', description: 'Transfers only: the account it lands in' },
        category: { type: 'string', description: 'Category name. Not used for transfers.' },
        date:     { type: 'string', description: 'YYYY-MM-DD it is dated (defaults to today)' },
        currency: { type: 'string', description: "Defaults to the account's own currency" },
        paid:     { type: 'boolean', description: 'Whether the money has actually moved (default true)' },
        paid_on:  { type: 'string', description: 'YYYY-MM-DD the money moved, if not the entry date' },
        note:     { type: 'string', description: 'Anything worth remembering' },
      },
      required: ['amount', 'type', 'payee'],
    },
  },
  {
    name: 'update_transaction',
    description: 'Change an entry that already exists. Only the fields given are touched. Get the id from list_transactions.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id:       { type: 'string', description: 'The entry id' },
        amount:   { type: 'number' },
        payee:    { type: 'string' },
        category: { type: 'string', description: 'Category name' },
        account:  { type: 'string', description: 'Account name' },
        date:     { type: 'string', description: 'YYYY-MM-DD' },
        note:     { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'set_transaction_paid',
    description:
      'Mark an entry paid or unpaid. Paid is what puts it into balances and totals; unpaid takes it back out and leaves it '
      + 'listed as owed. This is the gesture that turns a plan into a fact.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id:   { type: 'string', description: 'The entry id' },
        paid: { type: 'boolean', description: 'true to mark paid, false to mark unpaid' },
        on:   { type: 'string', description: 'YYYY-MM-DD the money moved (defaults to the entry date)' },
      },
      required: ['id', 'paid'],
    },
  },
  {
    name: 'delete_transaction',
    description:
      'Delete one entry. Only call this when the user has asked for that entry to be removed and it is clear which one. '
      + 'It can be taken back with undo, but it is still a deletion — never call it to tidy up on your own initiative.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id:      { type: 'string', description: 'The entry id' },
        confirm: { type: 'boolean', description: 'Must be true. Set it only when the user asked for this entry to be deleted.' },
      },
      required: ['id', 'confirm'],
    },
  },
  {
    name: 'add_goal',
    description: 'Add a savings goal. It joins the back of the queue; the plan says when it lands.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name:   { type: 'string', description: 'What it is for' },
        target: { type: 'number', description: 'The amount needed' },
        saved:  { type: 'number', description: 'Already put aside (default 0)' },
        by:     { type: 'string', description: 'YYYY-MM-DD it has to be there by' },
        icon:   { type: 'string', description: 'An emoji for it' },
      },
      required: ['name', 'target'],
    },
  },
  {
    name: 'update_goal',
    description: 'Change a goal: its target, what is saved, its deadline, or where it sits in the queue (rank 0 is funded first).',
    input_schema: {
      type: 'object' as const,
      properties: {
        goal:   { type: 'string', description: 'The goal name' },
        target: { type: 'number' },
        saved:  { type: 'number' },
        by:     { type: 'string', description: 'YYYY-MM-DD, or an empty string to remove the deadline' },
        rank:   { type: 'number', description: '0 is funded first' },
      },
      required: ['goal'],
    },
  },
  {
    name: 'set_exchange_rate',
    description:
      'Set what one unit of a currency is worth in the base currency. Entries in a currency with no rate are left out of '
      + 'every total, so this is the fix when a figure says a currency is not counted.',
    input_schema: {
      type: 'object' as const,
      properties: {
        currency: { type: 'string', description: 'e.g. USD' },
        rate:     { type: 'number', description: 'What one unit is worth in the base currency' },
      },
      required: ['currency', 'rate'],
    },
  },
]

export const FINANCE_TOOL_NAMES = new Set(FINANCE_TOOLS.map(t => t.name))

// ─── The executor ────────────────────────────────────────────────────────────

export async function executeFinanceTool(
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  if (shut()) return LOCKED

  const s = store()
  const { accounts, categories, transactions, goals } = s
  const base = baseCurrency()
  const today = todayISO()
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string).trim() : undefined)
  const num = (k: string) => (typeof input[k] === 'number' ? (input[k] as number) : undefined)
  const bool = (k: string) => (typeof input[k] === 'boolean' ? (input[k] as boolean) : undefined)

  switch (name) {

    // ── Reading ───────────────────────────────────────────────────────────────

    case 'finance_overview': {
      const { balances, pending, unconverted } = liveBalances(accounts, transactions)
      let cash = 0, owed = 0, assets = 0
      const rows = accounts.map(a => {
        const bal = balances.get(a.id) ?? a.balance
        const v = toBase(bal, a.currency, base)
        if (v !== null) {
          if (v < 0) owed += -v
          else if (a.accountType === 'payment' || a.accountType === 'wallet') cash += v
          else assets += v
        }
        return {
          name: a.name, kind: a.accountType, currency: a.currency,
          balance: money(bal),
          ...(pending.get(a.id) ? { waiting_on_unpaid: money(pending.get(a.id)!) } : {}),
          ...(unconverted.get(a.id)?.size ? { not_counted: [...unconverted.get(a.id)!] } : {}),
        }
      })

      const month = monthOf(today)
      const paid = settled(transactions).filter(t => monthOf(whenPaid(t)) === month)
      let inMonth = 0, outMonth = 0
      const perCat = new Map<string, number>()
      for (const t of paid) {
        const v = inBase(t.amount, t.currency)
        if (v === null) continue
        if (t.type === 'income') inMonth += v
        if (t.type === 'expense') {
          outMonth += v
          const k = catName(t.categoryId, categories)
          perCat.set(k, (perCat.get(k) ?? 0) + v)
        }
      }

      const owedRows = transactions.filter(isUnpaid)
      const owedTotal = owedRows.reduce((n, t) => n + (t.type === 'expense' ? (inBase(t.amount, t.currency) ?? 0) : 0), 0)

      const rules = loadRules()
      const over = Object.entries(rules)
        .filter(([id, r]) => activeIn(r, month) && monthlyAmount(r) > 0 && categories.some(c => c.id === id))
        .map(([id, r]) => {
          const cat = categories.find(c => c.id === id)!
          const kids = categories.filter(c => c.parentId === id).map(c => c.id)
          const spent = paid
            .filter(t => t.type === 'expense' && (t.categoryId === id || kids.includes(t.categoryId ?? '')))
            .reduce((n, t) => n + (inBase(t.amount, t.currency) ?? 0), 0)
          return { category: cat.name, budget: money(monthlyAmount(r)), spent: money(spent), left: money(monthlyAmount(r) - spent) }
        })
        .filter(e => e.left < 0)

      const capacity = capacityFrom(accounts, transactions, 1, today, goals)
      const plans = planGoals([...goals, ...debtGoals(accounts, transactions)], capacity)

      return {
        base_currency: base,
        year_loaded: s.currentYear,
        totals: { cash: money(cash), owed_on_cards: money(owed), assets: money(assets) },
        accounts: rows,
        this_month: {
          month,
          income: money(inMonth), spending: money(outMonth), net: money(inMonth - outMonth),
          biggest_categories: [...perCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
            .map(([c, v]) => ({ category: c, spent: money(v) })),
        },
        unpaid: { count: owedRows.length, owed: money(owedTotal) },
        envelopes_over_budget: over,
        a_normal_month: {
          income: money(capacity.monthlyIn), spending: money(capacity.monthlyOut),
          leaves_over: money(capacity.surplus), from_months: capacity.months,
        },
        spare_now: money(capacity.free),
        goals: plans.map(p => ({
          name: p.goal.name, still_to_find: money(p.remaining),
          lands: p.eta ?? 'not at this rate', on_time: p.onTime,
          is_a_card_to_clear: isDebtGoal(p.goal),
        })),
      }
    }

    case 'list_finance_accounts': {
      const { balances, pending, unconverted } = liveBalances(accounts, transactions)
      return accounts.map(a => ({
        name: a.name, bank: a.bank, kind: a.accountType, currency: a.currency,
        balance: money(balances.get(a.id) ?? a.balance),
        opening_balance: a.balance,
        ...(a.creditLimit ? { credit_limit: a.creditLimit } : {}),
        ...(pending.get(a.id) ? { waiting_on_unpaid: money(pending.get(a.id)!) } : {}),
        ...(unconverted.get(a.id)?.size ? { currencies_not_counted: [...unconverted.get(a.id)!] } : {}),
      }))
    }

    case 'list_transactions': {
      // What is owed is not a question about the past: most unpaid entries are
      // dated ahead, so asking for them alone widens to the whole year rather
      // than stopping at today and reporting nothing.
      const wholeYear = bool('unpaid_only') === true && !str('from') && !str('to')
      const from = str('from') ?? (wholeYear ? `${s.currentYear}-01-01` : today.slice(0, 8) + '01')
      const to   = str('to')   ?? (wholeYear ? `${s.currentYear}-12-31` : today)
      const wrong = await ensureYear(from, to)
      if (wrong) return { error: wrong }
      const cur = store()
      let rows = cur.transactions.filter(t => t.date >= from && t.date <= to)
      const cat = str('category')
      if (cat) {
        const r = pick('category', cur.categories, cat)
        if (isErr(r)) return r
        const kids = cur.categories.filter(c => c.parentId === r.hit.id).map(c => c.id)
        rows = rows.filter(t => t.categoryId === r.hit.id || kids.includes(t.categoryId ?? ''))
      }
      const acc = str('account')
      if (acc) {
        const r = pick('account', cur.accounts, acc)
        if (isErr(r)) return r
        rows = rows.filter(t => t.accountId === r.hit.id || t.toAccountId === r.hit.id)
      }
      const payee = str('payee')
      if (payee) rows = rows.filter(t => norm(t.payee).includes(norm(payee)))
      const type = str('type')
      if (type) rows = rows.filter(t => t.type === type)
      if (bool('unpaid_only')) rows = rows.filter(isUnpaid)
      const limit = Math.min(200, Math.max(1, num('limit') ?? 40))
      const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date))
      return {
        period: { from, to }, matched: rows.length, showing: Math.min(limit, rows.length),
        entries: sorted.slice(0, limit).map(t => txOut(t, cur.categories, cur.accounts)),
      }
    }

    case 'spending_by_category': {
      const from = str('from') ?? today.slice(0, 8) + '01'
      const to   = str('to') ?? today
      const wrong = await ensureYear(from, to)
      if (wrong) return { error: wrong }
      const cur = store()
      const wantIncome = bool('income') === true
      const kind: TxType = wantIncome ? 'income' : 'expense'
      // Filed by the day the money moved, like every other total in the app.
      const rows = settled(cur.transactions)
        .filter(t => t.type === kind && whenPaid(t) >= from && whenPaid(t) <= to)
      const per = new Map<string, number>()
      const missed = new Set<string>()
      for (const t of rows) {
        const v = inBase(t.amount, t.currency)
        if (v === null) { missed.add(t.currency); continue }
        const k = catName(t.categoryId, cur.categories)
        per.set(k, (per.get(k) ?? 0) + v)
      }
      const rules = loadRules()
      const total = [...per.values()].reduce((a, b) => a + b, 0)
      const months = Math.max(1, (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12
        + (Number(to.slice(5, 7)) - Number(from.slice(5, 7))) + 1)
      return {
        period: { from, to }, currency: base, kind, total: money(total),
        ...(missed.size ? { not_counted: [...missed], note: 'No exchange rate — use set_exchange_rate.' } : {}),
        categories: [...per.entries()].sort((a, b) => b[1] - a[1]).map(([nm, v]) => {
          const cat = cur.categories.find(c => c.name === nm)
          const rule = cat ? rules[cat.id] : undefined
          const budget = rule && monthlyAmount(rule) > 0 ? monthlyAmount(rule) * months : null
          return {
            category: nm, spent: money(v), share: `${Math.round((v / (total || 1)) * 100)}%`,
            ...(budget !== null ? { budget: money(budget), difference: money(budget - v) } : {}),
          }
        }),
      }
    }

    case 'list_budget_envelopes': {
      const month = str('month') ?? monthOf(today)
      const cur = store()
      const rules = loadRules()
      const paid = settled(cur.transactions).filter(t => monthOf(whenPaid(t)) === month && t.type === 'expense')
      const out = []
      for (const [id, rule] of Object.entries(rules)) {
        const cat = cur.categories.find(c => c.id === id)
        if (!cat || !activeIn(rule, month) || monthlyAmount(rule) <= 0) continue
        const kids = cur.categories.filter(c => c.parentId === id).map(c => c.id)
        const spent = paid.filter(t => t.categoryId === id || kids.includes(t.categoryId ?? ''))
          .reduce((n, t) => n + (inBase(t.amount, t.currency) ?? 0), 0)
        const budget = monthlyAmount(rule)
        out.push({
          category: cat.name, budget: money(budget), spent: money(spent), left: money(budget - spent),
          used: `${Math.round((spent / (budget || 1)) * 100)}%`,
          ...(rule.dueDay ? { due_day: rule.dueDay } : {}),
          currency: rule.currency ?? base,
        })
      }
      return { month, currency: base, envelopes: out.sort((a, b) => a.left - b.left) }
    }

    case 'list_goals': {
      const capacity = capacityFrom(accounts, transactions, 1, today, goals)
      const plans = planGoals([...goals, ...debtGoals(accounts, transactions)], capacity)
      return {
        currency: base,
        spare_now: money(capacity.free),
        a_normal_month_leaves: money(capacity.surplus),
        goals: plans.map((p, i) => ({
          rank: i + 1, name: p.goal.name,
          target: p.goal.targetAmount, saved: p.goal.currentAmount,
          still_to_find: money(p.remaining),
          from_spare_now: money(p.lump),
          each_month: money(p.monthly),
          ...(p.startsIn ? { starts_in_months: p.startsIn } : {}),
          lands: p.eta ?? 'not at this rate',
          deadline: p.goal.deadline ?? null,
          on_time: p.onTime,
          is_a_card_to_clear: isDebtGoal(p.goal),
        })),
      }
    }

    case 'find_duplicate_entries': {
      const found = findDuplicates(transactions)
      if (found.size === 0) return { duplicates: [], note: 'Nothing looks recorded twice.' }
      return {
        duplicates: transactions.filter(t => found.has(t.id))
          .map(t => ({ ...txOut(t, categories, accounts), same_thing: `twice in one ${found.get(t.id)}` })),
      }
    }

    // ── Writing ───────────────────────────────────────────────────────────────

    case 'add_transaction': {
      const amount = num('amount')
      if (!amount || amount <= 0) return { error: 'Give a positive amount; `type` says which way it goes.' }
      const type = (str('type') ?? 'expense') as TxType
      const acc = str('account')
        ? pick('account', accounts, str('account'))
        : accounts[0] ? { hit: accounts[0] } : { error: 'There are no accounts yet.' }
      if (isErr(acc)) return acc

      let toAccountId: string | undefined
      if (type === 'transfer') {
        const dest = pick('account', accounts, str('to_account'))
        if (isErr(dest)) return { error: `A transfer needs where it lands. ${dest.error}` }
        if (dest.hit.id === acc.hit.id) return { error: 'A transfer has to land somewhere other than where it came from.' }
        toAccountId = dest.hit.id
      }

      // A transfer moves money rather than spending it, so it carries no category.
      let categoryId: string | undefined
      if (type !== 'transfer') {
        const wanted = categories.filter(c => c.txType === 'both' || c.txType === (type === 'income' ? 'income' : 'expense'))
        const r = pick('category', wanted.length ? wanted : categories, str('category'))
        if (isErr(r)) return r
        categoryId = r.hit.id
      }

      const date = str('date') ?? today
      const paid = bool('paid') !== false
      const currency = (str('currency') ?? acc.hit.currency) as Currency
      const tx = {
        accountId: acc.hit.id,
        ...(toAccountId ? { toAccountId } : {}),
        amount, currency, type,
        payee: str('payee') ?? '',
        ...(categoryId ? { categoryId } : {}),
        date,
        ...(paid ? { paidAt: str('paid_on') ?? date } : {}),
        ...(str('note') ? { note: str('note') } : {}),
        isCleared: paid,
        isRecurring: false,
      }
      s.addTransaction(tx as Omit<Transaction, 'id' | 'createdAt'>)
      notify(`Recorded ${tx.payee || 'an entry'} — ${currency} ${amount}${paid ? '' : ', unpaid'}`)
      return {
        ok: true, recorded: { ...tx, category: categoryId ? catName(categoryId, categories) : null, account: acc.hit.name },
        note: paid ? 'It is in the balances.' : 'Unpaid — it is listed as owed and in no total until it is marked paid.',
      }
    }

    case 'update_transaction': {
      const tx = transactions.find(t => t.id === str('id'))
      if (!tx) return { error: 'No entry with that id in the year on screen. Use list_transactions first.' }
      const patch: Partial<Transaction> = {}
      if (num('amount') !== undefined) {
        if ((num('amount') as number) <= 0) return { error: 'The amount is a positive number; `type` carries the direction.' }
        patch.amount = num('amount')
      }
      if (str('payee') !== undefined) patch.payee = str('payee')
      if (str('date') !== undefined) patch.date = str('date')
      if (str('note') !== undefined) patch.note = str('note')
      if (str('category') !== undefined) {
        const r = pick('category', categories, str('category'))
        if (isErr(r)) return r
        patch.categoryId = r.hit.id
      }
      if (str('account') !== undefined) {
        const r = pick('account', accounts, str('account'))
        if (isErr(r)) return r
        patch.accountId = r.hit.id
      }
      if (Object.keys(patch).length === 0) return { error: 'Nothing to change.' }
      await s.upsertTransaction({ ...tx, ...patch })
      notify(`Changed ${tx.payee || 'an entry'}`)
      return { ok: true, entry: txOut({ ...tx, ...patch }, categories, accounts) }
    }

    case 'set_transaction_paid': {
      const tx = transactions.find(t => t.id === str('id'))
      if (!tx) return { error: 'No entry with that id in the year on screen. Use list_transactions first.' }
      const paid = bool('paid')
      if (paid === undefined) return { error: 'Say whether it is paid.' }
      // Unpaid means no payment date at all — that is what every screen reads.
      const next: Transaction = paid
        ? { ...tx, paidAt: str('on') ?? tx.date, isCleared: true }
        : { ...tx, paidAt: undefined, isCleared: false }
      await s.upsertTransaction(next)
      notify(`${tx.payee || 'An entry'} marked ${paid ? 'paid' : 'unpaid'}`)
      return { ok: true, entry: txOut(next, categories, accounts) }
    }

    case 'delete_transaction': {
      if (bool('confirm') !== true) {
        return { error: 'Deleting an entry needs confirm: true, and only when the user has asked for that entry to go.' }
      }
      const tx = transactions.find(t => t.id === str('id'))
      if (!tx) return { error: 'No entry with that id in the year on screen.' }
      await s.removeTransaction(tx.id)
      notify(`Deleted ${tx.payee || 'an entry'}`)
      return { ok: true, deleted: txOut(tx, categories, accounts), note: 'It can be put back with undo.' }
    }

    case 'add_goal': {
      const target = num('target')
      if (!target || target <= 0) return { error: 'A goal needs a target above zero.' }
      const g: Goal = {
        id: crypto.randomUUID(),
        name: str('name') ?? 'A goal',
        icon: str('icon') || '🎯',
        targetAmount: target,
        currentAmount: num('saved') ?? 0,
        color: 'var(--sb-accent)',
        sub: str('by') ? `by ${str('by')}` : 'no deadline',
        rank: goals.length,
        ...(str('by') ? { deadline: str('by') } : {}),
        currency: base as Currency,
      }
      await s.upsertGoal(g)
      notify(`Added the goal "${g.name}"`)
      const capacity = capacityFrom(accounts, transactions, 1, today, [...goals, g])
      const plan = planGoals([...goals, g], capacity).find(p => p.goal.id === g.id)
      return { ok: true, goal: g.name, lands: plan?.eta ?? 'not at this rate', each_month: money(plan?.monthly ?? 0) }
    }

    case 'update_goal': {
      const r = pick('goal', goals, str('goal'))
      if (isErr(r)) return r
      const next: Goal = { ...r.hit }
      if (num('target') !== undefined) next.targetAmount = num('target') as number
      if (num('saved')  !== undefined) next.currentAmount = num('saved') as number
      if (num('rank')   !== undefined) next.rank = num('rank') as number
      if (str('by') !== undefined) {
        next.deadline = str('by') || undefined
        next.sub = str('by') ? `by ${str('by')}` : 'no deadline'
      }
      await s.upsertGoal(next)
      notify(`Changed the goal "${next.name}"`)
      const capacity = capacityFrom(accounts, transactions, 1, today, goals.map(g => g.id === next.id ? next : g))
      const plan = planGoals(goals.map(g => g.id === next.id ? next : g), capacity).find(p => p.goal.id === next.id)
      return { ok: true, goal: next.name, still_to_find: money(plan?.remaining ?? 0), lands: plan?.eta ?? 'not at this rate' }
    }

    case 'set_exchange_rate': {
      const cur = (str('currency') ?? '').toUpperCase()
      const rate = num('rate')
      if (!cur) return { error: 'Which currency?' }
      if (!rate || rate <= 0) return { error: 'A rate is what one unit is worth in the base currency, above zero.' }
      if (cur === base.toUpperCase()) return { error: `${base} is the base currency — it is always worth one of itself.` }
      setRate(cur, rate)
      notify(`1 ${cur} = ${rate} ${base}`)
      return { ok: true, rates: loadRates(), base, note: `Totals now count ${cur}.` }
    }

    default:
      return { error: `Unknown finance tool: ${name}` }
  }
}

/** Whether a currency can be counted at all — used by the panel's opening line. */
export function currencyCounted(cur: string): boolean {
  return rateFor(cur) !== null
}

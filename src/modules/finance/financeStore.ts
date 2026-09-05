import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { supabase } from '@/lib/supabase'
import type { Account, Category, Transaction, Bill, Goal, Budget } from './types'
import { rememberLimit, withLocalLimits } from './creditLimits'
import { rememberTarget, forgetTarget, withLocalTargets } from './transferTargets'
import { setPaidAtSupported } from './unpaid'
import {
  loadAccounts, saveAccount, deleteAccount as dbDeleteAccount,
  loadCategories, saveCategory, deleteCategory as dbDeleteCategory,
  loadTransactions, loadUnpaidTransactions, saveTransaction, saveTransactionsBulk,
  deleteTransaction as dbDeleteTransaction,
  loadPlans, savePlan,
  loadActualsOverride, saveActualOverride, deleteActualOverride,
  loadCellComments, saveCellComment, deleteCellComment,
  loadBills, saveBill, deleteBill as dbDeleteBill,
  loadGoals, saveGoal, deleteGoal as dbDeleteGoal,
  loadBudgets, saveBudget, deleteBudget as dbDeleteBudget,
  type PlanRow, type OverrideRow, type CommentRow,
  type BillRow, type GoalRow, type BudgetRow,
} from './financeDb'

type FinanceScreen = 'today' | 'balance' | 'budget' | 'bills' | 'reports' | 'reflect'

interface FinanceState {
  screen: FinanceScreen
  currentYear: number
  accounts: Account[]
  categories: Category[]
  transactions: Transaction[]
  bills: Bill[]
  goals: Goal[]
  budgets: Budget[]
  plans: PlanRow[]
  overrides: OverrideRow[]
  comments: CommentRow[]
  loading: boolean

  setScreen: (s: FinanceScreen) => void
  /** Which year the loaded transactions, plans and budget cells belong to.
   *  Changing it reloads them — nothing else does. */
  setYear: (year: number) => Promise<void>
  loadFromDB: () => Promise<void>

  // Accounts CRUD
  upsertAccount: (a: Account) => Promise<void>
  removeAccount: (id: string) => Promise<void>

  // Categories CRUD
  upsertCategory: (c: Category) => Promise<void>
  removeCategory: (id: string) => Promise<void>

  // Transactions CRUD
  upsertTransaction: (tx: Transaction) => Promise<void>
  /** A whole batch, written in one go. */
  upsertTransactions: (txs: Transaction[]) => Promise<void>
  removeTransaction: (id: string) => Promise<void>
  /** Move to the year these entries were filed in, if it is not the one on
   *  screen — otherwise a saved entry is on no screen at all. */
  followYearOf: (txs: Transaction[]) => Promise<void>
  /** Give every entry with no payment date its own due date as the day it was
   *  paid, in every year, and say how many that was. Asked for, never
   *  automatic. */
  markAllPaidOnDueDate: () => Promise<number>

  // Bills CRUD
  upsertBill: (b: Bill) => Promise<void>
  removeBill: (id: string) => Promise<void>

  // Goals CRUD
  upsertGoal: (g: Goal) => Promise<void>
  removeGoal: (id: string) => Promise<void>

  // Budgets CRUD
  upsertBudget: (b: Budget) => Promise<void>
  removeBudget: (id: string) => Promise<void>

  // Plans
  setPlan: (categoryId: string, year: number, month: number, amount: number) => Promise<void>

  // Overrides
  setOverride: (categoryId: string, year: number, month: number, amount: number) => Promise<void>
  clearOverride: (categoryId: string, year: number, month: number) => Promise<void>

  // Comments
  setComment: (categoryId: string, year: number, month: number, comment: string) => Promise<void>
  clearComment: (categoryId: string, year: number, month: number) => Promise<void>

  // Legacy — kept for backward compatibility
  addTransaction: (tx: Omit<Transaction, 'id' | 'createdAt'>) => void
}

const txToRow = (tx: Transaction, userId: string) => ({
  id: tx.id,
  user_id: userId,
  account_id: tx.accountId,
  to_account_id: tx.toAccountId ?? null,
  category_id: tx.categoryId,
  amount: tx.amount,
  currency: tx.currency,
  tx_type: tx.type,
  payee: tx.payee,
  date: tx.date,
  paid_at: tx.paidAt ?? null,
  note: tx.note,
  is_cleared: tx.isCleared,
  is_recurring: tx.isRecurring,
  tags: tx.tags ?? [],
  attachments: tx.attachments ?? [],
  created_at: tx.createdAt,
})

const billToRow = (b: Bill, userId: string): BillRow => ({
  id: b.id, user_id: userId, name: b.name, amount: b.amount,
  currency: b.currency, category_id: b.categoryId ?? null,
  account_id: b.accountId ?? null, frequency: b.frequency,
  next_due: b.nextDue, is_active: b.isActive, is_income: b.isIncome, icon: b.icon,
})

const goalToRow = (g: Goal, userId: string): GoalRow => ({
  id: g.id, user_id: userId, name: g.name, icon: g.icon,
  target_amount: g.targetAmount, current_amount: g.currentAmount,
  color: g.color, sub_label: g.sub || null, is_active: true,
})

const budgetToRow = (b: Budget, userId: string): BudgetRow => ({
  id: b.id, user_id: userId, category_id: b.categoryId,
  monthly_amount: b.monthlyAmount, currency: b.currency,
  start_date: b.startDate, end_date: b.endDate ?? null, rollover: b.rollover,
})

/** Bills and goals were local-only for as long as they have existed, so the
 *  first load after they became real finds empty tables and a device full of
 *  them. Reading that as "you have none" would delete the lot. Until the local
 *  set is known to be on the server, an empty table means "not yet", not
 *  "gone".
 *
 *  Set only on proof: a read that came back with rows, or a push that every
 *  row survived. Setting it when the push was merely *started* is not the same
 *  thing — sign-in loads twice in quick succession, and the second load would
 *  find the table still empty, believe it, and delete everything the first was
 *  in the middle of uploading. */
const SEEDED_KEY = 'professor-finance-seeded'

function markSeeded(): void {
  try { localStorage.setItem(SEEDED_KEY, '1') } catch { /* quota */ }
}

const billFromRow = (r: BillRow): Bill => ({
  id: r.id, name: r.name, amount: r.amount,
  currency: r.currency as Bill['currency'],
  categoryId: r.category_id ?? undefined,
  accountId:  r.account_id ?? undefined,
  frequency: r.frequency as Bill['frequency'],
  nextDue: r.next_due, isActive: r.is_active, icon: r.icon, isIncome: r.is_income,
})

const goalFromRow = (r: GoalRow): Goal => ({
  id: r.id, name: r.name, icon: r.icon,
  targetAmount: r.target_amount, currentAmount: r.current_amount,
  color: r.color, sub: r.sub_label ?? '',
})

const budgetFromRow = (r: BudgetRow): Budget => ({
  id: r.id, categoryId: r.category_id, monthlyAmount: r.monthly_amount,
  currency: r.currency as Budget['currency'],
  startDate: r.start_date, endDate: r.end_date ?? undefined, rollover: r.rollover,
})

async function getUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ?? null
}

export const useFinanceStore = create<FinanceState>()(
  persist(
    (set, get) => ({
      screen: 'today',
      currentYear: new Date().getFullYear(),
      accounts: [],
      categories: [],
      transactions: [],
      bills: [],
      goals: [],
      budgets: [],
      plans: [],
      overrides: [],
      comments: [],
      loading: false,

      setScreen: (screen) => set({ screen }),

      setYear: async (year) => {
        if (get().currentYear === year) return
        set({ currentYear: year })
        await get().loadFromDB()
      },

      loadFromDB: async () => {
        set({ loading: true })
        try {
          const year = get().currentYear
          const [accounts, categories, transactions, plans, overrides, comments,
                 bills, goals, budgets] = await Promise.all([
            loadAccounts().catch(() => [] as Awaited<ReturnType<typeof loadAccounts>>),
            loadCategories().catch(() => [] as Awaited<ReturnType<typeof loadCategories>>),
            loadTransactions(year).catch(() => [] as Awaited<ReturnType<typeof loadTransactions>>),
            loadPlans(year).catch(() => [] as Awaited<ReturnType<typeof loadPlans>>),
            loadActualsOverride(year).catch(() => [] as Awaited<ReturnType<typeof loadActualsOverride>>),
            loadCellComments(year).catch(() => [] as Awaited<ReturnType<typeof loadCellComments>>),
            // null from any of these means the read failed — finance_budgets
            // does not exist until 20260005 runs — and the store keeps what
            // this device has rather than reading it as "you have none".
            loadBills().catch(() => null),
            loadGoals().catch(() => null),
            loadBudgets().catch(() => null),
          ])

          // Map DB rows to app Account type
          const mappedAccounts: Account[] = accounts.map(r => ({
            id: r.id,
            name: r.name,
            bank: r.bank,
            accountType: r.account_type as Account['accountType'],
            currency: r.currency as Account['currency'],
            balance: r.balance,
            creditLimit: r.credit_limit ?? undefined,
            last4: r.last4,
            emoji: r.emoji,
            color: r.color,
            sortOrder: r.sort_order,
          }))

          // Map DB rows to app Category type
          const mappedCategories: Category[] = categories.map(r => ({
            id: r.id,
            name: r.name,
            icon: r.icon,
            color: r.color,
            parentId: r.parent_id,
            isSystem: r.is_system,
            txType: r.tx_type as Category['txType'],
            // Never read, so every category arrived without an order and the
            // screens fell back to whatever the query happened to return.
            sortOrder: r.sort_order,
          }))

          // Map DB rows to app Transaction type
          // An entry records something that happened on a day. Before the two
          // dates existed only "Paid" set a payment date, so everything logged
          // before that has none — and the paid view of the Financials could
          // not place any of it. Anything dated today or earlier is given its
          // own date as the day the money moved; anything dated ahead is left
          // alone, because that money genuinely has not moved yet.
          const mappedTransactions: Transaction[] = transactions.map(r => ({
            id: r.id,
            accountId: r.account_id,
            toAccountId: r.to_account_id ?? undefined,
            amount: r.amount,
            currency: r.currency as Transaction['currency'],
            type: r.tx_type as Transaction['type'],
            payee: r.payee,
            categoryId: r.category_id,
            date: r.date,
            paidAt: r.paid_at ?? undefined,
            note: r.note,
            isCleared: r.is_cleared,
            isRecurring: r.is_recurring,
            tags: r.tags?.length ? r.tags : undefined,
            attachments: r.attachments?.length ? r.attachments : undefined,
            createdAt: r.created_at,
          }))

          // A transfer whose destination the server could not store keeps it
          // from here, or it lands nowhere and the card stops moving.
          const withTargets = withLocalTargets(mappedTransactions)
          mappedTransactions.length = 0
          mappedTransactions.push(...withTargets)

          // Whether the server can hold a payment date at all. A row that came
          // back without the key means the column is not there yet, and no
          // entry can be said to be unpaid until it is.
          setPaidAtSupported(transactions.length === 0 || transactions.some(r => 'paid_at' in r))

          // Nothing is stamped paid on the way in any more.
          //
          // There used to be a repair here for entries logged before there
          // were two dates: anything dated today or earlier with no payment
          // date was given its own date. It has done its job — that data has
          // been through it — and now that "not paid" is something a person
          // says on purpose, the repair reads deliberate intent as missing
          // data and undoes it.
          //
          // Scoping it to devices that had not run it was not enough: the flag
          // is per-browser and the rows are shared, so a second device, or one
          // whose storage was cleared, would stamp an entry someone had just
          // marked unpaid and push that back over everybody. An entry with no
          // payment date is now simply one nobody has paid.

          const prev   = get()
          const seeded = (() => {
            try { return localStorage.getItem(SEEDED_KEY) === '1' } catch { return false }
          })()
          const userId = await getUserId()

          // Keep what this device has and send it up, rather than letting an
          // empty table erase it. Only once, and only where the server really
          // has nothing — after that an empty table means deleted elsewhere.
          function adopt<T extends { id: string }, R>(
            fromServer: R[] | null, toApp: (r: R) => T, local: T[], push: (t: T) => Promise<void>,
          ): T[] {
            if (fromServer === null) return local          // could not read it
            if (fromServer.length) { markSeeded(); return fromServer.map(toApp) }
            if (seeded || !local.length) return []         // genuinely empty
            if (userId) {
              void Promise.allSettled(local.map(push)).then(rs => {
                if (rs.every(r => r.status === 'fulfilled')) markSeeded()
              })
            }
            return local
          }

          set({
            accounts: withLocalLimits(mappedAccounts),
            categories: mappedCategories,
            transactions: mappedTransactions,
            plans,
            overrides,
            comments,
            bills:   adopt(bills,   billFromRow,   prev.bills,
                           b => saveBill(billToRow(b, userId!))),
            goals:   adopt(goals,   goalFromRow,   prev.goals,
                           g => saveGoal(goalToRow(g, userId!))),
            // finance_budgets only exists from 20260005. Until the migration
            // runs, loadBudgets returns empty for a reason that is not "you
            // have no budgets", so nothing is ever dropped here.
            budgets: adopt(budgets, budgetFromRow, prev.budgets,
                           b => saveBudget(budgetToRow(b, userId!))),
          })

        } catch {
          // offline — keep local state
        } finally {
          set({ loading: false })
        }
      },

      // ─── Accounts CRUD ──────────────────────────────────────────────────────

      upsertAccount: async (a: Account) => {
        // Held here as well, so a limit is not lost on the next load when the
        // column it belongs in does not exist yet.
        rememberLimit(a.id, a.creditLimit)
        // Optimistic update
        set(s => ({
          accounts: s.accounts.some(x => x.id === a.id)
            ? s.accounts.map(x => x.id === a.id ? a : x)
            : [...s.accounts, a],
        }))
        const userId = await getUserId()
        if (!userId) return
        const row = {
          id: a.id,
          user_id: userId,
          name: a.name,
          bank: a.bank,
          account_type: a.accountType,
          currency: a.currency,
          balance: a.balance,
          credit_limit: a.creditLimit ?? null,
          last4: a.last4,
          emoji: a.emoji,
          color: a.color,
          sort_order: a.sortOrder,
          is_active: true,
          created_at: new Date().toISOString(),
        }
        saveAccount(row).catch(console.warn)
      },

      removeAccount: async (id: string) => {
        set(s => ({ accounts: s.accounts.filter(x => x.id !== id) }))
        dbDeleteAccount(id).catch(console.warn)
      },

      // ─── Categories CRUD ─────────────────────────────────────────────────────

      upsertCategory: async (c: Category) => {
        set(s => ({
          categories: s.categories.some(x => x.id === c.id)
            ? s.categories.map(x => x.id === c.id ? c : x)
            : [...s.categories, c],
        }))
        const userId = await getUserId()
        if (!userId) return
        const row = {
          id: c.id,
          user_id: userId,
          name: c.name,
          icon: c.icon,
          color: c.color,
          parent_id: c.parentId,
          tx_type: c.txType,
          // Hardcoded to 0, so every edit to a category quietly flattened the
          // order of all of them — renaming one was enough to reshuffle a list.
          sort_order: c.sortOrder ?? 0,
          is_system: c.isSystem,
          created_at: new Date().toISOString(),
        }
        saveCategory(row).catch(console.warn)
      },

      removeCategory: async (id: string) => {
        set(s => ({ categories: s.categories.filter(x => x.id !== id) }))
        dbDeleteCategory(id).catch(console.warn)
      },

      // ─── Transactions CRUD ───────────────────────────────────────────────────

      upsertTransaction: async (tx: Transaction) => {
        // Held here as well, so a transfer is not left landing nowhere on the
        // next load when the column it belongs in does not exist yet.
        rememberTarget(tx.id, tx.type === 'transfer' ? tx.toAccountId : undefined)
        set(s => ({
          transactions: s.transactions.some(x => x.id === tx.id)
            ? s.transactions.map(x => x.id === tx.id ? tx : x)
            : [tx, ...s.transactions],
        }))
        const userId = await getUserId()
        if (!userId) return
        await saveTransaction(txToRow(tx, userId)).catch(console.warn)
        await get().followYearOf([tx])
      },

      /** A batch of entries in one write.
       *
       *  Sent one at a time, a batch is a queue of separate round trips, and
       *  any load that lands in the middle of it — the 45s poll, a year
       *  change, coming back to the tab — replaces the list with what the
       *  server has *so far*, dropping every row still in flight. One request
       *  cannot be caught half-written. */
      upsertTransactions: async (txs: Transaction[]) => {
        if (txs.length === 0) return
        for (const tx of txs) rememberTarget(tx.id, tx.type === 'transfer' ? tx.toAccountId : undefined)
        const ids = new Set(txs.map(t => t.id))
        set(s => ({
          transactions: [...txs, ...s.transactions.filter(x => !ids.has(x.id))],
        }))
        const userId = await getUserId()
        if (!userId) return
        await saveTransactionsBulk(txs.map(tx => txToRow(tx, userId))).catch(console.warn)
        await get().followYearOf(txs)
      },

      /** The repair that used to happen on every load, as something a person
       *  asks for.
       *
       *  Entries logged before there were two dates have no payment date and
       *  now read as unpaid, which for that data is not what anybody meant.
       *  This gives every one of them its due date back — in every year, not
       *  just the loaded one, because a repair you have to remember to run
       *  again for 2025 is one that will be half done. */
      markAllPaidOnDueDate: async () => {
        const userId = await getUserId()
        if (!userId) return 0
        const rows = await loadUnpaidTransactions().catch(() => [] as Awaited<ReturnType<typeof loadUnpaidTransactions>>)
        if (rows.length === 0) return 0
        await saveTransactionsBulk(rows.map(r => ({ ...r, paid_at: r.date, is_cleared: true })))
        // The loaded year is a copy of some of what just changed; read it back
        // rather than trying to patch it in two places.
        await get().loadFromDB()
        return rows.length
      },

      /** Go to the year an entry was filed in, when it is not the year on
       *  screen.
       *
       *  Everything here is fetched a year at a time, and a load keeps only
       *  what it fetched — so an entry dated outside the current year is
       *  saved, is in the database, and is on no screen in the app. Nothing
       *  said so: the panel closed and the table did not move, which reads
       *  exactly like the entry was thrown away. Called after the write, so
       *  the reload the year change triggers finds the rows already there. */
      followYearOf: async (txs: Transaction[]) => {
        const years = [...new Set(txs.map(t => Number(t.date.slice(0, 4))))]
          .filter(y => Number.isFinite(y) && y > 1970)
        if (years.length !== 1 || years[0] === get().currentYear) return
        await get().setYear(years[0])
      },

      removeTransaction: async (id: string) => {
        forgetTarget(id)
        set(s => ({ transactions: s.transactions.filter(x => x.id !== id) }))
        dbDeleteTransaction(id).catch(console.warn)
      },

      // ─── Bills CRUD ─────────────────────────────────────────────────────────

      upsertBill: async (b: Bill) => {
        set(s => ({
          bills: s.bills.some(x => x.id === b.id)
            ? s.bills.map(x => x.id === b.id ? b : x)
            : [...s.bills, b],
        }))
        const userId = await getUserId()
        if (!userId) return
        saveBill(billToRow(b, userId)).catch(console.warn)
      },

      removeBill: async (id: string) => {
        set(s => ({ bills: s.bills.filter(x => x.id !== id) }))
        dbDeleteBill(id).catch(console.warn)
      },

      // ─── Goals CRUD ─────────────────────────────────────────────────────────

      upsertGoal: async (g) => {
        set(s => ({
          goals: s.goals.some(x => x.id === g.id)
            ? s.goals.map(x => x.id === g.id ? g : x)
            : [...s.goals, g],
        }))
        const userId = await getUserId()
        if (!userId) return
        saveGoal(goalToRow(g, userId)).catch(console.warn)
      },

      removeGoal: async (id) => {
        set(s => ({ goals: s.goals.filter(x => x.id !== id) }))
        dbDeleteGoal(id).catch(console.warn)
      },

      // ─── Budgets CRUD ───────────────────────────────────────────────────────

      upsertBudget: async (b) => {
        set(s => ({
          budgets: s.budgets.some(x => x.id === b.id)
            ? s.budgets.map(x => x.id === b.id ? b : x)
            : [...s.budgets, b],
        }))
        const userId = await getUserId()
        if (!userId) return
        saveBudget(budgetToRow(b, userId)).catch(console.warn)
      },

      removeBudget: async (id) => {
        set(s => ({ budgets: s.budgets.filter(x => x.id !== id) }))
        dbDeleteBudget(id).catch(console.warn)
      },

      // ─── Plans ──────────────────────────────────────────────────────────────

      setPlan: async (categoryId, year, month, amount) => {
        set(s => {
          const existing = s.plans.find(
            p => p.category_id === categoryId && p.year === year && p.month === month,
          )
          if (existing) {
            return {
              plans: s.plans.map(p =>
                p.category_id === categoryId && p.year === year && p.month === month
                  ? { ...p, planned_amount: amount }
                  : p,
              ),
            }
          }
          return {
            plans: [...s.plans, {
              id: crypto.randomUUID(),
              user_id: '',
              category_id: categoryId,
              year,
              month,
              planned_amount: amount,
            }],
          }
        })
        savePlan(categoryId, year, month, amount).catch(console.warn)
      },

      // ─── Overrides ──────────────────────────────────────────────────────────

      setOverride: async (categoryId, year, month, amount) => {
        set(s => {
          const existing = s.overrides.find(
            o => o.category_id === categoryId && o.year === year && o.month === month,
          )
          if (existing) {
            return {
              overrides: s.overrides.map(o =>
                o.category_id === categoryId && o.year === year && o.month === month
                  ? { ...o, override_amount: amount }
                  : o,
              ),
            }
          }
          return {
            overrides: [...s.overrides, {
              id: crypto.randomUUID(),
              user_id: '',
              category_id: categoryId,
              year,
              month,
              override_amount: amount,
            }],
          }
        })
        saveActualOverride(categoryId, year, month, amount).catch(console.warn)
      },

      clearOverride: async (categoryId, year, month) => {
        set(s => ({
          overrides: s.overrides.filter(
            o => !(o.category_id === categoryId && o.year === year && o.month === month),
          ),
        }))
        deleteActualOverride(categoryId, year, month).catch(console.warn)
      },

      // ─── Comments ───────────────────────────────────────────────────────────

      setComment: async (categoryId, year, month, comment) => {
        set(s => {
          const existing = s.comments.find(
            c => c.category_id === categoryId && c.year === year && c.month === month,
          )
          if (existing) {
            return {
              comments: s.comments.map(c =>
                c.category_id === categoryId && c.year === year && c.month === month
                  ? { ...c, comment }
                  : c,
              ),
            }
          }
          return {
            comments: [...s.comments, {
              id: crypto.randomUUID(),
              user_id: '',
              category_id: categoryId,
              year,
              month,
              comment,
            }],
          }
        })
        saveCellComment(categoryId, year, month, comment).catch(console.warn)
      },

      clearComment: async (categoryId, year, month) => {
        set(s => ({
          comments: s.comments.filter(
            c => !(c.category_id === categoryId && c.year === year && c.month === month),
          ),
        }))
        deleteCellComment(categoryId, year, month).catch(console.warn)
      },

      // ─── Legacy ─────────────────────────────────────────────────────────────

      addTransaction: (tx) => set((s) => ({
        transactions: [{
          ...tx,
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
        }, ...s.transactions],
      })),
    }),
    {
      name: 'professor-finance-v2',
      // currentYear was persisted along with everything else, and nothing ever
      // set it — so a store first created in one year kept asking the server
      // for that year forever, and this year's transactions, plans and budget
      // cells simply never loaded. It belongs to the session, not the record.
      partialize: ({ currentYear: _y, loading: _l, ...rest }) => rest,
      // partialize only governs what gets written. Every device already has a
      // stored blob carrying the stale year, and it would win on the next read
      // — so drop it on the way in as well.
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<FinanceState>),
        currentYear: current.currentYear,
        loading: false,
      }),
    },
  ),
)

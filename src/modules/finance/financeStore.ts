import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { supabase } from '@/lib/supabase'
import type { Account, Category, Transaction, Bill, Goal, Budget } from './types'
import {
  loadAccounts, saveAccount, deleteAccount as dbDeleteAccount,
  loadCategories, saveCategory, deleteCategory as dbDeleteCategory,
  loadTransactions, saveTransaction, deleteTransaction as dbDeleteTransaction,
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
  removeTransaction: (id: string) => Promise<void>

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
          }))

          // Map DB rows to app Transaction type
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
            accounts: mappedAccounts,
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
          sort_order: 0,
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
        set(s => ({
          transactions: s.transactions.some(x => x.id === tx.id)
            ? s.transactions.map(x => x.id === tx.id ? tx : x)
            : [tx, ...s.transactions],
        }))
        const userId = await getUserId()
        if (!userId) return
        const row = {
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
        }
        saveTransaction(row).catch(console.warn)
      },

      removeTransaction: async (id: string) => {
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

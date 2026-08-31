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
  type PlanRow, type OverrideRow, type CommentRow,
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
  upsertBill: (b: Bill) => void
  removeBill: (id: string) => void

  // Goals CRUD
  upsertGoal: (g: Goal) => void
  removeGoal: (id: string) => void

  // Budgets CRUD
  upsertBudget: (b: Budget) => void
  removeBudget: (id: string) => void

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

      loadFromDB: async () => {
        set({ loading: true })
        try {
          const year = get().currentYear
          const [accounts, categories, transactions, plans, overrides, comments] = await Promise.all([
            loadAccounts().catch(() => [] as Awaited<ReturnType<typeof loadAccounts>>),
            loadCategories().catch(() => [] as Awaited<ReturnType<typeof loadCategories>>),
            loadTransactions(year).catch(() => [] as Awaited<ReturnType<typeof loadTransactions>>),
            loadPlans(year).catch(() => [] as Awaited<ReturnType<typeof loadPlans>>),
            loadActualsOverride(year).catch(() => [] as Awaited<ReturnType<typeof loadActualsOverride>>),
            loadCellComments(year).catch(() => [] as Awaited<ReturnType<typeof loadCellComments>>),
          ])

          // Map DB rows to app Account type
          const mappedAccounts: Account[] = accounts.map(r => ({
            id: r.id,
            name: r.name,
            bank: r.bank,
            accountType: r.account_type as Account['accountType'],
            currency: r.currency as Account['currency'],
            balance: r.balance,
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
            amount: r.amount,
            currency: r.currency as Transaction['currency'],
            type: r.tx_type as Transaction['type'],
            payee: r.payee,
            categoryId: r.category_id,
            date: r.date,
            note: r.note,
            isCleared: r.is_cleared,
            isRecurring: r.is_recurring,
            createdAt: r.created_at,
          }))

          set({
            accounts: mappedAccounts,
            categories: mappedCategories,
            transactions: mappedTransactions,
            plans,
            overrides,
            comments,
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
          category_id: tx.categoryId,
          amount: tx.amount,
          currency: tx.currency,
          tx_type: tx.type,
          payee: tx.payee,
          date: tx.date,
          note: tx.note,
          is_cleared: tx.isCleared,
          is_recurring: tx.isRecurring,
          created_at: tx.createdAt,
        }
        saveTransaction(row).catch(console.warn)
      },

      removeTransaction: async (id: string) => {
        set(s => ({ transactions: s.transactions.filter(x => x.id !== id) }))
        dbDeleteTransaction(id).catch(console.warn)
      },

      // ─── Bills CRUD ─────────────────────────────────────────────────────────

      upsertBill: (b: Bill) => set(s => ({
        bills: s.bills.some(x => x.id === b.id)
          ? s.bills.map(x => x.id === b.id ? b : x)
          : [...s.bills, b],
      })),

      removeBill: (id: string) => set(s => ({ bills: s.bills.filter(x => x.id !== id) })),

      // ─── Goals CRUD ─────────────────────────────────────────────────────────

      upsertGoal: (g) => set(s => ({
        goals: s.goals.some(x => x.id === g.id)
          ? s.goals.map(x => x.id === g.id ? g : x)
          : [...s.goals, g],
      })),
      removeGoal: (id) => set(s => ({ goals: s.goals.filter(x => x.id !== id) })),

      // ─── Budgets CRUD ───────────────────────────────────────────────────────

      upsertBudget: (b) => set(s => ({
        budgets: s.budgets.some(x => x.id === b.id)
          ? s.budgets.map(x => x.id === b.id ? b : x)
          : [...s.budgets, b],
      })),
      removeBudget: (id) => set(s => ({ budgets: s.budgets.filter(x => x.id !== id) })),

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
    { name: 'professor-finance-v2' },
  ),
)

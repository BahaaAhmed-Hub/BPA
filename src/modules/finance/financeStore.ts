import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Account, Transaction, Bill, Goal } from './types'
import { MOCK_ACCOUNTS, MOCK_TRANSACTIONS, MOCK_BILLS, MOCK_GOALS } from './mockData'

type FinanceScreen = 'today' | 'balance' | 'budget' | 'bills' | 'reports' | 'reflect'

interface FinanceState {
  screen: FinanceScreen
  accounts: Account[]
  transactions: Transaction[]
  bills: Bill[]
  goals: Goal[]
  setScreen: (s: FinanceScreen) => void
  addTransaction: (tx: Omit<Transaction, 'id' | 'createdAt'>) => void
}

export const useFinanceStore = create<FinanceState>()(
  persist(
    (set) => ({
      screen: 'today',
      accounts: MOCK_ACCOUNTS,
      transactions: MOCK_TRANSACTIONS,
      bills: MOCK_BILLS,
      goals: MOCK_GOALS,
      setScreen: (screen) => set({ screen }),
      addTransaction: (tx) => set((s) => ({
        transactions: [{
          ...tx,
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
        }, ...s.transactions],
      })),
    }),
    { name: 'professor-finance' },
  ),
)

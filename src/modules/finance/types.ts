export type TxType = 'expense' | 'income' | 'transfer' | 'asset_purchase' | 'asset_sale' | 'liability_acq' | 'liability_dis'
export type Currency = 'EGP' | 'USD' | 'AED'
export type AccountType = 'payment' | 'credit_card' | 'asset' | 'wallet'
export type BillFrequency = 'monthly' | 'weekly' | 'yearly' | 'quarterly'

export interface Account {
  id: string
  name: string
  bank: string
  accountType: AccountType
  currency: Currency
  balance: number
  last4?: string
  emoji: string
  color: string
  sortOrder: number
}

export interface Category {
  id: string
  name: string
  icon: string
  color: string
  parentId?: string
  isSystem: boolean
  sortOrder?: number
  txType: 'expense' | 'income' | 'both'
}

export interface Transaction {
  id: string
  accountId: string
  /** Where a transfer lands. A transfer without one is money leaving and
   *  arriving nowhere, which is what paying a credit card used to look like. */
  toAccountId?: string
  amount: number
  currency: Currency
  type: TxType
  payee: string
  categoryId?: string
  /** When the money is owed. */
  date: string
  /** When it actually left, which is not always the same day. */
  paidAt?: string
  note?: string
  attachments?: string[]
  tags?: string[]
  isCleared: boolean
  isRecurring: boolean
  createdAt: string
}

export interface Budget {
  id: string
  categoryId: string
  monthlyAmount: number
  currency: Currency
  startDate: string   // 'YYYY-MM'
  endDate?: string    // 'YYYY-MM', undefined = never
  rollover: boolean
}

export interface Bill {
  id: string
  name: string
  amount: number
  currency: Currency
  categoryId?: string
  accountId?: string
  frequency: BillFrequency
  nextDue: string
  isActive: boolean
  icon: string
  isIncome: boolean
}

export interface Goal {
  id: string
  name: string
  icon: string
  targetAmount: number
  currentAmount: number
  color: string
  sub: string
}

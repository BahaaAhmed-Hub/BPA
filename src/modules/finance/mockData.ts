import type { Account, Transaction, Bill, Goal, Category } from './types'

export const MOCK_ACCOUNTS: Account[] = [
  { id: 'cib-dc', name: 'CIB DC', bank: 'CIB', accountType: 'payment', currency: 'EGP', balance: 911094, last4: '4471', emoji: '🏦', color: '#7E78DD', sortOrder: 1 },
  { id: 'nbe-dc', name: 'NBE DC', bank: 'NBE', accountType: 'payment', currency: 'EGP', balance: 148848, last4: '4452', emoji: '🏦', color: '#2FA869', sortOrder: 2 },
  { id: 'qnb-dc', name: 'QNB DC', bank: 'QNB', accountType: 'payment', currency: 'EGP', balance: 79995, last4: '3381', emoji: '💼', color: '#46B6C9', sortOrder: 3 },
  { id: 'wallet', name: 'Wallet', bank: 'Cash', accountType: 'wallet', currency: 'EGP', balance: 63022, emoji: '👛', color: '#C49A3C', sortOrder: 4 },
  { id: 'cib-world', name: 'CIB World', bank: 'CIB', accountType: 'credit_card', currency: 'EGP', balance: -44486, last4: '9920', emoji: '💳', color: '#DA4A3E', sortOrder: 5 },
  { id: 'cib-0731', name: 'CIB #0731', bank: 'CIB', accountType: 'credit_card', currency: 'EGP', balance: -606437, last4: '0731', emoji: '💳', color: '#DA4A3E', sortOrder: 6 },
  { id: 'cib-points', name: 'CIB points', bank: 'CIB', accountType: 'asset', currency: 'EGP', balance: 26300, emoji: '⭐', color: '#C49A3C', sortOrder: 7 },
  { id: 'cib-usd', name: 'CIB USD', bank: 'CIB', accountType: 'asset', currency: 'USD', balance: 288022, emoji: '💵', color: '#7E78DD', sortOrder: 8 },
]

export const MOCK_CATEGORIES: Category[] = [
  { id: 'personal', name: 'Personal', icon: '👤', color: '#C49A3C', isSystem: true, txType: 'expense' },
  { id: 'groceries', name: 'Supermarket', icon: '🛒', color: '#C49A3C', isSystem: true, txType: 'expense' },
  { id: 'dining', name: 'Dining Out', icon: '🍽', color: '#E0644E', isSystem: true, txType: 'expense' },
  { id: 'digital', name: 'Digital Apps', icon: '🌐', color: '#46B6C9', isSystem: true, txType: 'expense' },
  { id: 'car', name: 'Car', icon: '🚗', color: '#8C8071', isSystem: true, txType: 'expense' },
  { id: 'income', name: 'Income', icon: '💼', color: '#2FA869', isSystem: true, txType: 'income' },
  { id: 'girls', name: 'Girls Life', icon: '👧', color: '#E0644E', isSystem: true, txType: 'expense' },
]

export const MOCK_TRANSACTIONS: Transaction[] = [
  { id: 't1', accountId: 'cib-dc', amount: 180, currency: 'EGP', type: 'expense', payee: 'Personal Expenses (Bibioletek)', categoryId: 'personal', date: '2026-06-15', isCleared: true, isRecurring: false, createdAt: '2026-06-15T00:00:00Z' },
  { id: 't2', accountId: 'cib-dc', amount: 530, currency: 'EGP', type: 'expense', payee: 'Digital Apps', categoryId: 'digital', date: '2026-06-15', isCleared: true, isRecurring: false, createdAt: '2026-06-15T00:00:00Z' },
  { id: 't3', accountId: 'cib-dc', amount: 1186, currency: 'EGP', type: 'expense', payee: 'OpenAI API recharge', categoryId: 'digital', date: '2026-06-14', isCleared: true, isRecurring: false, createdAt: '2026-06-14T00:00:00Z' },
  { id: 't4', accountId: 'cib-dc', amount: 1300, currency: 'EGP', type: 'expense', payee: 'Supermarket (Saudi market)', categoryId: 'groceries', date: '2026-06-13', isCleared: true, isRecurring: false, createdAt: '2026-06-13T00:00:00Z' },
  { id: 't5', accountId: 'cib-dc', amount: 1200, currency: 'EGP', type: 'expense', payee: 'Dining Out (Breakfast Eatery)', categoryId: 'dining', date: '2026-06-13', isCleared: true, isRecurring: false, createdAt: '2026-06-13T00:00:00Z' },
  { id: 't6', accountId: 'nbe-dc', amount: 140000, currency: 'EGP', type: 'income', payee: 'Teradix Salary', categoryId: 'income', date: '2026-06-11', isCleared: true, isRecurring: true, createdAt: '2026-06-11T00:00:00Z' },
  { id: 't7', accountId: 'wallet', amount: 832, currency: 'EGP', type: 'expense', payee: 'Fuel (Chillout)', categoryId: 'car', date: '2026-06-09', isCleared: true, isRecurring: false, createdAt: '2026-06-09T00:00:00Z' },
  { id: 't8', accountId: 'wallet', amount: 4300, currency: 'EGP', type: 'expense', payee: 'Maintenance (Oil + flush)', categoryId: 'car', date: '2026-06-08', isCleared: true, isRecurring: false, createdAt: '2026-06-08T00:00:00Z' },
]

export const MOCK_BILLS: Bill[] = [
  { id: 'b1', name: 'Gym membership', amount: 450, currency: 'EGP', frequency: 'monthly', nextDue: '2026-06-22', isActive: true, icon: '💪', isIncome: false },
  { id: 'b2', name: 'Teradix Salary', amount: 140000, currency: 'EGP', frequency: 'monthly', nextDue: '2026-06-25', isActive: true, icon: '💼', isIncome: true },
  { id: 'b3', name: 'Girls Gifts/Toys', amount: 800, currency: 'EGP', frequency: 'monthly', nextDue: '2026-06-25', isActive: true, icon: '🎁', isIncome: false },
  { id: 'b4', name: 'TE Data Internet', amount: 800, currency: 'EGP', frequency: 'monthly', nextDue: '2026-06-28', isActive: true, icon: '🌐', isIncome: false },
  { id: 'b5', name: 'Rent — Maadi', amount: 18500, currency: 'EGP', frequency: 'monthly', nextDue: '2026-07-01', isActive: true, icon: '🏠', isIncome: false },
  { id: 'b6', name: 'Car installment', amount: 6200, currency: 'EGP', frequency: 'monthly', nextDue: '2026-07-03', isActive: true, icon: '🚗', isIncome: false },
  { id: 'b7', name: 'Vodafone postpaid', amount: 420, currency: 'EGP', frequency: 'monthly', nextDue: '2026-07-17', isActive: true, icon: '📱', isIncome: false },
  { id: 'b8', name: 'Netflix', amount: 310, currency: 'EGP', frequency: 'monthly', nextDue: '2026-07-08', isActive: true, icon: '🎬', isIncome: false },
  { id: 'b9', name: 'Teradix retainer', amount: 140000, currency: 'EGP', frequency: 'monthly', nextDue: '2026-06-25', isActive: true, icon: '💼', isIncome: true },
]

export const MOCK_GOALS: Goal[] = [
  { id: 'g1', name: 'Clear CIB #0731', icon: '🎯', targetAmount: 606437, currentAmount: 0, color: '#C49A3C', sub: 'Last 30 days · −EGP 42,000' },
  { id: 'g2', name: 'Travel fund', icon: '🏝', targetAmount: 100000, currentAmount: 56000, color: '#46B6C9', sub: 'Last 30 days · +EGP 8,000' },
]

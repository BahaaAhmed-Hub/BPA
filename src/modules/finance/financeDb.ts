/**
 * financeDb.ts — Supabase CRUD helpers for all finance tables.
 */
import { supabase } from '@/lib/supabase'
import { markLocalWrite } from '@/lib/liveSync'

// ─── Row types ────────────────────────────────────────────────────────────────

export interface AccountRow {
  id: string
  user_id: string
  name: string
  bank: string
  account_type: string
  currency: string
  balance: number
  last4?: string
  credit_limit?: number | null
  emoji: string
  color: string
  sort_order: number
  is_active: boolean
  created_at: string
}

export interface CategoryRow {
  id: string
  user_id: string
  name: string
  icon: string
  color: string
  parent_id?: string
  tx_type: string
  sort_order: number
  is_system: boolean
  created_at: string
}

export interface TransactionRow {
  id: string
  user_id: string
  account_id: string
  to_account_id?: string | null
  category_id?: string
  amount: number
  currency: string
  tx_type: string
  payee: string
  date: string
  paid_at?: string | null
  note?: string
  is_cleared: boolean
  is_recurring: boolean
  tags?: string[]
  attachments?: string[]
  created_at: string
}

export interface PlanRow {
  id: string
  user_id: string
  category_id: string
  year: number
  month: number
  planned_amount: number
  created_at?: string
  updated_at?: string
}

export interface OverrideRow {
  id: string
  user_id: string
  category_id: string
  year: number
  month: number
  override_amount: number
  created_at?: string
  updated_at?: string
}

export interface CommentRow {
  id: string
  user_id: string
  category_id: string
  year: number
  month: number
  comment: string
  created_at?: string
  updated_at?: string
}

// ─── Session helper ───────────────────────────────────────────────────────────

async function uid(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  if (!data.session) throw new Error('Not signed in')
  return data.session.user.id
}

// ─── Accounts ─────────────────────────────────────────────────────────────────

export async function loadAccounts(): Promise<AccountRow[]> {
  const userId = await uid()
  const { data, error } = await supabase
    .from('finance_accounts')
    .select('*')
    .eq('user_id', userId)
    .order('sort_order', { ascending: true })
  if (error || !data) return []
  return data as AccountRow[]
}

export async function saveAccount(row: AccountRow): Promise<void> {
  markLocalWrite('finance')
  await upsertRows('finance_accounts', [row])
}

export async function deleteAccount(id: string): Promise<void> {
  markLocalWrite('finance')
  const { error } = await supabase
    .from('finance_accounts')
    .delete()
    .eq('id', id)
  if (error) throw new Error(error.message)
}

// ─── Categories ───────────────────────────────────────────────────────────────

export async function loadCategories(): Promise<CategoryRow[]> {
  const userId = await uid()
  const { data, error } = await supabase
    .from('finance_categories')
    .select('*')
    .eq('user_id', userId)
    .order('sort_order', { ascending: true })
  if (error || !data) return []
  return data as CategoryRow[]
}

export async function saveCategory(row: CategoryRow): Promise<void> {
  markLocalWrite('finance')
  const { error } = await supabase
    .from('finance_categories')
    .upsert(row, { onConflict: 'id' })
  if (error) throw new Error(error.message)
}

export async function deleteCategory(id: string): Promise<void> {
  markLocalWrite('finance')
  const { error } = await supabase
    .from('finance_categories')
    .delete()
    .eq('id', id)
  if (error) throw new Error(error.message)
}

// ─── Transactions ─────────────────────────────────────────────────────────────

export async function loadTransactions(year: number): Promise<TransactionRow[]> {
  const userId = await uid()
  const { data, error } = await supabase
    .from('finance_transactions')
    .select('*')
    .eq('user_id', userId)
    .gte('date', `${year}-01-01`)
    .lte('date', `${year}-12-31`)
    .order('date', { ascending: false })
  if (error || !data) return []
  return data as TransactionRow[]
}

/** Every entry with no payment date, in any year — the year bound the normal
 *  load uses would leave the rest of the ledger untouched, and a repair that
 *  fixes one year at a time is one you have to remember to run again. */
export async function loadUnpaidTransactions(): Promise<TransactionRow[]> {
  const userId = await uid()
  const { data, error } = await supabase
    .from('finance_transactions')
    .select('*')
    .eq('user_id', userId)
    .is('paid_at', null)
    .order('date', { ascending: true })
  if (error || !data) return []
  return data as TransactionRow[]
}

export async function saveTransaction(row: TransactionRow): Promise<void> {
  markLocalWrite('finance')
  await upsertRows('finance_transactions', [row])
}

/** Several rows at once, in chunks. Writing a few hundred one at a time would
 *  be a few hundred round trips, and a load landing in the middle of them
 *  keeps only what has arrived. */
export async function saveTransactionsBulk(rows: TransactionRow[]): Promise<void> {
  markLocalWrite('finance')
  for (let i = 0; i < rows.length; i += 200) {
    await upsertRows('finance_transactions', rows.slice(i, i + 200))
  }
}

// ─── Writing to a table a migration has not caught up with ───────────────────
// paid_at, tags and attachments arrive with 20260006, to_account_id with
// 20260007, credit_limit with 20260008. Until one of those runs the server
// rejects the whole row, and losing the transaction because it carried a tag
// is a far worse trade than losing the tag.
//
// What it used to do was drop *every* column a migration might add and try
// again. One missing column therefore threw away three that were perfectly
// well supported — so on a database with no to_account_id, a payment date
// could never be written at all: the retry dropped paid_at with it, the server
// kept whatever it already had, and an entry marked unpaid came back paid on
// the next load. Nothing said so; the write "succeeded".
//
// So drop the column the error actually names, and only that one, asking again
// until the server takes the row. What is missing is remembered per table, so
// the next write goes out in a shape that already works.

const OPTIONAL: Record<string, string[]> = {
  finance_transactions: ['paid_at', 'tags', 'attachments', 'to_account_id'],
  finance_accounts:     ['credit_limit'],
}

const absent = new Map<string, Set<string>>()

function absentFor(table: string): Set<string> {
  let cols = absent.get(table)
  if (!cols) { cols = new Set(); absent.set(table, cols) }
  return cols
}

/** Which column the server says it has not got. PostgREST names it in quotes
 *  ("Could not find the 'to_account_id' column"), Postgres in double quotes
 *  (column "to_account_id" of relation …). */
function missingColumnName(error: { message?: string }): string | null {
  const msg = error.message ?? ''
  return msg.match(/'([a-z_]+)' column/i)?.[1]
      ?? msg.match(/column "([a-z_]+)"/i)?.[1]
      ?? null
}

function without<T extends object>(row: T, cols: Set<string>): T {
  if (cols.size === 0) return row
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) if (!cols.has(k)) out[k] = v
  return out as T
}

async function upsertRows(table: string, rows: object[]): Promise<void> {
  const gone = absentFor(table)
  let triedAll = false
  // At most one attempt per optional column, plus the blanket one and a final
  // pass — enough to converge, and it cannot spin.
  for (let attempt = 0; attempt <= (OPTIONAL[table]?.length ?? 0) + 2; attempt++) {
    const { error } = await supabase
      .from(table)
      .upsert(rows.map(r => without(r, gone)), { onConflict: 'id' })
    if (!error) return
    if (!isMissingColumn(error)) throw new Error(error.message)

    const col = missingColumnName(error)
    if (col && !gone.has(col)) { gone.add(col); continue }
    // The error named nothing usable, or named something already dropped:
    // fall back to the old behaviour once rather than give up on the write.
    if (!triedAll) {
      triedAll = true
      for (const c of OPTIONAL[table] ?? []) gone.add(c)
      continue
    }
    throw new Error(error.message)
  }
  throw new Error(`${table}: no column set the server would accept`)
}

/** Postgres says 42703 for a column that is not there; PostgREST says PGRST204
 *  when its cached copy of the schema has not caught up. Same remedy here. */
function isMissingColumn(error: { code?: string; message?: string }): boolean {
  const msg = error.message ?? ''
  return error.code === 'PGRST204' || error.code === '42703' ||
    /schema cache/i.test(msg) || /column .* does not exist/i.test(msg) ||
    /could not find the .* column/i.test(msg)
}

export async function deleteTransaction(id: string): Promise<void> {
  markLocalWrite('finance')
  const { error } = await supabase
    .from('finance_transactions')
    .delete()
    .eq('id', id)
  if (error) throw new Error(error.message)
}

// ─── Plans ────────────────────────────────────────────────────────────────────

export async function loadPlans(year: number): Promise<PlanRow[]> {
  const userId = await uid()
  const { data, error } = await supabase
    .from('finance_plans')
    .select('*')
    .eq('user_id', userId)
    .eq('year', year)
  if (error || !data) return []
  return data as PlanRow[]
}

export async function savePlan(
  categoryId: string,
  year: number,
  month: number,
  amount: number,
): Promise<void> {
  markLocalWrite('finance')
  const userId = await uid()
  const row: PlanRow = {
    id: crypto.randomUUID(),
    user_id: userId,
    category_id: categoryId,
    year,
    month,
    planned_amount: amount,
  }
  const { error } = await supabase
    .from('finance_plans')
    .upsert(row, { onConflict: 'user_id,category_id,year,month' })
  if (error) throw new Error(error.message)
}

// ─── Actuals Override ─────────────────────────────────────────────────────────

export async function loadActualsOverride(year: number): Promise<OverrideRow[]> {
  const userId = await uid()
  const { data, error } = await supabase
    .from('finance_actuals_override')
    .select('*')
    .eq('user_id', userId)
    .eq('year', year)
  if (error || !data) return []
  return data as OverrideRow[]
}

export async function saveActualOverride(
  categoryId: string,
  year: number,
  month: number,
  amount: number,
): Promise<void> {
  markLocalWrite('finance')
  const userId = await uid()
  const row: OverrideRow = {
    id: crypto.randomUUID(),
    user_id: userId,
    category_id: categoryId,
    year,
    month,
    override_amount: amount,
  }
  const { error } = await supabase
    .from('finance_actuals_override')
    .upsert(row, { onConflict: 'user_id,category_id,year,month' })
  if (error) throw new Error(error.message)
}

export async function deleteActualOverride(
  categoryId: string,
  year: number,
  month: number,
): Promise<void> {
  markLocalWrite('finance')
  const userId = await uid()
  const { error } = await supabase
    .from('finance_actuals_override')
    .delete()
    .eq('user_id', userId)
    .eq('category_id', categoryId)
    .eq('year', year)
    .eq('month', month)
  if (error) throw new Error(error.message)
}

// ─── Cell Comments ────────────────────────────────────────────────────────────

export async function loadCellComments(year: number): Promise<CommentRow[]> {
  const userId = await uid()
  const { data, error } = await supabase
    .from('finance_cell_comments')
    .select('*')
    .eq('user_id', userId)
    .eq('year', year)
  if (error || !data) return []
  return data as CommentRow[]
}

export async function saveCellComment(
  categoryId: string,
  year: number,
  month: number,
  comment: string,
): Promise<void> {
  markLocalWrite('finance')
  const userId = await uid()
  const row: CommentRow = {
    id: crypto.randomUUID(),
    user_id: userId,
    category_id: categoryId,
    year,
    month,
    comment,
  }
  const { error } = await supabase
    .from('finance_cell_comments')
    .upsert(row, { onConflict: 'user_id,category_id,year,month' })
  if (error) throw new Error(error.message)
}

export async function deleteCellComment(
  categoryId: string,
  year: number,
  month: number,
): Promise<void> {
  markLocalWrite('finance')
  const userId = await uid()
  const { error } = await supabase
    .from('finance_cell_comments')
    .delete()
    .eq('user_id', userId)
    .eq('category_id', categoryId)
    .eq('year', year)
    .eq('month', month)
  if (error) throw new Error(error.message)
}

// ─── Bills, goals and budgets ─────────────────────────────────────────────────
// finance_bills and finance_goals have been in the schema since 20260001 and
// nothing ever wrote to them: the store's upsertBill and upsertGoal only ever
// touched local state, so a bill entered on the laptop did not exist anywhere
// else. finance_budgets did not exist at all until 20260005.

export interface BillRow {
  id: string
  user_id: string
  name: string
  amount: number
  currency: string
  category_id?: string | null
  account_id?: string | null
  frequency: string
  next_due: string
  is_active: boolean
  is_income: boolean
  icon: string
  created_at?: string
}

/** null when the read failed — a missing table, or offline. An empty array
 *  means the table is genuinely empty, which is a different fact and leads to
 *  a different decision in the store: one keeps what the device has, the other
 *  is allowed to clear it. */
export async function loadBills(): Promise<BillRow[] | null> {
  const userId = await uid()
  const { data, error } = await supabase
    .from('finance_bills')
    .select('*')
    .eq('user_id', userId)
    .order('next_due', { ascending: true })
  if (error) return null
  return (data ?? []) as BillRow[]
}

export async function saveBill(row: BillRow): Promise<void> {
  markLocalWrite('finance')
  const { error } = await supabase.from('finance_bills').upsert(row, { onConflict: 'id' })
  if (error) throw new Error(error.message)
}

export async function deleteBill(id: string): Promise<void> {
  markLocalWrite('finance')
  const { error } = await supabase.from('finance_bills').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export interface GoalRow {
  id: string
  user_id: string
  name: string
  icon: string
  target_amount: number
  current_amount: number
  color: string
  sub_label?: string | null
  is_active: boolean
  created_at?: string
}

/** null when the read failed — a missing table, or offline. An empty array
 *  means the table is genuinely empty, which is a different fact and leads to
 *  a different decision in the store: one keeps what the device has, the other
 *  is allowed to clear it. */
export async function loadGoals(): Promise<GoalRow[] | null> {
  const userId = await uid()
  const { data, error } = await supabase
    .from('finance_goals')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  if (error) return null
  return (data ?? []) as GoalRow[]
}

export async function saveGoal(row: GoalRow): Promise<void> {
  markLocalWrite('finance')
  const { error } = await supabase.from('finance_goals').upsert(row, { onConflict: 'id' })
  if (error) throw new Error(error.message)
}

export async function deleteGoal(id: string): Promise<void> {
  markLocalWrite('finance')
  const { error } = await supabase.from('finance_goals').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export interface BudgetRow {
  id: string
  user_id: string
  category_id: string
  monthly_amount: number
  currency: string
  start_date: string
  end_date?: string | null
  rollover: boolean
  created_at?: string
}

/** null when the read failed — a missing table, or offline. An empty array
 *  means the table is genuinely empty, which is a different fact and leads to
 *  a different decision in the store: one keeps what the device has, the other
 *  is allowed to clear it. */
export async function loadBudgets(): Promise<BudgetRow[] | null> {
  const userId = await uid()
  const { data, error } = await supabase
    .from('finance_budgets')
    .select('*')
    .eq('user_id', userId)
    .order('start_date', { ascending: true })
  if (error) return null
  return (data ?? []) as BudgetRow[]
}

export async function saveBudget(row: BudgetRow): Promise<void> {
  markLocalWrite('finance')
  const { error } = await supabase.from('finance_budgets').upsert(row, { onConflict: 'id' })
  if (error) throw new Error(error.message)
}

export async function deleteBudget(id: string): Promise<void> {
  markLocalWrite('finance')
  const { error } = await supabase.from('finance_budgets').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

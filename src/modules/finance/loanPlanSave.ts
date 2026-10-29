import type { Account, Category } from './types'
import { useFinanceStore } from './financeStore'
import { loadRules, saveRules } from './modals/BudgetRuleModal'
import { LOAN_PARENT_NAME, ruleFromPlan, planFromRule, planIssue, type LoanPlan } from './loanPlan'
import { withChange, ruleAt, monthKeyOf, type Change } from './budgetSteps'
import { LOAN_ICON } from './components/LoanMark'
import { liveBalances } from './balances'
import { isLoan, isSettled } from './loans'

// ─── Writing a plan down: its rule, and the category the rule hangs on ───────
//
// `loanPlan.ts` says what a plan is. This is the only place that stores one:
// the loan's budget rule (the Budget screen, the entry writer, the forecast and
// the goal all read it from there) and the two categories that give the rule
// somewhere to sit — one system parent, "Loan repayments", and one child per
// loan whose **id is the loan's id**.

/** The parent, made the first time any loan has a plan. Found by name among
 *  the system categories, because a category id is global and a fixed one would
 *  collide between two people. */
function parentOf(categories: Category[]): Category | undefined {
  return categories.find(c => c.isSystem && !c.parentId && c.name === LOAN_PARENT_NAME)
}

/**
 * Give this loan a payment plan, change it, or (null) take it away.
 *
 * Taking it away removes the rule — and with it the unpaid instalments the
 * writer made, on its next pass — but **keeps the category** when entries have
 * been filed under it. Those are the repayments already made, and deleting the
 * category would null their category and leave a history that no longer says
 * what it was for.
 */
export async function saveLoanPlan(loan: Account, plan: LoanPlan | null): Promise<{ error?: string }> {
  const st = useFinanceStore.getState()
  const rules = loadRules()

  if (!plan) {
    delete rules[loan.id]
    saveRules(rules)
    // History is what was actually paid. The unpaid instalments are the plan's
    // own scaffolding — the writer removes them as soon as the rule is gone —
    // and a category kept alive for them would be an empty line in the Budget.
    const used = st.transactions.some(t => t.categoryId === loan.id && !!t.paidAt)
    if (!used && st.categories.some(c => c.id === loan.id)) await st.removeCategory(loan.id)
    // An empty parent is a heading over nothing.
    const parent = parentOf(useFinanceStore.getState().categories)
    if (parent && !useFinanceStore.getState().categories.some(c => c.parentId === parent.id)) {
      await st.removeCategory(parent.id)
    }
    return {}
  }

  const issue = planIssue(plan)
  if (issue) return { error: issue }

  let parent = parentOf(st.categories)
  if (!parent) {
    parent = {
      id: crypto.randomUUID(),
      name: LOAN_PARENT_NAME,
      icon: LOAN_ICON,
      color: loan.color,
      isSystem: true,
      txType: 'expense',
      sortOrder: 0,
    }
    await st.upsertCategory(parent)
  }
  // Named for the lender and kept in step with the account's name each time the
  // plan is saved.
  const child: Category = {
    id: loan.id,
    name: loan.name,
    icon: LOAN_ICON,
    color: loan.color,
    parentId: parent.id,
    isSystem: true,
    txType: 'expense',
    sortOrder: 0,
  }
  await st.upsertCategory(child)

  // A budget keeps what it was (budgetSteps.ts): raising the instalment, or
  // moving from monthly to quarterly, is recorded from this month on and every
  // earlier month stays as it was. Anything else about the plan — its dates, its
  // account — only decides what is written from now on, so it is the plan's now.
  const fresh = ruleFromPlan(plan, loan)
  const prev = rules[loan.id]
  if (prev && planFromRule(prev)) {
    const now = ruleAt(prev)
    const change: Change = {}
    if (plan.amount !== now.amount) change.amount = plan.amount
    if (plan.frequency !== now.frequency) change.frequency = plan.frequency
    rules[loan.id] = {
      ...withChange(prev, change, monthKeyOf()),
      starts: fresh.starts, ends: fresh.ends, dueDay: fresh.dueDay, dueAccountId: fresh.dueAccountId,
    }
  } else {
    // Born this month: a typo corrected in the same month is simply set, with no
    // ghost of the first figure left in a step.
    rules[loan.id] = { ...fresh, born: monthKeyOf() }
  }
  saveRules(rules)
  return {}
}

/**
 * A loan that has been paid back has no plan to keep. Left in, its budget line
 * would say "2,000 a month" for a debt that is gone, and the Budget would plan
 * around money nobody owes.
 *
 * **Settled means paid back, not "has nothing owed".** A loan whose plan has just
 * been written, before the borrowing it is for has been saved, also owes nothing —
 * and retiring it then would delete a plan the moment it was made. So only a loan
 * something has actually happened on counts: a balance it opened with, or an entry
 * to or from it.
 *
 * What is paid stays: `saveLoanPlan(null)` keeps the category when a repayment was
 * paid under it, so the history still says what it was for.
 */
export async function retireSettledPlans(): Promise<number> {
  const st = useFinanceStore.getState()
  const rules = loadRules()
  const balances = liveBalances(st.accounts, st.transactions).balances
  let n = 0
  for (const a of st.accounts) {
    if (!isLoan(a) || !rules[a.id]) continue
    const touched = a.balance !== 0 || st.transactions.some(t => t.accountId === a.id || t.toAccountId === a.id)
    if (!touched || !isSettled(balances.get(a.id) ?? a.balance)) continue
    await saveLoanPlan(a, null)
    n++
  }
  return n
}

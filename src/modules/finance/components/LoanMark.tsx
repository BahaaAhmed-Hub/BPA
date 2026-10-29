/** The medallion of a borrowing or a repayment: a line icon, so it takes the
 *  row's ink and is measured as one — a card emoji says "spent on a card". */
export const LOAN_ICON = 'lucide:HandCoins'

/** A transfer that is a borrowing, or paying one back, says so beside its name.
 *  Without it the entry reads as money moving between two accounts, which is
 *  true and is not what the person did — and a feed full of "Money moved to…"
 *  hides that some of it has to be repaid. Neutral ink on purpose: it is not
 *  earned and it is not spent. */
export function LoanMark({ kind }: { kind: 'borrowed' | 'repaid' | null }) {
  if (!kind) return null
  return (
    <span
      title={kind === 'borrowed'
        ? 'Borrowed — money you will pay back. Not income.'
        : 'Paid back to a lender. Not an expense.'}
      style={{
        flexShrink: 0, padding: '1px 8px', borderRadius: 'var(--sb-r-pill)',
        background: 'var(--sb-field)', color: 'var(--sb-ink-2)',
        fontSize: 'var(--sb-t-micro)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase',
      }}>
      {kind === 'borrowed' ? 'Borrowed' : 'Repaid'}
    </span>
  )
}

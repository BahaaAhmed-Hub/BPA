import { useFinanceStore } from '../financeStore'

const C = {
  surface:   '#16120D',
  border:    '#272118',
  divFaint:  '#1B160F',
  amber:     '#C49A3C',
  textPri:   '#F2EBDD',
  textMuted: '#8C8071',
  textDim:   '#565049',
  red:       '#DA4A3E',
  green:     '#2FA869',
}

interface Props {
  onOpenAdd: () => void
}

export function ReflectionScreen({ onOpenAdd }: Props) {
  const { accounts, transactions } = useFinanceStore()

  const netWorth = accounts.reduce((s, a) => s + a.balance, 0)
  const monthTx  = transactions.filter(tx => tx.date.startsWith('2026-06'))
  const income   = monthTx.filter(tx => tx.type === 'income').reduce((s, tx) => s + tx.amount, 0)
  const expense  = monthTx.filter(tx => tx.type === 'expense').reduce((s, tx) => s + tx.amount, 0)

  const metrics = [
    { label: 'Net Worth',    value: `EGP ${netWorth.toLocaleString('en-US')}`, color: C.amber },
    { label: 'Monthly Income',  value: `EGP ${income.toLocaleString('en-US')}`,  color: C.green },
    { label: 'Monthly Expenses', value: `EGP ${expense.toLocaleString('en-US')}`, color: C.red },
    { label: 'Savings Rate', value: income > 0 ? `${Math.round(((income - expense) / income) * 100)}%` : '—', color: C.amber },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        height: 64, flexShrink: 0,
        borderBottom: '1px solid #211C14',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 30px',
      }}>
        <span style={{ fontSize: 20, fontWeight: 700, color: C.textPri }}>Financials</span>
        <button
          onClick={onOpenAdd}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth="1.7" strokeLinecap="round">
            <circle cx="11" cy="11" r="7"/>
            <line x1="16.5" y1="16.5" x2="22" y2="22"/>
          </svg>
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 30px' }}>
        {/* Key metrics */}
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: C.textMuted, letterSpacing: '0.8px', marginBottom: 14 }}>
          Key Metrics — June 2026
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12, marginBottom: 28 }}>
          {metrics.map(({ label, value, color }) => (
            <div key={label} style={{
              padding: '18px 20px',
              background: C.surface,
              borderRadius: 14,
              border: `1px solid ${C.border}`,
            }}>
              <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 8 }}>{label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Account summary table */}
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: C.textMuted, letterSpacing: '0.8px', marginBottom: 14 }}>
          Account Balances
        </div>

        {accounts.map(acc => (
          <div key={acc.id} style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 0',
            borderBottom: `1px solid ${C.divFaint}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 16 }}>{acc.emoji}</span>
              <div>
                <div style={{ fontSize: 14, color: C.textPri, fontWeight: 500 }}>{acc.name}</div>
                <div style={{ fontSize: 11, color: C.textDim }}>{acc.accountType}</div>
              </div>
            </div>
            <div style={{
              fontSize: 14,
              fontWeight: 600,
              color: acc.balance < 0 ? C.red : C.green,
            }}>
              {acc.currency} {acc.balance < 0
                ? `(${Math.abs(acc.balance).toLocaleString('en-US')})`
                : acc.balance.toLocaleString('en-US')}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

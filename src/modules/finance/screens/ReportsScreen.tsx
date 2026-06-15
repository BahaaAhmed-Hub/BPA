import { useFinanceStore } from '../financeStore'
import { MOCK_CATEGORIES } from '../mockData'

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
  cyan:      '#46B6C9',
  purple:    '#7E78DD',
}

interface Props {
  onOpenAdd: () => void
}

export function ReportsScreen({ onOpenAdd }: Props) {
  const { transactions } = useFinanceStore()

  const monthTx = transactions.filter(tx => tx.date.startsWith('2026-06'))
  const income  = monthTx.filter(tx => tx.type === 'income').reduce((s, tx) => s + tx.amount, 0)
  const expense = monthTx.filter(tx => tx.type === 'expense').reduce((s, tx) => s + tx.amount, 0)
  const net     = income - expense

  // Spending by category
  const expTx = monthTx.filter(tx => tx.type === 'expense')
  const byCat: Record<string, number> = {}
  for (const tx of expTx) {
    const key = tx.categoryId ?? 'other'
    byCat[key] = (byCat[key] ?? 0) + tx.amount
  }
  const catEntries = Object.entries(byCat).sort((a, b) => b[1] - a[1])

  const PALETTE = [C.amber, C.cyan, C.purple, C.red, C.green]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        height: 64, flexShrink: 0,
        borderBottom: '1px solid #211C14',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 30px',
      }}>
        <span style={{ fontSize: 20, fontWeight: 700, color: C.textPri }}>Reports</span>
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
        {/* Summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 28 }}>
          {[
            { label: 'Income', value: income, color: C.green },
            { label: 'Expenses', value: expense, color: C.red },
            { label: 'Net', value: net, color: net >= 0 ? C.green : C.red },
          ].map(({ label, value, color }) => (
            <div key={label} style={{
              padding: '16px 18px',
              background: C.surface,
              borderRadius: 12,
              border: `1px solid ${C.border}`,
            }}>
              <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
                {label}
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color }}>
                EGP {Math.abs(value).toLocaleString('en-US')}
              </div>
            </div>
          ))}
        </div>

        {/* Category breakdown */}
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: C.textMuted, letterSpacing: '0.8px', marginBottom: 14 }}>
          Spending by Category
        </div>

        {catEntries.map(([catId, spent], i) => {
          const cat = MOCK_CATEGORIES.find(c => c.id === catId)
          const pct = expense > 0 ? Math.round((spent / expense) * 100) : 0
          const color = PALETTE[i % PALETTE.length]
          return (
            <div key={catId} style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 14, color: C.textPri }}>
                  {cat?.icon ?? '💳'} {cat?.name ?? 'Other'}
                </span>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: C.textMuted }}>{pct}%</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: C.textPri }}>
                    EGP {spent.toLocaleString('en-US')}
                  </span>
                </div>
              </div>
              <div style={{ height: 5, borderRadius: 3, background: C.border, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${pct}%`,
                  background: color,
                  borderRadius: 3,
                }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

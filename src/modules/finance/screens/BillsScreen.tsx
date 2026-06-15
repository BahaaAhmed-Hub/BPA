import { useFinanceStore } from '../financeStore'

const C = {
  bg:        '#0B0A08',
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

function Pill({ isIncome, amount, currency }: { isIncome: boolean; amount: number; currency: string }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '7px 15px',
      borderRadius: 9,
      fontSize: 13,
      fontWeight: 600,
      background: isIncome ? C.green : C.red,
      color: '#fff',
      whiteSpace: 'nowrap',
    }}>
      {isIncome ? '+' : '−'}{currency} {amount.toLocaleString('en-US')}
    </span>
  )
}

export function BillsScreen({ onOpenAdd }: Props) {
  const { bills } = useFinanceStore()

  const activeBills = bills.filter(b => b.isActive)
  const upcoming = activeBills.filter(b => new Date(b.nextDue) >= new Date('2026-06-15'))
  const past     = activeBills.filter(b => new Date(b.nextDue) < new Date('2026-06-15'))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        height: 64, flexShrink: 0,
        borderBottom: '1px solid #211C14',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 30px',
      }}>
        <span style={{ fontSize: 20, fontWeight: 700, color: C.textPri }}>Bills</span>
        <button
          onClick={onOpenAdd}
          style={{
            padding: '8px 18px', borderRadius: 9,
            background: C.amber, border: 'none',
            color: '#0B0A08', fontSize: 13, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          + Add
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 30px' }}>
        {upcoming.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: C.textMuted, letterSpacing: '0.8px', marginBottom: 12 }}>
              Upcoming
            </div>
            {upcoming.map(bill => {
              const due = new Date(bill.nextDue)
              const dateStr = due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
              return (
                <div key={bill.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 0',
                  borderBottom: `1px solid ${C.divFaint}`,
                }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: '50%',
                    background: `${bill.isIncome ? C.green : C.red}22`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 18, flexShrink: 0,
                  }}>
                    {bill.icon}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: C.textPri }}>{bill.name}</div>
                    <div style={{ fontSize: 12, color: C.amber, marginTop: 2 }}>{dateStr}</div>
                  </div>
                  <Pill isIncome={bill.isIncome} amount={bill.amount} currency={bill.currency} />
                </div>
              )
            })}
          </div>
        )}

        {past.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: C.textMuted, letterSpacing: '0.8px', marginBottom: 12 }}>
              Past
            </div>
            {past.map(bill => {
              const due = new Date(bill.nextDue)
              const dateStr = due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
              return (
                <div key={bill.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 0',
                  borderBottom: `1px solid ${C.divFaint}`,
                  opacity: 0.55,
                }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: '50%',
                    background: `${bill.isIncome ? C.green : C.red}22`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 18, flexShrink: 0,
                  }}>
                    {bill.icon}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: C.textPri }}>{bill.name}</div>
                    <div style={{ fontSize: 12, color: C.textDim, marginTop: 2 }}>{dateStr}</div>
                  </div>
                  <Pill isIncome={bill.isIncome} amount={bill.amount} currency={bill.currency} />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

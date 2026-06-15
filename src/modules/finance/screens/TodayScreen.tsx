import { useFinanceStore } from '../financeStore'
import { MOCK_BILLS, MOCK_GOALS } from '../mockData'

// ─── Colors ───────────────────────────────────────────────────────────────────

const C = {
  bg:          '#0B0A08',
  rail:        '#100D0A',
  panel:       '#110E0A',
  surface:     '#16120D',
  surfaceEl:   '#1E1913',
  amberBg:     '#1E1609',
  border:      '#272118',
  borderSt:    '#3A3326',
  divFaint:    '#1B160F',
  amber:       '#C49A3C',
  amberSoft:   '#E0C57E',
  textPri:     '#F2EBDD',
  textMuted:   '#8C8071',
  textDim:     '#565049',
  red:         '#DA4A3E',
  green:       '#2FA869',
  cyan:        '#46B6C9',
  purple:      '#7E78DD',
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  onOpenAdd: () => void
}

// ─── Pill ─────────────────────────────────────────────────────────────────────

function Pill({ type, amount, currency }: { type: 'expense' | 'income' | 'transfer'; amount: number; currency: string }) {
  const bg = type === 'expense' ? C.red : type === 'income' ? C.green : '#EDE6D8'
  const color = type === 'transfer' ? '#1A1714' : '#fff'
  return (
    <span style={{
      display: 'inline-block',
      padding: '7px 15px',
      borderRadius: 9,
      fontSize: 13,
      fontWeight: 600,
      background: bg,
      color,
      whiteSpace: 'nowrap',
    }}>
      {type === 'expense' ? '−' : type === 'income' ? '+' : ''}{currency} {amount.toLocaleString('en-US')}
    </span>
  )
}

// ─── Bill dots map ────────────────────────────────────────────────────────────

const BILL_DOTS: Record<number, string[]> = {
  2:  [C.green],
  4:  [C.red],
  5:  [C.red],
  7:  [C.red],
  9:  [C.red, C.green],
  11: [C.green],
  12: [C.red],
  13: [C.red],
  14: [C.red],
  15: [C.red],
  17: [C.red],
  18: [C.red],
  20: [C.green],
  22: [C.red],
  24: [C.red],
  25: [C.red, C.green],
  28: [C.red],
  30: [C.red],
}

// ─── Today Screen ─────────────────────────────────────────────────────────────

export function TodayScreen({ onOpenAdd }: Props) {
  const { transactions } = useFinanceStore()

  const today = new Date('2026-06-15')
  const todayNum = today.getDate()

  // June 2026 starts on Monday (day index 0 in Mon-first grid)
  const daysInMonth = 30
  // June 1 2026 is a Monday
  const startOffset = 0 // Monday = 0

  // Weekday headers
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  // Build calendar cells (blanks + days)
  const cells: (number | null)[] = []
  for (let i = 0; i < startOffset; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  // Bills due this month (nextDue in June 2026, upcoming)
  const plannedBills = MOCK_BILLS.filter(b => {
    const due = new Date(b.nextDue)
    return due.getFullYear() === 2026 && due.getMonth() === 5 && due.getDate() >= todayNum
  })

  // Recent transactions (today / yesterday)
  const recentTx = transactions
    .filter(tx => tx.date === '2026-06-15' || tx.date === '2026-06-14')
    .sort((a, b) => b.date.localeCompare(a.date))

  // Totals for current month
  const monthTx = transactions.filter(tx => tx.date.startsWith('2026-06'))
  const totalExpense = monthTx.filter(tx => tx.type === 'expense').reduce((s, tx) => s + tx.amount, 0)
  const totalIncome  = monthTx.filter(tx => tx.type === 'income').reduce((s, tx) => s + tx.amount, 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        height: 64, flexShrink: 0,
        borderBottom: `1px solid #211C14`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 30px',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontSize: 25, fontWeight: 600, color: C.textPri }}>June</span>
          <span style={{ fontSize: 25, fontWeight: 600, color: C.textMuted }}>2026</span>
        </div>
        <button
          onClick={onOpenAdd}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
          title="Search"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth="1.7" strokeLinecap="round">
            <circle cx="11" cy="11" r="7"/>
            <line x1="16.5" y1="16.5" x2="22" y2="22"/>
          </svg>
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ── Left pane: Calendar ── */}
        <div style={{
          flex: 1.25,
          overflowY: 'auto',
          padding: '24px 26px',
          borderRight: `1px solid #211C14`,
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
        }}>
          {/* Weekday headers */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7,1fr)',
            gap: 7,
            marginBottom: 6,
          }}>
            {weekdays.map(d => (
              <div key={d} style={{
                textAlign: 'center',
                fontSize: 10,
                fontWeight: 600,
                textTransform: 'uppercase',
                color: C.textMuted,
                letterSpacing: '0.5px',
                padding: '4px 0',
              }}>
                {d}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7,1fr)',
            gap: 7,
          }}>
            {cells.map((day, idx) => {
              if (day === null) {
                return <div key={`blank-${idx}`} />
              }
              const isToday = day === todayNum
              const dots = BILL_DOTS[day] ?? []
              return (
                <div
                  key={day}
                  style={{
                    minHeight: 74,
                    borderRadius: 9,
                    border: `1px solid ${isToday ? C.amber : C.divFaint}`,
                    background: isToday ? C.amberBg : 'transparent',
                    padding: '8px 9px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    cursor: 'pointer',
                  }}
                >
                  <span style={{
                    fontSize: 13,
                    fontWeight: isToday ? 700 : 400,
                    color: isToday ? C.amber : day > todayNum ? C.textDim : C.textMuted,
                    lineHeight: 1,
                  }}>
                    {day}
                  </span>
                  {dots.length > 0 && (
                    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 2 }}>
                      {dots.map((color, di) => (
                        <div
                          key={di}
                          style={{
                            width: 5,
                            height: 5,
                            borderRadius: '50%',
                            background: color,
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Navigation bar */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 20,
            marginTop: 18,
            paddingTop: 14,
            borderTop: `1px solid ${C.border}`,
          }}>
            <button style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 18, cursor: 'pointer', padding: '4px 8px', fontFamily: 'inherit' }}>
              ‹
            </button>
            <span style={{ color: C.textMuted, fontSize: 13, fontWeight: 600 }}>Today</span>
            <button style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 18, cursor: 'pointer', padding: '4px 8px', fontFamily: 'inherit' }}>
              ›
            </button>
          </div>
        </div>

        {/* ── Right pane: Goals, Planned, Paid ── */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '24px 26px',
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
        }}>

          {/* Goals section */}
          <div style={{ marginBottom: 24 }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 12,
            }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: C.textMuted, letterSpacing: '0.8px' }}>
                Goals
              </span>
              <button style={{
                background: 'none', border: 'none', color: C.amber,
                fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              }}>
                Add
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {MOCK_GOALS.map(goal => (
                <div
                  key={goal.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '12px 0',
                    borderBottom: `1px solid ${C.divFaint}`,
                  }}
                >
                  <div style={{
                    width: 40, height: 40, borderRadius: '50%',
                    background: `${goal.color}22`,
                    border: `1px solid ${goal.color}44`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 18, flexShrink: 0,
                  }}>
                    {goal.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: C.textPri, marginBottom: 2 }}>
                      {goal.name}
                    </div>
                    <div style={{ fontSize: 12, color: C.textMuted }}>{goal.sub}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: goal.color }}>
                      EGP {goal.currentAmount.toLocaleString('en-US')}
                    </div>
                    <div style={{ fontSize: 11, color: C.textDim }}>
                      of {goal.targetAmount.toLocaleString('en-US')}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Planned section */}
          {plannedBills.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ marginBottom: 12 }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: C.textMuted, letterSpacing: '0.8px' }}>
                  Planned
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {plannedBills.map(bill => {
                  const due = new Date(bill.nextDue)
                  const dateStr = due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                  return (
                    <div
                      key={bill.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '10px 0',
                        borderBottom: `1px solid ${C.divFaint}`,
                      }}
                    >
                      <div style={{
                        width: 40, height: 40, borderRadius: '50%',
                        background: `${bill.isIncome ? C.green : C.red}22`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 18, flexShrink: 0,
                      }}>
                        {bill.icon}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 500, color: C.textPri }}>{bill.name}</div>
                        <div style={{ fontSize: 12, color: C.amber, marginTop: 1 }}>{dateStr}</div>
                      </div>
                      <Pill
                        type={bill.isIncome ? 'income' : 'expense'}
                        amount={bill.amount}
                        currency={bill.currency}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Paid section */}
          {recentTx.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ marginBottom: 12 }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: C.textMuted, letterSpacing: '0.8px' }}>
                  Paid
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {recentTx.map(tx => {
                  const isToday2 = tx.date === '2026-06-15'
                  return (
                    <div
                      key={tx.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '10px 0',
                        borderBottom: `1px solid ${C.divFaint}`,
                      }}
                    >
                      <div style={{
                        width: 40, height: 40, borderRadius: '50%',
                        background: `${tx.type === 'income' ? C.green : C.red}22`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 18, flexShrink: 0,
                      }}>
                        {tx.type === 'income' ? '💼' : tx.type === 'expense' ? '💳' : '🔄'}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 14, fontWeight: 500, color: C.textPri,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {tx.payee}
                        </div>
                        <div style={{ fontSize: 12, color: C.green, marginTop: 1 }}>
                          {isToday2 ? 'Today' : 'Yesterday'}
                        </div>
                      </div>
                      <Pill
                        type={tx.type === 'income' ? 'income' : tx.type === 'transfer' ? 'transfer' : 'expense'}
                        amount={tx.amount}
                        currency={tx.currency}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Footer totals */}
          <div style={{
            marginTop: 'auto',
            paddingTop: 16,
            borderTop: `1px solid ${C.border}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <span style={{ fontSize: 13, color: C.red, fontWeight: 600 }}>
              Total expenses EGP {totalExpense.toLocaleString('en-US')}
            </span>
            <span style={{ fontSize: 13, color: C.green, fontWeight: 600 }}>
              Income EGP {totalIncome.toLocaleString('en-US')}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

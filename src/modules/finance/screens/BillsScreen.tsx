import { useFinanceStore } from '../financeStore'
import { useUIStore } from '@/store/uiStore'
import { getTheme } from '@/lib/themes'

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  onOpenAdd: () => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const day = d.getDate()
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${day} ${months[d.getMonth()]}`
}

function formatFrequency(freq: string): string {
  switch (freq) {
    case 'monthly':   return 'Monthly'
    case 'weekly':    return 'Weekly'
    case 'yearly':    return 'Yearly'
    case 'quarterly': return 'Quarterly'
    default: return freq
  }
}

// ─── Pill ─────────────────────────────────────────────────────────────────────

const RED = '#DA4A3E'
const GREEN = '#2FA869'

function Pill({ isIncome, amount, currency }: { isIncome: boolean; amount: number; currency: string }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '5px 12px',
      borderRadius: 8,
      fontSize: 13,
      fontWeight: 600,
      background: isIncome ? `${GREEN}28` : `${RED}28`,
      color: isIncome ? GREEN : RED,
      whiteSpace: 'nowrap' as const,
      flexShrink: 0,
    }}>
      {isIncome ? '+' : '−'}{currency} {amount.toLocaleString('en-US')}
    </span>
  )
}

// ─── Icon Circle ──────────────────────────────────────────────────────────────

function IconCircle({ icon, isIncome, surface, textPri }: { icon: string; isIncome: boolean; surface: string; textPri: string }) {
  return (
    <div style={{
      width: 40, height: 40, borderRadius: '50%',
      border: `1px solid #2A241B`,
      background: surface,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 18, flexShrink: 0,
      color: isIncome ? GREEN : textPri,
    }}>
      {icon}
    </div>
  )
}

// ─── Bills Screen ─────────────────────────────────────────────────────────────

export function BillsScreen({ onOpenAdd }: Props) {
  const themeId = useUIStore(s => s.themeId)
  const theme = getTheme(themeId)
  const C = {
    bg:        theme.bg,
    surface:   theme.surface,
    border:    theme.border,
    borderSt:  theme.border,
    divFaint:  theme.border,
    amber:     theme.accent,
    textPri:   theme.text,
    textMuted: theme.textDim,
    textDim:   theme.textMuted,
    red:       '#DA4A3E',
    green:     '#2FA869',
  }

  const { bills } = useFinanceStore()

  const today = new Date('2026-06-15')
  const in30  = new Date('2026-07-15')

  const activeBills = bills.filter(b => b.isActive)

  // Upcoming: expenses due within next 30 days
  const upcomingExpenses = activeBills
    .filter(b => !b.isIncome)
    .filter(b => {
      const d = new Date(b.nextDue)
      return d >= today && d <= in30
    })
    .sort((a, b) => new Date(a.nextDue).getTime() - new Date(b.nextDue).getTime())

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%', overflow: 'hidden', background: C.bg }}>

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
          + Add bill
        </button>
      </div>

      {/* Content — two panes */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Left pane: Upcoming */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '22px 26px',
          borderRight: `1px solid ${C.border}`,
        }}>
          <div style={{
            fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as const,
            letterSpacing: '0.8px', color: C.textMuted, marginBottom: 12,
          }}>
            UPCOMING · 30 DAYS
          </div>

          {upcomingExpenses.length === 0 && (
            <div style={{ fontSize: 13, color: C.textDim, paddingTop: 8 }}>No upcoming bills</div>
          )}

          {upcomingExpenses.map(bill => (
            <div key={bill.id} style={{
              display: 'flex', alignItems: 'center', gap: 13,
              padding: '13px 0',
              borderBottom: `1px solid ${C.divFaint}`,
            }}>
              {/* Date */}
              <span style={{ fontSize: 11.5, color: C.textMuted, width: 46, flexShrink: 0 }}>
                {formatShortDate(bill.nextDue)}
              </span>

              {/* Icon */}
              <IconCircle icon={bill.icon} isIncome={bill.isIncome} surface={C.surface} textPri={C.textPri} />

              {/* Name */}
              <span style={{ fontSize: 14, color: C.textPri, flex: 1 }}>{bill.name}</span>

              {/* Pill */}
              <Pill isIncome={bill.isIncome} amount={bill.amount} currency={bill.currency} />
            </div>
          ))}
        </div>

        {/* Right pane: All recurring */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '22px 26px',
        }}>
          <div style={{
            fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as const,
            letterSpacing: '0.8px', color: C.textMuted, marginBottom: 12,
          }}>
            ALL RECURRING
          </div>

          {activeBills.map(bill => (
            <div key={bill.id} style={{
              display: 'flex', alignItems: 'center', gap: 13,
              padding: '12px 0',
              borderBottom: `1px solid ${C.divFaint}`,
            }}>
              {/* Icon */}
              <IconCircle icon={bill.icon} isIncome={bill.isIncome} surface={C.surface} textPri={C.textPri} />

              {/* Name + meta */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, color: C.textPri, fontWeight: 500 }}>{bill.name}</div>
                <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 2 }}>
                  {formatFrequency(bill.frequency)} · next {formatShortDate(bill.nextDue)}
                </div>
              </div>

              {/* Amount */}
              <span style={{ fontSize: 13.5, color: C.textPri, fontWeight: 600, flexShrink: 0 }}>
                EGP {bill.amount.toLocaleString('en-US')}
              </span>
            </div>
          ))}
        </div>

      </div>
    </div>
  )
}

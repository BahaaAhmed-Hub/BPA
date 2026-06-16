import { useState } from 'react'
import { useFinanceStore } from '../financeStore'
import { useUIStore } from '@/store/uiStore'
import { getTheme } from '@/lib/themes'
import { BillModal } from '../modals/BillModal'
import { IconPicker } from '../components/IconPicker'
import type { Bill } from '../types'

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

function IconCircle({ icon, isIncome, surface, textPri, onIconChange }: {
  icon: string; isIncome: boolean; surface: string; textPri: string
  onIconChange?: (icon: string) => void
}) {
  const circleStyle: React.CSSProperties = {
    width: 40, height: 40, borderRadius: '50%',
    border: '1px solid #2A241B',
    background: surface,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 18, flexShrink: 0,
    color: isIncome ? GREEN : textPri,
    overflow: 'hidden',
  }
  if (onIconChange) {
    return (
      <IconPicker
        value={icon}
        onChange={onIconChange}
        trigger={(onClick) => (
          <div
            onClick={onClick}
            title="Click to change icon"
            style={{ ...circleStyle, cursor: 'pointer' }}
          >
            {icon.startsWith('data:') || icon.startsWith('http')
              ? <img src={icon} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : icon}
          </div>
        )}
      />
    )
  }
  return <div style={circleStyle}>{icon}</div>
}

// ─── Bills Screen ─────────────────────────────────────────────────────────────

interface Props {
  onOpenAdd?: () => void
}

export function BillsScreen({ onOpenAdd: _onOpenAdd }: Props) {
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

  const { bills, accounts, categories, upsertBill, removeBill } = useFinanceStore()
  const [billModal, setBillModal] = useState<{ open: boolean; bill: Bill | null }>({ open: false, bill: null })

  const today = new Date()
  const in30  = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

  const activeBills = bills.filter(b => b.isActive)

  // Upcoming: expenses due within next 30 days
  const upcomingExpenses = activeBills
    .filter(b => !b.isIncome)
    .filter(b => {
      const d = new Date(b.nextDue)
      return d >= today && d <= in30
    })
    .sort((a, b) => new Date(a.nextDue).getTime() - new Date(b.nextDue).getTime())

  function handleSave(bill: Bill) {
    upsertBill(bill)
    setBillModal({ open: false, bill: null })
  }

  function handleDelete(id: string) {
    removeBill(id)
    setBillModal({ open: false, bill: null })
  }

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
          onClick={() => setBillModal({ open: true, bill: null })}
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
            <div
              key={bill.id}
              onClick={() => setBillModal({ open: true, bill })}
              style={{
                display: 'flex', alignItems: 'center', gap: 13,
                padding: '13px 0',
                borderBottom: `1px solid ${C.divFaint}`,
                cursor: 'pointer',
              }}
            >
              {/* Date */}
              <span style={{ fontSize: 11.5, color: C.textMuted, width: 46, flexShrink: 0 }}>
                {formatShortDate(bill.nextDue)}
              </span>

              {/* Icon */}
              <IconCircle
                icon={bill.icon} isIncome={bill.isIncome} surface={C.surface} textPri={C.textPri}
                onIconChange={newIcon => upsertBill({ ...bill, icon: newIcon })}
              />

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
            <div
              key={bill.id}
              onClick={() => setBillModal({ open: true, bill })}
              style={{
                display: 'flex', alignItems: 'center', gap: 13,
                padding: '12px 0',
                borderBottom: `1px solid ${C.divFaint}`,
                cursor: 'pointer',
              }}
            >
              {/* Icon */}
              <IconCircle
                icon={bill.icon} isIncome={bill.isIncome} surface={C.surface} textPri={C.textPri}
                onIconChange={newIcon => upsertBill({ ...bill, icon: newIcon })}
              />

              {/* Name + meta */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, color: C.textPri, fontWeight: 500 }}>{bill.name}</div>
                <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 2 }}>
                  {formatFrequency(bill.frequency)} · next {formatShortDate(bill.nextDue)}
                </div>
              </div>

              {/* Amount */}
              <span style={{ fontSize: 13.5, color: C.textPri, fontWeight: 600, flexShrink: 0 }}>
                {bill.currency} {bill.amount.toLocaleString('en-US')}
              </span>
            </div>
          ))}
        </div>

      </div>

      {/* BillModal */}
      {billModal.open && (
        <BillModal
          bill={billModal.bill}
          categories={categories}
          accounts={accounts}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setBillModal({ open: false, bill: null })}
        />
      )}
    </div>
  )
}

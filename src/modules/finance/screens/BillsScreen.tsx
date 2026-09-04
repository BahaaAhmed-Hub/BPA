import { useState } from 'react'
import { useFinanceStore } from '../financeStore'
import { BillModal } from '../modals/BillModal'
import { IconPicker } from '../components/IconPicker'
import type { Bill } from '../types'
import { POSITIVE, NEGATIVE } from '../../../lib/moneyColors'

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

const RED   = NEGATIVE
const GREEN = POSITIVE

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
    border: '1px solid #E8E1CE',
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
  const C = {
    bg:        '#F7F4EA',
    surface:   '#FFFFFF',
    border:    '#E8E1CE',
    borderSt:  '#E8E1CE',
    divFaint:  '#E8E1CE',
    amber:     '#F5D14E',
    textPri:   '#191712',
    textMuted: '#6C6553',
    textDim:   '#9B9180',
    red:       '#C62828',
    green:     '#0C8140',
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
        flexShrink: 0,
        borderBottom: '1px solid #E8E1CE',
        padding: '14px 26px 16px',
        display: 'flex', alignItems: 'flex-end', gap: 20,
      }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', color: '#6C6553', display: 'block', marginBottom: 4 }}>MONEY</span>
          <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 28, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1, color: '#191712', display: 'block' }}>
            Bills &amp; recurring
          </span>
          <span style={{ fontSize: 12, color: '#6C6553', display: 'block', marginTop: 3 }}>
            Scheduled payments · two dates per transaction
          </span>
        </div>
        <button
          onClick={() => setBillModal({ open: true, bill: null })}
          style={{
            marginLeft: 'auto', height: 34, padding: '0 15px', borderRadius: 999,
            background: '#F5D14E', border: 'none',
            color: '#191712', fontSize: 12.5, fontWeight: 600,
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
            boxShadow: '0 2px 0 rgba(25,23,18,0.14)',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
          Add bill
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

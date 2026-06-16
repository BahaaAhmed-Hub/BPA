import { useState } from 'react'
import { useUIStore } from '@/store/uiStore'
import { getTheme } from '@/lib/themes'
import type { Account, AccountType, Currency } from '../types'

const RED   = '#DA4A3E'
const GREEN = '#2FA869'
void GREEN // kept for semantic reference

interface Props {
  account?: Account | null
  onSave: (a: Account) => void
  onDelete?: (id: string) => void
  onClose: () => void
}

export function AccountModal({ account, onSave, onDelete, onClose }: Props) {
  const theme = getTheme(useUIStore(s => s.themeId))
  const isEdit = !!account

  const [name,        setName]        = useState(account?.name        ?? '')
  const [bank,        setBank]        = useState(account?.bank        ?? '')
  const [accountType, setAccountType] = useState<AccountType>(account?.accountType ?? 'payment')
  const [currency,    setCurrency]    = useState<Currency>(account?.currency ?? 'EGP')
  const [balance,     setBalance]     = useState(account?.balance     ?? 0)
  const [last4,       setLast4]       = useState(account?.last4       ?? '')
  const [emoji,       setEmoji]       = useState(account?.emoji       ?? '🏦')
  const [color,       setColor]       = useState(account?.color       ?? '#8C8071')

  function handleSave() {
    const saved: Account = {
      id:          account?.id ?? crypto.randomUUID(),
      name:        name.trim(),
      bank:        bank.trim(),
      accountType,
      currency,
      balance:     Number(balance),
      last4:       last4 || undefined,
      emoji:       emoji || '🏦',
      color,
      sortOrder:   account?.sortOrder ?? 0,
    }
    onSave(saved)
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 8,
    border: `1px solid ${theme.border}`,
    background: theme.bg,
    color: theme.text,
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box' as const,
    fontFamily: 'inherit',
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 12,
    color: theme.textDim,
    marginBottom: 5,
    fontWeight: 500,
  }

  const fieldStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column' as const,
  }

  return (
    /* Overlay */
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      {/* Panel */}
      <div style={{
        width: 460,
        maxHeight: '90vh',
        overflowY: 'auto',
        background: theme.surface,
        borderRadius: 16,
        boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
        padding: '24px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
      }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: theme.text }}>
            {isEdit ? 'Edit Account' : 'New Account'}
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 20,
              color: theme.textDim,
              lineHeight: 1,
              padding: '0 4px',
              fontFamily: 'inherit',
            }}
          >
            ✕
          </button>
        </div>

        {/* Form */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Name */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Name</label>
            <input
              style={inputStyle}
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="My Checking Account"
            />
          </div>

          {/* Bank */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Bank</label>
            <input
              style={inputStyle}
              type="text"
              value={bank}
              onChange={e => setBank(e.target.value)}
              placeholder="CIB / NBE / Other"
            />
          </div>

          {/* Account Type */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Account Type</label>
            <select
              style={inputStyle}
              value={accountType}
              onChange={e => setAccountType(e.target.value as AccountType)}
            >
              <option value="payment">Payment</option>
              <option value="credit_card">Credit Card</option>
              <option value="asset">Asset</option>
              <option value="wallet">Wallet</option>
            </select>
          </div>

          {/* Currency */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Currency</label>
            <select
              style={inputStyle}
              value={currency}
              onChange={e => setCurrency(e.target.value as Currency)}
            >
              <option value="EGP">EGP</option>
              <option value="USD">USD</option>
              <option value="AED">AED</option>
            </select>
          </div>

          {/* Balance */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Balance</label>
            <input
              style={inputStyle}
              type="number"
              value={balance}
              onChange={e => setBalance(Number(e.target.value))}
            />
          </div>

          {/* Last 4 digits */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Last 4 digits</label>
            <input
              style={inputStyle}
              type="text"
              value={last4}
              onChange={e => setLast4(e.target.value.slice(0, 4))}
              maxLength={4}
              placeholder="1234"
            />
          </div>

          {/* Emoji icon */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Emoji icon</label>
            <input
              style={inputStyle}
              type="text"
              value={emoji}
              onChange={e => setEmoji(e.target.value.slice(0, 2))}
              maxLength={2}
              placeholder="🏦"
            />
          </div>

          {/* Color */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Color</label>
            <input
              style={{ ...inputStyle, padding: '6px 12px', height: 40, cursor: 'pointer' }}
              type="color"
              value={color}
              onChange={e => setColor(e.target.value)}
            />
          </div>

        </div>

        {/* Footer */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 8,
          paddingTop: 8,
          borderTop: `1px solid ${theme.border}`,
        }}>
          {/* Cancel */}
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 14,
              color: theme.textDim,
              padding: '8px 14px',
              fontFamily: 'inherit',
              borderRadius: 8,
            }}
          >
            Cancel
          </button>

          {/* Delete (edit mode only) */}
          {isEdit && onDelete && (
            <button
              onClick={() => { onDelete(account!.id); onClose() }}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: 14,
                color: RED,
                padding: '8px 14px',
                fontFamily: 'inherit',
                borderRadius: 8,
              }}
            >
              Delete
            </button>
          )}

          {/* Save */}
          <button
            onClick={handleSave}
            style={{
              background: theme.accent,
              border: 'none',
              cursor: 'pointer',
              fontSize: 14,
              color: '#fff',
              padding: '8px 20px',
              fontFamily: 'inherit',
              borderRadius: 8,
              fontWeight: 600,
            }}
          >
            Save
          </button>
        </div>

      </div>
    </div>
  )
}

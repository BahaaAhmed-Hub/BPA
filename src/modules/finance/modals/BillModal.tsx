import { useState } from 'react'
import type { Bill, BillFrequency, Category, Account, Currency } from '../types'
import { IconPicker } from '../components/IconPicker'

const RED   = '#DA4A3E'
const GREEN = '#2FA869'
void GREEN

interface Props {
  bill?: Bill | null
  categories: Category[]
  accounts: Account[]
  onSave: (b: Bill) => void
  onDelete?: (id: string) => void
  onClose: () => void
}

export function BillModal({ bill, categories, accounts, onSave, onDelete, onClose }: Props) {
  const isEdit = !!bill

  const todayStr = new Date().toISOString().slice(0, 10)

  const [name,       setName]       = useState(bill?.name       ?? '')
  const [icon,       setIcon]       = useState(bill?.icon       ?? '🔁')
  const [amount,     setAmount]     = useState(bill?.amount     ?? 0)
  const [currency,   setCurrency]   = useState<Currency>(bill?.currency   ?? 'EGP')
  const [isIncome,   setIsIncome]   = useState(bill?.isIncome   ?? false)
  const [frequency,  setFrequency]  = useState<BillFrequency>(bill?.frequency  ?? 'monthly')
  const [nextDue,    setNextDue]    = useState(bill?.nextDue    ?? todayStr)
  const [accountId,  setAccountId]  = useState(bill?.accountId  ?? '')
  const [categoryId, setCategoryId] = useState(bill?.categoryId ?? '')

  function handleSave() {
    const saved: Bill = {
      id:         bill?.id ?? crypto.randomUUID(),
      name:       name.trim(),
      icon:       icon || '🔁',
      amount:     Number(amount),
      currency,
      isIncome,
      frequency,
      nextDue,
      accountId:  accountId  || undefined,
      categoryId: categoryId || undefined,
      isActive:   bill?.isActive ?? true,
    }
    onSave(saved)
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 8,
    border: `1px solid ${'#E8E1CE'}`,
    background: '#F7F4EA',
    color: '#191712',
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box' as const,
    fontFamily: 'inherit',
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 12,
    color: '#6C6553',
    marginBottom: 5,
    fontWeight: 500,
  }

  const fieldStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column' as const,
  }

  return (
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
      <div style={{
        width: 460,
        maxHeight: '90vh',
        overflowY: 'auto',
        background: '#FFFFFF',
        borderRadius: 16,
        boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
        padding: '24px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
      }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: '#191712' }}>
            {isEdit ? 'Edit Bill' : 'New Bill'}
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 20,
              color: '#6C6553',
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
              placeholder="e.g. Netflix, Rent"
            />
          </div>

          {/* Icon */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Icon</label>
            <IconPicker value={icon} onChange={setIcon} size={44} />
          </div>

          {/* Amount */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Amount</label>
            <input
              style={inputStyle}
              type="number"
              min={0}
              step="0.01"
              value={amount}
              onChange={e => setAmount(Number(e.target.value))}
            />
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

          {/* Is Income toggle */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Type</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setIsIncome(false)}
                style={{
                  flex: 1,
                  padding: '9px 0',
                  borderRadius: 8,
                  border: `1px solid ${!isIncome ? RED : '#E8E1CE'}`,
                  background: !isIncome ? `${RED}20` : 'transparent',
                  color: !isIncome ? RED : '#6C6553',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Expense
              </button>
              <button
                onClick={() => setIsIncome(true)}
                style={{
                  flex: 1,
                  padding: '9px 0',
                  borderRadius: 8,
                  border: `1px solid ${isIncome ? GREEN : '#E8E1CE'}`,
                  background: isIncome ? `${GREEN}20` : 'transparent',
                  color: isIncome ? GREEN : '#6C6553',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Income
              </button>
            </div>
          </div>

          {/* Frequency */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Frequency</label>
            <select
              style={inputStyle}
              value={frequency}
              onChange={e => setFrequency(e.target.value as BillFrequency)}
            >
              <option value="monthly">Monthly</option>
              <option value="weekly">Weekly</option>
              <option value="yearly">Yearly</option>
              <option value="quarterly">Quarterly</option>
            </select>
          </div>

          {/* Next Due */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Next Due</label>
            <input
              style={inputStyle}
              type="date"
              value={nextDue}
              onChange={e => setNextDue(e.target.value)}
            />
          </div>

          {/* Account */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Account (optional)</label>
            <select
              style={inputStyle}
              value={accountId}
              onChange={e => setAccountId(e.target.value)}
            >
              <option value="">— none —</option>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>
                  {a.emoji} {a.name}
                </option>
              ))}
            </select>
          </div>

          {/* Category */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Category (optional)</label>
            <select
              style={inputStyle}
              value={categoryId}
              onChange={e => setCategoryId(e.target.value)}
            >
              <option value="">— none —</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>
                  {c.icon} {c.name}
                </option>
              ))}
            </select>
          </div>

        </div>

        {/* Footer */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 8,
          paddingTop: 8,
          borderTop: `1px solid ${'#E8E1CE'}`,
        }}>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 14,
              color: '#6C6553',
              padding: '8px 14px',
              fontFamily: 'inherit',
              borderRadius: 8,
            }}
          >
            Cancel
          </button>

          {isEdit && onDelete && (
            <button
              onClick={() => { onDelete(bill!.id); onClose() }}
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

          <button
            onClick={handleSave}
            style={{
              background: '#F5D14E',
              border: 'none',
              cursor: 'pointer',
              fontSize: 14,
              color: '#191712',
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

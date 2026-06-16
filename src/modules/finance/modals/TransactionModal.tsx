import { useState } from 'react'
import { useUIStore } from '@/store/uiStore'
import { getTheme } from '@/lib/themes'
import type { Transaction, Account, Category, Currency, TxType } from '../types'

const RED   = '#DA4A3E'
const GREEN = '#2FA869'
void GREEN

interface Props {
  transaction?: Transaction | null
  accounts: Account[]
  categories: Category[]
  onSave: (tx: Transaction) => void
  onDelete?: (id: string) => void
  onClose: () => void
}

export function TransactionModal({ transaction, accounts, categories, onSave, onDelete, onClose }: Props) {
  const theme = getTheme(useUIStore(s => s.themeId))
  const isEdit = !!transaction

  const todayStr = new Date().toISOString().slice(0, 10)

  const [type,       setType]       = useState<TxType>(transaction?.type       ?? 'expense')
  const [amount,     setAmount]     = useState(transaction?.amount              ?? 0)
  const [currency,   setCurrency]   = useState<Currency>(transaction?.currency  ?? 'EGP')
  const [payee,      setPayee]      = useState(transaction?.payee               ?? '')
  const [accountId,  setAccountId]  = useState(transaction?.accountId           ?? (accounts[0]?.id ?? ''))
  const [categoryId, setCategoryId] = useState(transaction?.categoryId          ?? '')
  const [date,       setDate]       = useState(transaction?.date                ?? todayStr)
  const [note,       setNote]       = useState(transaction?.note                ?? '')
  const [isCleared,  setIsCleared]  = useState(transaction?.isCleared           ?? false)

  function handleSave() {
    const saved: Transaction = {
      id:          transaction?.id ?? crypto.randomUUID(),
      accountId,
      amount:      Number(amount),
      currency,
      type,
      payee:       payee.trim(),
      categoryId:  categoryId || undefined,
      date,
      note:        note.trim() || undefined,
      isCleared,
      isRecurring: transaction?.isRecurring ?? false,
      createdAt:   transaction?.createdAt   ?? new Date().toISOString(),
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
            {isEdit ? 'Edit Transaction' : 'New Transaction'}
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

          {/* Type */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Type</label>
            <select
              style={inputStyle}
              value={type}
              onChange={e => setType(e.target.value as TxType)}
            >
              <option value="expense">Expense</option>
              <option value="income">Income</option>
              <option value="transfer">Transfer</option>
            </select>
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

          {/* Payee */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Payee</label>
            <input
              style={inputStyle}
              type="text"
              value={payee}
              onChange={e => setPayee(e.target.value)}
              placeholder="e.g. Carrefour"
            />
          </div>

          {/* Account */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Account</label>
            <select
              style={inputStyle}
              value={accountId}
              onChange={e => setAccountId(e.target.value)}
            >
              {accounts.map(a => (
                <option key={a.id} value={a.id}>
                  {a.emoji} {a.name}
                </option>
              ))}
              {accounts.length === 0 && <option value="">No accounts</option>}
            </select>
          </div>

          {/* Category */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Category</label>
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

          {/* Date */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Date</label>
            <input
              style={inputStyle}
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
            />
          </div>

          {/* Note */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Note (optional)</label>
            <textarea
              style={{
                ...inputStyle,
                resize: 'vertical' as const,
                minHeight: 64,
              }}
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Any additional notes…"
            />
          </div>

          {/* Cleared */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              id="cleared-cb"
              type="checkbox"
              checked={isCleared}
              onChange={e => setIsCleared(e.target.checked)}
              style={{ width: 16, height: 16, cursor: 'pointer', accentColor: theme.accent }}
            />
            <label htmlFor="cleared-cb" style={{ fontSize: 14, color: theme.textDim, cursor: 'pointer' }}>
              Cleared
            </label>
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

          {isEdit && onDelete && (
            <button
              onClick={() => { onDelete(transaction!.id); onClose() }}
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

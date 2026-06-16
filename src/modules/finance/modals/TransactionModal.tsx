import { useState, useRef } from 'react'
import { useUIStore } from '@/store/uiStore'
import { getTheme } from '@/lib/themes'
import type { Transaction, Account, Category, Currency, TxType } from '../types'

const RED   = '#DA4A3E'
const GREEN = '#2FA869'
const BLUE  = '#3B82F6'

interface Props {
  transaction?: Transaction | null
  accounts: Account[]
  categories: Category[]
  onSave: (tx: Transaction) => void
  onDelete?: (id: string) => void
  onClose: () => void
}

function AccountIcon({ account }: { account: Account | undefined }) {
  if (!account) return <span style={{ fontSize: 18 }}>🏦</span>
  if (account.emoji.startsWith('data:') || account.emoji.startsWith('http')) {
    return <img src={account.emoji} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
  }
  return <span style={{ fontSize: 18 }}>{account.emoji}</span>
}

export function TransactionModal({ transaction, accounts, categories, onSave, onDelete, onClose }: Props) {
  const theme = getTheme(useUIStore(s => s.themeId))
  const isEdit = !!transaction

  const todayStr = new Date().toISOString().slice(0, 10)

  const [type,        setType]        = useState<TxType>(transaction?.type       ?? 'expense')
  const [amountStr,   setAmountStr]   = useState(String(transaction?.amount      ?? ''))
  const [currency,    setCurrency]    = useState<Currency>(transaction?.currency  ?? 'EGP')
  const [payee,       setPayee]       = useState(transaction?.payee               ?? '')
  const [note,        setNote]        = useState(transaction?.note                ?? '')
  const [accountId,   setAccountId]   = useState(transaction?.accountId           ?? (accounts[0]?.id ?? ''))
  const [categoryId,  setCategoryId]  = useState(transaction?.categoryId          ?? '')
  const [date,        setDate]        = useState(transaction?.date                ?? todayStr)
  const [isCleared,   setIsCleared]   = useState(transaction?.isCleared           ?? false)
  const [attachments, setAttachments] = useState<string[]>(transaction?.attachments ?? [])
  const [tags,        setTags]        = useState<string[]>(transaction?.tags        ?? [])
  const [tagInput,    setTagInput]    = useState('')
  const [showTagInput, setShowTagInput] = useState(false)

  const [showAccountPicker,  setShowAccountPicker]  = useState(false)
  const [showCategoryPicker, setShowCategoryPicker] = useState(false)
  const [editingAmount,      setEditingAmount]      = useState(false)

  const amountRef  = useRef<HTMLInputElement>(null)
  const payeeRef   = useRef<HTMLInputElement>(null)
  const noteRef    = useRef<HTMLTextAreaElement>(null)
  const fileRef    = useRef<HTMLInputElement>(null)
  const tagInputRef = useRef<HTMLInputElement>(null)

  const selectedAccount  = accounts.find(a => a.id === accountId)
  const selectedCategory = categories.find(c => c.id === categoryId)

  const TYPE_CYCLE: TxType[] = ['expense', 'income', 'transfer']
  const typeLabel = type === 'expense' ? 'Expense' : type === 'income' ? 'Income' : 'Transfer'
  const typeColor = type === 'expense' ? RED : type === 'income' ? GREEN : theme.accent

  function cycleType() {
    const idx = TYPE_CYCLE.indexOf(type)
    setType(TYPE_CYCLE[(idx + 1) % TYPE_CYCLE.length])
  }

  function handleSave() {
    onSave({
      id:          transaction?.id ?? crypto.randomUUID(),
      accountId,
      amount:      parseFloat(amountStr) || 0,
      currency,
      type,
      payee:       payee.trim(),
      categoryId:  categoryId || undefined,
      date,
      note:        note.trim() || undefined,
      attachments: attachments.length > 0 ? attachments : undefined,
      tags:        tags.length > 0 ? tags : undefined,
      isCleared,
      isRecurring: transaction?.isRecurring ?? false,
      createdAt:   transaction?.createdAt   ?? new Date().toISOString(),
    })
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    files.forEach(file => {
      const reader = new FileReader()
      reader.onload = ev => {
        const result = ev.target?.result as string
        if (result) setAttachments(prev => [...prev, result])
      }
      reader.readAsDataURL(file)
    })
    // Reset so same file can be re-added
    e.target.value = ''
  }

  function addTag(raw: string) {
    const t = raw.trim().replace(/,$/, '').trim()
    if (t && !tags.includes(t)) setTags(prev => [...prev, t])
    setTagInput('')
  }

  function handleTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(tagInput)
    }
    if (e.key === 'Backspace' && tagInput === '' && tags.length > 0) {
      setTags(prev => prev.slice(0, -1))
    }
  }

  const displayAmount = (parseFloat(amountStr) || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })

  const ROW: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '13px 20px', borderBottom: `1px solid ${theme.border}`,
    cursor: 'pointer',
  }

  // Toolbar button — "active" when its section has content
  function ToolBtn({
    title, active, onClick, children,
  }: {
    title: string; active?: boolean; onClick?: () => void; children: React.ReactNode
  }) {
    return (
      <button
        title={title}
        onClick={onClick}
        style={{
          background:   active ? theme.accentFill : 'none',
          border:       `1.5px solid ${active ? theme.accent : theme.border}`,
          borderRadius: 10,
          width: 46, height: 46,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer',
          color: active ? theme.accent : theme.textDim,
        }}
      >
        {children}
      </button>
    )
  }

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      {/* Hidden file input */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      <div style={{
        width: 400,
        background: theme.surface,
        borderRadius: 20,
        boxShadow: '0 32px 80px rgba(0,0,0,0.6)',
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        maxHeight: '90vh',
        overflowY: 'auto',
      }}>

        {/* ── Header: Cancel | Type | Save ── */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'center', padding: '15px 20px',
          borderBottom: `1px solid ${theme.border}`,
        }}>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 15, color: theme.textDim, textAlign: 'left',
              fontFamily: 'inherit', padding: 0,
            }}
          >
            Cancel
          </button>

          <button
            onClick={cycleType}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 16, fontWeight: 700, color: typeColor,
              fontFamily: 'inherit', padding: '4px 10px',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            {typeLabel}
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>

          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10 }}>
            {isEdit && onDelete && (
              <button
                onClick={() => { onDelete(transaction!.id); onClose() }}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 13, color: RED, fontFamily: 'inherit', padding: 0,
                }}
              >
                Delete
              </button>
            )}
            <button
              onClick={handleSave}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 15, fontWeight: 700, color: theme.accent,
                fontFamily: 'inherit', padding: 0,
              }}
            >
              Save
            </button>
          </div>
        </div>

        {/* ── Account row ── */}
        <div
          onClick={() => { setShowAccountPicker(p => !p); setShowCategoryPicker(false) }}
          style={ROW}
        >
          <div style={{
            width: 36, height: 36, borderRadius: 10, overflow: 'hidden', flexShrink: 0,
            background: selectedAccount ? `${selectedAccount.color}22` : theme.bg,
            border: `1px solid ${selectedAccount ? selectedAccount.color + '44' : theme.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <AccountIcon account={selectedAccount} />
          </div>
          <span style={{ flex: 1, fontSize: 15, fontWeight: 500, color: theme.text }}>
            {selectedAccount?.name ?? 'No Account'}
          </span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={theme.textDim} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </div>

        {/* Account picker */}
        {showAccountPicker && (
          <div style={{ background: theme.bg, borderBottom: `1px solid ${theme.border}`, maxHeight: 180, overflowY: 'auto' }}>
            {accounts.map(a => (
              <div
                key={a.id}
                onClick={() => { setAccountId(a.id); setShowAccountPicker(false) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 20px', cursor: 'pointer',
                  background: a.id === accountId ? `${theme.accent}18` : 'transparent',
                }}
              >
                <div style={{
                  width: 28, height: 28, borderRadius: 7, overflow: 'hidden', flexShrink: 0,
                  background: `${a.color}22`, border: `1px solid ${a.color}44`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {a.emoji.startsWith('data:') || a.emoji.startsWith('http') ? (
                    <img src={a.emoji} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : <span style={{ fontSize: 15 }}>{a.emoji}</span>}
                </div>
                <span style={{ flex: 1, fontSize: 14, color: theme.text }}>{a.name}</span>
                {a.id === accountId && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={theme.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
              </div>
            ))}
            {accounts.length === 0 && (
              <div style={{ padding: '10px 20px', fontSize: 13, color: theme.textDim }}>No accounts yet</div>
            )}
          </div>
        )}

        {/* ── Category + Amount row ── */}
        <div style={{ borderBottom: `1px solid ${theme.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>

            {/* Category side */}
            <div
              onClick={() => { setShowCategoryPicker(p => !p); setShowAccountPicker(false) }}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', gap: 10,
                padding: '13px 16px', cursor: 'pointer',
                borderRight: `1px solid ${theme.border}`,
              }}
            >
              {selectedCategory && (
                <div style={{
                  width: 28, height: 28, borderRadius: 7, overflow: 'hidden', flexShrink: 0,
                  background: `${selectedCategory.color}22`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <span style={{ fontSize: 15 }}>{selectedCategory.icon}</span>
                </div>
              )}
              <span style={{ fontSize: 14, color: selectedCategory ? theme.text : theme.textDim }}>
                {selectedCategory?.name ?? 'No Category'}
              </span>
            </div>

            {/* Amount + currency side */}
            <div
              onClick={() => { setEditingAmount(true); setTimeout(() => amountRef.current?.select(), 30) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '13px 16px', cursor: 'text', flexShrink: 0,
              }}
            >
              <select
                value={currency}
                onChange={e => setCurrency(e.target.value as Currency)}
                onClick={e => e.stopPropagation()}
                style={{
                  background: 'transparent', border: 'none', outline: 'none',
                  color: theme.textDim, fontSize: 13, fontFamily: 'inherit',
                  cursor: 'pointer', padding: 0, appearance: 'none' as const,
                }}
              >
                <option value="EGP">EGP</option>
                <option value="USD">USD</option>
                <option value="AED">AED</option>
              </select>

              {editingAmount ? (
                <input
                  ref={amountRef}
                  type="number"
                  min={0}
                  step="0.01"
                  value={amountStr}
                  onChange={e => setAmountStr(e.target.value)}
                  onBlur={() => setEditingAmount(false)}
                  style={{
                    width: 90, background: 'transparent', border: 'none', outline: 'none',
                    color: typeColor, fontSize: 16, fontWeight: 700,
                    fontFamily: 'inherit', textAlign: 'right', padding: 0,
                  }}
                />
              ) : (
                <span style={{ fontSize: 16, fontWeight: 700, color: typeColor }}>
                  {displayAmount}
                </span>
              )}
            </div>
          </div>

          {/* Category picker */}
          {showCategoryPicker && (
            <div style={{ background: theme.bg, borderTop: `1px solid ${theme.border}`, maxHeight: 200, overflowY: 'auto' }}>
              <div
                onClick={() => { setCategoryId(''); setShowCategoryPicker(false) }}
                style={{
                  padding: '10px 20px', cursor: 'pointer', fontSize: 14,
                  color: !categoryId ? theme.accent : theme.textDim,
                  background: !categoryId ? `${theme.accent}18` : 'transparent',
                }}
              >
                No Category
              </div>
              {categories.map(c => (
                <div
                  key={c.id}
                  onClick={() => { setCategoryId(c.id); setShowCategoryPicker(false) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 20px', cursor: 'pointer',
                    background: c.id === categoryId ? `${theme.accent}18` : 'transparent',
                  }}
                >
                  <span style={{ fontSize: 15 }}>{c.icon}</span>
                  <span style={{ flex: 1, fontSize: 14, color: theme.text }}>{c.name}</span>
                  {c.id === categoryId && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={theme.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Payee row ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '13px 20px', borderBottom: `1px solid ${theme.border}`,
        }}>
          <input
            ref={payeeRef}
            type="text"
            value={payee}
            onChange={e => setPayee(e.target.value)}
            placeholder="Payee..."
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: theme.text, fontSize: 14, fontFamily: 'inherit',
            }}
          />
          {payee ? (
            <button
              onClick={() => setPayee('')}
              style={{
                background: theme.border, border: 'none', cursor: 'pointer',
                borderRadius: '50%', width: 20, height: 20,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: theme.textDim, fontSize: 11, flexShrink: 0, lineHeight: 1,
              }}
            >✕</button>
          ) : (
            <button
              onClick={() => payeeRef.current?.focus()}
              style={{
                background: 'none', border: `1.5px solid ${theme.border}`,
                borderRadius: '50%', width: 26, height: 26,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: theme.textDim, flexShrink: 0,
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M12 5v14M5 12h14"/>
              </svg>
            </button>
          )}
        </div>

        {/* ── Note textarea — always visible ── */}
        <div style={{ borderBottom: `1px solid ${theme.border}` }}>
          <textarea
            ref={noteRef}
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Description..."
            rows={3}
            style={{
              width: '100%', background: 'transparent', border: 'none', outline: 'none',
              color: theme.text, fontSize: 13, fontFamily: 'inherit',
              resize: 'none', padding: '10px 20px', boxSizing: 'border-box',
            }}
          />
        </div>

        {/* ── Attachment thumbnail strip ── */}
        {attachments.length > 0 && (
          <div style={{
            display: 'flex', gap: 8, padding: '10px 20px',
            borderBottom: `1px solid ${theme.border}`,
            flexWrap: 'wrap',
          }}>
            {attachments.map((src, i) => (
              <div key={i} style={{ position: 'relative', flexShrink: 0 }}>
                <img
                  src={src}
                  alt={`attachment ${i + 1}`}
                  style={{
                    width: 40, height: 40, borderRadius: 6,
                    objectFit: 'cover',
                    border: `1px solid ${theme.border}`,
                  }}
                />
                <button
                  onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}
                  style={{
                    position: 'absolute', top: -6, right: -6,
                    background: RED, border: 'none', borderRadius: '50%',
                    width: 16, height: 16, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontSize: 9, lineHeight: 1,
                  }}
                >✕</button>
              </div>
            ))}
          </div>
        )}

        {/* ── Tags row ── */}
        {(tags.length > 0 || showTagInput) && (
          <div style={{
            display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6,
            padding: '10px 20px', borderBottom: `1px solid ${theme.border}`,
          }}>
            {tags.map((tag, i) => (
              <span
                key={i}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  background: theme.accentFill, color: theme.accent,
                  border: `1px solid ${theme.accent}44`,
                  borderRadius: 20, padding: '3px 8px', fontSize: 12,
                }}
              >
                #{tag}
                <button
                  onClick={() => setTags(prev => prev.filter((_, j) => j !== i))}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: theme.accent, fontSize: 10, padding: 0, lineHeight: 1,
                    display: 'flex', alignItems: 'center',
                  }}
                >✕</button>
              </span>
            ))}
            {showTagInput && (
              <input
                ref={tagInputRef}
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                onBlur={() => { if (tagInput) addTag(tagInput); setShowTagInput(false) }}
                placeholder="Add tag..."
                style={{
                  background: 'transparent', border: 'none', outline: 'none',
                  color: theme.text, fontSize: 13, fontFamily: 'inherit',
                  minWidth: 80, flex: 1,
                }}
              />
            )}
          </div>
        )}

        {/* ── Date + Paid toggle ── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '13px 20px', borderBottom: `1px solid ${theme.border}`,
        }}>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            style={{
              background: 'transparent', border: 'none', outline: 'none',
              color: theme.text, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer',
            }}
          />
          <button
            onClick={() => setIsCleared(p => !p)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: 700, letterSpacing: '0.5px',
              color: isCleared ? BLUE : theme.textDim,
              fontFamily: 'inherit',
            }}
          >
            PAID
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {isCleared ? (
                <>
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                  <polyline points="22 4 12 14.01 9 11.01"/>
                </>
              ) : (
                <circle cx="12" cy="12" r="10"/>
              )}
            </svg>
          </button>
        </div>

        {/* ── Bottom toolbar ── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-around',
          padding: '14px 20px',
        }}>
          {/* 💬 Note */}
          <ToolBtn
            title="Note"
            active={note.trim().length > 0}
            onClick={() => noteRef.current?.focus()}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </ToolBtn>

          {/* 🖼 Attachment */}
          <ToolBtn
            title="Attachment"
            active={attachments.length > 0}
            onClick={() => fileRef.current?.click()}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
          </ToolBtn>

          {/* # Tag */}
          <ToolBtn
            title="Tag"
            active={tags.length > 0}
            onClick={() => {
              setShowTagInput(true)
              setTimeout(() => tagInputRef.current?.focus(), 30)
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
              <line x1="7" y1="7" x2="7.01" y2="7"/>
            </svg>
          </ToolBtn>

          {/* 👤 Payee */}
          <ToolBtn
            title="Payee"
            active={payee.trim().length > 0}
            onClick={() => payeeRef.current?.focus()}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
          </ToolBtn>

          {/* 🗂 Receipt / File */}
          <ToolBtn
            title="Receipt"
            active={attachments.length > 0}
            onClick={() => fileRef.current?.click()}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
          </ToolBtn>
        </div>

      </div>
    </div>
  )
}

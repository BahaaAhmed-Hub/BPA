import { useState, useRef } from 'react'
import { X, ChevronDown, Plus, Paperclip, Check } from 'lucide-react'
import type { Transaction, Account, Category, Currency, TxType } from '../types'

// ─── The panel's own vocabulary ───────────────────────────────────────────────
// Same set the calendar's event panel uses: one pill for every value whether
// you type in it, pick from it or only read it; one label column everything
// hangs off; a black pill for the one action that commits.

const INK    = '#191712'
const MUTED  = '#6C6553'
const GHOST  = '#9B9180'
const LINE   = '#E8E1CE'
const HAIR   = '#F0EBDC'
const OLIVE  = '#5F7038'
const RUST   = '#B4523A'
const AMBER  = '#F5D14E'
const DISPLAY = "'Outfit', system-ui, sans-serif"

const PILL: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, height: 42, boxSizing: 'border-box',
  padding: '0 14px', borderRadius: 10, background: '#FFFFFF', border: `1px solid ${LINE}`,
  color: INK, fontSize: 13.5, fontFamily: 'inherit', cursor: 'pointer', minWidth: 0,
}
const ROUND: React.CSSProperties = {
  width: 30, height: 30, borderRadius: '50%', flexShrink: 0, padding: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: '#FFFFFF', border: `1px solid ${LINE}`, color: MUTED, cursor: 'pointer',
}
const LABEL: React.CSSProperties = {
  width: 74, flexShrink: 0, fontSize: 13.5, color: MUTED, fontWeight: 500,
}
const ROW: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10,
}
const SECTION: React.CSSProperties = {
  fontFamily: DISPLAY, fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em', color: INK,
}
const RULE: React.CSSProperties = { height: 1, background: HAIR, margin: '18px 0' }

/** A select you cannot see, sitting exactly on top of a pill you can. The
 *  browser's own picker is the right control on a phone and an iPad, and it is
 *  the one the calendar panel uses for the same job. */
function PillSelect({ value, onChange, children, label }: {
  value: string
  onChange: (v: string) => void
  children: React.ReactNode
  label: React.ReactNode
}) {
  return (
    <span style={{ flex: 1, minWidth: 0, position: 'relative', display: 'flex' }}>
      <span style={{ ...PILL, flex: 1, justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
        <ChevronDown size={13} strokeWidth={2} style={{ color: GHOST, flexShrink: 0 }} />
      </span>
      <select value={value} onChange={e => onChange(e.target.value)}
        style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', border: 'none' }}>
        {children}
      </select>
    </span>
  )
}

function AccountGlyph({ account, size = 20 }: { account?: Account; size?: number }) {
  if (!account) return <span style={{ fontSize: size * 0.75 }}>🏦</span>
  const isImg = account.emoji.startsWith('data:') || account.emoji.startsWith('http')
  return (
    <span style={{
      width: size, height: size, borderRadius: 6, flexShrink: 0, overflow: 'hidden',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: `${account.color}22`,
    }}>
      {isImg
        ? <img src={account.emoji} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <span style={{ fontSize: size * 0.62 }}>{account.emoji}</span>}
    </span>
  )
}

interface Props {
  transaction?: Transaction | null
  accounts: Account[]
  categories: Category[]
  onSave: (tx: Transaction) => void
  onDelete?: (id: string) => void
  onClose: () => void
}

const TYPES: { id: TxType; label: string }[] = [
  { id: 'expense',  label: 'Expense' },
  { id: 'income',   label: 'Income' },
  { id: 'transfer', label: 'Transfer' },
]

export function TransactionModal({ transaction, accounts, categories, onSave, onDelete, onClose }: Props) {
  const isEdit = !!transaction
  const todayStr = new Date().toISOString().slice(0, 10)

  const [type,        setType]        = useState<TxType>(transaction?.type        ?? 'expense')
  const [amountStr,   setAmountStr]   = useState(String(transaction?.amount       ?? ''))
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

  const fileRef = useRef<HTMLInputElement>(null)

  const selectedAccount  = accounts.find(a => a.id === accountId)
  const selectedCategory = categories.find(c => c.id === categoryId)

  // Rust and olive are the platform's negative and positive. An expense should
  // still read as money leaving without a second palette to learn.
  const typeColor = type === 'expense' ? RUST : type === 'income' ? OLIVE : INK
  const amount = parseFloat(amountStr) || 0

  function handleSave() {
    onSave({
      id:          transaction?.id ?? crypto.randomUUID(),
      accountId,
      amount,
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
    for (const file of Array.from(e.target.files ?? [])) {
      const reader = new FileReader()
      reader.onload = ev => {
        const result = ev.target?.result as string
        if (result) setAttachments(prev => [...prev, result])
      }
      reader.readAsDataURL(file)
    }
    e.target.value = ''   // so the same file can be picked again
  }

  function addTag(raw: string) {
    const t = raw.trim().replace(/,$/, '').trim()
    if (t && !tags.includes(t)) setTags(prev => [...prev, t])
    setTagInput('')
  }

  const canSave = amount > 0 && !!accountId

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(25,23,18,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18,
      }}>

      <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple
        style={{ display: 'none' }} onChange={handleFileChange} />

      <div style={{
        width: 'clamp(320px, 94vw, 460px)', maxHeight: '90vh', overflowY: 'auto',
        boxSizing: 'border-box', scrollbarWidth: 'thin',
        background: '#FFFFFF', border: `1px solid ${LINE}`, borderRadius: 18,
        boxShadow: '0 24px 60px rgba(25,23,18,0.24)',
        padding: '18px 20px 22px',
      }}>

        {/* Which kind of thing this is, and the way out */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 11px',
            borderRadius: 999, background: '#F1ECDE', color: '#4A4438', fontSize: 11.5,
          }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: typeColor, flexShrink: 0 }} />
            {isEdit ? 'Transaction' : 'New transaction'}
          </span>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} title="Close" style={ROUND}><X size={14} /></button>
        </div>

        {/* Type — three choices you can see, rather than a title that cycles */}
        <div style={{
          display: 'flex', gap: 2, padding: 3, marginTop: 14,
          borderRadius: 999, background: '#EDE7D9',
        }}>
          {TYPES.map(t => {
            const on = type === t.id
            return (
              <button key={t.id} onClick={() => setType(t.id)} aria-pressed={on}
                style={{
                  flex: 1, height: 32, borderRadius: 999, border: 'none', fontFamily: 'inherit',
                  background: on ? INK : 'transparent', color: on ? '#FDF8E7' : MUTED,
                  fontSize: 12.5, fontWeight: on ? 600 : 500, cursor: 'pointer',
                }}>{t.label}</button>
            )
          })}
        </div>

        {/* The amount is what this panel is about, so it is the biggest thing in it */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, marginTop: 12,
          padding: '0 15px', height: 66, borderRadius: 12,
          background: '#FAF7EC', border: `1px solid ${LINE}`,
        }}>
          <span style={{ position: 'relative', display: 'flex', flexShrink: 0 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, height: 30, padding: '0 10px',
              borderRadius: 8, background: '#FFFFFF', border: `1px solid ${LINE}`,
              fontSize: 12, fontWeight: 600, color: MUTED,
            }}>
              {currency}
              <ChevronDown size={11} strokeWidth={2} style={{ color: GHOST }} />
            </span>
            <select value={currency} onChange={e => setCurrency(e.target.value as Currency)}
              style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', border: 'none' }}>
              <option value="EGP">EGP</option>
              <option value="USD">USD</option>
              <option value="AED">AED</option>
            </select>
          </span>
          <input
            type="number" min={0} step="0.01" inputMode="decimal"
            value={amountStr}
            onChange={e => setAmountStr(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && canSave) handleSave() }}
            placeholder="0.00"
            style={{
              flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
              fontFamily: DISPLAY, fontSize: 30, fontWeight: 700, letterSpacing: '-0.03em',
              color: amount > 0 ? typeColor : '#C9C0A8', textAlign: 'right',
              fontVariantNumeric: 'tabular-nums', padding: 0,
            }} />
        </div>

        <div style={RULE} />

        {/* Everything else hangs off one label column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={ROW}>
            <span style={LABEL}>Account</span>
            <PillSelect value={accountId} onChange={setAccountId}
              label={<>
                <AccountGlyph account={selectedAccount} />
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selectedAccount?.name ?? 'No account'}
                </span>
              </>}>
              {accounts.length === 0 && <option value="">No accounts yet</option>}
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </PillSelect>
          </div>

          <div style={ROW}>
            <span style={LABEL}>Category</span>
            <PillSelect value={categoryId} onChange={setCategoryId}
              label={<>
                {selectedCategory && <span style={{ fontSize: 14 }}>{selectedCategory.icon}</span>}
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: selectedCategory ? INK : GHOST }}>
                  {selectedCategory?.name ?? 'Uncategorised'}
                </span>
              </>}>
              <option value="">Uncategorised</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </PillSelect>
          </div>

          <div style={ROW}>
            <span style={LABEL}>Payee</span>
            <input value={payee} onChange={e => setPayee(e.target.value)}
              placeholder="Who it went to"
              style={{ ...PILL, flex: 1, cursor: 'text', outline: 'none' }} />
          </div>

          <div style={ROW}>
            <span style={LABEL}>When</span>
            <span style={{ flex: 1, minWidth: 0, display: 'flex', gap: 7 }}>
              <label style={{ ...PILL, flex: 1, position: 'relative', justifyContent: 'space-between' }}>
                {new Date(date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                <ChevronDown size={13} strokeWidth={2} style={{ color: GHOST, flexShrink: 0 }} />
                <input type="date" value={date} onChange={e => setDate(e.target.value)}
                  style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', border: 'none', padding: 0 }} />
              </label>
              <button onClick={() => setIsCleared(v => !v)} title="Money has actually moved"
                style={{
                  ...PILL, flexShrink: 0,
                  background: isCleared ? INK : '#FFFFFF',
                  border: isCleared ? 'none' : `1px solid ${LINE}`,
                  color: isCleared ? '#FDF8E7' : MUTED,
                }}>
                {isCleared && <Check size={13} strokeWidth={2.5} />} Paid
              </button>
            </span>
          </div>

          <div style={{ ...ROW, alignItems: 'flex-start' }}>
            <span style={{ ...LABEL, paddingTop: 11 }}>Notes</span>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
              placeholder="Anything worth remembering…"
              style={{
                flex: 1, minWidth: 0, boxSizing: 'border-box', resize: 'vertical',
                background: '#FFFFFF', border: `1px solid ${LINE}`, borderRadius: 9,
                padding: '9px 12px', fontSize: 13.5, color: INK, fontFamily: 'inherit',
                outline: 'none', textAlign: 'left',
              }} />
          </div>
        </div>

        <div style={RULE} />

        {/* Tags */}
        <div style={{ ...SECTION, marginBottom: 9 }}>Tags</div>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
          {tags.map(tag => (
            <span key={tag} style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, height: 28, padding: '0 6px 0 10px',
              borderRadius: 999, background: 'rgba(245,209,78,0.16)', border: `1px solid ${AMBER}55`,
              color: '#3D3926', fontSize: 12,
            }}>
              {tag}
              <button onClick={() => setTags(prev => prev.filter(t => t !== tag))} title="Remove"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED, padding: 0, display: 'flex' }}>
                <X size={12} />
              </button>
            </span>
          ))}
          <input
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagInput) }
              if (e.key === 'Backspace' && !tagInput && tags.length) setTags(prev => prev.slice(0, -1))
            }}
            onBlur={() => addTag(tagInput)}
            placeholder={tags.length ? 'Add another' : 'groceries, work…'}
            style={{ ...PILL, height: 34, flex: 1, minWidth: 120, cursor: 'text', outline: 'none', fontSize: 12.5 }} />
        </div>

        <div style={RULE} />

        {/* Receipts */}
        <div style={{ ...SECTION, marginBottom: 9 }}>Receipts</div>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          {attachments.map((src, i) => (
            <span key={i} style={{ position: 'relative', flexShrink: 0, display: 'flex' }}>
              <img src={src} alt={`Receipt ${i + 1}`} style={{
                width: 46, height: 46, borderRadius: 9, objectFit: 'cover', border: `1px solid ${LINE}`,
              }} />
              <button onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))} title="Remove"
                style={{
                  position: 'absolute', top: -6, right: -6, width: 19, height: 19, padding: 0,
                  borderRadius: '50%', background: '#FFFFFF', border: `1px solid ${LINE}`,
                  color: MUTED, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 1px 3px rgba(25,23,18,0.14)',
                }}>
                <X size={11} />
              </button>
            </span>
          ))}
          <button onClick={() => fileRef.current?.click()}
            style={{ ...PILL, height: 46, color: MUTED, gap: 7 }}>
            {attachments.length ? <Plus size={14} /> : <Paperclip size={14} />}
            {attachments.length ? 'Add another' : 'Attach a receipt'}
          </button>
        </div>

        {/* The one action that commits, and the ways not to */}
        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          <button onClick={handleSave} disabled={!canSave} style={{
            ...PILL, flex: 1, justifyContent: 'center', fontWeight: 600,
            background: canSave ? INK : '#EDE7D9',
            border: 'none', color: canSave ? '#FDF8E7' : GHOST,
            cursor: canSave ? 'pointer' : 'default',
          }}>{isEdit ? 'Save changes' : 'Add transaction'}</button>
          <button onClick={onClose} style={{ ...PILL, color: MUTED }}>Cancel</button>
        </div>

        {isEdit && onDelete && (
          <button
            onClick={() => { onDelete(transaction.id); onClose() }}
            style={{
              marginTop: 12, width: '100%', height: 34, borderRadius: 9,
              background: 'none', border: 'none', fontFamily: 'inherit',
              color: RUST, fontSize: 12.5, cursor: 'pointer',
            }}>
            Delete this transaction
          </button>
        )}
      </div>
    </div>
  )
}

import { useState, useRef, useEffect, useMemo } from 'react'
import {
  X, ChevronDown, Plus, Paperclip, Check,
  Image as ImageIcon, Hash, User, Repeat,
} from 'lucide-react'
import type { Transaction, Account, Category, Currency, TxType } from '../types'
import { knownPayees, matchPayees, rememberPayee } from '../payees'
import { MoneyInput } from '../components/MoneyInput'
import { liveBalances } from '../balances'
import { acct } from '../format'
import {
  INK, MUTED, GHOST, LINE, OLIVE, RUST, AMBER, DISPLAY,
  PILL, ROUND, LABEL, ROW, RULE, PillPicker, categoryOptions,
} from './pickers'
export type { PickOption } from './pickers'

interface Props {
  transaction?: Transaction | null
  accounts: Account[]
  categories: Category[]
  /** Every transaction there is — the payee suggestions are read from them. */
  history?: Transaction[]
  /** What a new entry should start as. Handed a whole fake transaction instead,
   *  the form would believe it was editing one that does not exist — offering
   *  to delete it, and saying "save changes" to something never saved. */
  initial?: {
    categoryId?: string; type?: TxType; accountId?: string; date?: string
    /** Where a transfer lands, and how much — used by Balances to start a card
     *  settlement off with the figure already in it. */
    toAccountId?: string; amount?: number; payee?: string
  }
  onSave: (tx: Transaction) => void
  onDelete?: (id: string) => void
  onClose: () => void
}

const TYPES: { id: TxType; label: string }[] = [
  { id: 'expense',  label: 'Expense' },
  { id: 'income',   label: 'Income' },
  { id: 'transfer', label: 'Transfer' },
]

export function TransactionModal({ transaction, accounts, categories, history = [], initial, onSave, onDelete, onClose }: Props) {
  const isEdit = !!transaction
  const todayStr = new Date().toISOString().slice(0, 10)

  const [type,        setType]        = useState<TxType>(transaction?.type        ?? initial?.type ?? 'expense')
  const [amountStr,   setAmountStr]   = useState(String(transaction?.amount ?? initial?.amount ?? ''))
  // A new entry is denominated in whatever the account it is filed against is
  // kept in: picking the USD account and typing 250 means 250 dollars. It stays
  // that way — nothing here converts it — and follows the account until the
  // currency is set by hand, after which the choice stands.
  const [currencyTouched, setCurrencyTouched] = useState(false)
  const [currency, setCurrency] = useState<Currency>(
    transaction?.currency
      ?? accounts.find(a => a.id === (initial?.accountId ?? accounts[0]?.id))?.currency
      ?? 'EGP',
  )
  const [payee,       setPayee]       = useState(transaction?.payee ?? initial?.payee ?? '')
  const [note,        setNote]        = useState(transaction?.note                ?? '')
  const [accountId,   setAccountId]   = useState(transaction?.accountId           ?? initial?.accountId ?? (accounts[0]?.id ?? ''))
  const [categoryId,  setCategoryId]  = useState(transaction?.categoryId          ?? initial?.categoryId ?? '')
  const [toAccountId, setToAccountId] = useState(transaction?.toAccountId ?? initial?.toAccountId ?? '')
  const [date, setDate] = useState(transaction?.date ?? initial?.date ?? todayStr)
  function pickDate(next: string) {
    setDate(next)
    if (paidTouched) return
    // Following the due date, and only marked paid once that day has come.
    setPaidAt(next <= todayStr ? next : '')
    setIsCleared(next <= todayStr)
  }
  // Two dates, because they are two facts: a bill due on the 1st and paid on
  // the 9th is not the same as one paid the day it landed.
  // An entry usually records something that already happened, so it is paid on
  // the day it is dated. The payment date follows the due date until it is set
  // by hand — a bill due on the 1st and paid on the 9th is two facts, but they
  // are the same fact far more often. A date in the future is the exception:
  // that money has not moved.
  const [paidTouched, setPaidTouched] = useState(!!transaction?.paidAt && transaction.paidAt !== transaction.date)
  const [paidAt, setPaidAt] = useState(
    transaction?.paidAt ?? (transaction ? '' : (initial?.date ?? todayStr) <= todayStr ? (initial?.date ?? todayStr) : ''),
  )
  const [isCleared, setIsCleared] = useState(
    transaction?.isCleared ?? (initial?.date ?? todayStr) <= todayStr,
  )
  const [isRecurring, setIsRecurring] = useState(transaction?.isRecurring         ?? false)
  const [attachments, setAttachments] = useState<string[]>(transaction?.attachments ?? [])
  const [tags,        setTags]        = useState<string[]>(transaction?.tags        ?? [])
  const [tagInput,    setTagInput]    = useState('')

  // The optional half of the form, folded away until asked for. Anything that
  // already has something in it stays open — closing a section that holds data
  // hides the data.
  // Notes are not in here: they are always on the form. Enough entries need a
  // word of explanation that hiding the field behind an icon meant it mostly
  // did not get written.
  const [openPanes, setOpenPanes] = useState<Record<string, boolean>>(() => ({
    payee:  !!(transaction?.payee ?? initial?.payee),
    tags:   !!transaction?.tags?.length,
    files:  !!transaction?.attachments?.length,
    repeat: !!transaction?.isRecurring,
  }))

  const [payeeOpen, setPayeeOpen] = useState(false)
  const payeeBox = useRef<HTMLSpanElement>(null)
  const allPayees = useMemo(() => knownPayees(history), [history])
  const payeeHits = useMemo(() => matchPayees(allPayees, payee), [allPayees, payee])

  // Escape closed the title field and nothing else, so the panel itself could
  // only be dismissed by aiming at Cancel or the backdrop.
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])

  useEffect(() => {
    if (!payeeOpen) return
    const away = (e: Event) => { if (payeeBox.current && !payeeBox.current.contains(e.target as Node)) setPayeeOpen(false) }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [payeeOpen])

  const fileRef = useRef<HTMLInputElement>(null)

  // Rust and olive are the platform's negative and positive. An expense should
  // still read as money leaving without a second palette to learn.
  const typeColor = type === 'expense' ? RUST : type === 'income' ? OLIVE : INK
  const amount = parseFloat(amountStr) || 0

  function handleSave() {
    // Remember who this went to, so it can be offered next time and typed the
    // same way rather than five slightly different ways.
    rememberPayee(payee)
    onSave({
      id:          transaction?.id ?? crypto.randomUUID(),
      accountId,
      toAccountId: type === 'transfer' ? (toAccountId || undefined) : undefined,
      amount,
      currency,
      type,
      payee:       payee.trim(),
      // A transfer is money moving between two accounts. Filing it under a
      // spending category would count it as spending as well as moving it.
      categoryId:  type === 'transfer' ? undefined : (categoryId || undefined),
      date,
      paidAt:      isCleared ? (paidAt || date) : undefined,
      note:        note.trim() || undefined,
      attachments: attachments.length > 0 ? attachments : undefined,
      tags:        tags.length > 0 ? tags : undefined,
      isCleared,
      isRecurring,
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

  // A transfer with no destination is not a transfer; it would take money out
  // of one account and put it nowhere.
  // ── The card this is going to ──────────────────────────────────────────────
  // Money reaching a credit card pays it down. Which card, and how much of the
  // debt it clears, is the thing to see while typing the amount rather than
  // after saving — so the picker names what each account holds, and a card on
  // the receiving end says what it owes and what this leaves.
  const before = useMemo(
    () => liveBalances(accounts, history.filter(t => t.id !== transaction?.id)).balances,
    [accounts, history, transaction],
  )
  const balanceOf = (id: string) => before.get(id) ?? accounts.find(a => a.id === id)?.balance ?? 0
  const accountHint = (a: Account) => {
    const bal = balanceOf(a.id)
    const kind = a.accountType === 'credit_card' ? 'Card' : a.accountType === 'wallet' ? 'Cash' : a.bank || 'Account'
    if (a.accountType === 'credit_card') {
      const owed = Math.max(0, -bal)
      return owed > 0 ? `${kind} · owes ${acct(owed, { currency: a.currency })}` : `${kind} · nothing owed`
    }
    return `${kind} · ${acct(bal, { currency: a.currency })}`
  }

  // Paying a card is a transfer — money moves between two accounts rather than
  // leaving — so which card it lands on is the To field, not the category. But
  // "Credit card" is a category people reach for first, and on an expense there
  // is no destination to pick, so nothing happens and the card never moves.
  // When the category says card and there is one to pay, offer the way across.
  const chosenCat = categories.find(c => c.id === categoryId)
  const cards = accounts.filter(a => a.accountType === 'credit_card')
  const cardish = /credit\s*card|\bcards?\b|visa|master\s*card|amex/i
  const suggestedCard = (() => {
    if (type === 'transfer' || cards.length === 0 || !chosenCat) return null
    const name = chosenCat.name.toLowerCase()
    if (!cardish.test(name)) return null
    // The card whose name the category actually names, where there is one.
    return cards.find(c => name.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(name))
      ?? (cards.length === 1 ? cards[0] : cards[0])
  })()

  const canSave = amount > 0 && !!accountId && (type !== 'transfer' || !!toAccountId)

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
              <button key={t.id}
                onClick={() => { setType(t.id); if (t.id === 'transfer') setCategoryId('') }}
                aria-pressed={on}
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
            <select value={currency}
              onChange={e => { setCurrencyTouched(true); setCurrency(e.target.value as Currency) }}
              style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', border: 'none' }}>
              <option value="EGP">EGP</option>
              <option value="USD">USD</option>
              <option value="AED">AED</option>
            </select>
          </span>
          <MoneyInput
            value={amount}
            min={0}
            onChange={n => setAmountStr(n === 0 ? '' : String(n))}
            onKeyDown={e => { if (e.key === 'Enter' && canSave) handleSave() }}
            placeholder="0"
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
            <span style={LABEL}>{type === 'transfer' ? 'From' : 'Account'}</span>
            <PillPicker
              value={accountId}
              onChange={id => {
                setAccountId(id)
                if (transaction || currencyTouched) return
                const a = accounts.find(x => x.id === id)
                if (a) setCurrency(a.currency)
              }}
              placeholder="No account"
              options={accounts.map(a => ({
                id: a.id, label: a.name, glyph: a.emoji, tint: a.color, hint: accountHint(a),
              }))} />
          </div>

          {/* A transfer has two ends. Without the second one, paying a credit
              card looked the same as money leaving and arriving nowhere. */}
          {type === 'transfer' && (
            <div style={ROW}>
              <span style={LABEL}>{cards.length > 0 ? 'To card' : 'To'}</span>
              <PillPicker
                value={toAccountId}
                onChange={setToAccountId}
                placeholder={cards.length > 0 ? 'Which card or account' : 'Which account'}
                options={accounts.filter(a => a.id !== accountId)
                  .map(a => ({ id: a.id, label: a.name, glyph: a.emoji, tint: a.color, hint: accountHint(a) }))} />
            </div>
          )}

          {type !== 'transfer' && (
          <div style={ROW}>
            <span style={LABEL}>Category</span>
            <PillPicker
              value={categoryId}
              onChange={setCategoryId}
              placeholder="Uncategorised"
              options={categoryOptions(categories)} />
          </div>
          )}

          {suggestedCard && (
            <div style={{ ...ROW, alignItems: 'flex-start' }}>
              <span style={LABEL} />
              <span style={{
                flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                padding: '9px 12px', borderRadius: 10,
                background: '#FBF3D2', border: '1px solid #EFE1B4',
              }}>
                <span style={{ fontSize: 12.5, color: '#7A5F09', flex: 1, minWidth: 140 }}>
                  Paying a card off? That moves money rather than spending it — switch to
                  Transfer and pick which card it lands on.
                </span>
                <button
                  type="button"
                  onClick={() => { setType('transfer'); setToAccountId(suggestedCard.id) }}
                  style={{
                    ...PILL, height: 30, paddingInline: 12, fontSize: 12, fontWeight: 600,
                    color: INK, flexShrink: 0,
                  }}>
                  {cards.length === 1 ? `Pay ${suggestedCard.name}` : 'Choose the card'}
                </button>
              </span>
            </div>
          )}

          {/* Due, and — once it is paid — the day it actually left */}
          <div style={ROW}>
            <span style={LABEL}>Due</span>
            <span style={{ flex: 1, minWidth: 0, display: 'flex', gap: 7 }}>
              <label style={{ ...PILL, flex: 1, position: 'relative', justifyContent: 'space-between' }}>
                {new Date(date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                <ChevronDown size={13} strokeWidth={2} style={{ color: GHOST, flexShrink: 0 }} />
                <input type="date" value={date} onChange={e => pickDate(e.target.value)}
                  style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', border: 'none', padding: 0 }} />
              </label>
              <button
                onClick={() => {
                  const next = !isCleared
                  setIsCleared(next)
                  // Paid with no day attached is the common case; assume today
                  // and let it be changed rather than asking twice.
                  // Marking it paid without saying when means it was paid when it was due.
                  if (next && !paidAt) setPaidAt(date)
                }}
                title="Money has actually moved"
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

          {isCleared && (
            <div style={ROW}>
              <span style={LABEL}>Paid on</span>
              <label style={{ ...PILL, flex: 1, position: 'relative', justifyContent: 'space-between' }}>
                {paidAt
                  ? new Date(paidAt + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
                  : <span style={{ color: GHOST }}>Pick the day</span>}
                <ChevronDown size={13} strokeWidth={2} style={{ color: GHOST, flexShrink: 0 }} />
                <input type="date" value={paidAt}
                  onChange={e => { setPaidTouched(true); setPaidAt(e.target.value) }}
                  style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', border: 'none', padding: 0 }} />
              </label>
            </div>
          )}

          {openPanes.payee && (
            <div style={ROW}>
              <span style={LABEL}>Payee</span>
              <span ref={payeeBox} style={{ flex: 1, minWidth: 0, position: 'relative', display: 'flex' }}>
                <input
                  value={payee}
                  onChange={e => { setPayee(e.target.value); setPayeeOpen(true) }}
                  onFocus={() => setPayeeOpen(true)}
                  onKeyDown={e => {
                    if (e.key === 'Escape') setPayeeOpen(false)
                    if (e.key === 'Enter' && payeeHits.length && payee.trim()) {
                      e.preventDefault(); setPayee(payeeHits[0]); setPayeeOpen(false)
                    }
                  }}
                  placeholder="Who it went to"
                  style={{ ...PILL, flex: 1, cursor: 'text', outline: 'none' }} />

                {/* Everyone you have paid before, narrowing as you type */}
                {payeeOpen && payeeHits.length > 0 && (
                  <div style={{
                    position: 'absolute', top: 46, left: 0, right: 0, zIndex: 20, padding: 5,
                    maxHeight: 210, overflowY: 'auto',
                    background: '#FFFFFF', border: `1px solid ${LINE}`, borderRadius: 12,
                    boxShadow: '0 12px 32px rgba(25,23,18,0.18)',
                  }}>
                    {payeeHits.map(name => (
                      <button key={name} type="button"
                        onClick={() => { setPayee(name); setPayeeOpen(false) }}
                        style={{
                          display: 'block', width: '100%', padding: '9px 10px', border: 'none',
                          borderRadius: 8, background: 'transparent', cursor: 'pointer',
                          fontFamily: 'inherit', fontSize: 13.5, color: INK, textAlign: 'left',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{name}</button>
                    ))}
                  </div>
                )}
              </span>
            </div>
          )}

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

          {openPanes.tags && (
            <div style={{ ...ROW, alignItems: 'flex-start' }}>
              <span style={{ ...LABEL, paddingTop: 8 }}>Tags</span>
              <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
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
                  style={{ ...PILL, height: 34, flex: 1, minWidth: 110, cursor: 'text', outline: 'none', fontSize: 12.5 }} />
              </span>
            </div>
          )}

          {openPanes.files && (
            <div style={{ ...ROW, alignItems: 'flex-start' }}>
              <span style={{ ...LABEL, paddingTop: 14 }}>Receipts</span>
              <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
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
              </span>
            </div>
          )}

          {openPanes.repeat && (
            <div style={ROW}>
              <span style={LABEL}>Repeats</span>
              <button onClick={() => setIsRecurring(v => !v)}
                style={{
                  ...PILL, flex: 1, justifyContent: 'flex-start',
                  background: isRecurring ? INK : '#FFFFFF',
                  border: isRecurring ? 'none' : `1px solid ${LINE}`,
                  color: isRecurring ? '#FDF8E7' : MUTED,
                }}>
                {isRecurring ? <><Check size={13} strokeWidth={2.5} /> This one comes round again</> : 'One-off'}
              </button>
            </div>
          )}
        </div>

        <div style={RULE} />

        {/* What else this transaction can carry. Folded away until asked for —
            an icon lights up once its section holds something. */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          {([
            { key: 'payee',  Icon: User,          title: 'Payee',    filled: !!payee.trim() },
            { key: 'files',  Icon: ImageIcon,     title: 'Receipts', filled: attachments.length > 0 },
            { key: 'tags',   Icon: Hash,          title: 'Tags',     filled: tags.length > 0 },
            { key: 'repeat', Icon: Repeat,        title: 'Repeats',  filled: isRecurring },
          ] as const).map(({ key, Icon, title, filled }) => {
            const open = !!openPanes[key]
            return (
              <button key={key} title={title} aria-pressed={open}
                onClick={() => {
                  // A section holding something cannot be folded away — that
                  // would hide data behind an icon and look like losing it.
                  if (open && filled) return
                  setOpenPanes(p => ({ ...p, [key]: !p[key] }))
                }}
                style={{
                  flex: 1, height: 44, borderRadius: 11, cursor: filled && open ? 'default' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: filled ? 'rgba(245,209,78,0.18)' : open ? '#FAF7EC' : 'transparent',
                  border: `1px solid ${filled ? AMBER : LINE}`,
                  color: filled ? '#191712' : open ? MUTED : GHOST,
                }}>
                <Icon size={17} strokeWidth={1.6} />
              </button>
            )
          })}
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

import { useState } from 'react'
import { Search, Check, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui'
import type { Account, AccountType, Currency } from '../types'
import { IconPicker } from '../components/IconPicker'
import { POSITIVE, NEGATIVE } from '../../../lib/moneyColors'
import { MoneyInput } from '../components/MoneyInput'
import { schemeFor, setScheme, dormantWhy, returnRate, type RewardScheme } from '../cardRewards'
import { lookUpRewards } from '../rewardLookup'

const RED   = NEGATIVE
const GREEN = POSITIVE
void GREEN // kept for semantic reference

interface Props {
  account?: Account | null
  onSave: (a: Account) => void
  onDelete?: (id: string) => void
  onClose: () => void
}

export function AccountModal({ account, onSave, onDelete, onClose }: Props) {
  const isEdit = !!account

  const [name,        setName]        = useState(account?.name        ?? '')
  const [bank,        setBank]        = useState(account?.bank        ?? '')
  const [accountType, setAccountType] = useState<AccountType>(account?.accountType ?? 'payment')
  const [currency,    setCurrency]    = useState<Currency>(account?.currency ?? 'EGP')
  const [balance,     setBalance]     = useState(account?.balance     ?? 0)
  const [creditLimit, setCreditLimit] = useState(account?.creditLimit ?? 0)
  const [last4,       setLast4]       = useState(account?.last4       ?? '')
  const [emoji,       setEmoji]       = useState(account?.emoji       ?? '🏦')
  const [color,       setColor]       = useState(account?.color       ?? 'var(--sb-ink-4)')

  // ── What the card earns ──────────────────────────────────────────────────
  // Only a card has a programme, and a card without one is the ordinary case:
  // the block starts empty and says so rather than starting at zeroes, which
  // would read as a card that earns nothing.
  const [scheme, setLocalScheme] = useState<RewardScheme | null>(
    () => (account ? schemeFor(account.id) : null))
  const [looking, setLooking] = useState(false)
  const [lookupWhy, setLookupWhy] = useState('')

  /** A figure you touch becomes yours, and no later lookup overwrites it. */
  function editScheme(patch: Partial<RewardScheme>) {
    setLocalScheme(prev => ({
      earn: { pos: 0, online: 0 }, pointValue: 0, ...prev, ...patch, source: 'yours',
    }))
  }

  async function runLookup() {
    setLooking(true); setLookupWhy('')
    try {
      const got = await lookUpRewards(bank, name, currency)
      if (got.known && got.scheme) setLocalScheme(got.scheme)
      else setLookupWhy(got.why ?? 'Nothing came back.')
    } finally { setLooking(false) }
  }

  function handleSave() {
    const saved: Account = {
      id:          account?.id ?? crypto.randomUUID(),
      name:        name.trim(),
      bank:        bank.trim(),
      accountType,
      creditLimit: accountType === 'credit_card' && creditLimit > 0 ? creditLimit : undefined,
      currency,
      balance:     Number(balance),
      last4:       last4 || undefined,
      emoji:       emoji || '🏦',
      color,
      sortOrder:   account?.sortOrder ?? 0,
    }
    // The scheme is keyed by the account id, so it can only be written once the
    // id exists — which for a new card is here, not while the form is open.
    if (accountType === 'credit_card') setScheme(saved.id, scheme)
    else if (account) setScheme(saved.id, null)
    onSave(saved)
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 'var(--sb-r-chip)',
    border: `var(--sb-border-width) solid ${'var(--sb-border)'}`,
    background: 'var(--sb-page)',
    color: 'var(--sb-ink-1)',
    fontSize: 'var(--sb-t-body)',
    outline: 'none',
    boxSizing: 'border-box' as const,
    fontFamily: 'inherit',
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 'var(--sb-t-body-s)',
    color: 'var(--sb-ink-3)',
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
        background: 'var(--sb-card)',
        borderRadius: 'var(--sb-r-card)',
        boxShadow: 'var(--sb-shadow-frame)',
        padding: '24px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
      }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 'var(--sb-t-h2)', fontWeight: 700, color: 'var(--sb-ink-1)' }}>
            {isEdit ? 'Edit Account' : 'New Account'}
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 'var(--sb-t-h2)',
              color: 'var(--sb-ink-3)',
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

          {/* What it started at, not what it holds: entries are added to this
              rather than replacing it, so editing it here does not wipe out a
              year of transactions. */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Opening balance</label>
            <MoneyInput
              style={inputStyle}
              value={balance}
              onChange={setBalance}
            />
            <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', marginTop: 5, lineHeight: 1.45 }}>
              Where this account stood <b style={{ fontWeight: 600 }}>before the year you are looking at</b>.
              Entries move it from here — a card goes below zero as it is spent on, and
              back towards zero as it is paid off. Nothing is read from earlier years,
              so this figure is the whole of the past: keep it right and the balance is
              right.
            </div>
          </div>

          {/* Only a card has a ceiling. What is left on it is the ceiling less
              what is owed, which is the figure worth knowing before spending. */}
          {accountType === 'credit_card' && (
            <div style={fieldStyle}>
              <label style={labelStyle}>Credit limit</label>
              <MoneyInput
                style={inputStyle}
                min={0}
                value={creditLimit}
                onChange={setCreditLimit}
              />
              <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', marginTop: 5, lineHeight: 1.45 }}>
                The card's ceiling. Leave it at nothing and the card simply shows what is
                owed, with no bar and no figure left.
              </div>
            </div>
          )}

          {/* ── What the card earns ───────────────────────────────────────
              A rewards card pays part of your spending back, and the ledger
              recorded the spending and none of the return. Two figures make
              the whole of it, because the bank states them separately and
              changes one at a time: points per unit spent, and what a point is
              worth. Stating one blended percentage would be tidier and would
              leave you no way to correct the half that moved. */}
          {accountType === 'credit_card' && (
            <div style={{
              display: 'flex', flexDirection: 'column', gap: 10,
              padding: '14px 16px', borderRadius: 'var(--sb-r-nav)',
              background: 'var(--sb-field)',
              border: 'var(--sb-border-width) solid var(--sb-hairline)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.12em',
                  textTransform: 'uppercase', color: 'var(--sb-ink-3)',
                }}>Points</span>
                <span style={{ flex: 1 }} />
                <Button size="sm" variant="ghost" onClick={() => void runLookup()}
                  disabled={looking || !bank.trim()}
                  title={bank.trim()
                    ? `Ask what ${bank.trim()} pays on this card`
                    : 'Name the bank first — it is the whole of the question'}>
                  <Search size={12} /> {looking ? 'Looking…' : 'Look it up'}
                </Button>
                {scheme && (
                  <Button size="sm" variant="ghost" onClick={() => { setLocalScheme(null); setLookupWhy('') }}
                    title="This card has no rewards programme">
                    Clear
                  </Button>
                )}
              </div>

              {/* Where the figures came from. A screen that cannot tell a
                  lookup from a measurement presents a guess as a fact. */}
              {scheme && (
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: 7,
                  fontSize: 'var(--sb-t-meta)', lineHeight: 1.45,
                  color: scheme.source === 'yours' ? 'var(--sb-positive)' : 'var(--sb-ink-3)',
                }}>
                  {scheme.source === 'yours'
                    ? <Check size={13} style={{ flexShrink: 0, marginTop: 2 }} />
                    : <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 2 }} />}
                  <span>
                    {scheme.source === 'yours'
                      ? 'Your figures. Nothing here overwrites them — not a later lookup, not another device.'
                      : <>Looked up{scheme.programme ? ` — ${scheme.programme}` : ''}. <b style={{ fontWeight: 600 }}>Check it against your statement</b>; touching any figure below makes it yours.{scheme.note ? ` ${scheme.note}` : ''}</>}
                  </span>
                </div>
              )}
              {lookupWhy && (
                <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.45 }}>
                  {lookupWhy} Fill the two figures in from your statement and they are yours.
                </div>
              )}

              {/* Points per unit, per channel — and cash, which is never one.
                  A cash advance is a loan at the card's own rate from the hour
                  it is taken, so it earns nothing, and it is drawn here rather
                  than left out so the absence is a statement. */}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ ...fieldStyle, flex: '1 1 120px' }}>
                  <label style={{ ...labelStyle, fontSize: 'var(--sb-t-meta)' }}>Points per {currency} in person</label>
                  <input style={{ ...inputStyle, padding: '8px 10px' }} type="number" min={0} step="0.01"
                    value={scheme?.earn.pos || ''} placeholder="0.1"
                    onChange={e => editScheme({ earn: { pos: Number(e.target.value) || 0, online: scheme?.earn.online ?? 0 } })} />
                </div>
                <div style={{ ...fieldStyle, flex: '1 1 120px' }}>
                  <label style={{ ...labelStyle, fontSize: 'var(--sb-t-meta)' }}>…online</label>
                  <input style={{ ...inputStyle, padding: '8px 10px' }} type="number" min={0} step="0.01"
                    value={scheme?.earn.online || ''} placeholder="0.2"
                    onChange={e => editScheme({ earn: { pos: scheme?.earn.pos ?? 0, online: Number(e.target.value) || 0 } })} />
                </div>
                <div style={{ ...fieldStyle, flex: '1 1 120px' }}>
                  <label style={{ ...labelStyle, fontSize: 'var(--sb-t-meta)' }}>One point is worth</label>
                  <input style={{ ...inputStyle, padding: '8px 10px' }} type="number" min={0} step="0.01"
                    value={scheme?.pointValue || ''} placeholder={`0.50 ${currency}`}
                    onChange={e => editScheme({ pointValue: Number(e.target.value) || 0 })} />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ ...fieldStyle, flex: '1 1 120px' }}>
                  <label style={{ ...labelStyle, fontSize: 'var(--sb-t-meta)' }}>Most points a month</label>
                  <input style={{ ...inputStyle, padding: '8px 10px' }} type="number" min={0} step="1"
                    value={scheme?.monthlyCap || ''} placeholder="no ceiling"
                    onChange={e => editScheme({ monthlyCap: Number(e.target.value) || undefined })} />
                </div>
                <div style={{ ...fieldStyle, flex: '1 1 120px' }}>
                  <label style={{ ...labelStyle, fontSize: 'var(--sb-t-meta)' }}>Points lapse after</label>
                  <input style={{ ...inputStyle, padding: '8px 10px' }} type="number" min={0} step="1"
                    value={scheme?.expiryMonths || ''} placeholder="never (months)"
                    onChange={e => editScheme({ expiryMonths: Number(e.target.value) || undefined })} />
                </div>
                <div style={{ ...fieldStyle, flex: '1 1 120px' }}>
                  <label style={{ ...labelStyle, fontSize: 'var(--sb-t-meta)' }}>Points held already</label>
                  <input style={{ ...inputStyle, padding: '8px 10px' }} type="number" min={0} step="1"
                    value={scheme?.openingPoints || ''} placeholder="from your statement"
                    onChange={e => editScheme({ openingPoints: Number(e.target.value) || undefined })} />
                </div>
              </div>

              {/* The equation, worked. Two rates is what the bank publishes;
                  a percentage is the thing you can actually compare. */}
              <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.5 }}>
                {dormantWhy(scheme) ? (
                  <>
                    {dormantWhy(scheme)} Nothing is estimated from a blank —
                    the card simply shows no points until both figures are in.
                  </>
                ) : (
                  <>
                    Comes back as <b style={{ fontWeight: 600 }}>
                      {((returnRate(scheme, 'pos') ?? 0) * 100).toFixed(2)}%
                    </b> in person
                    {returnRate(scheme, 'online') !== returnRate(scheme, 'pos') && (
                      <> and <b style={{ fontWeight: 600 }}>
                        {((returnRate(scheme, 'online') ?? 0) * 100).toFixed(2)}%
                      </b> online</>
                    )}.
                    {' '}<span title="A cash advance is a loan at the card's own rate from the hour it is taken, with no grace period — the opposite of a reward"
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '1px 7px', borderRadius: 'var(--sb-r-chip)',
                        background: 'var(--sb-negative-tint)', color: 'var(--sb-ink-2)',
                        fontSize: 'var(--sb-t-micro)', fontWeight: 600,
                      }}>Cash earns nothing</span>
                  </>
                )}
              </div>
            </div>
          )}

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

          {/* Emoji / image icon */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Icon</label>
            <IconPicker value={emoji} onChange={setEmoji} size={44} />
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
          borderTop: `var(--sb-border-width) solid ${'var(--sb-border)'}`,
        }}>
          {/* Cancel */}
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 'var(--sb-t-body)',
              color: 'var(--sb-ink-3)',
              padding: '8px 14px',
              fontFamily: 'inherit',
              borderRadius: 'var(--sb-r-chip)',
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
                fontSize: 'var(--sb-t-body)',
                color: RED,
                padding: '8px 14px',
                fontFamily: 'inherit',
                borderRadius: 'var(--sb-r-chip)',
              }}
            >
              Delete
            </button>
          )}

          {/* Save */}
          <Button variant="primary" onClick={handleSave}>
            Save
          </Button>
        </div>

      </div>
    </div>
  )
}

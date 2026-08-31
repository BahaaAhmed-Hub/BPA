import { useState } from 'react'
import { useFinanceStore } from '../financeStore'
import { AccountModal } from '../modals/AccountModal'
import { TransactionModal } from '../modals/TransactionModal'
import { IconPicker } from '../components/IconPicker'
import type { Account, Transaction } from '../types'

// ─── Pill ─────────────────────────────────────────────────────────────────────

const RED = '#DA4A3E'
const GREEN = '#2FA869'

function Pill({ type, amount, currency }: { type: 'expense' | 'income' | 'transfer'; amount: number; currency: string }) {
  // Soft pill style: tinted background + matching text (no white text on colored bg)
  const bg    = type === 'expense' ? `${RED}18`   : type === 'income' ? `${GREEN}18`  : '#EDE7D9'
  const color = type === 'expense' ? RED           : type === 'income' ? GREEN         : '#6C6553'
  return (
    <span style={{
      display: 'inline-block',
      padding: '6px 13px',
      borderRadius: 9,
      fontSize: 13,
      fontWeight: 600,
      background: bg,
      color,
      whiteSpace: 'nowrap',
    }}>
      {type === 'expense' ? '−' : type === 'income' ? '+' : ''}{currency} {amount.toLocaleString('en-US')}
    </span>
  )
}

// ─── Balance Screen ───────────────────────────────────────────────────────────

export function BalanceScreen() {
  const C = {
    bg:        '#F7F4EA',
    surface:   '#FFFFFF',
    surfaceEl: '#FAF7EC',
    amberBg:   'rgba(245,209,78,0.12)',
    border:    '#E8E1CE',
    divFaint:  '#E8E1CE',
    amber:     '#F5D14E',
    amberSoft: '#D4A827',
    textPri:   '#191712',
    textMuted: '#6C6553',
    textDim:   '#9B9180',
    red:       '#DA4A3E',
    green:     '#2FA869',
    cyan:      '#46B6C9',
    purple:    '#7E78DD',
  }

  const { accounts, transactions, categories, upsertAccount, removeAccount, upsertTransaction, removeTransaction } = useFinanceStore()

  const [accountModal, setAccountModal] = useState<{ open: boolean; account: Account | null }>({ open: false, account: null })
  const [txModal, setTxModal] = useState<{ open: boolean; tx: Transaction | null }>({ open: false, tx: null })
  const [hoveredAccountId, setHoveredAccountId] = useState<string | null>(null)

  const netWorth = accounts.reduce((s, a) => s + a.balance, 0)

  const paymentAccounts  = accounts.filter(a => a.accountType === 'payment' || a.accountType === 'wallet')
  const creditCards      = accounts.filter(a => a.accountType === 'credit_card')
  const otherAssets      = accounts.filter(a => a.accountType === 'asset')

  const paymentTotal = paymentAccounts.reduce((s, a) => s + a.balance, 0)
  const creditTotal  = creditCards.reduce((s, a) => s + a.balance, 0)
  const assetTotal   = otherAssets.reduce((s, a) => s + a.balance, 0)

  // Sorted transactions desc
  const sorted = [...transactions].sort((a, b) => b.date.localeCompare(a.date))

function formatBalance(bal: number, currency = 'EGP'): string {
    if (bal < 0) return `(${currency} ${Math.abs(bal).toLocaleString('en-US')})`
    return `${currency} ${bal.toLocaleString('en-US')}`
  }

  function AccountRow({ account }: { account: typeof accounts[number] }) {
    const isNeg = account.balance < 0
    const isHovered = hoveredAccountId === account.id
    return (
      <div
        onMouseEnter={() => setHoveredAccountId(account.id)}
        onMouseLeave={() => setHoveredAccountId(null)}
        style={{
          display: 'flex', alignItems: 'center', gap: 11,
          height: 46, padding: '0 12px', borderRadius: 12,
          background: '#FFFFFF', border: '1px solid #EFEADB',
          boxSizing: 'border-box' as const, position: 'relative',
        }}
      >
        <IconPicker
          value={account.emoji}
          onChange={newEmoji => upsertAccount({ ...account, emoji: newEmoji })}
          trigger={(onClick) => (
            <div onClick={onClick} title="Click to change icon" style={{
              width: 28, height: 28, borderRadius: 9, background: '#F0EBDC', color: '#6C6553',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, cursor: 'pointer', overflow: 'hidden', fontSize: 15,
            }}>
              {account.emoji.startsWith('data:') || account.emoji.startsWith('http')
                ? <img src={account.emoji} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <span>{account.emoji}</span>}
            </div>
          )}
        />
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#191712', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' }}>{account.name}</span>
          <span style={{ fontSize: 10.5, color: '#6C6553', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {account.bank ?? account.accountType}{account.last4 ? ` · ···· ${account.last4}` : ''}
          </span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 }}>
          <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 14.5, fontWeight: 600, color: isNeg ? '#B4523A' : '#191712', fontVariantNumeric: 'tabular-nums' }}>
            {formatBalance(account.balance, account.currency)}
          </span>
          {account.last4 && <span style={{ fontSize: 10, color: '#6C6553' }}>cleared</span>}
        </div>
        {isHovered && (
          <button onClick={() => setAccountModal({ open: true, account })} title="Edit account"
            style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 6, padding: '3px 6px', cursor: 'pointer', color: '#6C6553', fontSize: 10 }}>
            Edit
          </button>
        )}
      </div>
    )
  }

  // Held vs owed computations for net position card
  const totalHeld = accounts.filter(a => a.balance > 0).reduce((s, a) => s + a.balance, 0)
  const totalOwed = Math.abs(accounts.filter(a => a.balance < 0).reduce((s, a) => s + a.balance, 0))
  const netPos    = totalHeld - totalOwed
  const heldPct   = totalHeld + totalOwed > 0 ? Math.round(totalHeld / (totalHeld + totalOwed) * 100) : 100

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        flexShrink: 0,
        borderBottom: `1px solid ${C.border}`,
        padding: '14px 26px 16px',
        display: 'flex', alignItems: 'flex-end', gap: 20,
      }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', color: '#6C6553', display: 'block', marginBottom: 4 }}>MONEY</span>
          <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 30, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1, color: '#191712', display: 'block' }}>Balances</span>
          <span style={{ fontSize: 12, color: '#6C6553', display: 'block', marginTop: 3 }}>
            {accounts.length} account{accounts.length !== 1 ? 's' : ''} · held vs owed and what's already committed
          </span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 3 }}>
          {/* Filter pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: 3, borderRadius: 999, background: '#EDE7D9' }}>
            {(['Accounts','Cards','Cash'] as const).map(f => (
              <span key={f} style={{ height: 28, padding: '0 13px', borderRadius: 999, background: f === 'Accounts' ? '#FFFFFF' : 'transparent', color: f === 'Accounts' ? '#191712' : '#6C6553', fontSize: 12, fontWeight: f === 'Accounts' ? 600 : 400, display: 'flex', alignItems: 'center', boxShadow: f === 'Accounts' ? '0 1px 3px rgba(25,23,18,0.16)' : 'none', cursor: 'pointer' }}>{f}</span>
            ))}
          </div>
          <button onClick={() => setAccountModal({ open: true, account: null })}
            style={{ height: 34, padding: '0 15px', borderRadius: 999, background: '#F5D14E', border: 'none', color: '#191712', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, boxShadow: '0 2px 0 rgba(25,23,18,0.14)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
            Add account
          </button>
        </div>
      </div>

      {/* Dark net position hero card */}
      <div style={{ flexShrink: 0, margin: '14px 26px 0', background: '#191712', borderRadius: 18, padding: '16px 20px', display: 'flex', gap: 22, alignItems: 'center', color: '#FDF8E7' }}>
        <div style={{ flexShrink: 0, width: 240 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em', opacity: 0.6, display: 'block', marginBottom: 4 }}>NET POSITION</span>
          <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 36, fontWeight: 600, letterSpacing: '-0.04em', lineHeight: 1, fontVariantNumeric: 'tabular-nums', display: 'block' }}>
            EGP {netPos.toLocaleString('en-US')}
          </span>
          <span style={{ fontSize: 11, opacity: 0.65, display: 'block', marginTop: 4 }}>
            EGP {totalHeld.toLocaleString('en-US')} held · EGP {totalOwed.toLocaleString('en-US')} owed
          </span>
        </div>
        {/* Held/Owed bar */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.5, opacity: 0.55, marginBottom: 8 }}>
            <span>HELD</span><span style={{ marginLeft: 'auto' }}>OWED</span>
          </div>
          <div style={{ height: 14, borderRadius: 999, overflow: 'hidden', display: 'flex', background: 'rgba(255,255,255,0.12)' }}>
            <span style={{ width: `${heldPct}%`, background: '#F5D14E', display: 'block' }} />
            <span style={{ flex: 1, background: '#B4523A', display: 'block' }} />
          </div>
          <div style={{ display: 'flex', gap: 16, fontSize: 10.5, opacity: 0.62, marginTop: 6 }}>
            <span>Payment {heldPct}%</span>
            <span>Cards {100 - heldPct}%</span>
          </div>
        </div>
        {/* Safe to spend */}
        <div style={{ width: 160, flexShrink: 0 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', opacity: 0.55, display: 'block', marginBottom: 4 }}>SAFE TO SPEND</span>
          <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 22, fontWeight: 600, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums', display: 'block' }}>
            EGP {Math.max(0, netPos - totalOwed * 0.1).toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </span>
          <span style={{ fontSize: 10.5, opacity: 0.6, display: 'block', marginTop: 2 }}>After committed bills</span>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ── Left pane: accounts ── */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '22px 26px',
          borderRight: `1px solid #E8E1CE`,
        }}>
          {/* ── Account groups ── */}
          {[
            { label: 'PAYMENT ACCOUNTS', accounts: paymentAccounts, total: paymentTotal, totalColor: '#5F7038' },
            { label: 'CARDS OWED', accounts: creditCards, total: creditTotal, totalColor: '#B4523A' },
            { label: 'OTHER ASSETS', accounts: otherAssets, total: assetTotal, totalColor: '#191712' },
          ].map(group => group.accounts.length > 0 && (
            <div key={group.label} style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 30, padding: '0 12px', borderRadius: 10, background: '#EDE7D9', marginBottom: 7, boxSizing: 'border-box' as const }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', color: '#6C6553' }}>{group.label}</span>
                <span style={{ marginLeft: 'auto', fontFamily: 'Outfit, sans-serif', fontSize: 13.5, fontWeight: 600, color: group.totalColor, fontVariantNumeric: 'tabular-nums' }}>
                  EGP {Math.abs(group.total).toLocaleString('en-US')}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {group.accounts.map(acc => <AccountRow key={acc.id} account={acc} />)}
              </div>
            </div>
          ))}
        </div>

        {/* ── Right pane: transactions ── */}
        <div style={{
          flex: 1.05,
          overflowY: 'auto',
          padding: '22px 26px',
        }}>
          {/* Date range pill + Add button */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 16px',
              background: C.surface,
              border: `1px solid ${C.border}`,
              borderRadius: 10,
            }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: C.textPri }}>1 Jun 2026</span>
              <span style={{ color: C.textDim }}>›</span>
              <span style={{ fontSize: 13, fontWeight: 500, color: C.textPri }}>30 Jun 2026</span>
              <span style={{ color: C.textDim, fontSize: 16, letterSpacing: 1 }}>···</span>
            </div>
            <button
              onClick={() => setTxModal({ open: true, tx: null })}
              style={{
                padding: '8px 14px',
                borderRadius: 9,
                background: C.amber,
                border: 'none',
                color: '#191712',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
              }}
            >
              + Add
            </button>
          </div>

          {/* Transaction feed */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {sorted.map(tx => {
              const cat    = tx.categoryId ? categories.find(c => c.id === tx.categoryId) : null
              const emoji  = cat?.icon ?? (tx.type === 'income' ? '💼' : '💳')
              const txDate = new Date(tx.date)
              const dateStr = txDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
              return (
                <div
                  key={tx.id}
                  onClick={() => setTxModal({ open: true, tx })}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '11px 0',
                    borderBottom: `1px solid ${C.divFaint}`,
                    cursor: 'pointer',
                  }}
                >
                  <div style={{
                    width: 40, height: 40, borderRadius: '50%',
                    background: tx.type === 'income' ? `${C.green}22` : `${C.red}22`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 17, flexShrink: 0,
                  }}>
                    {emoji}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 14, fontWeight: 500, color: C.textPri,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {tx.payee?.trim() || cat?.name || 'Transaction'}
                    </div>
                    <div style={{ fontSize: 12, color: C.textDim, marginTop: 1, display: 'flex', gap: 6 }}>
                      <span style={{ color: C.green }}>{dateStr}</span>
                      {cat && tx.payee?.trim() && <span>· {cat.name}</span>}
                    </div>
                  </div>
                  <Pill
                    type={tx.type === 'income' ? 'income' : tx.type === 'transfer' ? 'transfer' : 'expense'}
                    amount={tx.amount}
                    currency={tx.currency}
                  />
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Modals */}
      {accountModal.open && (
        <AccountModal
          account={accountModal.account}
          onSave={a => { upsertAccount(a); setAccountModal({ open: false, account: null }) }}
          onDelete={id => { removeAccount(id); setAccountModal({ open: false, account: null }) }}
          onClose={() => setAccountModal({ open: false, account: null })}
        />
      )}
      {txModal.open && (
        <TransactionModal
          transaction={txModal.tx}
          accounts={accounts}
          categories={categories}
          onSave={tx => { upsertTransaction(tx); setTxModal({ open: false, tx: null }) }}
          onDelete={id => { removeTransaction(id); setTxModal({ open: false, tx: null }) }}
          onClose={() => setTxModal({ open: false, tx: null })}
        />
      )}
    </div>
  )
}

import { useState } from 'react'
import { useFinanceStore } from '../financeStore'
import { useUIStore } from '@/store/uiStore'
import { getTheme } from '@/lib/themes'
import { AccountModal } from '../modals/AccountModal'
import { TransactionModal } from '../modals/TransactionModal'
import { IconPicker } from '../components/IconPicker'
import type { Account, Transaction } from '../types'

// ─── Pill ─────────────────────────────────────────────────────────────────────

const RED = '#DA4A3E'
const GREEN = '#2FA869'

function Pill({ type, amount, currency }: { type: 'expense' | 'income' | 'transfer'; amount: number; currency: string }) {
  const bg = type === 'expense' ? RED : type === 'income' ? GREEN : '#EDE6D8'
  const color = type === 'transfer' ? '#1A1714' : '#fff'
  return (
    <span style={{
      display: 'inline-block',
      padding: '7px 15px',
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
  const themeId = useUIStore(s => s.themeId)
  const theme = getTheme(themeId)
  const C = {
    bg:        theme.bg,
    surface:   theme.surface,
    surfaceEl: theme.surface2 || theme.surface,
    amberBg:   theme.accentFill,
    border:    theme.border,
    divFaint:  theme.border,
    amber:     theme.accent,
    amberSoft: theme.accentBright,
    textPri:   theme.text,
    textMuted: theme.textDim,
    textDim:   theme.textMuted,
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
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '11px 0',
          borderBottom: `1px solid ${C.divFaint}`,
          position: 'relative',
        }}
      >
        <IconPicker
          value={account.emoji}
          onChange={newEmoji => upsertAccount({ ...account, emoji: newEmoji })}
          trigger={(onClick) => (
            <div
              onClick={onClick}
              title="Click to change icon"
              style={{
                width: 40, height: 40, borderRadius: '50%',
                background: `${account.color}22`,
                border: `1px solid ${account.color}44`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, cursor: 'pointer', overflow: 'hidden',
              }}
            >
              {account.emoji.startsWith('data:') || account.emoji.startsWith('http')
                ? <img src={account.emoji} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <span style={{ fontSize: 17 }}>{account.emoji}</span>}
            </div>
          )}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: C.textPri }}>{account.name}</div>
          {account.last4 && (
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 1 }}>·· {account.last4}</div>
          )}
        </div>
        <div style={{
          fontSize: 14, fontWeight: 600,
          color: isNeg ? C.red : C.green,
          flexShrink: 0,
        }}>
          {formatBalance(account.balance, account.currency)}
        </div>
        {/* Edit pencil — visible on hover */}
        {isHovered && (
          <button
            onClick={() => setAccountModal({ open: true, account })}
            title="Edit account"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '2px 4px',
              color: C.textMuted,
              flexShrink: 0,
              lineHeight: 1,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        height: 64, flexShrink: 0,
        borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 30px',
      }}>
        <span style={{ fontSize: 20, fontWeight: 700, color: C.textPri }}>Balance</span>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            onClick={() => setAccountModal({ open: true, account: null })}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 16px', borderRadius: 9,
              background: C.amberBg, border: `1px solid ${C.amber}44`,
              color: C.amber, fontSize: 13, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
            Add Account
          </button>
          <button
            onClick={() => setTxModal({ open: true, tx: null })}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 16px', borderRadius: 9,
              background: C.amber, border: 'none',
              color: C.bg, fontSize: 13, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
            Add Transaction
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ── Left pane: accounts ── */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '22px 26px',
          borderRight: `1px solid #211C14`,
        }}>
          {/* Net worth */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 22,
            padding: '14px 16px',
            background: C.surface,
            borderRadius: 12,
            border: `1px solid ${C.border}`,
          }}>
            <span style={{ fontSize: 14, color: C.textMuted, fontWeight: 500 }}>Net worth</span>
            <span style={{ fontSize: 24, fontWeight: 700, color: C.amber }}>
              EGP {netWorth.toLocaleString('en-US')}
            </span>
          </div>

          {/* Payment accounts */}
          <div style={{ marginBottom: 20 }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 8,
            }}>
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: C.textDim, letterSpacing: '0.8px' }}>
                Payment Accounts
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: C.green }}>
                EGP {paymentTotal.toLocaleString('en-US')}
              </span>
            </div>
            {paymentAccounts.map(acc => <AccountRow key={acc.id} account={acc} />)}
          </div>

          {/* Credit cards */}
          <div style={{ marginBottom: 20 }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 8,
            }}>
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: C.textDim, letterSpacing: '0.8px' }}>
                Credit Cards
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: C.red }}>
                {formatBalance(creditTotal)}
              </span>
            </div>
            {creditCards.map(acc => <AccountRow key={acc.id} account={acc} />)}
          </div>

          {/* Other assets */}
          <div style={{ marginBottom: 20 }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 8,
            }}>
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: C.textDim, letterSpacing: '0.8px' }}>
                Other Assets
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: C.amber }}>
                EGP {assetTotal.toLocaleString('en-US')}
              </span>
            </div>
            {otherAssets.map(acc => <AccountRow key={acc.id} account={acc} />)}
          </div>
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
                color: C.bg,
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
                      {tx.payee || cat?.name || 'Transaction'}
                    </div>
                    <div style={{ fontSize: 12, color: C.textDim, marginTop: 1, display: 'flex', gap: 6 }}>
                      <span style={{ color: C.green }}>{dateStr}</span>
                      {cat && tx.payee && <span>· {cat.name}</span>}
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

import { useFinanceStore } from '../financeStore'
import { useUIStore } from '@/store/uiStore'
import { getTheme } from '@/lib/themes'
import { MOCK_CATEGORIES } from '../mockData'

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

  const { accounts, transactions } = useFinanceStore()

  const netWorth = accounts.reduce((s, a) => s + a.balance, 0)

  const paymentAccounts  = accounts.filter(a => a.accountType === 'payment' || a.accountType === 'wallet')
  const creditCards      = accounts.filter(a => a.accountType === 'credit_card')
  const otherAssets      = accounts.filter(a => a.accountType === 'asset')

  const paymentTotal = paymentAccounts.reduce((s, a) => s + a.balance, 0)
  const creditTotal  = creditCards.reduce((s, a) => s + a.balance, 0)
  const assetTotal   = otherAssets.reduce((s, a) => s + a.balance, 0)

  // Sorted transactions desc
  const sorted = [...transactions].sort((a, b) => b.date.localeCompare(a.date))

  // Category emoji lookup
  function getCatEmoji(categoryId?: string): string {
    if (!categoryId) return '💳'
    const cat = MOCK_CATEGORIES.find(c => c.id === categoryId)
    return cat?.icon ?? '💳'
  }

  function formatBalance(bal: number): string {
    if (bal < 0) return `(EGP ${Math.abs(bal).toLocaleString('en-US')})`
    return `EGP ${bal.toLocaleString('en-US')}`
  }

  function AccountRow({ account }: { account: typeof accounts[number] }) {
    const isNeg = account.balance < 0
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '11px 0',
        borderBottom: `1px solid ${C.divFaint}`,
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%',
          background: `${account.color}22`,
          border: `1px solid ${account.color}44`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 17, flexShrink: 0,
        }}>
          {account.emoji}
        </div>
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
          {formatBalance(account.balance)}
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        height: 64, flexShrink: 0,
        borderBottom: `1px solid #211C14`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 30px',
      }}>
        <span style={{ fontSize: 20, fontWeight: 700, color: C.textPri }}>Balance</span>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          {/* Import icon */}
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth="1.7" strokeLinecap="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </button>
          {/* Search icon */}
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth="1.7" strokeLinecap="round">
              <circle cx="11" cy="11" r="7"/>
              <line x1="16.5" y1="16.5" x2="22" y2="22"/>
            </svg>
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
          {/* Date range pill */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 16px',
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            marginBottom: 20,
          }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: C.textPri }}>1 Jun 2026</span>
            <span style={{ color: C.textDim }}>›</span>
            <span style={{ fontSize: 13, fontWeight: 500, color: C.textPri }}>30 Jun 2026</span>
            <span style={{ color: C.textDim, fontSize: 16, letterSpacing: 1 }}>···</span>
          </div>

          {/* Transaction feed */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {sorted.map(tx => {
              const emoji = getCatEmoji(tx.categoryId)
              const txDate = new Date(tx.date)
              const dateStr = txDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
              return (
                <div
                  key={tx.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '11px 0',
                    borderBottom: `1px solid ${C.divFaint}`,
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
                      {tx.payee}
                    </div>
                    <div style={{ fontSize: 12, color: C.green, marginTop: 1 }}>
                      {dateStr}
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
    </div>
  )
}

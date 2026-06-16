import { useState } from 'react'
import { useFinanceStore } from './financeStore'
import { useUIStore } from '@/store/uiStore'
import { getTheme } from '@/lib/themes'
import { TodayScreen } from './screens/TodayScreen'
import { BalanceScreen } from './screens/BalanceScreen'
import { BudgetScreen } from './screens/BudgetScreen'
import { BillsScreen } from './screens/BillsScreen'
import { ReportsScreen } from './screens/ReportsScreen'
import { ReflectionScreen } from './screens/ReflectionScreen'
import { TransactionModal } from './modals/TransactionModal'

// ─── Nav icon SVGs ────────────────────────────────────────────────────────────

function IconToday({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4.5" width="18" height="16" rx="2.5"/>
      <path d="M3 9h18M8 2.5v4M16 2.5v4"/>
      <circle cx="12" cy="14.5" r="1.4" fill={color} stroke="none"/>
    </svg>
  )
}

function IconBalance({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v18"/>
      <path d="M6 7l-3 6h6l-3-6zM18 7l-3 6h6l-3-6z"/>
      <path d="M5 21h14M8 7h8"/>
    </svg>
  )
}

function IconBudget({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="6" width="18" height="13" rx="2.5"/>
      <path d="M3 10.5h18"/>
      <circle cx="16.5" cy="14.5" r="1.3" fill={color} stroke="none"/>
    </svg>
  )
}

function IconBills({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 2l3.5 3.5L17 9"/>
      <path d="M3.5 10.5V9a3.5 3.5 0 0 1 3.5-3.5h13"/>
      <path d="M7 22l-3.5-3.5L7 15"/>
      <path d="M20.5 13.5V15a3.5 3.5 0 0 1-3.5 3.5H4"/>
    </svg>
  )
}

function IconReports({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-9-9v9z"/>
      <path d="M14 3.5A9 9 0 0 1 20.5 10H14z"/>
    </svg>
  )
}

function IconFinancials({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="2"/>
      <path d="M8 13v4M12 9v8M16 11v6"/>
    </svg>
  )
}

function IconSync({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="8 17 12 21 16 17"/>
      <line x1="12" y1="12" x2="12" y2="21"/>
      <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/>
    </svg>
  )
}

function IconPlus({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19"/>
      <line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  )
}

// ─── Nav items ────────────────────────────────────────────────────────────────

type FinanceScreen = 'today' | 'balance' | 'budget' | 'bills' | 'reports' | 'reflect'

const NAV_ITEMS: { id: FinanceScreen; label: string; Icon: (p: { color: string }) => React.ReactElement }[] = [
  { id: 'today',   label: 'Today',      Icon: IconToday },
  { id: 'balance', label: 'Balance',    Icon: IconBalance },
  { id: 'budget',  label: 'Budget',     Icon: IconBudget },
  { id: 'bills',   label: 'Bills',      Icon: IconBills },
  { id: 'reports', label: 'Reports',    Icon: IconReports },
  { id: 'reflect', label: 'Financials', Icon: IconFinancials },
]

// ─── Color map type ───────────────────────────────────────────────────────────

interface ColorMap {
  bg: string; rail: string; panel: string; surface: string; surfaceEl: string
  amberBg: string; border: string; borderSt: string; divFaint: string
  amber: string; amberSoft: string; textPri: string; textMuted: string
  textDim: string; red: string; green: string; cyan: string; purple: string
}

// ─── Finance Module ───────────────────────────────────────────────────────────

export function FinanceModule() {
  const themeId = useUIStore(s => s.themeId)
  const theme = getTheme(themeId)

  const C: ColorMap = {
    bg:        theme.bg,
    rail:      theme.sidebarBg,
    panel:     theme.surface,
    surface:   theme.surface,
    surfaceEl: theme.surface2 || theme.surface,
    amberBg:   theme.accentFill,
    border:    theme.border,
    borderSt:  theme.border,
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

  const { accounts, categories, upsertTransaction } = useFinanceStore()

  const [screen, setScreen] = useState<FinanceScreen>('today')
  const [addOpen, setAddOpen] = useState(false)

  function renderScreen() {
    const props = { onOpenAdd: () => setAddOpen(true) }
    switch (screen) {
      case 'today':   return <TodayScreen {...props} />
      case 'balance': return <BalanceScreen />
      case 'budget':  return <BudgetScreen {...props} />
      case 'bills':   return <BillsScreen {...props} />
      case 'reports': return <ReportsScreen {...props} />
      case 'reflect': return <ReflectionScreen {...props} />
    }
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: C.bg }}>
      {/* Left icon rail */}
      <div style={{
        width: 86, flexShrink: 0,
        background: C.rail,
        borderRight: `1px solid ${C.border}`,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center',
        padding: '18px 0 14px',
        overflowY: 'auto',
      }}>
        {/* Brand mark */}
        <div style={{
          width: 38, height: 38, borderRadius: '50%',
          border: `1.5px solid ${C.amber}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 22, flexShrink: 0,
        }}>
          <span style={{ color: C.amber, fontSize: 20, fontWeight: 700, fontStyle: 'italic', lineHeight: 1 }}>P</span>
        </div>

        {/* Nav items */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, flex: 1, width: '100%', alignItems: 'center' }}>
          {NAV_ITEMS.map(({ id, label, Icon }) => {
            const active = screen === id
            return (
              <button
                key={id}
                onClick={() => setScreen(id)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                  padding: '13px 0', cursor: 'pointer', width: '100%',
                  position: 'relative', border: 'none',
                  background: active ? `rgba(196,154,60,0.06)` : 'transparent',
                } as React.CSSProperties}
              >
                {active && (
                  <div style={{
                    position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)',
                    width: 3, height: 28, borderRadius: '0 2px 2px 0',
                    background: C.amber,
                  }} />
                )}
                <Icon color={active ? C.amber : C.textMuted} />
                <span style={{
                  fontSize: 10, fontWeight: 500,
                  color: active ? C.amber : C.textMuted,
                  letterSpacing: '0.2px',
                  textAlign: 'center',
                  lineHeight: 1.2,
                }}>
                  {label}
                </span>
              </button>
            )
          })}
        </div>

        {/* Add (+) button */}
        <button
          onClick={() => setAddOpen(true)}
          style={{
            width: 48, height: 48, borderRadius: 14,
            background: C.amber,
            border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, marginBottom: 14,
          }}
        >
          <IconPlus color="#0B0A08" />
        </button>

        {/* Sync */}
        <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '8px 0', flexShrink: 0 }}>
          <IconSync color={C.textDim} />
        </button>
      </div>

      {/* Main content area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {renderScreen()}
      </div>

      {addOpen && (
        <TransactionModal
          transaction={null}
          accounts={accounts}
          categories={categories}
          onSave={tx => { upsertTransaction(tx); setAddOpen(false) }}
          onClose={() => setAddOpen(false)}
        />
      )}
    </div>
  )
}

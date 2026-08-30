import { useState } from 'react'
import { useFinanceStore } from './financeStore'
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
  const C: ColorMap = {
    bg:        'var(--sb-page)',
    rail:      'var(--sb-header)',
    panel:     'var(--sb-card)',
    surface:   'var(--sb-card)',
    surfaceEl: 'var(--sb-field)',
    amberBg:   'var(--sb-accent-tint)',
    border:    'var(--sb-border)',
    borderSt:  'var(--sb-border)',
    divFaint:  'var(--sb-hairline)',
    amber:     'var(--sb-ink-1)',
    amberSoft: 'var(--sb-ink-2)',
    textPri:   'var(--sb-ink-1)',
    textMuted: 'var(--sb-ink-4)',
    textDim:   'var(--sb-ink-3)',
    red:       '#8A3B2A',
    green:     '#5F7038',
    cyan:      '#3B7A8A',
    purple:    'var(--sb-ink-2)',
  }

  const { accounts, categories, upsertTransaction } = useFinanceStore()

  const [screen, setScreen] = useState<FinanceScreen>(() => {
    const saved = localStorage.getItem('finance-active-screen')
    return (NAV_ITEMS.some(n => n.id === saved) ? saved : 'today') as FinanceScreen
  })

  function handleSetScreen(s: FinanceScreen) {
    localStorage.setItem('finance-active-screen', s)
    setScreen(s)
  }
  const [addOpen, setAddOpen] = useState(false)

  const [navItems, setNavItems] = useState<{ id: FinanceScreen; label: string; Icon: (p: { color: string }) => React.ReactElement }[]>(() => {
    const saved = localStorage.getItem('finance-tab-order')
    if (saved) {
      try {
        const order: string[] = JSON.parse(saved)
        return [...NAV_ITEMS].sort((a, b) => {
          const ai = order.indexOf(a.id); const bi = order.indexOf(b.id)
          return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
        })
      } catch {}
    }
    return NAV_ITEMS
  })
  const [draggedTab, setDraggedTab] = useState<FinanceScreen | null>(null)
  const [dropTab, setDropTab] = useState<FinanceScreen | null>(null)

  function reorderTabs(fromId: FinanceScreen, toId: FinanceScreen) {
    if (fromId === toId) return
    const items = [...navItems]
    const fromIdx = items.findIndex(i => i.id === fromId)
    const toIdx = items.findIndex(i => i.id === toId)
    const [removed] = items.splice(fromIdx, 1)
    items.splice(toIdx, 0, removed)
    setNavItems(items)
    localStorage.setItem('finance-tab-order', JSON.stringify(items.map(i => i.id)))
  }

  function renderScreen() {
    const props = { onOpenAdd: () => setAddOpen(true) }
    switch (screen) {
      case 'today':   return <TodayScreen />
      case 'balance': return <BalanceScreen />
      case 'budget':  return <BudgetScreen />
      case 'bills':   return <BillsScreen {...props} />
      case 'reports': return <ReportsScreen {...props} />
      case 'reflect': return <ReflectionScreen {...props} />
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: C.bg }}>

      {/* Layer 1 — main app header (64px): aligns with sidebar logo */}

      {/* Layer 2 — Finance sub-nav (44px): module-specific tabs */}
      <div style={{
        height: 44, flexShrink: 0,
        background: C.rail,
        borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center',
        padding: '0 12px', gap: 2,
      }}>
        {/* Nav tabs — draggable to reorder */}
        <div style={{ flex: 1, display: 'flex', gap: 1, overflowX: 'auto' }}>
          {navItems.map(({ id, label, Icon }) => {
            const active = screen === id
            const isDragging = draggedTab === id
            const isDropTarget = dropTab === id && dropTab !== draggedTab
            return (
              <div
                key={id}
                draggable
                onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; setDraggedTab(id) }}
                onDragOver={e => { e.preventDefault(); setDropTab(id) }}
                onDrop={e => { e.preventDefault(); if (draggedTab) reorderTabs(draggedTab, id); setDropTab(null) }}
                onDragEnd={() => { setDraggedTab(null); setDropTab(null) }}
                onClick={() => handleSetScreen(id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '4px 10px', borderRadius: 7, cursor: 'grab',
                  background: active ? 'var(--sb-ink-1)' : 'transparent',
                  border: `1px solid ${isDropTarget ? 'var(--sb-accent)' : active ? 'var(--sb-ink-1)' : 'transparent'}`,
                  opacity: isDragging ? 0.35 : 1,
                  userSelect: 'none', flexShrink: 0,
                } as React.CSSProperties}
              >
                <Icon color={active ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-4)'} />
                <span style={{
                  fontSize: 12, fontWeight: active ? 600 : 400,
                  color: active ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-4)',
                  whiteSpace: 'nowrap' as const, letterSpacing: '0.1px',
                }}>
                  {label}
                </span>
              </div>
            )
          })}
        </div>

        {/* Add transaction button */}
        <button
          onClick={() => setAddOpen(true)}
          style={{
            height: 28, paddingInline: 12, borderRadius: 8,
            background: 'var(--sb-ink-1)', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, gap: 4,
          }}
        >
          <IconPlus color="var(--sb-ink-on-dark)" />
        </button>
      </div>

      {/* Screen content */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
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

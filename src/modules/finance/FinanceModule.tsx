import { useState } from 'react'
import { useFinanceStore } from './financeStore'
import { TodayScreen } from './screens/TodayScreen'
import { BalanceScreen } from './screens/BalanceScreen'
import { BudgetScreen } from './screens/BudgetScreen'
import { BillsScreen } from './screens/BillsScreen'
import { ReportsScreen } from './screens/ReportsScreen'
import { ReflectionScreen } from './screens/ReflectionScreen'
import { GoalsScreen } from './screens/GoalsScreen'
import { PlanScreen } from './screens/PlanScreen'
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


function IconGoals({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 13l18-7-6 15-3-6z"/>
    </svg>
  )
}

function IconPlan({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 3L5 14h6l-1 7 8-11h-6z"/>
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

type FinanceScreen = 'today' | 'balance' | 'budget' | 'bills' | 'reports' | 'reflect' | 'goals' | 'plan'

const NAV_ITEMS: { id: FinanceScreen; label: string; Icon: (p: { color: string }) => React.ReactElement }[] = [
  { id: 'today',   label: 'Today',      Icon: IconToday },
  { id: 'balance', label: 'Balance',    Icon: IconBalance },
  { id: 'budget',  label: 'Budget',     Icon: IconBudget },
  { id: 'bills',   label: 'Bills',      Icon: IconBills },
  { id: 'reports', label: 'Reports',    Icon: IconReports },
  { id: 'reflect', label: 'Financials', Icon: IconFinancials },
  { id: 'goals',   label: 'Goals',      Icon: IconGoals },
  { id: 'plan',    label: 'Plan',       Icon: IconPlan },
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
    bg:        '#F7F4EA',
    rail:      '#FCFAF4',
    panel:     '#FFFFFF',
    surface:   '#FFFFFF',
    surfaceEl: '#FAF7EC',
    amberBg:   'rgba(245,209,78,0.12)',
    border:    '#E8E1CE',
    borderSt:  '#E8E1CE',
    divFaint:  '#EDE7D9',
    amber:     '#191712',
    amberSoft: '#3D3926',
    textPri:   '#191712',
    textMuted: '#9B9180',
    textDim:   '#6C6553',
    red:       '#A31C1C',
    green:     '#0C8140',
    cyan:      '#3B7A8A',
    purple:    '#3D3926',
  }

  const { accounts, categories, transactions, upsertTransaction } = useFinanceStore()

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
      case 'goals':   return <GoalsScreen />
      case 'plan':    return <PlanScreen />
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
                  background: active ? '#F5D14E' : 'transparent',
                  border: `1px solid ${isDropTarget ? '#F5D14E' : active ? 'rgba(25,23,18,0.18)' : 'transparent'}`,
                  boxShadow: active ? '0 2px 0 rgba(25,23,18,0.1)' : 'none',
                  opacity: isDragging ? 0.35 : 1,
                  userSelect: 'none', flexShrink: 0,
                } as React.CSSProperties}
              >
                <Icon color={active ? '#191712' : '#9B9180'} />
                <span style={{
                  fontSize: 12, fontWeight: active ? 600 : 400,
                  color: active ? '#191712' : '#9B9180',
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
            height: 30, paddingInline: 14, borderRadius: 8,
            background: '#F5D14E', border: '1px solid rgba(25,23,18,0.18)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, gap: 5, boxShadow: '0 2px 0 rgba(25,23,18,0.1)',
          }}
        >
          <IconPlus color="#191712" />
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
          history={transactions}
          onSave={tx => { upsertTransaction(tx); setAddOpen(false) }}
          onClose={() => setAddOpen(false)}
        />
      )}
    </div>
  )
}

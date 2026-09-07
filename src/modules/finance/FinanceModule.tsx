import { useState } from 'react'
import { useFinanceStore } from './financeStore'
import { TodayScreen } from './screens/TodayScreen'
import { BalanceScreen } from './screens/BalanceScreen'
import { BudgetScreen } from './screens/BudgetScreen'
import { ReportsScreen } from './screens/ReportsScreen'
import { ReflectionScreen } from './screens/ReflectionScreen'
import { GoalsScreen } from './screens/GoalsScreen'
import { PlanScreen } from './screens/PlanScreen'
import { TransactionModal } from './modals/TransactionModal'
import { BulkEntryModal } from './modals/BulkEntryModal'
import { LockGate } from './FinanceLockScreen'
import { useFinanceLock } from './useFinanceLock'
import { NavRow, Button } from '@/components/ui'
import { lockNow } from './lock'

// ─── Nav icon SVGs ────────────────────────────────────────────────────────────

/** The rail's own glyphs. They take the row's colour unless told otherwise,
 *  and accept the props NavRow hands every icon. */
interface RailIconProps { color?: string; size?: number; strokeWidth?: number; style?: React.CSSProperties }

function IconToday({ color = 'currentColor' }: RailIconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4.5" width="18" height="16" rx="2.5"/>
      <path d="M3 9h18M8 2.5v4M16 2.5v4"/>
      <circle cx="12" cy="14.5" r="1.4" fill={color} stroke="none"/>
    </svg>
  )
}

function IconBalance({ color = 'currentColor' }: RailIconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v18"/>
      <path d="M6 7l-3 6h6l-3-6zM18 7l-3 6h6l-3-6z"/>
      <path d="M5 21h14M8 7h8"/>
    </svg>
  )
}

function IconBudget({ color = 'currentColor' }: RailIconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="6" width="18" height="13" rx="2.5"/>
      <path d="M3 10.5h18"/>
      <circle cx="16.5" cy="14.5" r="1.3" fill={color} stroke="none"/>
    </svg>
  )
}

function IconReports({ color = 'currentColor' }: RailIconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-9-9v9z"/>
      <path d="M14 3.5A9 9 0 0 1 20.5 10H14z"/>
    </svg>
  )
}

function IconFinancials({ color = 'currentColor' }: RailIconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="2"/>
      <path d="M8 13v4M12 9v8M16 11v6"/>
    </svg>
  )
}


function IconGoals({ color = 'currentColor' }: RailIconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 13l18-7-6 15-3-6z"/>
    </svg>
  )
}

function IconPlan({ color = 'currentColor' }: RailIconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 3L5 14h6l-1 7 8-11h-6z"/>
    </svg>
  )
}

function IconLock({ color = 'currentColor' }: RailIconProps) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="10.5" width="16" height="10.5" rx="2.5"/>
      <path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9"/>
    </svg>
  )
}

function IconPlus({ color = 'currentColor' }: RailIconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19"/>
      <line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  )
}

// ─── Nav items ────────────────────────────────────────────────────────────────

// Bills was a second place to write down a recurring payment, and it wrote to
// nothing: a budget rule with a day on it already says what leaves and when,
// and puts the entry in the ledger where every total can see it.
type FinanceScreen = 'today' | 'balance' | 'budget' | 'reports' | 'reflect' | 'goals' | 'plan'

const NAV_ITEMS: { id: FinanceScreen; label: string; Icon: (p: RailIconProps) => React.ReactElement }[] = [
  { id: 'today',   label: 'Today',      Icon: IconToday },
  { id: 'balance', label: 'Balance',    Icon: IconBalance },
  { id: 'budget',  label: 'Budget',     Icon: IconBudget },
  { id: 'reports', label: 'Reports',    Icon: IconReports },
  { id: 'reflect', label: 'Financials', Icon: IconFinancials },
  { id: 'goals',   label: 'Goals',      Icon: IconGoals },
  { id: 'plan',    label: 'Plan',       Icon: IconPlan },
]

// ─── Finance Module ───────────────────────────────────────────────────────────

export function FinanceModule() {
  const { accounts, categories, transactions, upsertTransaction, upsertTransactions } = useFinanceStore()

  // Nothing on any of these screens is drawn until it is you. The gate is
  // rendered *instead of* the module, not over it, so a screenshot of the tab
  // behind it does not exist to be taken.
  const { locked, config: lockConfig, unlock, relock } = useFinanceLock()

  const [screen, setScreen] = useState<FinanceScreen>(() => {
    const saved = localStorage.getItem('finance-active-screen')
    return (NAV_ITEMS.some(n => n.id === saved) ? saved : 'today') as FinanceScreen
  })

  function handleSetScreen(s: FinanceScreen) {
    localStorage.setItem('finance-active-screen', s)
    setScreen(s)
  }
  const [addOpen, setAddOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)

  const [navItems, setNavItems] = useState<{ id: FinanceScreen; label: string; Icon: (p: RailIconProps) => React.ReactElement }[]>(() => {
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
      case 'reports': return <ReportsScreen {...props} />
      case 'reflect': return <ReflectionScreen {...props} />
      case 'goals':   return <GoalsScreen />
      case 'plan':    return <PlanScreen />
    }
  }

  if (locked) return <LockGate onUnlocked={unlock} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--sb-page)' }}>

      {/* Layer 1 — main app header (64px): aligns with sidebar logo */}

      {/* Layer 2 — Finance sub-nav (44px): module-specific tabs */}
      <div style={{
        height: 44, flexShrink: 0,
        background: 'var(--sb-header)',
        borderBottom: 'var(--sb-border-width) solid var(--sb-border)',
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
              <NavRow
                key={id}
                draggable
                onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; setDraggedTab(id) }}
                onDragOver={e => { e.preventDefault(); setDropTab(id) }}
                onDrop={e => { e.preventDefault(); if (draggedTab) reorderTabs(draggedTab, id); setDropTab(null) }}
                onDragEnd={() => { setDraggedTab(null); setDropTab(null) }}
                onClick={() => handleSetScreen(id)}
                active={active}
                Icon={Icon}
                label={label}
                style={{
                  width: 'auto', height: 30, cursor: 'grab',
                  opacity: isDragging ? 0.35 : 1,
                  outline: isDropTarget ? 'var(--sb-border-width) solid var(--sb-accent)' : 'none',
                }}
              />
            )
          })}
        </div>

        {/* Put it away now, rather than waiting for the idle clock */}
        {lockConfig.enabled && (
          <button
            onClick={() => { lockNow(); relock() }}
            title="Lock the finances"
            style={{
              height: 30, width: 30, borderRadius: 'var(--sb-r-chip)', marginRight: 7,
              background: 'transparent', border: 'var(--sb-border-width) solid var(--sb-border)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}
          >
            <IconLock color="var(--sb-ink-3)" />
          </button>
        )}

        {/* Many at once — the same entry, five or fifty times over */}
        <button
          onClick={() => setBulkOpen(true)}
          title="Add several entries at once"
          style={{
            height: 30, paddingInline: 12, borderRadius: 'var(--sb-r-chip)',
            background: 'transparent', border: 'var(--sb-border-width) solid var(--sb-border)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, gap: 5, marginRight: 7,
            fontFamily: 'inherit', fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-3)',
          }}
        >
          <IconPlus color="var(--sb-ink-3)" />
          Bulk
        </button>

        {/* Add transaction button */}
        <Button variant="accent" onClick={() => setAddOpen(true)} title="Add one entry" style={{ flexShrink: 0 }}>
          <IconPlus color="var(--sb-ink-1)" />
        </Button>
      </div>

      {/* Screen content */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {renderScreen()}
      </div>

      {bulkOpen && (
        <BulkEntryModal
          accounts={accounts}
          categories={categories}
          onSave={txs => { void upsertTransactions(txs); setBulkOpen(false) }}
          onClose={() => setBulkOpen(false)}
        />
      )}

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

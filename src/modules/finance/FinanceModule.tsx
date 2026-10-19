import { useState, useEffect } from 'react'
import { useFinanceStore } from './financeStore'
import { TodayScreen } from './screens/TodayScreen'
import { BalanceScreen } from './screens/BalanceScreen'
import { OPEN_ACCOUNT } from './openAccount'
import { BudgetScreen } from './screens/BudgetScreen'
import { ReportsScreen } from './screens/ReportsScreen'
import { ReflectionScreen } from './screens/ReflectionScreen'
import { GoalsScreen } from './screens/GoalsScreen'
import { ShoppingScreen } from './screens/ShoppingScreen'
import { TransactionModal } from './modals/TransactionModal'
import { BulkEntryModal } from './modals/BulkEntryModal'
import { LockGate } from './FinanceLockScreen'
import { useFinanceLock } from './useFinanceLock'
import { NavRow, Button } from '@/components/ui'
import { lockNow } from './lock'
import { T } from '@/lib/type'
import { useFillsTheWindow } from '@/lib/fillsTheWindow'
import { LOZENGE } from '../../components/SideRail'

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

function IconLock({ color = 'currentColor' }: RailIconProps) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="10.5" width="16" height="10.5" rx="2.5"/>
      <path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9"/>
    </svg>
  )
}

function IconShopping({ color = 'currentColor' }: RailIconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
      <line x1="3" y1="6" x2="21" y2="6"/>
      <path d="M16 10a4 4 0 0 1-8 0"/>
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
// Plan was a debt payoff drawn on sample data beside a Goals screen that planned
// from the ledger. A card with a balance is a goal with a target of zero, so
// the cards are in Goals now and there is one screen for what money has to do.
type FinanceScreen = 'today' | 'balance' | 'budget' | 'reports' | 'reflect' | 'goals' | 'shopping'

// Shopping is only shown when the user has enabled it in Settings.
function shoppingEnabled(): boolean {
  try {
    const raw = localStorage.getItem('shopping-settings')
    if (!raw) return false
    const s = JSON.parse(raw) as { enabled?: boolean }
    return s.enabled === true
  } catch { return false }
}

type NavItem = { id: FinanceScreen; label: string; Icon: (p: RailIconProps) => React.ReactElement }

// Seven screens in one row read as a list to hunt through. They are three
// questions: where is the money (Money), where is it going (Plan), and what
// did it do (Review). The order inside a group is fixed, so a screen is always
// in the same place — which is why dragging tabs to reorder them is gone: it
// could only ever scramble the groups.
// Forecast is not a screen of its own: it is the rules disclosure inside Goals.
const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  { label: 'Money',  items: [
    { id: 'today',   label: 'Today',      Icon: IconToday },
    { id: 'balance', label: 'Balance',    Icon: IconBalance },
    { id: 'budget',  label: 'Budget',     Icon: IconBudget },
  ] },
  { label: 'Plan',   items: [
    { id: 'goals',   label: 'Goals',      Icon: IconGoals },
  ] },
  { label: 'Review', items: [
    { id: 'reflect', label: 'Financials', Icon: IconFinancials },
    { id: 'reports', label: 'Reports',    Icon: IconReports },
  ] },
]

/** Shopping stays in this bar until it has a place of its own in the main menu. */
function shoppingItems(): NavItem[] {
  return shoppingEnabled() ? [{ id: 'shopping', label: 'Shopping', Icon: IconShopping }] : []
}

// ─── Finance Module ───────────────────────────────────────────────────────────

export function FinanceModule() {
  const { accounts, categories, transactions, upsertTransaction, upsertTransactions } = useFinanceStore()

  // Nothing on any of these screens is drawn until it is you. The gate is
  // rendered *instead of* the module, not over it, so a screenshot of the tab
  // behind it does not exist to be taken.
  const { locked, config: lockConfig, unlock, relock } = useFinanceLock()

  const [screen, setScreen] = useState<FinanceScreen>(() => {
    const saved = localStorage.getItem('finance-active-screen')
    const known = NAV_GROUPS.some(g => g.items.some(n => n.id === saved)) || (saved === 'shopping' && shoppingEnabled())
    return (known ? saved : 'today') as FinanceScreen
  })

  function handleSetScreen(s: FinanceScreen) {
    localStorage.setItem('finance-active-screen', s)
    setScreen(s)
  }
  const [addOpen, setAddOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)

  // Shopping appears when Settings turns it on (the same tab gets a synthetic `storage` event).
  const [shopItems, setShopItems] = useState<NavItem[]>(shoppingItems)
  useEffect(() => {
    function onStorage(e: StorageEvent) { if (e.key === 'shopping-settings') setShopItems(shoppingItems()) }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  // A debt goal on Goals can send you to the account it is derived from.
  // Balances is not mounted at that moment, so the switch happens here and the
  // id is claimed by the screen once it is up (`takePendingAccount`).
  useEffect(() => {
    const go = () => setScreen('balance')
    window.addEventListener(OPEN_ACCOUNT, go)
    return () => window.removeEventListener(OPEN_ACCOUNT, go)
  }, [])

  function renderScreen() {
    const props = { onOpenAdd: () => setAddOpen(true) }
    switch (screen) {
      case 'today':   return <TodayScreen />
      case 'balance': return <BalanceScreen />
      case 'budget':  return <BudgetScreen />
      case 'reports': return <ReportsScreen {...props} />
      case 'reflect': return <ReflectionScreen {...props} />
      case 'goals':    return <GoalsScreen />
      case 'shopping': return <ShoppingScreen />
    }
  }

  const { ref: fillRef, height: fillHeight } = useFillsTheWindow(360)

  if (locked) return <LockGate onUnlocked={unlock} />

  return (
    // **Measured, not `height: 100%`.** `ActiveModule` renders every module in
    // a bare `<div>` with no height of its own, so a percentage here resolves
    // against `auto` and is ignored: the module fell back to its content,
    // came out taller than `<main>`, and `<main>` — which does have
    // `overflow-y: auto` — became the scroller for the whole screen. Scrolling
    // the Financials entries panel therefore took the table with it, and the
    // panel's own `overflowY: auto` never fired because its content fitted the
    // box it had grown to. With a real height the module bounds its own
    // columns and each one scrolls where it should.
    <div ref={fillRef} style={{ display: 'flex', flexDirection: 'column', height: fillHeight ?? '100%', overflow: 'hidden', background: 'var(--sb-page)' }}>

      {/* Layer 1 — main app header (64px): aligns with sidebar logo */}

      {/* Layer 2 — Finance sub-nav (44px): module-specific tabs */}
      {/* **A lozenge on the page's own ground, not a strip across it.** This was
          a full-bleed `--sb-header` bar with square corners and a rule under
          it, running edge to edge — the one thing left on screen still drawn
          as a slab after `.cal-panel` and the rail gave theirs up. Beside two
          floating pills it reads as broken rather than as part of the page.
          It is the rail's own `LOZENGE` now, imported rather than retyped, so
          the module's tabs and the main menu cannot drift apart. The rule
          goes with the slab: a floating object does not draw a line across
          the page, the gap under it is the separation. */}
      <div data-finance-tabs style={{
        ...LOZENGE,
        height: 44, flexShrink: 0,
        margin: '2px 14px 10px',
        display: 'flex', alignItems: 'center',
        padding: '0 10px', gap: 2,
      }}>
        {/* Nav tabs — three groups, fixed order. The caption names the question the group answers;
            below a phone's width it goes and the divider alone says where one group ends. */}
        <nav aria-label="Finance sections" style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 1, overflowX: 'auto' }}>
          {[...NAV_GROUPS, ...(shopItems.length ? [{ label: '', items: shopItems }] : [])].map((group, gi) => (
            <div key={group.label || 'extra'} data-finance-group={group.label || undefined} role="group" aria-label={group.label || undefined}
              style={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
              {gi > 0 && <span aria-hidden style={{ width: 1, height: 18, background: 'var(--sb-border)', margin: '0 8px', flexShrink: 0 }} />}
              {group.label && <span className="fin-group-cap" style={{ ...T.micro, color: 'var(--sb-ink-3)', marginRight: 4 }}>{group.label}</span>}
              {group.items.map(({ id, label, Icon }) => (
                <NavRow
                  key={id}
                  onClick={() => handleSetScreen(id)}
                  active={screen === id}
                  Icon={Icon}
                  label={label}
                  style={{ width: 'auto', height: 30 }}
                />
              ))}
            </div>
          ))}
        </nav>

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
          {/* Inherited, not restated. The accent variant already carries
              `--sb-accent-ink`, which is the ink chosen for that fill in each
              theme; naming `--sb-ink-1` here overrode it with a colour that is
              2.3 on Evergreen's green and 2.31 on Glass's violet. */}
          <IconPlus />
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

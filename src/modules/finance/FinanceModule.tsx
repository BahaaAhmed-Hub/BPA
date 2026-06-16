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

// ─── Keypad ───────────────────────────────────────────────────────────────────

const KEYPAD_ROWS = [
  ['7','8','9','÷'],
  ['4','5','6','×'],
  ['1','2','3','−'],
  ['.','0','⌫','+'],
]

function evalExpr(expr: string): string {
  try {
    const normalized = expr.replace(/÷/g, '/').replace(/×/g, '*').replace(/−/g, '-')
    // eslint-disable-next-line no-new-func
    const result = Function('"use strict"; return (' + normalized + ')')() as number
    if (!isFinite(result)) return '0'
    return String(parseFloat(result.toFixed(2)))
  } catch {
    return expr
  }
}

// ─── Add Transaction Modal ────────────────────────────────────────────────────

const TX_TYPES = [
  'Expense',
  'Income',
  'Money Transfer',
  'Asset Purchase',
  'Asset Sale',
  'Liability Acquisition',
  'Discharge of Liability',
]

interface ColorMap {
  bg: string; rail: string; panel: string; surface: string; surfaceEl: string
  amberBg: string; border: string; borderSt: string; divFaint: string
  amber: string; amberSoft: string; textPri: string; textMuted: string
  textDim: string; red: string; green: string; cyan: string; purple: string
}

interface AddModalProps {
  onClose: () => void
  colors: ColorMap
}

function AddTransactionModal({ onClose, colors: C }: AddModalProps) {
  const [txLabel, setTxLabel] = useState('Expense')
  const [typeMenuOpen, setTypeMenuOpen] = useState(false)
  const [keypadOpen, setKeypadOpen] = useState(false)
  const [expr, setExpr] = useState('0')
  const [cur, setCur] = useState<'EGP' | 'USD' | 'AED'>('EGP')

  const addTransaction = useFinanceStore(s => s.addTransaction)

  function handleKey(k: string) {
    if (k === '=') {
      setExpr(evalExpr(expr))
      return
    }
    if (k === '⌫') {
      setExpr(e => e.length <= 1 ? '0' : e.slice(0, -1))
      return
    }
    setExpr(e => {
      if (e === '0' && !isNaN(Number(k))) return k
      return e + k
    })
  }

  function handleSave() {
    const amount = parseFloat(evalExpr(expr))
    if (!isNaN(amount) && amount > 0) {
      addTransaction({
        accountId: 'cib-dc',
        amount,
        currency: cur,
        type: txLabel === 'Expense' ? 'expense' : txLabel === 'Income' ? 'income' : 'transfer',
        payee: 'New Transaction',
        date: new Date().toISOString().slice(0, 10),
        isCleared: false,
        isRecurring: false,
      })
    }
    onClose()
  }

  const txColor = txLabel === 'Expense' ? C.red : txLabel === 'Income' ? C.green : C.cyan

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 470,
          background: C.panel,
          borderRadius: 22,
          boxShadow: '0 30px 80px rgba(0,0,0,.7)',
          animation: 'slideUp 0.22s ease',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px 14px' }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 15, cursor: 'pointer', fontFamily: 'inherit' }}>
            Cancel
          </button>
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setTypeMenuOpen(o => !o)}
              style={{ background: 'none', border: 'none', color: txColor, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4 }}
            >
              {txLabel}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={txColor} strokeWidth="2.5">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>
            {typeMenuOpen && (
              <div style={{
                position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
                background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12,
                overflow: 'hidden', zIndex: 10, minWidth: 220, marginTop: 6,
                boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
              }}>
                {TX_TYPES.map(t => (
                  <button
                    key={t}
                    onClick={() => { setTxLabel(t); setTypeMenuOpen(false) }}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      width: '100%', padding: '11px 18px', background: 'none',
                      border: 'none', color: t === txLabel ? C.amber : C.textPri,
                      fontSize: 14, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                    }}
                  >
                    {t}
                    {t === txLabel && <span style={{ color: C.amber }}>✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={handleSave} style={{ background: 'none', border: 'none', color: C.amber, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            Save
          </button>
        </div>

        <div style={{ borderTop: `1px solid ${C.border}` }} />

        {/* Account row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 22px' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth="1.7" strokeLinecap="round">
            <rect x="3" y="6" width="18" height="13" rx="2.5"/>
            <path d="M3 10.5h18"/>
            <circle cx="16.5" cy="14.5" r="1.3" fill={C.textMuted} stroke="none"/>
          </svg>
          <span style={{ flex: 1, color: C.textPri, fontSize: 15 }}>CIB DC ·· 4471</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth="2">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </div>

        <div style={{ borderTop: `1px solid ${C.divFaint}` }} />

        {/* Category / Amount row */}
        <div
          onClick={() => setKeypadOpen(o => !o)}
          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 22px', cursor: 'pointer' }}
        >
          <span style={{ flex: 1, color: C.textMuted, fontSize: 15 }}>No Category</span>
          <span style={{ color: C.textPri, fontSize: 22, fontWeight: 600, letterSpacing: '-0.5px' }}>
            {cur} {expr}
          </span>
        </div>

        {/* Keypad */}
        {keypadOpen && (
          <div style={{ padding: '8px 16px 16px' }}>
            {/* Currency chips */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              {(['EGP','USD','AED'] as const).map(c => (
                <button
                  key={c}
                  onClick={() => setCur(c)}
                  style={{
                    padding: '5px 14px', borderRadius: 20,
                    background: cur === c ? C.amber : C.surface,
                    border: `1px solid ${cur === c ? C.amber : C.border}`,
                    color: cur === c ? '#0B0A08' : C.textMuted,
                    fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  {c}
                </button>
              ))}
            </div>

            {/* Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6 }}>
              {KEYPAD_ROWS.map(row =>
                row.map(k => {
                  const isOp = ['÷','×','−','+'].includes(k)
                  return (
                    <button
                      key={k}
                      onClick={() => handleKey(k)}
                      style={{
                        height: 56, borderRadius: 12,
                        background: C.surface,
                        border: `1px solid ${C.border}`,
                        color: isOp ? C.amber : C.textPri,
                        fontSize: isOp ? 20 : 18,
                        fontWeight: 500,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >
                      {k}
                    </button>
                  )
                })
              )}
            </div>

            {/* Equals button */}
            <button
              onClick={() => handleKey('=')}
              style={{
                width: '100%', height: 52, marginTop: 6,
                borderRadius: 12,
                background: C.amber,
                border: 'none',
                color: '#0B0A08',
                fontSize: 20, fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              =
            </button>
          </div>
        )}

        {!keypadOpen && (
          <>
            {/* Split icon row */}
            <div style={{ borderTop: `1px solid ${C.divFaint}` }} />
            <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 22px' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.textDim} strokeWidth="1.7" strokeLinecap="round">
                <path d="M16 3h5v5M8 21H3v-5M21 3l-7 7M3 21l7-7"/>
              </svg>
            </div>

            {/* Date row */}
            <div style={{ borderTop: `1px solid ${C.divFaint}` }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 22px' }}>
              <span style={{ flex: 1, color: C.textPri, fontSize: 15 }}>
                {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ color: C.textMuted, fontSize: 13, fontWeight: 600, letterSpacing: '0.5px' }}>PAID</span>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%',
                  background: C.amber,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0B0A08" strokeWidth="3" strokeLinecap="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </div>
              </div>
            </div>

            {/* Quick actions row */}
            <div style={{ borderTop: `1px solid ${C.divFaint}` }} />
            <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', padding: '14px 22px' }}>
              {/* Note */}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.textDim} strokeWidth="1.7" strokeLinecap="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              {/* Photo */}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.textDim} strokeWidth="1.7" strokeLinecap="round">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
              {/* Hashtag */}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.textDim} strokeWidth="1.7" strokeLinecap="round">
                <line x1="4" y1="9" x2="20" y2="9"/>
                <line x1="4" y1="15" x2="20" y2="15"/>
                <line x1="10" y1="3" x2="8" y2="21"/>
                <line x1="16" y1="3" x2="14" y2="21"/>
              </svg>
              {/* Person */}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.textDim} strokeWidth="1.7" strokeLinecap="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
              {/* Drawer */}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.textDim} strokeWidth="1.7" strokeLinecap="round">
                <polyline points="8 6 12 2 16 6"/>
                <line x1="12" y1="2" x2="12" y2="15"/>
                <path d="M20 21H4a2 2 0 0 1-2-2v-4h4l2 3h8l2-3h4v4a2 2 0 0 1-2 2z"/>
              </svg>
            </div>
          </>
        )}
      </div>

      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(30px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
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

      {addOpen && <AddTransactionModal onClose={() => setAddOpen(false)} colors={C} />}
    </div>
  )
}

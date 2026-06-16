import { useState } from 'react'
import { useUIStore } from '@/store/uiStore'
import { getTheme } from '@/lib/themes'
import { useFinanceStore } from '../financeStore'
import { CategoryModal } from '../modals/CategoryModal'
import type { Category } from '../types'

// ─── Data ─────────────────────────────────────────────────────────────────────

const TIMELINE_DATA = [14, -44, 8, 52, 40, 26, -20, -32, 18, -14, 30, -10, 46, -38, 12, -26, 8, -16, 0, 0, 0, 0, 0, 0, 0, 0]

const EXPENSE_CATS = [
  { icon: '👤', name: 'Personal',     actual: '46,356', budget: '41,672', over: true  },
  { icon: '👧', name: 'Girls Life',   actual: '36,530', budget: '26,668', over: true  },
  { icon: '🏛',  name: 'Debt',        actual: '27,500', budget: '7,790',  over: true  },
  { icon: '🌐', name: 'Digital Apps', actual: '7,730',  budget: '163',    over: true  },
  { icon: '💼', name: 'DX Business',  actual: '7,004',  budget: '0',      over: true  },
  { icon: '🚗', name: 'Car',          actual: '1,095',  budget: '1,035',  over: true  },
  { icon: '📦', name: 'Misc',         actual: '600',    budget: '0',      over: true  },
  { icon: '🚰', name: 'Utilities',    actual: '0',      budget: '172',    over: false },
]

const INCOME_CATS = [
  { icon: '💵', name: 'Teradix Salary', actual: '140,000', budget: '29,355' },
  { icon: '🔷', name: 'DX Salary',      actual: '0',       budget: '1,581'  },
]

// ─── Month helpers ────────────────────────────────────────────────────────────

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

function parseMonth(ym: string): { year: number; month: number } {
  const [y, m] = ym.split('-').map(Number)
  return { year: y, month: m }
}

function formatMonthLabel(ym: string): string {
  const { year, month } = parseMonth(ym)
  return `${MONTH_NAMES[month - 1].slice(0, 3)} ${year}`
}

function addMonth(ym: string, delta: number): string {
  const { year, month } = parseMonth(ym)
  const d = new Date(year, month - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// ─── Color map type ───────────────────────────────────────────────────────────

interface Colors {
  bg: string; surface: string; amberBg: string; border: string; borderSt: string
  amber: string; textPri: string; textMuted: string; textDim: string
  red: string; green: string
}

// ─── Category Cell ────────────────────────────────────────────────────────────

function CategoryCell({
  icon, name, actual, budget, over, isIncome, C,
}: {
  icon: string; name: string; actual: string; budget: string; over?: boolean; isIncome?: boolean; C: Colors
}) {
  const ringColor = isIncome ? C.green : over ? C.red : C.borderSt
  const actualColor = isIncome ? C.green : over ? C.red : C.amber
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
      <div style={{
        width: 64, height: 64, borderRadius: '50%',
        border: `2.5px solid ${ringColor}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 26, background: C.surface,
      }}>
        {icon}
      </div>
      <div style={{ fontSize: 11.5, color: C.textPri, marginTop: 9 }}>{name}</div>
      <div style={{ fontSize: 13, color: actualColor, marginTop: 2 }}>{actual}</div>
      <div style={{ fontSize: 11, color: C.textDim, marginTop: 1 }}>{budget}</div>
    </div>
  )
}

// ─── Section label row ────────────────────────────────────────────────────────

function SectionRow({ label, main, mainColor, sub, C }: {
  label: string; main: string; mainColor: string; sub: string; C: Colors
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      marginBottom: 16,
    }}>
      <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.8px', color: C.textMuted }}>
        {label}
      </span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: mainColor }}>{main}</span>
        <span style={{ fontSize: 14, color: C.textDim }}>{sub}</span>
      </div>
    </div>
  )
}

// ─── Budget Screen ────────────────────────────────────────────────────────────

export function BudgetScreen(_props?: { onOpenAdd?: () => void }) {
  const themeId = useUIStore(s => s.themeId)
  const theme = getTheme(themeId)
  const C: Colors = {
    bg:        theme.bg,
    surface:   theme.surface,
    amberBg:   theme.accentFill,
    border:    theme.border,
    borderSt:  theme.border,
    amber:     theme.accent,
    textPri:   theme.text,
    textMuted: theme.textDim,
    textDim:   theme.textMuted,
    red:       '#DA4A3E',
    green:     '#2FA869',
  }

  const { categories, upsertCategory, removeCategory } = useFinanceStore()

  const [reportMode, setReportMode] = useState<'actual' | 'remaining'>('actual')
  const [currentMonth, setCurrentMonth] = useState('2026-06')
  const [catModal, setCatModal] = useState<{ open: false } | { open: true; category: Category | null }>({ open: false })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%', overflow: 'hidden', background: C.bg }}>

      {/* Header */}
      <div style={{
        height: 64, flexShrink: 0,
        borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 30px',
      }}>
        {/* Left: Edit + Manage Categories */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 13, color: C.textMuted, cursor: 'pointer' }}>Edit</span>
          <button
            onClick={() => setCatModal({ open: true, category: null })}
            title="Manage Categories"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 16,
              color: C.textMuted,
              padding: '2px 4px',
              fontFamily: 'inherit',
              lineHeight: 1,
            }}
          >
            ⚙
          </button>
        </div>

        {/* Center: month nav */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button
            onClick={() => setCurrentMonth(addMonth(currentMonth, -1))}
            style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 20, cursor: 'pointer', fontFamily: 'inherit', padding: '2px 6px', lineHeight: 1 }}
          >
            ‹
          </button>
          <span style={{ fontSize: 20, fontWeight: 600, color: C.textPri, minWidth: 90, textAlign: 'center' }}>
            {formatMonthLabel(currentMonth)}
          </span>
          <button
            onClick={() => setCurrentMonth(addMonth(currentMonth, 1))}
            style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 20, cursor: 'pointer', fontFamily: 'inherit', padding: '2px 6px', lineHeight: 1 }}
          >
            ›
          </button>
        </div>

        {/* Right: mode toggle */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => setReportMode('actual')}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 13, fontWeight: 600,
              color: reportMode === 'actual' ? C.amber : C.textDim,
            }}
          >
            Actual / Budget
          </button>
          <button
            onClick={() => setReportMode('remaining')}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 13, fontWeight: 600,
              color: reportMode === 'remaining' ? C.amber : C.textDim,
            }}
          >
            Remaining
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>

        {/* Timeline bars (actual mode only) */}
        {reportMode === 'actual' && (
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 10 }}>EGP 179,658.00</div>
            <div style={{ display: 'flex', alignItems: 'stretch', gap: 5, height: 150 }}>
              {TIMELINE_DATA.map((v, i) => {
                const h = v === 0 ? 0 : Math.max(Math.round(Math.abs(v) / 55 * 68), 3)
                return (
                  <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    {/* Top half — green bar grows from bottom */}
                    <div style={{ height: 72, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                      {v > 0 && (
                        <div style={{
                          height: h, maxWidth: 18, width: '100%',
                          background: C.green, borderRadius: '3px 3px 0 0',
                          margin: '0 auto',
                        }} />
                      )}
                    </div>
                    {/* Divider */}
                    <div style={{ height: 1, background: C.border, flexShrink: 0 }} />
                    {/* Bottom half — red bar grows from top */}
                    <div style={{ height: 72, display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
                      {v < 0 && (
                        <div style={{
                          height: h, maxWidth: 18, width: '100%',
                          background: C.red, borderRadius: '0 0 3px 3px',
                          margin: '0 auto',
                        }} />
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Expenses section */}
        <div style={{ marginBottom: 32 }}>
          <SectionRow label="Expenses" main="126,815" mainColor={C.red} sub="/ EGP 82,467" C={C} />
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(8, 1fr)',
            gap: '14px 8px',
          }}>
            {EXPENSE_CATS.map(cat => (
              <CategoryCell key={cat.name} {...cat} C={C} />
            ))}
          </div>
        </div>

        {/* Income section */}
        <div style={{ marginBottom: 32 }}>
          <SectionRow label="Income" main="140,000" mainColor={C.green} sub="/ EGP 108,893" C={C} />
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(8, 1fr)',
            gap: '14px 8px',
          }}>
            {INCOME_CATS.map(cat => (
              <CategoryCell key={cat.name} {...cat} isIncome C={C} />
            ))}
          </div>
        </div>

      </div>

      {/* CategoryModal */}
      {catModal.open && (
        <CategoryModal
          category={catModal.category}
          categories={categories}
          onSave={c => { upsertCategory(c); setCatModal({ open: false }) }}
          onDelete={id => { removeCategory(id); setCatModal({ open: false }) }}
          onClose={() => setCatModal({ open: false })}
        />
      )}
    </div>
  )
}

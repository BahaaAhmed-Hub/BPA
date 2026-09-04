import { useState } from 'react'
import { useFinanceStore } from '../financeStore'
import type { Goal } from '../types'
import { MoneyInput } from '../components/MoneyInput'

// ─── Design tokens ────────────────────────────────────────────────────────────

const C = {
  bg:       '#F7F4EA',
  surface:  '#FFFFFF',
  field:    '#FAF7EC',
  border:   '#E8E1CE',
  hair:     '#F0EBDC',
  hair2:    '#EFEADB',
  ink1:     '#191712',
  ink2:     '#4A4438',
  ink3:     '#6C6553',
  ink4:     '#8A8272',
  accent:   '#F5D14E',
  accentBg: '#FDF6DE',
  accentBr: '#EFE1B4',
  olive:    '#0C8140',
  oliveBg:  '#E2F0E7',
  oliveBr:  '#D5E0B4',
  rust:     '#A31C1C',
  rustBg:   '#FAE3E3',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) { return n.toLocaleString('en-US') }
function pctStr(cur: number, tgt: number) { return Math.min(100, Math.round((cur / tgt) * 100)) }

// Derive month ETA from current, target, and monthly contribution rate
function etaLabel(cur: number, tgt: number, monthlyRate: number): string {
  if (cur >= tgt) return 'Done'
  if (monthlyRate <= 0) return 'No schedule'
  const months = Math.ceil((tgt - cur) / monthlyRate)
  const d = new Date()
  d.setMonth(d.getMonth() + months)
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}

// ─── Sample contribution history (last 8 months) ──────────────────────────────

const SAMPLE_CONTRIBUTIONS: Record<string, { month: string; amount: number; planned?: number }[]> = {
  default: [
    { month: 'Mar', amount: 8000 },
    { month: 'Apr', amount: 12000 },
    { month: 'May', amount: 6000 },
    { month: 'Jun', amount: 14000 },
    { month: 'Jul', amount: 0 },
    { month: 'Aug', amount: 11400 },
    { month: 'Sep', amount: 12000, planned: 12000 },
    { month: 'Oct', amount: 12000, planned: 12000 },
  ],
}

const FUNDING_OPTIONS = [
  { id: 'fixed',   label: 'Fixed monthly' },
  { id: 'rounds',  label: 'Round-ups' },
  { id: 'surplus', label: 'Share of surplus' },
  { id: 'manual',  label: 'Manual only' },
]

// ─── Goal Card (left panel list) ──────────────────────────────────────────────

function GoalCard({
  goal, selected, onSelect,
}: {
  goal: Goal; selected: boolean; onSelect: () => void
}) {
  const pct = pctStr(goal.currentAmount, goal.targetAmount)
  const isActive = selected
  return (
    <div
      onClick={onSelect}
      style={{
        display: 'flex', flexDirection: 'column', gap: 8,
        padding: '12px 13px', borderRadius: 14, cursor: 'pointer',
        background: isActive ? C.accentBg : C.surface,
        border: `1px solid ${isActive ? C.accentBr : C.hair2}`,
        transition: 'all 140ms ease-out',
        boxSizing: 'border-box' as const,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
        <div style={{
          width: 26, height: 26, borderRadius: 8,
          background: isActive ? 'rgba(255,255,255,.8)' : C.field,
          color: C.ink3,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, fontSize: 14,
        }}>
          {goal.icon || '🎯'}
        </div>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: C.ink1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
          {goal.name}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: C.ink3, flexShrink: 0 }}>{pct}%</span>
      </div>
      <div style={{ height: 8, borderRadius: 999, background: '#F0EBDC', overflow: 'hidden' }}>
        <span style={{ width: `${pct}%`, height: '100%', background: isActive ? C.ink1 : C.accent, borderRadius: 999, display: 'block', transition: 'width 300ms ease-out' }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12.5, fontWeight: 600, color: C.ink1, fontVariantNumeric: 'tabular-nums' as const }}>
          EGP {fmt(goal.currentAmount)}
        </span>
        <span style={{ fontSize: 10.5, color: C.ink3 }}>of EGP {fmt(goal.targetAmount)}</span>
        <span style={{ marginLeft: 'auto', fontSize: 10.5, color: C.ink3, flexShrink: 0 }}>
          {goal.sub || etaLabel(goal.currentAmount, goal.targetAmount, 10000)}
        </span>
      </div>
    </div>
  )
}

// ─── Featured Goal Detail (right panel top card — dark) ───────────────────────

function GoalDetail({ goal }: { goal: Goal }) {
  const pct = pctStr(goal.currentAmount, goal.targetAmount)
  const contributions = SAMPLE_CONTRIBUTIONS.default
  const maxAmt = Math.max(...contributions.map(c => c.amount || c.planned || 1))

  return (
    <div style={{
      flexShrink: 0, background: C.ink1, color: '#FDF8E7',
      borderRadius: 18, padding: '17px 20px',
      display: 'flex', gap: 24, alignItems: 'center',
    }}>
      {/* Identity */}
      <div style={{ width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.14em', opacity: .6, textTransform: 'uppercase' as const }}>
          {goal.name}
        </span>
        <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 34, fontWeight: 600, letterSpacing: '-.04em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' as const }}>
          EGP {fmt(goal.currentAmount)}
        </span>
        <span style={{ fontSize: 11, opacity: .65 }}>of EGP {fmt(goal.targetAmount)} · {pct}% cleared</span>
        <div style={{ marginTop: 7, height: 28, padding: '0 11px', borderRadius: 999, background: 'rgba(245,209,78,.16)', color: '#F5D14E', fontSize: 11.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7, alignSelf: 'flex-start' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 16l5-5 4 3 7-7"/><path d="M20 7h-4M20 7v4"/></svg>
          {goal.sub || 'On track'}
        </div>
      </div>

      <div style={{ width: 1, alignSelf: 'stretch', background: 'rgba(255,255,255,.13)', flexShrink: 0 }} />

      {/* Contribution bars */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.12em', opacity: .55, textTransform: 'uppercase' as const }}>Contributed, by month</span>
          <span style={{ fontSize: 11, opacity: .6 }}>Pale bars are planned</span>
        </div>
        <div style={{ height: 96, display: 'flex', gap: 8, alignItems: 'stretch', padding: '6px 10px', borderRadius: 12, background: 'rgba(255,255,255,.05)' }}>
          {contributions.map(c => {
            const isPlanned = c.planned && c.amount === c.planned
            const heightPct = maxAmt > 0 ? Math.max(c.amount || c.planned || 0, 0) / maxAmt * 100 : 0
            const isEmpty = !c.amount && !c.planned
            return (
              <div key={c.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'center', minWidth: 0 }}>
                <div style={{ width: '100%', flex: 1, display: 'flex', alignItems: 'flex-end', background: isEmpty ? 'rgba(198,40,40,.08)' : 'transparent', borderRadius: 6 }}>
                  <span style={{
                    width: '100%',
                    height: `${heightPct}%`,
                    minHeight: c.amount || c.planned ? 4 : 0,
                    background: isEmpty ? '#C62828' : isPlanned ? '#DCD5C0' : '#191712',
                    borderRadius: '5px 5px 0 0',
                    display: 'block',
                  }} />
                </div>
                <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 10, fontWeight: 600, color: isPlanned ? '#A8A091' : '#191712', fontVariantNumeric: 'tabular-nums' as const }}>
                  {c.amount === 0 ? '0' : fmt(c.amount || c.planned || 0)}
                </span>
                <span style={{ fontSize: 9.5, color: C.ink3 }}>{c.month}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div style={{ width: 1, alignSelf: 'stretch', background: 'rgba(255,255,255,.13)', flexShrink: 0 }} />

      {/* Stats */}
      <div style={{ width: 150, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 11 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.12em', opacity: .55, textTransform: 'uppercase' as const }}>Average month</span>
          <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, fontWeight: 600, letterSpacing: '-.03em', fontVariantNumeric: 'tabular-nums' as const }}>
            EGP {fmt(Math.round(
              contributions.filter(c => c.amount > 0).reduce((s, c) => s + c.amount, 0) /
              Math.max(1, contributions.filter(c => c.amount > 0).length)
            ))}
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.12em', opacity: .55, textTransform: 'uppercase' as const }}>Missed months</span>
          <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, fontWeight: 600, letterSpacing: '-.03em', color: '#E8A88E' }}>
            {contributions.filter(c => c.amount === 0 && !c.planned).length} of {contributions.filter(c => !c.planned).length}
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.12em', opacity: .55, textTransform: 'uppercase' as const }}>Still needed</span>
          <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, fontWeight: 600, letterSpacing: '-.03em', fontVariantNumeric: 'tabular-nums' as const }}>
            EGP {fmt(Math.max(0, goal.targetAmount - goal.currentAmount))}
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── Goals Screen ─────────────────────────────────────────────────────────────

export function GoalsScreen() {
  const { goals, upsertGoal } = useFinanceStore()

  const [selectedId, setSelectedId] = useState<string | null>(goals[0]?.id ?? null)
  const [tab, setTab] = useState<'active' | 'reporting' | 'finished'>('reporting')
  const [fundRule, setFundRule] = useState<string>('fixed')
  const [autoTransfer, setAutoTransfer] = useState(true)

  // New goal form
  const [newTarget, setNewTarget] = useState(0)
  const [newBy, setNewBy] = useState('')
  const [newName, setNewName] = useState('')
  const [newIcon, setNewIcon] = useState('🎯')

  const selected = goals.find(g => g.id === selectedId) ?? goals[0] ?? null

  function handleAddGoal() {
    if (!newName.trim() || newTarget <= 0) return
    const g: Goal = {
      id: crypto.randomUUID(),
      name: newName.trim(),
      icon: newIcon,
      targetAmount: newTarget,
      currentAmount: 0,
      color: '#F5D14E',
      sub: newBy || 'No deadline',
    }
    upsertGoal(g)
    setSelectedId(g.id)
    setNewName('')
    setNewTarget(0)
    setNewBy('')
    setNewIcon('🎯')
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.14em', color: C.ink3, textTransform: 'uppercase' as const }}>MONEY · AIM</span>
          <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, fontWeight: 600, letterSpacing: '-.03em', color: C.ink1 }}>Goals</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          {/* Tab toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: 34, boxSizing: 'border-box' as const, padding: 3, borderRadius: 999, background: '#EDE7D9' }}>
            {(['active', 'reporting', 'finished'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  height: 28, padding: '0 13px', borderRadius: 999,
                  background: tab === t ? C.surface : 'transparent',
                  boxShadow: tab === t ? '0 1px 3px rgba(25,23,18,.16)' : 'none',
                  color: tab === t ? C.ink1 : C.ink3, fontWeight: tab === t ? 600 : 500,
                  fontSize: 12, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  textTransform: 'capitalize' as const,
                }}
              >
                {t}
              </button>
            ))}
          </div>
          <button style={{
            height: 34, padding: '0 14px', borderRadius: 999,
            background: C.surface, border: `1px solid ${C.border}`,
            color: C.ink1, fontSize: 12.5, fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3l3 3-3 3"/><path d="M20 6H8a4 4 0 00-4 4v1"/><path d="M7 21l-3-3 3-3"/><path d="M4 18h12a4 4 0 004-4v-1"/></svg>
            Funding rules
          </button>
          <button style={{
            height: 34, padding: '0 15px', borderRadius: 999,
            background: C.accent, border: 'none',
            color: C.ink1, fontSize: 12.5, fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontFamily: 'inherit',
            boxShadow: '0 2px 0 rgba(25,23,18,.14)',
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            New goal
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, display: 'flex', gap: 14, padding: '18px 26px 22px', overflow: 'hidden', minHeight: 0 }}>

        {/* ── Left: Goals list + create form ── */}
        <div style={{
          width: 430, flexShrink: 0,
          background: C.surface, border: `1px solid ${C.border}`,
          borderRadius: 18, padding: '16px 18px',
          display: 'flex', flexDirection: 'column', gap: 11,
          overflowY: 'auto', boxSizing: 'border-box' as const,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.12em', color: C.ink3, textTransform: 'uppercase' as const }}>Goals</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: C.ink3 }}>
              {goals.length} active
            </span>
          </div>

          {/* Goal cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {goals.length === 0 && (
              <div style={{ textAlign: 'center', padding: '24px 0', color: C.ink3, fontSize: 13 }}>
                No goals yet. Create one below.
              </div>
            )}
            {goals.map(g => (
              <GoalCard
                key={g.id}
                goal={g}
                selected={selectedId === g.id}
                onSelect={() => setSelectedId(g.id)}
              />
            ))}
          </div>

          <div style={{ flex: 1 }} />

          {/* Create new goal */}
          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 7, paddingTop: 2, borderTop: `1px solid ${C.hair2}` }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.12em', color: C.ink3, textTransform: 'uppercase' as const }}>New goal</span>

            <div style={{ display: 'flex', gap: 7 }}>
              {/* Icon picker */}
              <div style={{ position: 'relative' as const }}>
                <div style={{
                  height: 40, width: 40, borderRadius: 11,
                  background: C.field, border: `1px solid ${C.border}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 18, cursor: 'pointer',
                }}>
                  {newIcon}
                </div>
              </div>
              {/* Name field */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
                <input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="Goal name"
                  style={{
                    height: 40, boxSizing: 'border-box' as const, padding: '0 12px',
                    borderRadius: 11, background: C.field, border: `1px solid ${C.border}`,
                    fontSize: 13, color: C.ink1, outline: 'none', fontFamily: 'inherit',
                    width: '100%',
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 9 }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.12em', color: C.ink3, textTransform: 'uppercase' as const }}>Target</span>
                <MoneyInput
                  value={newTarget}
                  min={0}
                  onChange={setNewTarget}
                  placeholder="60,000"
                  style={{
                    height: 40, boxSizing: 'border-box' as const, padding: '0 12px',
                    borderRadius: 11, background: C.field, border: `1px solid ${C.border}`,
                    fontSize: 13, color: C.ink1, outline: 'none', fontFamily: 'inherit',
                    width: '100%',
                  }}
                />
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.12em', color: C.ink3, textTransform: 'uppercase' as const }}>By</span>
                <input
                  value={newBy}
                  onChange={e => setNewBy(e.target.value)}
                  placeholder="Feb 2027"
                  style={{
                    height: 40, boxSizing: 'border-box' as const, padding: '0 12px',
                    borderRadius: 11, background: C.field, border: `1px solid ${C.border}`,
                    fontSize: 13, color: C.ink1, outline: 'none', fontFamily: 'inherit',
                    width: '100%',
                  }}
                />
              </div>
            </div>

            {/* Funding rule pills */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.12em', color: C.ink3, textTransform: 'uppercase' as const }}>Fund it</span>
              <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6 }}>
                {FUNDING_OPTIONS.map(o => (
                  <button
                    key={o.id}
                    onClick={() => setFundRule(o.id)}
                    style={{
                      height: 32, padding: '0 12px', borderRadius: 999,
                      background: fundRule === o.id ? C.ink1 : C.surface,
                      border: `1px solid ${fundRule === o.id ? C.ink1 : C.border}`,
                      color: fundRule === o.id ? '#FDF8E7' : C.ink3,
                      fontSize: 12, fontWeight: fundRule === o.id ? 600 : 500,
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Auto-transfer row */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 11, height: 46,
              padding: '0 13px', borderRadius: 12,
              background: C.field, border: `1px solid ${C.border}`,
              boxSizing: 'border-box' as const,
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: C.ink1 }}>
                  {fundRule === 'fixed' ? 'Move EGP 8,400 on payday' : 'Auto-fund on payday'}
                </span>
                <span style={{ fontSize: 10.5, color: C.ink3 }}>From CIB current, the day salary lands</span>
              </div>
              <div style={{ marginLeft: 'auto', flexShrink: 0 }}>
                <button
                  onClick={() => setAutoTransfer(!autoTransfer)}
                  style={{
                    width: 38, height: 22, borderRadius: 999,
                    background: autoTransfer ? C.ink1 : C.border,
                    border: 'none', cursor: 'pointer',
                    display: 'flex', alignItems: 'center',
                    padding: '0 3px', boxSizing: 'border-box' as const,
                    justifyContent: autoTransfer ? 'flex-end' : 'flex-start',
                    transition: 'background 140ms ease-out',
                  }}
                >
                  <span style={{ width: 16, height: 16, borderRadius: 999, background: '#FDF8E7', display: 'block' }} />
                </button>
              </div>
            </div>

            {/* Add button */}
            <button
              onClick={handleAddGoal}
              disabled={!newName.trim() || newTarget <= 0}
              style={{
                height: 36, borderRadius: 10,
                background: newName.trim() && newTarget > 0 ? C.accent : C.field,
                border: `1px solid ${newName.trim() && newTarget > 0 ? 'rgba(25,23,18,.18)' : C.border}`,
                color: C.ink1, fontSize: 13, fontWeight: 600,
                cursor: newName.trim() && newTarget > 0 ? 'pointer' : 'default',
                opacity: newName.trim() && newTarget > 0 ? 1 : 0.5,
                fontFamily: 'inherit',
                boxShadow: newName.trim() && newTarget > 0 ? '0 2px 0 rgba(25,23,18,.1)' : 'none',
              }}
            >
              Create goal
            </button>
          </div>
        </div>

        {/* ── Right: Selected goal detail ── */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
          {selected ? (
            <>
              <GoalDetail goal={selected} />

              {/* Two-column lower area */}
              <div style={{ flex: 1, display: 'flex', gap: 12, minHeight: 0 }}>

                {/* Milestones */}
                <div style={{
                  flex: 1, background: C.surface, border: `1px solid ${C.border}`,
                  borderRadius: 18, padding: '16px 18px',
                  display: 'flex', flexDirection: 'column', gap: 12,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.12em', color: C.ink3, textTransform: 'uppercase' as const }}>Milestones</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: C.ink3 }}>Every 25%</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {[25, 50, 75, 100].map(milestone => {
                      const pct = pctStr(selected.currentAmount, selected.targetAmount)
                      const done = pct >= milestone
                      const amt = Math.round(selected.targetAmount * milestone / 100)
                      return (
                        <div
                          key={milestone}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 10, height: 40,
                            padding: '0 11px', borderRadius: 11,
                            background: done ? C.oliveBg : C.field,
                            border: `1px solid ${done ? C.oliveBr : C.hair2}`,
                            boxSizing: 'border-box' as const,
                          }}
                        >
                          <div style={{
                            width: 20, height: 20, borderRadius: 999,
                            background: done ? C.olive : C.border,
                            color: '#FDF8E7',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            flexShrink: 0,
                          }}>
                            {done && (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>
                            )}
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 600, color: C.ink1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                            {milestone === 25 ? 'A quarter cleared' : milestone === 50 ? 'Halfway there' : milestone === 75 ? 'Three quarters done' : 'Goal complete'}
                          </span>
                          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 9, flexShrink: 0 }}>
                            {done && <span style={{ fontSize: 10.5, color: C.ink3 }}>{new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>}
                            <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12, fontWeight: 600, color: C.ink1, fontVariantNumeric: 'tabular-nums' as const }}>
                              {fmt(amt)}
                            </span>
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Funding rules card */}
                <div style={{
                  flex: 1, background: C.surface, border: `1px solid ${C.border}`,
                  borderRadius: 18, padding: '16px 18px',
                  display: 'flex', flexDirection: 'column', gap: 12,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.12em', color: C.ink3, textTransform: 'uppercase' as const }}>Funding rules</span>
                    <button style={{
                      marginLeft: 'auto', height: 26, padding: '0 10px', borderRadius: 7,
                      background: 'transparent', border: `1px solid ${C.border}`,
                      color: C.ink3, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                    }}>
                      Edit
                    </button>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {[
                      { label: 'Fixed monthly transfer', value: 'EGP 8,400', from: 'CIB current', when: 'On payday (1st)' },
                    ].map((rule, i) => (
                      <div key={i} style={{
                        display: 'flex', flexDirection: 'column', gap: 5,
                        padding: '10px 12px', borderRadius: 11,
                        background: C.field, border: `1px solid ${C.hair2}`,
                        boxSizing: 'border-box' as const,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: C.ink1 }}>{rule.label}</span>
                          <span style={{ marginLeft: 'auto', fontFamily: "'Outfit', sans-serif", fontSize: 13, fontWeight: 600, color: C.ink1, fontVariantNumeric: 'tabular-nums' as const }}>{rule.value}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 12 }}>
                          <span style={{ fontSize: 11, color: C.ink3 }}>From: <b style={{ color: C.ink2 }}>{rule.from}</b></span>
                          <span style={{ fontSize: 11, color: C.ink3 }}>When: <b style={{ color: C.ink2 }}>{rule.when}</b></span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Observation */}
                  <div style={{
                    marginTop: 'auto', padding: '10px 12px', borderRadius: 10,
                    background: pctStr(selected.currentAmount, selected.targetAmount) >= 80 ? C.oliveBg : C.accentBg,
                    border: `1px solid ${pctStr(selected.currentAmount, selected.targetAmount) >= 80 ? C.oliveBr : C.accentBr}`,
                  }}>
                    <span style={{ fontSize: 12, color: C.ink2, lineHeight: 1.55 }}>
                      {pctStr(selected.currentAmount, selected.targetAmount) >= 80
                        ? 'Almost there — one or two more contributions and this goal closes.'
                        : `At this rate you reach ${fmt(selected.targetAmount)} in ${etaLabel(selected.currentAmount, selected.targetAmount, 10000)}.`}
                    </span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexDirection: 'column', gap: 12, color: C.ink3,
            }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 13l18-7-6 15-3-6z"/></svg>
              <span style={{ fontSize: 14, fontWeight: 500 }}>Select a goal to see its detail</span>
              <span style={{ fontSize: 12 }}>Or create your first goal using the form on the left</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { useFinanceStore } from '../financeStore'

// ─── Design tokens ────────────────────────────────────────────────────────────

const C = {
  bg:      '#F7F4EA',
  surface: '#FFFFFF',
  field:   '#FAF7EC',
  border:  '#E8E1CE',
  hair:    '#F0EBDC',
  ink1:    '#191712',
  ink2:    '#4A4438',
  ink3:    '#6C6553',
  ink4:    '#8A8272',
  accent:  '#F5D14E',
  accentBg:'#FDF6DE',
  accentBr:'#EFE1B4',
  olive:   '#5F7038',
  oliveBg: '#EAF0D8',
  oliveTxt:'#7A8C5A',
  rust:    '#8A3B2A',
  rustDk:  '#8E3E28',
  muted:   '#C4BDA8',
  dark:    '#191712',
  darkSrf: 'rgba(253,248,231,0.14)',
}

function fmt(n: number) {
  return n.toLocaleString('en-US')
}

// ─── Sample data ──────────────────────────────────────────────────────────────

type Target = { id: string; icon: string; name: string; sub: string; type: 'card' | 'goal' | 'fund' }

const DEMO_TARGETS: Target[] = [
  { id: 'cib-world',  icon: '💳', name: 'CIB World',          sub: 'EGP 45,417 owed · 24% APR',   type: 'card' },
  { id: 'cib-0731',   icon: '🏦', name: 'CIB ·· 0731',        sub: 'EGP 797,678 · 7 instalments', type: 'card' },
  { id: 'umrah',      icon: '🕋', name: 'Umrah, February',     sub: 'EGP 18,000 of 60,000',        type: 'goal' },
  { id: 'runway',     icon: '🚀', name: 'Six months of runway',sub: 'EGP 265,847 of 480,000',      type: 'fund' },
]

type MonthRow = {
  month: string
  isLabel?: string   // 'PLAN' | ''
  forecastIn: number
  committed: number
  freeCash: number
  toCard: number | null
  from: string
  on: string
  cardLeft: number
  rowBg: string
  closedRow?: boolean
}

const DEMO_PLAN: MonthRow[] = [
  { month: 'Sep', forecastIn: 228000, committed: 193000, freeCash: 35000, toCard: 20000, from: 'CIB current', on: '3 Sep', cardLeft: 26057, rowBg: C.accentBg },
  { month: 'Oct', forecastIn: 240000, committed: 193000, freeCash: 47000, toCard: 26057, from: 'CIB current', on: '4 Oct', cardLeft: 0,     rowBg: C.oliveBg, closedRow: true },
  { month: 'Nov', isLabel: 'PLAN', forecastIn: 228000, committed: 173000, freeCash: 55000, toCard: null,  from: '—', on: '—', cardLeft: 0, rowBg: C.surface },
  { month: 'Dec', isLabel: 'PLAN', forecastIn: 228000, committed: 173000, freeCash: 55000, toCard: null,  from: '—', on: '—', cardLeft: 0, rowBg: '#FCFAF3' },
  { month: 'Jan', isLabel: 'PLAN', forecastIn: 228000, committed: 168000, freeCash: 60000, toCard: null,  from: '—', on: '—', cardLeft: 0, rowBg: C.surface },
  { month: 'Feb', isLabel: 'PLAN', forecastIn: 228000, committed: 168000, freeCash: 60000, toCard: null,  from: '—', on: '—', cardLeft: 0, rowBg: '#FCFAF3' },
]

type Strategy = 'highest' | 'smallest' | 'split'

const AUTOMATIONS = [
  { id: 'a1', label: 'EGP 20,000 to CIB World',   sub: '3 Sep, from CIB current',       active: true,  icon: '⚡' },
  { id: 'a2', label: 'Clear the balance',           sub: '4 Oct, whatever is left owing', active: true,  icon: '⚡' },
  { id: 'a3', label: 'EGP 8,400 to Umrah',          sub: '15th, from CIB current',        active: true,  icon: '⚡' },
  { id: 'a4', label: 'Redirect freed cash',          sub: 'From November, once the card is closed', active: false, icon: '⏱' },
]

// ─── Chart bar ────────────────────────────────────────────────────────────────

const CHART_BARS = [
  { label: 'Sep', val: '+8,400',  pct: 42,  color: C.accent  },
  { label: 'Oct', val: '+8,400',  pct: 55,  color: C.accent  },
  { label: 'Nov', val: '+28,400', pct: 100, color: C.oliveTxt },
  { label: 'Dec', val: '—',       pct: 100, color: C.oliveTxt },
  { label: 'Jan', val: '—',       pct: 100, color: C.oliveTxt },
  { label: 'Feb', val: '—',       pct: 100, color: C.oliveTxt },
]

// ─── Main component ───────────────────────────────────────────────────────────

export function PlanScreen() {
  const { accounts: _accounts } = useFinanceStore(); void _accounts
  const [selectedTarget, setSelectedTarget] = useState('cib-world')
  const [tab, setTab] = useState<'Plan' | 'Simulate' | 'History'>('Plan')
  const [strategy, setStrategy] = useState<Strategy>('highest')
  const [automations, setAutomations] = useState(AUTOMATIONS)

  function toggleAuto(id: string) {
    setAutomations(prev => prev.map(a => a.id === id ? { ...a, active: !a.active } : a))
  }

  const totals = {
    forecastIn: DEMO_PLAN.reduce((s, r) => s + r.forecastIn, 0),
    committed:  DEMO_PLAN.reduce((s, r) => s + r.committed, 0),
    freeCash:   DEMO_PLAN.reduce((s, r) => s + r.freeCash, 0),
    toCard:     DEMO_PLAN.reduce((s, r) => s + (r.toCard ?? 0), 0),
  }

  return (
    <div style={{
      padding: '20px 26px 24px',
      display: 'flex', flexDirection: 'column', gap: 12,
      minHeight: 0, height: '100%', boxSizing: 'border-box',
    }}>

      {/* ─── Page header ───────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20, flexShrink: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', color: C.ink3 }}>FINANCE · PLAN</span>
          <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 30, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1, color: C.ink1 }}>Settle &amp; achieve</span>
          <span style={{ fontSize: 12, color: C.ink3, paddingTop: 3 }}>Built from the forecast: what to pay, from which account, on which date — and what it frees up next</span>
        </div>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 9, paddingBottom: 3, flexShrink: 0 }}>
          {/* Tab switcher */}
          <span style={{ display: 'flex', alignItems: 'center', gap: 2, height: 34, boxSizing: 'border-box', padding: 3, borderRadius: 999, background: '#EDE7D9' }}>
            {(['Plan', 'Simulate', 'History'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                height: 28, padding: '0 13px', borderRadius: 999,
                background: tab === t ? C.surface : 'transparent',
                boxShadow: tab === t ? '0 1px 3px rgba(25,23,18,.16)' : 'none',
                color: tab === t ? C.ink1 : C.ink3,
                fontWeight: tab === t ? 600 : 500, fontSize: 12,
                border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center',
              }}>{t}</button>
            ))}
          </span>
          <button style={{ height: 34, padding: '0 14px', borderRadius: 999, background: C.surface, border: `1px solid ${C.border}`, color: C.ink1, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
            Change forecast
          </button>
          <button style={{ height: 34, padding: '0 15px', borderRadius: 999, background: C.accent, color: C.ink1, fontSize: 12.5, fontWeight: 600, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 2px 0 rgba(25,23,18,.14)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M13 3L5 14h6l-1 7 8-11h-6z"/></svg>
            Automate this plan
          </button>
        </span>
      </div>

      {/* ─── Main content ──────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', gap: 14, minHeight: 0 }}>

        {/* ─── Left column ─────────────────────────────────────────────────── */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 11 }}>

          {/* Target picker row */}
          <div style={{ flexShrink: 0, display: 'flex', gap: 9 }}>
            {DEMO_TARGETS.map(t => {
              const active = t.id === selectedTarget
              return (
                <button key={t.id} onClick={() => setSelectedTarget(t.id)} style={{
                  flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 9,
                  padding: '10px 11px', borderRadius: 13,
                  background: active ? C.dark : C.surface,
                  border: `1px solid ${active ? C.dark : C.border}`,
                  cursor: 'pointer', boxSizing: 'border-box',
                }}>
                  <span style={{ width: 26, height: 26, borderRadius: 8, background: active ? 'rgba(253,248,231,.14)' : '#F5F1E4', color: active ? C.accent : C.ink3, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 13 }}>
                    {t.icon}
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, textAlign: 'left' }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: active ? '#FDF8E7' : C.ink1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</span>
                    <span style={{ fontSize: 10, color: active ? 'rgba(253,248,231,.65)' : C.ink3, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.sub}</span>
                  </span>
                  {active && (
                    <span style={{ marginLeft: 'auto', color: C.accent, display: 'flex', flexShrink: 0 }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>
                    </span>
                  )}
                </button>
              )
            })}
            {/* Add target button */}
            <button style={{ flexShrink: 0, width: 44, borderRadius: 13, border: `1px dashed ${C.hair}`, background: C.field, color: C.ink3, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            </button>
          </div>

          {/* Dark summary card */}
          <div style={{ flexShrink: 0, background: C.dark, color: '#FDF8E7', borderRadius: 18, padding: '14px 18px', display: 'flex', gap: 20, alignItems: 'center' }}>
            {/* Clear date */}
            <div style={{ width: 236, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', opacity: 0.6 }}>CIB WORLD, CLEARED BY</span>
              <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 30, fontWeight: 600, letterSpacing: '-0.04em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>4 October</span>
              <span style={{ fontSize: 11, opacity: 0.65 }}>Two payments · 18 months sooner than the minimum</span>
            </div>
            <div style={{ width: 1, alignSelf: 'stretch', background: 'rgba(255,255,255,.13)', flexShrink: 0 }} />

            {/* Bar chart */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', opacity: 0.55 }}>THEN THE FREED EGP 20,000 A MONTH GOES TO UMRAH</span>
                <span style={{ marginLeft: 'auto', fontSize: 10.5, opacity: 0.6, flexShrink: 0 }}>target met 21 November — three months early</span>
              </div>
              <div style={{ height: 62, display: 'flex', gap: 8, alignItems: 'stretch' }}>
                {CHART_BARS.map(b => (
                  <div key={b.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center', minWidth: 0 }}>
                    <div style={{ width: '100%', flex: 1, display: 'flex', alignItems: 'flex-end' }}>
                      <span style={{ width: '100%', height: `${b.pct}%`, background: b.color, borderRadius: '5px 5px 0 0', display: 'block' }} />
                    </div>
                    <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 10, fontWeight: 600, color: '#FDF8E7', fontVariantNumeric: 'tabular-nums' }}>{b.val}</span>
                    <span style={{ fontSize: 9.5, color: C.ink3 }}>{b.label}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ width: 1, alignSelf: 'stretch', background: 'rgba(255,255,255,.13)', flexShrink: 0 }} />

            {/* Stats */}
            <div style={{ width: 140, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.12em', opacity: 0.55 }}>INTEREST AVOIDED</span>
                <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 18, fontWeight: 600, letterSpacing: '-0.03em', color: '#D8E0A8', fontVariantNumeric: 'tabular-nums' }}>EGP 9,420</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.12em', opacity: 0.55 }}>BUFFER KEPT</span>
                <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 18, fontWeight: 600, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>EGP 15,000</span>
              </div>
            </div>
          </div>

          {/* Month-by-month plan table */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 18, padding: '15px 17px', display: 'flex', flexDirection: 'column', gap: 11, boxSizing: 'border-box', flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, flexShrink: 0 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: C.ink3 }}>THE PLAN, MONTH BY MONTH</span>
              <span style={{ fontSize: 11, color: C.ink3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>Free cash is forecast income minus everything already committed — the plan never spends money you need</span>
              <span style={{ marginLeft: 'auto', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, color: C.ink1 }}>
                Sep 2026 → Feb 2027
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
              </span>
            </div>

            {/* Table */}
            <div style={{ flex: 1, minHeight: 0, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {/* Header */}
              <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr 1fr 1fr 1fr 118px 84px 1fr', height: 28, flexShrink: 0, background: '#F7F3E7', borderBottom: `1px solid ${C.border}` }}>
                {['', 'FORECAST IN', 'COMMITTED', 'FREE CASH', 'TO THE CARD', 'FROM', 'ON', 'CARD LEFT'].map((h, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: i > 0 && i < 5 ? 'flex-end' : 'flex-start', padding: '0 9px' }}>
                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: C.ink3 }}>{h}</span>
                  </div>
                ))}
              </div>

              {/* Rows */}
              {DEMO_PLAN.map((row, _idx) => (
                <div key={row.month} style={{ display: 'grid', gridTemplateColumns: '64px 1fr 1fr 1fr 1fr 118px 84px 1fr', height: 36, flexShrink: 0, borderTop: `1px solid #F2EDDF`, background: row.rowBg }}>
                  {/* Month */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 9px' }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: C.ink1 }}>{row.month}</span>
                    {row.isLabel && <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.06em', color: '#A8A091' }}>{row.isLabel}</span>}
                  </div>
                  {/* Forecast In */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 9px', fontFamily: 'Outfit, sans-serif', fontSize: 11.5, fontWeight: 500, color: C.olive, fontVariantNumeric: 'tabular-nums' }}>{fmt(row.forecastIn)}</div>
                  {/* Committed */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 9px', fontFamily: 'Outfit, sans-serif', fontSize: 11.5, fontWeight: 500, color: C.ink2, fontVariantNumeric: 'tabular-nums' }}>{fmt(row.committed)}</div>
                  {/* Free Cash */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 9px', fontFamily: 'Outfit, sans-serif', fontSize: 11.5, fontWeight: 600, color: C.ink1, fontVariantNumeric: 'tabular-nums' }}>{fmt(row.freeCash)}</div>
                  {/* To Card */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 9px', fontFamily: 'Outfit, sans-serif', fontSize: 11.5, fontWeight: 600, color: row.toCard ? C.rustDk : C.muted, fontVariantNumeric: 'tabular-nums' }}>
                    {row.toCard ? fmt(row.toCard) : '—'}
                  </div>
                  {/* From */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 9px', minWidth: 0 }}>
                    <span style={{ color: row.from !== '—' ? C.ink3 : C.muted, display: 'flex', flexShrink: 0 }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10h16M5 10V20h14V10M3 10l9-6 9 6M9 20v-6h6v6"/></svg>
                    </span>
                    <span style={{ fontSize: 11, color: row.from !== '—' ? C.ink2 : C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.from}</span>
                  </div>
                  {/* On */}
                  <div style={{ display: 'flex', alignItems: 'center', padding: '0 9px' }}>
                    <span style={{ fontSize: 11, fontWeight: row.on !== '—' ? 600 : 500, color: row.on !== '—' ? C.ink1 : C.muted }}>{row.on}</span>
                  </div>
                  {/* Card Left */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 7, padding: '0 9px' }}>
                    {row.closedRow ? (
                      <>
                        <span style={{ height: 19, padding: '0 7px', borderRadius: 5, background: C.olive, color: '#FDF8E7', fontSize: 8.5, fontWeight: 700, letterSpacing: '0.06em', display: 'flex', alignItems: 'center' }}>CLOSED</span>
                        <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 12, fontWeight: 600, color: C.olive, fontVariantNumeric: 'tabular-nums' }}>0</span>
                      </>
                    ) : (
                      <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 12, fontWeight: 600, color: row.cardLeft === 0 ? C.olive : C.ink1, fontVariantNumeric: 'tabular-nums' }}>{row.cardLeft === 0 ? '0' : fmt(row.cardLeft)}</span>
                    )}
                  </div>
                </div>
              ))}

              <div style={{ flex: 1, minHeight: 0, background: C.surface }} />

              {/* Totals row */}
              <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr 1fr 1fr 1fr 118px 84px 1fr', height: 34, flexShrink: 0, borderTop: `1px solid ${C.border}`, background: C.accentBg }}>
                <div style={{ display: 'flex', alignItems: 'center', padding: '0 9px' }}><span style={{ fontSize: 11, fontWeight: 700, color: C.ink1 }}>TOTAL</span></div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 9px', fontFamily: 'Outfit, sans-serif', fontSize: 11.5, fontWeight: 600, color: C.olive, fontVariantNumeric: 'tabular-nums' }}>{fmt(totals.forecastIn)}</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 9px', fontFamily: 'Outfit, sans-serif', fontSize: 11.5, fontWeight: 600, color: C.ink2, fontVariantNumeric: 'tabular-nums' }}>{fmt(totals.committed)}</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 9px', fontFamily: 'Outfit, sans-serif', fontSize: 11.5, fontWeight: 600, color: C.ink1, fontVariantNumeric: 'tabular-nums' }}>{fmt(totals.freeCash)}</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 9px', fontFamily: 'Outfit, sans-serif', fontSize: 11.5, fontWeight: 600, color: C.rustDk, fontVariantNumeric: 'tabular-nums' }}>{fmt(totals.toCard)}</div>
                <div style={{ display: 'flex', alignItems: 'center', padding: '0 9px' }}><span style={{ fontSize: 10, color: '#8A7A4E' }}>2 transfers</span></div>
                <div />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 9px' }}><span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 12.5, fontWeight: 700, color: C.olive }}>CLEARED</span></div>
              </div>
            </div>
          </div>
        </div>

        {/* ─── Right panel ─────────────────────────────────────────────────── */}
        <div style={{ width: 346, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 11 }}>

          {/* Strategy card */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 18, padding: '15px 17px', display: 'flex', flexDirection: 'column', gap: 11, boxSizing: 'border-box', flexShrink: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: C.ink3 }}>HOW TO ATTACK IT</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {([
                { id: 'highest' as Strategy, label: 'Highest interest first', sub: 'CIB World at 24% before the instalment card at 11%' },
                { id: 'smallest' as Strategy, label: 'Smallest balance first', sub: 'Quicker wins, EGP 3,180 more interest' },
                { id: 'split' as Strategy,   label: 'Split evenly',           sub: 'Slower on both, no advantage here' },
              ]).map(s => {
                const active = strategy === s.id
                return (
                  <button key={s.id} onClick={() => setStrategy(s.id)} style={{
                    display: 'flex', alignItems: 'center', gap: 9, padding: '10px 11px',
                    borderRadius: 12, background: active ? C.accentBg : C.field,
                    border: `1px solid ${active ? C.accentBr : C.border}`,
                    cursor: 'pointer', boxSizing: 'border-box', textAlign: 'left',
                  }}>
                    <span style={{
                      width: 17, height: 17, borderRadius: 999, flexShrink: 0, boxSizing: 'border-box',
                      background: active ? C.dark : C.surface,
                      border: `1.5px solid ${active ? C.dark : '#D8D2C0'}`,
                      color: '#FDF8E7', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {active && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>}
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: C.ink1 }}>{s.label}</span>
                      <span style={{ fontSize: 10.5, color: C.ink3 }}>{s.sub}</span>
                    </span>
                  </button>
                )
              })}
            </div>
            {/* AI note */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 11px', borderRadius: 11, background: C.field, border: `1px solid ${C.border}` }}>
              <span style={{ color: C.ink3, display: 'flex', flexShrink: 0, paddingTop: 1 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5a3 3 0 00-3 3 3 3 0 00-2 5.3A3 3 0 009 19h6a3 3 0 002-5.7A3 3 0 0015 8a3 3 0 00-3-3z"/></svg>
              </span>
              <span style={{ fontSize: 11, color: C.ink2, lineHeight: 1.35 }}>The instalment card charges no interest while the plans run, so paying it early buys nothing. Leave it.</span>
            </div>
          </div>

          {/* Automations card */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 18, padding: '15px 17px', display: 'flex', flexDirection: 'column', gap: 11, boxSizing: 'border-box', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexShrink: 0 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: C.ink3 }}>WHAT GETS AUTOMATED</span>
              <span style={{ marginLeft: 'auto', fontSize: 10.5, color: C.ink3 }}>{automations.filter(a => a.active).length} of {automations.length} on</span>
            </div>
            <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
              {automations.map(a => (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, height: 42, flexShrink: 0, padding: '0 12px', borderRadius: 11, background: C.field, border: `1px solid ${C.border}`, boxSizing: 'border-box' }}>
                  <span style={{ color: a.active ? C.olive : '#B7AE92', display: 'flex', flexShrink: 0 }}>
                    {a.icon === '⚡'
                      ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M13 3L5 14h6l-1 7 8-11h-6z"/></svg>
                      : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 8v4.5l3 1.8"/></svg>
                    }
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: C.ink1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.label}</span>
                    <span style={{ fontSize: 10, color: C.ink3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.sub}</span>
                  </span>
                  {/* Toggle */}
                  <button onClick={() => toggleAuto(a.id)} style={{
                    marginLeft: 'auto', width: 36, height: 20, borderRadius: 999,
                    background: a.active ? C.dark : '#DED8C6',
                    display: 'flex', alignItems: 'center',
                    justifyContent: a.active ? 'flex-end' : 'flex-start',
                    padding: '0 3px', boxSizing: 'border-box', flexShrink: 0,
                    border: 'none', cursor: 'pointer',
                  }}>
                    <span style={{ width: 14, height: 14, borderRadius: 999, background: '#FDF8E7', display: 'block' }} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Risk/scenario card */}
          <div style={{ flex: 1, minHeight: 0, background: C.accentBg, border: `1px solid ${C.accentBr}`, borderRadius: 18, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em', color: '#8A6A1E' }}>IF THE PAYROLL SLIPS AGAIN</span>
            <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.015em', lineHeight: 1.35, color: C.ink1 }}>October's clearance needs the DX salary. If it misses, the plan pays the minimum and closes the card on 4 November instead.</span>
            <span style={{ marginTop: 2, display: 'flex', gap: 8 }}>
              <button style={{ height: 30, padding: '0 12px', borderRadius: 999, background: C.dark, color: '#FDF8E7', fontSize: 11.5, fontWeight: 600, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>See that version</button>
            </span>
          </div>

        </div>
      </div>
    </div>
  )
}

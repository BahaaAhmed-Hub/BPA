import { useState, useMemo } from 'react'
import { Button } from '@/components/ui'
import { paidAtSupported } from '../../finance/unpaid'
import { todayISO } from '../../finance/dates'
import type { EnvelopeStyle as BudgetEnvelopeStyle } from '@/modules/finance/screens/BudgetScreen'
import { loadRates } from '@/modules/finance/fx'
import { notify } from '@/lib/undo'
import { useFinanceStore } from '@/modules/finance/financeStore'
import { loadRules } from '@/modules/finance/modals/BudgetRuleModal'
import { loadReminders, saveReminders, defaultReminder, dueDatesFor, reminderTitle, type MoneyReminder } from '@/modules/finance/reminders'
import { askConfirm } from '@/lib/confirm'
import { selectStyle } from '@/lib/fields'
import { FieldRow, Toggle } from '../ui'
import { FinanceSecuritySection } from './FinanceSecurity'
import { CardPointsSection } from './CardPoints'
import { ShoppingSettingsBlock } from './ShoppingSettings'

// ─── CHUNK 6c: Finance Settings section ──────────────────────────────────────

// The Budget screen is what draws these, so the ids live with it.
type EnvelopeStyle = BudgetEnvelopeStyle

export function FinanceSection() {
  const [envelopeStyle, setEnvelopeStyle] = useState<EnvelopeStyle>(() => {
    try { return (localStorage.getItem('finance-envelope-style') as EnvelopeStyle) || 'dial' } catch { return 'dial' }
  })
  const [currency, setCurrency]         = useState(() => { try { return localStorage.getItem('finance-currency') || 'EGP' } catch { return 'EGP' } })
  const [monthStart, setMonthStart]     = useState(() => { try { return parseInt(localStorage.getItem('finance-month-start') ?? '1') } catch { return 1 } })
  const [showCents, setShowCents]       = useState(() => { try { return localStorage.getItem('finance-show-cents') !== 'false' } catch { return true } })
  const [weekStart, setWeekStart]       = useState(() => { try { return localStorage.getItem('finance-week-start') || 'Mon' } catch { return 'Mon' } })
  const [alertThreshold, setAlertThreshold] = useState(() => { try { return parseFloat(localStorage.getItem('finance-alert-threshold') ?? '0.9') } catch { return 0.9 } })
  // 11G new fields
  const [numbersInFull, setNumbersInFull] = useState(() => { try { return localStorage.getItem('finance-numbers-in-full') !== 'false' } catch { return true } })
  const [roundWhole, setRoundWhole]       = useState(() => { try { return localStorage.getItem('finance-round-whole') === 'true' } catch { return false } })
  const [countOn, setCountOn]             = useState<'due' | 'paid'>(() => { try { return (localStorage.getItem('finance-count-on') as 'due' | 'paid') || 'paid' } catch { return 'paid' } })
  const [includePlanned, setIncludePlanned] = useState(() => { try { return localStorage.getItem('finance-include-planned') !== 'false' } catch { return true } })
  const [categoryOrder, setCategoryOrder] = useState<'spend' | 'budget' | 'alpha' | 'custom'>(() => {
    try { return (localStorage.getItem('finance-category-order') as 'spend' | 'budget' | 'alpha' | 'custom') || 'spend' } catch { return 'spend' }
  })
  const [fxRates, setFxRates] = useState<Record<string, number>>(loadRates)

  // Money reminders: a category, a day of the month, and a task on that date.
  const { categories: finCategories } = useFinanceStore()

  // Payment dates. An entry with none reads as unpaid everywhere, which is
  // right for one somebody left unpaid and wrong for one logged before there
  // were two dates — so the repair is here, as something asked for.
  const finTransactions = useFinanceStore(s => s.transactions)
  const finYear         = useFinanceStore(s => s.currentYear)
  const markAllPaid     = useFinanceStore(s => s.markAllPaidOnDueDate)
  const unmarkFuture    = useFinanceStore(s => s.unmarkPaidInFuture)
  const [filling, setFilling] = useState<'idle' | 'working' | number>('idle')
  const [undoing, setUndoing] = useState<'idle' | 'working' | number>('idle')
  // Entries claiming they were paid on a day that has not happened. Counted
  // from the loaded year only, so it is a floor — the repair covers every year.
  const futurePaid = useMemo(
    () => finTransactions.filter(t => t.paidAt && t.paidAt > todayISO()).length,
    [finTransactions])
  // Only the loaded year can be counted from here — the repair itself covers
  // every year, so the count is a floor, not the total.
  const undatedHere = useMemo(
    () => finTransactions.filter(t => !t.paidAt).length, [finTransactions])
  const [reminders, setReminders] = useState<MoneyReminder[]>(loadReminders)
  const budgetRules = loadRules()
  function putReminders(next: MoneyReminder[]) { setReminders(next); saveReminders(next) }
  const catById = (id: string) => finCategories.find(c => c.id === id)

  function saveStyle(s: EnvelopeStyle) {
    setEnvelopeStyle(s)
    try { localStorage.setItem('finance-envelope-style', s) } catch { /* noop */ }
    window.dispatchEvent(new CustomEvent('finance:envelopeStyleChanged', { detail: s }))
  }

  function saveField(key: string, val: string) {
    try { localStorage.setItem(key, val) } catch { /* noop */ }
  }

  const STYLES: { id: EnvelopeStyle; label: string; sub: string; preview: React.ReactNode }[] = [
    {
      id: 'dial',
      label: 'Dial + trend',
      sub: 'This month, plus a seven-day habit line',
      preview: (
        <svg viewBox="0 0 80 56" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: 56 }}>
          {/* Track */}
          <path d="M14 42 A26 26 0 0 1 66 42" stroke="var(--sb-border)" strokeWidth="7" strokeLinecap="round" fill="none"/>
          {/* Fill (72% of arc) */}
          <path d="M14 42 A26 26 0 0 1 57.8 19.5" stroke="var(--sb-accent)" strokeWidth="7" strokeLinecap="round" fill="none"/>
          {/* Needle center */}
          <circle cx="40" cy="42" r="4" fill="var(--sb-ink-1)"/>
          {/* Trend line */}
          <polyline points="10,50 22,46 34,44 46,41 58,37 70,33" stroke="var(--sb-positive)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
        </svg>
      ),
    },
    {
      id: 'mosaic',
      label: 'Proportional mosaic',
      sub: 'Area equals money · rust boxes burst',
      preview: (
        <svg viewBox="0 0 80 56" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: 56 }}>
          <rect x="4" y="4" width="44" height="28" rx="3" fill="var(--sb-field)"/>
          <rect x="4" y="4" width="44" height="20" rx="3" fill="var(--sb-accent)" opacity="0.7"/>
          <rect x="52" y="4" width="24" height="44" rx="3" fill="var(--sb-negative-tint)"/>
          <rect x="52" y="4" width="24" height="48" rx="3" fill="var(--sb-negative-deep)" opacity="0.5"/>
          <rect x="4" y="36" width="20" height="16" rx="3" fill="var(--sb-field)"/>
          <rect x="4" y="36" width="14" height="16" rx="3" fill="var(--sb-positive-tint)"/>
          <rect x="28" y="36" width="20" height="16" rx="3" fill="var(--sb-field)"/>
          <rect x="28" y="36" width="10" height="16" rx="3" fill="var(--sb-accent)" opacity="0.5"/>
        </svg>
      ),
    },
    {
      id: 'slip',
      label: 'Till slips',
      sub: 'Monospace figures · one eye movement to compare',
      preview: (
        <svg viewBox="0 0 80 56" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: 56 }}>
          <rect x="4" y="4" width="72" height="12" rx="3" fill="var(--sb-field)"/>
          <rect x="4" y="4" width="52" height="12" rx="3" fill="var(--sb-accent)" opacity="0.5"/>
          <rect x="4" y="20" width="72" height="12" rx="3" fill="var(--sb-field)"/>
          <rect x="4" y="20" width="68" height="12" rx="3" fill="var(--sb-positive-tint)"/>
          <rect x="4" y="36" width="72" height="12" rx="3" fill="var(--sb-field)"/>
          <rect x="4" y="36" width="76" height="12" rx="3" fill="var(--sb-negative-tint)"/>
          <rect x="4" y="36" width="72" height="12" rx="3" fill="var(--sb-negative-deep)" opacity="0.25"/>
        </svg>
      ),
    },
    {
      id: 'ring',
      label: 'Double rings',
      sub: 'Two rings: worse than last month · not just over',
      preview: (
        <svg viewBox="0 0 80 56" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: 56 }}>
          {/* outer ring */}
          <circle cx="22" cy="28" r="16" stroke="var(--sb-border)" strokeWidth="4" fill="none"/>
          <circle cx="22" cy="28" r="16" stroke="var(--sb-accent)" strokeWidth="4" fill="none"
            strokeDasharray="75.4" strokeDashoffset="20" strokeLinecap="round"/>
          {/* inner ring */}
          <circle cx="22" cy="28" r="10" stroke="var(--sb-field)" strokeWidth="3" fill="none"/>
          <circle cx="22" cy="28" r="10" stroke="var(--sb-positive)" strokeWidth="3" fill="none"
            strokeDasharray="62.8" strokeDashoffset="16" strokeLinecap="round"/>

          <circle cx="55" cy="28" r="16" stroke="var(--sb-border)" strokeWidth="4" fill="none"/>
          <circle cx="55" cy="28" r="16" stroke="var(--sb-negative-deep)" strokeWidth="4" fill="none"
            strokeDasharray="100.5" strokeDashoffset="-4" strokeLinecap="round"/>
          <circle cx="55" cy="28" r="10" stroke="var(--sb-field)" strokeWidth="3" fill="none"/>
          <circle cx="55" cy="28" r="10" stroke="var(--sb-negative-deep)" strokeWidth="3" fill="none" opacity="0.5"
            strokeDasharray="62.8" strokeDashoffset="-8" strokeLinecap="round"/>
        </svg>
      ),
    },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0 30px', alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22, minWidth: 0 }}>
      {/* ── ENVELOPE STYLE ───────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 700, letterSpacing: '0.12em', color: 'var(--sb-ink-3)' }}>ENVELOPE STYLE</span>
          <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>The budget page opens in this view · you can still switch it per visit</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
          {STYLES.map(style => {
            const active = envelopeStyle === style.id
            return (
              <button
                key={style.id}
                onClick={() => saveStyle(style.id)}
                style={{
                  background: active ? 'var(--sb-field)' : 'var(--sb-card)',
                  border: `var(--sb-border-width) solid ${active ? 'var(--sb-accent)' : 'var(--sb-border)'}`,
                  borderRadius: 'var(--sb-r-nav)', padding: '14px 14px 12px',
                  cursor: 'pointer', textAlign: 'left',
                  boxShadow: active ? '0 0 0 2px rgba(var(--sb-accent-rgb),0.25)' : 'none',
                  transition: 'all 0.15s',
                }}
              >
                {/* Visual preview */}
                <div style={{ background: 'var(--sb-hairline)', borderRadius: 'var(--sb-r-chip)', padding: '8px 10px', marginBottom: 10, overflow: 'hidden' }}>
                  {style.preview}
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{
                    width: 16, height: 16, borderRadius: 'var(--sb-r-pill)', flexShrink: 0, marginTop: 1,
                    border: `var(--sb-border-emphasis) solid ${active ? 'var(--sb-accent)' : 'var(--sb-border)'}`,
                    background: active ? 'var(--sb-accent)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {active && <div style={{ width: 6, height: 6, borderRadius: 'var(--sb-r-pill)', background: 'var(--sb-accent-ink)' }} />}
                  </div>
                  <div>
                    <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-1)' }}>{style.label}</p>
                    <p style={{ margin: '2px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.3 }}>{style.sub}</p>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22, minWidth: 0 }}>

      {/* ── FIGURES ──────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 4 }}>
        <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 700, letterSpacing: '0.12em', color: 'var(--sb-ink-3)', display: 'block', marginBottom: 12 }}>FIGURES</span>
        <FieldRow label="Currency" sub="Everything converts to this · foreign accounts keep their own">
          <select
            value={currency}
            onChange={e => { setCurrency(e.target.value); saveField('finance-currency', e.target.value) }}
            style={{ ...selectStyle, width: 180 }}
          >
            {['EGP · Egyptian pound','USD · US dollar','EUR · Euro','GBP · Pound sterling','AED · UAE dirham','SAR · Saudi riyal','KWD · Kuwaiti dinar','QAR · Qatari riyal'].map(c => {
              const v = c.split(' · ')[0]
              return <option key={v} value={v}>{c}</option>
            })}
          </select>
        </FieldRow>
        {/* Rates. "Everything converts to this" above was aspirational: there
            was nothing to convert by, so foreign money was either added at
            face value or left out of every total. */}
        <div style={{ padding: '4px 0 2px' }}>
          <div style={{ fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)', fontWeight: 500 }}>Exchange rates</div>
          <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', marginTop: 2, marginBottom: 10, lineHeight: 1.5 }}>
            What one unit is worth in {currency}. Set by hand — there is no rate feed in here,
            and a stale one would be its own kind of wrong. A currency left blank stays out of
            the totals rather than being guessed at. A new rate applies to entries you add from
            now on; the ones already in the ledger keep the rate they were added at.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {['USD', 'EUR', 'GBP', 'AED', 'SAR', 'KWD', 'QAR', 'EGP']
              .filter(c => c !== currency)
              .map(code => (
                <label key={code} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7, height: 'var(--sb-h-pill)', padding: '0 10px',
                  borderRadius: 'var(--sb-r-sm)', border: 'var(--sb-border-width) solid var(--sb-border)', background: 'var(--sb-card)',
                }}>
                  <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 700, color: 'var(--sb-ink-3)' }}>1 {code}</span>
                  <input
                    type="number" min={0} step="0.0001" inputMode="decimal"
                    defaultValue={fxRates[code] ?? ''}
                    placeholder="—"
                    onBlur={e => {
                      const v = parseFloat(e.target.value)
                      // Frozen first: entries already in the ledger keep the
                      // rate they were added at (txRates.ts).
                      void useFinanceStore.getState().changeRate(code, isFinite(v) && v > 0 ? v : null)
                        .then(done => { if (!done) notify('Could not read the ledger, so the rate was not changed'); setFxRates(loadRates()) })
                    }}
                    style={{
                      width: 72, background: 'transparent', border: 'none', outline: 'none',
                      fontFamily: 'inherit', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)', textAlign: 'right', padding: 0,
                    }} />
                  <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>{currency}</span>
                </label>
              ))}
          </div>
        </div>

        <FieldRow label="Write numbers in full" sub={`${currency} 141,000 rather than 141K — abbreviations hide the size of things`}>
          <Toggle checked={numbersInFull} onChange={v => { setNumbersInFull(v); saveField('finance-numbers-in-full', String(v)) }} />
        </FieldRow>
        <FieldRow label="Round to whole units" sub="Piasters / cents dropped from every display">
          <Toggle checked={roundWhole} onChange={v => { setRoundWhole(v); saveField('finance-round-whole', String(v)) }} />
        </FieldRow>
        <FieldRow label="Show cents" sub="Display two decimal places on amounts (overrides round)">
          <Toggle checked={showCents} onChange={v => { setShowCents(v); saveField('finance-show-cents', String(v)) }} />
        </FieldRow>

        {/* Order categories by */}
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 700, letterSpacing: '0.1em', color: 'var(--sb-ink-3)', marginBottom: 8 }}>ORDER CATEGORIES BY</div>
          <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', marginBottom: 8 }}>Biggest spend first keeps the two problems at the top</div>
          <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6 }}>
            {([
              { v: 'spend',  label: 'Biggest spend' },
              { v: 'budget', label: 'Budget size' },
              { v: 'alpha',  label: 'A–Z' },
              { v: 'custom', label: 'Custom' },
            ] as const).map(o => (
              <button key={o.v} onClick={() => { setCategoryOrder(o.v); saveField('finance-category-order', o.v) }}
                style={{
                  padding: '6px 13px', borderRadius: 'var(--sb-r-pill)', border: 'var(--sb-border-width) solid var(--sb-border)', cursor: 'pointer',
                  background: categoryOrder === o.v ? 'var(--sb-ink-1)' : 'var(--sb-field)',
                  color: categoryOrder === o.v ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-3)',
                  fontSize: 'var(--sb-t-body-s)', fontWeight: categoryOrder === o.v ? 600 : 400,
                }}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22, minWidth: 0 }}>

      {/* ── DATES & COUNTING ─────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 4 }}>
        <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 700, letterSpacing: '0.12em', color: 'var(--sb-ink-3)', display: 'block', marginBottom: 12 }}>DATES · COUNTING</span>

        {/* Count on */}
        <FieldRow label="Count a transaction on" sub="The financials table can show either — this sets the default">
          <div style={{ display: 'flex', gap: 8 }}>
            {(['due', 'paid'] as const).map(v => (
              <button key={v} onClick={() => { setCountOn(v); saveField('finance-count-on', v) }}
                style={{
                  padding: '6px 14px', borderRadius: 'var(--sb-r-chip)', border: 'var(--sb-border-width) solid var(--sb-border)', cursor: 'pointer',
                  background: countOn === v ? 'var(--sb-ink-1)' : 'var(--sb-field)',
                  color: countOn === v ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-3)',
                  fontSize: 'var(--sb-t-body-s)', fontWeight: countOn === v ? 600 : 400,
                }}>
                {v === 'due' ? 'Due date' : 'Date paid'}
              </button>
            ))}
          </div>
        </FieldRow>

        <FieldRow label="Month starts on" sub="Your salary lands on the 1st">
          <select
            value={monthStart}
            onChange={e => { const v = parseInt(e.target.value); setMonthStart(v); saveField('finance-month-start', String(v)) }}
            style={{ ...selectStyle, width: 180 }}
          >
            {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
              <option key={d} value={d}>{d === 1 ? '1st (calendar month)' : `${d}${d === 2 ? 'nd' : d === 3 ? 'rd' : 'th'}`}</option>
            ))}
          </select>
        </FieldRow>

        <FieldRow label="Include planned months" sub="Future months shown greyed in tables and charts">
          <Toggle checked={includePlanned} onChange={v => { setIncludePlanned(v); saveField('finance-include-planned', String(v)) }} />
        </FieldRow>

        <FieldRow label="Week starts on" sub="Affects the money calendar view">
          <select
            value={weekStart}
            onChange={e => { setWeekStart(e.target.value); saveField('finance-week-start', e.target.value) }}
            style={{ ...selectStyle, width: 160 }}
          >
            {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </FieldRow>
      </div>


      {/* ── ALERTS ───────────────────────────────────────────────────────────── */}
      <div>
        <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 700, letterSpacing: '0.12em', color: 'var(--sb-ink-3)', display: 'block', marginBottom: 12 }}>ALERTS</span>
        <FieldRow label="Balance alert" sub="Notify when an envelope is this % spent">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="range" min={0.5} max={1} step={0.05}
              value={alertThreshold}
              onChange={e => { const v = parseFloat(e.target.value); setAlertThreshold(v); saveField('finance-alert-threshold', String(v)) }}
              style={{ flex: 1, accentColor: 'var(--sb-accent)', cursor: 'pointer' }}
            />
            <span style={{ width: 36, textAlign: 'right', fontSize: 'var(--sb-t-label)', fontWeight: 600, color: 'var(--sb-ink-1)', fontFamily: 'var(--sb-font-mono)' }}>
              {Math.round(alertThreshold * 100)}%
            </span>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
            {alertThreshold >= 1 ? 'Alert only when over budget' : alertThreshold >= 0.9 ? 'Alert at 90%+ spent (recommended)' : `Alert when ${Math.round(alertThreshold * 100)}%+ of envelope is spent`}
          </p>
        </FieldRow>
      </div>
      </div>
      <FinanceSecuritySection />
      <CardPointsSection />

      <div style={{ gridColumn: '1 / -1', marginTop: 22, paddingTop: 18, borderTop: 'var(--sb-border-width) solid var(--sb-hairline)' }}>
        <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 700, letterSpacing: '0.12em', color: 'var(--sb-ink-3)', display: 'block', marginBottom: 12 }}>PAYMENT DATES</span>
        {!paidAtSupported() ? (
          <div style={{
            fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-accent-deep)', lineHeight: 1.55, maxWidth: 720,
            background: 'var(--sb-accent-tint)', border: 'var(--sb-border-width) solid var(--sb-accent-border)', borderRadius: 'var(--sb-r-nav)', padding: '11px 14px',
          }}>
            Your database has no payment-date column yet, so nothing can be marked paid or unpaid —
            run <code style={{ fontFamily: 'var(--sb-font-mono)', fontSize: 'var(--sb-t-meta)' }}>supabase/migrations/20260006</code> in
            the SQL editor and reload.
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', flex: 1, minWidth: 320, maxWidth: 640, lineHeight: 1.5 }}>
              An entry with no payment date is money that has not moved, and every feed marks it
              with a dotted red border. Entries logged before there were two dates have none
              either — this gives every one of them its due date as the day it was paid, in every
              year. Anything you meant to leave unpaid will need marking again afterwards.{' '}
              {undatedHere > 0 && `${undatedHere} ${undatedHere === 1 ? 'is' : 'are'} waiting in ${finYear} alone.`}
            </div>
            <Button
              variant="primary"
              disabled={filling === 'working'}
              onClick={async () => {
                if (!await askConfirm({ title: 'Mark every entry paid?', body: 'Mark every entry with no payment date as paid on its due date, in every year? This rewrites the ledger and cannot be undone.', confirmLabel: 'Mark them paid', danger: false })) return
                setFilling('working')
                setFilling(await markAllPaid())
              }}
              style={{ flexShrink: 0 }}>
              {filling === 'working' ? 'Working…' : 'Mark every entry paid on its due date'}
            </Button>
            {typeof filling === 'number' && (
              <span style={{ fontSize: 'var(--sb-t-body-s)', color: filling > 0 ? 'var(--sb-positive)' : 'var(--sb-ink-3)', fontWeight: 600 }}>
                {filling > 0 ? `${filling} updated` : 'nothing was waiting'}
              </span>
            )}
          </div>
        )}

        {/* The way back from the repair above having been run when nobody
            asked for it. A migration used to do exactly what that button does,
            on every deploy, over the answers you had since given. */}
        {paidAtSupported() && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap', marginTop: 16, paddingTop: 16, borderTop: 'var(--sb-border-width) solid var(--sb-hairline)' }}>
            <div style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', flex: 1, minWidth: 320, maxWidth: 640, lineHeight: 1.5 }}>
              Money cannot have moved on a day that has not happened, so an entry marked paid on a
              future date is a mistake — a salary not yet received, a bill dated ahead, an
              instalment a budget wrote. This takes those payment dates back off, in every year.{' '}
              <b>Entries dated in the past are left alone</b>: once a payment date is on one,
              deliberately unpaid and genuinely paid on its due date look identical, and nothing
              recorded which it was.{' '}
              {futurePaid > 0 && `${futurePaid} ${futurePaid === 1 ? 'is' : 'are'} marked that way in ${finYear} alone.`}
            </div>
            <Button
              variant="secondary"
              disabled={undoing === 'working'}
              onClick={async () => {
                if (!await askConfirm({ title: 'Un-mark future payments?', body: 'Take the payment date off every entry marked paid on a future date, in every year? This cannot be undone.', confirmLabel: 'Un-mark them' })) return
                setUndoing('working')
                setUndoing(await unmarkFuture())
              }}
              style={{ flexShrink: 0 }}>
              {undoing === 'working' ? 'Working…' : 'Un-mark entries paid in the future'}
            </Button>
            {typeof undoing === 'number' && (
              <span style={{ fontSize: 'var(--sb-t-body-s)', color: undoing > 0 ? 'var(--sb-positive)' : 'var(--sb-ink-3)', fontWeight: 600 }}>
                {undoing > 0 ? `${undoing} put back` : 'none were'}
              </span>
            )}
          </div>
        )}
      </div>

      <div style={{ gridColumn: '1 / -1', marginTop: 22, paddingTop: 18, borderTop: 'var(--sb-border-width) solid var(--sb-hairline)' }}>
        <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 700, letterSpacing: '0.12em', color: 'var(--sb-ink-3)', display: 'block', marginBottom: 12 }}>MONEY REMINDERS</span>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <div style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', flex: 1, maxWidth: 640, lineHeight: 1.5 }}>
              A budget says how much a category gets in a month; it says nothing about the day the
              money has to move. Each reminder puts a task on that day, carrying what the category is
              budgeted, and the task board schedules it onto your calendar like anything else with a
              date on it. A month too short for the day takes its last day.
            </div>
            <button
              onClick={() => {
                const first = finCategories[0]
                if (!first) return
                putReminders([...reminders, defaultReminder(first.id)])
              }}
              disabled={finCategories.length === 0}
              style={{
                height: 28, padding: '0 11px', borderRadius: 'var(--sb-r-chip)', cursor: finCategories.length ? 'pointer' : 'default',
                background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-3)',
                fontFamily: 'inherit', fontSize: 'var(--sb-t-meta)', fontWeight: 600,
              }}>+ Add a reminder</button>
          </div>

          {reminders.length === 0 && (
            <div style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', padding: '10px 0' }}>
              Nothing scheduled. Rent on the 1st, school fees on the 5th — that sort of thing.
            </div>
          )}

          {reminders.map(r => {
            const cat = catById(r.categoryId)
            const nextUp = dueDatesFor(r)[0]
            return (
              <div key={r.id} style={{
                display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const,
                padding: '10px 0', borderTop: 'var(--sb-border-width) solid var(--sb-hairline)',
              }}>
                <select
                  value={r.categoryId}
                  onChange={e => putReminders(reminders.map(x => x.id === r.id ? { ...x, categoryId: e.target.value } : x))}
                  style={{
                    height: 32, minWidth: 168, maxWidth: 240, padding: '0 8px', borderRadius: 'var(--sb-r-chip)',
                    border: 'var(--sb-border-width) solid var(--sb-border)', background: 'var(--sb-card)', fontFamily: 'inherit',
                    fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)',
                  }}>
                  {finCategories.filter(c => !c.parentId).flatMap(parent => [
                    <option key={parent.id} value={parent.id}>{parent.name}</option>,
                    ...finCategories.filter(c => c.parentId === parent.id)
                      .map(child => <option key={child.id} value={child.id}>{`  ${parent.name} · ${child.name}`}</option>),
                  ])}
                </select>

                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>
                  on day
                  <input
                    type="number" min={1} max={31}
                    value={r.day}
                    onChange={e => putReminders(reminders.map(x => x.id === r.id
                      ? { ...x, day: Math.min(31, Math.max(1, parseInt(e.target.value) || 1)) } : x))}
                    style={{
                      width: 54, height: 32, boxSizing: 'border-box', padding: '0 8px', borderRadius: 'var(--sb-r-chip)',
                      border: 'var(--sb-border-width) solid var(--sb-border)', background: 'var(--sb-card)', fontFamily: 'inherit',
                      fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)', textAlign: 'right',
                    }} />
                </label>

                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>
                  remind
                  <input
                    type="number" min={0} max={30}
                    value={r.leadDays}
                    onChange={e => putReminders(reminders.map(x => x.id === r.id
                      ? { ...x, leadDays: Math.min(30, Math.max(0, parseInt(e.target.value) || 0)) } : x))}
                    style={{
                      width: 50, height: 32, boxSizing: 'border-box', padding: '0 8px', borderRadius: 'var(--sb-r-chip)',
                      border: 'var(--sb-border-width) solid var(--sb-border)', background: 'var(--sb-card)', fontFamily: 'inherit',
                      fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)', textAlign: 'right',
                    }} />
                  days early
                </label>

                <span style={{ flex: 1 }} />

                <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', whiteSpace: 'nowrap' as const }}>
                  {r.enabled && nextUp
                    ? `next ${new Date(`${nextUp.date}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · ${reminderTitle(cat, budgetRules[r.categoryId], nextUp.monthKey)}`
                    : r.enabled ? 'nothing left this year' : 'off'}
                </span>

                <Toggle checked={r.enabled}
                  onChange={(v: boolean) => putReminders(reminders.map(x => x.id === r.id ? { ...x, enabled: v } : x))} />

                <button
                  onClick={() => putReminders(reminders.filter(x => x.id !== r.id))}
                  title="Remove this reminder"
                  style={{
                    width: 28, height: 28, borderRadius: 'var(--sb-r-pill)', padding: 0, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-3)', cursor: 'pointer',
                  }}>×</button>
              </div>
            )
          })}
          {reminders.some(r => r.enabled) && (
            <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', marginTop: 8 }}>
              Tasks are made for the next {reminders[0]?.monthsAhead ?? 3} months and topped up as
              time passes. Deleting one from the board does not bring it back.
            </div>
          )}
        </div>

      </div>

      {/* ── Shopping List ─────────────────────────────────────────────────── */}
      <ShoppingSettingsBlock />

    </div>
  )
}

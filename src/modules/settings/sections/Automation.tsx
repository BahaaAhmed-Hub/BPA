import { useState, useEffect } from 'react'
import { RefreshCw } from 'lucide-react'
import { loadAutomationRules, saveAutomationRules, loadRunLog, runAutomation, AUTOMATION_EVENT, type AutomationRule, type RunEntry } from '@/lib/automation'
import { ICON } from '@/lib/type'
import { Toggle } from '../ui'

// ─── Automation Section (11F) ─────────────────────────────────────────────────
// The switches are read by `lib/automation.ts`, which ticks once a minute while
// you are signed in; the footer is its run log, live. There is no "New rule":
// a rule is a switch on an engine, and a switch with nothing behind it is what
// this section used to be.

export function AutomationSection() {
  const [rules, setRules] = useState<AutomationRule[]>(loadAutomationRules)
  const [runs, setRuns] = useState<RunEntry[]>(loadRunLog)
  const [logOpen, setLogOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const refresh = () => setRuns(loadRunLog())
    window.addEventListener(AUTOMATION_EVENT, refresh)
    return () => window.removeEventListener(AUTOMATION_EVENT, refresh)
  }, [])

  function toggle(id: string) {
    const next = rules.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r)
    setRules(next)
    saveAutomationRules(next)
  }

  async function runNow() {
    setBusy(true)
    try { await runAutomation({ force: true }) } finally { setBusy(false); setRuns(loadRunLog()) }
  }

  const today = new Date().toDateString()
  const todays = runs.filter(r => new Date(r.at).toDateString() === today)
  const actions = todays.reduce((n, r) => n + r.count, 0)
  const ruleName = (id: string) => rules.find(r => r.id === id)?.action ?? id

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 16px' }}>
        <p style={{ margin: 0, flex: 1, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', lineHeight: 1.5 }}>
          What Professor runs for you while the app is open, checked once a minute. Nothing here sends,
          deletes or moves money — every action is one you could take back.
        </p>
        <button onClick={() => void runNow()} disabled={busy} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 'var(--sb-r-chip)',
          background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
          fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-2)', cursor: busy ? 'wait' : 'pointer', flexShrink: 0,
        }} title="Run every rule that is on, now, whatever the clock says">
          <RefreshCw size={ICON.sm} style={{ animation: busy ? 'spin 1s linear infinite' : 'none' }} />
          {busy ? 'Running…' : 'Run now'}
        </button>
      </div>
      <div style={{ columns: 2, columnGap: 12 }}>
        {rules.map(rule => (
          <div key={rule.id} style={{
            display: 'flex', alignItems: 'flex-start', gap: 12,
            padding: '11px 13px', borderRadius: 'var(--sb-r-nav)', marginBottom: 10,
            breakInside: 'avoid',
            background: rule.enabled ? 'var(--sb-positive-tint)' : 'var(--sb-accent-tint)',
            border: `var(--sb-border-width) solid ${rule.enabled ? 'var(--sb-positive-tint)' : 'var(--sb-border)'}`,
            transition: 'all 0.15s',
          }}>
            <Toggle checked={rule.enabled} onChange={() => toggle(rule.id)} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 'var(--sb-t-label)', fontWeight: 600, color: rule.enabled ? 'var(--sb-ink-1)' : 'var(--sb-ink-3)', lineHeight: 1.3 }}>
                {rule.action}
              </p>
              <p style={{ margin: '3px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.4 }}>
                <span style={{ fontWeight: 600, color: 'var(--sb-positive)', fontSize: 'var(--sb-t-micro)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>WHEN</span>
                &nbsp;{rule.trigger}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Run log footer — what actually ran, not a number somebody typed. */}
      <p style={{ margin: '14px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.5 }}>
        {todays.length === 0
          ? (runs.length === 0 ? 'Nothing has run yet.' : 'Nothing has run today.')
          : `${todays.length} ${todays.length === 1 ? 'run' : 'runs'} today · ${actions} ${actions === 1 ? 'action' : 'actions'} taken`}
        &nbsp;
        {runs.length > 0 && (
          <button onClick={() => setLogOpen(o => !o)} style={{ background: 'none', border: 'none', color: 'var(--sb-positive)', fontSize: 'var(--sb-t-meta)', cursor: 'pointer', fontWeight: 600, padding: 0 }}>
            {logOpen ? 'Hide log' : 'Run log'}
          </button>
        )}
      </p>
      {logOpen && (
        <div style={{ marginTop: 8, borderRadius: 'var(--sb-r-nav)', border: 'var(--sb-border-width) solid var(--sb-border)', background: 'var(--sb-field)', maxHeight: 260, overflowY: 'auto' }}>
          {runs.slice(0, 40).map((r, i) => (
            <div key={`${r.at}-${i}`} style={{ display: 'flex', gap: 10, padding: '8px 12px', borderBottom: 'var(--sb-border-width) solid var(--sb-hairline)', alignItems: 'baseline' }}>
              <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', fontVariantNumeric: 'tabular-nums', flexShrink: 0, width: 92 }}>
                {new Date(r.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: 'block', fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: r.ok ? 'var(--sb-ink-1)' : 'var(--sb-negative)' }}>{ruleName(r.ruleId)}</span>
                <span style={{ display: 'block', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>{r.text}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

import { DEFAULT_AUTOMATION_RULES } from '@/lib/automation'
import { Switch } from '../ui'
import type { WizardState } from '../state'
import type { StepCtx } from './types'

/** The rules that need the assistant. With no key behind them they would run and fail, so the step says so. */
const NEEDS_AI = ['morning-brief', 'draft-replies', 'distribute-dump', 'close-week']

const ALERTS: { id: keyof WizardState['alerts']; label: string }[] = [
  { id: 'needsyou', label: 'Mail that needs me' },
  { id: 'draft',    label: 'A draft is ready' },
  { id: 'conflict', label: 'A calendar clash' },
]

/**
 * The seven things the app can do for you without being asked, each a switch on
 * a real rule (Settings → Automation lists the same seven), and three alerts
 * worth being tapped on the shoulder for. Nothing here sends mail, deletes
 * anything or moves money.
 */
export function AutomationStep({ w, set }: StepCtx) {
  const hasKey = !!(w.ai.provider === 'groq' ? w.ai.groqKey : w.ai.anthropicKey)
  return (
    <>
      <div>
        <span className="wz-lab">Helpers</span>
        <div className="wz-stack" style={{ gap: 6 }}>
          {DEFAULT_AUTOMATION_RULES.map(r => (
            <div key={r.id} className="wz-row" style={{ minHeight: 46 }}>
              <div className="grow"><div className="t1">{r.action}</div><div className="t2">{r.trigger}</div></div>
              <Switch on={!!w.rules[r.id]} label={r.action} onChange={v => set(p => ({ rules: { ...p.rules, [r.id]: v } }))} />
            </div>
          ))}
        </div>
        {!hasKey && NEEDS_AI.some(id => w.rules[id]) && <p className="wz-note" style={{ marginTop: 8 }}>The brief, drafts, the dump and the weekly note use the AI key from step 3. Without one they wait.</p>}
      </div>
      <div>
        <span className="wz-lab" id="wz-alerts">Tap me on the shoulder for</span>
        <div className="wz-chips" role="group" aria-labelledby="wz-alerts">
          {ALERTS.map(a => (
            <button key={a.id} type="button" className="wz-chip" aria-pressed={w.alerts[a.id]}
              onClick={() => set(p => ({ alerts: { ...p.alerts, [a.id]: !p.alerts[a.id] } }))}>{a.label}</button>
          ))}
        </div>
      </div>
    </>
  )
}


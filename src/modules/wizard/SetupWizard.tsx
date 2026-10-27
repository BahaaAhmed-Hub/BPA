import { useState, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui'
import { X, ChevronLeft, ChevronRight, Check } from 'lucide-react'
import { useUIStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { applyAppearance } from '@/lib/themes'
import { saveCompaniesToDB } from '@/lib/dbSync'
import type { CompanyRow } from '@/lib/dbSync'
import { Step1You } from './steps/Step1You'
import { Step1Accounts } from './steps/Step1Accounts'
import { Step2Companies } from './steps/Step2Companies'
import { Step3Done } from './steps/Step3Done'
import { ICON } from '@/lib/type'
import { markWizardDone } from './wizardGate'

// ─── Exported types ────────────────────────────────────────────────────────────

export interface CompanyDraft {
  id: string; name: string; color: string; emailDomain: string; accountId: string
}

export interface WizardData {
  displayName: string; themeId: string
  companies: CompanyDraft[]
}

const STEP_LABELS = ['You & accounts', 'Companies', 'Done']
const TOTAL_STEPS = 3

// Light-theme CSS variable overrides — applied inside the modal
const LIGHT_VARS: React.CSSProperties = {
  '--color-bg':         'var(--sb-info-tint)',
  '--color-surface':    'var(--sb-card)',
  '--color-border':     'var(--sb-hairline)',
  '--color-text':       'var(--sb-ink-1)',
  '--color-text-dim':   'var(--sb-ink-2)',
  '--color-text-muted': 'var(--sb-ink-4)',
} as React.CSSProperties

// ─── SetupWizard ──────────────────────────────────────────────────────────────

interface Props { onClose: () => void }

export function SetupWizard({ onClose }: Props) {
  const authName      = useAuthStore(s => s.user?.name ?? '')
  const currentThemeId = useUIStore(s => s.themeId)

  const [step, setStep]       = useState(1)
  const [dir,  setDir]        = useState<'fwd' | 'back'>('fwd')
  const [animKey, setAnimKey] = useState(0)
  const [data, setData]       = useState<WizardData>(() => {
    // Pre-populate from whatever the account already has so re-opening the
    // wizard shows real data, not a blank slate.
    const storedCos: Array<{ id: string; name: string; color: string; emailDomain?: string; accountId?: string }> =
      JSON.parse(localStorage.getItem('professor-companies') ?? '[]')
    const companies: CompanyDraft[] = storedCos.map(c => ({
      id: c.id, name: c.name, color: c.color,
      emailDomain: c.emailDomain ?? '',
      accountId:   c.accountId   ?? '',
    }))

    return {
      displayName: authName, themeId: currentThemeId,
      companies,
    }
  })

  // Restore wizard state after OAuth redirect
  useEffect(() => {
    const saved = sessionStorage.getItem('bpa-wizard-resume')
    if (!saved) return
    sessionStorage.removeItem('bpa-wizard-resume')
    try {
      const parsed = JSON.parse(saved)
      if (parsed.step) setStep(parsed.step)
      if (parsed.data) setData({ displayName: parsed.data.displayName ?? '', themeId: parsed.data.themeId, companies: parsed.data.companies ?? [] })
    } catch { /* ignore */ }
  }, [])

  function saveForOAuth() {
    sessionStorage.setItem('bpa-wizard-resume', JSON.stringify({ step, data }))
  }

  const onChange = useCallback((patch: Partial<WizardData>) => {
    setData(prev => ({ ...prev, ...patch }))
  }, [])

  function goNext() {
    if (step >= TOTAL_STEPS) return
    setDir('fwd'); setAnimKey(k => k + 1); setStep(s => s + 1)
  }
  function goBack() {
    if (step <= 1) return
    setDir('back'); setAnimKey(k => k + 1); setStep(s => s - 1)
  }
  function handleSkip() { markWizardDone(); onClose() }

  async function handleFinish(goTo?: 'habits' | 'tasks') {
    useUIStore.getState().setThemeId(data.themeId)
    applyAppearance({ themeId: data.themeId })
    if (data.displayName) localStorage.setItem('professor-display-name', data.displayName)

    if (data.companies.length > 0) {
      const rows: CompanyRow[] = data.companies.map(c => ({
        id: c.id, name: c.name, color: c.color,
        calendarId: '', emailDomain: c.emailDomain, accountId: c.accountId,
        isActive: true, users: [],
      }))
      // Merge with existing companies (don't wipe ones added elsewhere)
      const existing: CompanyRow[] = JSON.parse(localStorage.getItem('professor-companies') || '[]')
      const newIds = new Set(rows.map(r => r.id))
      const merged = [...existing.filter(e => !newIds.has(e.id)), ...rows]
      localStorage.setItem('professor-companies', JSON.stringify(merged))
      window.dispatchEvent(new Event('professor:companiesUpdated'))
      try { await saveCompaniesToDB(rows) } catch { /* offline */ }
    }

    markWizardDone()
    if (goTo) useUIStore.getState().setActiveModule(goTo)
    onClose()
  }

  const pct = ((step - 1) / (TOTAL_STEPS - 1)) * 100

  return (
    <>
      <style>{`
        @keyframes wz-backdrop { from{opacity:0} to{opacity:1} }
        @keyframes wz-modal    { from{opacity:0;transform:translateY(28px) scale(0.98)} to{opacity:1;transform:translateY(0) scale(1)} }
        @keyframes wz-fwd      { from{opacity:0;transform:translateX(32px)} to{opacity:1;transform:translateX(0)} }
        @keyframes wz-back     { from{opacity:0;transform:translateX(-32px)} to{opacity:1;transform:translateX(0)} }
        .wz-btn-back:hover  { background:var(--sb-info-tint)!important; border-color:var(--sb-ink-4)!important; }
        .wz-btn-next:hover  { filter:brightness(1.08); transform:translateY(-1px); box-shadow:0 6px 20px rgba(0,0,0,0.18)!important; }
        .wz-btn-next:active { filter:brightness(0.96); transform:translateY(0); }
      `}</style>

      {/* Backdrop */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 999,
        background: 'rgba(0,0,0,0.52)',
        backdropFilter: 'blur(10px)',
        animation: 'wz-backdrop 0.25s ease',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '20px',
      }}>
        {/* Modal */}
        <div style={{
          ...LIGHT_VARS,
          background: 'var(--sb-overlay)',
          borderRadius: 'var(--sb-r-card)',
          width: '100%', maxWidth: 640,
          maxHeight: '88vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: 'var(--sb-shadow-frame)',
          animation: 'wz-modal 0.35s cubic-bezier(0.16,1,0.3,1)',
          overflow: 'hidden',
        }}>

          {/* ── Header ───────────────────────────────────────────────────── */}
          <div style={{ padding: '22px 28px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 'var(--sb-t-label)', fontWeight: 600, color: 'var(--sb-ink-3)' }}>
                  Step {step} of {TOTAL_STEPS}
                </span>
                <span style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', display: 'flex', alignItems: 'center', gap: 5 }}>
                  ✦ The Professor Setup
                </span>
              </div>
              {/* Segmented progress bar */}
              <div style={{ display: 'flex', gap: 4 }}>
                {STEP_LABELS.map((label, i) => {
                  const n = i + 1
                  const done   = n < step
                  const active = n === step
                  const accent = 'var(--sb-accent)'
                  return (
                    <div key={label} title={label} style={{ flex: 1, height: 4, borderRadius: 'var(--sb-r-chip)', overflow: 'hidden', background: 'var(--sb-hairline)', position: 'relative', transition: 'background 0.3s' }}>
                      <div style={{
                        position: 'absolute', inset: 0,
                        background: accent,
                        transform: done ? 'scaleX(1)' : active ? 'scaleX(1)' : 'scaleX(0)',
                        transformOrigin: 'left',
                        opacity: done ? 1 : active ? 0.55 : 0,
                        transition: 'transform 0.4s ease, opacity 0.3s',
                      }} />
                    </div>
                  )
                })}
              </div>
            </div>
            <button onClick={handleSkip} title="Skip setup" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-ink-3)', padding: '2px 4px', display: 'flex', borderRadius: 'var(--sb-r-chip)', flexShrink: 0, marginTop: -2, transition: 'color 0.15s' }}>
              <X size={ICON.lg} />
            </button>
          </div>

          {/* ── Step content ─────────────────────────────────────────────── */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px' }}>
            <div key={`${step}-${animKey}`} style={{ animation: `${dir === 'fwd' ? 'wz-fwd' : 'wz-back'} 0.28s ease` }}>
              {step === 1 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
                  <Step1You data={data} onChange={onChange} compact />
                  <Step1Accounts data={data} onChange={onChange} onBeforeOAuth={saveForOAuth} />
                </div>
              )}
              {step === 2 && <Step2Companies data={data} onChange={onChange} />}
              {step === 3 && <Step3Done data={data} onGo={goTo => void handleFinish(goTo)} />}
            </div>
          </div>

          {/* ── Footer nav ───────────────────────────────────────────────── */}
          <div style={{ padding: '18px 28px', borderTop: 'var(--sb-border-width) solid var(--sb-page)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            {step > 1 && step < TOTAL_STEPS ? (
              <button onClick={goBack} className="wz-btn-back" style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '11px 22px', borderRadius: 'var(--sb-r-pill)',
                background: 'transparent', border: 'var(--sb-border-width) solid var(--sb-hairline)',
                color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-label)', fontWeight: 600, cursor: 'pointer',
                transition: 'all 0.15s',
              }}>
                <ChevronLeft size={ICON.md} /> Back
              </button>
            ) : <div />}

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {step === 1 && (
                <button onClick={handleSkip} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-body)', padding: '4px 8px' }}>
                  Skip for now
                </button>
              )}
              {step < TOTAL_STEPS ? (
                <Button variant="primary" onClick={goNext} className="wz-btn-next" style={{ // A glow, not a height: the button lifts in its own colour.
                  // The height tokens are neutral by design, so this is one of
                  // three shadows in the app that carries a colour on purpose.
                  boxShadow: '0 4px 14px -2px rgba(var(--sb-accent-rgb),0.35)' }}>
                  Next <ChevronRight size={ICON.md} />
                </Button>
              ) : (
                <button onClick={() => void handleFinish()} className="wz-btn-next" style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '11px 26px', borderRadius: 'var(--sb-r-pill)',
                  background: 'var(--sb-positive)', border: 'none',
                  color: 'var(--sb-ink-on-fill)', fontSize: 'var(--sb-t-label)', fontWeight: 700, cursor: 'pointer',
                  // The finish button's own green, glowing under it.
                  boxShadow: '0 4px 14px -2px color-mix(in srgb, var(--sb-positive) 35.0%, transparent)',
                  transition: 'all 0.15s',
                }}>
                  <Check size={ICON.md} /> Finish
                </button>
              )}
            </div>
          </div>

          {/* Subtle bottom progress indicator */}
          <div style={{ height: 3, background: 'var(--sb-info-tint)', position: 'relative' }}>
            <div style={{ position: 'absolute', inset: '0 auto 0 0', width: `${pct}%`, background: 'var(--sb-accent)', transition: 'width 0.4s cubic-bezier(0.4,0,0.2,1)', borderRadius: '0 var(--sb-r-chip) var(--sb-r-chip) 0' }} />
          </div>
        </div>
      </div>
    </>
  )
}

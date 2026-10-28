import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, X } from 'lucide-react'
import { Button } from '@/components/ui'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'
import { applyAppearance } from '@/lib/themes'
import { ICON } from '@/lib/type'
import { initialState, type WizardState } from './state'
import { LAST, STEPS } from './steps'
import { DEFS } from './steps/registry'
import type { SetWizard } from './steps/types'
import { saveStep } from './persist'
import { markWizardDone } from './wizardGate'
import { Desk } from './scene/Desk'
import { Screen } from './scene/screens'
import './wizard.css'

export type { CompanyDraft, WizardState } from './state'

const RESUME_KEY = 'bpa-wizard-resume'

interface Props {
  onClose: () => void
  /**
   * The admin's dry run. Everything works as it does for a new signup, and
   * nothing leaves the page: no write to this browser, none to the account, no
   * theme left applied, and the "done" flag is never set — so the real wizard
   * is still there for a real new signup, and the admin can run this again.
   */
  testMode?: boolean
}

/**
 * The setup guide: a morning desk, a laptop that is the app, and one framed box
 * that asks. Eight steps, 4 to 7 optional. Each step writes when it is left
 * with Continue, so closing halfway keeps what was answered and a skipped step
 * writes nothing. Shown to a new signup only (see wizardGate.ts).
 */
export function SetupWizard({ onClose, testMode = false }: Props) {
  const user = useAuthStore(s => s.user)
  const startTheme = useRef(useUIStore.getState().themeId)
  const [idx, setIdx] = useState(0)
  const [furthest, setFurthest] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [w, setW] = useState<WizardState>(() => initialState(
    user?.name ?? localStorage.getItem('professor-display-name') ?? '', startTheme.current, user?.email ?? ''))
  const heading = useRef<HTMLHeadingElement>(null)

  const set: SetWizard = useCallback(p => setW(prev => ({ ...prev, ...(typeof p === 'function' ? p(prev) : p) })), [])

  // Back from an OAuth round trip: where the person was, with what they had typed.
  useEffect(() => {
    if (testMode) return
    const saved = sessionStorage.getItem(RESUME_KEY)
    if (!saved) return
    sessionStorage.removeItem(RESUME_KEY)
    try {
      const p = JSON.parse(saved) as { idx?: number; w?: Partial<WizardState> }
      if (typeof p.idx === 'number' && p.idx >= 0 && p.idx <= LAST) { const at = p.idx; setIdx(at); setFurthest(f => Math.max(f, at)) }
      if (p.w) setW(prev => ({ ...prev, ...p.w, saved: { ...prev.saved, ...p.w?.saved } }))
    } catch { /* an unreadable note is no note */ }
  }, [testMode])

  // A dry run leaves nothing applied: the theme the admin tried is put back.
  useEffect(() => () => { if (testMode) applyAppearance({ themeId: startTheme.current }) }, [testMode])

  // A new step is announced by moving focus to its title, so a keyboard or a screen reader lands where the change is.
  useEffect(() => { heading.current?.focus() }, [idx])

  const meta = STEPS[idx]
  const def = DEFS[meta.id]
  const blocker = def.blocker?.(w) ?? null

  function go(to: number) {
    const n = Math.max(0, Math.min(LAST, to))
    setIdx(n); setFurthest(f => Math.max(f, n)); setError('')
  }

  function closeAll() {
    // Whatever look was being tried goes back to the one that is SAVED: the person's own,
    // or the one chosen when the first step was left.
    applyAppearance({ themeId: testMode ? startTheme.current : useUIStore.getState().themeId })
    if (!testMode) markWizardDone()
    onClose()
  }

  function finish(goTo?: 'habits' | 'tasks') {
    if (!testMode && goTo) useUIStore.getState().setActiveModule(goTo)
    closeAll()
  }

  async function next() {
    if (busy) return
    if (idx === LAST) { finish(); return }
    setBusy(true); setError('')
    try {
      const lines = await saveStep(meta.id, w, testMode)
      set(p => ({ saved: { ...p.saved, [meta.id]: lines } }))
      go(idx + 1)
    } catch (e) {
      console.warn('[wizard] save failed', meta.id, e)
      setError('That did not save. Check your connection and try again, or skip this step for now.')
    } finally { setBusy(false) }
  }

  function skip() {
    set(p => { const saved = { ...p.saved }; delete saved[meta.id]; return { saved } })
    go(idx + 1)
  }

  // Secrets are never parked in sessionStorage: the keys and the finance password are
  // retyped on return rather than left as a second plaintext copy.
  function beforeOAuth() {
    const safe: WizardState = { ...w, ai: { ...w.ai, anthropicKey: '', groqKey: '', check: 'idle', note: '' }, finance: { ...w.finance, password: '' } }
    sessionStorage.setItem(RESUME_KEY, JSON.stringify({ idx, w: safe }))
  }

  // A modal keeps the keyboard inside it: Tab from the last control returns to the first, and back.
  function trap(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Tab') return
    const list = [...e.currentTarget.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, summary, [contenteditable="true"], [tabindex]:not([tabindex="-1"])')]
      .filter(el => !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true' && el.getClientRects().length > 0)
    if (!list.length) return
    const first = list[0], last = list[list.length - 1], at = document.activeElement
    if (e.shiftKey && (at === first || !e.currentTarget.contains(at))) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && (at === last || !e.currentTarget.contains(at))) { e.preventDefault(); first.focus() }
  }

  const Body = def.Body
  return (
    <div className="wz-root" role="dialog" aria-modal="true" aria-labelledby="wz-title" data-wizard data-wz-step={meta.id} onKeyDown={trap} data-wz-test={testMode ? '' : undefined}>
      <Desk><Screen step={meta.id} w={w} /></Desk>
      <div className="wz-scrim" aria-hidden="true" />

      <header className="wz-top">
        <div className="wz-brand">Professor</div>
        <nav className="wz-steps" aria-label={`Setup steps, step ${idx + 1} of ${STEPS.length}`}>
          <ol>
            {STEPS.map((s, i) => (
              <li key={s.id}>
                <button type="button" className="wz-step" data-active={i === idx ? '' : undefined} data-optional={s.optional ? '' : undefined}
                  aria-current={i === idx ? 'step' : undefined} aria-disabled={i > furthest || undefined}
                  onClick={() => { if (i <= furthest) go(i) }}>{s.nav}</button>
              </li>
            ))}
          </ol>
        </nav>
        <button type="button" className="wz-x" aria-label={testMode ? 'Leave the test' : 'Skip setup'} onClick={closeAll}><X size={ICON.md} aria-hidden /></button>
      </header>

      <div className="wz-slot">
        <div className="wz-frame">
          <div className="wz-halo" aria-hidden="true" />
          <div className="wz-panel">
            <div key={meta.id} className="wz-body-in" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div className="wz-eyebrow">Step {String(idx + 1).padStart(2, '0')} · {meta.time}</div>
                <h1 id="wz-title" className="wz-h1" ref={heading} tabIndex={-1}>{def.title(w)}</h1>
                <p className="wz-intro">{def.intro}</p>
              </div>
              <Body w={w} set={set} dry={testMode} beforeOAuth={beforeOAuth} />
            </div>

            <div className="wz-foot">
              {(error || blocker) && <p className="wz-note" data-warn="" role="alert" style={{ marginBottom: 8 }}>{error || blocker}</p>}
              <div className="wz-foot-row">
                {idx > 0 && <button type="button" className="wz-back" onClick={() => go(idx - 1)}>Back</button>}
                <Button variant="primary" style={{ flex: 1, justifyContent: 'center' }} disabled={busy || !!blocker} onClick={() => void next()}>
                  {idx === LAST ? 'Open Today' : (def.continueLabel ?? 'Continue')} <ArrowRight size={ICON.md} aria-hidden />
                </Button>
              </div>
              {def.skipLabel && idx < LAST && <button type="button" className="wz-link" style={{ alignSelf: 'flex-start' }} onClick={skip}>{def.skipLabel}</button>}
            </div>
          </div>
        </div>
      </div>

      {testMode && (
        <div className="wz-test-banner" role="status">
          Test mode. Nothing here is saved.
          <button type="button" className="wz-banner-btn" onClick={closeAll}>Leave the test</button>
        </div>
      )}
    </div>
  )
}

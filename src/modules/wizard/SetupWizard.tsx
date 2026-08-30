import { useState, useCallback, useEffect } from 'react'
import { X, ChevronLeft, ChevronRight, Check } from 'lucide-react'
import { useUIStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { useHabitsStore } from '@/store/habitsStore'
import { useTaskStore } from '@/store/taskStore'
import { getTheme, applyThemeVars } from '@/lib/themes'
import { saveCompaniesToDB } from '@/lib/dbSync'
import type { CompanyRow } from '@/lib/dbSync'
import { Step1Welcome } from './steps/Step1Welcome'
import { Step2Accounts } from './steps/Step2Accounts'
import { Step3Companies } from './steps/Step3Companies'
import { Step4Habits } from './steps/Step4Habits'
import { Step5Tasks } from './steps/Step5Tasks'
import { Step6Done } from './steps/Step6Done'

// ─── Exported types ────────────────────────────────────────────────────────────

export interface CompanyDraft {
  id: string; name: string; color: string; emailDomain: string; accountId: string
}

export interface CustomHabitDraft {
  name: string; emoji: string; color: string
  type: 'boolean' | 'quantity'; goal?: number; unit?: string
  frequency: 'daily' | 'weekdays' | 'weekly'
}

export interface TodoistTaskItem {
  id: string; content: string; due?: string; priority: number
}

export interface WizardData {
  displayName: string; themeId: string
  companies: CompanyDraft[]
  selectedTemplates: string[]; customHabits: CustomHabitDraft[]
  todoistToken: string; importedTasks: TodoistTaskItem[]
  selectedTaskIds: Set<string>
}

// ─── Habit templates (mirrored in Step4 for apply logic) ─────────────────────

const HABIT_TEMPLATES = [
  { id: 'water',       name: 'Drink Water',  emoji: '💧', color: '#60A5FA', type: 'quantity' as const, goal: 8,     unit: 'glasses', frequency: 'daily' as const },
  { id: 'exercise',    name: 'Exercise',      emoji: '💪', color: '#E05252', type: 'boolean'  as const,                               frequency: 'daily' as const },
  { id: 'reading',     name: 'Reading',       emoji: '📚', color: '#A855F7', type: 'quantity' as const, goal: 30,   unit: 'min',     frequency: 'daily' as const },
  { id: 'meditation',  name: 'Meditation',    emoji: '🧘', color: '#1D9E75', type: 'quantity' as const, goal: 10,   unit: 'min',     frequency: 'daily' as const },
  { id: 'sleep',       name: '8h Sleep',      emoji: '😴', color: '#7F77DD', type: 'boolean'  as const,                               frequency: 'daily' as const },
  { id: 'journaling',  name: 'Journaling',    emoji: '📓', color: '#F97316', type: 'boolean'  as const,                               frequency: 'daily' as const },
  { id: 'steps',       name: 'Steps',         emoji: '🚶', color: '#34D399', type: 'quantity' as const, goal: 10000, unit: 'steps',  frequency: 'daily' as const },
  { id: 'cold-shower', name: 'Cold Shower',   emoji: '🚿', color: '#22D3EE', type: 'boolean'  as const,                               frequency: 'daily' as const },
  { id: 'no-phone-am', name: 'No Phone (AM)', emoji: '📵', color: '#6366F1', type: 'boolean'  as const,                               frequency: 'daily' as const },
  { id: 'vitamins',    name: 'Vitamins',      emoji: '💊', color: '#EC4899', type: 'boolean'  as const,                               frequency: 'daily' as const },
  { id: 'prayer',      name: 'Prayer',        emoji: '🤲', color: '#FBBF24', type: 'boolean'  as const,                               frequency: 'daily' as const },
  { id: 'no-sugar',    name: 'No Sugar',      emoji: '🚫', color: '#E0944A', type: 'boolean'  as const,                               frequency: 'daily' as const },
]

const STEP_LABELS = ['Welcome', 'Accounts', 'Companies', 'Habits', 'Import', 'Done']
const TOTAL_STEPS = 6

// Light-theme CSS variable overrides — applied inside the modal
const LIGHT_VARS: React.CSSProperties = {
  '--color-bg':         '#F4F4F8',
  '--color-surface':    '#FFFFFF',
  '--color-border':     '#E5E5EA',
  '--color-text':       '#111827',
  '--color-text-dim':   '#374151',
  '--color-text-muted': '#9CA3AF',
} as React.CSSProperties

// ─── SetupWizard ──────────────────────────────────────────────────────────────

interface Props { onClose: () => void }

export function SetupWizard({ onClose }: Props) {
  const authName      = useAuthStore(s => s.user?.name ?? '')
  const currentThemeId = useUIStore(s => s.themeId)

  const [step, setStep]       = useState(1)
  const [dir,  setDir]        = useState<'fwd' | 'back'>('fwd')
  const [animKey, setAnimKey] = useState(0)
  const [data, setData]       = useState<WizardData>({
    displayName: authName, themeId: currentThemeId,
    companies: [], selectedTemplates: [], customHabits: [],
    todoistToken: '', importedTasks: [], selectedTaskIds: new Set(),
  })

  // Restore wizard state after OAuth redirect
  useEffect(() => {
    const saved = sessionStorage.getItem('bpa-wizard-resume')
    if (!saved) return
    sessionStorage.removeItem('bpa-wizard-resume')
    try {
      const parsed = JSON.parse(saved)
      if (parsed.step) setStep(parsed.step)
      if (parsed.data) {
        setData({ ...parsed.data, selectedTaskIds: new Set(parsed.data.selectedTaskIds ?? []) })
      }
    } catch { /* ignore */ }
  }, [])

  function saveForOAuth() {
    const serializable = { ...data, selectedTaskIds: [...data.selectedTaskIds] }
    sessionStorage.setItem('bpa-wizard-resume', JSON.stringify({ step, data: serializable }))
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
  function handleSkip() { localStorage.setItem('bpa-wizard-done', '1'); onClose() }

  async function handleFinish() {
    useUIStore.getState().setThemeId(data.themeId)
    applyThemeVars(getTheme(data.themeId))
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

    const addHabit = useHabitsStore.getState().addHabit
    for (const tid of data.selectedTemplates) {
      const t = HABIT_TEMPLATES.find(x => x.id === tid)
      if (t) addHabit({ name: t.name, emoji: t.emoji, color: t.color, type: t.type, goal: (t as {goal?: number}).goal, unit: (t as {unit?: string}).unit, frequency: t.frequency, isActive: true })
    }
    for (const ch of data.customHabits) {
      addHabit({ name: ch.name, emoji: ch.emoji, color: ch.color, type: ch.type, goal: ch.goal, unit: ch.unit, frequency: ch.frequency, isActive: true })
    }

    const addTask = useTaskStore.getState().addTask
    for (const t of data.importedTasks) {
      if (data.selectedTaskIds.has(t.id)) {
        addTask({ title: t.content, quadrant: null, company: 'personal', status: 'open', completed: false, source: 'todoist' } as Parameters<typeof addTask>[0])
      }
    }

    localStorage.setItem('bpa-wizard-done', '1')
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
        .wz-btn-back:hover  { background:#F3F4F6!important; border-color:#D1D5DB!important; }
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
          background: '#FFFFFF',
          borderRadius: 20,
          width: '100%', maxWidth: 640,
          maxHeight: '88vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 32px 80px rgba(0,0,0,0.28), 0 0 0 1px rgba(0,0,0,0.06)',
          animation: 'wz-modal 0.35s cubic-bezier(0.16,1,0.3,1)',
          overflow: 'hidden',
        }}>

          {/* ── Header ───────────────────────────────────────────────────── */}
          <div style={{ padding: '22px 28px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#6B7280' }}>
                  Step {step} of {TOTAL_STEPS}
                </span>
                <span style={{ fontSize: 12, color: '#9CA3AF', display: 'flex', alignItems: 'center', gap: 5 }}>
                  ✦ The Professor Setup
                </span>
              </div>
              {/* Segmented progress bar */}
              <div style={{ display: 'flex', gap: 4 }}>
                {STEP_LABELS.map((label, i) => {
                  const n = i + 1
                  const done   = n < step
                  const active = n === step
                  const accent = '#F5D14E'
                  return (
                    <div key={label} title={label} style={{ flex: 1, height: 4, borderRadius: 2, overflow: 'hidden', background: '#E5E7EB', position: 'relative', transition: 'background 0.3s' }}>
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
            <button onClick={handleSkip} title="Skip setup" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: '2px 4px', display: 'flex', borderRadius: 8, flexShrink: 0, marginTop: -2, transition: 'color 0.15s' }}>
              <X size={20} />
            </button>
          </div>

          {/* ── Step content ─────────────────────────────────────────────── */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px' }}>
            <div key={`${step}-${animKey}`} style={{ animation: `${dir === 'fwd' ? 'wz-fwd' : 'wz-back'} 0.28s ease` }}>
              {step === 1 && <Step1Welcome data={data} onChange={onChange} />}
              {step === 2 && <Step2Accounts data={data} onChange={onChange} onBeforeOAuth={saveForOAuth} />}
              {step === 3 && <Step3Companies data={data} onChange={onChange} />}
              {step === 4 && <Step4Habits data={data} onChange={onChange} />}
              {step === 5 && <Step5Tasks data={data} onChange={onChange} />}
              {step === 6 && <Step6Done data={data} />}
            </div>
          </div>

          {/* ── Footer nav ───────────────────────────────────────────────── */}
          <div style={{ padding: '18px 28px', borderTop: '1px solid #F0F0F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            {step > 1 && step < TOTAL_STEPS ? (
              <button onClick={goBack} className="wz-btn-back" style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '11px 22px', borderRadius: 100,
                background: 'transparent', border: '1.5px solid #E5E7EB',
                color: '#6B7280', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                transition: 'all 0.15s',
              }}>
                <ChevronLeft size={16} /> Back
              </button>
            ) : <div />}

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {step === 1 && (
                <button onClick={handleSkip} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', fontSize: 13, padding: '4px 8px' }}>
                  Skip for now
                </button>
              )}
              {step < TOTAL_STEPS ? (
                <button onClick={goNext} className="wz-btn-next" style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '11px 26px', borderRadius: 100,
                  background: '#F5D14E', border: 'none',
                  color: '#191712', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(127,119,221,0.35)',
                  transition: 'all 0.15s',
                }}>
                  Next <ChevronRight size={16} />
                </button>
              ) : (
                <button onClick={() => void handleFinish()} className="wz-btn-next" style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '11px 26px', borderRadius: 100,
                  background: '#1D9E75', border: 'none',
                  color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(29,158,117,0.35)',
                  transition: 'all 0.15s',
                }}>
                  <Check size={16} /> Finish
                </button>
              )}
            </div>
          </div>

          {/* Subtle bottom progress indicator */}
          <div style={{ height: 3, background: '#F0F0F4', position: 'relative' }}>
            <div style={{ position: 'absolute', inset: '0 auto 0 0', width: `${pct}%`, background: '#F5D14E', transition: 'width 0.4s cubic-bezier(0.4,0,0.2,1)', borderRadius: '0 2px 2px 0' }} />
          </div>
        </div>
      </div>
    </>
  )
}

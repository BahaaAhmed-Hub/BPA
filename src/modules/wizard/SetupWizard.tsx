import { useState, useCallback } from 'react'
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

// ─── Exported types (used by step components) ─────────────────────────────────

export interface CompanyDraft {
  id: string
  name: string
  color: string
  emailDomain: string
  accountId: string
}

export interface CustomHabitDraft {
  name: string
  emoji: string
  color: string
  type: 'boolean' | 'quantity'
  goal?: number
  unit?: string
  frequency: 'daily' | 'weekdays' | 'weekly'
}

export interface TodoistTaskItem {
  id: string
  content: string
  due?: string
  priority: number
}

export interface WizardData {
  displayName: string
  themeId: string
  companies: CompanyDraft[]
  selectedTemplates: string[]
  customHabits: CustomHabitDraft[]
  todoistToken: string
  importedTasks: TodoistTaskItem[]
  selectedTaskIds: Set<string>
}

// ─── Habit template type (for reference in apply) ─────────────────────────────

interface HabitTemplate {
  id: string
  name: string
  emoji: string
  color: string
  type: 'boolean' | 'quantity'
  goal?: number
  unit?: string
  frequency: 'daily' | 'weekdays' | 'weekly'
}

const HABIT_TEMPLATES: HabitTemplate[] = [
  { id: 'water',       name: 'Drink Water',   emoji: '💧', color: '#60A5FA', type: 'quantity', goal: 8,     unit: 'glasses', frequency: 'daily' },
  { id: 'exercise',    name: 'Exercise',       emoji: '💪', color: '#E05252', type: 'boolean',                               frequency: 'daily' },
  { id: 'reading',     name: 'Reading',        emoji: '📚', color: '#A855F7', type: 'quantity', goal: 30,   unit: 'min',     frequency: 'daily' },
  { id: 'meditation',  name: 'Meditation',     emoji: '🧘', color: '#1D9E75', type: 'quantity', goal: 10,   unit: 'min',     frequency: 'daily' },
  { id: 'sleep',       name: '8h Sleep',       emoji: '😴', color: '#7F77DD', type: 'boolean',                               frequency: 'daily' },
  { id: 'journaling',  name: 'Journaling',     emoji: '📓', color: '#F97316', type: 'boolean',                               frequency: 'daily' },
  { id: 'steps',       name: 'Steps',          emoji: '🚶', color: '#34D399', type: 'quantity', goal: 10000, unit: 'steps',  frequency: 'daily' },
  { id: 'cold-shower', name: 'Cold Shower',    emoji: '🚿', color: '#22D3EE', type: 'boolean',                               frequency: 'daily' },
  { id: 'no-phone-am', name: 'No Phone (AM)',  emoji: '📵', color: '#6366F1', type: 'boolean',                               frequency: 'daily' },
  { id: 'vitamins',    name: 'Vitamins',       emoji: '💊', color: '#EC4899', type: 'boolean',                               frequency: 'daily' },
  { id: 'prayer',      name: 'Prayer',         emoji: '🤲', color: '#FBBF24', type: 'boolean',                               frequency: 'daily' },
  { id: 'no-sugar',    name: 'No Sugar',       emoji: '🚫', color: '#E0944A', type: 'boolean',                               frequency: 'daily' },
]

// ─── Step labels ──────────────────────────────────────────────────────────────

const STEP_LABELS = ['Welcome', 'Accounts', 'Companies', 'Habits', 'Import', 'Done']
const TOTAL_STEPS = 6

// ─── WizardProgress ───────────────────────────────────────────────────────────

interface WizardProgressProps {
  step: number
}

function WizardProgress({ step }: WizardProgressProps) {
  return (
    <div style={{ padding: '24px 32px 0' }}>
      <style>{`
        @keyframes wizard-progress-fadein {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0, position: 'relative' }}>
        {STEP_LABELS.map((label, idx) => {
          const num = idx + 1
          const isCompleted = num < step
          const isActive = num === step
          const isFuture = num > step
          const isLast = idx === STEP_LABELS.length - 1
          const accent = 'var(--color-accent, #7F77DD)'

          return (
            <div key={num} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: isLast ? 'none' : 1, position: 'relative' }}>
              {/* connector line */}
              {!isLast && (
                <div style={{
                  position: 'absolute',
                  top: 13,
                  left: '50%',
                  width: '100%',
                  height: 2,
                  background: isCompleted
                    ? accent
                    : 'var(--color-border)',
                  transition: 'background 0.3s',
                  zIndex: 0,
                }} />
              )}

              {/* dot */}
              <div style={{
                width: isActive ? 28 : 24,
                height: isActive ? 28 : 24,
                borderRadius: '50%',
                background: isCompleted ? accent : isActive ? accent : 'var(--color-surface)',
                border: isFuture
                  ? '2px solid var(--color-border)'
                  : `2px solid ${accent}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                zIndex: 1,
                flexShrink: 0,
                boxShadow: isActive
                  ? '0 0 12px rgba(127,119,221,0.6)'
                  : 'none',
                transition: 'all 0.25s ease',
              }}>
                {isCompleted ? (
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                    <polyline points="2,5.5 4.5,8 9,3" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ) : (
                  <span style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: isActive ? '#fff' : isFuture ? 'var(--color-text-muted)' : '#fff',
                    lineHeight: 1,
                  }}>
                    {num}
                  </span>
                )}
              </div>

              {/* label */}
              <div style={{
                fontSize: 9,
                fontWeight: isActive ? 700 : 500,
                color: isActive
                  ? accent
                  : isCompleted
                  ? 'var(--color-text-dim)'
                  : 'var(--color-text-muted)',
                marginTop: 5,
                textAlign: 'center',
                whiteSpace: 'nowrap',
                transition: 'color 0.2s',
                letterSpacing: '0.03em',
                textTransform: 'uppercase',
              }}>
                {label}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Main SetupWizard ─────────────────────────────────────────────────────────

interface Props {
  onClose: () => void
}

export function SetupWizard({ onClose }: Props) {
  const authName = useAuthStore(s => s.user?.name ?? '')
  const currentThemeId = useUIStore(s => s.themeId)

  const [step, setStep] = useState(1)
  const [dir, setDir] = useState<'forward' | 'back'>('forward')
  const [animKey, setAnimKey] = useState(0)
  const [data, setData] = useState<WizardData>({
    displayName: authName,
    themeId: currentThemeId,
    companies: [],
    selectedTemplates: [],
    customHabits: [],
    todoistToken: '',
    importedTasks: [],
    selectedTaskIds: new Set<string>(),
  })

  const handleChange = useCallback((patch: Partial<WizardData>) => {
    setData(prev => ({ ...prev, ...patch }))
  }, [])

  function goNext() {
    if (step >= TOTAL_STEPS) return
    setDir('forward')
    setAnimKey(k => k + 1)
    setStep(s => s + 1)
  }

  function goBack() {
    if (step <= 1) return
    setDir('back')
    setAnimKey(k => k + 1)
    setStep(s => s - 1)
  }

  function handleSkip() {
    localStorage.setItem('bpa-wizard-done', '1')
    onClose()
  }

  async function handleFinish() {
    // 1. Apply theme
    useUIStore.getState().setThemeId(data.themeId)
    applyThemeVars(getTheme(data.themeId))

    // 2. Save display name
    if (data.displayName) {
      localStorage.setItem('professor-display-name', data.displayName)
    }

    // 3. Save companies
    if (data.companies.length > 0) {
      const companyRows: CompanyRow[] = data.companies.map(c => ({
        id: c.id,
        name: c.name,
        color: c.color,
        calendarId: '',
        emailDomain: c.emailDomain,
        accountId: c.accountId,
        isActive: true,
        users: [],
      }))
      localStorage.setItem('professor-companies', JSON.stringify(
        data.companies.map(c => ({
          id: c.id,
          name: c.name,
          color: c.color,
          users: [],
        }))
      ))
      try {
        await saveCompaniesToDB(companyRows)
      } catch { /* offline */ }
    }

    // 4. Add habits
    const addHabit = useHabitsStore.getState().addHabit
    for (const templateId of data.selectedTemplates) {
      const tpl = HABIT_TEMPLATES.find(t => t.id === templateId)
      if (tpl) {
        addHabit({
          name: tpl.name,
          emoji: tpl.emoji,
          color: tpl.color,
          type: tpl.type,
          goal: tpl.goal,
          unit: tpl.unit,
          frequency: tpl.frequency,
          isActive: true,
        })
      }
    }
    for (const ch of data.customHabits) {
      addHabit({
        name: ch.name,
        emoji: ch.emoji,
        color: ch.color,
        type: ch.type,
        goal: ch.goal,
        unit: ch.unit,
        frequency: ch.frequency,
        isActive: true,
      })
    }

    // 5. Add imported tasks
    const addTask = useTaskStore.getState().addTask
    for (const task of data.importedTasks) {
      if (data.selectedTaskIds.has(task.id)) {
        addTask({
          title: task.content,
          quadrant: null,
          company: 'personal',
          status: 'open',
          completed: false,
          source: 'todoist',
        } as Parameters<typeof addTask>[0])
      }
    }

    // 6. Mark wizard done
    localStorage.setItem('bpa-wizard-done', '1')

    onClose()
  }

  const slideAnimation = dir === 'forward'
    ? 'wizard-slide-fwd 0.3s ease'
    : 'wizard-slide-back 0.3s ease'

  return (
    <>
      <style>{`
        @keyframes wizard-backdrop-fadein {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes wizard-panel-slidein {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
        @keyframes wizard-glow-pulse {
          0%, 100% { opacity: 0.6; }
          50%       { opacity: 1; }
        }
        @keyframes wizard-slide-fwd {
          from { opacity: 0; transform: translateX(40px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes wizard-slide-back {
          from { opacity: 0; transform: translateX(-40px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>

      {/* Backdrop */}
      <div
        onClick={undefined}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 999,
          background: 'rgba(0,0,0,0.65)',
          backdropFilter: 'blur(6px)',
          animation: 'wizard-backdrop-fadein 0.3s ease',
        }}
      />

      {/* Glow */}
      <div style={{
        position: 'fixed',
        right: 0,
        top: '50%',
        transform: 'translateY(-50%)',
        width: 700,
        height: 700,
        background: 'radial-gradient(ellipse at 80% 50%, rgba(127,119,221,0.12) 0%, transparent 65%)',
        pointerEvents: 'none',
        zIndex: 1000,
        animation: 'wizard-glow-pulse 3s ease-in-out infinite',
      }} />

      {/* Panel */}
      <div style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 580,
        background: 'rgba(10,12,26,0.92)',
        backdropFilter: 'blur(28px) saturate(1.8)',
        borderLeft: '1px solid rgba(127,119,221,0.18)',
        boxShadow: '-24px 0 80px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(255,255,255,0.04)',
        overflow: 'hidden',
        zIndex: 1001,
        display: 'flex',
        flexDirection: 'column',
        animation: 'wizard-panel-slidein 0.45s cubic-bezier(0.16,1,0.3,1)',
      }}>

        {/* Progress */}
        <WizardProgress step={step} />

        {/* Step content */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '28px 32px',
        }}>
          <div key={`${step}-${animKey}`} style={{ animation: slideAnimation }}>
            {step === 1 && <Step1Welcome data={data} onChange={handleChange} />}
            {step === 2 && <Step2Accounts data={data} onChange={handleChange} />}
            {step === 3 && <Step3Companies data={data} onChange={handleChange} />}
            {step === 4 && <Step4Habits data={data} onChange={handleChange} />}
            {step === 5 && <Step5Tasks data={data} onChange={handleChange} />}
            {step === 6 && <Step6Done data={data} />}
          </div>
        </div>

        {/* Nav buttons */}
        <div style={{
          padding: '20px 32px',
          borderTop: '1px solid var(--color-border, rgba(255,255,255,0.08))',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            {/* Back button */}
            {step > 1 && step < 6 ? (
              <button
                onClick={goBack}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--color-border, rgba(255,255,255,0.12))',
                  borderRadius: 8,
                  padding: '10px 20px',
                  color: 'var(--color-text-dim)',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Back
              </button>
            ) : (
              <div />
            )}

            {/* Next / Finish */}
            {step < TOTAL_STEPS ? (
              <button
                onClick={goNext}
                style={{
                  background: 'var(--color-accent, #7F77DD)',
                  border: 'none',
                  borderRadius: 8,
                  padding: '10px 24px',
                  color: '#fff',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Next →
              </button>
            ) : (
              <button
                onClick={handleFinish}
                style={{
                  background: 'var(--color-accent, #7F77DD)',
                  border: 'none',
                  borderRadius: 8,
                  padding: '10px 24px',
                  color: '#fff',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Finish ✓
              </button>
            )}
          </div>

          {/* Skip link on step 1 */}
          {step === 1 && (
            <div style={{ textAlign: 'center' }}>
              <button
                onClick={handleSkip}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-text-muted)',
                  fontSize: 12,
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  padding: 0,
                }}
              >
                Skip setup →
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

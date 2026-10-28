import { claudeModelOf, loadAIConfig, loadSettings } from '@/modules/settings/model'
import { loadAutomationRules } from '@/lib/automation'
import { loadNotifSettings, loadQuietHours } from '@/lib/notifications'
import { loadLock } from '@/modules/finance/lock'
import { loadAccounts } from '@/lib/multiAccount'
import type { StepId } from './steps'

export interface CompanyDraft {
  id: string; name: string; color: string; emailDomain: string; accountId: string
  /** Added in this wizard — the only ones it may take away again. */
  isNew?: boolean
}

export interface AccountView { email: string; primary: boolean }

export type KeyCheck = 'idle' | 'testing' | 'ok' | 'failed' | 'short'

/** Everything the eight steps collect. Nothing here is written until a step is left with Continue. */
export interface WizardState {
  name: string
  themeId: string
  accounts: AccountView[]
  companies: CompanyDraft[]
  ai: {
    provider: 'anthropic' | 'groq'
    anthropicKey: string; groqKey: string
    anthropicModel: string; groqModel: string
    check: KeyCheck
    /** Why the last check failed, in words. */
    note: string
  }
  /** Hours on a 24h clock, in halves: 9, 17.5, 22.5. */
  rhythm: { start: number; stop: number; quiet: number }
  /** Automation rule id → on. */
  rules: Record<string, boolean>
  /** The three alerts worth asking about at setup, as push. */
  alerts: { needsyou: boolean; draft: boolean; conflict: boolean }
  /** Habit template ids. */
  habits: string[]
  finance: { lock: boolean; password: string }
  /** What each step wrote (or, in a dry run, would have), said in words — the Done summary reads it. */
  saved: Partial<Record<StepId, string[]>>
}

export const toHours = (hhmm: string, fallback: number): number => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '')
  return m ? Number(m[1]) + Number(m[2]) / 60 : fallback
}
export const fromHours = (h: number): string => {
  const total = Math.round(h * 60)
  const hh = Math.floor(total / 60) % 24, mm = total % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}
/** "9:00", "17:30" — for the screen, not the clock. */
export const clock = (h: number): string => {
  const t = Math.round(h * 60)
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

/** Seeded from what the account already holds, so a field starts at the truth rather than at a default of ours. */
export function initialState(userName: string, themeId: string, primaryEmail: string): WizardState {
  const ai = loadAIConfig()
  const s = loadSettings()
  const q = loadQuietHours()
  const notif = loadNotifSettings()
  const lock = loadLock()
  const extra = loadAccounts().filter(a => !a.isPrimary)
  return {
    name: userName,
    themeId,
    accounts: [
      ...(primaryEmail ? [{ email: primaryEmail, primary: true }] : []),
      ...extra.map(a => ({ email: a.email, primary: false })),
    ],
    companies: (JSON.parse(localStorage.getItem('professor-companies') ?? '[]') as Array<{ id: string; name: string; color: string; emailDomain?: string; accountId?: string }>)
      .map(c => ({ id: c.id, name: c.name, color: c.color, emailDomain: c.emailDomain ?? '', accountId: c.accountId ?? '' })),
    ai: {
      provider: ai.provider, anthropicKey: ai.anthropicKey, groqKey: ai.groqKey,
      anthropicModel: claudeModelOf(ai), groqModel: ai.groqModel,
      check: 'idle', note: '',
    },
    rhythm: {
      // Held to the sliders' own ranges, so what is shown is what is saved.
      start: Math.min(11, Math.max(5, toHours(s.focusStart, 9))),
      stop: Math.min(21, Math.max(14, toHours(s.endOfDay, 17))),
      quiet: Math.min(24, Math.max(20, toHours(q.start, 22.5))),
    },
    rules: Object.fromEntries(loadAutomationRules().map(r => [r.id, r.enabled])),
    alerts: {
      needsyou: notif.find(n => n.id === 'needsyou')?.push ?? true,
      draft: notif.find(n => n.id === 'draft')?.push ?? true,
      conflict: notif.find(n => n.id === 'conflict')?.push ?? true,
    },
    habits: [],
    finance: { lock: lock.enabled, password: '' },
    saved: {},
  }
}

/** Quiet hours end no later than work begins, or alerts would be held back into the working day. */
export function quietEnd(end: string, start: number): string {
  return toHours(end, 7) > start ? fromHours(start) : end
}

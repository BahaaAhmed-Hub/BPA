import { THEMES, applyAppearance } from '@/lib/themes'
import { useUIStore } from '@/store/uiStore'
import { saveCompaniesToDB, saveProfileToDB, type CompanyRow } from '@/lib/dbSync'
import { DEFAULT_AUTOMATION_RULES, saveAutomationRules } from '@/lib/automation'
import { loadNotifSettings, loadQuietHours, saveNotifSettings, saveQuietHours } from '@/lib/notifications'
import { HABIT_TEMPLATES } from '@/lib/habitTemplates'
import { useHabitsStore } from '@/store/habitsStore'
import { hashPassword, loadLock, saveLock } from '@/modules/finance/lock'
import { moduleIsOff } from '@/lib/entitlements'
import { CLAUDE_MODELS, GROQ_MODELS, claudeModelOf } from '@/lib/modelInfo'
import { cleanKey, loadAIConfig, loadSettings, saveAIConfig, saveSettings } from '@/modules/settings/model'
import { clock, fromHours, type WizardState } from './state'
import type { StepId } from './steps'

/**
 * What leaving a step writes. One saver per step, each returning what it did in
 * words — the Done summary prints them, and a dry run (the admin's test)
 * returns the same words without writing anything. A step that is skipped never
 * reaches here, so skipping is the absence of a write, not a write of nothing.
 *
 * Every saver writes through the same door Settings uses for the same thing, so
 * what the wizard sets is what Settings then shows, and nothing is stored twice.
 */
type Saver = (w: WizardState, dry: boolean) => Promise<string[]>

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

const you: Saver = async (w, dry) => {
  const lines: string[] = []
  const name = w.name.trim()
  if (name) {
    lines.push(`Called ${name}`)
    if (!dry) localStorage.setItem('professor-display-name', name)
  }
  const theme = THEMES.find(t => t.id === w.themeId)
  lines.push(`Look: ${theme?.name ?? w.themeId}`)
  if (!dry) {
    useUIStore.getState().setThemeId(w.themeId)
    applyAppearance({ themeId: w.themeId })
  }
  return lines
}

const accounts: Saver = async (w, dry) => {
  const lines = [plural(w.accounts.length, 'account connected', 'accounts connected')]
  if (w.companies.length) lines.push(plural(w.companies.length, 'company', 'companies') + `: ${w.companies.map(c => c.name).join(', ')}`)
  if (dry || !w.companies.length) return lines

  const rows: CompanyRow[] = w.companies.map(c => ({
    id: c.id, name: c.name, color: c.color, calendarId: '', emailDomain: c.emailDomain, accountId: c.accountId, isActive: true, users: [],
  }))
  // Merged with what is already there, never over it: a company added in Settings must survive this.
  let existing: CompanyRow[] = []
  try { existing = JSON.parse(localStorage.getItem('professor-companies') ?? '[]') as CompanyRow[] } catch { /* unreadable is empty */ }
  const ids = new Set(rows.map(r => r.id))
  localStorage.setItem('professor-companies', JSON.stringify([...existing.filter(e => !ids.has(e.id)), ...rows]))
  window.dispatchEvent(new Event('professor:companiesUpdated'))
  try { await saveCompaniesToDB(rows) } catch { /* offline: it is saved here and goes up with the next sync */ }
  return lines
}

const ai: Saver = async (w, dry) => {
  const a = w.ai
  const provider = a.provider === 'groq' ? 'Groq' : 'Claude'
  const model = a.provider === 'groq'
    ? (GROQ_MODELS.find(m => m.id === a.groqModel)?.label ?? a.groqModel)
    : (CLAUDE_MODELS.find(m => m.id === claudeModelOf(a))?.label ?? a.anthropicModel)
  const lines = [`${provider} · ${model}`, a.check === 'ok' ? 'Key tested and saved' : 'Key saved, not tested']
  if (dry) return lines
  saveAIConfig({
    ...loadAIConfig(),
    provider: a.provider,
    anthropicKey: cleanKey(a.anthropicKey), groqKey: cleanKey(a.groqKey),
    groqModel: a.groqModel, anthropicModel: claudeModelOf(a),
  })
  return lines
}

const rhythm: Saver = async (w, dry) => {
  const { start, stop, quiet } = w.rhythm
  const q = loadQuietHours()
  const lines = [
    `Work ${clock(start)} to ${clock(stop)}`,
    `Deep work from ${clock(start)}, meetings from ${clock(start + 1)}`,
    `Quiet from ${clock(quiet % 24)} until ${q.end}`,
  ]
  if (dry) return lines
  const had = localStorage.getItem('professor-settings') !== null
  const cur = loadSettings()
  const next = {
    ...cur,
    fullName: cur.fullName || w.name.trim(),
    // The default timezone is a placeholder, not an answer: a brand-new profile is written with the browser's own rather than somebody else's.
    timezone: had ? cur.timezone : (Intl.DateTimeFormat().resolvedOptions().timeZone || cur.timezone),
    focusStart: fromHours(start), focusEnd: fromHours(start + 2), earliestMeeting: fromHours(start + 1), endOfDay: fromHours(stop),
  }
  saveSettings(next)
  saveQuietHours({ on: true, start: fromHours(quiet), end: q.end })
  try { await saveProfileToDB(next) } catch { /* offline: saved here, and Settings → Schedule saves it up later */ }
  return lines
}

const automation: Saver = async (w, dry) => {
  const on = DEFAULT_AUTOMATION_RULES.filter(r => w.rules[r.id])
  const alerts = (Object.keys(w.alerts) as (keyof typeof w.alerts)[]).filter(k => w.alerts[k])
  const lines = [plural(on.length, 'helper on', 'helpers on'), plural(alerts.length, 'alert on', 'alerts on')]
  if (dry) return lines
  saveAutomationRules(DEFAULT_AUTOMATION_RULES.map(r => ({ ...r, enabled: !!w.rules[r.id] })))
  saveNotifSettings(loadNotifSettings().map(n => (n.id in w.alerts ? { ...n, push: w.alerts[n.id as keyof typeof w.alerts] } : n)))
  return lines
}

const habits: Saver = async (w, dry) => {
  const chosen = HABIT_TEMPLATES.filter(t => w.habits.includes(t.id))
  const lines = chosen.length ? [plural(chosen.length, 'habit', 'habits') + `: ${chosen.map(t => t.name).join(', ')}`] : ['No habits picked']
  if (dry || !chosen.length) return lines
  const store = useHabitsStore.getState()
  const have = new Set(store.habits.map(h => h.name.trim().toLowerCase()))
  for (const t of chosen) {
    // Never twice: one that is already there (made in Settings, or on another device) is left as it is.
    if (have.has(t.name.toLowerCase())) continue
    store.addHabit({ name: t.name, emoji: t.emoji, color: t.color, type: t.type, goal: t.goal, unit: t.unit, frequency: t.frequency, isActive: true })
  }
  return lines
}

const finance: Saver = async (w, dry) => {
  if (moduleIsOff('finance')) return ['Finance is not on this plan']
  const l = loadLock()
  if (l.enabled && l.password) return ['Finance pages already locked']
  if (!w.finance.lock) return ['Finance pages left open']
  const lines = ['Finance pages locked with your password']
  if (dry) return lines
  saveLock({ enabled: true, relock: l.relock, password: await hashPassword(w.finance.password) })
  return lines
}

const SAVERS: Partial<Record<StepId, Saver>> = { you, accounts, ai, rhythm, automation, habits, finance }

export async function saveStep(id: StepId, w: WizardState, dry: boolean): Promise<string[]> {
  return SAVERS[id] ? SAVERS[id](w, dry) : []
}

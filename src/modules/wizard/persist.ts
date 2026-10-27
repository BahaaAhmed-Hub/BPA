import { THEMES, applyAppearance } from '@/lib/themes'
import { useUIStore } from '@/store/uiStore'
import { saveCompaniesToDB, type CompanyRow } from '@/lib/dbSync'
import { CLAUDE_MODELS, GROQ_MODELS, claudeModelOf } from '@/lib/modelInfo'
import { cleanKey, loadAIConfig, saveAIConfig } from '@/modules/settings/model'
import type { WizardState } from './state'
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

const SAVERS: Partial<Record<StepId, Saver>> = { you, accounts, ai }

export async function saveStep(id: StepId, w: WizardState, dry: boolean): Promise<string[]> {
  return SAVERS[id] ? SAVERS[id](w, dry) : []
}

import { supabase } from '@/lib/supabase'
import { pushSharedPrefs, type PushResult } from '@/lib/prefSync'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AppSettings {
  fullName: string; timezone: string; workWeek: string[]; framework: string
  focusStart: string; focusEnd: string; earliestMeeting: string
  bufferMins: number; physicalBufferMins: number
  endOfDay: string; familyStart: string
  protectFocus: boolean; autoDeclineEarly: boolean
  commStyle: 'brief' | 'balanced' | 'detailed'; proactive: boolean
  briefTime: string; reviewDay: string; customInstructions: string
  morningReminderOn: boolean; morningReminderTime: string
  windDownOn: boolean; windDownTime: string; followUpNudges: boolean
  weeklyReviewOn: boolean; weeklyReviewDay: string; weeklyReviewTime: string
  theme: string; sidebarDefault: boolean; compact: boolean
}

export interface CompanyUser { id: string; name: string; email?: string }

export interface CompanyRow {
  id: string; name: string; color: string
  calendarId: string; emailDomain: string; accountId: string; isActive: boolean
  hidden?: boolean
  users: CompanyUser[]
  logoUrl?: string
}

export const DEFAULTS: AppSettings = {
  fullName:'', timezone:'America/New_York', workWeek:['Mon','Tue','Wed','Thu','Fri'], framework:'time_blocking',
  focusStart:'09:00', focusEnd:'11:00', earliestMeeting:'10:00',
  bufferMins:30, physicalBufferMins:60, endOfDay:'17:00', familyStart:'18:00',
  protectFocus:true, autoDeclineEarly:true,
  commStyle:'balanced', proactive:true, briefTime:'07:00', reviewDay:'Sunday', customInstructions:'',
  morningReminderOn:true, morningReminderTime:'07:00',
  windDownOn:true, windDownTime:'21:00', followUpNudges:true,
  weeklyReviewOn:true, weeklyReviewDay:'Sunday', weeklyReviewTime:'18:00',
  theme:'navy-night', sidebarDefault:false, compact:false,
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

export function ls<T>(key: string, fb: T): T {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) as T : fb } catch { return fb }
}
function lsSet<T>(key: string, v: T) { try { localStorage.setItem(key, JSON.stringify(v)) } catch { /**/ } }

export function loadSettings():   AppSettings   { return { ...DEFAULTS, ...ls<Partial<AppSettings>>('professor-settings', {}) } }

// ─── AI Provider config (kept local — never synced to DB) ────────────────────

export interface AIConfig {
  provider: 'anthropic' | 'groq'
  anthropicKey: string
  groqKey: string
  groqModel: string
}
const AI_CONFIG_DEFAULTS: AIConfig = {
  provider: 'anthropic', anthropicKey: '', groqKey: '', groqModel: 'llama-3.3-70b-versatile',
}
/** An `sk-ant-…` key sitting in the Groq field is not ambiguous: Groq's own
 *  keys begin `gsk_`, so this is an Anthropic key that was typed while the
 *  provider picker said Groq — which the old labels made easy, since the Groq
 *  option was labelled "Opus 4.1". Nothing reads it there: the bots and
 *  `professor.ts` read `anthropicKey`. It is **named and offered**, never
 *  moved silently — it is the person's credential, and a key that moves on its
 *  own is one nobody can account for. */
export function misplacedAnthropicKey(c: AIConfig): string {
  const stray = (c.groqKey ?? '').trim()
  return stray.startsWith('sk-ant-') ? stray : ''
}

/** An API key never contains whitespace, and a paste very often carries some —
 *  a trailing newline from a terminal, a space from a chat. It saved fine and
 *  then went out as an invalid header, so the key "saved" and was "rejected". */
export const cleanKey = (k: string | undefined): string => (k ?? '').replace(/\s+/g, '')

/** What was actually presented, without printing it: first 11, last 4, length. */
export function maskKey(k: string): string {
  return k.length > 18 ? `${k.slice(0, 11)}…${k.slice(-4)} (${k.length} characters)` : `${k ? '…' : 'empty'} (${k.length} characters)`
}

export function loadAIConfig(): AIConfig {
  const c = { ...AI_CONFIG_DEFAULTS, ...ls<Partial<AIConfig>>('professor-ai-config', {}) }
  return { ...c, anthropicKey: cleanKey(c.anthropicKey), groqKey: cleanKey(c.groqKey) }
}
let aiPushTimer: ReturnType<typeof setTimeout> | null = null
export function saveAIConfig(c: AIConfig) {
  lsSet('professor-ai-config', c)
  // The bots read this key out of Postgres, not out of this browser, and the
  // ordinary push is a five-minute timer. Typing a new key and messaging the
  // bot straight away therefore asked it with the old one — which is
  // indistinguishable from the new key being wrong.
  //
  // **Held, because this is a text field.** There is no Save button here: the
  // key saves as you type, and a push per keystroke is 93 of them for one
  // key. `pushSharedPrefs` refuses to run two at once now, so the server can
  // no longer end up with a stump — but 93 queued pushes to say one thing is
  // still 92 requests nobody needs. The same 700ms the calendar composer
  // holds words for, and a decision (the provider pills) still goes at once
  // because `setAI` writes localStorage before this timer is armed.
  if (aiPushTimer) clearTimeout(aiPushTimer)
  aiPushTimer = setTimeout(() => {
    aiPushTimer = null
    void pushSharedPrefs().then(r => onAIPush?.(r))
  }, 700)
}
/** Who to tell when the key finally reaches Postgres. There is **no Save
 *  button** on this field — it writes as you type — so without this the only
 *  evidence it worked was opening the app somewhere else, which is exactly
 *  how "I changed the key and it did not save" gets reported about a key that
 *  was, or was not, saved. The section below says which. */
let onAIPush: ((r: PushResult) => void) | null = null
/** The section that wants to hear about it (re)subscribes here; assigning the variable itself is not possible from another file. */
export function setAIPushListener(fn: ((r: PushResult) => void) | null) { onAIPush = fn }
export function saveSettings(s:   AppSettings)  { lsSet('professor-settings', s) }
export function loadCompanies():  CompanyRow[]  { return ls('professor-companies', []) }
export function saveCompanies(c:  CompanyRow[]) {
  lsSet('professor-companies', c)
  // Backup users separately so DB recovery can restore them
  const usersMap: Record<string, CompanyUser[]> = {}
  c.forEach(co => { if (co.users?.length) usersMap[co.id] = co.users })
  lsSet('professor-company-users', usersMap)
  // **The one writer announces the write.** `professor-companies` is read by
  // the rail's tiles, the calendar's company resolution and `mailCompany`'s
  // cache, each of which listens for this event — and Settings, the one screen
  // that edits companies, never fired it. `storage` does not fire in the tab
  // that wrote, so a rename, a colour, a link or a logo set here reached
  // nothing until a reload. The same shape as `saveRules` →
  // `finance:budgetRulesChanged` one module along.
  window.dispatchEvent(new Event('professor:companiesUpdated'))
}
// saveSectionOrder: section order no longer draggable in Settings v2 (kept for compat reference)

// ─── Google Calendars fetch ───────────────────────────────────────────────────

interface GCalCal { id: string; summary: string; primary?: boolean }
export async function fetchGCals(token: string): Promise<GCalCal[]> {
  try {
    const r = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList',
      { headers: { Authorization: `Bearer ${token}` } })
    if (!r.ok) return []
    return ((await r.json()) as { items?: GCalCal[] }).items ?? []
  } catch { return [] }
}

// ─── Supabase check ───────────────────────────────────────────────────────────

export async function checkSupabase(): Promise<boolean> {
  try { const { error } = await supabase.from('users').select('id').limit(1); return !error }
  catch { return false }
}

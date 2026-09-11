// ─── CHUNK 1: Types, constants, localStorage helpers ─────────────────────────
// (remaining chunks appended below)

import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { C_COLORS, STATUS_COLORS_PRESETS } from '@/lib/palettes'
import { Button, Segmented } from '@/components/ui'
import { NAV_H } from '@/App'
import {
  Plus, Trash2, LogIn, LogOut,
  ChevronDown, ChevronUp, User, Clock, Building2, Flame,
  Brain, Bell, Palette, Link, X, RefreshCw, Eye, EyeOff, Shield, Pencil,
  Hash, CheckSquare, Mail, HardDrive, CalendarDays, Swords, Wand2, CreditCard, Sparkles,
  ArrowUpRight, Download, Database, GripVertical, ImagePlus, LocateFixed, Check,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { paidAtSupported } from '../finance/unpaid'
import { todayISO } from '../finance/dates'
import { stepFor, setHabitStep, loadHabitSteps } from '@/lib/habitSteps'
import { loadWeekStart, saveWeekStart, WEEKDAY_NAMES, type Weekday } from '@/lib/weekStart'
import { ACCENTS, loadAccent, saveAccent, loadCompact, saveCompact, COMPACT_SCALE } from '@/lib/accent'
import {
  loadNotifSettings, saveNotifSettings, loadQuietHours, saveQuietHours, dormantWhy,
  type NotifSetting, type NotifChannel,
} from '@/lib/notifications'
import {
  loadHealthLinks, createHealthLink, deleteHealthLink, ingestUrl, checkHealthLink,
  isMovementHabit, suggestMetric, METRIC_LABEL, METRIC_SAMPLE,
  type HealthLink, type HealthMetric, type LinkCheck,
} from '@/lib/healthLink'
import type { EnvelopeStyle as BudgetEnvelopeStyle } from '@/modules/finance/screens/BudgetScreen'
import {
  biometricsAvailable, biometricName, deviceLabel, forgetPasskey, hashPassword,
  isLocked, loadLock, loadPasskey, markActive, registerPasskey, saveLock,
  RELOCK_CHOICES, type DevicePasskey, type LockConfig, type Relock,
} from '@/modules/finance/lock'
import { LockGate } from '@/modules/finance/FinanceLockScreen'
import { NotYet } from '@/components/ComingSoon'
import { loadAutomationRules, saveAutomationRules, loadRunLog, runAutomation, AUTOMATION_EVENT, type AutomationRule, type RunEntry } from '@/lib/automation'
import { connectAdditionalGoogleAccount, signInWithGoogle, signOut as googleSignOut, disconnectGoogleAccount } from '@/lib/google'
import { readScopes, cachedScopes, scopesAreStale, forgetScopes } from '@/lib/googleScopes'
import { useUIStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { THEMES, resolveThemeId, applyAppearance } from '@/lib/themes'
import { syncTimezoneFromLocation } from '@/lib/weather'
import { useHabitsStore, getHabitColors } from '@/store/habitsStore'
import { HABIT_VIEWS, loadHabitView, saveHabitView, EmojiBtn, type HabitView } from '@/modules/habits/HabitsModule'
import { useBehavioralStore, type BehavioralMode } from '@/store/behavioralStore'
import { loadAccounts, removeAccount, getProviderTokenForAccount, setAccountScopes, loadHiddenAccounts, saveHiddenAccounts, loadAccountsFromServer, type ConnectedAccount, type ServerAccount } from '@/lib/multiAccount'
import {
  saveProfileToDB, savePrefsToDB, saveCompaniesToDB, loadCompaniesFromDB,
  saveHabitsToDB, saveHabitLogsToDB, loadSettingsFromDB,
  saveAccountsToDB, loadAccountsFromDB,
  type CompanyRow as DbSyncCompanyRow,
} from '@/lib/dbSync'
import { loadLogs, loadQuantityLogs } from '@/store/habitsStore'
import {
  loadBlockingRules, saveBlockingRules,
  type BlockingRule, type DetailLevel,
  loadCachedCalendars, type CachedCalEntry,
} from '@/lib/blockingRules'
import { loadCustomStatuses, saveCustomStatuses, moveStatus, DEFAULT_STATUSES, type CustomStatus } from '@/lib/customStatuses'
import { loadRates, setRate } from '@/modules/finance/fx'
import { useFinanceStore } from '@/modules/finance/financeStore'
import { loadRules } from '@/modules/finance/modals/BudgetRuleModal'
import { ICON, STROKE } from '@/lib/type'
import {
  loadReminders, saveReminders, defaultReminder, dueDatesFor, reminderTitle,
  type MoneyReminder,
} from '@/modules/finance/reminders'
import { alpha } from '@/lib/alpha'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AppSettings {
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

interface CompanyUser { id: string; name: string; email?: string }

interface CompanyRow {
  id: string; name: string; color: string
  calendarId: string; emailDomain: string; accountId: string; isActive: boolean
  hidden?: boolean
  users: CompanyUser[]
}

const SECTION_IDS = ['profile','billing','schedule','companies','habits','tasks','accounts','professor','automation','notifications','appearance','blocking','behavioral','finance'] as const
type SectionId = typeof SECTION_IDS[number]

interface SectionMeta { id: SectionId; title: string; icon: React.ElementType; description: string }
const SECTION_META: SectionMeta[] = [
  { id: 'profile',       title: 'Profile',              icon: User,        description: 'Name, timezone, work week & framework' },
  { id: 'billing',       title: 'Billing',              icon: CreditCard,  description: 'Plan, payment method and invoices' },
  { id: 'accounts',      title: 'Accounts & companies', icon: Building2,   description: 'Connected Google accounts, and the companies that use them' },
  { id: 'professor',     title: 'AI',                   icon: Brain,       description: 'Model, autonomy and what the assistant may write for you' },
  { id: 'schedule',      title: 'Schedule rules',       icon: Clock,       description: 'Focus hours, buffers, meeting protections' },
  { id: 'blocking',      title: 'Integrations',         icon: Link,        description: 'Notion, Asana, Trello, Apple Notes and calendar sync' },
  { id: 'tasks',         title: 'Tasks',                icon: CheckSquare, description: 'Board statuses and task types' },
  { id: 'habits',        title: 'Habits',               icon: Flame,       description: 'Configure daily habits — synced with Habits page' },
  { id: 'automation',    title: 'Automation',           icon: Swords,      description: 'Rules that run without asking you first' },
  { id: 'notifications', title: 'Notifications',        icon: Bell,        description: 'What reaches you, where, and when it stays quiet' },
  { id: 'appearance',    title: 'Appearance',           icon: Palette,     description: 'The accent colour, and how much fits on screen' },
  { id: 'behavioral',    title: 'Behavioral OS',        icon: Brain,       description: 'Rank scoring, operating mode and tone' },
  { id: 'companies',     title: 'Data & privacy',       icon: Shield,      description: 'Where your data sits and how long it stays' },
  { id: 'finance',       title: 'Finance',              icon: Hash,        description: 'Envelope style, figures, dates & alerts' },
]

// Grouped nav — matches 11A Sunlit Bento design
const NAV_GROUPS: { label: string; ids: SectionId[] }[] = [
  { label: 'YOU',       ids: ['profile', 'billing'] },
  { label: 'WORKSPACE', ids: ['accounts', 'professor', 'schedule', 'blocking'] },
  { label: 'WORK',      ids: ['tasks', 'habits'] },
  { label: 'SYSTEM',    ids: ['automation', 'notifications', 'appearance', 'behavioral', 'companies', 'finance'] },
]

// ─── Constants ────────────────────────────────────────────────────────────────

function getUtcOffset(tz: string): string {
  try {
    const v = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'shortOffset' })
      .formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value ?? 'UTC'
    return v === 'GMT' ? 'UTC+0' : v.replace('GMT', 'UTC')
  } catch { return 'UTC' }
}
const ALL_TZ = (() => {
  const zones: string[] = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone')
    : ['America/New_York','America/Los_Angeles','Europe/London','Europe/Paris','Asia/Dubai','Asia/Tokyo']
  return zones.map(tz => {
    const o = getUtcOffset(tz)
    const s = o.includes('-') ? -1 : 1
    const p = o.replace('UTC','').replace('+','').replace('-','').split(':')
    return { value: tz, label: `(${o}) ${tz.replace(/_/g,' ')}`, offset: s*((parseInt(p[0])||0)*60+(parseInt(p[1])||0)) }
  }).sort((a,b) => a.offset - b.offset || a.value.localeCompare(b.value))
})()

// Framework options live in FRAMEWORK_SEGMENTS (11A segmented control).
const WORK_DAYS    = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

const BUFFER_STEPS = [0,15,30,45,60]
const PHYS_STEPS   = [0,30,60,90]
const FREQ_OPTS    = ['daily','weekdays','weekly'] as const

const DEFAULTS: AppSettings = {
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

function ls<T>(key: string, fb: T): T {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) as T : fb } catch { return fb }
}
function lsSet<T>(key: string, v: T) { try { localStorage.setItem(key, JSON.stringify(v)) } catch { /**/ } }

function loadSettings():   AppSettings   { return { ...DEFAULTS, ...ls<Partial<AppSettings>>('professor-settings', {}) } }

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
export function loadAIConfig(): AIConfig {
  return { ...AI_CONFIG_DEFAULTS, ...ls<Partial<AIConfig>>('professor-ai-config', {}) }
}
function saveAIConfig(c: AIConfig) { lsSet('professor-ai-config', c) }
function saveSettings(s:   AppSettings)  { lsSet('professor-settings', s) }
function loadCompanies():  CompanyRow[]  { return ls('professor-companies', []) }
function saveCompanies(c:  CompanyRow[]) {
  lsSet('professor-companies', c)
  // Backup users separately so DB recovery can restore them
  const usersMap: Record<string, CompanyUser[]> = {}
  c.forEach(co => { if (co.users?.length) usersMap[co.id] = co.users })
  lsSet('professor-company-users', usersMap)
}
function loadSectionOrder(): SectionId[] {
  const saved = ls<SectionId[]>('professor-section-order', [])
  const valid = saved.filter(id => (SECTION_IDS as readonly string[]).includes(id))
  const miss  = SECTION_IDS.filter(id => !valid.includes(id))
  // Pinned new feature sections get prepended so they're immediately visible
  const pinnedNew = miss.filter(id => id === 'behavioral')
  const otherNew  = miss.filter(id => id !== 'behavioral')
  return [...pinnedNew, ...valid, ...otherNew]
}
// saveSectionOrder: section order no longer draggable in Settings v2 (kept for compat reference)

// ─── Google Calendars fetch ───────────────────────────────────────────────────

interface GCalCal { id: string; summary: string; primary?: boolean }
async function fetchGCals(token: string): Promise<GCalCal[]> {
  try {
    const r = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList',
      { headers: { Authorization: `Bearer ${token}` } })
    if (!r.ok) return []
    return ((await r.json()) as { items?: GCalCal[] }).items ?? []
  } catch { return [] }
}

// ─── Supabase check ───────────────────────────────────────────────────────────

async function checkSupabase(): Promise<boolean> {
  try { const { error } = await supabase.from('users').select('id').limit(1); return !error }
  catch { return false }
}

// ─── CHUNK 2: Shared UI atoms ─────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  background: 'var(--sb-field)',
  border: 'var(--sb-border-width) solid var(--sb-border)',
  borderRadius: 'var(--sb-r-chip)', color: 'var(--sb-ink-1)',
  fontSize: 'var(--sb-t-body)', padding: '7px 11px', outline: 'none',
  fontFamily: 'var(--sb-font-ui)', width: '100%', boxSizing: 'border-box' as const,
}
const selectStyle: React.CSSProperties = {
  ...inputStyle, cursor: 'pointer', width: 'auto',
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const accent = 'var(--sb-accent)'
  return (
    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      style={{
        width: 42, height: 24, borderRadius: 'var(--sb-r-nav)', flexShrink: 0,
        background: checked ? accent : 'var(--sb-border)',
        border: 'none', cursor: 'pointer', position: 'relative', padding: 0, transition: 'background 0.2s',
      }}>
      <span style={{
        position: 'absolute', top: 4, left: checked ? 22 : 4,
        width: 16, height: 16, borderRadius: 'var(--sb-r-pill)', display: 'block',
        background: checked ? 'var(--sb-card)' : 'var(--sb-ink-3)',
        transition: 'left 0.2s',
      }} />
    </button>
  )
}

function FieldRow({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    // Wraps rather than spills: when the control cannot fit beside the label
    // it drops to its own line, instead of overflowing onto the next card.
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap',
      padding: '5px 0', borderBottom: 'var(--sb-border-width) solid var(--sb-hairline)',
    }}>
      <div style={{ flex: '1 1 150px', minWidth: 0, maxWidth: 172, paddingTop: 2 }}>
        <span style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)' }}>{label}</span>
        {sub && <p style={{ margin: '2px 0 0', fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-3)', lineHeight: 1.4 }}>{sub}</p>}
      </div>
      <div style={{
        flex: '1 1 auto', minWidth: 0, display: 'flex',
        justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap', gap: 6,
      }}>{children}</div>
    </div>
  )
}


// ─── Design primitives (11A artboard) ────────────────────────────────────────

/** Cream pill used for both read-outs and small actions. */
const PILL_BASE: React.CSSProperties = {
  background: 'var(--sb-field)',
  border: 'var(--sb-border-width) solid var(--sb-border)',
  borderRadius: 'var(--sb-r-sm)',
  color: 'var(--sb-ink-1)',
  fontSize: 'var(--sb-t-body)',
  fontWeight: 500,
  padding: '8px 14px',
  fontFamily: 'inherit',
  lineHeight: 1.2,
  whiteSpace: 'nowrap' as const,
  outline: 'none',
}

/** Ghost pill button — optional leading icon, optional rust tone. */
function GhostPill({ icon: Icon, children, onClick, tone, title }: {
  icon?: React.ElementType
  children: ReactNode
  onClick?: () => void
  tone?: 'default' | 'rust'
  title?: string
}) {
  return (
    <button onClick={onClick} title={title} style={{
      ...PILL_BASE,
      display: 'inline-flex', alignItems: 'center', gap: 6,
      cursor: 'pointer',
      color: tone === 'rust' ? 'var(--sb-negative)' : 'var(--sb-ink-1)',
      borderColor: tone === 'rust' ? 'color-mix(in srgb, var(--sb-negative) 35.0%, transparent)' : 'var(--sb-border)',
      background: tone === 'rust' ? 'var(--sb-card)' : 'var(--sb-field)',
    }}>
      {Icon && <Icon size={13} strokeWidth={2} />}
      {children}
    </button>
  )
}

/** Static cream pill for values that are displayed, not edited here. */
function PillValue({ children }: { children: ReactNode }) {
  return <span style={{ ...PILL_BASE, display: 'inline-block', color: 'var(--sb-ink-1)' }}>{children}</span>
}

/** Label (+sub) on the left, control hard-right — the artboard row rhythm. */
function DRow({ label, sub, children, last }: {
  label: string; sub?: string; children: ReactNode; last?: boolean
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
      padding: '12px 0',
      borderBottom: last ? 'none' : 'var(--sb-border-width) solid var(--sb-hairline)',
    }}>
      <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 'var(--sb-t-body)', fontWeight: 500, color: 'var(--sb-ink-1)', lineHeight: 1.3 }}>{label}</p>
        {sub && <p style={{ margin: '2px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', lineHeight: 1.35 }}>{sub}</p>}
      </div>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10 }}>{children}</div>
    </div>
  )
}

/** Native select dressed as a cream pill (keeps keyboard + full option list). */
const pillSelectStyle: React.CSSProperties = {
  ...PILL_BASE,
  cursor: 'pointer',
  appearance: 'none' as const,
  WebkitAppearance: 'none' as const,
  paddingRight: 14,
  maxWidth: 260,
  textOverflow: 'ellipsis',
}

function VisaBadge() {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 30, height: 19, borderRadius: 'var(--sb-r-chip)', background: 'var(--sb-info)',
      color: 'var(--sb-ink-on-dark)', fontSize: 'var(--sb-t-micro)', fontWeight: 700, fontStyle: 'italic',
      letterSpacing: '0.04em', flexShrink: 0,
    }}>VISA</span>
  )
}

// ─── Sortable Section Shell ────────────────────────────────────────────────────

// SectionShell removed — Settings now uses a left-rail + single-panel layout.

// ─── CHUNK 3: Profile & Schedule sections ────────────────────────────────────

/** Framework options shown as a segmented control on the 11A artboard. */
const FRAMEWORK_SEGMENTS = [
  { value: 'time_blocking', label: 'Time blocking' },
  { value: 'eisenhower',    label: 'Eisenhower' },
  { value: 'gtd',           label: 'GTD' },
]

/** "Sunday to Thursday" / "Mon, Wed, Fri" summary of the selected work week. */
function workWeekSummary(days: string[]): string {
  const ordered = WORK_DAYS.filter(d => days.includes(d))
  if (ordered.length === 0) return 'No work days selected'
  const full: Record<string, string> = {
    Sun: 'Sunday', Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday',
    Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday',
  }
  const idx = ordered.map(d => WORK_DAYS.indexOf(d))
  const contiguous = idx.every((n, i) => i === 0 || n === idx[i - 1] + 1)
  if (contiguous && ordered.length > 1) return `${full[ordered[0]]} to ${full[ordered[ordered.length - 1]]}`
  if (ordered.length === 1) return full[ordered[0]]
  return ordered.join(', ')
}

function ProfileSection({
  s, set, name, email, avatarUrl, onSignOut, onRefresh, refreshing,
}: {
  s: AppSettings
  set: (p: Partial<AppSettings>) => void
  name: string
  email: string
  avatarUrl?: string
  onSignOut: () => void
  onRefresh: () => void
  refreshing: boolean
}) {
  const tzLabel = ALL_TZ.find(t => t.value === s.timezone)?.label ?? s.timezone
  const [tzSyncing, setTzSyncing] = useState(false)
  const [tzSyncNote, setTzSyncNote] = useState<string | undefined>(undefined)
  const initials = (s.fullName || name || 'P').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
  const [weekStartDay, setWeekStartDay] = useState<Weekday>(() => loadWeekStart())

  return (
    <div>
      {/* Identity block */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        paddingBottom: 18, borderBottom: 'var(--sb-border-width) solid var(--sb-hairline)',
      }}>
        {avatarUrl
          ? <img src={avatarUrl} alt="" style={{ width: 46, height: 46, borderRadius: 'var(--sb-r-pill)', border: 'var(--sb-border-width) solid var(--sb-border)', flexShrink: 0, objectFit: 'cover' }} />
          : <div style={{
              width: 46, height: 46, borderRadius: 'var(--sb-r-pill)', flexShrink: 0,
              background: 'var(--sb-hairline)', border: 'var(--sb-border-width) solid var(--sb-border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 'var(--sb-t-h3)', fontWeight: 700, color: 'var(--sb-ink-3)', letterSpacing: '0.02em',
            }}>{initials}</div>
        }
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{
            margin: 0, fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h2)', fontWeight: 600,
            letterSpacing: '-0.02em', color: 'var(--sb-ink-1)', lineHeight: 1.25,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{s.fullName || name || 'Professor User'}</p>
          <p style={{
            margin: '2px 0 0', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-4)', lineHeight: 1.3,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{[email, tzLabel].filter(Boolean).join(' · ')}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <GhostPill icon={RefreshCw} onClick={onRefresh}>{refreshing ? 'Refreshing…' : 'Refresh'}</GhostPill>
          <GhostPill tone="rust" onClick={onSignOut}>Sign out</GhostPill>
        </div>
      </div>

      {/* Fields */}
      <DRow label="Full name">
        <input
          value={s.fullName}
          onChange={e => set({ fullName: e.target.value })}
          placeholder="Your name"
          style={{ ...PILL_BASE, width: 220 }}
        />
      </DRow>

      <DRow label="Framework" sub="How the Professor plans your day">
        <Segmented
          value={FRAMEWORK_SEGMENTS.some(f => f.value === s.framework) ? s.framework : 'time_blocking'}
          options={FRAMEWORK_SEGMENTS}
          onChange={v => set({ framework: v })}
        />
      </DRow>

      <DRow label="Timezone" sub={tzSyncNote}>
        <select value={s.timezone} onChange={e => set({ timezone: e.target.value })} style={pillSelectStyle}>
          {ALL_TZ.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
        </select>
        {/* Nothing asks for your location until you press this. */}
        <button
          onClick={async () => {
            setTzSyncing(true); setTzSyncNote(undefined)
            const tz = await syncTimezoneFromLocation()
            setTzSyncing(false)
            if (!tz) { setTzSyncNote('Could not read your location — pick a zone above.'); return }
            const known = ALL_TZ.some(t => t.value === tz)
            set({ timezone: tz })
            setTzSyncNote(known ? `Set from your location — ${tz.replace(/_/g, ' ')}` : `Set to ${tz.replace(/_/g, ' ')}`)
          }}
          disabled={tzSyncing}
          title="Set the timezone from where you are"
          style={{
            width: 'var(--sb-h-nav)', height: 'var(--sb-h-nav)', borderRadius: 'var(--sb-r-sm)', flexShrink: 0, padding: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
            color: tzSyncing ? 'var(--sb-ink-4)' : 'var(--sb-ink-3)',
            cursor: tzSyncing ? 'default' : 'pointer',
          }}>
          <LocateFixed size={ICON.md} style={tzSyncing ? { opacity: 0.5 } : undefined} />
        </button>
      </DRow>

      <DRow label="Week starts on" sub={`Every calendar draws its week from ${WEEKDAY_NAMES[weekStartDay]}`}>
        <select
          value={weekStartDay}
          onChange={e => { const d = Number(e.target.value) as Weekday; setWeekStartDay(d); saveWeekStart(d) }}
          style={pillSelectStyle}>
          {WEEKDAY_NAMES.map((d, i) => <option key={d} value={i}>{d}</option>)}
        </select>
      </DRow>

      <DRow label="Work days" sub={workWeekSummary(s.workWeek)} last>
        <div style={{ display: 'flex', gap: 6 }}>
          {WORK_DAYS.map(d => {
            const on = s.workWeek.includes(d)
            return (
              <button
                key={d}
                onClick={() => set({ workWeek: on ? s.workWeek.filter(x => x !== d) : [...s.workWeek, d] })}
                style={{
                  padding: '7px 11px', borderRadius: 'var(--sb-r-chip)', fontSize: 'var(--sb-t-body-s)', cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontWeight: on ? 600 : 500,
                  background: on ? 'var(--sb-ink-1)' : 'var(--sb-field)',
                  border: `var(--sb-border-width) solid ${on ? 'var(--sb-ink-1)' : 'var(--sb-border)'}`,
                  color: on ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-3)',
                  transition: 'all 0.12s',
                }}>{d}</button>
            )
          })}
        </div>
      </DRow>
    </div>
  )
}

function ScheduleSection({
  s, set,
}: { s: AppSettings; set: (p: Partial<AppSettings>) => void }) {
  return (
    <div>
      <FieldRow label="Focus window" sub="Deep work block">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="time" value={s.focusStart} onChange={e => set({ focusStart: e.target.value })}
            style={{ ...inputStyle, width: 118 }} />
          <span style={{ color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-meta)' }}>to</span>
          <input type="time" value={s.focusEnd} onChange={e => set({ focusEnd: e.target.value })}
            style={{ ...inputStyle, width: 118 }} />
        </div>
      </FieldRow>
      <FieldRow label="Earliest meeting" sub="No calls before">
        <input type="time" value={s.earliestMeeting} onChange={e => set({ earliestMeeting: e.target.value })}
          style={{ ...inputStyle, width: 118 }} />
      </FieldRow>
      <FieldRow label="End of day">
        <input type="time" value={s.endOfDay} onChange={e => set({ endOfDay: e.target.value })}
          style={{ ...inputStyle, width: 118 }} />
      </FieldRow>
      <FieldRow label="Family time">
        <input type="time" value={s.familyStart} onChange={e => set({ familyStart: e.target.value })}
          style={{ ...inputStyle, width: 118 }} />
      </FieldRow>
      <FieldRow label="Meeting buffer" sub="Virtual gap">
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {BUFFER_STEPS.map(n => (
            <button key={n} onClick={() => set({ bufferMins: n })}
              style={{
                padding: '4px 10px', borderRadius: 'var(--sb-r-chip)', fontSize: 'var(--sb-t-meta)', cursor: 'pointer', fontWeight: 500,
                background: s.bufferMins === n ? 'rgba(var(--sb-accent-rgb),0.12)' : 'var(--sb-field)',
                border: `var(--sb-border-width) solid ${s.bufferMins === n ? 'var(--sb-accent)' : 'var(--sb-border)'}`,
                color: s.bufferMins === n ? 'var(--sb-accent)' : 'var(--sb-ink-3)',
              }}>{n === 0 ? 'None' : `${n}m`}</button>
          ))}
        </div>
      </FieldRow>
      <FieldRow label="Physical buffer" sub="Travel time">
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {PHYS_STEPS.map(n => (
            <button key={n} onClick={() => set({ physicalBufferMins: n })}
              style={{
                padding: '4px 10px', borderRadius: 'var(--sb-r-chip)', fontSize: 'var(--sb-t-meta)', cursor: 'pointer', fontWeight: 500,
                background: s.physicalBufferMins === n ? 'rgba(var(--sb-accent-rgb),0.12)' : 'var(--sb-field)',
                border: `var(--sb-border-width) solid ${s.physicalBufferMins === n ? 'var(--sb-accent)' : 'var(--sb-border)'}`,
                color: s.physicalBufferMins === n ? 'var(--sb-accent)' : 'var(--sb-ink-3)',
              }}>{n === 0 ? 'None' : `${n}m`}</button>
          ))}
        </div>
      </FieldRow>
      <FieldRow label="Protect focus">
        <Toggle checked={s.protectFocus} onChange={v => set({ protectFocus: v })} />
      </FieldRow>
      <FieldRow label="Auto-decline early">
        <Toggle checked={s.autoDeclineEarly} onChange={v => set({ autoDeclineEarly: v })} />
      </FieldRow>
    </div>
  )
}

// ─── CHUNK 4: Companies + Habits sections ────────────────────────────────────

function CompanyCard({
  co, accounts, onUpdate, onDelete,
}: {
  co: CompanyRow
  accounts: ConnectedAccount[]
  onUpdate: (patch: Partial<CompanyRow>) => void
  onDelete: () => void
}) {
  const [usersOpen, setUsersOpen]     = useState(false)
  const [colorOpen, setColorOpen]     = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft]     = useState(co.name)
  const [editingDomain, setEditingDomain] = useState(false)
  const [domainDraft, setDomainDraft] = useState(co.emailDomain)
  const [newUserName, setNewUserName]   = useState('')
  const [newUserEmail, setNewUserEmail] = useState('')
  const [editingUserId, setEditingUserId] = useState<string | null>(null)
  const [userDrafts, setUserDrafts] = useState<Record<string, { name: string; email: string }>>({})
  const colorRef = useRef<HTMLDivElement>(null)

  const users: CompanyUser[] = co.users ?? []

  useEffect(() => {
    if (!colorOpen) return
    function handler(e: MouseEvent) {
      if (colorRef.current && !colorRef.current.contains(e.target as Node)) setColorOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [colorOpen])

  function saveName() {
    const v = nameDraft.trim(); if (v) onUpdate({ name: v }); else setNameDraft(co.name)
    setEditingName(false)
  }
  function saveDomain() { onUpdate({ emailDomain: domainDraft.trim() }); setEditingDomain(false) }

  function addUser() {
    if (!newUserName.trim()) return
    onUpdate({ users: [...users, { id: crypto.randomUUID(), name: newUserName.trim(), email: newUserEmail.trim() || undefined }] })
    setNewUserName(''); setNewUserEmail('')
  }
  function removeUser(id: string) { onUpdate({ users: users.filter(u => u.id !== id) }) }

  function startEditUser(u: CompanyUser) {
    setEditingUserId(u.id)
    setUserDrafts(d => ({ ...d, [u.id]: { name: u.name, email: u.email ?? '' } }))
  }
  function saveUser(id: string) {
    const draft = userDrafts[id]; if (!draft) return
    onUpdate({ users: users.map(u => u.id === id ? { ...u, name: draft.name.trim() || u.name, email: draft.email.trim() || undefined } : u) })
    setEditingUserId(null)
  }

  const tinp: React.CSSProperties = {
    background: 'transparent', border: 'none', borderBottom: 'var(--sb-border-width) solid var(--sb-info)',
    outline: 'none', color: 'var(--sb-ink-1)', fontFamily: 'inherit', padding: '0 2px',
  }

  return (
    <div style={{ background: 'var(--sb-page)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-nav)', marginBottom: 8, overflow: 'visible', opacity: co.hidden ? 0.55 : 1, transition: 'opacity 0.15s' }}>
      {/* Company header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px' }}>

        {/* Color circle → color picker */}
        <div ref={colorRef} style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => setColorOpen(o => !o)}
            title="Change color"
            style={{
              width: 18, height: 18, borderRadius: 'var(--sb-r-pill)', background: co.color, cursor: 'pointer',
              border: `var(--sb-border-emphasis) solid ${alpha(co.color, 37.6)}`, flexShrink: 0,
            }}
          />
          {colorOpen && (
            <div style={{
              position: 'absolute', top: 24, left: 0, zIndex: 200,
              background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-nav)',
              // Two rows of twelve rather than one row of seven: a wrapping
              // grid keeps the popover the width of a dozen swatches however
              // many the list grows to.
              padding: '8px 9px', display: 'grid', gridTemplateColumns: 'repeat(12, 16px)', gap: 6,
              boxShadow: 'var(--sb-shadow-hover)',
            }}>
              {C_COLORS.map(c => (
                <button key={c} onClick={() => { onUpdate({ color: c }); setColorOpen(false) }}
                  style={{
                    width: 16, height: 16, borderRadius: 'var(--sb-r-pill)', background: c,
                    border: 'none', cursor: 'pointer', flexShrink: 0,
                    boxShadow: co.color === c ? `0 0 0 2px var(--sb-card), 0 0 0 3.5px ${c}` : 'none',
                    transform: co.color === c ? 'scale(1.2)' : 'scale(1)',
                    transition: 'transform 0.1s ease',
                  }} />
              ))}
            </div>
          )}
        </div>

        {/* Name + domain stacked */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
          {editingName ? (
            <input autoFocus value={nameDraft}
              onChange={e => setNameDraft(e.target.value)}
              onBlur={saveName}
              onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setNameDraft(co.name); setEditingName(false) } }}
              style={{ ...tinp, fontSize: 'var(--sb-t-label)', fontWeight: 600, width: 160 }}
            />
          ) : (
            <span onClick={() => setEditingName(true)} title="Click to rename"
              style={{ fontSize: 'var(--sb-t-label)', fontWeight: 600, color: 'var(--sb-ink-1)', cursor: 'text', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {co.name || 'Untitled'}
            </span>
          )}
          {editingDomain ? (
            <input autoFocus value={domainDraft}
              onChange={e => setDomainDraft(e.target.value)}
              onBlur={saveDomain}
              onKeyDown={e => { if (e.key === 'Enter') saveDomain(); if (e.key === 'Escape') { setDomainDraft(co.emailDomain); setEditingDomain(false) } }}
              placeholder="@domain.com"
              style={{ ...tinp, fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-3)', width: 140 }}
            />
          ) : (
            <span onClick={() => setEditingDomain(true)} title="Click to set domain"
              style={{ fontSize: 'var(--sb-t-micro)', color: co.emailDomain ? 'var(--sb-ink-3)' : 'var(--sb-border)', cursor: 'text' }}>
              {co.emailDomain || ''}
            </span>
          )}
        </div>

        {/* Linked Google account — always visible, since the link is the point */}
        <select
          value={co.accountId}
          onChange={e => onUpdate({ accountId: e.target.value })}
          title={co.accountId ? 'Linked Google account' : 'Not linked to a Google account'}
          style={{
            ...selectStyle, fontSize: 'var(--sb-t-meta)', padding: '3px 8px', maxWidth: 168, flexShrink: 0,
            borderColor: co.accountId ? 'var(--sb-positive-tint)' : 'var(--sb-border)',
            background: co.accountId ? 'color-mix(in srgb, var(--sb-positive) 8.0%, transparent)' : 'var(--sb-card)',
            color: co.accountId ? 'var(--sb-positive)' : 'var(--sb-ink-4)',
          }}>
          <option value="">{accounts.length > 0 ? 'Link an account…' : 'No accounts connected'}</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.isPrimary ? `${a.email} (this account)` : a.email}</option>)}
        </select>

        {/* Users expand toggle */}
        <button onClick={() => setUsersOpen(o => !o)} title={usersOpen ? 'Collapse members' : 'Expand members'} style={{
          display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0,
          padding: '2px 7px', borderRadius: 'var(--sb-r-chip)', fontSize: 'var(--sb-t-micro)', cursor: 'pointer',
          background: 'transparent', border: 'var(--sb-border-width) solid var(--sb-border)',
          color: 'var(--sb-ink-3)',
        }}>
          <span style={{ color: co.color, fontWeight: 600 }}>{users.length}</span>
          {usersOpen ? <ChevronUp size={ICON.sm} /> : <ChevronDown size={ICON.sm} />}
        </button>

        <Toggle checked={co.isActive} onChange={v => onUpdate({ isActive: v })} />

        {/* Hide from platform toggle */}
        <button
          onClick={() => onUpdate({ hidden: !co.hidden })}
          title={co.hidden ? 'Show in platform' : 'Hide from platform (tasks, calendar, dashboard…)'}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 3,
            display: 'flex', alignItems: 'center',
            color: co.hidden ? 'var(--sb-accent)' : 'var(--sb-ink-3)',
          }}
        >
          {co.hidden ? <EyeOff size={ICON.sm} /> : <Eye size={ICON.sm} />}
        </button>

        <button onClick={onDelete}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-ink-3)', padding: 3, display: 'flex', alignItems: 'center' }}>
          <Trash2 size={ICON.sm} />
        </button>
      </div>

      {/* Users tree */}
      {usersOpen && (
        <div style={{ borderTop: 'var(--sb-border-width) solid var(--sb-border)', padding: '8px 14px 10px 46px' }}>
          {users.length === 0 && (
            <p style={{ margin: '0 0 6px', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-border)', fontStyle: 'italic' }}>No members yet</p>
          )}

          {users.map(u => {
            const isEditing = editingUserId === u.id
            const draft = userDrafts[u.id]
            return (
              <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: 'var(--sb-border-width) solid var(--sb-border)' }}>
                <span style={{ width: 6, height: 6, borderRadius: 'var(--sb-r-pill)', background: co.color, flexShrink: 0 }} />

                {isEditing ? (
                  <>
                    <input autoFocus value={draft?.name ?? u.name}
                      onChange={e => setUserDrafts(d => ({ ...d, [u.id]: { ...d[u.id], name: e.target.value } }))}
                      onBlur={() => saveUser(u.id)}
                      onKeyDown={e => { if (e.key === 'Enter') saveUser(u.id); if (e.key === 'Escape') setEditingUserId(null) }}
                      style={{ ...tinp, fontSize: 'var(--sb-t-body-s)', width: 120 }}
                    />
                    <input value={draft?.email ?? (u.email ?? '')}
                      onChange={e => setUserDrafts(d => ({ ...d, [u.id]: { ...d[u.id], email: e.target.value } }))}
                      onBlur={() => saveUser(u.id)}
                      onKeyDown={e => { if (e.key === 'Enter') saveUser(u.id); if (e.key === 'Escape') setEditingUserId(null) }}
                      placeholder="email"
                      style={{ ...tinp, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', flex: 1 }}
                    />
                  </>
                ) : (
                  <>
                    <span onClick={() => startEditUser(u)} style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)', cursor: 'text', minWidth: 60 }}>{u.name}</span>
                    <span onClick={() => startEditUser(u)} style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', cursor: 'text', flex: 1 }}>
                      {u.email || <span style={{ color: 'var(--sb-border)' }}>+ email</span>}
                    </span>
                  </>
                )}

                <button onClick={() => removeUser(u.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-ink-3)', padding: 2, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                  <Trash2 size={ICON.sm} />
                </button>
              </div>
            )
          })}

          {/* Add user row */}
          <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
            <Plus size={ICON.sm} color="var(--sb-ink-3)" style={{ flexShrink: 0 }} />
            <input value={newUserName} onChange={e => setNewUserName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addUser() }}
              placeholder="Name"
              style={{ ...inputStyle, fontSize: 'var(--sb-t-meta)', padding: '3px 7px', width: 110 }} />
            <input value={newUserEmail} onChange={e => setNewUserEmail(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addUser() }}
              placeholder="Email (optional)"
              style={{ ...inputStyle, fontSize: 'var(--sb-t-meta)', padding: '3px 7px', flex: 1 }} />
            <button onClick={addUser} disabled={!newUserName.trim()} style={{
              padding: '3px 10px', borderRadius: 'var(--sb-r-chip)', fontSize: 'var(--sb-t-meta)', fontWeight: 500, cursor: 'pointer',
              background: 'rgba(var(--sb-accent-rgb),0.12)', border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-info) 31.4%, transparent)',
              color: 'var(--sb-info)', opacity: newUserName.trim() ? 1 : 0.4,
            }}>Add</button>
          </div>
        </div>
      )}
    </div>
  )
}

function CompaniesSection({
  companies, setCompanies, accounts, primaryEmail,
}: {
  companies: CompanyRow[]
  setCompanies: (c: CompanyRow[]) => void
  accounts: ConnectedAccount[]
  primaryEmail: string
}) {
  // The account you signed in with is not in `professor-connected-accounts` —
  // that list is the *additional* ones — so it was missing from this picker
  // entirely, and a company living on your own Google account could not be
  // linked to it. It is offered here under the id `primary`, which everything
  // downstream already understands: no entry in the accounts list means the
  // primary token, which is exactly what writing to your own calendar needs.
  const linkable: ConnectedAccount[] = primaryEmail
    ? [{
        id: 'primary', email: primaryEmail, name: '', providerToken: '',
        scopes: [], connectedAt: '', isPrimary: true,
      }, ...accounts]
    : accounts
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(C_COLORS[0])
  const [newDomain, setNewDomain] = useState('')
  const [newAccountId, setNewAccountId] = useState('')

  function persistCompanies(next: CompanyRow[]) {
    setCompanies(next)
    saveCompanies(next)
    saveCompaniesToDB(next as unknown as DbSyncCompanyRow[]).catch(e => console.error('[persistCompanies]', e))
  }

  function addCompany() {
    if (!newName.trim()) return
    persistCompanies([...companies, {
      id: crypto.randomUUID(), name: newName.trim(),
      color: newColor, calendarId: '', emailDomain: newDomain.trim(),
      accountId: newAccountId, isActive: true, users: [],
    }])
    setNewName(''); setNewDomain(''); setAdding(false)
  }

  function updateCompany(id: string, patch: Partial<CompanyRow>) {
    persistCompanies(companies.map(c => c.id === id ? { ...c, ...patch } : c))
  }

  function deleteCompany(id: string) {
    persistCompanies(companies.filter(c => c.id !== id))
  }

  return (
    <div>
      {companies.map(co => (
        <CompanyCard key={co.id} co={co} accounts={linkable}
          onUpdate={patch => updateCompany(co.id, patch)}
          onDelete={() => deleteCompany(co.id)} />
      ))}

      {adding ? (
        <div style={{ marginTop: 14, padding: '14px', background: 'var(--sb-field)', borderRadius: 'var(--sb-r-nav)', border: 'var(--sb-border-width) solid var(--sb-border)' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Company name"
              style={{ ...inputStyle, width: 160 }} autoFocus />
            <input value={newDomain} onChange={e => setNewDomain(e.target.value)} placeholder="@domain.com"
              style={{ ...inputStyle, width: 170 }} />
            {linkable.length > 0 && (
              <select value={newAccountId} onChange={e => setNewAccountId(e.target.value)} style={{ ...selectStyle, width: 180 }}>
                <option value="">No account</option>
                {linkable.map(a => <option key={a.id} value={a.id}>{a.isPrimary ? `${a.email} (this account)` : a.email}</option>)}
              </select>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {C_COLORS.map(c => (
              <button key={c} onClick={() => setNewColor(c)}
                style={{ width: 22, height: 22, borderRadius: 'var(--sb-r-pill)', background: c, border: 'none', cursor: 'pointer', outline: newColor === c ? `2px solid ${c}` : 'none', outlineOffset: 2 }} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setAdding(false); setNewName('') }}
              style={{ padding: '6px 14px', borderRadius: 'var(--sb-r-chip)', background: 'transparent', border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-body-s)', cursor: 'pointer', display: 'flex', gap: 5, alignItems: 'center' }}>
              <X size={ICON.sm} /> Cancel
            </button>
            <button onClick={addCompany} disabled={!newName.trim()}
              style={{ padding: '6px 16px', borderRadius: 'var(--sb-r-chip)', background: 'rgba(var(--sb-accent-rgb),0.12)', border: 'var(--sb-border-width) solid rgba(var(--sb-accent-rgb),0.31)', color: 'var(--sb-ink-1)', fontSize: 'var(--sb-t-body-s)', fontWeight: 500, cursor: 'pointer', opacity: newName.trim() ? 1 : 0.4, display: 'flex', gap: 5, alignItems: 'center' }}>
              <Plus size={ICON.sm} /> Add Company
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} style={{
          marginTop: 12, display: 'flex', alignItems: 'center', gap: 7, width: '100%',
          padding: '11px 16px', borderRadius: 'var(--sb-r-sm)', background: 'transparent',
          border: '1px dashed var(--sb-border)',
          color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-body)', cursor: 'pointer',
        }}>
          <Plus size={ICON.sm} /> Add a company / context
        </button>
      )}
    </div>
  )
}

/** Reads a picked file into a data URL, downscaled so localStorage can hold it. */
function readHabitImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('unreadable'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('not an image'))
      img.onload = () => {
        const MAX = 640
        const scale = Math.min(1, MAX / Math.max(img.width, img.height))
        const w = Math.round(img.width * scale)
        const h = Math.round(img.height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) { resolve(String(reader.result)); return }
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

/** The picture in a habit row: click it to swap the file, no form needed. */
function HabitRowImage({ image, emoji, onChange }: {
  image?: string
  emoji: string
  onChange: (v: string | undefined) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        onContextMenu={e => { if (image) { e.preventDefault(); onChange(undefined) } }}
        title={image ? 'Click to change the picture · right-click to remove it' : 'Click to add a picture'}
        style={{
          width: 30, height: 30, borderRadius: 'var(--sb-r-chip)', flexShrink: 0, padding: 0, overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)', cursor: 'pointer', fontSize: 'var(--sb-t-h3)',
        }}>
        {image
          ? <img src={image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          : emoji}
      </button>
      <input
        ref={ref} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={async e => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          try { onChange(await readHabitImage(file)) } catch { /* not a usable image */ }
        }} />
    </>
  )
}

interface SettingsHabitFormState {
  image?: string
  /** Set while editing an existing habit, so its step can be read and written. */
  id?: string
  name: string; emoji: string; color: string; freq: typeof FREQ_OPTS[number]
  type: 'boolean' | 'quantity'; goal: string; unit: string
  /** What one press adds. Blank means the sensible guess for the unit. */
  step: string
}

function SettingsHabitForm({
  initial, onSave, onCancel, saveLabel = 'Add Habit',
}: {
  initial: SettingsHabitFormState
  onSave: (s: SettingsHabitFormState) => void
  onCancel: () => void
  saveLabel?: string
}) {
  const [s, setS] = useState<SettingsHabitFormState>(initial)
  const update = (patch: Partial<SettingsHabitFormState>) => setS(prev => ({ ...prev, ...patch }))
  const imageRef = useRef<HTMLInputElement>(null)
  const valid = s.name.trim() !== '' && (s.type === 'boolean' || (parseFloat(s.goal) > 0 && s.unit.trim() !== ''))

  const LABEL: React.CSSProperties = {
    display: 'block', fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.12em',
    color: 'var(--sb-ink-3)', textTransform: 'uppercase', marginBottom: 7,
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 18, marginTop: 12,
      padding: 18, background: 'var(--sb-field)', borderRadius: 'var(--sb-r-nav)', border: 'var(--sb-border-width) solid var(--sb-border)',
    }}>

      {/* Picture, icon, name — the three things that identify a habit */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <button
              type="button"
              onClick={() => imageRef.current?.click()}
              title={s.image ? 'Change picture' : 'Add a picture'}
              style={{
                width: 46, height: 46, borderRadius: 'var(--sb-r-nav)', padding: 0, cursor: 'pointer', overflow: 'hidden',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 'var(--sb-t-h2)', color: 'var(--sb-ink-4)', background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
              }}>
              {s.image
                ? <img src={s.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                : <ImagePlus size={ICON.lg} />}
            </button>
            {s.image && (
              <button
                type="button"
                onClick={() => update({ image: undefined })}
                title="Remove picture"
                style={{
                  position: 'absolute', top: -5, right: -5, width: 18, height: 18, borderRadius: 'var(--sb-r-pill)',
                  padding: 0, cursor: 'pointer', background: 'var(--sb-ink-1)', border: 'var(--sb-border-emphasis) solid var(--sb-field)',
                  color: 'var(--sb-ink-on-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                <X size={ICON.sm} strokeWidth={STROKE.active} />
              </button>
            )}
          </span>
          <input
            ref={imageRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={async e => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              try { update({ image: await readHabitImage(file) }) } catch { /* not a usable image */ }
            }} />
          {!s.image && <span style={{ color: 'var(--sb-ink-4)', fontSize: 'var(--sb-t-micro)' }}>Picture</span>}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          <EmojiBtn value={s.emoji || '🎯'} onSelect={v => update({ emoji: v })} size={46} />
          <span style={{ color: 'var(--sb-ink-4)', fontSize: 'var(--sb-t-micro)' }}>Icon</span>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <input
            value={s.name}
            onChange={e => update({ name: e.target.value })}
            autoFocus
            placeholder="e.g. Drink water, Walk 5 miles…"
            onKeyDown={e => { if (e.key === 'Enter' && valid) onSave(s); if (e.key === 'Escape') onCancel() }}
            style={{
              width: '100%', boxSizing: 'border-box', height: 42, padding: '0 14px',
              background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-nav)',
              fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)', fontFamily: 'inherit', outline: 'none', textAlign: 'left',
            }} />
        </div>
      </div>

      {/* How it is tracked, and how often — one line, they belong together */}
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <span style={LABEL}>Type</span>
          <Segmented
            value={s.type}
            options={[
              { value: 'boolean' as const, label: 'Done / not done' },
              { value: 'quantity' as const, label: 'Measurable' },
            ]}
            onChange={t => update({ type: t })}
          />
        </div>
        <div style={{ minWidth: 0 }}>
          <span style={LABEL}>Interval</span>
          <Segmented
            value={s.freq}
            options={FREQ_OPTS.map(f => ({
              value: f,
              label: f === 'weekdays' ? 'Weekdays' : f.charAt(0).toUpperCase() + f.slice(1),
            }))}
            onChange={f => update({ freq: f })}
          />
        </div>
      </div>

      {/* What counts as a day's worth — a measurable habit only */}
      {s.type === 'quantity' && (
        <div>
          <span style={LABEL}>Daily target</span>
          <div style={{ display: 'flex', gap: 7 }}>
            <input type="number" min={1} value={s.goal} onChange={e => update({ goal: e.target.value })}
              placeholder="8"
              style={{
                width: 90, boxSizing: 'border-box', height: 'var(--sb-h-nav)', padding: '0 12px',
                background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-sm)',
                fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)', fontFamily: 'inherit', outline: 'none', textAlign: 'left',
              }} />
            <input value={s.unit} onChange={e => update({ unit: e.target.value })}
              placeholder="glasses / ml / minutes…"
              style={{
                flex: 1, minWidth: 0, boxSizing: 'border-box', height: 'var(--sb-h-nav)', padding: '0 12px',
                background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-sm)',
                fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)', fontFamily: 'inherit', outline: 'none', textAlign: 'left',
              }} />
          </div>

          {/* What one tap is worth. 200 ml counted one millilitre at a time is
              two hundred taps — nobody sets a habit up meaning that. */}
          <div style={{ marginTop: 10 }}>
            <span style={LABEL}>Each tap adds</span>
            <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
              <input type="number" min={1} value={s.step}
                onChange={e => update({ step: e.target.value })}
                placeholder={String(stepFor({ id: s.id ?? '', goal: Number(s.goal) || 0, unit: s.unit }))}
                style={{
                  width: 90, boxSizing: 'border-box', height: 'var(--sb-h-nav)', padding: '0 12px',
                  background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-sm)',
                  fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)', fontFamily: 'inherit', outline: 'none', textAlign: 'left',
                }} />
              <span style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>
                {s.unit || 'units'} per press
                {!s.step && ` · ${stepFor({ id: s.id ?? '', goal: Number(s.goal) || 0, unit: s.unit })} unless you say otherwise`}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, paddingTop: 2 }}>
        <button onClick={() => valid && onSave(s)} disabled={!valid}
          style={{
            height: 38, padding: '0 18px', borderRadius: 'var(--sb-r-pill)', border: 'none',
            background: valid ? 'var(--sb-accent)' : 'var(--sb-field)', color: valid ? 'var(--sb-accent-ink)' : 'var(--sb-ink-4)',
            fontSize: 'var(--sb-t-label)', fontWeight: 600, fontFamily: 'inherit',
            cursor: valid ? 'pointer' : 'default',
            display: 'flex', gap: 6, alignItems: 'center',
          }}>
          <Plus size={ICON.sm} /> {saveLabel}
        </button>
        <button onClick={onCancel}
          style={{
            height: 38, padding: '0 16px', borderRadius: 'var(--sb-r-pill)',
            background: 'transparent', border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-3)',
            fontSize: 'var(--sb-t-body)', fontFamily: 'inherit', cursor: 'pointer',
            display: 'flex', gap: 6, alignItems: 'center',
          }}>
          <X size={ICON.sm} /> Cancel
        </button>
      </div>
    </div>
  )
}

/** What a habit is, in one line: how it is tracked, how much, how often. */
function describeHabit(h: { type?: string; goal?: number; unit?: string; frequency: string }): string {
  const how = h.frequency === 'weekdays' ? 'on weekdays' : h.frequency === 'weekly' ? 'weekly' : 'daily'
  if (h.type !== 'quantity') return `Done or not · ${how}`
  if (h.goal && h.goal > 0) return `${h.goal} ${h.unit ?? 'times'} · ${how}`
  return `Counts ${h.unit ?? 'times'} · ${how}`
}

// ─── Settings → Habits → Apple Health ────────────────────────────────────────
//
// A web page cannot read Apple Health. HealthKit is native to iOS: no web API,
// no OAuth, nothing a browser can call — so this is not a connect button and
// pretending otherwise would waste your afternoon.
//
// What does work is the phone pushing. A Shortcut reads the sample and POSTs
// the number to a URL; an Automation runs it every morning without being
// opened. Each link is one habit, one metric, one secret URL — so the setup is
// a copy, a paste, and four taps in Shortcuts.

function AppleHealthBlock({ habits }: { habits: { id: string; name: string; unit?: string; type?: string }[] }) {
  const [links, setLinks]   = useState<HealthLink[] | null>(null)
  const [ready, setReady]   = useState(false)
  const [busy, setBusy]     = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [err, setErr]       = useState<string | null>(null)
  const [open, setOpen]     = useState<string | null>(null)
  const [check, setCheck]   = useState<Record<string, LinkCheck | 'checking'>>({})

  useEffect(() => { void loadHealthLinks().then(l => { setLinks(l); setReady(true) }) }, [])

  // Only where it means something. A habit called "Read 20 pages" has nothing
  // in Health to take.
  const movement = habits.filter(h => isMovementHabit(h.name, h.unit))

  async function add(habitId: string, metric: HealthMetric) {
    setBusy(habitId); setErr(null)
    try {
      const link = await createHealthLink(habitId, metric)
      setLinks(prev => [...(prev ?? []), link])
      setOpen(link.id)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not make the link.')
    } finally { setBusy(null) }
  }

  async function drop(id: string) {
    setBusy(id); setErr(null)
    try {
      await deleteHealthLink(id)
      setLinks(prev => (prev ?? []).filter(l => l.id !== id))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not remove it.')
    } finally { setBusy(null) }
  }

  function copy(text: string, id: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(id)
      window.setTimeout(() => setCopied(null), 1800)
    })
  }

  const pill = {
    height: 28, padding: '0 11px', borderRadius: 'var(--sb-r-chip)', cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 'var(--sb-t-body-s)', fontWeight: 600,
    background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-1)',
  } as const

  return (
    <div style={{ marginTop: 22, paddingTop: 18, borderTop: 'var(--sb-border-width) solid var(--sb-hairline)' }}>
      <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 700, letterSpacing: '0.12em', color: 'var(--sb-ink-3)', display: 'block', marginBottom: 10 }}>
        APPLE HEALTH
      </span>
      <p style={{ margin: '0 0 14px', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', lineHeight: 1.6, maxWidth: 660 }}>
        Apple gives a web app no way to read Health — HealthKit is native to the phone, with no web
        API to ask. What it does give is Shortcuts: your iPhone reads the number and sends it here
        each morning. Link a habit below and you get a private address to paste into a Shortcut;
        after that it fills itself in.
      </p>

      {movement.length === 0 ? (
        <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-4)', lineHeight: 1.6 }}>
          Nothing to link yet. Add a habit about walking, running, steps or distance and it appears
          here.
        </p>
      ) : !ready ? (
        <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-4)' }}>Looking…</p>
      ) : links === null ? (
        <div style={{
          fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-accent-deep)', lineHeight: 1.55, maxWidth: 720,
          background: 'var(--sb-accent-tint)', border: 'var(--sb-border-width) solid var(--sb-accent-border)', borderRadius: 'var(--sb-r-nav)', padding: '11px 14px',
        }}>
          Your database has nowhere to keep these yet — run{' '}
          <code style={{ fontFamily: 'var(--sb-font-mono)', fontSize: 'var(--sb-t-meta)' }}>supabase/migrations/20260012</code>{' '}
          and deploy the <code style={{ fontFamily: 'var(--sb-font-mono)', fontSize: 'var(--sb-t-meta)' }}>health-ingest</code> function,
          then reload.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 720 }}>
          {movement.map(h => {
            const link = links.find(l => l.habitId === h.id)
            const metric = link?.metric ?? suggestMetric(h.name, h.unit)
            return (
              <div key={h.id} style={{ border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-nav)', background: 'var(--sb-card)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 13px' }}>
                  <span style={{ fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-1)', flex: 1, minWidth: 0 }}>
                    {h.name}
                    <span style={{ fontWeight: 400, color: 'var(--sb-ink-4)' }}> · {METRIC_LABEL[metric]}</span>
                  </span>
                  {link ? (
                    <>
                      <span style={{ fontSize: 'var(--sb-t-meta)', color: link.lastSeenAt ? 'var(--sb-positive)' : 'var(--sb-ink-4)' }}>
                        {link.lastSeenAt
                          ? `last sent ${new Date(link.lastSeenAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
                          : 'nothing sent yet'}
                      </span>
                      <button style={pill} onClick={() => setOpen(open === link.id ? null : link.id)}>
                        {open === link.id ? 'Hide' : 'How to set it up'}
                      </button>
                      <button style={{ ...pill, color: 'var(--sb-negative)' }} disabled={busy === link.id}
                        onClick={() => void drop(link.id)}>Unlink</button>
                    </>
                  ) : (
                    <Button variant="primary" disabled={busy === h.id} onClick={() => void add(h.id, suggestMetric(h.name, h.unit))} style={{ ...pill }}>
                      {busy === h.id ? 'Linking…' : 'Link to Health'}
                    </Button>
                  )}
                </div>

                {link && open === link.id && (
                  <div style={{ borderTop: 'var(--sb-border-width) solid var(--sb-hairline)', padding: '12px 13px', background: 'var(--sb-header)' }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                      <code style={{
                        flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        fontFamily: 'var(--sb-font-mono)', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)',
                        background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-chip)', padding: '7px 9px',
                      }}>{ingestUrl(link.token) || 'This build has no Supabase address configured.'}</code>
                      <button style={pill} onClick={() => copy(ingestUrl(link.token), link.id)}>
                        {copied === link.id ? 'Copied' : 'Copy'}
                      </button>
                      {/* Three things have to be true before a step count can
                          arrive, and "nothing yet" tells you none of them. */}
                      <button style={pill}
                        onClick={async () => {
                          setCheck(c => ({ ...c, [link.id]: 'checking' }))
                          setCheck(c => ({ ...c, [link.id]: { ok: false, detail: '' } }))
                          const result = await checkHealthLink(link.token)
                          setCheck(c => ({ ...c, [link.id]: result }))
                        }}>
                        Check it
                      </button>
                    </div>
                    {check[link.id] && check[link.id] !== 'checking' && (check[link.id] as LinkCheck).detail && (
                      <p style={{
                        margin: '0 0 10px', fontSize: 'var(--sb-t-body-s)',
                        color: (check[link.id] as LinkCheck).ok ? 'var(--sb-positive)' : 'var(--sb-negative)', lineHeight: 1.5,
                      }}>
                        {(check[link.id] as LinkCheck).detail}
                      </p>
                    )}
                    <ol style={{ margin: 0, paddingLeft: 18, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', lineHeight: 1.75 }}>
                      <li>On the iPhone, open <b>Shortcuts</b> → <b>Automation</b> → <b>+</b> → <b>Time of Day</b>,
                        pick a time (10pm catches the whole day) and <b>Run Immediately</b>.</li>
                      <li>Add <b>Find Health Samples</b> — type <b>{METRIC_SAMPLE[link.metric]}</b>, sorted by
                        Start Date, and <b>Calculate Statistics</b> → <b>Sum</b> over <b>Today</b>.</li>
                      <li>Add <b>Get Contents of URL</b>, paste the address above, set <b>Method</b> to
                        <b> POST</b>, <b>Request Body</b> to <b>JSON</b>, and one field named{' '}
                        <code style={{ fontFamily: 'var(--sb-font-mono)', fontSize: 'var(--sb-t-meta)' }}>value</code>{' '}
                        holding the number from step 2.</li>
                      <li>Run it once by hand. The line above turns green when the first number lands.</li>
                    </ol>
                    <p style={{ margin: '10px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', lineHeight: 1.6 }}>
                      The address is the whole credential and it feeds this one habit — it can read nothing
                      and write nowhere else. Unlink to make it stop working.
                    </p>
                  </div>
                )}
              </div>
            )
          })}
          {err && <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-negative)' }}>{err}</p>}
        </div>
      )}
    </div>
  )
}

function HabitsSection() {
  const COLORS = getHabitColors()
  const { habits, addHabit: storeAdd, updateHabit, deleteHabit: storeDel } = useHabitsStore()
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [habitView, setHabitView] = useState<HabitView>(() => loadHabitView())

  function chooseView(v: HabitView) {
    setHabitView(v)
    saveHabitView(v)
    // The Habits page may already be mounted — let it re-read rather than wait
    window.dispatchEvent(new Event('professor:habitViewUpdated'))
  }

  function toggle(id: string) {
    const h = habits.find(x => x.id === id)
    if (h) updateHabit(id, { isActive: !h.isActive })
  }

  const editingHabit = editingId ? habits.find(h => h.id === editingId) : null

  return (
    <div>
      <p style={{ margin: '0 0 14px', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>
        Changes here instantly sync with the Habits Tracker page.
      </p>

      {/* Which view the Habits page opens on — switching it there sticks too */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', paddingBottom: 14, marginBottom: 4, borderBottom: 'var(--sb-border-width) solid var(--sb-border)' }}>
        <div style={{ flex: '1 1 150px', minWidth: 0, maxWidth: 200 }}>
          <div style={{ fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)' }}>Default view</div>
          <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', marginTop: 2 }}>
            {HABIT_VIEWS.find(v => v.id === habitView)?.hint}
          </div>
        </div>
        <div style={{ flex: '1 1 auto', display: 'flex', justifyContent: 'flex-end' }}>
          <Segmented
            value={habitView}
            options={HABIT_VIEWS.map(v => ({ value: v.id, label: v.label }))}
            onChange={chooseView}
          />
        </div>
      </div>

      {habits.map(h => (
        <div key={h.id}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '10px 0', borderBottom: 'var(--sb-border-width) solid var(--sb-border)',
            opacity: h.isActive ? 1 : 0.5,
          }}>
            <HabitRowImage
              image={h.image}
              emoji={h.emoji}
              onChange={img => updateHabit(h.id, { image: img })}
            />
            <div style={{ width: 10, height: 10, borderRadius: 'var(--sb-r-pill)', background: h.color, flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)' }}>{h.name}</span>
            <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', flexShrink: 0, whiteSpace: 'nowrap' }}>
              {describeHabit(h)}
            </span>
            <Toggle checked={h.isActive} onChange={() => toggle(h.id)} />
            <button onClick={() => setEditingId(editingId === h.id ? null : h.id)} title="Edit habit"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: editingId === h.id ? 'var(--sb-accent)' : 'var(--sb-ink-3)', padding: 4 }}>
              <Pencil size={ICON.sm} />
            </button>
            <button onClick={() => { if (editingId === h.id) setEditingId(null); storeDel(h.id) }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-ink-3)', padding: 4 }}>
              <Trash2 size={ICON.sm} />
            </button>
          </div>

          {/* Inline edit form */}
          {editingId === h.id && editingHabit && (
            <SettingsHabitForm
              key={h.id + '-edit'}
              initial={{
                id: h.id,
                name: h.name, emoji: h.emoji, color: h.color, image: h.image,
                freq: h.frequency as typeof FREQ_OPTS[number],
                type: h.type ?? 'boolean',
                goal: h.goal != null ? String(h.goal) : '',
                unit: h.unit ?? '',
                step: loadHabitSteps()[h.id] != null ? String(loadHabitSteps()[h.id]) : '',
              }}
              saveLabel="Save Changes"
              onSave={s => {
                updateHabit(h.id, {
                  name: s.name.trim(), emoji: s.emoji, color: s.color, image: s.image,
                  frequency: s.freq,
                  type: s.type,
                  goal: s.type === 'quantity' ? parseFloat(s.goal) : undefined,
                  unit: s.type === 'quantity' ? s.unit.trim() : undefined,
                })
                setHabitStep(h.id, s.type === 'quantity' && parseFloat(s.step) > 0 ? parseFloat(s.step) : null)
                setEditingId(null)
              }}
              onCancel={() => setEditingId(null)}
            />
          )}
        </div>
      ))}

      {adding ? (
        <SettingsHabitForm
          initial={{ name: '', emoji: '🎯', color: COLORS[habits.length % COLORS.length], freq: 'daily', type: 'boolean', goal: '', unit: '', step: '' }}
          onSave={s => {
            const made = storeAdd({
              name: s.name.trim(), emoji: s.emoji, color: s.color, image: s.image,
              frequency: s.freq, isActive: true,
              type: s.type,
              goal: s.type === 'quantity' ? parseFloat(s.goal) : undefined,
              unit: s.type === 'quantity' ? s.unit.trim() : undefined,
            })
            // addHabit hands back the new id, which is what the step is filed under.
            if (made && s.type === 'quantity' && parseFloat(s.step) > 0) setHabitStep(made, parseFloat(s.step))
            setAdding(false)
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button onClick={() => { setEditingId(null); setAdding(true) }} style={{
          marginTop: 12, display: 'flex', alignItems: 'center', gap: 7, width: '100%',
          padding: '11px 16px', borderRadius: 'var(--sb-r-sm)', background: 'transparent',
          border: '1px dashed var(--sb-border)',
          color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-body)', cursor: 'pointer',
        }}>
          <Plus size={ICON.sm} /> Add a habit
        </button>
      )}

      {/* Steps and distance can come from the phone rather than from you. */}
      <AppleHealthBlock habits={habits} />
    </div>
  )
}

// ─── Task Statuses Section ───────────────────────────────────────────────────


function TaskStatusesSection() {
  const [statuses, setStatuses] = useState<CustomStatus[]>(loadCustomStatuses)

  // The board can rename and reorder statuses too, so pick those changes up
  useEffect(() => {
    const h = () => setStatuses(loadCustomStatuses())
    window.addEventListener('professor:statusesUpdated', h)
    return () => window.removeEventListener('professor:statusesUpdated', h)
  }, [])
  const [editIdx, setEditIdx] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<{ id: string; label: string; color: string }>({ id: '', label: '', color: 'var(--sb-ink-3)' })

  function persist(next: CustomStatus[]) {
    setStatuses(next)
    saveCustomStatuses(next)
  }

  function startAdd() {
    setEditIdx(null)
    setDraft({ id: '', label: '', color: 'var(--sb-ink-3)' })
    setAdding(true)
  }

  function startEdit(i: number) {
    setAdding(false)
    setEditIdx(i)
    setDraft({ ...statuses[i] })
  }

  function confirmSave() {
    const id = draft.id.trim().toLowerCase().replace(/\s+/g, '-') || draft.label.trim().toLowerCase().replace(/\s+/g, '-')
    const label = draft.label.trim()
    if (!label || !id) return
    if (adding) {
      persist([...statuses, { id, label, color: draft.color }])
      setAdding(false)
    } else if (editIdx !== null) {
      const next = statuses.map((s, i) => i === editIdx ? { id, label, color: draft.color } : s)
      persist(next)
      setEditIdx(null)
    }
  }

  function remove(i: number) {
    persist(statuses.filter((_, idx) => idx !== i))
    if (editIdx === i) setEditIdx(null)
  }

  function move(from: number, to: number) {
    persist(moveStatus(statuses, from, to))
    setEditIdx(null)
  }

  // Drag a row onto another to reorder — the order here is the column order
  const dragIdx = useRef<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)

  function resetDefaults() {
    persist(DEFAULT_STATUSES)
    setEditIdx(null)
    setAdding(false)
  }

  const isEditingRow = (i: number) => editIdx === i && !adding

  const formEl = (
    <div style={{ padding: '10px 14px', background: 'var(--sb-field)', borderRadius: 'var(--sb-r-chip)', border: 'var(--sb-border-width) solid var(--sb-border)', marginTop: 4, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', marginBottom: 4, fontWeight: 600 }}>Label</div>
          <input value={draft.label} onChange={e => setDraft(p => ({ ...p, label: e.target.value }))}
            placeholder="e.g. In Review" autoFocus
            style={{ ...inputStyle, fontSize: 'var(--sb-t-body-s)' }}
            onKeyDown={e => { if (e.key === 'Enter') confirmSave(); if (e.key === 'Escape') { setAdding(false); setEditIdx(null) } }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', marginBottom: 4, fontWeight: 600 }}>ID (slug)</div>
          <input value={draft.id} onChange={e => setDraft(p => ({ ...p, id: e.target.value }))}
            placeholder="auto from label"
            style={{ ...inputStyle, fontSize: 'var(--sb-t-body-s)' }} />
        </div>
      </div>
      <div>
        <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', marginBottom: 6, fontWeight: 600 }}>Color</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {STATUS_COLORS_PRESETS.map(c => (
            <button key={c} onClick={() => setDraft(p => ({ ...p, color: c }))} style={{
              width: 22, height: 22, borderRadius: 'var(--sb-r-pill)', background: c, border: 'none', cursor: 'pointer',
              outline: draft.color === c ? `2px solid ${c}` : 'none', outlineOffset: 2,
            }} />
          ))}
          <input type="color" value={draft.color} onChange={e => setDraft(p => ({ ...p, color: e.target.value }))}
            style={{ width: 22, height: 22, border: 'none', borderRadius: 'var(--sb-r-pill)', padding: 0, cursor: 'pointer', background: 'transparent' }} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => { setAdding(false); setEditIdx(null) }}
          style={{ padding: '5px 12px', borderRadius: 'var(--sb-r-chip)', background: 'transparent', border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-body-s)', cursor: 'pointer', display: 'flex', gap: 4, alignItems: 'center' }}>
          <X size={ICON.sm} /> Cancel
        </button>
        <button onClick={confirmSave}
          style={{ padding: '5px 14px', borderRadius: 'var(--sb-r-chip)', background: 'rgba(var(--sb-accent-rgb),0.12)', border: 'var(--sb-border-width) solid rgba(var(--sb-accent-rgb),0.31)', color: 'var(--sb-ink-1)', fontSize: 'var(--sb-t-body-s)', fontWeight: 500, cursor: 'pointer', display: 'flex', gap: 4, alignItems: 'center' }}>
          <Plus size={ICON.sm} /> {adding ? 'Add Status' : 'Save'}
        </button>
      </div>
    </div>
  )

  return (
    <div>
      <p style={{ margin: '0 0 14px', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>
        Define custom board statuses. These appear as columns in the Status board and in the task detail dropdown.
      </p>

      {statuses.map((s, i) => (
        <div key={s.id + i}>
          <div
            draggable
            onDragStart={e => { dragIdx.current = i; e.dataTransfer.effectAllowed = 'move' }}
            onDragOver={e => { e.preventDefault(); if (dragIdx.current !== null && overIdx !== i) setOverIdx(i) }}
            onDragLeave={() => setOverIdx(o => (o === i ? null : o))}
            onDrop={e => {
              e.preventDefault()
              if (dragIdx.current !== null && dragIdx.current !== i) move(dragIdx.current, i)
              dragIdx.current = null
              setOverIdx(null)
            }}
            onDragEnd={() => { dragIdx.current = null; setOverIdx(null) }}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 0', borderBottom: 'var(--sb-border-width) solid var(--sb-border)',
              background: overIdx === i ? 'rgba(var(--sb-accent-rgb),0.10)' : 'transparent',
            }}>
            <span title="Drag to reorder" style={{ display: 'flex', color: 'var(--sb-ink-4)', cursor: 'grab', flexShrink: 0 }}>
              <GripVertical size={ICON.sm} />
            </span>
            <div style={{ width: 10, height: 10, borderRadius: 'var(--sb-r-pill)', background: s.color, flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)' }}>{s.label}</span>
            <span style={{ fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-3)', background: 'var(--sb-field)', padding: '2px 7px', borderRadius: 'var(--sb-r-chip)', border: 'var(--sb-border-width) solid var(--sb-border)' }}>
              {s.id}
            </span>
            <button onClick={() => startEdit(i)} title="Edit"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: isEditingRow(i) ? 'var(--sb-accent)' : 'var(--sb-ink-3)', padding: 4 }}>
              <Pencil size={ICON.sm} />
            </button>
            <button onClick={() => remove(i)} title="Delete"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-ink-3)', padding: 4 }}>
              <Trash2 size={ICON.sm} />
            </button>
          </div>
          {isEditingRow(i) && formEl}
        </div>
      ))}

      {adding && formEl}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button onClick={startAdd} style={{
          flex: 1, display: 'flex', alignItems: 'center', gap: 7,
          padding: '11px 16px', borderRadius: 'var(--sb-r-sm)', background: 'transparent',
          border: '1px dashed var(--sb-border)',
          color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-body)', cursor: 'pointer',
        }}>
          <Plus size={ICON.sm} /> Add a status
        </button>
        <button onClick={resetDefaults} title="Reset to defaults" style={{
          padding: '11px 14px', borderRadius: 'var(--sb-r-sm)', background: 'transparent',
          border: 'var(--sb-border-width) solid var(--sb-border)',
          color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-body-s)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 5,
        }}>
          <RefreshCw size={ICON.sm} /> Reset
        </button>
      </div>
    </div>
  )
}

// ─── CHUNK 5: Connected Accounts (multi-Google) ───────────────────────────────

/**
 *  What one account can reach, as read off its own token.
 *
 *  `active` has three values, and the third is the point. `null` is "we have
 *  not been able to ask" — a different thing from "not granted", and drawn
 *  differently, because only one of them has a button that would help. The
 *  badge used to be fed a hard-coded list that never mentioned Drive, so it
 *  showed **Grant** for ever: the tap did send you round the whole OAuth loop,
 *  Drive was in the request, Google did grant it, and the badge then wrote the
 *  same three strings back and looked exactly as it had before.
 */
function IntegrationBadge({ icon, label, active, fresh = true, onGrant }: {
  icon: ReactNode; label: string; active: boolean | null
  /** Read off the token just now, rather than off the last record of one. */
  fresh?: boolean
  onGrant?: () => void
}) {
  const tone = active === true ? 'var(--sb-positive)' : active === null ? 'var(--sb-ink-4)' : 'var(--sb-info)'
  const wash = active === true ? 'color-mix(in srgb, var(--sb-positive) 10.0%, transparent)'
             : active === null ? 'var(--sb-field)'
             : 'color-mix(in srgb, var(--sb-info) 10.0%, transparent)'
  const edge = active === true ? 'color-mix(in srgb, var(--sb-positive) 30.0%, transparent)'
             : active === null ? 'var(--sb-border)'
             : 'color-mix(in srgb, var(--sb-info) 25.0%, transparent)'
  return (
    <span
      title={active === null
        ? `We could not read this account's token just now, so we cannot say whether ${label} is granted. Granting again always settles it.`
        : active
          ? (fresh ? `${label} access is on this account's token`
                   : `${label} was on this account's last recorded grant — we could not read the token just now`)
          : (fresh ? `${label} is not on this account's token`
                   : `${label} was not on this account's last recorded grant — we could not read the token just now`)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '2px 7px', borderRadius: 'var(--sb-r-card)', fontSize: 'var(--sb-t-micro)', fontWeight: 500,
        background: wash, color: tone,
        // A dashed edge is the whole difference between "this token says so"
        // and "this is what it said last time we could ask".
        border: `var(--sb-border-width) ${fresh ? 'solid' : 'dashed'} ${edge}`,
      }}>
      {icon}{label}
      {active === null && <span style={{ opacity: 0.8 }}>?</span>}
      {active !== true && onGrant && (
        <button onClick={onGrant} style={{
          marginLeft: 3, background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--sb-ink-2)', fontSize: 'var(--sb-t-micro)', fontWeight: 600, padding: 0,
        }}>Grant</button>
      )}
    </span>
  )
}

function AccountsSection({
  accounts, setAccounts, primaryEmail, companies = [],
}: {
  accounts: ConnectedAccount[]
  setAccounts: (a: ConnectedAccount[]) => void
  primaryEmail: string
  /** Shown under each account so the link reads both ways. */
  companies?: CompanyRow[]
}) {
  const [adding, setAdding]         = useState(false)
  const [reconnecting, setRecon]    = useState<string | null>(null)
  const [calendars, setCalendars]   = useState<Record<string, string[]>>({})
  const [loadingCals, setLoading]   = useState<string | null>(null)
  const [needsReconnect, setNeedsReconnect] = useState<Set<string>>(new Set())
  const [hiddenAccts, setHiddenAccts] = useState<Set<string>>(loadHiddenAccounts)
  // DB account IDs from google_accounts — needed to call disconnectGoogleAccount
  const [serverAccounts, setServerAccounts] = useState<ServerAccount[]>([])

  useEffect(() => {
    loadAccountsFromServer().then(rows => { if (rows) setServerAccounts(rows) }).catch(() => {})
  }, [])

  function toggleAccountVisibility(email: string) {
    setHiddenAccts(prev => {
      const next = new Set(prev)
      if (next.has(email)) next.delete(email); else next.add(email)
      saveHiddenAccounts(next)
      window.dispatchEvent(new CustomEvent('professor:accountVisibilityChanged'))
      return next
    })
  }

  // Listen for cal:reconnect-required events dispatched by Cal Intel / tokenManager.
  // This is the only reliable signal that an account genuinely needs reconnection
  // (Edge Function returned reconnect_required). Local token age checks produce
  // false positives because the Edge Function auto-refreshes via google_refresh_token.
  useEffect(() => {
    const handler = (e: Event) => {
      const email = (e as CustomEvent<{ email: string }>).detail?.email
      if (email) setNeedsReconnect(prev => new Set([...prev, email]))
    }
    window.addEventListener('cal:reconnect-required', handler)
    return () => window.removeEventListener('cal:reconnect-required', handler)
  }, [])

  async function connectAdditional() {
    setAdding(true)
    try {
      await connectAdditionalGoogleAccount()
    } catch { setAdding(false) }
  }

  async function reconnectAccount(acc: ConnectedAccount) {
    setRecon(acc.id)
    // What we measured is about the grant we are replacing.
    forgetScopes(acc.email)
    try {
      await connectAdditionalGoogleAccount(acc.email)
    } catch { setRecon(null) }
  }

  async function loadCalendars(acc: ConnectedAccount) {
    setLoading(acc.id)
    // Use getProviderTokenForAccount to get a fresh token (auto-refreshes if stale)
    const token = acc.isPrimary
      ? (localStorage.getItem('google_provider_token') ?? acc.providerToken)
      : (await getProviderTokenForAccount(acc) ?? acc.providerToken)
    const cals = await fetchGCals(token)
    setCalendars(prev => ({ ...prev, [acc.id]: cals.map(c => c.summary) }))
    setLoading(null)
  }

  function removeAcc(id: string) {
    // Remove from localStorage immediately (optimistic)
    removeAccount(id)
    const updated = loadAccounts()
    setAccounts(updated)
    // Remove from DB via edge function (uses server account_id, looked up by email)
    const localAcc = loadAccounts().find(a => a.id === id) ?? accounts.find(a => a.id === id)
    const serverAcc = localAcc
      ? serverAccounts.find(s => s.email === localAcc.email)
      : undefined
    if (serverAcc) {
      void disconnectGoogleAccount(serverAcc.id)
        .then(() => setServerAccounts(prev => prev.filter(s => s.id !== serverAcc.id)))
    }
    saveAccountsToDB(updated).catch(console.warn)
  }

  // Primary account row (from Supabase session)
  const primaryToken = localStorage.getItem('google_provider_token') ?? ''

  /**
   *  What each account's token actually carries, asked of Google rather than
   *  assumed. `undefined` while the question is out, `null` where it could not
   *  be answered — the badges draw those two differently, and only one of them
   *  offers a button.
   */
  const [grantsBy, setGrantsBy] = useState<Record<string, { scopes: string[]; live: boolean } | null>>({})
  useEffect(() => {
    let live = true
    const put = (email: string, v: { scopes: string[]; live: boolean } | null) => {
      if (live) setGrantsBy(g => ({ ...g, [email.toLowerCase()]: v }))
    }
    const ask = async () => {
      const targets: { email: string; token: string }[] = []
      if (primaryEmail) {
        // The copy in localStorage goes stale in about an hour, and a stale
        // token makes tokeninfo answer 400 — which read as "we cannot say" on
        // an account that had granted everything. The live session holds a
        // fresher one whenever there is one.
        const { data } = await supabase.auth.getSession()
        targets.push({ email: primaryEmail, token: data.session?.provider_token || primaryToken })
      }
      for (const a of accounts) {
        targets.push({ email: a.email, token: a.providerToken || (await getProviderTokenForAccount(a)) || '' })
      }
      for (const { email, token } of targets) {
        const known = cachedScopes(email)
        if (known && !scopesAreStale(email)) { put(email, { scopes: known, live: true }); continue }
        const sc = token ? await readScopes(email, token) : null
        if (!live) continue
        if (sc) { put(email, { scopes: sc, live: true }); setAccountScopes(email, sc); continue }
        // No live reading. Last measurement first, then what the server has on
        // record from the last one — both are records of a real consent, and
        // saying nothing about an account that plainly works is worse than
        // saying what it was last known to carry.
        const recorded = known
          ?? accounts.find(a => a.email.toLowerCase() === email.toLowerCase())?.scopes
          ?? serverAccounts.find(a => a.email.toLowerCase() === email.toLowerCase())?.scopes
          ?? null
        put(email, recorded && recorded.length ? { scopes: recorded, live: false } : null)
      }
    }
    void ask()
    return () => { live = false }
  }, [accounts, serverAccounts, primaryEmail, primaryToken])

  /** True / false / null — see IntegrationBadge. */
  const can = (email: string, part: string): boolean | null => {
    const hit = grantsBy[email.toLowerCase()]
    return hit == null ? null : hit.scopes.some(x => x.includes(part))
  }
  /** Whether that answer came from the token just now, or off a record. */
  const fresh = (email: string): boolean => !!grantsBy[email.toLowerCase()]?.live

  return (
    <div>

      {/* Primary account */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 14px', borderRadius: 'var(--sb-r-nav)', marginBottom: 10,
        background: 'var(--sb-field)',
        border: 'var(--sb-border-width) solid rgba(var(--sb-accent-rgb),0.19)',
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: 'var(--sb-r-pill)', flexShrink: 0,
          background: 'rgba(var(--sb-accent-rgb),0.12)', border: 'var(--sb-border-width) solid rgba(var(--sb-accent-rgb),0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--sb-t-label)', fontWeight: 700, color: 'var(--sb-ink-1)',
        }}>
          {primaryEmail ? primaryEmail[0].toUpperCase() : 'G'}
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontSize: 'var(--sb-t-label)', fontWeight: 500, color: 'var(--sb-ink-1)' }}>{primaryEmail || 'Primary Google Account'}</p>
          <div style={{ margin: '5px 0 0', display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {/* These read `active` unconditionally — three badges that were
                green whatever the token carried. The primary account is the
                one you signed in with, but signing in is not consent to
                everything, and a stale grant is exactly what the row should
                say. */}
            <IntegrationBadge icon={<CalendarDays size={ICON.sm} />} label="Calendar" active={can(primaryEmail, 'calendar')} fresh={fresh(primaryEmail)}
              onGrant={() => { forgetScopes(primaryEmail); void signInWithGoogle() }} />
            <IntegrationBadge icon={<Mail size={ICON.sm} />} label="Gmail" active={can(primaryEmail, 'gmail')} fresh={fresh(primaryEmail)}
              onGrant={() => { forgetScopes(primaryEmail); void signInWithGoogle() }} />
            <IntegrationBadge icon={<HardDrive size={ICON.sm} />} label="Drive" active={can(primaryEmail, 'drive')} fresh={fresh(primaryEmail)}
              onGrant={() => { forgetScopes(primaryEmail); void signInWithGoogle() }} />
          </div>
        </div>
        <span style={{ fontSize: 'var(--sb-t-micro)', padding: '3px 10px', borderRadius: 'var(--sb-r-card)', background: 'color-mix(in srgb, var(--sb-positive) 10.0%, transparent)', color: 'var(--sb-positive)', border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-positive) 20.0%, transparent)' }}>
          Active
        </span>
        {primaryToken && (
          <button onClick={() => loadCalendars({ id: 'primary', email: primaryEmail, name: '', providerToken: primaryToken, scopes: [], connectedAt: '', isPrimary: true })}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-ink-3)', padding: 4, display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--sb-t-meta)' }}
            title="Load calendars">
            <RefreshCw size={ICON.sm} style={{ animation: loadingCals === 'primary' ? 'spin 1s linear infinite' : 'none' }} />
          </button>
        )}
        <button onClick={() => void googleSignOut()}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-negative)', padding: 4, display: 'flex', alignItems: 'center' }}
          title="Sign out">
          <LogOut size={ICON.sm} />
        </button>
      </div>

      {/* Show primary calendars */}
      {calendars['primary'] && (
        <div style={{ marginBottom: 12, padding: '8px 14px', background: 'var(--sb-field)', borderRadius: 'var(--sb-r-chip)', border: 'var(--sb-border-width) solid var(--sb-border)' }}>
          <p style={{ margin: '0 0 6px', fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: 'var(--sb-ink-3)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Calendars in this account</p>
          {calendars['primary'].map(name => (
            <p key={name} style={{ margin: '3px 0', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>• {name}</p>
          ))}
        </div>
      )}

      {/* Additional connected accounts — show ALL stored accounts with delete */}
      {accounts.map(acc => {
        const isStale = needsReconnect.has(acc.email)
        const isRecon = reconnecting === acc.id
        return (
          <div key={acc.id} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 14px', borderRadius: 'var(--sb-r-nav)', marginBottom: 8,
            background: 'var(--sb-field)',
            border: `var(--sb-border-width) solid ${isStale ? 'color-mix(in srgb, var(--sb-warning) 35.0%, transparent)' : 'var(--sb-border)'}`,
            opacity: hiddenAccts.has(acc.email) ? 0.5 : 1,
            transition: 'opacity 0.15s',
          }}>
            <div style={{ width: 32, height: 32, borderRadius: 'var(--sb-r-pill)', flexShrink: 0, background: 'rgba(var(--sb-accent-rgb),0.12)', border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-info) 25.1%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--sb-t-label)', fontWeight: 700, color: 'var(--sb-info)' }}>
              {acc.email ? acc.email[0].toUpperCase() : 'G'}
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontSize: 'var(--sb-t-label)', fontWeight: 500, color: 'var(--sb-ink-1)' }}>{acc.email || acc.name}</p>
              {(() => {
                const linked = companies.filter(c => c.accountId === acc.id)
                if (linked.length === 0) {
                  return <p style={{ margin: '3px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)' }}>No company uses this account yet</p>
                }
                return (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, margin: '5px 0 0' }}>
                    {linked.map(c => (
                      <span key={c.id} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        padding: '2px 8px', borderRadius: 'var(--sb-r-pill)',
                        background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
                        fontSize: 'var(--sb-t-micro)', fontWeight: 600, color: 'var(--sb-ink-3)',
                      }}>
                        <span style={{ width: 6, height: 6, borderRadius: 'var(--sb-r-pill)', background: c.color }} />
                        {c.name}
                      </span>
                    ))}
                  </div>
                )
              })()}
              {isStale ? (
                <p style={{ margin: '2px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-warning)' }}>⚠ Access lost — reconnect to restore</p>
              ) : (
                <div style={{ margin: '5px 0 0', display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                  <IntegrationBadge icon={<CalendarDays size={ICON.sm} />} label="Calendar" active={can(acc.email, 'calendar')} fresh={fresh(acc.email)}
                    onGrant={() => void reconnectAccount(acc)} />
                  <IntegrationBadge icon={<Mail size={ICON.sm} />} label="Gmail" active={can(acc.email, 'gmail')} fresh={fresh(acc.email)}
                    onGrant={() => void reconnectAccount(acc)} />
                  <IntegrationBadge icon={<HardDrive size={ICON.sm} />} label="Drive" active={can(acc.email, 'drive')} fresh={fresh(acc.email)}
                    onGrant={() => void reconnectAccount(acc)} />
                </div>
              )}
            </div>
            {isStale ? (
              <button
                onClick={() => void reconnectAccount(acc)}
                disabled={isRecon}
                style={{
                  padding: '4px 10px', borderRadius: 'var(--sb-r-chip)', fontSize: 'var(--sb-t-meta)', fontWeight: 600, cursor: isRecon ? 'wait' : 'pointer',
                  background: 'color-mix(in srgb, var(--sb-warning) 12.0%, transparent)', border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-warning) 40.0%, transparent)', color: 'var(--sb-warning)',
                  display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
                }}
              >
                <RefreshCw size={ICON.sm} style={{ animation: isRecon ? 'spin 1s linear infinite' : 'none' }} />
                {isRecon ? 'Redirecting…' : 'Reconnect'}
              </button>
            ) : (
              <button onClick={() => void loadCalendars(acc)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-ink-3)', padding: 4, display: 'flex' }} title="Load calendars">
                <RefreshCw size={ICON.sm} style={{ animation: loadingCals === acc.id ? 'spin 1s linear infinite' : 'none' }} />
              </button>
            )}
            <button
              onClick={() => toggleAccountVisibility(acc.email)}
              title={hiddenAccts.has(acc.email) ? 'Show in Calendar' : 'Hide from Calendar'}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', color: hiddenAccts.has(acc.email) ? 'var(--sb-ink-3)' : 'var(--sb-ink-3)' }}
            >
              {hiddenAccts.has(acc.email) ? <EyeOff size={ICON.sm} /> : <Eye size={ICON.sm} />}
            </button>
            <button onClick={() => removeAcc(acc.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-negative)', padding: 4, display: 'flex' }}>
              <Trash2 size={ICON.sm} />
            </button>
          </div>
        )
      })}

      {/* Show calendars for additional accounts */}
      {accounts.map(acc => calendars[acc.id] ? (
        <div key={`${acc.id}-cals`} style={{ marginBottom: 8, padding: '8px 14px', background: 'var(--sb-field)', borderRadius: 'var(--sb-r-chip)', border: 'var(--sb-border-width) solid var(--sb-border)' }}>
          <p style={{ margin: '0 0 6px', fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: 'var(--sb-ink-3)', textTransform: 'uppercase' }}>{acc.email} calendars</p>
          {calendars[acc.id].map(name => <p key={name} style={{ margin: '3px 0', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>• {name}</p>)}
        </div>
      ) : null)}

      {/* Add account button + Remove all */}
      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
        <button onClick={() => void connectAdditional()} disabled={adding}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 8,
            padding: '12px 16px', borderRadius: 'var(--sb-r-sm)',
            background: 'var(--sb-field)',
            border: '1px dashed var(--sb-border)',
            color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-body)', fontWeight: 500, cursor: 'pointer',
            opacity: adding ? 0.6 : 1,
          }}>
          <LogIn size={ICON.sm} />
          {adding ? 'Connecting…' : '+ Connect another Google account'}
        </button>

        {accounts.length > 0 && (
          <button
            onClick={() => {
              accounts.forEach(a => removeAccount(a.id))
              const updated = loadAccounts()
              setAccounts(updated)
              saveAccountsToDB(updated).catch(console.warn)
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '12px 14px', borderRadius: 'var(--sb-r-sm)',
              background: 'color-mix(in srgb, var(--sb-negative) 6.0%, transparent)',
              border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-negative) 25.0%, transparent)',
              color: 'var(--sb-negative)', fontSize: 'var(--sb-t-body-s)', fontWeight: 500, cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            <Trash2 size={ICON.sm} />
            Remove all
          </button>
        )}
      </div>

      <p style={{ margin: '10px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.55 }}>
        Connected accounts grant Calendar, Gmail, and Drive access for aggregation and triage. Tokens are stored securely on the server — never in the browser. Re-authorize any account to upgrade its permissions.
      </p>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

// ─── CHUNK 6: Professor AI + Notifications + Appearance sections ──────────────

export const GROQ_MODELS = [
  { value: 'llama-3.3-70b-versatile',  label: 'LLaMA 3.3 70B (best quality)' },
  { value: 'llama-3.1-8b-instant',     label: 'LLaMA 3.1 8B (fastest)'       },
  { value: 'mixtral-8x7b-32768',       label: 'Mixtral 8x7B'                  },
]

function ProfessorSection() {
  const [ai, setAIRaw] = useState<AIConfig>(loadAIConfig)
  const [showKey, setShowKey] = useState(false)
  const [autonomy, setAutonomy] = useState<'suggest' | 'draft' | 'act'>('suggest')
  const [mailDrafts, setMailDrafts] = useState(true)
  const [matrixSuggest, setMatrixSuggest] = useState(true)
  const [autoBuild, setAutoBuild] = useState(false)
  const [learnEdits, setLearnEdits] = useState(true)

  function setAI(patch: Partial<AIConfig>) {
    const next = { ...ai, ...patch }
    setAIRaw(next)
    saveAIConfig(next)
  }

  const activeKey = ai.provider === 'groq' ? ai.groqKey : ai.anthropicKey
  const keyLabel  = ai.provider === 'groq' ? 'Groq API key' : 'Anthropic API key'
  const keyHint   = ai.provider === 'groq' ? 'Free at console.groq.com' : 'console.anthropic.com (paid)'

  return (
    <div>
      {/* ── Model ── */}
      <FieldRow label="Model" sub="Handles the brief, drafts and matrix suggestions">
        <Segmented
          size="sm"
          aria-label="Model"
          value={ai.provider}
          onChange={v => setAI({ provider: v as AIConfig['provider'] })}
          options={[
            { value: 'anthropic', label: 'Sonnet 4.5' },
            { value: 'groq',      label: 'Opus 4.1' },
            { value: 'haiku',     label: 'Haiku' },
          ]}
        />
      </FieldRow>

      {/* ── API key ── */}
      <FieldRow label={keyLabel} sub={keyHint}>
        <div style={{ display: 'flex', gap: 6, width: '100%' }}>
          <input type={showKey ? 'text' : 'password'} value={activeKey}
            onChange={e => setAI(ai.provider === 'groq' ? { groqKey: e.target.value } : { anthropicKey: e.target.value })}
            placeholder={ai.provider === 'groq' ? 'gsk_...' : 'sk-ant-...'}
            style={{ ...inputStyle, flex: 1, fontFamily: 'monospace', fontSize: 'var(--sb-t-meta)' }} />
          <button onClick={() => setShowKey(v => !v)} style={{ background: 'transparent', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-chip)', padding: '4px 8px', cursor: 'pointer', color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-meta)', flexShrink: 0 }}>
            {showKey ? <EyeOff size={ICON.sm} /> : <Eye size={ICON.sm} />}
          </button>
        </div>
      </FieldRow>

      <div style={{ height: 6, borderTop: 'var(--sb-border-width) solid var(--sb-hairline)', marginTop: 12, marginBottom: 12 }} />

      {/* ── Autonomy ── */}
      <FieldRow label="Autonomy" sub="How far the assistant may act before asking you">
        <Segmented
          size="sm"
          aria-label="Autonomy"
          value={autonomy}
          onChange={setAutonomy}
          options={[
            { value: 'suggest' as const, label: 'Suggest' },
            { value: 'draft'   as const, label: 'Draft & hold' },
            { value: 'act'     as const, label: 'Act' },
          ]}
        />
      </FieldRow>

      {/* ── Behaviour toggles ── */}
      <FieldRow label="Write mail drafts" sub="Prepares a reply for every thread that needs one">
        <Toggle checked={mailDrafts} onChange={setMailDrafts} />
      </FieldRow>
      <FieldRow label="Suggest matrix placement" sub="Reads task attributes and fills the missing ones">
        <Toggle checked={matrixSuggest} onChange={setMatrixSuggest} />
      </FieldRow>
      <FieldRow label="Auto-build the day" sub="Turns the brief into calendar blocks without confirmation">
        <Toggle checked={autoBuild} onChange={setAutoBuild} />
      </FieldRow>
      <FieldRow label="Learn from my edits" sub="Every correction tunes future drafts and placements">
        <Toggle checked={learnEdits} onChange={setLearnEdits} />
      </FieldRow>
    </div>
  )
}

/** 11B splits out the half of the AI card that is about voice and standing
 *  instructions, so neither half has to be squeezed into one column. */
function AIVoiceSection({ s, set }: { s: AppSettings; set: (p: Partial<AppSettings>) => void }) {
  const [toneOfVoice, setToneOfVoice] = useState('Direct, no filler')

  return (
    <div>
      <FieldRow label="Tone of voice" sub="Applies to drafts, the brief and the review">
        <select value={toneOfVoice} onChange={e => setToneOfVoice(e.target.value)} style={{ ...selectStyle, minWidth: 160 }}>
          {['Direct, no filler', 'Warm and encouraging', 'Formal', 'Casual'].map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </FieldRow>

      <div style={{ height: 6, borderTop: 'var(--sb-border-width) solid var(--sb-hairline)', marginTop: 12, marginBottom: 12 }} />
      <FieldRow label="Proactive" sub="Offers advice unprompted">
        <Toggle checked={s.proactive} onChange={v => set({ proactive: v })} />
      </FieldRow>
      <FieldRow label="Morning brief time">
        <input type="time" value={s.briefTime} onChange={e => set({ briefTime: e.target.value })} style={{ ...inputStyle, width: 118 }} />
      </FieldRow>
      <FieldRow label="Custom instructions" sub="Personality & priorities">
        <textarea value={s.customInstructions} onChange={e => set({ customInstructions: e.target.value })}
          rows={3} placeholder="e.g. Always be concise. Prioritise Teradix work…"
          style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5, width: '100%' }} />
      </FieldRow>

      <p style={{ margin: '14px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)' }}>Your mail and tasks are never used to train the model.</p>
    </div>
  )
}

// NotificationsSection merged into NotificationsMatrixSection (Push/Mail/Digest per event)
// Legacy reminder fields (morning brief time, wind-down) are now in the AI / Schedule sections.

function AppearanceSection({ s, set }: { s: AppSettings; set: (p: Partial<AppSettings>) => void }) {
  const { setThemeId } = useUIStore()
  const [accent, setAccent] = useState(() => loadAccent())
  const [compact, setCompact] = useState(() => loadCompact())

  function pickTheme(id: string) {
    set({ theme: id })
    setThemeId(id)
    applyAppearance({ themeId: id })
  }

  function pickAccent(id: string) {
    setAccent(id)
    saveAccent(id)          // written and announced; lib/themes.ts applies it
  }

  return (
    <div>
      {/* ── Accent ───────────────────────────────────────────────────────────
          The one colour the whole app shares: every chip, bar, highlight and
          today-marker is drawn in it. It changes as you click. */}
      <div style={{ paddingBottom: 16, borderBottom: 'var(--sb-border-width) solid var(--sb-border)', marginBottom: 14 }}>
        <p style={{ margin: '0 0 3px', fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-1)' }}>Accent</p>
        <p style={{ margin: '0 0 11px', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', lineHeight: 1.5 }}>
          Every highlight in the app — chips, bars, the ring on today.
        </p>
        <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
          {/* "None" is the default and it is not a colour: it means the theme's
              own accent, which is the one its surfaces and tints were built
              around. Picking one of the six overrides it everywhere. */}
          <button onClick={() => pickAccent('')} title="The theme's own accent"
            aria-pressed={accent === ''}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, height: 38, padding: '0 14px 0 10px',
              borderRadius: 'var(--sb-r-pill)', cursor: 'pointer', fontFamily: 'inherit',
              background: accent === '' ? 'var(--sb-card)' : 'var(--sb-field)',
              border: `var(--sb-border-width) solid ${accent === '' ? 'var(--sb-ink-1)' : 'var(--sb-border)'}`,
              boxShadow: accent === '' ? 'var(--sb-shadow-control)' : 'none',
              color: 'var(--sb-ink-1)', fontSize: 'var(--sb-t-body-s)', fontWeight: accent === '' ? 600 : 500,
            }}>
            <span style={{
              width: 18, height: 18, borderRadius: 'var(--sb-r-pill)', flexShrink: 0,
              background: 'var(--sb-accent)', border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-ink-1) 12.0%, transparent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {accent === '' && <Check size={ICON.sm} strokeWidth={STROKE.active} color="var(--sb-accent-ink)" />}
            </span>
            Theme's own
          </button>
          {ACCENTS.map(a => {
            const on = accent === a.id
            return (
              <button key={a.id} onClick={() => pickAccent(a.id)} title={a.name}
                aria-pressed={on}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, height: 38, padding: '0 14px 0 10px',
                  borderRadius: 'var(--sb-r-pill)', cursor: 'pointer', fontFamily: 'inherit',
                  background: on ? 'var(--sb-card)' : 'var(--sb-field)',
                  border: `var(--sb-border-width) solid ${on ? 'var(--sb-ink-1)' : 'var(--sb-border)'}`,
                  boxShadow: on ? '0 1px 3px color-mix(in srgb, var(--sb-ink-1) 16.0%, transparent)' : 'none',
                  color: 'var(--sb-ink-1)', fontSize: 'var(--sb-t-body-s)', fontWeight: on ? 600 : 500,
                }}>
                <span style={{
                  width: 18, height: 18, borderRadius: 'var(--sb-r-pill)', flexShrink: 0,
                  background: a.hex, border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-ink-1) 12.0%, transparent)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {on && <Check size={ICON.sm} strokeWidth={STROKE.active} color="var(--sb-ink-1)" />}
                </span>
                {a.name}
              </button>
            )
          })}
        </div>
      </div>

      <FieldRow label="Compact density" sub={`Everything ${Math.round((1 - COMPACT_SCALE) * 100)}% smaller, so more fits on screen`}>
        <Toggle checked={compact} onChange={v => { setCompact(v); saveCompact(v); set({ compact: v }) }} />
      </FieldRow>

      {/* ── Theme ────────────────────────────────────────────────────────────
          Each tile is the theme itself: its page behind, its card on top, its
          ink as the two lines of text a card actually holds, and its accent as
          the mark on it — drawn from the same tokens the app will be drawn
          from, so what you see is what you get rather than an artist's
          impression of it. The name is set in the theme's own display face,
          which is the other half of what changes. */}
      <div style={{ paddingTop: 16, borderTop: 'var(--sb-border-width) solid var(--sb-border)', marginTop: 6 }}>
        <p style={{ margin: '0 0 3px', fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-1)' }}>Theme</p>
        <p style={{ margin: '0 0 11px', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', lineHeight: 1.5 }}>
          Surfaces, ink, accent and typeface, for the whole app.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
          {THEMES.map(t => {
            const active = resolveThemeId(s.theme) === t.id
            const tk = t.tokens
            return (
              <button key={t.id} onClick={() => pickTheme(t.id)} aria-pressed={active}
                style={{
                  padding: 0, cursor: 'pointer', textAlign: 'left', overflow: 'hidden',
                  borderRadius: 'var(--sb-r-nav)', background: tk['--sb-page'],
                  border: `var(--sb-border-emphasis) solid ${active ? 'var(--sb-ink-1)' : 'var(--sb-border)'}`,
                  boxShadow: active ? 'var(--sb-shadow-control)' : 'none',
                  fontFamily: 'inherit',
                }}>
                {/* The card, on the page, with what a card holds. */}
                <div style={{ padding: 11 }}>
                  <div style={{
                    background: tk['--sb-card'], border: `var(--sb-border-width) solid ${tk['--sb-border']}`,
                    borderRadius: 'var(--sb-r-chip)', padding: 9,
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <span style={{ display: 'block', height: 6, width: '78%', borderRadius: 'var(--sb-r-pill)', background: tk['--sb-ink-1'] }} />
                      <span style={{ display: 'block', height: 5, width: '52%', borderRadius: 'var(--sb-r-pill)', background: tk['--sb-ink-3'] }} />
                    </div>
                    <span style={{
                      flexShrink: 0, height: 20, padding: '0 8px', borderRadius: 'var(--sb-r-pill)',
                      background: tk['--sb-accent'], color: tk['--sb-accent-ink'],
                      display: 'inline-flex', alignItems: 'center',
                      fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.08em',
                      fontFamily: tk['--sb-font-ui'],
                    }}>AA</span>
                  </div>
                </div>
                {/* The name, in the face the theme speaks in. */}
                <div style={{
                  padding: '0 12px 11px', display: 'flex', alignItems: 'center', gap: 6,
                  color: tk['--sb-ink-1'], fontFamily: tk['--sb-font-num'],
                  fontSize: 'var(--sb-t-body)', fontWeight: 600, letterSpacing: '-0.01em',
                }}>
                  {t.name}
                  {active && <Check size={ICON.sm} strokeWidth={STROKE.active} color={tk['--sb-ink-1']} />}
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── CHUNK 6b: Productivity Blocking section ─────────────────────────────────

const DETAIL_LEVELS: { value: DetailLevel; label: string; desc: string }[] = [
  { value: 'busy',         label: 'Busy',         desc: 'Just marks time as unavailable' },
  { value: 'focus_time',   label: 'Focus Time',   desc: 'Shows "Focus Time" + source cal name' },
  { value: 'full_details', label: 'Full Details',  desc: 'Copies title, description & location' },
]

const DETAIL_BADGE: Record<DetailLevel, { bg: string; color: string }> = {
  busy:         { bg: 'color-mix(in srgb, var(--sb-negative) 12.0%, transparent)',   color: 'var(--sb-negative)' },
  focus_time:   { bg: 'color-mix(in srgb, var(--sb-positive) 12.0%, transparent)',  color: 'var(--sb-positive)' },
  full_details: { bg: 'color-mix(in srgb, var(--sb-info) 12.0%, transparent)',   color: 'var(--sb-info)' },
}

function BlockingRulesSection() {
  const [rules, setRulesState]     = useState<BlockingRule[]>(loadBlockingRules)
  const [cals, setCals]            = useState<CachedCalEntry[]>([])
  const [showForm, setShowForm]    = useState(false)
  const [editingRule, setEditingRule] = useState<BlockingRule | null>(null)

  // Form state (used for both add and edit)
  const [srcCal,     setSrcCal]    = useState('')
  const [tgtCal,     setTgtCal]    = useState('')
  const [detail,     setDetail]    = useState<DetailLevel>('busy')
  const [autoApply,   setAutoApply]  = useState(false)
  const [hideBlocked, setHideBlocked] = useState(false)

  useEffect(() => {
    setCals(loadCachedCalendars())
  }, [])

  function saveRules(updated: BlockingRule[]) {
    saveBlockingRules(updated)
    setRulesState(updated)
  }

  function resetForm() {
    setSrcCal(''); setTgtCal(''); setDetail('busy'); setAutoApply(false); setHideBlocked(false)
    setShowForm(false); setEditingRule(null)
  }

  function openEdit(rule: BlockingRule) {
    setCals(loadCachedCalendars())
    setSrcCal(rule.sourceCalendarId)
    setTgtCal(rule.targetCalendarId)
    setDetail(rule.detailLevel)
    setAutoApply(rule.autoApply)
    setHideBlocked(rule.hideBlocked)
    setEditingRule(rule)
    setShowForm(true)
  }

  function saveForm() {
    if (!srcCal || !tgtCal || srcCal === tgtCal) return
    const srcEntry = cals.find(c => c.id === srcCal)
    const tgtEntry = cals.find(c => c.id === tgtCal)
    if (!srcEntry || !tgtEntry) return

    if (editingRule) {
      // Update existing rule — preserve id, enabled state, and applied-blocks map key
      saveRules(rules.map(r => r.id === editingRule.id ? {
        ...r,
        autoApply,
        hideBlocked,
        sourceCalendarId:   srcEntry.id,
        sourceCalendarName: srcEntry.summary ?? srcEntry.id,
        sourceAccountEmail: srcEntry.accountEmail,
        targetCalendarId:   tgtEntry.id,
        targetCalendarName: tgtEntry.summary ?? tgtEntry.id,
        targetAccountEmail: tgtEntry.accountEmail,
        detailLevel:        detail,
      } : r))
    } else {
      saveRules([...rules, {
        id:                  crypto.randomUUID(),
        enabled:             true,
        autoApply,
        hideBlocked,
        sourceCalendarId:    srcEntry.id,
        sourceCalendarName:  srcEntry.summary ?? srcEntry.id,
        sourceAccountEmail:  srcEntry.accountEmail,
        targetCalendarId:    tgtEntry.id,
        targetCalendarName:  tgtEntry.summary ?? tgtEntry.id,
        targetAccountEmail:  tgtEntry.accountEmail,
        detailLevel:         detail,
      }])
    }
    resetForm()
  }

  function deleteRule(id: string) {
    saveRules(rules.filter(r => r.id !== id))
  }

  function toggleRule(id: string) {
    saveRules(rules.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r))
  }

  const badge = (level: DetailLevel) => {
    const { bg, color } = DETAIL_BADGE[level]
    const label = DETAIL_LEVELS.find(d => d.value === level)?.label ?? level
    return (
      <span style={{ fontSize: 'var(--sb-t-micro)', fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--sb-r-card)', background: bg, color }}>
        {label}
      </span>
    )
  }

  return (
    <div>
      <p style={{ margin: '0 0 16px', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', lineHeight: 1.55 }}>
        When an event appears on a source calendar, a matching block is automatically
        created on the target calendar. Choose how much detail to share.
      </p>

      {/* Rule list */}
      {rules.length === 0 && !showForm && (
        <p style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', margin: '0 0 12px', textAlign: 'center', padding: '12px 0' }}>
          No rules yet — add one below.
        </p>
      )}

      {rules.map(rule => (
        <div key={rule.id} style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px', borderRadius: 'var(--sb-r-nav)', marginBottom: 8,
          background: 'var(--sb-field)',
          border: `var(--sb-border-width) solid ${rule.enabled ? 'rgba(var(--sb-accent-rgb),0.19)' : 'var(--sb-border)'}`,
          opacity: rule.enabled ? 1 : 0.6,
        }}>
          <Toggle checked={rule.enabled} onChange={() => toggleRule(rule.id)} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', fontWeight: 500, color: 'var(--sb-ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {rule.sourceCalendarName}
              <span style={{ margin: '0 6px', color: 'var(--sb-ink-3)' }}>→</span>
              {rule.targetCalendarName}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
              {badge(rule.detailLevel)}
              {rule.autoApply && (
                <span style={{ fontSize: 'var(--sb-t-micro)', fontWeight: 600, padding: '2px 7px', borderRadius: 'var(--sb-r-card)', background: 'color-mix(in srgb, var(--sb-positive) 12.0%, transparent)', color: 'var(--sb-positive)' }}>
                  Auto
                </span>
              )}
              {rule.hideBlocked && (
                <span style={{ fontSize: 'var(--sb-t-micro)', fontWeight: 600, padding: '2px 7px', borderRadius: 'var(--sb-r-card)', background: 'color-mix(in srgb, var(--sb-info) 12.0%, transparent)', color: 'var(--sb-info)' }}>
                  Originals only
                </span>
              )}
              <span style={{ fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-3)' }}>
                {rule.sourceAccountEmail === rule.targetAccountEmail
                  ? rule.sourceAccountEmail
                  : `${rule.sourceAccountEmail} → ${rule.targetAccountEmail}`}
              </span>
            </div>
          </div>
          <button onClick={() => openEdit(rule)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-ink-3)', display: 'flex', padding: 4, opacity: 0.7, flexShrink: 0 }}
            title="Edit rule">
            <Pencil size={ICON.sm} />
          </button>
          <button onClick={() => deleteRule(rule.id)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-negative)', display: 'flex', padding: 4, opacity: 0.7, flexShrink: 0 }}
            title="Delete rule">
            <Trash2 size={ICON.sm} />
          </button>
        </div>
      ))}

      {/* Add rule form */}
      {showForm ? (
        <div style={{
          padding: '14px 16px', borderRadius: 'var(--sb-r-nav)', marginTop: 8,
          background: 'var(--sb-field)',
          border: 'var(--sb-border-width) solid rgba(var(--sb-accent-rgb),0.25)',
        }}>
          <p style={{ margin: '0 0 12px', fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-1)' }}>
            {editingRule ? 'Edit blocking rule' : 'New blocking rule'}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', display: 'block', marginBottom: 4 }}>
                Source calendar (events to watch)
              </label>
              <select value={srcCal} onChange={e => setSrcCal(e.target.value)} style={{ ...selectStyle, width: '100%' }}>
                <option value="">— choose —</option>
                {cals.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.summary ?? c.id} ({c.accountEmail})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', display: 'block', marginBottom: 4 }}>
                Target calendar (where blocks are created)
              </label>
              <select value={tgtCal} onChange={e => setTgtCal(e.target.value)} style={{ ...selectStyle, width: '100%' }}>
                <option value="">— choose —</option>
                {cals.filter(c => c.id !== srcCal).map(c => (
                  <option key={c.id} value={c.id}>
                    {c.summary ?? c.id} ({c.accountEmail})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', display: 'block', marginBottom: 4 }}>
                Detail level
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                {DETAIL_LEVELS.map(d => (
                  <button key={d.value} onClick={() => setDetail(d.value)}
                    style={{
                      flex: 1, padding: '7px 6px', borderRadius: 'var(--sb-r-chip)', cursor: 'pointer', textAlign: 'center',
                      background: detail === d.value ? DETAIL_BADGE[d.value].bg : 'var(--sb-card)',
                      border: `var(--sb-border-width) solid ${detail === d.value ? DETAIL_BADGE[d.value].color + '80' : 'var(--sb-border)'}`,
                      color: detail === d.value ? DETAIL_BADGE[d.value].color : 'var(--sb-ink-3)',
                      transition: 'all 0.15s',
                    }}>
                    <p style={{ margin: 0, fontSize: 'var(--sb-t-meta)', fontWeight: 600 }}>{d.label}</p>
                    <p style={{ margin: '2px 0 0', fontSize: 'var(--sb-t-micro)', opacity: 0.7, lineHeight: 1.3 }}>{d.desc}</p>
                  </button>
                ))}
              </div>
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 12px', borderRadius: 'var(--sb-r-chip)',
              background: autoApply ? 'color-mix(in srgb, var(--sb-positive) 7.0%, transparent)' : 'var(--sb-card)',
              border: `var(--sb-border-width) solid ${autoApply ? 'color-mix(in srgb, var(--sb-positive) 30.0%, transparent)' : 'var(--sb-border)'}`,
              transition: 'all 0.15s',
            }}>
              <div>
                <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-1)' }}>
                  Auto-apply
                </p>
                <p style={{ margin: '2px 0 0', fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-3)' }}>
                  Run this rule automatically whenever the calendar loads
                </p>
              </div>
              <Toggle checked={autoApply} onChange={setAutoApply} />
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 12px', borderRadius: 'var(--sb-r-chip)',
              background: hideBlocked ? 'color-mix(in srgb, var(--sb-info) 7.0%, transparent)' : 'var(--sb-card)',
              border: `var(--sb-border-width) solid ${hideBlocked ? 'color-mix(in srgb, var(--sb-info) 30.0%, transparent)' : 'var(--sb-border)'}`,
              transition: 'all 0.15s',
            }}>
              <div>
                <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-1)' }}>
                  Show originals only
                </p>
                <p style={{ margin: '2px 0 0', fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-3)' }}>
                  Hide created blocks from your calendar view (blocks still exist for recipients)
                </p>
              </div>
              <Toggle checked={hideBlocked} onChange={setHideBlocked} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button onClick={saveForm}
              disabled={!srcCal || !tgtCal || srcCal === tgtCal}
              style={{
                flex: 1, padding: '8px 0', borderRadius: 'var(--sb-r-chip)', cursor: 'pointer',
                background: (!srcCal || !tgtCal || srcCal === tgtCal) ? 'var(--sb-card)' : 'rgba(var(--sb-accent-rgb),0.12)',
                border: 'var(--sb-border-width) solid rgba(var(--sb-accent-rgb),0.31)',
                color: (!srcCal || !tgtCal || srcCal === tgtCal) ? 'var(--sb-ink-3)' : 'var(--sb-accent)',
                fontSize: 'var(--sb-t-body-s)', fontWeight: 600,
              }}>
              {editingRule ? 'Update Rule' : 'Add Rule'}
            </button>
            <button onClick={resetForm}
              style={{
                padding: '8px 16px', borderRadius: 'var(--sb-r-chip)', cursor: 'pointer',
                background: 'transparent', border: 'var(--sb-border-width) solid var(--sb-border)',
                color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-body-s)',
              }}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => { setCals(loadCachedCalendars()); setEditingRule(null); setShowForm(true) }}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
            borderRadius: 'var(--sb-r-chip)', cursor: 'pointer', marginTop: 4,
            background: 'rgba(var(--sb-accent-rgb),0.10)',
            border: 'var(--sb-border-width) solid rgba(var(--sb-accent-rgb),0.25)',
            color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-body-s)',
          }}>
          <Plus size={ICON.sm} /> Add Rule
        </button>
      )}
    </div>
  )
}

// ─── Behavioral OS Section ────────────────────────────────────────────────────

function BehavioralSection() {
  const { enabled, mode, setEnabled, setMode } = useBehavioralStore()
  const SB = {
    bg: 'var(--sb-page)', surface: 'var(--sb-card)', surface2: 'var(--sb-field)', border: 'var(--sb-border)',
    accent: 'var(--sb-accent)', accentFill: 'rgba(var(--sb-accent-rgb),0.12)', accentBright: 'var(--sb-warning)',
    text: 'var(--sb-ink-1)', textDim: 'var(--sb-ink-3)', textMuted: 'var(--sb-ink-4)',
  }

  const modes: { id: BehavioralMode; label: string; desc: string; available: boolean }[] = [
    { id: 'samurai', label: 'Samurai',  desc: 'Disciplined executor. Tactical tone. Rank system active.', available: true  },
    { id: 'pharaoh', label: 'Pharaoh',  desc: 'Strategic builder. Legacy-focused framework.',             available: false },
    { id: 'astral',  label: 'Astral',   desc: 'Vision-first. Long-horizon thinking & reflection.',        available: false },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Enable toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: SB.surface2, borderRadius: 'var(--sb-r-nav)', border: `var(--sb-border-width) solid ${SB.border}` }}>
        <div>
          <div style={{ fontSize: 'var(--sb-t-label)', fontWeight: 600, color: SB.text }}>Enable Behavioral OS</div>
          <div style={{ fontSize: 'var(--sb-t-body-s)', color: SB.textDim, marginTop: 2 }}>Activates rank tracking, identity detection & mode-aware AI</div>
        </div>
        <button
          onClick={() => setEnabled(!enabled)}
          style={{
            width: 44, height: 24, borderRadius: 'var(--sb-r-nav)', border: 'none', cursor: 'pointer', flexShrink: 0,
            background: enabled ? SB.accent : SB.border,
            position: 'relative', transition: 'background 0.2s',
          }}
        >
          <span style={{
            position: 'absolute', top: 2, left: enabled ? 22 : 2,
            width: 20, height: 20, borderRadius: 'var(--sb-r-pill)', background: 'var(--sb-ink-on-fill)',
            transition: 'left 0.2s',
          }} />
        </button>
      </div>

      {/* Mode selection */}
      {enabled && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 700, color: SB.accentBright, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 2 }}>Operating Mode</div>
          {modes.map(m => (
            <button
              key={m.id}
              disabled={!m.available}
              onClick={() => m.available && setMode(m.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 14px', borderRadius: 'var(--sb-r-nav)', cursor: m.available ? 'pointer' : 'default',
                background: mode === m.id ? SB.accentFill : SB.surface2,
                border: `var(--sb-border-width) solid ${mode === m.id ? SB.accent : SB.border}`,
                textAlign: 'left', width: '100%', opacity: m.available ? 1 : 0.5,
              }}
            >
              <Swords size={ICON.md} color={mode === m.id ? SB.accent : SB.textDim} strokeWidth={STROKE.rest} style={{ flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 'var(--sb-t-label)', fontWeight: 600, color: SB.text }}>{m.label}</span>
                  {!m.available && <span style={{ fontSize: 'var(--sb-t-micro)', fontWeight: 700, padding: '2px 6px', borderRadius: 'var(--sb-r-chip)', background: SB.border, color: SB.textDim, letterSpacing: '0.5px' }}>SOON</span>}
                </div>
                <div style={{ fontSize: 'var(--sb-t-body-s)', color: SB.textDim, marginTop: 2 }}>{m.desc}</div>
              </div>
              {mode === m.id && <div style={{ width: 8, height: 8, borderRadius: 'var(--sb-r-pill)', background: SB.accent, flexShrink: 0 }} />}
            </button>
          ))}
        </div>
      )}

      {/* Samurai info */}
      {enabled && mode === 'samurai' && (
        <div style={{ padding: '12px 14px', borderRadius: 'var(--sb-r-nav)', background: 'color-mix(in srgb, var(--sb-negative-deep) 8.0%, transparent)', border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-negative-deep) 25.0%, transparent)' }}>
          <div style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-negative)', fontWeight: 600, marginBottom: 4 }}>Samurai Mode Active</div>
          <div style={{ fontSize: 'var(--sb-t-body-s)', color: SB.textDim, lineHeight: 1.5 }}>
            The Behavioral OS page will appear in the sidebar. Your rank (Ronin → Shogun) is calculated from task completion, habit consistency, and planning quality. The AI assistant will adopt a tactical, no-filler communication style.
          </div>
        </div>
      )}
    </div>
  )
}

// ─── CHUNK 6c: Finance Settings section ──────────────────────────────────────

// The Budget screen is what draws these, so the ids live with it.
type EnvelopeStyle = BudgetEnvelopeStyle

// ─── Settings → Finance → Security ───────────────────────────────────────────
//
// The lock itself lives in `finance/lock.ts`; this is where it is turned on.
// Two rules shape the whole block:
//
//   * A password is required before the lock can be turned on. A passkey is
//     held by one device's secure element and cannot travel — turn the lock on
//     with only a fingerprint and the next device you sign in on has a locked
//     finance module and no way in.
//   * These controls are themselves behind the lock. Otherwise the lock is a
//     toggle anyone holding your open laptop can flip.

function FinanceSecuritySection() {
  const [cfg, setCfg]         = useState<LockConfig>(loadLock)
  const [passkey, setPasskey] = useState<DevicePasskey | null>(loadPasskey)
  const [canBio, setCanBio]   = useState(false)
  const [open, setOpen]       = useState(() => !isLocked())
  const [pw1, setPw1]         = useState('')
  const [pw2, setPw2]         = useState('')
  const [editing, setEditing] = useState(false)
  const [note, setNote]       = useState<string | null>(null)
  const [err, setErr]         = useState<string | null>(null)

  useEffect(() => { void biometricsAvailable().then(setCanBio) }, [])

  function put(next: LockConfig) { setCfg(next); saveLock(next) }

  async function savePassword() {
    setErr(null); setNote(null)
    if (pw1.length < 6) { setErr('Six characters at least.'); return }
    if (pw1 !== pw2)    { setErr('The two do not match.'); return }
    put({ ...cfg, password: await hashPassword(pw1) })
    setPw1(''); setPw2(''); setEditing(false)
    setNote('Password saved.')
  }

  function toggleLock(on: boolean) {
    setErr(null); setNote(null)
    if (on && !cfg.password) { setEditing(true); setErr('Set a password first — it is the way in on a device with no fingerprint.'); return }
    // Being the one who just turned it on counts as having proved yourself.
    markActive()
    put({ ...cfg, enabled: on })
  }

  async function addPasskey() {
    setErr(null); setNote(null)
    try {
      let name = 'Finance'
      try { name = localStorage.getItem('professor-display-name') || name } catch { /* noop */ }
      setPasskey(await registerPasskey(name))
      setNote(`${deviceLabel()} can now unlock with ${biometricName()}.`)
    } catch (e) {
      const n = (e as { name?: string })?.name
      setErr(n === 'NotAllowedError'
        ? 'Cancelled, or it timed out.'
        : 'This browser would not register a passkey. The password still works.')
    }
  }

  const pill = {
    height: 30, padding: '0 12px', borderRadius: 'var(--sb-r-sm)', cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 'var(--sb-t-body-s)', fontWeight: 600,
    background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-1)',
  } as const
  const solid = { ...pill, background: 'var(--sb-ink-1)', border: 'var(--sb-border-width) solid var(--sb-ink-1)', color: 'var(--sb-ink-on-dark)' }
  const field = {
    height: 'var(--sb-h-pill)', width: 180, borderRadius: 'var(--sb-r-sm)', padding: '0 11px', boxSizing: 'border-box' as const,
    background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)',
    fontFamily: 'inherit', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)', outline: 'none',
  }

  return (
    <div style={{ gridColumn: '1 / -1', marginTop: 22, paddingTop: 18, borderTop: 'var(--sb-border-width) solid var(--sb-hairline)' }}>
      <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 700, letterSpacing: '0.12em', color: 'var(--sb-ink-3)', display: 'block', marginBottom: 12 }}>SECURITY</span>

      {!open ? (
        <div style={{ maxWidth: 400 }}>
          <LockGate
            compact
            onUnlocked={() => { markActive(); setOpen(true) }}
            title="Unlock to change these"
            note="The lock is on. Prove it is you before turning it off or changing the password."
          />
        </div>
      ) : (
        <>
          <p style={{ margin: '0 0 14px', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', lineHeight: 1.55, maxWidth: 660 }}>
            With this on, every finance screen — Today, Balances, Budget, Financials, Goals — asks
            who you are before it draws anything, and asks again after a stretch of doing nothing.
            It is a lock on the screen rather than on the data: it stops the person who picks up
            your open laptop, not somebody with your sign-in.
          </p>

          <div style={{ maxWidth: 660 }}>
            <FieldRow label="Lock the finance pages" sub={cfg.enabled ? 'On — a new tab opens locked' : 'Off — anyone at this browser can read them'}>
              <Toggle checked={cfg.enabled} onChange={toggleLock} />
            </FieldRow>

            <FieldRow label="Lock again" sub="Measured from the last thing you did anywhere in the app">
              <select
                value={String(cfg.relock)}
                onChange={e => put({ ...cfg, relock: (e.target.value === 'session' ? 'session' : Number(e.target.value)) as Relock })}
                style={{ ...field, width: 210, cursor: 'pointer' }}
              >
                {RELOCK_CHOICES.map(c => (
                  <option key={String(c.value)} value={String(c.value)}>{c.label}</option>
                ))}
              </select>
            </FieldRow>

            <FieldRow
              label={`Unlock with ${biometricName()}`}
              sub={passkey
                ? `Registered on this ${passkey.label.toLowerCase()} on ${new Date(passkey.addedAt).toLocaleDateString()}`
                : canBio
                  ? `Ask this ${deviceLabel().toLowerCase()} to check you, instead of typing`
                  : 'This browser has no fingerprint, face or passcode unlock to offer'}
            >
              {passkey ? (
                <button style={pill} onClick={() => { forgetPasskey(); setPasskey(null); setNote('Removed. The password still works.') }}>
                  Remove from this device
                </button>
              ) : (
                <button style={canBio ? solid : { ...pill, color: 'var(--sb-ink-4)', cursor: 'default' }}
                  disabled={!canBio} onClick={() => void addPasskey()}>
                  Set up on this device
                </button>
              )}
            </FieldRow>

            <FieldRow
              label="Password"
              sub={cfg.password ? 'Set. It works on every device you sign in on.' : 'Not set — needed before the lock can be turned on'}
            >
              {!editing
                ? <button style={cfg.password ? pill : solid} onClick={() => { setEditing(true); setErr(null); setNote(null) }}>
                    {cfg.password ? 'Change' : 'Set a password'}
                  </button>
                : (
                  <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <input type="password" autoComplete="new-password" placeholder="New password"
                      value={pw1} onChange={e => setPw1(e.target.value)} style={field} />
                    <input type="password" autoComplete="new-password" placeholder="Again"
                      value={pw2} onChange={e => setPw2(e.target.value)} style={field} />
                    <button style={solid} onClick={() => void savePassword()}>Save</button>
                    <button style={pill} onClick={() => { setEditing(false); setPw1(''); setPw2(''); setErr(null) }}>Cancel</button>
                  </div>
                )}
            </FieldRow>
          </div>

          {(err || note) && (
            <p style={{ margin: '11px 0 0', fontSize: 'var(--sb-t-body-s)', lineHeight: 1.5, color: err ? 'var(--sb-negative)' : 'var(--sb-positive)' }}>
              {err ?? note}
            </p>
          )}

          <p style={{ margin: '12px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', lineHeight: 1.55, maxWidth: 660 }}>
            The password is stored as a salted hash and never leaves your account. A passkey never
            leaves the device that made it — each device you use registers its own, and the password
            is what gets you in on one that has not.
          </p>
        </>
      )}
    </div>
  )
}

function FinanceSection() {
  const [envelopeStyle, setEnvelopeStyle] = useState<EnvelopeStyle>(() => {
    try { return (localStorage.getItem('finance-envelope-style') as EnvelopeStyle) || 'dial' } catch { return 'dial' }
  })
  const [currency, setCurrency]         = useState(() => { try { return localStorage.getItem('finance-currency') || 'EGP' } catch { return 'EGP' } })
  const [monthStart, setMonthStart]     = useState(() => { try { return parseInt(localStorage.getItem('finance-month-start') ?? '1') } catch { return 1 } })
  const [showCents, setShowCents]       = useState(() => { try { return localStorage.getItem('finance-show-cents') !== 'false' } catch { return true } })
  const [weekStart, setWeekStart]       = useState(() => { try { return localStorage.getItem('finance-week-start') || 'Mon' } catch { return 'Mon' } })
  const [alertThreshold, setAlertThreshold] = useState(() => { try { return parseFloat(localStorage.getItem('finance-alert-threshold') ?? '0.9') } catch { return 0.9 } })
  // 11G new fields
  const [numbersInFull, setNumbersInFull] = useState(() => { try { return localStorage.getItem('finance-numbers-in-full') !== 'false' } catch { return true } })
  const [roundWhole, setRoundWhole]       = useState(() => { try { return localStorage.getItem('finance-round-whole') === 'true' } catch { return false } })
  const [countOn, setCountOn]             = useState<'due' | 'paid'>(() => { try { return (localStorage.getItem('finance-count-on') as 'due' | 'paid') || 'paid' } catch { return 'paid' } })
  const [includePlanned, setIncludePlanned] = useState(() => { try { return localStorage.getItem('finance-include-planned') !== 'false' } catch { return true } })
  const [categoryOrder, setCategoryOrder] = useState<'spend' | 'budget' | 'alpha' | 'custom'>(() => {
    try { return (localStorage.getItem('finance-category-order') as 'spend' | 'budget' | 'alpha' | 'custom') || 'spend' } catch { return 'spend' }
  })
  const [fxRates, setFxRates] = useState<Record<string, number>>(loadRates)

  // Money reminders: a category, a day of the month, and a task on that date.
  const { categories: finCategories } = useFinanceStore()

  // Payment dates. An entry with none reads as unpaid everywhere, which is
  // right for one somebody left unpaid and wrong for one logged before there
  // were two dates — so the repair is here, as something asked for.
  const finTransactions = useFinanceStore(s => s.transactions)
  const finYear         = useFinanceStore(s => s.currentYear)
  const markAllPaid     = useFinanceStore(s => s.markAllPaidOnDueDate)
  const unmarkFuture    = useFinanceStore(s => s.unmarkPaidInFuture)
  const [filling, setFilling] = useState<'idle' | 'working' | number>('idle')
  const [undoing, setUndoing] = useState<'idle' | 'working' | number>('idle')
  // Entries claiming they were paid on a day that has not happened. Counted
  // from the loaded year only, so it is a floor — the repair covers every year.
  const futurePaid = useMemo(
    () => finTransactions.filter(t => t.paidAt && t.paidAt > todayISO()).length,
    [finTransactions])
  // Only the loaded year can be counted from here — the repair itself covers
  // every year, so the count is a floor, not the total.
  const undatedHere = useMemo(
    () => finTransactions.filter(t => !t.paidAt).length, [finTransactions])
  const [reminders, setReminders] = useState<MoneyReminder[]>(loadReminders)
  const budgetRules = loadRules()
  function putReminders(next: MoneyReminder[]) { setReminders(next); saveReminders(next) }
  const catById = (id: string) => finCategories.find(c => c.id === id)

  function saveStyle(s: EnvelopeStyle) {
    setEnvelopeStyle(s)
    try { localStorage.setItem('finance-envelope-style', s) } catch { /* noop */ }
    window.dispatchEvent(new CustomEvent('finance:envelopeStyleChanged', { detail: s }))
  }

  function saveField(key: string, val: string) {
    try { localStorage.setItem(key, val) } catch { /* noop */ }
  }

  const STYLES: { id: EnvelopeStyle; label: string; sub: string; preview: React.ReactNode }[] = [
    {
      id: 'dial',
      label: 'Dial + trend',
      sub: 'This month, plus a seven-day habit line',
      preview: (
        <svg viewBox="0 0 80 56" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: 56 }}>
          {/* Track */}
          <path d="M14 42 A26 26 0 0 1 66 42" stroke="var(--sb-border)" strokeWidth="7" strokeLinecap="round" fill="none"/>
          {/* Fill (72% of arc) */}
          <path d="M14 42 A26 26 0 0 1 57.8 19.5" stroke="var(--sb-accent)" strokeWidth="7" strokeLinecap="round" fill="none"/>
          {/* Needle center */}
          <circle cx="40" cy="42" r="4" fill="var(--sb-ink-1)"/>
          {/* Trend line */}
          <polyline points="10,50 22,46 34,44 46,41 58,37 70,33" stroke="var(--sb-positive)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
        </svg>
      ),
    },
    {
      id: 'mosaic',
      label: 'Proportional mosaic',
      sub: 'Area equals money · rust boxes burst',
      preview: (
        <svg viewBox="0 0 80 56" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: 56 }}>
          <rect x="4" y="4" width="44" height="28" rx="3" fill="var(--sb-field)"/>
          <rect x="4" y="4" width="44" height="20" rx="3" fill="var(--sb-accent)" opacity="0.7"/>
          <rect x="52" y="4" width="24" height="44" rx="3" fill="var(--sb-negative-tint)"/>
          <rect x="52" y="4" width="24" height="48" rx="3" fill="var(--sb-negative-deep)" opacity="0.5"/>
          <rect x="4" y="36" width="20" height="16" rx="3" fill="var(--sb-field)"/>
          <rect x="4" y="36" width="14" height="16" rx="3" fill="var(--sb-positive-tint)"/>
          <rect x="28" y="36" width="20" height="16" rx="3" fill="var(--sb-field)"/>
          <rect x="28" y="36" width="10" height="16" rx="3" fill="var(--sb-accent)" opacity="0.5"/>
        </svg>
      ),
    },
    {
      id: 'slip',
      label: 'Till slips',
      sub: 'Monospace figures · one eye movement to compare',
      preview: (
        <svg viewBox="0 0 80 56" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: 56 }}>
          <rect x="4" y="4" width="72" height="12" rx="3" fill="var(--sb-field)"/>
          <rect x="4" y="4" width="52" height="12" rx="3" fill="var(--sb-accent)" opacity="0.5"/>
          <rect x="4" y="20" width="72" height="12" rx="3" fill="var(--sb-field)"/>
          <rect x="4" y="20" width="68" height="12" rx="3" fill="var(--sb-positive-tint)"/>
          <rect x="4" y="36" width="72" height="12" rx="3" fill="var(--sb-field)"/>
          <rect x="4" y="36" width="76" height="12" rx="3" fill="var(--sb-negative-tint)"/>
          <rect x="4" y="36" width="72" height="12" rx="3" fill="var(--sb-negative-deep)" opacity="0.25"/>
        </svg>
      ),
    },
    {
      id: 'ring',
      label: 'Double rings',
      sub: 'Two rings: worse than last month · not just over',
      preview: (
        <svg viewBox="0 0 80 56" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: 56 }}>
          {/* outer ring */}
          <circle cx="22" cy="28" r="16" stroke="var(--sb-border)" strokeWidth="4" fill="none"/>
          <circle cx="22" cy="28" r="16" stroke="var(--sb-accent)" strokeWidth="4" fill="none"
            strokeDasharray="75.4" strokeDashoffset="20" strokeLinecap="round"/>
          {/* inner ring */}
          <circle cx="22" cy="28" r="10" stroke="var(--sb-field)" strokeWidth="3" fill="none"/>
          <circle cx="22" cy="28" r="10" stroke="var(--sb-positive)" strokeWidth="3" fill="none"
            strokeDasharray="62.8" strokeDashoffset="16" strokeLinecap="round"/>

          <circle cx="55" cy="28" r="16" stroke="var(--sb-border)" strokeWidth="4" fill="none"/>
          <circle cx="55" cy="28" r="16" stroke="var(--sb-negative-deep)" strokeWidth="4" fill="none"
            strokeDasharray="100.5" strokeDashoffset="-4" strokeLinecap="round"/>
          <circle cx="55" cy="28" r="10" stroke="var(--sb-field)" strokeWidth="3" fill="none"/>
          <circle cx="55" cy="28" r="10" stroke="var(--sb-negative-deep)" strokeWidth="3" fill="none" opacity="0.5"
            strokeDasharray="62.8" strokeDashoffset="-8" strokeLinecap="round"/>
        </svg>
      ),
    },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0 30px', alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22, minWidth: 0 }}>
      {/* ── ENVELOPE STYLE ───────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 700, letterSpacing: '0.12em', color: 'var(--sb-ink-3)' }}>ENVELOPE STYLE</span>
          <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>The budget page opens in this view · you can still switch it per visit</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
          {STYLES.map(style => {
            const active = envelopeStyle === style.id
            return (
              <button
                key={style.id}
                onClick={() => saveStyle(style.id)}
                style={{
                  background: active ? 'var(--sb-field)' : 'var(--sb-card)',
                  border: `var(--sb-border-width) solid ${active ? 'var(--sb-accent)' : 'var(--sb-border)'}`,
                  borderRadius: 'var(--sb-r-nav)', padding: '14px 14px 12px',
                  cursor: 'pointer', textAlign: 'left',
                  boxShadow: active ? '0 0 0 2px rgba(var(--sb-accent-rgb),0.25)' : 'none',
                  transition: 'all 0.15s',
                }}
              >
                {/* Visual preview */}
                <div style={{ background: 'var(--sb-hairline)', borderRadius: 'var(--sb-r-chip)', padding: '8px 10px', marginBottom: 10, overflow: 'hidden' }}>
                  {style.preview}
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{
                    width: 16, height: 16, borderRadius: 'var(--sb-r-pill)', flexShrink: 0, marginTop: 1,
                    border: `var(--sb-border-emphasis) solid ${active ? 'var(--sb-accent)' : 'var(--sb-border)'}`,
                    background: active ? 'var(--sb-accent)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {active && <div style={{ width: 6, height: 6, borderRadius: 'var(--sb-r-pill)', background: 'var(--sb-accent-ink)' }} />}
                  </div>
                  <div>
                    <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-1)' }}>{style.label}</p>
                    <p style={{ margin: '2px 0 0', fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-3)', lineHeight: 1.3 }}>{style.sub}</p>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22, minWidth: 0 }}>

      {/* ── FIGURES ──────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 4 }}>
        <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 700, letterSpacing: '0.12em', color: 'var(--sb-ink-3)', display: 'block', marginBottom: 12 }}>FIGURES</span>
        <FieldRow label="Currency" sub="Everything converts to this · foreign accounts keep their own">
          <select
            value={currency}
            onChange={e => { setCurrency(e.target.value); saveField('finance-currency', e.target.value) }}
            style={{ ...selectStyle, width: 180 }}
          >
            {['EGP · Egyptian pound','USD · US dollar','EUR · Euro','GBP · Pound sterling','AED · UAE dirham','SAR · Saudi riyal','KWD · Kuwaiti dinar','QAR · Qatari riyal'].map(c => {
              const v = c.split(' · ')[0]
              return <option key={v} value={v}>{c}</option>
            })}
          </select>
        </FieldRow>
        {/* Rates. "Everything converts to this" above was aspirational: there
            was nothing to convert by, so foreign money was either added at
            face value or left out of every total. */}
        <div style={{ padding: '4px 0 2px' }}>
          <div style={{ fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)', fontWeight: 500 }}>Exchange rates</div>
          <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', marginTop: 2, marginBottom: 10, lineHeight: 1.5 }}>
            What one unit is worth in {currency}. Set by hand — there is no rate feed in here,
            and a stale one would be its own kind of wrong. A currency left blank stays out of
            the totals rather than being guessed at.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {['USD', 'EUR', 'GBP', 'AED', 'SAR', 'KWD', 'QAR', 'EGP']
              .filter(c => c !== currency)
              .map(code => (
                <label key={code} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7, height: 'var(--sb-h-pill)', padding: '0 10px',
                  borderRadius: 'var(--sb-r-sm)', border: 'var(--sb-border-width) solid var(--sb-border)', background: 'var(--sb-card)',
                }}>
                  <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 700, color: 'var(--sb-ink-3)' }}>1 {code}</span>
                  <input
                    type="number" min={0} step="0.0001" inputMode="decimal"
                    defaultValue={fxRates[code] ?? ''}
                    placeholder="—"
                    onBlur={e => {
                      const v = parseFloat(e.target.value)
                      setRate(code, isFinite(v) && v > 0 ? v : null)
                      setFxRates(loadRates())
                    }}
                    style={{
                      width: 72, background: 'transparent', border: 'none', outline: 'none',
                      fontFamily: 'inherit', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)', textAlign: 'right', padding: 0,
                    }} />
                  <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)' }}>{currency}</span>
                </label>
              ))}
          </div>
        </div>

        <FieldRow label="Write numbers in full" sub={`${currency} 141,000 rather than 141K — abbreviations hide the size of things`}>
          <Toggle checked={numbersInFull} onChange={v => { setNumbersInFull(v); saveField('finance-numbers-in-full', String(v)) }} />
        </FieldRow>
        <FieldRow label="Round to whole units" sub="Piasters / cents dropped from every display">
          <Toggle checked={roundWhole} onChange={v => { setRoundWhole(v); saveField('finance-round-whole', String(v)) }} />
        </FieldRow>
        <FieldRow label="Show cents" sub="Display two decimal places on amounts (overrides round)">
          <Toggle checked={showCents} onChange={v => { setShowCents(v); saveField('finance-show-cents', String(v)) }} />
        </FieldRow>

        {/* Order categories by */}
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.1em', color: 'var(--sb-ink-3)', marginBottom: 8 }}>ORDER CATEGORIES BY</div>
          <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', marginBottom: 8 }}>Biggest spend first keeps the two problems at the top</div>
          <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6 }}>
            {([
              { v: 'spend',  label: 'Biggest spend' },
              { v: 'budget', label: 'Budget size' },
              { v: 'alpha',  label: 'A–Z' },
              { v: 'custom', label: 'Custom' },
            ] as const).map(o => (
              <button key={o.v} onClick={() => { setCategoryOrder(o.v); saveField('finance-category-order', o.v) }}
                style={{
                  padding: '6px 13px', borderRadius: 'var(--sb-r-pill)', border: 'var(--sb-border-width) solid var(--sb-border)', cursor: 'pointer',
                  background: categoryOrder === o.v ? 'var(--sb-ink-1)' : 'var(--sb-field)',
                  color: categoryOrder === o.v ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-3)',
                  fontSize: 'var(--sb-t-body-s)', fontWeight: categoryOrder === o.v ? 600 : 400,
                }}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22, minWidth: 0 }}>

      {/* ── DATES & COUNTING ─────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 4 }}>
        <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 700, letterSpacing: '0.12em', color: 'var(--sb-ink-3)', display: 'block', marginBottom: 12 }}>DATES · COUNTING</span>

        {/* Count on */}
        <FieldRow label="Count a transaction on" sub="The financials table can show either — this sets the default">
          <div style={{ display: 'flex', gap: 8 }}>
            {(['due', 'paid'] as const).map(v => (
              <button key={v} onClick={() => { setCountOn(v); saveField('finance-count-on', v) }}
                style={{
                  padding: '6px 14px', borderRadius: 'var(--sb-r-chip)', border: 'var(--sb-border-width) solid var(--sb-border)', cursor: 'pointer',
                  background: countOn === v ? 'var(--sb-ink-1)' : 'var(--sb-field)',
                  color: countOn === v ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-3)',
                  fontSize: 'var(--sb-t-body-s)', fontWeight: countOn === v ? 600 : 400,
                }}>
                {v === 'due' ? 'Due date' : 'Date paid'}
              </button>
            ))}
          </div>
        </FieldRow>

        <FieldRow label="Month starts on" sub="Your salary lands on the 1st">
          <select
            value={monthStart}
            onChange={e => { const v = parseInt(e.target.value); setMonthStart(v); saveField('finance-month-start', String(v)) }}
            style={{ ...selectStyle, width: 180 }}
          >
            {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
              <option key={d} value={d}>{d === 1 ? '1st (calendar month)' : `${d}${d === 2 ? 'nd' : d === 3 ? 'rd' : 'th'}`}</option>
            ))}
          </select>
        </FieldRow>

        <FieldRow label="Include planned months" sub="Future months shown greyed in tables and charts">
          <Toggle checked={includePlanned} onChange={v => { setIncludePlanned(v); saveField('finance-include-planned', String(v)) }} />
        </FieldRow>

        <FieldRow label="Week starts on" sub="Affects the money calendar view">
          <select
            value={weekStart}
            onChange={e => { setWeekStart(e.target.value); saveField('finance-week-start', e.target.value) }}
            style={{ ...selectStyle, width: 160 }}
          >
            {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </FieldRow>
      </div>


      {/* ── ALERTS ───────────────────────────────────────────────────────────── */}
      <div>
        <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 700, letterSpacing: '0.12em', color: 'var(--sb-ink-3)', display: 'block', marginBottom: 12 }}>ALERTS</span>
        <FieldRow label="Balance alert" sub="Notify when an envelope is this % spent">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="range" min={0.5} max={1} step={0.05}
              value={alertThreshold}
              onChange={e => { const v = parseFloat(e.target.value); setAlertThreshold(v); saveField('finance-alert-threshold', String(v)) }}
              style={{ flex: 1, accentColor: 'var(--sb-accent)', cursor: 'pointer' }}
            />
            <span style={{ width: 36, textAlign: 'right', fontSize: 'var(--sb-t-label)', fontWeight: 600, color: 'var(--sb-ink-1)', fontFamily: 'var(--sb-font-mono)' }}>
              {Math.round(alertThreshold * 100)}%
            </span>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-3)' }}>
            {alertThreshold >= 1 ? 'Alert only when over budget' : alertThreshold >= 0.9 ? 'Alert at 90%+ spent (recommended)' : `Alert when ${Math.round(alertThreshold * 100)}%+ of envelope is spent`}
          </p>
        </FieldRow>
      </div>
      </div>
      <FinanceSecuritySection />

      <div style={{ gridColumn: '1 / -1', marginTop: 22, paddingTop: 18, borderTop: 'var(--sb-border-width) solid var(--sb-hairline)' }}>
        <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 700, letterSpacing: '0.12em', color: 'var(--sb-ink-3)', display: 'block', marginBottom: 12 }}>PAYMENT DATES</span>
        {!paidAtSupported() ? (
          <div style={{
            fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-accent-deep)', lineHeight: 1.55, maxWidth: 720,
            background: 'var(--sb-accent-tint)', border: 'var(--sb-border-width) solid var(--sb-accent-border)', borderRadius: 'var(--sb-r-nav)', padding: '11px 14px',
          }}>
            Your database has no payment-date column yet, so nothing can be marked paid or unpaid —
            run <code style={{ fontFamily: 'var(--sb-font-mono)', fontSize: 'var(--sb-t-meta)' }}>supabase/migrations/20260006</code> in
            the SQL editor and reload.
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', flex: 1, minWidth: 320, maxWidth: 640, lineHeight: 1.5 }}>
              An entry with no payment date is money that has not moved, and every feed marks it
              with a dotted red border. Entries logged before there were two dates have none
              either — this gives every one of them its due date as the day it was paid, in every
              year. Anything you meant to leave unpaid will need marking again afterwards.{' '}
              {undatedHere > 0 && `${undatedHere} ${undatedHere === 1 ? 'is' : 'are'} waiting in ${finYear} alone.`}
            </div>
            <Button
              variant="primary"
              disabled={filling === 'working'}
              onClick={async () => {
                if (!window.confirm('Mark every entry with no payment date as paid on its due date, in every year?')) return
                setFilling('working')
                setFilling(await markAllPaid())
              }}
              style={{ flexShrink: 0 }}>
              {filling === 'working' ? 'Working…' : 'Mark every entry paid on its due date'}
            </Button>
            {typeof filling === 'number' && (
              <span style={{ fontSize: 'var(--sb-t-body-s)', color: filling > 0 ? 'var(--sb-positive)' : 'var(--sb-ink-3)', fontWeight: 600 }}>
                {filling > 0 ? `${filling} updated` : 'nothing was waiting'}
              </span>
            )}
          </div>
        )}

        {/* The way back from the repair above having been run when nobody
            asked for it. A migration used to do exactly what that button does,
            on every deploy, over the answers you had since given. */}
        {paidAtSupported() && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap', marginTop: 16, paddingTop: 16, borderTop: 'var(--sb-border-width) solid var(--sb-hairline)' }}>
            <div style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', flex: 1, minWidth: 320, maxWidth: 640, lineHeight: 1.5 }}>
              Money cannot have moved on a day that has not happened, so an entry marked paid on a
              future date is a mistake — a salary not yet received, a bill dated ahead, an
              instalment a budget wrote. This takes those payment dates back off, in every year.{' '}
              <b>Entries dated in the past are left alone</b>: once a payment date is on one,
              deliberately unpaid and genuinely paid on its due date look identical, and nothing
              recorded which it was.{' '}
              {futurePaid > 0 && `${futurePaid} ${futurePaid === 1 ? 'is' : 'are'} marked that way in ${finYear} alone.`}
            </div>
            <Button
              variant="secondary"
              disabled={undoing === 'working'}
              onClick={async () => {
                if (!window.confirm('Take the payment date off every entry marked paid on a future date, in every year?')) return
                setUndoing('working')
                setUndoing(await unmarkFuture())
              }}
              style={{ flexShrink: 0 }}>
              {undoing === 'working' ? 'Working…' : 'Un-mark entries paid in the future'}
            </Button>
            {typeof undoing === 'number' && (
              <span style={{ fontSize: 'var(--sb-t-body-s)', color: undoing > 0 ? 'var(--sb-positive)' : 'var(--sb-ink-3)', fontWeight: 600 }}>
                {undoing > 0 ? `${undoing} put back` : 'none were'}
              </span>
            )}
          </div>
        )}
      </div>

      <div style={{ gridColumn: '1 / -1', marginTop: 22, paddingTop: 18, borderTop: 'var(--sb-border-width) solid var(--sb-hairline)' }}>
        <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 700, letterSpacing: '0.12em', color: 'var(--sb-ink-3)', display: 'block', marginBottom: 12 }}>MONEY REMINDERS</span>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <div style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', flex: 1, maxWidth: 640, lineHeight: 1.5 }}>
              A budget says how much a category gets in a month; it says nothing about the day the
              money has to move. Each reminder puts a task on that day, carrying what the category is
              budgeted, and the task board schedules it onto your calendar like anything else with a
              date on it. A month too short for the day takes its last day.
            </div>
            <button
              onClick={() => {
                const first = finCategories[0]
                if (!first) return
                putReminders([...reminders, defaultReminder(first.id)])
              }}
              disabled={finCategories.length === 0}
              style={{
                height: 28, padding: '0 11px', borderRadius: 'var(--sb-r-chip)', cursor: finCategories.length ? 'pointer' : 'default',
                background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-3)',
                fontFamily: 'inherit', fontSize: 'var(--sb-t-meta)', fontWeight: 600,
              }}>+ Add a reminder</button>
          </div>

          {reminders.length === 0 && (
            <div style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-4)', padding: '10px 0' }}>
              Nothing scheduled. Rent on the 1st, school fees on the 5th — that sort of thing.
            </div>
          )}

          {reminders.map(r => {
            const cat = catById(r.categoryId)
            const nextUp = dueDatesFor(r)[0]
            return (
              <div key={r.id} style={{
                display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const,
                padding: '10px 0', borderTop: 'var(--sb-border-width) solid var(--sb-hairline)',
              }}>
                <select
                  value={r.categoryId}
                  onChange={e => putReminders(reminders.map(x => x.id === r.id ? { ...x, categoryId: e.target.value } : x))}
                  style={{
                    height: 32, minWidth: 168, maxWidth: 240, padding: '0 8px', borderRadius: 'var(--sb-r-chip)',
                    border: 'var(--sb-border-width) solid var(--sb-border)', background: 'var(--sb-card)', fontFamily: 'inherit',
                    fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)',
                  }}>
                  {finCategories.filter(c => !c.parentId).flatMap(parent => [
                    <option key={parent.id} value={parent.id}>{parent.name}</option>,
                    ...finCategories.filter(c => c.parentId === parent.id)
                      .map(child => <option key={child.id} value={child.id}>{`  ${parent.name} · ${child.name}`}</option>),
                  ])}
                </select>

                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>
                  on day
                  <input
                    type="number" min={1} max={31}
                    value={r.day}
                    onChange={e => putReminders(reminders.map(x => x.id === r.id
                      ? { ...x, day: Math.min(31, Math.max(1, parseInt(e.target.value) || 1)) } : x))}
                    style={{
                      width: 54, height: 32, boxSizing: 'border-box', padding: '0 8px', borderRadius: 'var(--sb-r-chip)',
                      border: 'var(--sb-border-width) solid var(--sb-border)', background: 'var(--sb-card)', fontFamily: 'inherit',
                      fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)', textAlign: 'right',
                    }} />
                </label>

                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>
                  remind
                  <input
                    type="number" min={0} max={30}
                    value={r.leadDays}
                    onChange={e => putReminders(reminders.map(x => x.id === r.id
                      ? { ...x, leadDays: Math.min(30, Math.max(0, parseInt(e.target.value) || 0)) } : x))}
                    style={{
                      width: 50, height: 32, boxSizing: 'border-box', padding: '0 8px', borderRadius: 'var(--sb-r-chip)',
                      border: 'var(--sb-border-width) solid var(--sb-border)', background: 'var(--sb-card)', fontFamily: 'inherit',
                      fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)', textAlign: 'right',
                    }} />
                  days early
                </label>

                <span style={{ flex: 1 }} />

                <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', whiteSpace: 'nowrap' as const }}>
                  {r.enabled && nextUp
                    ? `next ${new Date(`${nextUp.date}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · ${reminderTitle(cat, budgetRules[r.categoryId], nextUp.monthKey)}`
                    : r.enabled ? 'nothing left this year' : 'off'}
                </span>

                <Toggle checked={r.enabled}
                  onChange={(v: boolean) => putReminders(reminders.map(x => x.id === r.id ? { ...x, enabled: v } : x))} />

                <button
                  onClick={() => putReminders(reminders.filter(x => x.id !== r.id))}
                  title="Remove this reminder"
                  style={{
                    width: 28, height: 28, borderRadius: 'var(--sb-r-pill)', padding: 0, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-4)', cursor: 'pointer',
                  }}>×</button>
              </div>
            )
          })}
          {reminders.some(r => r.enabled) && (
            <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', marginTop: 8 }}>
              Tasks are made for the next {reminders[0]?.monthsAhead ?? 3} months and topped up as
              time passes. Deleting one from the board does not bring it back.
            </div>
          )}
        </div>

      </div>

    </div>
  )
}

// ─── Billing Section (11A right column) ──────────────────────────────────────

function BillingSection() {
  const INVOICES = [
    { date: '14 Mar 2026', desc: 'Professor Pro · annual',   amount: '$180.00' },
    { date: '14 Mar 2025', desc: 'Professor Pro · annual',   amount: '$180.00' },
    { date: '02 Feb 2025', desc: 'Professor Plus · monthly', amount: '$18.00' },
  ]
  // Nothing in here is connected to anything: no plan is read, no card is
  // stored, and none of the eight buttons had a handler. It stays on screen
  // because the shape of it is the design, and it says what it is.
  return (
    <NotYet text="Billing coming soon">
    <div>
      {/* Plan tile */}
      <div style={{ padding: '16px 18px', borderRadius: 'var(--sb-r-nav)', background: 'var(--sb-accent-tint)', border: 'var(--sb-border-width) solid var(--sb-accent)', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h3)', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--sb-ink-1)' }}>Professor Pro</span>
              <span style={{ fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.1em', background: 'var(--sb-accent)', color: 'var(--sb-accent-ink)', padding: '3px 7px', borderRadius: 'var(--sb-r-chip)' }}>ANNUAL</span>
            </div>
            <p style={{ margin: 0, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.45 }}>Renews 14 March 2027 · all four companies, unlimited AI drafts</p>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <p style={{ margin: 0, fontSize: 'var(--sb-t-h1)', fontWeight: 700, fontFamily: 'var(--sb-font-num)', letterSpacing: '-0.03em', color: 'var(--sb-ink-1)', lineHeight: 1 }}>$180</p>
            <p style={{ margin: '2px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)' }}>per year</p>
          </div>
        </div>
      </div>

      {/* Billing fields */}
      <DRow label="Payment method">
        <span style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>Visa ending 4417 · expires 09/28</span>
        <VisaBadge />
        <GhostPill>Change</GhostPill>
      </DRow>

      <DRow label="Billing email" sub="Invoices are sent here every renewal">
        <PillValue>eng.bahaa.a@gmail.com</PillValue>
      </DRow>

      <DRow label="VAT / tax ID" sub="Appears on every invoice">
        <GhostPill>Add a tax ID</GhostPill>
      </DRow>

      <DRow label="Seats" sub="You plus nobody — this is a personal licence" last>
        <PillValue>1 of 1</PillValue>
      </DRow>

      {/* Invoices */}
      <div style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <p style={{ margin: 0, fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.14em', color: 'var(--sb-ink-3)', textTransform: 'uppercase' }}>Invoices</p>
          <button style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>Download all</button>
        </div>
        {INVOICES.map((inv, i) => (
          <div key={inv.date} style={{
            display: 'flex', alignItems: 'center', gap: 16,
            padding: '13px 0',
            borderBottom: i === INVOICES.length - 1 ? 'none' : 'var(--sb-border-width) solid var(--sb-hairline)',
          }}>
            <span style={{ width: 96, flexShrink: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>{inv.date}</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.desc}</span>
            <span style={{ fontSize: 'var(--sb-t-label)', fontFamily: 'var(--sb-font-num)', fontWeight: 600, color: 'var(--sb-ink-1)', flexShrink: 0 }}>{inv.amount}</span>
            <button title={`Download ${inv.date} invoice`} style={{
              background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-ink-4)',
              padding: 2, display: 'flex', alignItems: 'center', flexShrink: 0,
            }}><Download size={ICON.sm} /></button>
          </div>
        ))}
      </div>

      {/* Cancel */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
        marginTop: 18, paddingTop: 16, borderTop: 'var(--sb-border-width) solid var(--sb-hairline)',
      }}>
        <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-4)', lineHeight: 1.4 }}>
          Cancelling keeps your data readable until the term ends.
        </p>
        <GhostPill tone="rust">Cancel plan</GhostPill>
      </div>
    </div>
    </NotYet>
  )
}

// ─── Notifications Matrix Section (11F) ───────────────────────────────────────

type NChannel = NotifChannel
type NEvent = NotifSetting

function NotificationsMatrixSection() {
  const [events, setEvents] = useState<NEvent[]>(() => loadNotifSettings())
  // Quiet hours used to live in three pieces of component state — set them,
  // reload, and they were back at 22:30. The bell reads them, so they are kept.
  const [quiet, setQuiet] = useState(() => loadQuietHours())
  const quietOn = quiet.on, quietStart = quiet.start, quietEnd = quiet.end
  const setQuietOn = (on: boolean) => { const q = { ...quiet, on }; setQuiet(q); saveQuietHours(q) }
  const setQStart  = (start: string) => { const q = { ...quiet, start }; setQuiet(q); saveQuietHours(q) }
  const setQEnd    = (end: string) => { const q = { ...quiet, end }; setQuiet(q); saveQuietHours(q) }

  function toggleChannel(id: string, ch: NChannel) {
    const next = events.map(e => e.id === id ? { ...e, [ch]: !e[ch as keyof NEvent] } : e)
    setEvents(next)
    saveNotifSettings(next)
  }

  const ChHead = ({ label }: { label: string }) => (
    <div style={{ width: 44, textAlign: 'center', fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.09em', color: 'var(--sb-ink-4)', textTransform: 'uppercase' }}>{label}</div>
  )
  const ChToggle = ({ on, onClick }: { on: boolean; onClick: () => void }) => (
    <div style={{ width: 44, display: 'flex', justifyContent: 'center' }}>
      <Toggle checked={on} onChange={onClick} />
    </div>
  )

  return (
    <div>
      {/* Column headers */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 10, borderBottom: 'var(--sb-border-width) solid var(--sb-border)', marginBottom: 2 }}>
        <p style={{ margin: 0, fontSize: 'var(--sb-t-meta)', fontWeight: 700, color: 'var(--sb-ink-3)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>EVENT</p>
        <div style={{ display: 'flex', gap: 0 }}>
          <ChHead label="Push" />
          <ChHead label="Mail" />
          <ChHead label="Digest" />
        </div>
      </div>

      {/* Event rows */}
      {events.map(e => (
        <div key={e.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 0', borderBottom: 'var(--sb-border-width) solid var(--sb-hairline)' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', fontWeight: 500, color: 'var(--sb-ink-1)', lineHeight: 1.3, display: 'flex', alignItems: 'center', gap: 7 }}>
              {e.label}
              {/* Push is the channel this app delivers — a list under the bell.
                  Every kind is worked out; one whose source has not run yet
                  says what it is waiting on, which beats a bell that stays
                  empty for reasons nobody can see. */}
              {dormantWhy(e.id, events) && (
                <span style={{
                  fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)', fontWeight: 500,
                  padding: '1px 7px', borderRadius: 'var(--sb-r-pill)',
                  background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-hairline)',
                  whiteSpace: 'nowrap',
                }}>{dormantWhy(e.id, events)}</span>
              )}
            </p>
            <p style={{ margin: '1px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', lineHeight: 1.3 }}>{e.sub}</p>
          </div>
          <div style={{ display: 'flex', gap: 0, flexShrink: 0 }}>
            <ChToggle on={e.push}   onClick={() => toggleChannel(e.id, 'push')} />
            <ChToggle on={e.mail}   onClick={() => toggleChannel(e.id, 'mail')} />
            <ChToggle on={e.digest} onClick={() => toggleChannel(e.id, 'digest')} />
          </div>
        </div>
      ))}

      {/* Quiet hours */}
      <div style={{ marginTop: 18, padding: '14px 16px', borderRadius: 'var(--sb-r-nav)', background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: quietOn ? 10 : 0 }}>
          <div>
            <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-1)' }}>Quiet hours</p>
            <p style={{ margin: '1px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)' }}>Nothing but the morning brief gets through</p>
          </div>
          <Toggle checked={quietOn} onChange={setQuietOn} />
        </div>
        {quietOn && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input type="time" value={quietStart} onChange={e => setQStart(e.target.value)} style={{ padding: '5px 10px', borderRadius: 'var(--sb-r-chip)', border: 'var(--sb-border-width) solid var(--sb-border)', background: 'var(--sb-card)', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)' }} />
            <span style={{ color: 'var(--sb-ink-4)', fontSize: 'var(--sb-t-body-s)' }}>to</span>
            <input type="time" value={quietEnd} onChange={e => setQEnd(e.target.value)} style={{ padding: '5px 10px', borderRadius: 'var(--sb-r-chip)', border: 'var(--sb-border-width) solid var(--sb-border)', background: 'var(--sb-card)', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)' }} />
          </div>
        )}
      </div>

      {/* Mute button */}
      <button style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 'var(--sb-r-chip)', background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', fontSize: 'var(--sb-t-body-s)', fontWeight: 500, color: 'var(--sb-ink-3)', cursor: 'pointer' }}>
        🔕 Mute for 1h
      </button>
    </div>
  )
}

// ─── Integrations Section (11D) ───────────────────────────────────────────────

interface Integration {
  id: string; name: string; emoji: string; status: 'connected' | 'disconnected'
  account: string; tags: string[]; syncMode: 'two-way' | 'import' | 'off'; enabled: boolean
}

const DEFAULT_INTEGRATIONS: Integration[] = [
  { id: 'notion',      name: 'Notion',      emoji: '📝', status: 'connected',    account: 'Bahaa · 4 databases',            tags: ['Tasks database', 'Meeting notes', 'Weekly review'], syncMode: 'two-way', enabled: true  },
  { id: 'asana',       name: 'Asana',       emoji: '🎯', status: 'connected',    account: 'DX Technologies workspace',       tags: ['3 projects', 'My tasks', 'Due dates'],              syncMode: 'import',  enabled: true  },
  { id: 'trello',      name: 'Trello',      emoji: '📋', status: 'connected',    account: 'Personal board',                  tags: ['Ideas board', 'Cards → dump'],                     syncMode: 'import',  enabled: false },
  { id: 'apple-notes', name: 'Apple Notes', emoji: '🍎', status: 'disconnected', account: 'iCloud · eng.bahaa.a',            tags: ['Notes → dump', 'Needs iCloud sign-in'],            syncMode: 'off',     enabled: false },
]

function IntegrationsSection() {
  const [integrations, setIntegrations] = useState<Integration[]>(DEFAULT_INTEGRATIONS)

  function toggleEnabled(id: string) {
    setIntegrations(prev => prev.map(i => i.id === id ? { ...i, enabled: !i.enabled } : i))
  }

  return (
    <div>
      {/* Notion, Asana, Trello and Apple Notes: the accounts named on these
          cards are illustrative and the switches reach nothing — no task has
          ever crossed between this app and any of them. Google, below, is the
          one that is real, so only this half is marked. */}
      <NotYet text="Integrations coming soon">
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', fontWeight: 700, color: 'var(--sb-ink-1)' }}>Connected tools</p>
            <p style={{ margin: '1px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)' }}>Tasks and notes flow both ways — nothing is deleted on either side</p>
          </div>
          <Button variant="accent" style={{ flexShrink: 0 }}>
            <Plus size={ICON.sm} /> <span style={{ whiteSpace: 'nowrap' }}>Add integration</span>
          </Button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {integrations.map(tool => (
            <div key={tool.id} style={{
              padding: '11px 13px', borderRadius: 'var(--sb-r-nav)',
              background: tool.status === 'disconnected' ? 'var(--sb-accent-tint)' : 'var(--sb-card)',
              border: `var(--sb-border-width) solid ${tool.status === 'disconnected' ? 'var(--sb-border)' : tool.enabled ? 'var(--sb-positive-tint)' : 'var(--sb-border)'}`,
              borderStyle: tool.status === 'disconnected' ? 'dashed' : 'solid',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ width: 'var(--sb-h-nav)', height: 'var(--sb-h-nav)', borderRadius: 'var(--sb-r-sm)', background: 'var(--sb-page)', border: 'var(--sb-border-width) solid var(--sb-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--sb-t-h2)', flexShrink: 0 }}>
                  {tool.emoji}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <span style={{ fontSize: 'var(--sb-t-label)', fontWeight: 600, color: 'var(--sb-ink-1)' }}>{tool.name}</span>
                    <span style={{
                      fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.08em', padding: '2px 6px', borderRadius: 'var(--sb-r-chip)',
                      background: tool.status === 'connected' ? 'color-mix(in srgb, var(--sb-positive) 10.0%, transparent)' : 'color-mix(in srgb, var(--sb-ink-4) 12.0%, transparent)',
                      color: tool.status === 'connected' ? 'var(--sb-positive)' : 'var(--sb-ink-4)',
                      textTransform: 'uppercase',
                    }}>{tool.status === 'connected' ? 'Connected' : 'Not connected'}</span>
                  </div>
                  <p style={{ margin: '0 0 6px', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>{tool.account}</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {tool.tags.map(tag => (
                      <span key={tag} style={{ fontSize: 'var(--sb-t-micro)', padding: '2px 8px', borderRadius: 'var(--sb-r-card)', background: 'var(--sb-page)', border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-3)' }}>{tag}</span>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  {tool.status === 'connected' && (
                    <select value={tool.syncMode} onChange={e => setIntegrations(prev => prev.map(i => i.id === tool.id ? { ...i, syncMode: e.target.value as Integration['syncMode'] } : i))}
                      style={{ fontSize: 'var(--sb-t-meta)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-chip)', padding: '4px 8px', background: 'var(--sb-field)', color: 'var(--sb-ink-3)', cursor: 'pointer' }}>
                      <option value="two-way">Two-way</option>
                      <option value="import">Import only</option>
                      <option value="off">Off</option>
                    </select>
                  )}
                  {tool.status === 'connected'
                    ? <Toggle checked={tool.enabled} onChange={() => toggleEnabled(tool.id)} />
                    : <button style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 500, color: 'var(--sb-ink-3)', background: 'var(--sb-page)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-chip)', padding: '5px 11px', cursor: 'pointer' }}>Connect</button>
                  }
                </div>
              </div>
            </div>
          ))}
        </div>

        <p style={{ margin: '8px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', lineHeight: 1.5 }}>
          Last sync 07:12 — 14 tasks in, 3 completions pushed out. Tokens live on the server.{' '}
          <button style={{ background: 'none', border: 'none', color: 'var(--sb-positive)', fontSize: 'var(--sb-t-meta)', cursor: 'pointer', fontWeight: 600, padding: 0 }}>Sync now</button>
        </p>
      </div>
      </NotYet>

    </div>
  )
}

function SyncRulesSection() {
  return (
    <div>
      {[
        { label: 'Sync frequency',         sub: 'How often connected tools are polled',         value: 'Every 15 min' },
        { label: 'Imported tasks land in', sub: 'Untriaged work goes to the dump first',        value: 'The dump' },
        { label: 'Push completions back',  sub: 'Closing a task here closes it there',          value: 'On' },
        { label: 'Conflict wins',          sub: 'When both sides changed since the last sync',  value: 'Most recent edit' },
      ].map((row, i, arr) => (
        <div key={row.label} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          padding: '10px 0', borderBottom: i === arr.length - 1 ? 'none' : 'var(--sb-border-width) solid var(--sb-hairline)',
        }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', fontWeight: 500, color: 'var(--sb-ink-1)' }}>{row.label}</p>
            <p style={{ margin: '1px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)' }}>{row.sub}</p>
          </div>
          <select style={{ fontSize: 'var(--sb-t-body-s)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-chip)', padding: '5px 10px', background: 'var(--sb-field)', color: 'var(--sb-ink-1)', cursor: 'pointer', flexShrink: 0 }}>
            <option>{row.value}</option>
          </select>
        </div>
      ))}
    </div>
  )
}

// ─── Automation Section (11F) ─────────────────────────────────────────────────
// The switches are read by `lib/automation.ts`, which ticks once a minute while
// you are signed in; the footer is its run log, live. There is no "New rule":
// a rule is a switch on an engine, and a switch with nothing behind it is what
// this section used to be.

function AutomationSection() {
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
              <p style={{ margin: 0, fontSize: 'var(--sb-t-label)', fontWeight: 600, color: rule.enabled ? 'var(--sb-ink-1)' : 'var(--sb-ink-4)', lineHeight: 1.3 }}>
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
      <p style={{ margin: '14px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', lineHeight: 1.5 }}>
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
              <span style={{ fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)', fontVariantNumeric: 'tabular-nums', flexShrink: 0, width: 92 }}>
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

// ─── Data & Privacy Section (companies → data & privacy) ─────────────────────

function DataPrivacySection() {
  const [exportStatus, setExportStatus] = useState<'idle' | 'exporting' | 'done'>('idle')

  async function handleExport() {
    setExportStatus('exporting')
    await new Promise(r => setTimeout(r, 1200))
    setExportStatus('done')
    setTimeout(() => setExportStatus('idle'), 3000)
  }

  return (
    <div>
      {/* Data export card */}
      <div style={{ marginBottom: 18 }}>
        <p style={{ margin: '0 0 6px', fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-1)', textTransform: 'uppercase', letterSpacing: '0.09em' }}>Export</p>
        <div style={{ padding: '14px 16px', borderRadius: 'var(--sb-r-nav)', background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)' }}>
          <p style={{ margin: '0 0 10px', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', lineHeight: 1.5 }}>
            Download a copy of all your data — tasks, habits, companies, finance envelopes & settings.
          </p>
          <button onClick={handleExport} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 'var(--sb-r-chip)',
            background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
            fontSize: 'var(--sb-t-body-s)', fontWeight: 500, color: 'var(--sb-ink-1)', cursor: 'pointer',
          }}>
            <HardDrive size={ICON.sm} />
            {exportStatus === 'exporting' ? 'Preparing…' : exportStatus === 'done' ? 'Downloaded ✓' : 'Export all data'}
          </button>
        </div>
      </div>

      {/* Privacy controls */}
      <div style={{ marginBottom: 18 }}>
        <p style={{ margin: '0 0 6px', fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-1)', textTransform: 'uppercase', letterSpacing: '0.09em' }}>Privacy</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {[
            { label: 'Share usage analytics',  sub: 'Helps improve Professor', key: 'analytics' },
            { label: 'Crash reporting',         sub: 'Automatic error reports',  key: 'crash' },
          ].map((item, i, arr) => {
            const [on, setOn] = useState(true)
            return (
              <div key={item.key} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '11px 0',
                borderBottom: i < arr.length - 1 ? 'var(--sb-border-width) solid var(--sb-hairline)' : 'none',
              }}>
                <div>
                  <p style={{ margin: 0, fontSize: 'var(--sb-t-body)', fontWeight: 500, color: 'var(--sb-ink-1)' }}>{item.label}</p>
                  <p style={{ margin: '1px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)' }}>{item.sub}</p>
                </div>
                <Toggle checked={on} onChange={setOn} />
              </div>
            )
          })}
        </div>
      </div>

      {/* Account deletion */}
      <div>
        <p style={{ margin: '0 0 6px', fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-negative)', textTransform: 'uppercase', letterSpacing: '0.09em' }}>Danger zone</p>
        <div style={{ padding: '14px 16px', borderRadius: 'var(--sb-r-nav)', background: 'color-mix(in srgb, var(--sb-negative) 4.0%, transparent)', border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-negative) 22.0%, transparent)' }}>
          <p style={{ margin: '0 0 10px', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', lineHeight: 1.5 }}>
            Permanently delete your account and all associated data. This cannot be undone.
          </p>
          <button style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 'var(--sb-r-chip)',
            background: 'color-mix(in srgb, var(--sb-negative) 8.0%, transparent)', border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-negative) 30.0%, transparent)',
            fontSize: 'var(--sb-t-body-s)', fontWeight: 500, color: 'var(--sb-negative)', cursor: 'pointer',
          }}>
            <Trash2 size={ICON.sm} /> Delete account
          </button>
        </div>
      </div>
    </div>
  )
}

/** Accounts and the companies that use them, in one place (previously two
 *  cards on two different pages, which hid the link between them). */
function AccountsAndCompaniesSection({
  companies, setCompanies, accounts, setAccounts, primaryEmail,
}: {
  companies: CompanyRow[]
  setCompanies: (c: CompanyRow[]) => void
  accounts: ConnectedAccount[]
  setAccounts: (a: ConnectedAccount[]) => void
  primaryEmail: string
}) {
  // AccountsSection renders the sign-in account separately from `accounts`
  const accountCount = accounts.length + (primaryEmail ? 1 : 0)
  const linkedIds = new Set(companies.map(c => c.accountId).filter(Boolean))
  const unlinked = companies.filter(c => !c.accountId).length
  const unusedAccounts = accounts.filter(a => !linkedIds.has(a.id)).length

  return (
    <div>
      {/* How the two halves relate, stated once at the top */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        padding: '9px 12px', marginBottom: 12,
        background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-nav)',
      }}>
        <p style={{ margin: 0, flex: 1, minWidth: 180, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.45 }}>
          Connect a Google account, then point a company at it. Mail, calendars and
          Drive flow in through the account; the company decides how that work is
          tagged, coloured and assigned.
        </p>
        <span style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <span style={{ padding: '3px 9px', borderRadius: 'var(--sb-r-pill)', background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: 'var(--sb-ink-3)' }}>
            {accountCount} account{accountCount === 1 ? '' : 's'}
          </span>
          <span style={{ padding: '3px 9px', borderRadius: 'var(--sb-r-pill)', background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: 'var(--sb-ink-3)' }}>
            {companies.length} compan{companies.length === 1 ? 'y' : 'ies'}
          </span>
        </span>
      </div>

      {/* Accounts */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
        <Mail size={ICON.sm} color="var(--sb-ink-3)" />
        <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', fontWeight: 700, color: 'var(--sb-ink-1)' }}>Google accounts</p>
        {unusedAccounts > 0 && (
          <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)' }}>
            {unusedAccounts} not used by any company
          </span>
        )}
      </div>
      <AccountsSection accounts={accounts} setAccounts={setAccounts} primaryEmail={primaryEmail} companies={companies} />

      <div style={{ height: 1, background: 'var(--sb-hairline)', margin: '16px 0 14px' }} />

      {/* Companies */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
        <Building2 size={ICON.sm} color="var(--sb-ink-3)" />
        <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', fontWeight: 700, color: 'var(--sb-ink-1)' }}>Companies</p>
        {unlinked > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-negative)', fontWeight: 600 }}>
            {unlinked} not linked to an account
          </span>
        )}
      </div>
      <CompaniesSection companies={companies} setCompanies={setCompanies} accounts={accounts} primaryEmail={primaryEmail} />
    </div>
  )
}

// ─── Page layout definitions (multi-column pages matching design artboards) ───

type PageKey = 'you' | 'connected' | 'ai' | 'integrations' | 'work' | 'system' | 'display' | 'finance'

const SECTION_TO_PAGE: Record<SectionId, PageKey> = {
  profile: 'you',   billing: 'you',
  accounts: 'connected', schedule: 'connected',
  professor: 'ai',
  blocking: 'integrations',
  tasks: 'work',    habits: 'work',
  automation: 'system', notifications: 'system',
  appearance: 'display', behavioral: 'display', companies: 'display',
  finance: 'finance',
}

const PAGE_META: Record<PageKey, { title: string; sub: string }> = {
  you:          { title: 'You and your day',  sub: 'Who you are, and what the licence costs' },
  connected:    { title: 'Accounts and hours', sub: 'Your work contexts, and the shape of your working day' },
  ai:           { title: 'The AI',             sub: 'Which model, how far it may act, and how it sounds when it writes for you' },
  integrations: { title: 'Integrations',      sub: 'The tools that already hold your work — what comes in, what goes out, and how often' },
  work:         { title: 'Work',              sub: 'Board statuses, task types and the habits the tracker runs on' },
  system:       { title: 'System',            sub: 'Rules that run themselves, and what is allowed to interrupt you' },
  display:      { title: 'Look and limits',   sub: 'How it all looks, how you are scored, and where your data sits' },
  finance:      { title: 'Finance',           sub: 'How money is displayed and counted — including which envelope style the budget page opens in' },
}

// Card wrapper used in every multi-column page
function Card({ icon: Icon, title, sub, children, actions, muted }: {
  icon: React.ElementType
  title: string
  sub?: string
  children: React.ReactNode
  actions?: React.ReactNode
  muted?: boolean
}) {
  return (
    <div style={{
      background: 'var(--sb-card)',
      border: `var(--sb-border-width) solid ${muted ? 'var(--sb-border)' : 'var(--sb-border)'}`,
      borderRadius: 'var(--sb-r-card)',
      padding: '16px 20px 18px',
      boxShadow: 'var(--sb-shadow-control)',
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0,
      alignSelf: 'start',
      transition: 'border-color 0.15s',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 10, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11, minWidth: 0 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 'var(--sb-r-pill)', flexShrink: 0,
            background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon size={14} strokeWidth={1.9} color="var(--sb-ink-3)" />
          </div>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h3)', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--sb-ink-1)', lineHeight: 1.25 }}>{title}</h3>
            {sub && <p style={{
              margin: '1px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', lineHeight: 1.35,
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>{sub}</p>}
          </div>
        </div>
        {actions && <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>{actions}</div>}
      </div>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  )
}

function SectionCard({ id, active, children, actions, sub }: {
  id: SectionId
  active: boolean
  children: React.ReactNode
  actions?: React.ReactNode
  sub?: string
}) {
  const meta = SECTION_META.find(m => m.id === id)!
  return (
    <Card icon={meta.icon} title={meta.title} sub={sub ?? meta.description} actions={actions} muted={!active}>
      {children}
    </Card>
  )
}

// ─── CHUNK 7: Main Settings component ────────────────────────────────────────

export function Settings() {
  const [settings, setSettings]         = useState<AppSettings>(loadSettings)
  const [companies, setCompanies]       = useState<CompanyRow[]>(loadCompanies)
  const [accounts, setAccounts]         = useState<ConnectedAccount[]>(loadAccounts)
  const [_sectionOrder] = useState<SectionId[]>(loadSectionOrder) // eslint-disable-line @typescript-eslint/no-unused-vars
  const [activeSection, setActiveSection] = useState<SectionId>(() => {
    try { return (localStorage.getItem('settings-active-section') as SectionId) ?? 'profile' } catch { return 'profile' }
  })

  const [supaOk, setSupaOk]             = useState<boolean | null>(null)
  const [refreshing, setRefreshing]     = useState(false)
  // Per-section save states + error messages
  const [sectionSaving, setSectionSaving] = useState<Record<string, 'idle'|'saving'|'saved'|'error'>>({})
  const [_sectionError, setSectionError]  = useState<Record<string, string>>({}); void _sectionError
  const authUser = useAuthStore(s => s.user)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  // Gate for the profile autosave — false means "swallow the next change"
  const profileHydrated = useRef(false)

  // Primary email: authStore (persisted, instant) with supabase session as fallback
  const [primaryEmail, setPrimaryEmail] = useState<string>(authUser?.email ?? '')
  useEffect(() => {
    if (authUser?.email) { setPrimaryEmail(authUser.email); return }
    import('./../../lib/supabase').then(({ supabase }) =>
      supabase.auth.getSession().then(({ data }) => {
        if (data.session?.user?.email) setPrimaryEmail(data.session.user.email)
      })
    )
  }, [authUser?.email])

  // Re-read accounts when the add-account OAuth flow completes (App.tsx dispatches this event)
  useEffect(() => {
    const handler = () => { setAccounts(loadAccounts()) }
    window.addEventListener('professor:accountsUpdated', handler)
    return () => window.removeEventListener('professor:accountsUpdated', handler)
  }, [])

  useEffect(() => { void checkSupabase().then(setSupaOk) }, [])

  // ── On mount: load all data from DB (authoritative source) ───────────────────
  useEffect(() => {
    void (async () => {
      try {
        // Settings
        const dbSettings = await loadSettingsFromDB(DEFAULTS)
        // Swallow the autosave this hydration would otherwise trigger
        profileHydrated.current = false
        setSettings(dbSettings)
        saveSettings(dbSettings)

        // Companies (full — with users, emailDomain, accountId)
        const dbCompanies = await loadCompaniesFromDB()
        if (dbCompanies.length > 0) {
          // Merge: DB wins for metadata, but preserve localStorage-only fields
          const localBackup: Record<string, CompanyUser[]> = ls('professor-company-users', {})
          const localMap: Record<string, CompanyRow> = Object.fromEntries(companies.map(c => [c.id, c]))
          const merged = dbCompanies.map(c => ({
            ...c,
            users: c.users?.length ? c.users : (localBackup[c.id] ?? []),
            // hidden may not be in DB yet — fall back to local value
            hidden: c.hidden || localMap[c.id]?.hidden || false,
          }))
          setCompanies(merged)
          saveCompanies(merged)
        } else if (companies.length === 0) {
          // DB empty too — nothing to recover
        }

        // Connected accounts metadata from DB
        const dbAccounts = await loadAccountsFromDB()
        if (dbAccounts.length > 0) {
          // Merge: keep local providerTokens, fill in metadata from DB for any missing
          setAccounts(prev => {
            const merged = [...prev]
            for (const dba of dbAccounts) {
              if (!merged.find(a => a.email === dba.email)) {
                merged.push({ ...dba, providerToken: '' })
              }
            }
            return merged
          })
        }
      } catch { /* offline / not signed in */ }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Local-only field updates (immediate localStorage) ────────────────────────
  function update(patch: Partial<AppSettings>) {
    setSettings(prev => {
      const next = { ...prev, ...patch }
      saveSettings(next)
      return next
    })
  }

  // ── Profile autosave — the artboard swaps Save for "Setup wizard", and the
  //    rail footer promises "Every change saves itself". Debounced so typing
  //    the full name does not fire a write per keystroke. ────────────────────
  const profileKey = `${settings.fullName}|${settings.timezone}|${settings.framework}|${settings.workWeek.join(',')}`
  useEffect(() => {
    if (!profileHydrated.current) { profileHydrated.current = true; return }
    const t = setTimeout(() => {
      setSectionSaving(prev => ({ ...prev, profile: 'saving' }))
      saveProfileToDB(settingsRef.current)
        .then(() => {
          setSectionSaving(prev => ({ ...prev, profile: 'saved' }))
          setTimeout(() => setSectionSaving(prev => ({ ...prev, profile: 'idle' })), 2000)
        })
        .catch((err: unknown) => {
          console.error('[Settings autosave:profile]', err)
          setSectionSaving(prev => ({ ...prev, profile: 'error' }))
          setTimeout(() => setSectionSaving(prev => ({ ...prev, profile: 'idle' })), 5000)
        })
    }, 1200)
    return () => clearTimeout(t)
  }, [profileKey])

  // ── Pull the authoritative record back down from the DB ─────────────────────
  async function handleRefresh() {
    setRefreshing(true)
    try {
      const dbSettings = await loadSettingsFromDB(DEFAULTS)
      profileHydrated.current = false
      setSettings(dbSettings)
      saveSettings(dbSettings)
      const dbAccounts = await loadAccountsFromDB()
      if (dbAccounts.length > 0) {
        setAccounts(prev => {
          const merged = [...prev]
          for (const dba of dbAccounts) {
            if (!merged.find(a => a.email === dba.email)) merged.push({ ...dba, providerToken: '' })
          }
          return merged
        })
      }
      setSupaOk(await checkSupabase())
    } catch (err) {
      console.error('[Settings refresh]', err)
    } finally {
      setRefreshing(false)
    }
  }

  // ── Per-section DB save helper ───────────────────────────────────────────────
  function withSectionSave(sectionId: string, fn: () => Promise<void>) {
    return async () => {
      setSectionSaving(p => ({ ...p, [sectionId]: 'saving' }))
      setSectionError(p => ({ ...p, [sectionId]: '' }))
      try {
        await fn()
        setSectionSaving(p => ({ ...p, [sectionId]: 'saved' }))
        setTimeout(() => setSectionSaving(p => ({ ...p, [sectionId]: 'idle' })), 2000)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        console.error(`[Settings save:${sectionId}]`, msg)
        setSectionError(p => ({ ...p, [sectionId]: msg }))
        setSectionSaving(p => ({ ...p, [sectionId]: 'error' }))
        setTimeout(() => setSectionSaving(p => ({ ...p, [sectionId]: 'idle' })), 5000)
      }
    }
  }

  // ── Page renderer (multi-column layout per design artboards) ────────────────
  function renderPage() {
    const page = SECTION_TO_PAGE[activeSection]

    // Shared accounts list (primary + additional)
    const allAccounts: ConnectedAccount[] = [
      ...(primaryEmail ? [{
        id: 'primary', email: primaryEmail,
        name: authUser?.name ?? primaryEmail,
        providerToken: '', scopes: [], connectedAt: '', isPrimary: true,
      } as ConnectedAccount] : []),
      ...accounts,
    ]

    // Inline save button for cards that have a DB save
    function SaveBtn({ id }: { id: SectionId }) {
      const fns: Partial<Record<SectionId, () => Promise<void>>> = {
        schedule: () => saveProfileToDB(settingsRef.current),
        professor:() => savePrefsToDB(settingsRef.current),
        habits:   async () => { const { habits } = useHabitsStore.getState(); await saveHabitsToDB(habits); await saveHabitLogsToDB(loadLogs(), loadQuantityLogs()) },
        appearance:() => savePrefsToDB(settingsRef.current),
      }
      const fn = fns[id]
      if (!fn) return null
      const saving = sectionSaving[id] ?? 'idle'
      const label  = saving === 'saving' ? 'Saving…' : saving === 'saved' ? '✓ Saved' : saving === 'error' ? '✗ Error' : 'Save'
      return (
        <button onClick={withSectionSave(id, fn)} style={{
          padding: '4px 12px', borderRadius: 'var(--sb-r-chip)', fontSize: 'var(--sb-t-meta)', fontWeight: 600, cursor: 'pointer',
          background: saving === 'saved' ? 'color-mix(in srgb, var(--sb-positive) 12.0%, transparent)' : saving === 'error' ? 'color-mix(in srgb, var(--sb-negative) 10.0%, transparent)' : 'var(--sb-accent)',
          border: saving === 'saved' ? 'var(--sb-border-width) solid var(--sb-positive-tint)' : saving === 'error' ? 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-negative) 30.0%, transparent)' : 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-ink-1) 18.0%, transparent)',
          color: saving === 'saved' ? 'var(--sb-positive)' : saving === 'error' ? 'var(--sb-negative)' : 'var(--sb-accent-ink)',
          transition: 'all 0.15s',
        }}>{label}</button>
      )
    }

    // ── YOU page: Profile (left) + Billing (right) ──────────────────────────
    if (page === 'you') return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16, alignItems: 'start' }}>
          <SectionCard
            id="profile"
            active={activeSection === 'profile'}
            sub={[
              settings.fullName || authUser?.name || 'Professor User',
              supaOk === null ? 'Checking Supabase…' : supaOk ? 'Supabase connected' : 'Local only',
              `${allAccounts.length} account${allAccounts.length === 1 ? '' : 's'}`,
            ].join(' · ')}
            actions={
              <GhostPill icon={ArrowUpRight} onClick={() => window.dispatchEvent(new CustomEvent('professor:openWizard'))}>
                Setup wizard
              </GhostPill>
            }
          >
            <ProfileSection
              s={settings}
              set={update}
              name={authUser?.name ?? ''}
              email={primaryEmail}
              avatarUrl={authUser?.avatarUrl}
              onSignOut={() => void handleSignOut()}
              onRefresh={() => void handleRefresh()}
              refreshing={refreshing}
            />
          </SectionCard>
          <SectionCard id="billing" active={activeSection === 'billing'} actions={<GhostPill>Manage</GhostPill>}>
            <BillingSection />
          </SectionCard>
        </div>
      </div>
    )

    // ── CONNECTED page: Accounts | AI | Schedule rules ──────────────────────
    if (page === 'connected') return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.35fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
          <SectionCard id="accounts" active={activeSection === 'accounts'} actions={
            <button onClick={() => window.dispatchEvent(new CustomEvent('professor:openWizard'))} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 'var(--sb-r-chip)', background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-meta)', cursor: 'pointer' }}>
              <Wand2 size={ICON.sm} /> Wizard
            </button>
          }>
            <AccountsAndCompaniesSection
              companies={companies}
              setCompanies={c => { setCompanies(c); saveCompanies(c) }}
              accounts={accounts}
              setAccounts={setAccounts}
              primaryEmail={primaryEmail}
            />
          </SectionCard>
          <SectionCard id="schedule" active={activeSection === 'schedule'} actions={<SaveBtn id="schedule" />}>
            <ScheduleSection s={settings} set={update} />
          </SectionCard>
        </div>
      </div>
    )

    // ── AI page: the model and how it acts, beside how it sounds ────────────
    if (page === 'ai') return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16, alignItems: 'start' }}>
          <SectionCard id="professor" active={activeSection === 'professor'} actions={<SaveBtn id="professor" />}>
            <ProfessorSection />
          </SectionCard>
          <Card icon={Sparkles} title="Voice & instructions" sub="Tone, the morning brief, and what the assistant always knows">
            <AIVoiceSection s={settings} set={update} />
          </Card>
        </div>
      </div>
    )

    // ── INTEGRATIONS page ───────────────────────────────────────────────────
    if (page === 'integrations') return (
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        <SectionCard id="blocking" active={true} sub="Notion, Asana, Trello and Apple Notes">
          <IntegrationsSection />
        </SectionCard>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card icon={CalendarDays} title="Calendar blocking rules" sub="Which calendars block your focus time">
            <BlockingRulesSection />
          </Card>
          <Card icon={RefreshCw} title="Sync rules" sub="How often, where things land, who wins">
            <SyncRulesSection />
          </Card>
        </div>
      </div>
    )

    // ── WORK page: Tasks (left) + Habits (right) ────────────────────────────
    if (page === 'work') return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16, alignItems: 'start' }}>
          <SectionCard id="tasks" active={activeSection === 'tasks'}>
            <TaskStatusesSection />
          </SectionCard>
          <SectionCard id="habits" active={activeSection === 'habits'} actions={<SaveBtn id="habits" />}>
            <HabitsSection />
          </SectionCard>
        </div>
      </div>
    )

    // ── SYSTEM page: Automation | Notifications | Appearance+Behavioral+Privacy ─
    if (page === 'system') return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.15fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
          <SectionCard id="automation" active={activeSection === 'automation'}>
            <AutomationSection />
          </SectionCard>
          <SectionCard id="notifications" active={activeSection === 'notifications'}>
            <NotificationsMatrixSection />
          </SectionCard>
        </div>
      </div>
    )

    // ── LOOK AND LIMITS page ────────────────────────────────────────────────
    if (page === 'display') return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16, alignItems: 'start' }}>
        <SectionCard id="appearance" active={activeSection === 'appearance'} actions={<SaveBtn id="appearance" />}>
          <AppearanceSection s={settings} set={update} />
        </SectionCard>
        <SectionCard id="behavioral" active={activeSection === 'behavioral'}>
          <BehavioralSection />
        </SectionCard>
        <SectionCard id="companies" active={activeSection === 'companies'}>
          <DataPrivacySection />
        </SectionCard>
      </div>
    )

    // ── FINANCE page ────────────────────────────────────────────────────────
    return (
      <div>
        <SectionCard id="finance" active={true}>
          <FinanceSection />
        </SectionCard>
      </div>
    )
  }

  /** Download every locally-held settings blob as one JSON file. */
  function exportAllSettings() {
    const payload = {
      exportedAt: new Date().toISOString(),
      settings, companies,
      // providerToken is a live OAuth credential — never goes in an export
      accounts: accounts.map(a => ({
        id: a.id, email: a.email, name: a.name,
        scopes: a.scopes, connectedAt: a.connectedAt, isPrimary: a.isPrimary,
      })),
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `professor-settings-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleSignOut() {
    await googleSignOut()
  }

  function navItem(id: SectionId) {
    const meta = SECTION_META.find(m => m.id === id)!
    const Icon = meta.icon
    const isActive = id === activeSection

    let badge: number | null = null
    if (id === 'habits') {
      try {
        const hs = JSON.parse(localStorage.getItem('professor-habits') ?? '[]')
        const n  = hs.filter((h: { isActive?: boolean }) => h.isActive !== false).length
        badge = n > 0 ? n : null
      } catch { badge = null }
    } else if (id === 'blocking') {
      badge = 4
    }

    return (
      <button
        key={id}
        onClick={() => { setActiveSection(id); try { localStorage.setItem('settings-active-section', id) } catch { /* noop */ } }}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '5px 12px', borderRadius: 'var(--sb-r-sm)', cursor: 'pointer', marginBottom: 0,
          background: isActive ? 'var(--sb-ink-1)' : 'transparent',
          border: 'var(--sb-border-width) solid transparent',
          color: isActive ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-3)',
          fontSize: 'var(--sb-t-body)', fontWeight: isActive ? 600 : 500, textAlign: 'left' as const,
          fontFamily: 'inherit',
          transition: 'background 0.12s, color 0.12s',
        }}
      >
        <Icon size={15} strokeWidth={1.9} style={{ flexShrink: 0, opacity: isActive ? 1 : 0.8 }} />
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta.title}</span>
        {badge !== null && (
          <span style={{
            height: 17, minWidth: 17, boxSizing: 'border-box', padding: '0 5px', borderRadius: 'var(--sb-r-pill)',
            background: isActive ? 'color-mix(in srgb, var(--sb-ink-on-dark) 18%, transparent)' : 'var(--sb-field)',
            color: isActive ? 'var(--sb-ink-on-dark)' : 'var(--sb-ink-3)',
            fontSize: 'var(--sb-t-micro)', fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>{badge}</span>
        )}
      </button>
    )
  }

  const pm = PAGE_META[SECTION_TO_PAGE[activeSection]]

  return (
    // Pages are laid out to fit the viewport, so nothing scrolls at a normal
    // window height. minHeight (not height) means a very short window grows the
    // page and scrolls it rather than silently clipping a card.
    <div style={{
      minHeight: `calc(100vh - ${NAV_H})`, background: 'var(--sb-page)',
      display: 'flex', flexDirection: 'column', padding: '26px 36px 0',
    }}>

      {/* ── PAGE HEADER — spans the full width, above the rail ───────────── */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 20, marginBottom: 20, flexShrink: 0,
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.14em', color: 'var(--sb-ink-3)', textTransform: 'uppercase', marginBottom: 4 }}>SETTINGS</div>
          <h2 style={{ margin: 0, fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h1)', fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1.05, color: 'var(--sb-ink-1)' }}>{pm.title}</h2>
          <p style={{ margin: '5px 0 0', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', lineHeight: 1.4 }}>{pm.sub}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('professor:openWizard'))}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              padding: '10px 18px', borderRadius: 'var(--sb-r-pill)', cursor: 'pointer',
              background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-1)',
              fontSize: 'var(--sb-t-body)', fontWeight: 500, fontFamily: 'inherit',
              boxShadow: 'var(--sb-shadow-control)',
            }}>
            <ArrowUpRight size={ICON.sm} strokeWidth={STROKE.rest} /> Setup wizard
          </button>
          <button
            onClick={() => exportAllSettings()}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              padding: '10px 18px', borderRadius: 'var(--sb-r-pill)', cursor: 'pointer',
              background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-1)',
              fontSize: 'var(--sb-t-body)', fontWeight: 500, fontFamily: 'inherit',
              boxShadow: 'var(--sb-shadow-control)',
            }}>
            <Database size={ICON.sm} strokeWidth={STROKE.rest} /> Export
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 22, flex: 1, alignItems: 'stretch', paddingBottom: 26 }}>

        {/* ── LEFT RAIL — floating card ──────────────────────────────────── */}
        <div style={{
          width: 250, flexShrink: 0, display: 'flex', flexDirection: 'column',
          background: 'var(--sb-header)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-card)',
          boxShadow: 'var(--sb-shadow-control)', overflow: 'hidden',
        }}>
          {/* Search */}
          <div style={{ padding: '12px 12px 8px', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-nav)', padding: '8px 12px', cursor: 'text' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--sb-ink-4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
              <span style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-4)', flex: 1, userSelect: 'none' }}>Find a setting</span>
              <span style={{ fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)', opacity: 0.7 }}>⌘K</span>
            </div>
          </div>

          {/* Grouped nav */}
          <div style={{ padding: '0 12px', flex: 1, minHeight: 0 }}>
            {NAV_GROUPS.map(group => (
              <div key={group.label} style={{ marginBottom: 0 }}>
                <div style={{ fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.14em', color: 'var(--sb-ink-4)', padding: '7px 12px 3px', textTransform: 'uppercase' as const }}>
                  {group.label}
                </div>
                {group.ids.map(id => navItem(id))}
              </div>
            ))}
          </div>

          {/* Footer */}
          <div style={{ padding: '10px 18px 11px', borderTop: 'var(--sb-border-width) solid var(--sb-hairline)', flexShrink: 0 }}>
            <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ width: 6, height: 6, borderRadius: 'var(--sb-r-pill)', background: 'var(--sb-positive)', flexShrink: 0 }} />
              Every change saves itself
            </div>
            {/* Which build this page is. "It is not deployed" and "your browser
                is holding the last one" look identical from the outside, and
                without this the only way to tell them apart is to guess. */}
            <div
              title={`Built ${new Date(__BUILD_AT__).toLocaleString('en-GB')}`}
              style={{
                marginTop: 5, fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)',
                fontFamily: 'var(--sb-font-mono)', letterSpacing: '0.04em',
              }}>
              build {__BUILD_SHA__} · {new Date(__BUILD_AT__).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              {' '}{new Date(__BUILD_AT__).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
        </div>

        {/* ── RIGHT CONTENT PANEL ────────────────────────────────────────── */}
        <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          {renderPage()}
        </div>
      </div>
    </div>
  )
}

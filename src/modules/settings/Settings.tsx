// ─── CHUNK 1: Types, constants, localStorage helpers ─────────────────────────
// (remaining chunks appended below)

import { useState, useEffect, useRef, type ReactNode } from 'react'
import {
  Plus, Trash2, LogIn, LogOut,
  ChevronDown, ChevronUp, User, Clock, Building2, Flame,
  Brain, Bell, Palette, Link, X, RefreshCw, Eye, EyeOff, Shield, Pencil,
  Hash, CheckSquare, Mail, HardDrive, CalendarDays, Swords, Wand2, CreditCard, Sparkles,
  ArrowUpRight, Download, Database, GripVertical, ImagePlus, LocateFixed,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { connectAdditionalGoogleAccount, signOut as googleSignOut, disconnectGoogleAccount } from '@/lib/google'
import { useUIStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { THEMES, getTheme, applyThemeVars } from '@/lib/themes'
import { syncTimezoneFromLocation } from '@/lib/weather'
import { useHabitsStore, getHabitColors } from '@/store/habitsStore'
import { HABIT_VIEWS, loadHabitView, saveHabitView, EmojiBtn, type HabitView } from '@/modules/habits/HabitsModule'
import { useBehavioralStore, type BehavioralMode } from '@/store/behavioralStore'
import { loadAccounts, removeAccount, getProviderTokenForAccount, loadHiddenAccounts, saveHiddenAccounts, loadAccountsFromServer, type ConnectedAccount, type ServerAccount } from '@/lib/multiAccount'
import {
  saveProfileToDB, savePrefsToDB, saveCompaniesToDB, loadCompaniesFromDB,
  saveHabitsToDB, saveHabitLogsToDB, loadSettingsFromDB,
  saveAccountsToDB, loadAccountsFromDB,
  type CompanyRow as DbSyncCompanyRow,
} from '@/lib/dbSync'
import { loadLogs } from '@/store/habitsStore'
import {
  loadBlockingRules, saveBlockingRules,
  type BlockingRule, type DetailLevel,
  loadCachedCalendars, type CachedCalEntry,
} from '@/lib/blockingRules'
import { loadCustomStatuses, saveCustomStatuses, moveStatus, DEFAULT_STATUSES, type CustomStatus } from '@/lib/customStatuses'

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
  { id: 'appearance',    title: 'Appearance',           icon: Palette,     description: 'Theme, density, text size and motion' },
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
const C_COLORS     = ['#7F77DD','#7F77DD','#1D9E75','#E05252','#888780','#5B9BD5','#E0944A']
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
  background: '#FAF7EC',
  border: '1px solid #E8E1CE',
  borderRadius: 7, color: '#191712',
  fontSize: 13.5, padding: '7px 11px', outline: 'none',
  fontFamily: 'DM Sans, sans-serif', width: '100%', boxSizing: 'border-box' as const,
}
const selectStyle: React.CSSProperties = {
  ...inputStyle, cursor: 'pointer', width: 'auto',
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const accent = '#F5D14E'
  return (
    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      style={{
        width: 42, height: 24, borderRadius: 12, flexShrink: 0,
        background: checked ? accent : '#E8E1CE',
        border: 'none', cursor: 'pointer', position: 'relative', padding: 0, transition: 'background 0.2s',
      }}>
      <span style={{
        position: 'absolute', top: 4, left: checked ? 22 : 4,
        width: 16, height: 16, borderRadius: '50%', display: 'block',
        background: checked ? '#FFFFFF' : '#6C6553',
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
      padding: '5px 0', borderBottom: '1px solid #F0EBDC',
    }}>
      <div style={{ flex: '1 1 150px', minWidth: 0, maxWidth: 172, paddingTop: 2 }}>
        <span style={{ fontSize: 12.5, color: '#191712' }}>{label}</span>
        {sub && <p style={{ margin: '2px 0 0', fontSize: 10.5, color: '#6C6553', lineHeight: 1.4 }}>{sub}</p>}
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
  background: '#FAF7EC',
  border: '1px solid #E8E1CE',
  borderRadius: 9,
  color: '#191712',
  fontSize: 13,
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
      color: tone === 'rust' ? '#B4523A' : '#191712',
      borderColor: tone === 'rust' ? 'rgba(180,82,58,0.35)' : '#E8E1CE',
      background: tone === 'rust' ? '#FFFFFF' : '#FAF7EC',
    }}>
      {Icon && <Icon size={13} strokeWidth={2} />}
      {children}
    </button>
  )
}

/** Static cream pill for values that are displayed, not edited here. */
function PillValue({ children }: { children: ReactNode }) {
  return <span style={{ ...PILL_BASE, display: 'inline-block', color: '#191712' }}>{children}</span>
}

/** Label (+sub) on the left, control hard-right — the artboard row rhythm. */
function DRow({ label, sub, children, last }: {
  label: string; sub?: string; children: ReactNode; last?: boolean
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
      padding: '12px 0',
      borderBottom: last ? 'none' : '1px solid #F0EBDC',
    }}>
      <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 13.5, fontWeight: 500, color: '#191712', lineHeight: 1.3 }}>{label}</p>
        {sub && <p style={{ margin: '2px 0 0', fontSize: 11.5, color: '#9B9180', lineHeight: 1.35 }}>{sub}</p>}
      </div>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10 }}>{children}</div>
    </div>
  )
}

/** Segmented control — active option is a white pill on a cream track. */
function Segmented<T extends string>({ value, options, onChange }: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 2, padding: 3,
      background: '#FAF7EC', border: '1px solid #E8E1CE', borderRadius: 10,
    }}>
      {options.map(o => {
        const on = o.value === value
        return (
          <button key={o.value} onClick={() => onChange(o.value)} style={{
            padding: '6px 14px', borderRadius: 8, fontSize: 12.5, cursor: 'pointer',
            fontWeight: on ? 600 : 500,
            fontFamily: 'inherit',
            background: on ? '#FFFFFF' : 'transparent',
            border: on ? '1px solid rgba(25,23,18,0.08)' : '1px solid transparent',
            boxShadow: on ? '0 1px 2px rgba(25,23,18,0.10)' : 'none',
            color: on ? '#191712' : '#9B9180',
            transition: 'all 0.12s',
          }}>{o.label}</button>
        )
      })}
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
      width: 30, height: 19, borderRadius: 4, background: '#1A1F71',
      color: '#FFFFFF', fontSize: 8.5, fontWeight: 700, fontStyle: 'italic',
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

  return (
    <div>
      {/* Identity block */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        paddingBottom: 18, borderBottom: '1px solid #F0EBDC',
      }}>
        {avatarUrl
          ? <img src={avatarUrl} alt="" style={{ width: 46, height: 46, borderRadius: '50%', border: '1px solid #E8E1CE', flexShrink: 0, objectFit: 'cover' }} />
          : <div style={{
              width: 46, height: 46, borderRadius: '50%', flexShrink: 0,
              background: '#F0EBDC', border: '1px solid #E8E1CE',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 15, fontWeight: 700, color: '#6C6553', letterSpacing: '0.02em',
            }}>{initials}</div>
        }
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{
            margin: 0, fontFamily: 'Outfit, sans-serif', fontSize: 17, fontWeight: 600,
            letterSpacing: '-0.02em', color: '#191712', lineHeight: 1.25,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{s.fullName || name || 'Professor User'}</p>
          <p style={{
            margin: '2px 0 0', fontSize: 12, color: '#9B9180', lineHeight: 1.3,
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
            width: 36, height: 36, borderRadius: 9, flexShrink: 0, padding: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: '#FFFFFF', border: '1px solid #E8E1CE',
            color: tzSyncing ? '#9B9180' : '#6C6553',
            cursor: tzSyncing ? 'default' : 'pointer',
          }}>
          <LocateFixed size={15} style={tzSyncing ? { opacity: 0.5 } : undefined} />
        </button>
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
                  padding: '7px 11px', borderRadius: 8, fontSize: 12.5, cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontWeight: on ? 600 : 500,
                  background: on ? '#191712' : '#FAF7EC',
                  border: `1px solid ${on ? '#191712' : '#E8E1CE'}`,
                  color: on ? '#FFFFFF' : '#6C6553',
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
          <span style={{ color: '#6C6553', fontSize: 11 }}>to</span>
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
                padding: '4px 10px', borderRadius: 6, fontSize: 11.5, cursor: 'pointer', fontWeight: 500,
                background: s.bufferMins === n ? 'rgba(245,209,78,0.12)' : '#FAF7EC',
                border: `1px solid ${s.bufferMins === n ? '#F5D14E' : '#E8E1CE'}`,
                color: s.bufferMins === n ? '#F5D14E' : '#6C6553',
              }}>{n === 0 ? 'None' : `${n}m`}</button>
          ))}
        </div>
      </FieldRow>
      <FieldRow label="Physical buffer" sub="Travel time">
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {PHYS_STEPS.map(n => (
            <button key={n} onClick={() => set({ physicalBufferMins: n })}
              style={{
                padding: '4px 10px', borderRadius: 6, fontSize: 11.5, cursor: 'pointer', fontWeight: 500,
                background: s.physicalBufferMins === n ? 'rgba(245,209,78,0.12)' : '#FAF7EC',
                border: `1px solid ${s.physicalBufferMins === n ? '#F5D14E' : '#E8E1CE'}`,
                color: s.physicalBufferMins === n ? '#F5D14E' : '#6C6553',
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
    background: 'transparent', border: 'none', borderBottom: '1px solid #7F77DD',
    outline: 'none', color: '#191712', fontFamily: 'inherit', padding: '0 2px',
  }

  return (
    <div style={{ background: '#F7F4EA', border: '1px solid #E8E1CE', borderRadius: 10, marginBottom: 8, overflow: 'visible', opacity: co.hidden ? 0.55 : 1, transition: 'opacity 0.15s' }}>
      {/* Company header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px' }}>

        {/* Color circle → color picker */}
        <div ref={colorRef} style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => setColorOpen(o => !o)}
            title="Change color"
            style={{
              width: 18, height: 18, borderRadius: '50%', background: co.color, cursor: 'pointer',
              border: `2px solid ${co.color}60`, flexShrink: 0,
            }}
          />
          {colorOpen && (
            <div style={{
              position: 'absolute', top: 24, left: 0, zIndex: 200,
              background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 10,
              padding: '7px 8px', display: 'flex', gap: 5,
              boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
            }}>
              {C_COLORS.map(c => (
                <button key={c} onClick={() => { onUpdate({ color: c }); setColorOpen(false) }}
                  style={{
                    width: 16, height: 16, borderRadius: '50%', background: c,
                    border: 'none', cursor: 'pointer', flexShrink: 0,
                    boxShadow: co.color === c ? `0 0 0 2px #FFFFFF, 0 0 0 3.5px ${c}` : 'none',
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
              style={{ ...tinp, fontSize: 13.5, fontWeight: 600, width: 160 }}
            />
          ) : (
            <span onClick={() => setEditingName(true)} title="Click to rename"
              style={{ fontSize: 13.5, fontWeight: 600, color: '#191712', cursor: 'text', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {co.name || 'Untitled'}
            </span>
          )}
          {editingDomain ? (
            <input autoFocus value={domainDraft}
              onChange={e => setDomainDraft(e.target.value)}
              onBlur={saveDomain}
              onKeyDown={e => { if (e.key === 'Enter') saveDomain(); if (e.key === 'Escape') { setDomainDraft(co.emailDomain); setEditingDomain(false) } }}
              placeholder="@domain.com"
              style={{ ...tinp, fontSize: 10.5, color: '#6C6553', width: 140 }}
            />
          ) : (
            <span onClick={() => setEditingDomain(true)} title="Click to set domain"
              style={{ fontSize: 10.5, color: co.emailDomain ? '#6C6553' : '#E8E1CE', cursor: 'text' }}>
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
            ...selectStyle, fontSize: 11, padding: '3px 8px', maxWidth: 168, flexShrink: 0,
            borderColor: co.accountId ? '#C8DAB0' : '#E0D6BC',
            background: co.accountId ? 'rgba(95,112,56,0.08)' : '#FFFFFF',
            color: co.accountId ? '#5F7038' : '#9B9180',
          }}>
          <option value="">{accounts.length > 0 ? 'Link an account…' : 'No accounts connected'}</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.email}</option>)}
        </select>

        {/* Users expand toggle */}
        <button onClick={() => setUsersOpen(o => !o)} title={usersOpen ? 'Collapse members' : 'Expand members'} style={{
          display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0,
          padding: '2px 7px', borderRadius: 5, fontSize: 10.5, cursor: 'pointer',
          background: 'transparent', border: '1px solid #E8E1CE',
          color: '#6C6553',
        }}>
          <span style={{ color: co.color, fontWeight: 600 }}>{users.length}</span>
          {usersOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
        </button>

        <Toggle checked={co.isActive} onChange={v => onUpdate({ isActive: v })} />

        {/* Hide from platform toggle */}
        <button
          onClick={() => onUpdate({ hidden: !co.hidden })}
          title={co.hidden ? 'Show in platform' : 'Hide from platform (tasks, calendar, dashboard…)'}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 3,
            display: 'flex', alignItems: 'center',
            color: co.hidden ? '#F5D14E' : '#6C6553',
          }}
        >
          {co.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>

        <button onClick={onDelete}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6C6553', padding: 3, display: 'flex', alignItems: 'center' }}>
          <Trash2 size={12} />
        </button>
      </div>

      {/* Users tree */}
      {usersOpen && (
        <div style={{ borderTop: '1px solid #E8E1CE', padding: '8px 14px 10px 46px' }}>
          {users.length === 0 && (
            <p style={{ margin: '0 0 6px', fontSize: 11, color: '#E8E1CE', fontStyle: 'italic' }}>No members yet</p>
          )}

          {users.map(u => {
            const isEditing = editingUserId === u.id
            const draft = userDrafts[u.id]
            return (
              <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid #E8E1CE' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: co.color, flexShrink: 0 }} />

                {isEditing ? (
                  <>
                    <input autoFocus value={draft?.name ?? u.name}
                      onChange={e => setUserDrafts(d => ({ ...d, [u.id]: { ...d[u.id], name: e.target.value } }))}
                      onBlur={() => saveUser(u.id)}
                      onKeyDown={e => { if (e.key === 'Enter') saveUser(u.id); if (e.key === 'Escape') setEditingUserId(null) }}
                      style={{ ...tinp, fontSize: 12, width: 120 }}
                    />
                    <input value={draft?.email ?? (u.email ?? '')}
                      onChange={e => setUserDrafts(d => ({ ...d, [u.id]: { ...d[u.id], email: e.target.value } }))}
                      onBlur={() => saveUser(u.id)}
                      onKeyDown={e => { if (e.key === 'Enter') saveUser(u.id); if (e.key === 'Escape') setEditingUserId(null) }}
                      placeholder="email"
                      style={{ ...tinp, fontSize: 11, color: '#6C6553', flex: 1 }}
                    />
                  </>
                ) : (
                  <>
                    <span onClick={() => startEditUser(u)} style={{ fontSize: 12, color: '#191712', cursor: 'text', minWidth: 60 }}>{u.name}</span>
                    <span onClick={() => startEditUser(u)} style={{ fontSize: 11, color: '#6C6553', cursor: 'text', flex: 1 }}>
                      {u.email || <span style={{ color: '#E8E1CE' }}>+ email</span>}
                    </span>
                  </>
                )}

                <button onClick={() => removeUser(u.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6C6553', padding: 2, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                  <Trash2 size={10} />
                </button>
              </div>
            )
          })}

          {/* Add user row */}
          <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
            <Plus size={10} color="#6B7280" style={{ flexShrink: 0 }} />
            <input value={newUserName} onChange={e => setNewUserName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addUser() }}
              placeholder="Name"
              style={{ ...inputStyle, fontSize: 11, padding: '3px 7px', width: 110 }} />
            <input value={newUserEmail} onChange={e => setNewUserEmail(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addUser() }}
              placeholder="Email (optional)"
              style={{ ...inputStyle, fontSize: 11, padding: '3px 7px', flex: 1 }} />
            <button onClick={addUser} disabled={!newUserName.trim()} style={{
              padding: '3px 10px', borderRadius: 5, fontSize: 11, fontWeight: 500, cursor: 'pointer',
              background: 'rgba(245,209,78,0.12)', border: '1px solid #7F77DD50',
              color: '#7F77DD', opacity: newUserName.trim() ? 1 : 0.4,
            }}>Add</button>
          </div>
        </div>
      )}
    </div>
  )
}

function CompaniesSection({
  companies, setCompanies, accounts,
}: {
  companies: CompanyRow[]
  setCompanies: (c: CompanyRow[]) => void
  accounts: ConnectedAccount[]
}) {
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
        <CompanyCard key={co.id} co={co} accounts={accounts}
          onUpdate={patch => updateCompany(co.id, patch)}
          onDelete={() => deleteCompany(co.id)} />
      ))}

      {adding ? (
        <div style={{ marginTop: 14, padding: '14px', background: '#FAF7EC', borderRadius: 10, border: '1px solid #E8E1CE' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Company name"
              style={{ ...inputStyle, width: 160 }} autoFocus />
            <input value={newDomain} onChange={e => setNewDomain(e.target.value)} placeholder="@domain.com"
              style={{ ...inputStyle, width: 170 }} />
            {accounts.length > 0 && (
              <select value={newAccountId} onChange={e => setNewAccountId(e.target.value)} style={{ ...selectStyle, width: 180 }}>
                <option value="">No account</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.email}</option>)}
              </select>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {C_COLORS.map(c => (
              <button key={c} onClick={() => setNewColor(c)}
                style={{ width: 22, height: 22, borderRadius: '50%', background: c, border: 'none', cursor: 'pointer', outline: newColor === c ? `2px solid ${c}` : 'none', outlineOffset: 2 }} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setAdding(false); setNewName('') }}
              style={{ padding: '6px 14px', borderRadius: 7, background: 'transparent', border: '1px solid #E8E1CE', color: '#6C6553', fontSize: 12, cursor: 'pointer', display: 'flex', gap: 5, alignItems: 'center' }}>
              <X size={11} /> Cancel
            </button>
            <button onClick={addCompany} disabled={!newName.trim()}
              style={{ padding: '6px 16px', borderRadius: 7, background: 'rgba(245,209,78,0.12)', border: '1px solid #F5D14E50', color: '#191712', fontSize: 12, fontWeight: 500, cursor: 'pointer', opacity: newName.trim() ? 1 : 0.4, display: 'flex', gap: 5, alignItems: 'center' }}>
              <Plus size={11} /> Add Company
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} style={{
          marginTop: 12, display: 'flex', alignItems: 'center', gap: 7, width: '100%',
          padding: '11px 16px', borderRadius: 9, background: 'transparent',
          border: '1px dashed #E8E1CE',
          color: '#6C6553', fontSize: 13, cursor: 'pointer',
        }}>
          <Plus size={13} /> Add a company / context
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
          width: 30, height: 30, borderRadius: 8, flexShrink: 0, padding: 0, overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#FAF7EC', border: '1px solid #E8E1CE', cursor: 'pointer', fontSize: 16,
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
  name: string; emoji: string; color: string; freq: typeof FREQ_OPTS[number]
  type: 'boolean' | 'quantity'; goal: string; unit: string
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
    display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
    color: '#6C6553', textTransform: 'uppercase', marginBottom: 7,
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 18, marginTop: 12,
      padding: 18, background: '#FAF7EC', borderRadius: 12, border: '1px solid #E8E1CE',
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
                width: 46, height: 46, borderRadius: 13, padding: 0, cursor: 'pointer', overflow: 'hidden',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 20, color: '#C9C0A8', background: '#FFFFFF', border: '1px solid #E8E1CE',
              }}>
              {s.image
                ? <img src={s.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                : <ImagePlus size={18} />}
            </button>
            {s.image && (
              <button
                type="button"
                onClick={() => update({ image: undefined })}
                title="Remove picture"
                style={{
                  position: 'absolute', top: -5, right: -5, width: 18, height: 18, borderRadius: '50%',
                  padding: 0, cursor: 'pointer', background: '#191712', border: '2px solid #FAF7EC',
                  color: '#FDF8E7', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                <X size={9} strokeWidth={3} />
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
          {!s.image && <span style={{ color: '#9B9180', fontSize: 10 }}>Picture</span>}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          <EmojiBtn value={s.emoji || '🎯'} onSelect={v => update({ emoji: v })} size={46} />
          <span style={{ color: '#9B9180', fontSize: 10 }}>Icon</span>
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
              background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 10,
              fontSize: 14, color: '#191712', fontFamily: 'inherit', outline: 'none', textAlign: 'left',
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
                width: 90, boxSizing: 'border-box', height: 36, padding: '0 12px',
                background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 9,
                fontSize: 13, color: '#191712', fontFamily: 'inherit', outline: 'none', textAlign: 'left',
              }} />
            <input value={s.unit} onChange={e => update({ unit: e.target.value })}
              placeholder="glasses / miles / minutes…"
              style={{
                flex: 1, minWidth: 0, boxSizing: 'border-box', height: 36, padding: '0 12px',
                background: '#FFFFFF', border: '1px solid #E8E1CE', borderRadius: 9,
                fontSize: 13, color: '#191712', fontFamily: 'inherit', outline: 'none', textAlign: 'left',
              }} />
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, paddingTop: 2 }}>
        <button onClick={() => valid && onSave(s)} disabled={!valid}
          style={{
            height: 38, padding: '0 18px', borderRadius: 999, border: 'none',
            background: valid ? '#F5D14E' : '#EDE7D9', color: valid ? '#191712' : '#9B9180',
            fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
            cursor: valid ? 'pointer' : 'default',
            display: 'flex', gap: 6, alignItems: 'center',
          }}>
          <Plus size={14} /> {saveLabel}
        </button>
        <button onClick={onCancel}
          style={{
            height: 38, padding: '0 16px', borderRadius: 999,
            background: 'transparent', border: '1px solid #E8E1CE', color: '#6C6553',
            fontSize: 13, fontFamily: 'inherit', cursor: 'pointer',
            display: 'flex', gap: 6, alignItems: 'center',
          }}>
          <X size={13} /> Cancel
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
      <p style={{ margin: '0 0 14px', fontSize: 12.5, color: '#6C6553' }}>
        Changes here instantly sync with the Habits Tracker page.
      </p>

      {/* Which view the Habits page opens on — switching it there sticks too */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', paddingBottom: 14, marginBottom: 4, borderBottom: '1px solid #E8E1CE' }}>
        <div style={{ flex: '1 1 150px', minWidth: 0, maxWidth: 200 }}>
          <div style={{ fontSize: 13, color: '#191712' }}>Default view</div>
          <div style={{ fontSize: 11.5, color: '#9B9180', marginTop: 2 }}>
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
            padding: '10px 0', borderBottom: '1px solid #E8E1CE',
            opacity: h.isActive ? 1 : 0.5,
          }}>
            <HabitRowImage
              image={h.image}
              emoji={h.emoji}
              onChange={img => updateHabit(h.id, { image: img })}
            />
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: h.color, flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 13.5, color: '#191712' }}>{h.name}</span>
            <span style={{ fontSize: 11.5, color: '#9B9180', flexShrink: 0, whiteSpace: 'nowrap' }}>
              {describeHabit(h)}
            </span>
            <Toggle checked={h.isActive} onChange={() => toggle(h.id)} />
            <button onClick={() => setEditingId(editingId === h.id ? null : h.id)} title="Edit habit"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: editingId === h.id ? '#F5D14E' : '#6C6553', padding: 4 }}>
              <Pencil size={13} />
            </button>
            <button onClick={() => { if (editingId === h.id) setEditingId(null); storeDel(h.id) }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6C6553', padding: 4 }}>
              <Trash2 size={13} />
            </button>
          </div>

          {/* Inline edit form */}
          {editingId === h.id && editingHabit && (
            <SettingsHabitForm
              key={h.id + '-edit'}
              initial={{
                name: h.name, emoji: h.emoji, color: h.color, image: h.image,
                freq: h.frequency as typeof FREQ_OPTS[number],
                type: h.type ?? 'boolean',
                goal: h.goal != null ? String(h.goal) : '',
                unit: h.unit ?? '',
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
                setEditingId(null)
              }}
              onCancel={() => setEditingId(null)}
            />
          )}
        </div>
      ))}

      {adding ? (
        <SettingsHabitForm
          initial={{ name: '', emoji: '🎯', color: COLORS[habits.length % COLORS.length], freq: 'daily', type: 'boolean', goal: '', unit: '' }}
          onSave={s => {
            storeAdd({
              name: s.name.trim(), emoji: s.emoji, color: s.color, image: s.image,
              frequency: s.freq, isActive: true,
              type: s.type,
              goal: s.type === 'quantity' ? parseFloat(s.goal) : undefined,
              unit: s.type === 'quantity' ? s.unit.trim() : undefined,
            })
            setAdding(false)
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button onClick={() => { setEditingId(null); setAdding(true) }} style={{
          marginTop: 12, display: 'flex', alignItems: 'center', gap: 7, width: '100%',
          padding: '11px 16px', borderRadius: 9, background: 'transparent',
          border: '1px dashed #E8E1CE',
          color: '#6C6553', fontSize: 13, cursor: 'pointer',
        }}>
          <Plus size={13} /> Add a habit
        </button>
      )}
    </div>
  )
}

// ─── Task Statuses Section ───────────────────────────────────────────────────

const STATUS_COLORS_PRESETS = ['#6B7280','#3B82F6','#F59E0B','#EF4444','#F97316','#10B981','#8B5CF6','#EC4899','#14B8A6','#F97316']

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
  const [draft, setDraft] = useState<{ id: string; label: string; color: string }>({ id: '', label: '', color: '#6B7280' })

  function persist(next: CustomStatus[]) {
    setStatuses(next)
    saveCustomStatuses(next)
  }

  function startAdd() {
    setEditIdx(null)
    setDraft({ id: '', label: '', color: '#6B7280' })
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
    <div style={{ padding: '10px 14px', background: '#FAF7EC', borderRadius: 8, border: '1px solid #E8E1CE', marginTop: 4, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: '#6C6553', marginBottom: 4, fontWeight: 600 }}>Label</div>
          <input value={draft.label} onChange={e => setDraft(p => ({ ...p, label: e.target.value }))}
            placeholder="e.g. In Review" autoFocus
            style={{ ...inputStyle, fontSize: 12.5 }}
            onKeyDown={e => { if (e.key === 'Enter') confirmSave(); if (e.key === 'Escape') { setAdding(false); setEditIdx(null) } }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: '#6C6553', marginBottom: 4, fontWeight: 600 }}>ID (slug)</div>
          <input value={draft.id} onChange={e => setDraft(p => ({ ...p, id: e.target.value }))}
            placeholder="auto from label"
            style={{ ...inputStyle, fontSize: 12.5 }} />
        </div>
      </div>
      <div>
        <div style={{ fontSize: 11, color: '#6C6553', marginBottom: 6, fontWeight: 600 }}>Color</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {STATUS_COLORS_PRESETS.map(c => (
            <button key={c} onClick={() => setDraft(p => ({ ...p, color: c }))} style={{
              width: 22, height: 22, borderRadius: '50%', background: c, border: 'none', cursor: 'pointer',
              outline: draft.color === c ? `2px solid ${c}` : 'none', outlineOffset: 2,
            }} />
          ))}
          <input type="color" value={draft.color} onChange={e => setDraft(p => ({ ...p, color: e.target.value }))}
            style={{ width: 22, height: 22, border: 'none', borderRadius: '50%', padding: 0, cursor: 'pointer', background: 'transparent' }} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => { setAdding(false); setEditIdx(null) }}
          style={{ padding: '5px 12px', borderRadius: 6, background: 'transparent', border: '1px solid #E8E1CE', color: '#6C6553', fontSize: 12, cursor: 'pointer', display: 'flex', gap: 4, alignItems: 'center' }}>
          <X size={11} /> Cancel
        </button>
        <button onClick={confirmSave}
          style={{ padding: '5px 14px', borderRadius: 6, background: 'rgba(245,209,78,0.12)', border: '1px solid #F5D14E50', color: '#191712', fontSize: 12, fontWeight: 500, cursor: 'pointer', display: 'flex', gap: 4, alignItems: 'center' }}>
          <Plus size={11} /> {adding ? 'Add Status' : 'Save'}
        </button>
      </div>
    </div>
  )

  return (
    <div>
      <p style={{ margin: '0 0 14px', fontSize: 12.5, color: '#6C6553' }}>
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
              padding: '9px 0', borderBottom: '1px solid #E8E1CE',
              background: overIdx === i ? 'rgba(245,209,78,0.10)' : 'transparent',
            }}>
            <span title="Drag to reorder" style={{ display: 'flex', color: '#C9C0A8', cursor: 'grab', flexShrink: 0 }}>
              <GripVertical size={14} />
            </span>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 13.5, color: '#191712' }}>{s.label}</span>
            <span style={{ fontSize: 10.5, color: '#6C6553', background: '#FAF7EC', padding: '2px 7px', borderRadius: 4, border: '1px solid #E8E1CE' }}>
              {s.id}
            </span>
            <button onClick={() => startEdit(i)} title="Edit"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: isEditingRow(i) ? '#F5D14E' : '#6C6553', padding: 4 }}>
              <Pencil size={13} />
            </button>
            <button onClick={() => remove(i)} title="Delete"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6C6553', padding: 4 }}>
              <Trash2 size={13} />
            </button>
          </div>
          {isEditingRow(i) && formEl}
        </div>
      ))}

      {adding && formEl}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button onClick={startAdd} style={{
          flex: 1, display: 'flex', alignItems: 'center', gap: 7,
          padding: '11px 16px', borderRadius: 9, background: 'transparent',
          border: '1px dashed #E8E1CE',
          color: '#6C6553', fontSize: 13, cursor: 'pointer',
        }}>
          <Plus size={13} /> Add a status
        </button>
        <button onClick={resetDefaults} title="Reset to defaults" style={{
          padding: '11px 14px', borderRadius: 9, background: 'transparent',
          border: '1px solid #E8E1CE',
          color: '#6C6553', fontSize: 12, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 5,
        }}>
          <RefreshCw size={12} /> Reset
        </button>
      </div>
    </div>
  )
}

// ─── CHUNK 5: Connected Accounts (multi-Google) ───────────────────────────────

function IntegrationBadge({ icon, label, active, onGrant }: {
  icon: ReactNode; label: string; active: boolean; onGrant?: () => void
}) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 7px', borderRadius: 20, fontSize: 10, fontWeight: 500,
      background: active ? 'rgba(29,158,117,0.1)' : 'rgba(100,116,139,0.1)',
      border: `1px solid ${active ? 'rgba(29,158,117,0.3)' : 'rgba(100,116,139,0.25)'}`,
      color: active ? '#1D9E75' : '#64748B',
    }}>
      {icon}{label}
      {!active && onGrant && (
        <button onClick={onGrant} style={{
          marginLeft: 3, background: 'none', border: 'none', cursor: 'pointer',
          color: '#3D3926', fontSize: 9, fontWeight: 600, padding: 0,
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

  return (
    <div>

      {/* Primary account */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 14px', borderRadius: 10, marginBottom: 10,
        background: '#FAF7EC',
        border: '1px solid #F5D14E30',
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
          background: 'rgba(245,209,78,0.12)', border: '1px solid #F5D14E40',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#191712',
        }}>
          {primaryEmail ? primaryEmail[0].toUpperCase() : 'G'}
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: '#191712' }}>{primaryEmail || 'Primary Google Account'}</p>
          <div style={{ margin: '5px 0 0', display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            <IntegrationBadge icon={<CalendarDays size={10} />} label="Calendar" active />
            <IntegrationBadge icon={<Mail size={10} />} label="Gmail" active />
            <IntegrationBadge icon={<HardDrive size={10} />} label="Drive" active />
          </div>
        </div>
        <span style={{ fontSize: 10.5, padding: '3px 10px', borderRadius: 20, background: 'rgba(29,158,117,0.1)', color: '#1D9E75', border: '1px solid rgba(29,158,117,0.2)' }}>
          Active
        </span>
        {primaryToken && (
          <button onClick={() => loadCalendars({ id: 'primary', email: primaryEmail, name: '', providerToken: primaryToken, scopes: [], connectedAt: '', isPrimary: true })}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6C6553', padding: 4, display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}
            title="Load calendars">
            <RefreshCw size={12} style={{ animation: loadingCals === 'primary' ? 'spin 1s linear infinite' : 'none' }} />
          </button>
        )}
        <button onClick={() => void googleSignOut()}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#E05252', padding: 4, display: 'flex', alignItems: 'center' }}
          title="Sign out">
          <LogOut size={13} />
        </button>
      </div>

      {/* Show primary calendars */}
      {calendars['primary'] && (
        <div style={{ marginBottom: 12, padding: '8px 14px', background: '#FAF7EC', borderRadius: 8, border: '1px solid #E8E1CE' }}>
          <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 600, color: '#6C6553', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Calendars in this account</p>
          {calendars['primary'].map(name => (
            <p key={name} style={{ margin: '3px 0', fontSize: 12, color: '#6C6553' }}>• {name}</p>
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
            padding: '12px 14px', borderRadius: 10, marginBottom: 8,
            background: '#FAF7EC',
            border: `1px solid ${isStale ? 'rgba(224,165,36,0.35)' : '#E8E1CE'}`,
            opacity: hiddenAccts.has(acc.email) ? 0.5 : 1,
            transition: 'opacity 0.15s',
          }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, background: 'rgba(245,209,78,0.12)', border: '1px solid #7F77DD40', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#7F77DD' }}>
              {acc.email ? acc.email[0].toUpperCase() : 'G'}
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: '#191712' }}>{acc.email || acc.name}</p>
              {(() => {
                const linked = companies.filter(c => c.accountId === acc.id)
                if (linked.length === 0) {
                  return <p style={{ margin: '3px 0 0', fontSize: 11, color: '#B5AC98' }}>No company uses this account yet</p>
                }
                return (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, margin: '5px 0 0' }}>
                    {linked.map(c => (
                      <span key={c.id} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        padding: '2px 8px', borderRadius: 999,
                        background: '#FFFFFF', border: '1px solid #E8E1CE',
                        fontSize: 10.5, fontWeight: 600, color: '#6C6553',
                      }}>
                        <span style={{ width: 6, height: 6, borderRadius: 999, background: c.color }} />
                        {c.name}
                      </span>
                    ))}
                  </div>
                )
              })()}
              {isStale ? (
                <p style={{ margin: '2px 0 0', fontSize: 11, color: '#E0A524' }}>⚠ Access lost — reconnect to restore</p>
              ) : (
                <div style={{ margin: '5px 0 0', display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                  <IntegrationBadge icon={<CalendarDays size={10} />} label="Calendar" active={acc.scopes.some(s => s.includes('calendar'))} />
                  <IntegrationBadge icon={<Mail size={10} />} label="Gmail" active={acc.scopes.some(s => s.includes('gmail'))} />
                  <IntegrationBadge icon={<HardDrive size={10} />} label="Drive" active={acc.scopes.some(s => s.includes('drive'))}
                    onGrant={!acc.scopes.some(s => s.includes('drive')) ? () => void reconnectAccount(acc) : undefined} />
                </div>
              )}
            </div>
            {isStale ? (
              <button
                onClick={() => void reconnectAccount(acc)}
                disabled={isRecon}
                style={{
                  padding: '4px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: isRecon ? 'wait' : 'pointer',
                  background: 'rgba(224,165,36,0.12)', border: '1px solid rgba(224,165,36,0.4)', color: '#E0A524',
                  display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
                }}
              >
                <RefreshCw size={11} style={{ animation: isRecon ? 'spin 1s linear infinite' : 'none' }} />
                {isRecon ? 'Redirecting…' : 'Reconnect'}
              </button>
            ) : (
              <button onClick={() => void loadCalendars(acc)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6C6553', padding: 4, display: 'flex' }} title="Load calendars">
                <RefreshCw size={12} style={{ animation: loadingCals === acc.id ? 'spin 1s linear infinite' : 'none' }} />
              </button>
            )}
            <button
              onClick={() => toggleAccountVisibility(acc.email)}
              title={hiddenAccts.has(acc.email) ? 'Show in Calendar' : 'Hide from Calendar'}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', color: hiddenAccts.has(acc.email) ? '#4B5268' : '#6C6553' }}
            >
              {hiddenAccts.has(acc.email) ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
            <button onClick={() => removeAcc(acc.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#E05252', padding: 4, display: 'flex' }}>
              <Trash2 size={13} />
            </button>
          </div>
        )
      })}

      {/* Show calendars for additional accounts */}
      {accounts.map(acc => calendars[acc.id] ? (
        <div key={`${acc.id}-cals`} style={{ marginBottom: 8, padding: '8px 14px', background: '#FAF7EC', borderRadius: 8, border: '1px solid #E8E1CE' }}>
          <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 600, color: '#6C6553', textTransform: 'uppercase' }}>{acc.email} calendars</p>
          {calendars[acc.id].map(name => <p key={name} style={{ margin: '3px 0', fontSize: 12, color: '#6C6553' }}>• {name}</p>)}
        </div>
      ) : null)}

      {/* Add account button + Remove all */}
      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
        <button onClick={() => void connectAdditional()} disabled={adding}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 8,
            padding: '12px 16px', borderRadius: 9,
            background: '#FAF7EC',
            border: '1px dashed #E8E1CE',
            color: '#6C6553', fontSize: 13, fontWeight: 500, cursor: 'pointer',
            opacity: adding ? 0.6 : 1,
          }}>
          <LogIn size={14} />
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
              padding: '12px 14px', borderRadius: 9,
              background: 'rgba(224,82,82,0.06)',
              border: '1px solid rgba(224,82,82,0.25)',
              color: '#E05252', fontSize: 12, fontWeight: 500, cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            <Trash2 size={13} />
            Remove all
          </button>
        )}
      </div>

      <p style={{ margin: '10px 0 0', fontSize: 11.5, color: '#6C6553', lineHeight: 1.55 }}>
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

  function SegBtn<T extends string>({ val, cur, onClick, label }: { val: T; cur: T; onClick: () => void; label?: string }) {
    const active = val === cur
    return (
      <button onClick={onClick} style={{
        padding: '5px 13px', borderRadius: 7, fontSize: 11.5, cursor: 'pointer', fontWeight: active ? 600 : 400,
        background: active ? '#191712' : '#FAF7EC', border: `1px solid ${active ? '#191712' : '#E8E1CE'}`,
        color: active ? '#FFFFFF' : '#6C6553', transition: 'all 0.12s',
      }}>{label ?? val}</button>
    )
  }

  return (
    <div>
      {/* ── Model ── */}
      <FieldRow label="Model" sub="Handles the brief, drafts and matrix suggestions">
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {[
            { v: 'anthropic', l: 'Sonnet 4.5' },
            { v: 'groq',      l: 'Opus 4.1' },
            { v: 'haiku',     l: 'Haiku' },
          ].map(({ v, l }) => (
            <button key={v} onClick={() => setAI({ provider: v as AIConfig['provider'] })}
              style={{
                padding: '5px 13px', borderRadius: 7, fontSize: 11.5, cursor: 'pointer', fontWeight: ai.provider === v ? 600 : 400,
                background: ai.provider === v ? '#191712' : '#FAF7EC', border: `1px solid ${ai.provider === v ? '#191712' : '#E8E1CE'}`,
                color: ai.provider === v ? '#FFFFFF' : '#6C6553', transition: 'all 0.12s',
              }}>{l}</button>
          ))}
        </div>
      </FieldRow>

      {/* ── API key ── */}
      <FieldRow label={keyLabel} sub={keyHint}>
        <div style={{ display: 'flex', gap: 6, width: '100%' }}>
          <input type={showKey ? 'text' : 'password'} value={activeKey}
            onChange={e => setAI(ai.provider === 'groq' ? { groqKey: e.target.value } : { anthropicKey: e.target.value })}
            placeholder={ai.provider === 'groq' ? 'gsk_...' : 'sk-ant-...'}
            style={{ ...inputStyle, flex: 1, fontFamily: 'monospace', fontSize: 11.5 }} />
          <button onClick={() => setShowKey(v => !v)} style={{ background: 'transparent', border: '1px solid #E8E1CE', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', color: '#6C6553', fontSize: 11, flexShrink: 0 }}>
            {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        </div>
      </FieldRow>

      <div style={{ height: 6, borderTop: '1px solid #F0EBDC', marginTop: 12, marginBottom: 12 }} />

      {/* ── Autonomy ── */}
      <FieldRow label="Autonomy" sub="How far the assistant may act before asking you">
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          <SegBtn val="suggest" cur={autonomy} onClick={() => setAutonomy('suggest')} label="Suggest" />
          <SegBtn val="draft"   cur={autonomy} onClick={() => setAutonomy('draft')}   label="Draft & hold" />
          <SegBtn val="act"     cur={autonomy} onClick={() => setAutonomy('act')}     label="Act" />
        </div>
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

      <div style={{ height: 6, borderTop: '1px solid #F0EBDC', marginTop: 12, marginBottom: 12 }} />
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

      <p style={{ margin: '14px 0 0', fontSize: 11, color: '#9B9180' }}>Your mail and tasks are never used to train the model.</p>
    </div>
  )
}

// NotificationsSection merged into NotificationsMatrixSection (Push/Mail/Digest per event)
// Legacy reminder fields (morning brief time, wind-down) are now in the AI / Schedule sections.

function AppearanceSection({ s, set }: { s: AppSettings; set: (p: Partial<AppSettings>) => void }) {
  const { setThemeId } = useUIStore()

  function pickTheme(id: string) {
    set({ theme: id })
    setThemeId(id)
    applyThemeVars(getTheme(id))
  }

  return (
    <div>
      <div style={{ paddingBottom: 12, borderBottom: '1px solid #E8E1CE', marginBottom: 4 }}>
        <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 500, color: '#191712' }}>Theme</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 7 }}>
          {THEMES.map(t => {
            const active = s.theme === t.id
            return (
              <button key={t.id} onClick={() => pickTheme(t.id)}
                style={{
                  padding: '8px 4px', borderRadius: 9, cursor: 'pointer', flexDirection: 'column',
                  display: 'flex', alignItems: 'center', gap: 5,
                  background: t.surface, border: `2px solid ${active ? t.accent : t.border}`,
                  boxShadow: active ? `0 0 10px ${t.accent}40` : 'none',
                  transition: 'all 0.15s',
                }}>
                <div style={{ display: 'flex', gap: 3 }}>
                  {[t.accent, t.accentFill ? t.accentBright : t.textDim, t.textMuted].map((c, i) => (
                    <div key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: c }} />
                  ))}
                </div>
                <span style={{ fontSize: 13 }}>{t.emoji}</span>
                <span style={{ fontSize: 9.5, color: t.text, fontWeight: active ? 700 : 400, whiteSpace: 'nowrap' }}>{t.name}</span>
              </button>
            )
          })}
        </div>
      </div>
      <FieldRow label="Sidebar expanded">
        <Toggle checked={!s.sidebarDefault} onChange={v => set({ sidebarDefault: !v })} />
      </FieldRow>
      <FieldRow label="Compact density" sub="Tighter spacing">
        <Toggle checked={s.compact} onChange={v => set({ compact: v })} />
      </FieldRow>
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
  busy:         { bg: 'rgba(224,82,82,0.12)',   color: '#E05252' },
  focus_time:   { bg: 'rgba(29,158,117,0.12)',  color: '#1D9E75' },
  full_details: { bg: 'rgba(30,64,175,0.12)',   color: '#6B9FFF' },
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
      <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: bg, color }}>
        {label}
      </span>
    )
  }

  return (
    <div>
      <p style={{ margin: '0 0 16px', fontSize: 12.5, color: '#6C6553', lineHeight: 1.55 }}>
        When an event appears on a source calendar, a matching block is automatically
        created on the target calendar. Choose how much detail to share.
      </p>

      {/* Rule list */}
      {rules.length === 0 && !showForm && (
        <p style={{ fontSize: 12.5, color: '#6C6553', margin: '0 0 12px', textAlign: 'center', padding: '12px 0' }}>
          No rules yet — add one below.
        </p>
      )}

      {rules.map(rule => (
        <div key={rule.id} style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px', borderRadius: 10, marginBottom: 8,
          background: '#FAF7EC',
          border: `1px solid ${rule.enabled ? '#F5D14E30' : '#E8E1CE'}`,
          opacity: rule.enabled ? 1 : 0.6,
        }}>
          <Toggle checked={rule.enabled} onChange={() => toggleRule(rule.id)} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 12.5, fontWeight: 500, color: '#191712', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {rule.sourceCalendarName}
              <span style={{ margin: '0 6px', color: '#6C6553' }}>→</span>
              {rule.targetCalendarName}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
              {badge(rule.detailLevel)}
              {rule.autoApply && (
                <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: 20, background: 'rgba(29,158,117,0.12)', color: '#1D9E75' }}>
                  Auto
                </span>
              )}
              {rule.hideBlocked && (
                <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: 20, background: 'rgba(127,119,221,0.12)', color: '#7F77DD' }}>
                  Originals only
                </span>
              )}
              <span style={{ fontSize: 10.5, color: '#6C6553' }}>
                {rule.sourceAccountEmail === rule.targetAccountEmail
                  ? rule.sourceAccountEmail
                  : `${rule.sourceAccountEmail} → ${rule.targetAccountEmail}`}
              </span>
            </div>
          </div>
          <button onClick={() => openEdit(rule)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6C6553', display: 'flex', padding: 4, opacity: 0.7, flexShrink: 0 }}
            title="Edit rule">
            <Pencil size={13} />
          </button>
          <button onClick={() => deleteRule(rule.id)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#E05252', display: 'flex', padding: 4, opacity: 0.7, flexShrink: 0 }}
            title="Delete rule">
            <Trash2 size={14} />
          </button>
        </div>
      ))}

      {/* Add rule form */}
      {showForm ? (
        <div style={{
          padding: '14px 16px', borderRadius: 10, marginTop: 8,
          background: '#FAF7EC',
          border: '1px solid #F5D14E40',
        }}>
          <p style={{ margin: '0 0 12px', fontSize: 12.5, fontWeight: 600, color: '#191712' }}>
            {editingRule ? 'Edit blocking rule' : 'New blocking rule'}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, color: '#6C6553', display: 'block', marginBottom: 4 }}>
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
              <label style={{ fontSize: 11, color: '#6C6553', display: 'block', marginBottom: 4 }}>
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
              <label style={{ fontSize: 11, color: '#6C6553', display: 'block', marginBottom: 4 }}>
                Detail level
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                {DETAIL_LEVELS.map(d => (
                  <button key={d.value} onClick={() => setDetail(d.value)}
                    style={{
                      flex: 1, padding: '7px 6px', borderRadius: 8, cursor: 'pointer', textAlign: 'center',
                      background: detail === d.value ? DETAIL_BADGE[d.value].bg : '#FFFFFF',
                      border: `1px solid ${detail === d.value ? DETAIL_BADGE[d.value].color + '80' : '#E8E1CE'}`,
                      color: detail === d.value ? DETAIL_BADGE[d.value].color : '#6C6553',
                      transition: 'all 0.15s',
                    }}>
                    <p style={{ margin: 0, fontSize: 11.5, fontWeight: 600 }}>{d.label}</p>
                    <p style={{ margin: '2px 0 0', fontSize: 9.5, opacity: 0.7, lineHeight: 1.3 }}>{d.desc}</p>
                  </button>
                ))}
              </div>
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 12px', borderRadius: 8,
              background: autoApply ? 'rgba(29,158,117,0.07)' : '#FFFFFF',
              border: `1px solid ${autoApply ? 'rgba(29,158,117,0.3)' : '#E8E1CE'}`,
              transition: 'all 0.15s',
            }}>
              <div>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: '#191712' }}>
                  Auto-apply
                </p>
                <p style={{ margin: '2px 0 0', fontSize: 10.5, color: '#6C6553' }}>
                  Run this rule automatically whenever the calendar loads
                </p>
              </div>
              <Toggle checked={autoApply} onChange={setAutoApply} />
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 12px', borderRadius: 8,
              background: hideBlocked ? 'rgba(127,119,221,0.07)' : '#FFFFFF',
              border: `1px solid ${hideBlocked ? 'rgba(127,119,221,0.3)' : '#E8E1CE'}`,
              transition: 'all 0.15s',
            }}>
              <div>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: '#191712' }}>
                  Show originals only
                </p>
                <p style={{ margin: '2px 0 0', fontSize: 10.5, color: '#6C6553' }}>
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
                flex: 1, padding: '8px 0', borderRadius: 8, cursor: 'pointer',
                background: (!srcCal || !tgtCal || srcCal === tgtCal) ? '#FFFFFF' : 'rgba(245,209,78,0.12)',
                border: '1px solid #F5D14E50',
                color: (!srcCal || !tgtCal || srcCal === tgtCal) ? '#6C6553' : '#F5D14E',
                fontSize: 12.5, fontWeight: 600,
              }}>
              {editingRule ? 'Update Rule' : 'Add Rule'}
            </button>
            <button onClick={resetForm}
              style={{
                padding: '8px 16px', borderRadius: 8, cursor: 'pointer',
                background: 'transparent', border: '1px solid #E8E1CE',
                color: '#6C6553', fontSize: 12.5,
              }}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => { setCals(loadCachedCalendars()); setEditingRule(null); setShowForm(true) }}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
            borderRadius: 8, cursor: 'pointer', marginTop: 4,
            background: 'rgba(245,209,78,0.10)',
            border: '1px solid #F5D14E40',
            color: '#6C6553', fontSize: 12.5,
          }}>
          <Plus size={13} /> Add Rule
        </button>
      )}
    </div>
  )
}

// ─── Behavioral OS Section ────────────────────────────────────────────────────

function BehavioralSection() {
  const { enabled, mode, setEnabled, setMode } = useBehavioralStore()
  const SB = {
    bg: '#F7F4EA', surface: '#FFFFFF', surface2: '#FAF7EC', border: '#E8E1CE',
    accent: '#F5D14E', accentFill: 'rgba(245,209,78,0.12)', accentBright: '#D4A827',
    text: '#191712', textDim: '#6C6553', textMuted: '#9B9180',
  }

  const modes: { id: BehavioralMode; label: string; desc: string; available: boolean }[] = [
    { id: 'samurai', label: 'Samurai',  desc: 'Disciplined executor. Tactical tone. Rank system active.', available: true  },
    { id: 'pharaoh', label: 'Pharaoh',  desc: 'Strategic builder. Legacy-focused framework.',             available: false },
    { id: 'astral',  label: 'Astral',   desc: 'Vision-first. Long-horizon thinking & reflection.',        available: false },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Enable toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: SB.surface2, borderRadius: 10, border: `1px solid ${SB.border}` }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: SB.text }}>Enable Behavioral OS</div>
          <div style={{ fontSize: 12, color: SB.textDim, marginTop: 2 }}>Activates rank tracking, identity detection & mode-aware AI</div>
        </div>
        <button
          onClick={() => setEnabled(!enabled)}
          style={{
            width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', flexShrink: 0,
            background: enabled ? SB.accent : SB.border,
            position: 'relative', transition: 'background 0.2s',
          }}
        >
          <span style={{
            position: 'absolute', top: 2, left: enabled ? 22 : 2,
            width: 20, height: 20, borderRadius: '50%', background: '#fff',
            transition: 'left 0.2s',
          }} />
        </button>
      </div>

      {/* Mode selection */}
      {enabled && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: SB.accentBright, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 2 }}>Operating Mode</div>
          {modes.map(m => (
            <button
              key={m.id}
              disabled={!m.available}
              onClick={() => m.available && setMode(m.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 14px', borderRadius: 10, cursor: m.available ? 'pointer' : 'default',
                background: mode === m.id ? SB.accentFill : SB.surface2,
                border: `1px solid ${mode === m.id ? SB.accent : SB.border}`,
                textAlign: 'left', width: '100%', opacity: m.available ? 1 : 0.5,
              }}
            >
              <Swords size={16} color={mode === m.id ? SB.accent : SB.textDim} strokeWidth={1.8} style={{ flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: SB.text }}>{m.label}</span>
                  {!m.available && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: SB.border, color: SB.textDim, letterSpacing: '0.5px' }}>SOON</span>}
                </div>
                <div style={{ fontSize: 12, color: SB.textDim, marginTop: 2 }}>{m.desc}</div>
              </div>
              {mode === m.id && <div style={{ width: 8, height: 8, borderRadius: '50%', background: SB.accent, flexShrink: 0 }} />}
            </button>
          ))}
        </div>
      )}

      {/* Samurai info */}
      {enabled && mode === 'samurai' && (
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(139,26,26,0.08)', border: '1px solid rgba(139,26,26,0.25)' }}>
          <div style={{ fontSize: 12, color: '#C0392B', fontWeight: 600, marginBottom: 4 }}>Samurai Mode Active</div>
          <div style={{ fontSize: 12, color: SB.textDim, lineHeight: 1.5 }}>
            The Behavioral OS page will appear in the sidebar. Your rank (Ronin → Shogun) is calculated from task completion, habit consistency, and planning quality. The AI assistant will adopt a tactical, no-filler communication style.
          </div>
        </div>
      )}
    </div>
  )
}

// ─── CHUNK 6c: Finance Settings section ──────────────────────────────────────

type EnvelopeStyle = 'dial' | 'mosaic' | 'slip' | 'ring'

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
          <path d="M14 42 A26 26 0 0 1 66 42" stroke="#E8E1CE" strokeWidth="7" strokeLinecap="round" fill="none"/>
          {/* Fill (72% of arc) */}
          <path d="M14 42 A26 26 0 0 1 57.8 19.5" stroke="#F5D14E" strokeWidth="7" strokeLinecap="round" fill="none"/>
          {/* Needle center */}
          <circle cx="40" cy="42" r="4" fill="#191712"/>
          {/* Trend line */}
          <polyline points="10,50 22,46 34,44 46,41 58,37 70,33" stroke="#5F7038" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
        </svg>
      ),
    },
    {
      id: 'mosaic',
      label: 'Proportional mosaic',
      sub: 'Area equals money · rust boxes burst',
      preview: (
        <svg viewBox="0 0 80 56" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: 56 }}>
          <rect x="4" y="4" width="44" height="28" rx="3" fill="#EDE7D9"/>
          <rect x="4" y="4" width="44" height="20" rx="3" fill="#F5D14E" opacity="0.7"/>
          <rect x="52" y="4" width="24" height="44" rx="3" fill="#F7E4DE"/>
          <rect x="52" y="4" width="24" height="48" rx="3" fill="#8A3B2A" opacity="0.5"/>
          <rect x="4" y="36" width="20" height="16" rx="3" fill="#EDE7D9"/>
          <rect x="4" y="36" width="14" height="16" rx="3" fill="#E9EFD9"/>
          <rect x="28" y="36" width="20" height="16" rx="3" fill="#EDE7D9"/>
          <rect x="28" y="36" width="10" height="16" rx="3" fill="#F5D14E" opacity="0.5"/>
        </svg>
      ),
    },
    {
      id: 'slip',
      label: 'Till slips',
      sub: 'Monospace figures · one eye movement to compare',
      preview: (
        <svg viewBox="0 0 80 56" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: 56 }}>
          <rect x="4" y="4" width="72" height="12" rx="3" fill="#FAF7EC"/>
          <rect x="4" y="4" width="52" height="12" rx="3" fill="#F5D14E" opacity="0.5"/>
          <rect x="4" y="20" width="72" height="12" rx="3" fill="#FAF7EC"/>
          <rect x="4" y="20" width="68" height="12" rx="3" fill="#E9EFD9"/>
          <rect x="4" y="36" width="72" height="12" rx="3" fill="#FAF7EC"/>
          <rect x="4" y="36" width="76" height="12" rx="3" fill="#F7E4DE"/>
          <rect x="4" y="36" width="72" height="12" rx="3" fill="#8A3B2A" opacity="0.25"/>
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
          <circle cx="22" cy="28" r="16" stroke="#E8E1CE" strokeWidth="4" fill="none"/>
          <circle cx="22" cy="28" r="16" stroke="#F5D14E" strokeWidth="4" fill="none"
            strokeDasharray="75.4" strokeDashoffset="20" strokeLinecap="round"/>
          {/* inner ring */}
          <circle cx="22" cy="28" r="10" stroke="#EDE7D9" strokeWidth="3" fill="none"/>
          <circle cx="22" cy="28" r="10" stroke="#5F7038" strokeWidth="3" fill="none"
            strokeDasharray="62.8" strokeDashoffset="16" strokeLinecap="round"/>

          <circle cx="55" cy="28" r="16" stroke="#E8E1CE" strokeWidth="4" fill="none"/>
          <circle cx="55" cy="28" r="16" stroke="#8A3B2A" strokeWidth="4" fill="none"
            strokeDasharray="100.5" strokeDashoffset="-4" strokeLinecap="round"/>
          <circle cx="55" cy="28" r="10" stroke="#EDE7D9" strokeWidth="3" fill="none"/>
          <circle cx="55" cy="28" r="10" stroke="#8A3B2A" strokeWidth="3" fill="none" opacity="0.5"
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
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: '#6C6553' }}>ENVELOPE STYLE</span>
          <span style={{ fontSize: 11, color: '#6C6553' }}>The budget page opens in this view · you can still switch it per visit</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
          {STYLES.map(style => {
            const active = envelopeStyle === style.id
            return (
              <button
                key={style.id}
                onClick={() => saveStyle(style.id)}
                style={{
                  background: active ? '#FAF7EC' : '#FFFFFF',
                  border: `1.5px solid ${active ? '#F5D14E' : '#E8E1CE'}`,
                  borderRadius: 12, padding: '14px 14px 12px',
                  cursor: 'pointer', textAlign: 'left',
                  boxShadow: active ? '0 0 0 2px rgba(245,209,78,0.25)' : 'none',
                  transition: 'all 0.15s',
                }}
              >
                {/* Visual preview */}
                <div style={{ background: '#F0EBDC', borderRadius: 8, padding: '8px 10px', marginBottom: 10, overflow: 'hidden' }}>
                  {style.preview}
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{
                    width: 16, height: 16, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                    border: `2px solid ${active ? '#F5D14E' : '#E8E1CE'}`,
                    background: active ? '#F5D14E' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {active && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#191712' }} />}
                  </div>
                  <div>
                    <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: '#191712' }}>{style.label}</p>
                    <p style={{ margin: '2px 0 0', fontSize: 10.5, color: '#6C6553', lineHeight: 1.3 }}>{style.sub}</p>
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
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: '#6C6553', display: 'block', marginBottom: 12 }}>FIGURES</span>
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
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.1em', color: '#6C6553', marginBottom: 8 }}>ORDER CATEGORIES BY</div>
          <div style={{ fontSize: 11, color: '#9B9180', marginBottom: 8 }}>Biggest spend first keeps the two problems at the top</div>
          <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6 }}>
            {([
              { v: 'spend',  label: 'Biggest spend' },
              { v: 'budget', label: 'Budget size' },
              { v: 'alpha',  label: 'A–Z' },
              { v: 'custom', label: 'Custom' },
            ] as const).map(o => (
              <button key={o.v} onClick={() => { setCategoryOrder(o.v); saveField('finance-category-order', o.v) }}
                style={{
                  padding: '6px 13px', borderRadius: 999, border: '1px solid #E8E1CE', cursor: 'pointer',
                  background: categoryOrder === o.v ? '#191712' : '#FAF7EC',
                  color: categoryOrder === o.v ? '#FDF8E7' : '#6C6553',
                  fontSize: 12, fontWeight: categoryOrder === o.v ? 600 : 400,
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
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: '#6C6553', display: 'block', marginBottom: 12 }}>DATES · COUNTING</span>

        {/* Count on */}
        <FieldRow label="Count a transaction on" sub="The financials table can show either — this sets the default">
          <div style={{ display: 'flex', gap: 8 }}>
            {(['due', 'paid'] as const).map(v => (
              <button key={v} onClick={() => { setCountOn(v); saveField('finance-count-on', v) }}
                style={{
                  padding: '6px 14px', borderRadius: 8, border: '1px solid #E8E1CE', cursor: 'pointer',
                  background: countOn === v ? '#191712' : '#FAF7EC',
                  color: countOn === v ? '#FDF8E7' : '#6C6553',
                  fontSize: 12, fontWeight: countOn === v ? 600 : 400,
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
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: '#6C6553', display: 'block', marginBottom: 12 }}>ALERTS</span>
        <FieldRow label="Balance alert" sub="Notify when an envelope is this % spent">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="range" min={0.5} max={1} step={0.05}
              value={alertThreshold}
              onChange={e => { const v = parseFloat(e.target.value); setAlertThreshold(v); saveField('finance-alert-threshold', String(v)) }}
              style={{ flex: 1, accentColor: '#F5D14E', cursor: 'pointer' }}
            />
            <span style={{ width: 36, textAlign: 'right', fontSize: 13, fontWeight: 600, color: '#191712', fontFamily: 'JetBrains Mono, monospace' }}>
              {Math.round(alertThreshold * 100)}%
            </span>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 10.5, color: '#6C6553' }}>
            {alertThreshold >= 1 ? 'Alert only when over budget' : alertThreshold >= 0.9 ? 'Alert at 90%+ spent (recommended)' : `Alert when ${Math.round(alertThreshold * 100)}%+ of envelope is spent`}
          </p>
        </FieldRow>
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
  return (
    <div>
      {/* Plan tile */}
      <div style={{ padding: '16px 18px', borderRadius: 12, background: '#FFFBEC', border: '1px solid #F5D14E', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.02em', color: '#191712' }}>Professor Pro</span>
              <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', background: '#F5D14E', color: '#191712', padding: '3px 7px', borderRadius: 5 }}>ANNUAL</span>
            </div>
            <p style={{ margin: 0, fontSize: 11.5, color: '#6C6553', lineHeight: 1.45 }}>Renews 14 March 2027 · all four companies, unlimited AI drafts</p>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <p style={{ margin: 0, fontSize: 24, fontWeight: 700, fontFamily: 'Outfit, sans-serif', letterSpacing: '-0.03em', color: '#191712', lineHeight: 1 }}>$180</p>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: '#9B9180' }}>per year</p>
          </div>
        </div>
      </div>

      {/* Billing fields */}
      <DRow label="Payment method">
        <span style={{ fontSize: 12.5, color: '#6C6553' }}>Visa ending 4417 · expires 09/28</span>
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
          <p style={{ margin: 0, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em', color: '#6C6553', textTransform: 'uppercase' }}>Invoices</p>
          <button style={{ fontSize: 12, color: '#6C6553', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>Download all</button>
        </div>
        {INVOICES.map((inv, i) => (
          <div key={inv.date} style={{
            display: 'flex', alignItems: 'center', gap: 16,
            padding: '13px 0',
            borderBottom: i === INVOICES.length - 1 ? 'none' : '1px solid #F0EBDC',
          }}>
            <span style={{ width: 96, flexShrink: 0, fontSize: 12.5, color: '#6C6553' }}>{inv.date}</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: '#191712', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.desc}</span>
            <span style={{ fontSize: 13, fontFamily: 'Outfit, sans-serif', fontWeight: 600, color: '#191712', flexShrink: 0 }}>{inv.amount}</span>
            <button title={`Download ${inv.date} invoice`} style={{
              background: 'none', border: 'none', cursor: 'pointer', color: '#9B9180',
              padding: 2, display: 'flex', alignItems: 'center', flexShrink: 0,
            }}><Download size={14} /></button>
          </div>
        ))}
      </div>

      {/* Cancel */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
        marginTop: 18, paddingTop: 16, borderTop: '1px solid #F0EBDC',
      }}>
        <p style={{ margin: 0, fontSize: 12, color: '#9B9180', lineHeight: 1.4 }}>
          Cancelling keeps your data readable until the term ends.
        </p>
        <GhostPill tone="rust">Cancel plan</GhostPill>
      </div>
    </div>
  )
}

// ─── Notifications Matrix Section (11F) ───────────────────────────────────────

type NChannel = 'push' | 'mail' | 'digest'
interface NEvent { id: string; label: string; sub: string; push: boolean; mail: boolean; digest: boolean }

const DEFAULT_NOTIF_EVENTS: NEvent[] = [
  { id: 'decision',    label: 'A decision has waited two days',  sub: 'The nudge that keeps decisions from rotting', push: true,  mail: true,  digest: true  },
  { id: 'needsyou',   label: 'Mail that needs you',             sub: 'Only threads the assistant marks NEEDS YOU',  push: true,  mail: false, digest: true  },
  { id: 'draft',      label: 'Draft ready to send',             sub: 'When a reply is written and waiting',         push: true,  mail: false, digest: true  },
  { id: 'conflict',   label: 'Calendar conflict',               sub: 'Two events land on the same hour',            push: true,  mail: true,  digest: false },
  { id: 'habit',      label: 'Habit not logged',                sub: 'Fires at the reminder time you set per habit',push: true,  mail: false, digest: false },
  { id: 'review',     label: 'Weekly review is due',            sub: 'Sunday evening, once',                        push: false, mail: true,  digest: true  },
  { id: 'rank',       label: 'Rank changed',                    sub: 'Behavioral OS moved you up or down',          push: true,  mail: false, digest: true  },
]

function NotificationsMatrixSection() {
  const [events, setEvents] = useState<NEvent[]>(() => {
    try { const s = localStorage.getItem('professor-notif-events'); return s ? JSON.parse(s) : DEFAULT_NOTIF_EVENTS } catch { return DEFAULT_NOTIF_EVENTS }
  })
  const [quietOn, setQuietOn]     = useState(true)
  const [quietStart, setQStart]   = useState('22:30')
  const [quietEnd,   setQEnd]     = useState('07:00')

  function toggleChannel(id: string, ch: NChannel) {
    const next = events.map(e => e.id === id ? { ...e, [ch]: !e[ch as keyof NEvent] } : e)
    setEvents(next)
    try { localStorage.setItem('professor-notif-events', JSON.stringify(next)) } catch { /**/ }
  }

  const ChHead = ({ label }: { label: string }) => (
    <div style={{ width: 44, textAlign: 'center', fontSize: 10, fontWeight: 700, letterSpacing: '0.09em', color: '#9B9180', textTransform: 'uppercase' }}>{label}</div>
  )
  const ChToggle = ({ on, onClick }: { on: boolean; onClick: () => void }) => (
    <div style={{ width: 44, display: 'flex', justifyContent: 'center' }}>
      <Toggle checked={on} onChange={onClick} />
    </div>
  )

  return (
    <div>
      {/* Column headers */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 10, borderBottom: '1px solid #E8E1CE', marginBottom: 2 }}>
        <p style={{ margin: 0, fontSize: 11.5, fontWeight: 700, color: '#6C6553', letterSpacing: '0.06em', textTransform: 'uppercase' }}>EVENT</p>
        <div style={{ display: 'flex', gap: 0 }}>
          <ChHead label="Push" />
          <ChHead label="Mail" />
          <ChHead label="Digest" />
        </div>
      </div>

      {/* Event rows */}
      {events.map(e => (
        <div key={e.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 0', borderBottom: '1px solid #F0EBDC' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ margin: 0, fontSize: 12.5, fontWeight: 500, color: '#191712', lineHeight: 1.3 }}>{e.label}</p>
            <p style={{ margin: '1px 0 0', fontSize: 11, color: '#9B9180', lineHeight: 1.3 }}>{e.sub}</p>
          </div>
          <div style={{ display: 'flex', gap: 0, flexShrink: 0 }}>
            <ChToggle on={e.push}   onClick={() => toggleChannel(e.id, 'push')} />
            <ChToggle on={e.mail}   onClick={() => toggleChannel(e.id, 'mail')} />
            <ChToggle on={e.digest} onClick={() => toggleChannel(e.id, 'digest')} />
          </div>
        </div>
      ))}

      {/* Quiet hours */}
      <div style={{ marginTop: 18, padding: '14px 16px', borderRadius: 11, background: '#FAF7EC', border: '1px solid #E8E1CE' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: quietOn ? 10 : 0 }}>
          <div>
            <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: '#191712' }}>Quiet hours</p>
            <p style={{ margin: '1px 0 0', fontSize: 11, color: '#9B9180' }}>Nothing but the morning brief gets through</p>
          </div>
          <Toggle checked={quietOn} onChange={setQuietOn} />
        </div>
        {quietOn && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input type="time" value={quietStart} onChange={e => setQStart(e.target.value)} style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid #E8E1CE', background: '#FFFFFF', fontSize: 12.5, color: '#191712' }} />
            <span style={{ color: '#9B9180', fontSize: 12 }}>to</span>
            <input type="time" value={quietEnd} onChange={e => setQEnd(e.target.value)} style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid #E8E1CE', background: '#FFFFFF', fontSize: 12.5, color: '#191712' }} />
          </div>
        )}
      </div>

      {/* Mute button */}
      <button style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, background: '#FFFFFF', border: '1px solid #E8E1CE', fontSize: 12.5, fontWeight: 500, color: '#6C6553', cursor: 'pointer' }}>
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
      {/* Third-party tools */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: '#191712' }}>Connected tools</p>
            <p style={{ margin: '1px 0 0', fontSize: 11.5, color: '#9B9180' }}>Tasks and notes flow both ways — nothing is deleted on either side</p>
          </div>
          <button style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 8, background: '#F5D14E', border: '1px solid rgba(25,23,18,0.18)', fontSize: 12, fontWeight: 600, color: '#191712', cursor: 'pointer', flexShrink: 0 }}>
            <Plus size={12} /> <span style={{ whiteSpace: 'nowrap' }}>Add integration</span>
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {integrations.map(tool => (
            <div key={tool.id} style={{
              padding: '11px 13px', borderRadius: 11,
              background: tool.status === 'disconnected' ? '#FDFCF9' : '#FFFFFF',
              border: `1px solid ${tool.status === 'disconnected' ? '#E8E1CE' : tool.enabled ? '#C8DAB0' : '#E8E1CE'}`,
              borderStyle: tool.status === 'disconnected' ? 'dashed' : 'solid',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: 9, background: '#F7F4EA', border: '1px solid #E8E1CE', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
                  {tool.emoji}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#191712' }}>{tool.name}</span>
                    <span style={{
                      fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', padding: '2px 6px', borderRadius: 4,
                      background: tool.status === 'connected' ? 'rgba(95,112,56,0.1)' : 'rgba(155,145,128,0.12)',
                      color: tool.status === 'connected' ? '#5F7038' : '#9B9180',
                      textTransform: 'uppercase',
                    }}>{tool.status === 'connected' ? 'Connected' : 'Not connected'}</span>
                  </div>
                  <p style={{ margin: '0 0 6px', fontSize: 11.5, color: '#6C6553' }}>{tool.account}</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {tool.tags.map(tag => (
                      <span key={tag} style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 20, background: '#F7F4EA', border: '1px solid #E8E1CE', color: '#6C6553' }}>{tag}</span>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  {tool.status === 'connected' && (
                    <select value={tool.syncMode} onChange={e => setIntegrations(prev => prev.map(i => i.id === tool.id ? { ...i, syncMode: e.target.value as Integration['syncMode'] } : i))}
                      style={{ fontSize: 11.5, border: '1px solid #E8E1CE', borderRadius: 7, padding: '4px 8px', background: '#FAF7EC', color: '#6C6553', cursor: 'pointer' }}>
                      <option value="two-way">Two-way</option>
                      <option value="import">Import only</option>
                      <option value="off">Off</option>
                    </select>
                  )}
                  {tool.status === 'connected'
                    ? <Toggle checked={tool.enabled} onChange={() => toggleEnabled(tool.id)} />
                    : <button style={{ fontSize: 11.5, fontWeight: 500, color: '#6C6553', background: '#F7F4EA', border: '1px solid #E8E1CE', borderRadius: 7, padding: '5px 11px', cursor: 'pointer' }}>Connect</button>
                  }
                </div>
              </div>
            </div>
          ))}
        </div>

        <p style={{ margin: '8px 0 0', fontSize: 11.5, color: '#9B9180', lineHeight: 1.5 }}>
          Last sync 07:12 — 14 tasks in, 3 completions pushed out. Tokens live on the server.{' '}
          <button style={{ background: 'none', border: 'none', color: '#5F7038', fontSize: 11.5, cursor: 'pointer', fontWeight: 600, padding: 0 }}>Sync now</button>
        </p>
      </div>

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
          padding: '10px 0', borderBottom: i === arr.length - 1 ? 'none' : '1px solid #F0EBDC',
        }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 12.5, fontWeight: 500, color: '#191712' }}>{row.label}</p>
            <p style={{ margin: '1px 0 0', fontSize: 11, color: '#9B9180' }}>{row.sub}</p>
          </div>
          <select style={{ fontSize: 12, border: '1px solid #E8E1CE', borderRadius: 7, padding: '5px 10px', background: '#FAF7EC', color: '#191712', cursor: 'pointer', flexShrink: 0 }}>
            <option>{row.value}</option>
          </select>
        </div>
      ))}
    </div>
  )
}

// ─── Automation Section (11F) ─────────────────────────────────────────────────

interface AutomationRule {
  id: string
  action: string
  trigger: string
  enabled: boolean
}

const DEFAULT_AUTOMATION_RULES: AutomationRule[] = [
  { id: 'morning-brief',    action: 'Write the morning brief',             trigger: 'every day at 06:40, before you wake',                        enabled: true  },
  { id: 'draft-replies',    action: 'Draft replies for NEEDS YOU mail',    trigger: 'a thread is marked needs-you and sits over 4 hours',          enabled: true  },
  { id: 'block-focus',      action: 'Block focus time for P0 tasks',       trigger: 'a P0 task has no calendar block by 09:00',                    enabled: true  },
  { id: 'distribute-dump',  action: 'Distribute the dump',                 trigger: 'the brain dump passes 12 tasks',                             enabled: false },
  { id: 'roll-forward',     action: 'Roll unfinished tasks forward',        trigger: 'a scheduled task ends the day untouched',                    enabled: true  },
  { id: 'archive-news',     action: 'Archive newsletters',                  trigger: 'a thread is promotional and nobody replied in 3 days',       enabled: true  },
  { id: 'close-week',       action: 'Close the week',                       trigger: 'Sunday 20:00, if the review has not been opened',            enabled: false },
]

function AutomationSection() {
  const [rules, setRules] = useState<AutomationRule[]>(() => {
    try {
      const saved = localStorage.getItem('professor-automation-rules')
      return saved ? JSON.parse(saved) : DEFAULT_AUTOMATION_RULES
    } catch { return DEFAULT_AUTOMATION_RULES }
  })

  function toggle(id: string) {
    const next = rules.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r)
    setRules(next)
    try { localStorage.setItem('professor-automation-rules', JSON.stringify(next)) } catch { /**/ }
  }

  return (
    <div>
      <p style={{ margin: '0 0 16px', fontSize: 12.5, color: '#6C6553', lineHeight: 1.5 }}>
        Rules Professor runs automatically in the background — each fires on its trigger and takes action without interrupting you.
      </p>
      <div style={{ columns: 2, columnGap: 12 }}>
        {rules.map(rule => (
          <div key={rule.id} style={{
            display: 'flex', alignItems: 'flex-start', gap: 12,
            padding: '11px 13px', borderRadius: 11, marginBottom: 10,
            breakInside: 'avoid',
            background: rule.enabled ? '#FAFDF7' : '#FDFCF9',
            border: `1px solid ${rule.enabled ? '#C8DAB0' : '#E8E1CE'}`,
            transition: 'all 0.15s',
          }}>
            <Toggle checked={rule.enabled} onChange={() => toggle(rule.id)} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: rule.enabled ? '#191712' : '#9B9180', lineHeight: 1.3 }}>
                {rule.action}
              </p>
              <p style={{ margin: '3px 0 0', fontSize: 11.5, color: '#6C6553', lineHeight: 1.4 }}>
                <span style={{ fontWeight: 600, color: '#5F7038', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>WHEN</span>
                &nbsp;{rule.trigger}
              </p>
            </div>
          </div>
        ))}
      </div>
      <button style={{
        marginTop: 14, display: 'flex', alignItems: 'center', gap: 6,
        padding: '8px 14px', borderRadius: 9, background: '#FFFFFF',
        border: '1px solid #E8E1CE', fontSize: 12.5, fontWeight: 500,
        color: '#6C6553', cursor: 'pointer',
      }}>
        <Plus size={13} /> New rule
      </button>

      {/* Run log footer */}
      <p style={{ margin: '14px 0 0', fontSize: 11.5, color: '#9B9180', lineHeight: 1.5 }}>
        Five rules ran yesterday · 41 actions taken, 2 reverted by you &nbsp;
        <button style={{ background: 'none', border: 'none', color: '#5F7038', fontSize: 11.5, cursor: 'pointer', fontWeight: 600, padding: 0 }}>Run log</button>
      </p>
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
        <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 600, color: '#191712', textTransform: 'uppercase', letterSpacing: '0.09em' }}>Export</p>
        <div style={{ padding: '14px 16px', borderRadius: 11, background: '#FAF7EC', border: '1px solid #E8E1CE' }}>
          <p style={{ margin: '0 0 10px', fontSize: 12.5, color: '#6C6553', lineHeight: 1.5 }}>
            Download a copy of all your data — tasks, habits, companies, finance envelopes & settings.
          </p>
          <button onClick={handleExport} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8,
            background: '#FFFFFF', border: '1px solid #E8E1CE',
            fontSize: 12.5, fontWeight: 500, color: '#191712', cursor: 'pointer',
          }}>
            <HardDrive size={13} />
            {exportStatus === 'exporting' ? 'Preparing…' : exportStatus === 'done' ? 'Downloaded ✓' : 'Export all data'}
          </button>
        </div>
      </div>

      {/* Privacy controls */}
      <div style={{ marginBottom: 18 }}>
        <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 600, color: '#191712', textTransform: 'uppercase', letterSpacing: '0.09em' }}>Privacy</p>
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
                borderBottom: i < arr.length - 1 ? '1px solid #F0EBDC' : 'none',
              }}>
                <div>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: '#191712' }}>{item.label}</p>
                  <p style={{ margin: '1px 0 0', fontSize: 11.5, color: '#9B9180' }}>{item.sub}</p>
                </div>
                <Toggle checked={on} onChange={setOn} />
              </div>
            )
          })}
        </div>
      </div>

      {/* Account deletion */}
      <div>
        <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 600, color: '#B4523A', textTransform: 'uppercase', letterSpacing: '0.09em' }}>Danger zone</p>
        <div style={{ padding: '14px 16px', borderRadius: 11, background: 'rgba(180,82,58,0.04)', border: '1px solid rgba(180,82,58,0.22)' }}>
          <p style={{ margin: '0 0 10px', fontSize: 12.5, color: '#6C6553', lineHeight: 1.5 }}>
            Permanently delete your account and all associated data. This cannot be undone.
          </p>
          <button style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8,
            background: 'rgba(180,82,58,0.08)', border: '1px solid rgba(180,82,58,0.3)',
            fontSize: 12.5, fontWeight: 500, color: '#B4523A', cursor: 'pointer',
          }}>
            <Trash2 size={13} /> Delete account
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
        background: '#FAF7EC', border: '1px solid #E8E1CE', borderRadius: 10,
      }}>
        <p style={{ margin: 0, flex: 1, minWidth: 180, fontSize: 11.5, color: '#6C6553', lineHeight: 1.45 }}>
          Connect a Google account, then point a company at it. Mail, calendars and
          Drive flow in through the account; the company decides how that work is
          tagged, coloured and assigned.
        </p>
        <span style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <span style={{ padding: '3px 9px', borderRadius: 999, background: '#FFFFFF', border: '1px solid #E8E1CE', fontSize: 11, fontWeight: 600, color: '#6C6553' }}>
            {accountCount} account{accountCount === 1 ? '' : 's'}
          </span>
          <span style={{ padding: '3px 9px', borderRadius: 999, background: '#FFFFFF', border: '1px solid #E8E1CE', fontSize: 11, fontWeight: 600, color: '#6C6553' }}>
            {companies.length} compan{companies.length === 1 ? 'y' : 'ies'}
          </span>
        </span>
      </div>

      {/* Accounts */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
        <Mail size={13} color="#6C6553" />
        <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: '#191712' }}>Google accounts</p>
        {unusedAccounts > 0 && (
          <span style={{ fontSize: 11, color: '#9B9180' }}>
            {unusedAccounts} not used by any company
          </span>
        )}
      </div>
      <AccountsSection accounts={accounts} setAccounts={setAccounts} primaryEmail={primaryEmail} companies={companies} />

      <div style={{ height: 1, background: '#F0EBDC', margin: '16px 0 14px' }} />

      {/* Companies */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
        <Building2 size={13} color="#6C6553" />
        <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: '#191712' }}>Companies</p>
        {unlinked > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#B4523A', fontWeight: 600 }}>
            {unlinked} not linked to an account
          </span>
        )}
      </div>
      <CompaniesSection companies={companies} setCompanies={setCompanies} accounts={accounts} />
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
      background: '#FFFFFF',
      border: `1px solid ${muted ? '#E8E1CE' : '#E0D6BC'}`,
      borderRadius: 16,
      padding: '16px 20px 18px',
      boxShadow: '0 1px 3px rgba(25,23,18,0.06)',
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0,
      alignSelf: 'start',
      transition: 'border-color 0.15s',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 10, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11, minWidth: 0 }}>
          <div style={{
            width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
            background: '#FAF7EC', border: '1px solid #E8E1CE',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon size={14} strokeWidth={1.9} color="#6C6553" />
          </div>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, fontFamily: 'Outfit, sans-serif', fontSize: 15, fontWeight: 600, letterSpacing: '-0.02em', color: '#191712', lineHeight: 1.25 }}>{title}</h3>
            {sub && <p style={{
              margin: '1px 0 0', fontSize: 11.5, color: '#9B9180', lineHeight: 1.35,
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
        habits:   async () => { const { habits } = useHabitsStore.getState(); await saveHabitsToDB(habits); await saveHabitLogsToDB(loadLogs()) },
        appearance:() => savePrefsToDB(settingsRef.current),
      }
      const fn = fns[id]
      if (!fn) return null
      const saving = sectionSaving[id] ?? 'idle'
      const label  = saving === 'saving' ? 'Saving…' : saving === 'saved' ? '✓ Saved' : saving === 'error' ? '✗ Error' : 'Save'
      return (
        <button onClick={withSectionSave(id, fn)} style={{
          padding: '4px 12px', borderRadius: 7, fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
          background: saving === 'saved' ? 'rgba(95,112,56,0.12)' : saving === 'error' ? 'rgba(180,82,58,0.1)' : '#F5D14E',
          border: saving === 'saved' ? '1px solid #C8DAB0' : saving === 'error' ? '1px solid rgba(180,82,58,0.3)' : '1px solid rgba(25,23,18,0.18)',
          color: saving === 'saved' ? '#5F7038' : saving === 'error' ? '#B4523A' : '#191712',
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
            <button onClick={() => window.dispatchEvent(new CustomEvent('professor:openWizard'))} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 7, background: '#FAF7EC', border: '1px solid #E8E1CE', color: '#6C6553', fontSize: 11, cursor: 'pointer' }}>
              <Wand2 size={11} /> Wizard
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
          padding: '5px 12px', borderRadius: 9, cursor: 'pointer', marginBottom: 0,
          background: isActive ? '#191712' : 'transparent',
          border: '1px solid transparent',
          color: isActive ? '#FFFFFF' : '#6C6553',
          fontSize: 13, fontWeight: isActive ? 600 : 500, textAlign: 'left' as const,
          fontFamily: 'inherit',
          transition: 'background 0.12s, color 0.12s',
        }}
      >
        <Icon size={15} strokeWidth={1.9} style={{ flexShrink: 0, opacity: isActive ? 1 : 0.8 }} />
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta.title}</span>
        {badge !== null && (
          <span style={{
            height: 17, minWidth: 17, boxSizing: 'border-box', padding: '0 5px', borderRadius: 999,
            background: isActive ? 'rgba(255,255,255,0.18)' : '#EDE7D9',
            color: isActive ? '#FFFFFF' : '#6C6553',
            fontSize: 9.5, fontWeight: 700,
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
      minHeight: 'calc(100vh - 66px)', background: '#F7F4EA',
      display: 'flex', flexDirection: 'column', padding: '26px 36px 0',
    }}>

      {/* ── PAGE HEADER — spans the full width, above the rail ───────────── */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 20, marginBottom: 20, flexShrink: 0,
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em', color: '#6C6553', textTransform: 'uppercase', marginBottom: 4 }}>SETTINGS</div>
          <h2 style={{ margin: 0, fontFamily: 'Outfit, sans-serif', fontSize: 28, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1.05, color: '#191712' }}>{pm.title}</h2>
          <p style={{ margin: '5px 0 0', fontSize: 12.5, color: '#6C6553', lineHeight: 1.4 }}>{pm.sub}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('professor:openWizard'))}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              padding: '10px 18px', borderRadius: 999, cursor: 'pointer',
              background: '#FFFFFF', border: '1px solid #E8E1CE', color: '#191712',
              fontSize: 13, fontWeight: 500, fontFamily: 'inherit',
              boxShadow: '0 1px 3px rgba(25,23,18,0.06)',
            }}>
            <ArrowUpRight size={14} strokeWidth={2} /> Setup wizard
          </button>
          <button
            onClick={() => exportAllSettings()}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              padding: '10px 18px', borderRadius: 999, cursor: 'pointer',
              background: '#FFFFFF', border: '1px solid #E8E1CE', color: '#191712',
              fontSize: 13, fontWeight: 500, fontFamily: 'inherit',
              boxShadow: '0 1px 3px rgba(25,23,18,0.06)',
            }}>
            <Database size={14} strokeWidth={2} /> Export
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 22, flex: 1, alignItems: 'stretch', paddingBottom: 26 }}>

        {/* ── LEFT RAIL — floating card ──────────────────────────────────── */}
        <div style={{
          width: 250, flexShrink: 0, display: 'flex', flexDirection: 'column',
          background: '#FCFAF4', border: '1px solid #E8E1CE', borderRadius: 16,
          boxShadow: '0 1px 3px rgba(25,23,18,0.06)', overflow: 'hidden',
        }}>
          {/* Search */}
          <div style={{ padding: '12px 12px 8px', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#FAF7EC', border: '1px solid #E8E1CE', borderRadius: 10, padding: '8px 12px', cursor: 'text' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9B9180" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
              <span style={{ fontSize: 12.5, color: '#9B9180', flex: 1, userSelect: 'none' }}>Find a setting</span>
              <span style={{ fontSize: 10.5, color: '#9B9180', opacity: 0.7 }}>⌘K</span>
            </div>
          </div>

          {/* Grouped nav */}
          <div style={{ padding: '0 12px', flex: 1, minHeight: 0 }}>
            {NAV_GROUPS.map(group => (
              <div key={group.label} style={{ marginBottom: 0 }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', color: '#B5AC98', padding: '7px 12px 3px', textTransform: 'uppercase' as const }}>
                  {group.label}
                </div>
                {group.ids.map(id => navItem(id))}
              </div>
            ))}
          </div>

          {/* Footer */}
          <div style={{ padding: '10px 18px 11px', borderTop: '1px solid #F0EBDC', flexShrink: 0 }}>
            <div style={{ fontSize: 11.5, color: '#9B9180', display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#5F7038', flexShrink: 0 }} />
              Every change saves itself
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

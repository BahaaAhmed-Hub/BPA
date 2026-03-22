// ─── CHUNK 1: Types, constants, localStorage helpers ─────────────────────────
// (remaining chunks appended below)

import { useState, useEffect, useRef } from 'react'
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Plus, Trash2, GripVertical, LogIn, LogOut,
  ChevronDown, ChevronUp, User, Clock, Building2, Flame,
  Brain, Bell, Palette, Link, X, RefreshCw,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { signInWithGoogle, signOut as googleSignOut } from '@/lib/google'
import { useUIStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { THEMES, getTheme, applyThemeVars } from '@/lib/themes'
import { useHabitsStore, getHabitColors } from '@/store/habitsStore'
import { loadAccounts, removeAccount, type ConnectedAccount } from '@/lib/multiAccount'
import {
  saveProfileToDB, savePrefsToDB, saveCompaniesToDB, saveHabitsToDB, saveHabitLogsToDB,
  type CompanyRow as DbSyncCompanyRow,
} from '@/lib/dbSync'
import { loadLogs } from '@/store/habitsStore'

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

interface CompanyRow {
  id: string; name: string; color: string
  calendarId: string; emailDomain: string; accountId: string; isActive: boolean
}

const SECTION_IDS = ['profile','schedule','companies','habits','accounts','professor','notifications','appearance'] as const
type SectionId = typeof SECTION_IDS[number]

interface SectionMeta { id: SectionId; title: string; icon: React.ElementType; description: string }
const SECTION_META: SectionMeta[] = [
  { id: 'profile',       title: 'Profile',            icon: User,      description: 'Name, timezone, work week & framework' },
  { id: 'schedule',      title: 'Schedule Rules',     icon: Clock,     description: 'Focus hours, buffers, meeting protections' },
  { id: 'companies',     title: 'Companies',          icon: Building2, description: 'Contexts, colors, calendar & email domain mapping' },
  { id: 'habits',        title: 'Habits',             icon: Flame,     description: 'Configure daily habits — synced with Habits page' },
  { id: 'accounts',      title: 'Connected Accounts', icon: Link,      description: 'Google accounts, calendars & Gmail access' },
  { id: 'professor',     title: 'Professor AI',       icon: Brain,     description: 'Communication style, daily brief & review day' },
  { id: 'notifications', title: 'Notifications',      icon: Bell,      description: 'Morning reminder, wind-down & weekly review nudges' },
  { id: 'appearance',    title: 'Appearance',         icon: Palette,   description: 'Theme, density & sidebar default' },
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

const FRAMEWORKS = [
  {value:'time_blocking',label:'Time Blocking'},{value:'gtd',label:'GTD'},
  {value:'deep_work',label:'Deep Work'},{value:'eisenhower',label:'Eisenhower Matrix'},
  {value:'pomodoro',label:'Pomodoro'},{value:'12_week_year',label:'12-Week Year'},
]
const WORK_DAYS    = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const C_COLORS     = ['#1E40AF','#7F77DD','#1D9E75','#E05252','#888780','#5B9BD5','#E0944A']
const BUFFER_STEPS = [0,15,30,45,60]
const PHYS_STEPS   = [0,30,60,90]
const HABIT_EMOJIS = ['🎯','💪','📚','🏃','💧','🧘','🍎','💤','🌿','✍️','🧠','🔥','🎨','🏋️','🎵']
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
function saveSettings(s:   AppSettings)  { lsSet('professor-settings', s) }
function loadCompanies():  CompanyRow[]  { return ls('professor-companies', []) }
function saveCompanies(c:  CompanyRow[]) { lsSet('professor-companies', c) }
function loadSectionOrder(): SectionId[] {
  const saved = ls<SectionId[]>('professor-section-order', [])
  const valid = saved.filter(id => (SECTION_IDS as readonly string[]).includes(id))
  const miss  = SECTION_IDS.filter(id => !valid.includes(id))
  return [...valid, ...miss]
}
function saveSectionOrder(ids: SectionId[]) { lsSet('professor-section-order', ids) }

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

// Card style using CSS variables for full theme support
const card: React.CSSProperties = {
  background: 'var(--color-surface, #161929)',
  border: '1px solid var(--color-border, #252A3E)',
  borderRadius: 14, padding: '0',
  marginBottom: 12, overflow: 'hidden',
}
const inputStyle: React.CSSProperties = {
  background: 'var(--color-surface2, #0D0F1A)',
  border: '1px solid var(--color-border, #252A3E)',
  borderRadius: 7, color: 'var(--color-text, #E8EAF6)',
  fontSize: 13.5, padding: '7px 11px', outline: 'none',
  fontFamily: 'DM Sans, sans-serif', width: '100%', boxSizing: 'border-box' as const,
}
const selectStyle: React.CSSProperties = {
  ...inputStyle, cursor: 'pointer', width: 'auto',
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const accent = 'var(--color-accent, #1E40AF)'
  return (
    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      style={{
        width: 42, height: 24, borderRadius: 12, flexShrink: 0,
        background: checked ? accent : 'var(--color-border, #252A3E)',
        border: 'none', cursor: 'pointer', position: 'relative', padding: 0, transition: 'background 0.2s',
      }}>
      <span style={{
        position: 'absolute', top: 4, left: checked ? 22 : 4,
        width: 16, height: 16, borderRadius: '50%', display: 'block',
        background: checked ? 'var(--color-surface, #161929)' : 'var(--color-text-muted, #6B7280)',
        transition: 'left 0.2s',
      }} />
    </button>
  )
}

// 2-column grid field (stacked label + control)
function FieldCol({ label, sub, children, span }: { label: string; sub?: string; children: React.ReactNode; span?: boolean }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 7,
      padding: '12px 0', borderBottom: '1px solid var(--color-border, #252A3E)',
      gridColumn: span ? '1 / -1' : undefined,
    }}>
      <div>
        <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--color-text, #E8EAF6)' }}>{label}</span>
        {sub && <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--color-text-muted, #6B7280)', lineHeight: 1.4 }}>{sub}</p>}
      </div>
      <div>{children}</div>
    </div>
  )
}

const col2: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }


// ─── Sortable Section Shell ────────────────────────────────────────────────────

function SectionShell({
  id, meta, children, defaultOpen = false, saveLabel, onSave,
}: {
  id: SectionId
  meta: SectionMeta
  children: React.ReactNode
  defaultOpen?: boolean
  saveLabel?: string
  onSave?: () => void
}) {
  const [open, setOpen] = useState(defaultOpen)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const Icon = meta.icon

  return (
    <div
      ref={setNodeRef}
      style={{
        ...card,
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        boxShadow: isDragging ? '0 8px 32px rgba(0,0,0,0.4)' : 'none',
      }}
    >
      {/* Header row */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '16px 20px', cursor: 'pointer',
        borderBottom: open ? '1px solid var(--color-border, #252A3E)' : 'none',
        userSelect: 'none',
      }}>
        {/* Drag handle */}
        <span
          {...attributes} {...listeners}
          style={{ color: 'var(--color-text-muted, #4B5563)', cursor: 'grab', flexShrink: 0, display: 'flex', touchAction: 'none' }}
          title="Drag to reorder"
        >
          <GripVertical size={16} />
        </span>

        {/* Icon */}
        <div style={{
          width: 30, height: 30, borderRadius: 7, flexShrink: 0,
          background: 'var(--color-accent-fill, rgba(30,64,175,0.12))',
          border: '1px solid var(--color-accent, #1E40AF)30',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={14} color="var(--color-accent, #1E40AF)" />
        </div>

        {/* Title + description */}
        <div style={{ flex: 1 }} onClick={() => setOpen(o => !o)}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--color-text, #E8EAF6)' }}>
            {meta.title}
          </p>
          {!open && (
            <p style={{ margin: '1px 0 0', fontSize: 11.5, color: 'var(--color-text-muted, #4B5563)' }}>
              {meta.description}
            </p>
          )}
        </div>

        {/* Save button — always visible in header */}
        {onSave && (
          <button
            onClick={e => { e.stopPropagation(); onSave() }}
            style={{
              padding: '5px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: saveLabel?.includes('✓') ? 'rgba(29,158,117,0.12)' : saveLabel?.includes('✗') ? 'rgba(224,82,82,0.12)' : 'var(--color-accent-fill, rgba(30,64,175,0.12))',
              border: `1px solid ${saveLabel?.includes('✓') ? '#1D9E7560' : saveLabel?.includes('✗') ? '#E0525260' : 'var(--color-accent, #1E40AF)40'}`,
              color: saveLabel?.includes('✓') ? '#1D9E75' : saveLabel?.includes('✗') ? '#E05252' : 'var(--color-accent, #1E40AF)',
              transition: 'all 0.15s', flexShrink: 0,
            }}
          >
            {saveLabel ?? 'Save'}
          </button>
        )}

        {/* Chevron */}
        <button onClick={() => setOpen(o => !o)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted, #4B5563)', display: 'flex', padding: 4 }}>
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>

      {/* Body */}
      {open && (
        <div style={{ padding: '20px 24px 24px' }}>
          {children}
        </div>
      )}
    </div>
  )
}

// ─── CHUNK 3: Profile & Schedule sections ────────────────────────────────────

function ProfileSection({
  s, set,
}: { s: AppSettings; set: (p: Partial<AppSettings>) => void }) {
  return (
    <div style={col2}>
      <FieldCol label="Full name">
        <input value={s.fullName} onChange={e => set({ fullName: e.target.value })}
          placeholder="Your name" style={inputStyle} />
      </FieldCol>
      <FieldCol label="Productivity framework">
        <select value={s.framework} onChange={e => set({ framework: e.target.value })} style={{ ...selectStyle, width: '100%' }}>
          {FRAMEWORKS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
      </FieldCol>
      <FieldCol label="Timezone" span>
        <select value={s.timezone} onChange={e => set({ timezone: e.target.value })} style={{ ...selectStyle, width: '100%' }}>
          {ALL_TZ.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
        </select>
      </FieldCol>
      <FieldCol label="Work days" span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {WORK_DAYS.map(d => {
            const on = s.workWeek.includes(d)
            return (
              <button key={d} onClick={() => set({ workWeek: on ? s.workWeek.filter(x => x !== d) : [...s.workWeek, d] })}
                style={{
                  padding: '5px 11px', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 500,
                  background: on ? 'var(--color-accent-fill, rgba(30,64,175,0.15))' : 'var(--color-surface2, #0D0F1A)',
                  border: `1px solid ${on ? 'var(--color-accent, #1E40AF)' : 'var(--color-border, #252A3E)'}`,
                  color: on ? 'var(--color-accent, #1E40AF)' : 'var(--color-text-muted, #6B7280)',
                }}>{d}</button>
            )
          })}
        </div>
      </FieldCol>
    </div>
  )
}

function ScheduleSection({
  s, set,
}: { s: AppSettings; set: (p: Partial<AppSettings>) => void }) {
  return (
    <div style={col2}>
      <FieldCol label="Focus window" sub="Block for deep work" span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="time" value={s.focusStart} onChange={e => set({ focusStart: e.target.value })}
            style={{ ...inputStyle, width: 130 }} />
          <span style={{ color: 'var(--color-text-muted, #6B7280)', fontSize: 12 }}>to</span>
          <input type="time" value={s.focusEnd} onChange={e => set({ focusEnd: e.target.value })}
            style={{ ...inputStyle, width: 130 }} />
        </div>
      </FieldCol>
      <FieldCol label="Earliest meeting" sub="No calls before this time">
        <input type="time" value={s.earliestMeeting} onChange={e => set({ earliestMeeting: e.target.value })}
          style={{ ...inputStyle, width: '100%' }} />
      </FieldCol>
      <FieldCol label="End of work day">
        <input type="time" value={s.endOfDay} onChange={e => set({ endOfDay: e.target.value })}
          style={{ ...inputStyle, width: '100%' }} />
      </FieldCol>
      <FieldCol label="Family / personal time">
        <input type="time" value={s.familyStart} onChange={e => set({ familyStart: e.target.value })}
          style={{ ...inputStyle, width: '100%' }} />
      </FieldCol>
      <FieldCol label="Protect focus window">
        <Toggle checked={s.protectFocus} onChange={v => set({ protectFocus: v })} />
      </FieldCol>
      <FieldCol label="Auto-decline early meetings">
        <Toggle checked={s.autoDeclineEarly} onChange={v => set({ autoDeclineEarly: v })} />
      </FieldCol>
      <FieldCol label="Meeting buffer" sub="Virtual gap between meetings" span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {BUFFER_STEPS.map(n => (
            <button key={n} onClick={() => set({ bufferMins: n })}
              style={{
                padding: '5px 14px', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 500,
                background: s.bufferMins === n ? 'var(--color-accent-fill)' : 'var(--color-surface2, #0D0F1A)',
                border: `1px solid ${s.bufferMins === n ? 'var(--color-accent, #1E40AF)' : 'var(--color-border, #252A3E)'}`,
                color: s.bufferMins === n ? 'var(--color-accent, #1E40AF)' : 'var(--color-text-muted, #6B7280)',
              }}>{n === 0 ? 'None' : `${n}m`}</button>
          ))}
        </div>
      </FieldCol>
      <FieldCol label="Physical meeting buffer" sub="Extra travel time" span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {PHYS_STEPS.map(n => (
            <button key={n} onClick={() => set({ physicalBufferMins: n })}
              style={{
                padding: '5px 14px', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 500,
                background: s.physicalBufferMins === n ? 'var(--color-accent-fill)' : 'var(--color-surface2, #0D0F1A)',
                border: `1px solid ${s.physicalBufferMins === n ? 'var(--color-accent, #1E40AF)' : 'var(--color-border, #252A3E)'}`,
                color: s.physicalBufferMins === n ? 'var(--color-accent, #1E40AF)' : 'var(--color-text-muted, #6B7280)',
              }}>{n === 0 ? 'None' : `${n}m`}</button>
          ))}
        </div>
      </FieldCol>
    </div>
  )
}

// ─── CHUNK 4: Companies + Habits sections ────────────────────────────────────

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

  function addCompany() {
    if (!newName.trim()) return
    const next = [...companies, {
      id: crypto.randomUUID(), name: newName.trim(),
      color: newColor, calendarId: '', emailDomain: newDomain.trim(),
      accountId: newAccountId, isActive: true,
    }]
    setCompanies(next); saveCompanies(next)
    setNewName(''); setNewDomain(''); setAdding(false)
  }

  function updateCompany(id: string, patch: Partial<CompanyRow>) {
    const next = companies.map(c => c.id === id ? { ...c, ...patch } : c)
    setCompanies(next); saveCompanies(next)
  }

  function deleteCompany(id: string) {
    const next = companies.filter(c => c.id !== id)
    setCompanies(next); saveCompanies(next)
  }

  return (
    <div>
      <p style={{ margin: '0 0 16px', fontSize: 12.5, color: 'var(--color-text-muted, #6B7280)', lineHeight: 1.55 }}>
        Companies are your work contexts. Assign a colour, link to a Google account, and optionally map an email domain for automatic tagging.
      </p>

      {companies.map(co => (
        <div key={co.id} style={{
          display: 'flex', alignItems: 'flex-start', gap: 12,
          padding: '14px 0', borderBottom: '1px solid var(--color-border, #252A3E)',
        }}>
          {/* Color swatch */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <div style={{ width: 28, height: 28, borderRadius: 7, background: co.color, cursor: 'pointer' }} title="Color" />
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input value={co.name} onChange={e => updateCompany(co.id, { name: e.target.value })}
                style={{ ...inputStyle, width: 160 }} placeholder="Company name" />
              {/* Email domain */}
              <input value={co.emailDomain} onChange={e => updateCompany(co.id, { emailDomain: e.target.value })}
                style={{ ...inputStyle, width: 180 }} placeholder="@domain.com (email filter)" />
              {/* Account selector */}
              {accounts.length > 0 && (
                <select value={co.accountId} onChange={e => updateCompany(co.id, { accountId: e.target.value })}
                  style={{ ...selectStyle, width: 180 }}>
                  <option value="">No account linked</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.email}</option>)}
                </select>
              )}
            </div>
            {/* Color row */}
            <div style={{ display: 'flex', gap: 6 }}>
              {C_COLORS.map(c => (
                <button key={c} onClick={() => updateCompany(co.id, { color: c })}
                  style={{
                    width: 20, height: 20, borderRadius: '50%', background: c, border: 'none', cursor: 'pointer',
                    outline: co.color === c ? `2px solid ${c}` : 'none', outlineOffset: 2,
                  }} />
              ))}
            </div>
          </div>
          {/* Active toggle + delete */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <Toggle checked={co.isActive} onChange={v => updateCompany(co.id, { isActive: v })} />
            <button onClick={() => deleteCompany(co.id)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted, #6B7280)', padding: 4 }}>
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      ))}

      {adding ? (
        <div style={{ marginTop: 14, padding: '14px', background: 'var(--color-surface2, #0D0F1A)', borderRadius: 10, border: '1px solid var(--color-border, #252A3E)' }}>
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
              style={{ padding: '6px 14px', borderRadius: 7, background: 'transparent', border: '1px solid var(--color-border, #252A3E)', color: 'var(--color-text-dim, #94A3B8)', fontSize: 12, cursor: 'pointer', display: 'flex', gap: 5, alignItems: 'center' }}>
              <X size={11} /> Cancel
            </button>
            <button onClick={addCompany} disabled={!newName.trim()}
              style={{ padding: '6px 16px', borderRadius: 7, background: 'var(--color-accent-fill)', border: '1px solid var(--color-accent, #1E40AF)50', color: 'var(--color-accent, #1E40AF)', fontSize: 12, fontWeight: 500, cursor: 'pointer', opacity: newName.trim() ? 1 : 0.4, display: 'flex', gap: 5, alignItems: 'center' }}>
              <Plus size={11} /> Add Company
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} style={{
          marginTop: 12, display: 'flex', alignItems: 'center', gap: 7, width: '100%',
          padding: '11px 16px', borderRadius: 9, background: 'transparent',
          border: '1px dashed var(--color-border, #252A3E)',
          color: 'var(--color-text-muted, #6B7280)', fontSize: 13, cursor: 'pointer',
        }}>
          <Plus size={13} /> Add a company / context
        </button>
      )}
    </div>
  )
}

function HabitsSection() {
  const COLORS = getHabitColors()
  const { habits, addHabit: storeAdd, updateHabit, deleteHabit: storeDel } = useHabitsStore()
  const [adding, setAdding] = useState(false)
  const [newName, setNewName]     = useState('')
  const [newEmoji, setNewEmoji]   = useState('🎯')
  const [newColor, setNewColor]   = useState(COLORS[0])
  const [newFreq, setNewFreq]     = useState<typeof FREQ_OPTS[number]>('daily')

  function addHabit() {
    if (!newName.trim()) return
    storeAdd({ name: newName.trim(), emoji: newEmoji, color: newColor, frequency: newFreq, isActive: true })
    setNewName(''); setAdding(false)
  }
  function toggle(id: string) {
    const h = habits.find(x => x.id === id)
    if (h) updateHabit(id, { isActive: !h.isActive })
  }
  function del(id: string) {
    storeDel(id)
  }

  return (
    <div>
      <p style={{ margin: '0 0 14px', fontSize: 12.5, color: 'var(--color-text-muted, #6B7280)' }}>
        Changes here instantly sync with the Habits Tracker page.
      </p>

      {habits.map(h => (
        <div key={h.id} style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 0', borderBottom: '1px solid var(--color-border, #252A3E)',
          opacity: h.isActive ? 1 : 0.5,
        }}>
          <span style={{ fontSize: 18, flexShrink: 0 }}>{h.emoji}</span>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: h.color, flexShrink: 0 }} />
          <span style={{ flex: 1, fontSize: 13.5, color: 'var(--color-text, #E8EAF6)' }}>{h.name}</span>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted, #6B7280)', background: 'var(--color-surface2, #0D0F1A)', padding: '2px 8px', borderRadius: 4 }}>
            {h.frequency}
          </span>
          <Toggle checked={h.isActive} onChange={() => toggle(h.id)} />
          <button onClick={() => del(h.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted, #6B7280)', padding: 4 }}>
            <Trash2 size={13} />
          </button>
        </div>
      ))}

      {adding ? (
        <div style={{ marginTop: 12, padding: 14, background: 'var(--color-surface2, #0D0F1A)', borderRadius: 10, border: '1px solid var(--color-border, #252A3E)' }}>
          {/* Emoji picker */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {HABIT_EMOJIS.map(e => (
              <button key={e} onClick={() => setNewEmoji(e)} style={{
                fontSize: 16, width: 34, height: 34, borderRadius: 7, cursor: 'pointer',
                background: newEmoji === e ? 'var(--color-accent-fill)' : 'transparent',
                border: `1px solid ${newEmoji === e ? 'var(--color-accent, #1E40AF)' : 'var(--color-border, #252A3E)'}`,
              }}>{e}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <input value={newName} onChange={e => setNewName(e.target.value)} autoFocus placeholder="Habit name"
              style={{ ...inputStyle, width: 200 }}
              onKeyDown={e => { if (e.key === 'Enter') addHabit(); if (e.key === 'Escape') setAdding(false) }} />
            <select value={newFreq} onChange={e => setNewFreq(e.target.value as typeof FREQ_OPTS[number])}
              style={{ ...selectStyle, width: 120 }}>
              {FREQ_OPTS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            {COLORS.map(c => (
              <button key={c} onClick={() => setNewColor(c)} style={{
                width: 22, height: 22, borderRadius: '50%', background: c, border: 'none', cursor: 'pointer',
                outline: newColor === c ? `2px solid ${c}` : 'none', outlineOffset: 2,
              }} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setAdding(false); setNewName('') }} style={{ padding: '6px 14px', borderRadius: 7, background: 'transparent', border: '1px solid var(--color-border, #252A3E)', color: 'var(--color-text-dim, #94A3B8)', fontSize: 12, cursor: 'pointer', display: 'flex', gap: 5, alignItems: 'center' }}>
              <X size={11} /> Cancel
            </button>
            <button onClick={addHabit} disabled={!newName.trim()} style={{ padding: '6px 16px', borderRadius: 7, background: 'var(--color-accent-fill)', border: '1px solid var(--color-accent, #1E40AF)50', color: 'var(--color-accent, #1E40AF)', fontSize: 12, fontWeight: 500, cursor: 'pointer', opacity: newName.trim() ? 1 : 0.4, display: 'flex', gap: 5, alignItems: 'center' }}>
              <Plus size={11} /> Add Habit
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} style={{
          marginTop: 12, display: 'flex', alignItems: 'center', gap: 7, width: '100%',
          padding: '11px 16px', borderRadius: 9, background: 'transparent',
          border: '1px dashed var(--color-border, #252A3E)',
          color: 'var(--color-text-muted, #6B7280)', fontSize: 13, cursor: 'pointer',
        }}>
          <Plus size={13} /> Add a habit
        </button>
      )}
    </div>
  )
}

// ─── CHUNK 5: Connected Accounts (multi-Google) ───────────────────────────────

function AccountsSection({
  accounts, setAccounts, primaryEmail,
}: {
  accounts: ConnectedAccount[]
  setAccounts: (a: ConnectedAccount[]) => void
  primaryEmail: string
}) {
  const [adding, setAdding]         = useState(false)
  const [calendars, setCalendars]   = useState<Record<string, string[]>>({}) // accountId → calendar names
  const [loadingCals, setLoading]   = useState<string | null>(null)

  async function connectAdditional() {
    setAdding(true)
    try {
      // Open OAuth popup for additional scope — we use signInWithGoogle which redirects.
      // For additional accounts we store the token separately after redirect.
      await signInWithGoogle()
    } catch { /* user cancelled */ }
    setAdding(false)
  }

  async function loadCalendars(acc: ConnectedAccount) {
    setLoading(acc.id)
    const cals = await fetchGCals(acc.providerToken)
    setCalendars(prev => ({ ...prev, [acc.id]: cals.map(c => c.summary) }))
    setLoading(null)
  }

  function removeAcc(id: string) {
    removeAccount(id)
    setAccounts(loadAccounts())
  }

  // Primary account row (from Supabase session)
  const primaryToken = localStorage.getItem('google_provider_token') ?? ''

  return (
    <div>
      <p style={{ margin: '0 0 16px', fontSize: 12.5, color: 'var(--color-text-muted, #6B7280)', lineHeight: 1.55 }}>
        Connect multiple Google accounts to aggregate all your calendars and Gmail inboxes in one place.
        Primary account is your sign-in account.
      </p>

      {/* Primary account */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 14px', borderRadius: 10, marginBottom: 10,
        background: 'var(--color-surface2, #0D0F1A)',
        border: '1px solid var(--color-accent, #1E40AF)30',
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
          background: 'var(--color-accent-fill)', border: '1px solid var(--color-accent, #1E40AF)40',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: 'var(--color-accent, #1E40AF)',
        }}>
          {primaryEmail ? primaryEmail[0].toUpperCase() : 'G'}
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: 'var(--color-text, #E8EAF6)' }}>{primaryEmail || 'Primary Google Account'}</p>
          <p style={{ margin: '2px 0 0', fontSize: 11, color: '#1D9E75' }}>✓ Primary · Calendar + Gmail access</p>
        </div>
        <span style={{ fontSize: 10.5, padding: '3px 10px', borderRadius: 20, background: 'rgba(29,158,117,0.1)', color: '#1D9E75', border: '1px solid rgba(29,158,117,0.2)' }}>
          Active
        </span>
        {primaryToken && (
          <button onClick={() => loadCalendars({ id: 'primary', email: primaryEmail, name: '', providerToken: primaryToken, scopes: [], connectedAt: '', isPrimary: true })}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted, #6B7280)', padding: 4, display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}
            title="Load calendars">
            <RefreshCw size={12} style={{ animation: loadingCals === 'primary' ? 'spin 1s linear infinite' : 'none' }} />
          </button>
        )}
      </div>

      {/* Show primary calendars */}
      {calendars['primary'] && (
        <div style={{ marginBottom: 12, padding: '8px 14px', background: 'var(--color-surface2, #0D0F1A)', borderRadius: 8, border: '1px solid var(--color-border, #252A3E)' }}>
          <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted, #6B7280)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Calendars in this account</p>
          {calendars['primary'].map(name => (
            <p key={name} style={{ margin: '3px 0', fontSize: 12, color: 'var(--color-text-dim, #94A3B8)' }}>• {name}</p>
          ))}
        </div>
      )}

      {/* Additional connected accounts */}
      {accounts.filter(a => !a.isPrimary).map(acc => (
        <div key={acc.id} style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 14px', borderRadius: 10, marginBottom: 8,
          background: 'var(--color-surface2, #0D0F1A)',
          border: '1px solid var(--color-border, #252A3E)',
        }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, background: '#7F77DD18', border: '1px solid #7F77DD40', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#7F77DD' }}>
            {acc.email ? acc.email[0].toUpperCase() : 'G'}
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: 'var(--color-text, #E8EAF6)' }}>{acc.email || acc.name}</p>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--color-text-muted, #6B7280)' }}>
              Connected {new Date(acc.connectedAt).toLocaleDateString()}
            </p>
          </div>
          <button onClick={() => loadCalendars(acc)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted, #6B7280)', padding: 4, display: 'flex' }} title="Load calendars">
            <RefreshCw size={12} style={{ animation: loadingCals === acc.id ? 'spin 1s linear infinite' : 'none' }} />
          </button>
          <button onClick={() => removeAcc(acc.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#E05252', padding: 4, display: 'flex' }}>
            <Trash2 size={13} />
          </button>
        </div>
      ))}

      {/* Show calendars for additional accounts */}
      {accounts.filter(a => !a.isPrimary).map(acc => calendars[acc.id] ? (
        <div key={`${acc.id}-cals`} style={{ marginBottom: 8, padding: '8px 14px', background: 'var(--color-surface2, #0D0F1A)', borderRadius: 8, border: '1px solid var(--color-border, #252A3E)' }}>
          <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted, #6B7280)', textTransform: 'uppercase' }}>{acc.email} calendars</p>
          {calendars[acc.id].map(name => <p key={name} style={{ margin: '3px 0', fontSize: 12, color: 'var(--color-text-dim, #94A3B8)' }}>• {name}</p>)}
        </div>
      ) : null)}

      {/* Add account button */}
      <button onClick={() => void connectAdditional()} disabled={adding}
        style={{
          marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          padding: '12px 16px', borderRadius: 9,
          background: 'var(--color-surface2, #0D0F1A)',
          border: '1px dashed var(--color-border, #252A3E)',
          color: 'var(--color-accent, #1E40AF)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
          opacity: adding ? 0.6 : 1,
        }}>
        <LogIn size={14} />
        {adding ? 'Connecting…' : '+ Connect another Google account'}
      </button>

      <p style={{ margin: '10px 0 0', fontSize: 11.5, color: 'var(--color-text-muted, #6B7280)', lineHeight: 1.55 }}>
        All connected accounts are used for calendar aggregation and inbox triage. Tokens are stored locally only.
      </p>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

// ─── CHUNK 6: Professor AI + Notifications + Appearance sections ──────────────

function ProfessorSection({ s, set }: { s: AppSettings; set: (p: Partial<AppSettings>) => void }) {
  return (
    <div style={col2}>
      <FieldCol label="Communication style" sub="How detailed should responses be?" span>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['brief','balanced','detailed'] as const).map(v => (
            <button key={v} onClick={() => set({ commStyle: v })}
              style={{
                padding: '6px 16px', borderRadius: 7, fontSize: 12, cursor: 'pointer', fontWeight: 500, textTransform: 'capitalize',
                background: s.commStyle === v ? 'var(--color-accent-fill)' : 'var(--color-surface2, #0D0F1A)',
                border: `1px solid ${s.commStyle === v ? 'var(--color-accent, #1E40AF)' : 'var(--color-border, #252A3E)'}`,
                color: s.commStyle === v ? 'var(--color-accent, #1E40AF)' : 'var(--color-text-muted, #6B7280)',
              }}>{v}</button>
          ))}
        </div>
      </FieldCol>
      <FieldCol label="Proactive suggestions" sub="Offers advice without being asked">
        <Toggle checked={s.proactive} onChange={v => set({ proactive: v })} />
      </FieldCol>
      <FieldCol label="Morning brief time">
        <input type="time" value={s.briefTime} onChange={e => set({ briefTime: e.target.value })}
          style={{ ...inputStyle, width: '100%' }} />
      </FieldCol>
      <FieldCol label="Weekly review day">
        <select value={s.reviewDay} onChange={e => set({ reviewDay: e.target.value })} style={{ ...selectStyle, width: '100%' }}>
          {['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map(d =>
            <option key={d} value={d}>{d}</option>)}
        </select>
      </FieldCol>
      <FieldCol label="Custom instructions" sub="Guide the Professor's personality and priorities" span>
        <textarea value={s.customInstructions} onChange={e => set({ customInstructions: e.target.value })}
          rows={3} placeholder="e.g. Always be concise. Prioritise Teradix work…"
          style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} />
      </FieldCol>
    </div>
  )
}

function NotificationsSection({ s, set }: { s: AppSettings; set: (p: Partial<AppSettings>) => void }) {
  return (
    <div style={col2}>
      <FieldCol label="Morning brief reminder">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Toggle checked={s.morningReminderOn} onChange={v => set({ morningReminderOn: v })} />
          {s.morningReminderOn && (
            <input type="time" value={s.morningReminderTime} onChange={e => set({ morningReminderTime: e.target.value })}
              style={{ ...inputStyle, width: 110 }} />
          )}
        </div>
      </FieldCol>
      <FieldCol label="Wind-down reminder">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Toggle checked={s.windDownOn} onChange={v => set({ windDownOn: v })} />
          {s.windDownOn && (
            <input type="time" value={s.windDownTime} onChange={e => set({ windDownTime: e.target.value })}
              style={{ ...inputStyle, width: 110 }} />
          )}
        </div>
      </FieldCol>
      <FieldCol label="Follow-up nudges" sub="Remind you of delegated/waiting tasks">
        <Toggle checked={s.followUpNudges} onChange={v => set({ followUpNudges: v })} />
      </FieldCol>
      <FieldCol label="Weekly review reminder" span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Toggle checked={s.weeklyReviewOn} onChange={v => set({ weeklyReviewOn: v })} />
          {s.weeklyReviewOn && (
            <>
              <select value={s.weeklyReviewDay} onChange={e => set({ weeklyReviewDay: e.target.value })} style={{ ...selectStyle, width: 130 }}>
                {['Sunday','Monday','Saturday'].map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <input type="time" value={s.weeklyReviewTime} onChange={e => set({ weeklyReviewTime: e.target.value })}
                style={{ ...inputStyle, width: 120 }} />
            </>
          )}
        </div>
      </FieldCol>
    </div>
  )
}

function AppearanceSection({ s, set }: { s: AppSettings; set: (p: Partial<AppSettings>) => void }) {
  const { setThemeId } = useUIStore()

  function pickTheme(id: string) {
    set({ theme: id })
    setThemeId(id)
    applyThemeVars(getTheme(id))
  }

  return (
    <div style={col2}>
      {/* Theme picker — full width */}
      <div style={{ gridColumn: '1 / -1', paddingBottom: 12, borderBottom: '1px solid var(--color-border, #252A3E)' }}>
        <p style={{ margin: '0 0 12px', fontSize: 12.5, fontWeight: 500, color: 'var(--color-text, #E8EAF6)' }}>Theme</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
          {THEMES.map(t => {
            const active = s.theme === t.id
            return (
              <button key={t.id} onClick={() => pickTheme(t.id)}
                style={{
                  padding: '10px 8px', borderRadius: 10, cursor: 'pointer', flexDirection: 'column',
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: t.surface, border: `2px solid ${active ? t.accent : t.border}`,
                  boxShadow: active ? `0 0 12px ${t.accent}40` : 'none',
                  transition: 'all 0.15s',
                }}>
                <div style={{ display: 'flex', gap: 3 }}>
                  {[t.accent, t.accentFill ? t.accentBright : t.textDim, t.textMuted].map((c, i) => (
                    <div key={i} style={{ width: 10, height: 10, borderRadius: '50%', background: c }} />
                  ))}
                </div>
                <span style={{ fontSize: 14 }}>{t.emoji}</span>
                <span style={{ fontSize: 10, color: t.text, fontWeight: active ? 700 : 400, whiteSpace: 'nowrap' }}>{t.name}</span>
              </button>
            )
          })}
        </div>
      </div>

      <FieldCol label="Sidebar expanded by default">
        <Toggle checked={!s.sidebarDefault} onChange={v => set({ sidebarDefault: !v })} />
      </FieldCol>
      <FieldCol label="Compact density" sub="Tighter spacing throughout the UI">
        <Toggle checked={s.compact} onChange={v => set({ compact: v })} />
      </FieldCol>
    </div>
  )
}

// ─── CHUNK 7: Main Settings component ────────────────────────────────────────

export function Settings() {
  const [settings, setSettings]         = useState<AppSettings>(loadSettings)
  const [companies, setCompanies]       = useState<CompanyRow[]>(loadCompanies)
  const [accounts, setAccounts]         = useState<ConnectedAccount[]>(loadAccounts)
  const [sectionOrder, setSectionOrder] = useState<SectionId[]>(loadSectionOrder)

  const [supaOk, setSupaOk]             = useState<boolean | null>(null)
  // Per-section save states + error messages
  const [sectionSaving, setSectionSaving] = useState<Record<string, 'idle'|'saving'|'saved'|'error'>>({})
  const [sectionError,  setSectionError]  = useState<Record<string, string>>({})
  const authUser = useAuthStore(s => s.user)
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  useEffect(() => { void checkSupabase().then(setSupaOk) }, [])

  // ── Local-only field updates (immediate localStorage) ────────────────────────
  function update(patch: Partial<AppSettings>) {
    setSettings(prev => {
      const next = { ...prev, ...patch }
      saveSettings(next)
      return next
    })
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

  // ── DnD sensors ─────────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = sectionOrder.indexOf(active.id as SectionId)
    const newIdx = sectionOrder.indexOf(over.id as SectionId)
    const next = arrayMove(sectionOrder, oldIdx, newIdx)
    setSectionOrder(next)
    saveSectionOrder(next)
  }

  // ── Section renderer ─────────────────────────────────────────────────────────
  function renderSection(id: SectionId) {
    const meta = SECTION_META.find(m => m.id === id)!
    const saving = sectionSaving[id] ?? 'idle'

    // Wrap save button label with state feedback
    const saveLabel = saving === 'saving' ? 'Saving…' : saving === 'saved' ? 'Saved ✓' : saving === 'error' ? 'Error ✗' : undefined

    // Map section id → its DB save function
    const saveFns: Partial<Record<SectionId, () => Promise<void>>> = {
      profile:       () => saveProfileToDB(settingsRef.current),
      schedule:      () => saveProfileToDB(settingsRef.current),
      companies:     () => saveCompaniesToDB(companies as DbSyncCompanyRow[]),
      habits:        async () => { const { habits } = useHabitsStore.getState(); await saveHabitsToDB(habits); await saveHabitLogsToDB(loadLogs()) },
      professor:     () => savePrefsToDB(settingsRef.current),
      notifications: () => savePrefsToDB(settingsRef.current),
      appearance:    () => savePrefsToDB(settingsRef.current),
    }
    const saveFn = saveFns[id]

    const errMsg = sectionError[id]

    return (
      <SectionShell key={id} id={id} meta={meta}
        saveLabel={saveLabel}
        onSave={saveFn ? withSectionSave(id, saveFn) : undefined}
      >
        {saving === 'error' && errMsg && (
          <div style={{ margin: '0 0 14px', padding: '8px 12px', borderRadius: 8, background: 'rgba(224,82,82,0.08)', border: '1px solid rgba(224,82,82,0.25)', fontSize: 12, color: '#E05252' }}>
            ✗ {errMsg}
          </div>
        )}
        {id === 'profile'       && <ProfileSection       s={settings} set={update} />}
        {id === 'schedule'      && <ScheduleSection      s={settings} set={update} />}
        {id === 'companies'     && <CompaniesSection     companies={companies}
                                      setCompanies={c => { setCompanies(c); saveCompanies(c) }}
                                      accounts={accounts} />}
        {id === 'habits'        && <HabitsSection />}
        {id === 'accounts'      && <AccountsSection      accounts={accounts}
                                      setAccounts={a => { setAccounts(a) }}
                                      primaryEmail={authUser?.email ?? ''} />}
        {id === 'professor'     && <ProfessorSection     s={settings} set={update} />}
        {id === 'notifications' && <NotificationsSection s={settings} set={update} />}
        {id === 'appearance'    && <AppearanceSection    s={settings} set={update} />}
      </SectionShell>
    )
  }

  async function handleSignOut() {
    await googleSignOut()
  }

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 780, margin: '0 auto' }}>
      {/* ── Top bar: user info + status ─────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 24, padding: '16px 20px',
        background: 'var(--color-surface, #161929)',
        border: '1px solid var(--color-border, #252A3E)',
        borderRadius: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {authUser?.avatarUrl
            ? <img src={authUser.avatarUrl} alt="avatar" style={{ width: 40, height: 40, borderRadius: '50%', border: '2px solid var(--color-border, #252A3E)' }} />
            : <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--color-accent-fill, rgba(30,64,175,0.15))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <User size={18} color="var(--color-accent, #1E40AF)" />
              </div>
          }
          <div>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--color-text, #E8EAF6)' }}>
              {authUser?.name ?? authUser?.email ?? 'Professor User'}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: supaOk === null ? '#888780' : supaOk ? '#1D9E75' : '#E05252' }} />
                <span style={{ fontSize: 11, color: 'var(--color-text-muted, #6B7280)' }}>
                  {supaOk === null ? 'Checking...' : supaOk ? 'Supabase connected' : 'Offline (local only)'}
                </span>
              </div>
              <span style={{ color: 'var(--color-border, #252A3E)' }}>·</span>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted, #6B7280)' }}>
                {accounts.length + 1} account{accounts.length !== 0 ? 's' : ''} connected
              </span>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => void checkSupabase().then(setSupaOk)}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 13px', borderRadius: 8, background: 'transparent', border: '1px solid var(--color-border, #252A3E)', color: 'var(--color-text-dim, #94A3B8)', fontSize: 12, cursor: 'pointer' }}>
            <RefreshCw size={12} /> Refresh
          </button>
          <button onClick={() => void handleSignOut()}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 13px', borderRadius: 8, background: 'transparent', border: '1px solid rgba(224,82,82,0.3)', color: '#E05252', fontSize: 12, cursor: 'pointer' }}>
            <LogOut size={12} /> Sign out
          </button>
        </div>
      </div>

      {/* ── Drag-reorderable sections ────────────────────────────────────────── */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={sectionOrder} strategy={verticalListSortingStrategy}>
          {sectionOrder.map(id => renderSection(id))}
        </SortableContext>
      </DndContext>

      {/* ── Footer hint ─────────────────────────────────────────────────────── */}
      <p style={{ textAlign: 'center', fontSize: 11.5, color: 'var(--color-text-muted, #6B7280)', marginTop: 24 }}>
        Drag sections to reorder · Changes save automatically
      </p>
    </div>
  )
}

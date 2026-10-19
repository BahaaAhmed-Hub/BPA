import { useState, useEffect, useMemo, useRef } from 'react'
import { Button, Segmented, EmptyState } from '@/components/ui'
import { NAV_H } from '@/App'
import { Plus, Trash2, X, RefreshCw, Pencil, HardDrive, CalendarDays, Wand2, Sparkles, ArrowUpRight, Database, BellOff, MessageSquare } from 'lucide-react'
import { usePersona } from '@/lib/assistantPersona'
import { paidAtSupported } from '../finance/unpaid'
import { todayISO } from '../finance/dates'
import { loadNotifSettings, saveNotifSettings, loadQuietHours, saveQuietHours, dormantWhy, type NotifSetting, type NotifChannel } from '@/lib/notifications'
import type { EnvelopeStyle as BudgetEnvelopeStyle } from '@/modules/finance/screens/BudgetScreen'
import { biometricsAvailable, biometricName, deviceLabel, forgetPasskey, hashPassword, isLocked, loadLock, loadPasskey, markActive, registerPasskey, saveLock, RELOCK_CHOICES, type DevicePasskey, type LockConfig, type Relock } from '@/modules/finance/lock'
import { LockGate } from '@/modules/finance/FinanceLockScreen'
import { loadAutomationRules, saveAutomationRules, loadRunLog, runAutomation, AUTOMATION_EVENT, type AutomationRule, type RunEntry } from '@/lib/automation'
import { signOut as googleSignOut } from '@/lib/google'
import { useAuthStore } from '@/store/authStore'
import { useHabitsStore } from '@/store/habitsStore'
import { loadAccounts, type ConnectedAccount } from '@/lib/multiAccount'
import { saveProfileToDB, savePrefsToDB, loadCompaniesFromDB, mergeCompanies, saveHabitsToDB, saveHabitLogsToDB, loadSettingsFromDB, loadAccountsFromDB, type CompanyRow as DbSyncCompanyRow } from '@/lib/dbSync'
import { loadLogs, loadQuantityLogs } from '@/store/habitsStore'
import { loadBlockingRules, saveBlockingRules, type BlockingRule, type DetailLevel, loadCachedCalendars, type CachedCalEntry } from '@/lib/blockingRules'
import { loadRates, setRate, baseCurrency } from '@/modules/finance/fx'
import { useFinanceStore } from '@/modules/finance/financeStore'
import { loadRewardSettings, saveRewardSettings, isDormant, schemeFor, totalPoints, type RewardSettings } from '@/modules/finance/cardRewards'
import { acct, group } from '@/modules/finance/format'
import { loadRules } from '@/modules/finance/modals/BudgetRuleModal'
import { ICON, STROKE } from '@/lib/type'
import { loadReminders, saveReminders, defaultReminder, dueDatesFor, reminderTitle, type MoneyReminder } from '@/modules/finance/reminders'
import { SearchSelect } from '@/components/SearchSelect'
import { listUserTokens, createUserToken, revokeUserToken, type UserToken } from '@/lib/userTokens'
import { getTelegramLinks, revokeTelegramLink, type TelegramLink } from '@/lib/telegramLink'
import { askConfirm } from '@/lib/confirm'
import { selectStyle } from '@/lib/fields'
import { type AppSettings, type CompanyRow, type CompanyUser, DEFAULTS, checkSupabase, loadCompanies, loadSettings, ls, saveCompanies, saveSettings } from './model'
import { DRow, FieldRow, GhostPill, Toggle } from './ui'
import { NAV_GROUPS, SECTION_META, type SectionId, loadSectionOrder } from './nav'
import { ProfileSection } from './sections/Profile'
import { BillingSection } from './sections/Billing'
import { AccountsAndCompaniesSection } from './sections/Accounts'
import { ScheduleSection } from './sections/Schedule'
import { AIVoiceSection, ProfessorSection } from './sections/Ai'
import { TaskStatusesSection } from './sections/TaskStatuses'
import { HabitsSection } from './sections/Habits'
import { LibrarySection } from './sections/Library'
import { AppearanceSection } from './sections/Appearance'
import { BehavioralSection } from './sections/Behavioral'


export { type AIConfig, misplacedAnthropicKey, cleanKey, maskKey, loadAIConfig } from './model'

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
      <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--sb-r-card)', background: bg, color }}>
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
                <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 600, padding: '2px 7px', borderRadius: 'var(--sb-r-card)', background: 'color-mix(in srgb, var(--sb-positive) 12.0%, transparent)', color: 'var(--sb-positive)' }}>
                  Auto
                </span>
              )}
              {rule.hideBlocked && (
                <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 600, padding: '2px 7px', borderRadius: 'var(--sb-r-card)', background: 'color-mix(in srgb, var(--sb-info) 12.0%, transparent)', color: 'var(--sb-info)' }}>
                  Originals only
                </span>
              )}
              <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
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
              <SearchSelect
                value={srcCal}
                onChange={setSrcCal}
                options={cals.map(c => ({ value: c.id, label: c.summary ?? c.id, hint: c.accountEmail }))}
                placeholder="— choose —"
                ariaLabel="Source calendar"
                style={{ ...selectStyle, width: '100%' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', display: 'block', marginBottom: 4 }}>
                Target calendar (where blocks are created)
              </label>
              <SearchSelect
                value={tgtCal}
                onChange={setTgtCal}
                options={cals.filter(c => c.id !== srcCal).map(c => ({ value: c.id, label: c.summary ?? c.id, hint: c.accountEmail }))}
                placeholder="— choose —"
                ariaLabel="Target calendar"
                style={{ ...selectStyle, width: '100%' }}
              />
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
                    <p style={{ margin: '2px 0 0', fontSize: 'var(--sb-t-meta)', opacity: 0.7, lineHeight: 1.3 }}>{d.desc}</p>
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
                <p style={{ margin: '2px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
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
                <p style={{ margin: '2px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
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
                <button style={canBio ? solid : { ...pill, color: 'var(--sb-ink-3)', cursor: 'default' }}
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

          <p style={{ margin: '12px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.55, maxWidth: 660 }}>
            The password is stored as a salted hash and never leaves your account. A passkey never
            leaves the device that made it — each device you use registers its own, and the password
            is what gets you in on one that has not.
          </p>
        </>
      )}
    </div>
  )
}


// ─── Settings → Finance → CARD POINTS ────────────────────────────────────────
//
//  The per-card figures live on the card, in its own window, because that is
//  where they differ. What belongs here is what is true of all of them: whether
//  points are drawn as money at all, over what stretch, and what a point is
//  worth on a card whose own programme has not been filled in.
//
//  That last one starts at **nothing**, deliberately. A default of 0.50 would
//  put a figure in EGP on a screen full of measured ones, derived from a number
//  nobody gave. It is a decision, and the block says so.

function CardPointsSection() {
  const [cfg, setCfg] = useState<RewardSettings>(loadRewardSettings)
  const { accounts, transactions } = useFinanceStore()

  function patch(p: Partial<RewardSettings>) {
    const next = { ...cfg, ...p }
    setCfg(next); saveRewardSettings(next)
  }

  const cards = accounts.filter(a => a.accountType === 'credit_card')
  const withScheme = cards.filter(a => !isDormant(schemeFor(a.id)))
  const summary = totalPoints(accounts, transactions, { window: cfg.window })

  return (
    <div style={{ gridColumn: '1 / -1', marginTop: 22, paddingTop: 18, borderTop: 'var(--sb-border-width) solid var(--sb-hairline)' }}>
      <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 700, letterSpacing: '0.12em', color: 'var(--sb-ink-3)', display: 'block', marginBottom: 12 }}>CARD POINTS</span>

      {cards.length === 0 ? (
        <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', lineHeight: 1.55, maxWidth: 720 }}>
          No credit cards yet. A card's earn rate and point value are set on the card
          itself, in Balances → the card → edit, where they differ from card to card.
        </p>
      ) : (
        <>
          <p style={{ margin: '0 0 14px', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', lineHeight: 1.55, maxWidth: 720 }}>
            {withScheme.length === 0
              ? <>None of your {cards.length === 1 ? 'card has' : `${cards.length} cards have`} a
                 rewards programme set. Open a card and use <b style={{ fontWeight: 600 }}>Look it up</b> —
                 the figures come back as a suggestion to check, never as fact.</>
              : <>{withScheme.length} of {cards.length} {cards.length === 1 ? 'card earns' : 'cards earn'} points.
                 What the points are worth is <b style={{ fontWeight: 600 }}>never counted as money</b> —
                 not in a balance, a goal, a plan or a piece of advice. A card is what you
                 spend through, not what you hold.</>}
          </p>

          <FieldRow label="Show what points are worth" sub="Beside the count, in your own currency">
            <Toggle checked={cfg.showAsMoney} onChange={v => patch({ showAsMoney: v })} />
          </FieldRow>

          <FieldRow label="Count points over" sub="A statement talks about a year; a cap talks about a month">
            <Segmented
              value={cfg.window}
              onChange={v => patch({ window: v as RewardSettings['window'] })}
              options={[{ value: 'month', label: 'This month' }, { value: 'year', label: 'This year' }]}
            />
          </FieldRow>

          <FieldRow label="A point is worth" sub="Only where a card's own programme does not say. Blank means no answer, and no figure is drawn.">
            <input
              type="number" min={0} step="0.01"
              value={cfg.defaultPointValue || ''}
              placeholder="no answer"
              onChange={e => patch({ defaultPointValue: Number(e.target.value) || 0 })}
              style={{
                width: 120, padding: '7px 10px', borderRadius: 'var(--sb-r-chip)',
                border: 'var(--sb-border-width) solid var(--sb-border)',
                background: 'var(--sb-field)', color: 'var(--sb-ink-1)',
                fontSize: 'var(--sb-t-body-s)', outline: 'none', fontFamily: 'inherit',
              }} />
          </FieldRow>

          {summary.rows.length > 0 && (
            <div style={{
              marginTop: 12, padding: '11px 14px', borderRadius: 'var(--sb-r-nav)',
              background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-hairline)',
              fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-2)', lineHeight: 1.55, maxWidth: 720,
            }}>
              {group(summary.rows.reduce((t: number, r) => t + r.total, 0))} points
              {cfg.showAsMoney && summary.worthInBase !== null &&
                <> — worth about {acct(summary.worthInBase, { currency: baseCurrency() })}</>}
              {' '}{cfg.window === 'month' ? 'this month' : 'this year'}.
              {summary.noRate.length > 0 && (
                <> {summary.noRate.join(' and ')} not counted — no exchange rate has been given.</>
              )}
              {summary.rows.some(r => r.cashUse > 0) && (
                <> Cash taken on a card earns nothing and is left out.</>
              )}
            </div>
          )}
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
                    <p style={{ margin: '2px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.3 }}>{style.sub}</p>
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
          <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', marginTop: 2, marginBottom: 10, lineHeight: 1.5 }}>
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
                  <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>{currency}</span>
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
          <div style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 700, letterSpacing: '0.1em', color: 'var(--sb-ink-3)', marginBottom: 8 }}>ORDER CATEGORIES BY</div>
          <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', marginBottom: 8 }}>Biggest spend first keeps the two problems at the top</div>
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
          <p style={{ margin: '4px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
            {alertThreshold >= 1 ? 'Alert only when over budget' : alertThreshold >= 0.9 ? 'Alert at 90%+ spent (recommended)' : `Alert when ${Math.round(alertThreshold * 100)}%+ of envelope is spent`}
          </p>
        </FieldRow>
      </div>
      </div>
      <FinanceSecuritySection />
      <CardPointsSection />

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
                if (!await askConfirm({ title: 'Mark every entry paid?', body: 'Mark every entry with no payment date as paid on its due date, in every year? This rewrites the ledger and cannot be undone.', confirmLabel: 'Mark them paid', danger: false })) return
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
                if (!await askConfirm({ title: 'Un-mark future payments?', body: 'Take the payment date off every entry marked paid on a future date, in every year? This cannot be undone.', confirmLabel: 'Un-mark them' })) return
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
            <div style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', padding: '10px 0' }}>
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

                <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', whiteSpace: 'nowrap' as const }}>
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
                    background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', color: 'var(--sb-ink-3)', cursor: 'pointer',
                  }}>×</button>
              </div>
            )
          })}
          {reminders.some(r => r.enabled) && (
            <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', marginTop: 8 }}>
              Tasks are made for the next {reminders[0]?.monthsAhead ?? 3} months and topped up as
              time passes. Deleting one from the board does not bring it back.
            </div>
          )}
        </div>

      </div>

      {/* ── Shopping List ─────────────────────────────────────────────────── */}
      <ShoppingSettingsBlock />

    </div>
  )
}

// ─── Shopping List settings block (inside FinanceSection) ────────────────────

function ShoppingSettingsBlock() {
  const [enabled, setEnabled] = useState(() => {
    try { return JSON.parse(localStorage.getItem('shopping-settings') ?? '{}').enabled === true } catch { return false }
  })
  const [priceFreq, setPriceFreq] = useState<string>(() => {
    try { return JSON.parse(localStorage.getItem('shopping-settings') ?? '{}').priceWatchFrequency ?? 'off' } catch { return 'off' }
  })
  const [markCal, setMarkCal] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem('shopping-settings') ?? '{}').markCalendarDoneOnPurchase ?? false } catch { return false }
  })
  const [markTask, setMarkTask] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem('shopping-settings') ?? '{}').markTaskDoneOnPurchase ?? false } catch { return false }
  })
  const [lastRefreshed] = useState<string | undefined>(() => {
    try { return JSON.parse(localStorage.getItem('shopping-settings') ?? '{}').lastAutoRefreshed } catch { return undefined }
  })

  function save(patch: Record<string, unknown>) {
    try {
      const existing = JSON.parse(localStorage.getItem('shopping-settings') ?? '{}')
      const next = { ...existing, ...patch }
      localStorage.setItem('shopping-settings', JSON.stringify(next))
      // Notify other windows/FinanceModule
      window.dispatchEvent(new StorageEvent('storage', { key: 'shopping-settings', newValue: JSON.stringify(next) }))
    } catch { /* noop */ }
  }

  const FREQ_LABELS: Record<string, string> = {
    off: 'Off', '6h': 'Every 6 hours', '12h': 'Every 12 hours', '24h': 'Once a day', '7d': 'Once a week',
  }

  return (
    <div style={{ borderTop: '1px solid var(--sb-border)', paddingTop: 28, marginTop: 28 }}>
      <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 700, letterSpacing: '0.12em', color: 'var(--sb-ink-3)', display: 'block', marginBottom: 12 }}>SHOPPING LIST</span>

      <DRow label="Enable shopping list" sub="Adds a Shopping tab inside Finance">
        <Toggle checked={enabled} onChange={(v: boolean) => { setEnabled(v); save({ enabled: v }) }} />
      </DRow>

      {enabled && (
        <>
          <DRow label="Check prices automatically" sub="How often the app looks up prices from your stores">
            <select
              value={priceFreq}
              onChange={e => {
                setPriceFreq(e.target.value)
                save({ priceWatchFrequency: e.target.value })
                // Call the Edge Function to configure the cron schedule
                void (async () => {
                  const { supabase } = await import('@/lib/supabase')
                  const { data: { user } } = await supabase.auth.getUser()
                  if (!user) return
                  await supabase.functions.invoke('shopping-price-watch', {
                    body: { action: 'set_cron', frequency: e.target.value },
                  }).catch(() => null)
                })()
              }}
              style={{
                fontSize: 'var(--sb-t-body-s)', padding: '4px 8px', borderRadius: 'var(--sb-r-chip)',
                border: 'var(--sb-border-width) solid var(--sb-border)',
                background: 'var(--sb-field)', color: 'var(--sb-ink-1)',
              }}
            >
              {Object.entries(FREQ_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </DRow>

          {lastRefreshed && (
            <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', marginLeft: 0, marginBottom: 12 }}>
              Last auto-refresh: {new Date(lastRefreshed).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </div>
          )}

          <DRow label="Mark calendar events done on purchase" sub="When you mark an item purchased, its linked calendar event is updated">
            <Toggle checked={markCal} onChange={(v: boolean) => { setMarkCal(v); save({ markCalendarDoneOnPurchase: v }) }} />
          </DRow>

          <DRow label="Complete linked tasks on purchase" sub="When you mark an item purchased, its linked task is completed and logged">
            <Toggle checked={markTask} onChange={(v: boolean) => { setMarkTask(v); save({ markTaskDoneOnPurchase: v }) }} />
          </DRow>
        </>
      )}
    </div>
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
    <div style={{ width: 44, textAlign: 'center', fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.09em', color: 'var(--sb-ink-3)', textTransform: 'uppercase' }}>{label}</div>
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
                  fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', fontWeight: 500,
                  padding: '1px 7px', borderRadius: 'var(--sb-r-pill)',
                  background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-hairline)',
                  whiteSpace: 'nowrap',
                }}>{dormantWhy(e.id, events)}</span>
              )}
            </p>
            <p style={{ margin: '1px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.3 }}>{e.sub}</p>
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
            <p style={{ margin: '1px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>Nothing but the morning brief gets through</p>
          </div>
          <Toggle checked={quietOn} onChange={setQuietOn} />
        </div>
        {quietOn && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input type="time" value={quietStart} onChange={e => setQStart(e.target.value)} style={{ padding: '5px 10px', borderRadius: 'var(--sb-r-chip)', border: 'var(--sb-border-width) solid var(--sb-border)', background: 'var(--sb-card)', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)' }} />
            <span style={{ color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-body-s)' }}>to</span>
            <input type="time" value={quietEnd} onChange={e => setQEnd(e.target.value)} style={{ padding: '5px 10px', borderRadius: 'var(--sb-r-chip)', border: 'var(--sb-border-width) solid var(--sb-border)', background: 'var(--sb-card)', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)' }} />
          </div>
        )}
      </div>

      {/* Mute button */}
      <button style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 'var(--sb-r-chip)', background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', fontSize: 'var(--sb-t-body-s)', fontWeight: 500, color: 'var(--sb-ink-3)', cursor: 'pointer' }}>
        <BellOff size={ICON.sm} strokeWidth={STROKE.rest} aria-hidden /> Mute for 1h
      </button>
    </div>
  )
}

// ─── Integrations Section (11D) ───────────────────────────────────────────────

function IntegrationsSection() {
  // The Shortcut is named after the assistant, so "Hey Siri, <name>" is how you call it with the app shut.
  const siriName = usePersona().name || 'Ask Professor'
  const [tokens, setTokens] = useState<UserToken[]>([])
  const [creatingToken, setCreatingToken] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [revealedToken, setRevealedToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [copiedSiri, setCopiedSiri] = useState(false)
  const [telegramLinks, setTelegramLinks] = useState<TelegramLink[]>([])
  const [siriToken, setSiriToken] = useState<string | null>(null)

  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const siriBaseUrl  = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/professor-siri` : ''

  useEffect(() => {
    listUserTokens().then(setTokens)
    getTelegramLinks().then(setTelegramLinks)
  }, [])

  async function handleCreateToken() {
    if (!newLabel.trim()) return
    const tok = await createUserToken(newLabel.trim())
    if (!tok) return
    setTokens(prev => [tok, ...prev])
    setRevealedToken(tok.token)
    setCreatingToken(false)
    setNewLabel('')
    setCopied(false)
  }

  async function handleRevoke(id: string) {
    const ok = await revokeUserToken(id)
    if (ok) setTokens(prev => prev.filter(t => t.id !== id))
  }

  async function handleRevokeTelegram(chatId: string) {
    const ok = await revokeTelegramLink(chatId)
    if (ok) setTelegramLinks(prev => prev.filter(l => l.chat_id !== chatId))
  }

  function copyToken() {
    if (!revealedToken) return
    navigator.clipboard.writeText(revealedToken).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div>
      {/* ── CONNECTIONS — personal access tokens ─────────────────────────── */}
      <div style={{ marginTop: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <p style={{ margin: 0, fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.14em', color: 'var(--sb-ink-3)', textTransform: 'uppercase' }}>Connections</p>
            <p style={{ margin: '2px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.4 }}>
              Tokens let the MCP server, Siri Shortcuts, and Telegram act as you. Each is shown once — copy it before closing.
            </p>
          </div>
          <button onClick={() => { setCreatingToken(true); setRevealedToken(null) }} style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 'var(--sb-r-chip)',
            background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
            fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-2)', cursor: 'pointer', flexShrink: 0,
          }}>
            <Plus size={ICON.sm} /> New token
          </button>
        </div>

        {/* Create form */}
        {creatingToken && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
            <input
              autoFocus
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void handleCreateToken(); if (e.key === 'Escape') setCreatingToken(false) }}
              placeholder="Label, e.g. Siri Shortcuts"
              style={{ flex: 1, fontSize: 'var(--sb-t-body-s)', padding: '7px 11px', borderRadius: 'var(--sb-r-chip)', border: 'var(--sb-border-width) solid var(--sb-border)', background: 'var(--sb-field)', color: 'var(--sb-ink-1)', outline: 'none' }}
            />
            <button onClick={() => void handleCreateToken()} disabled={!newLabel.trim()} style={{
              padding: '7px 14px', borderRadius: 'var(--sb-r-chip)', border: 'none',
              background: newLabel.trim() ? 'var(--sb-ink-1)' : 'var(--sb-border)', color: newLabel.trim() ? 'var(--sb-page)' : 'var(--sb-ink-4)', // ui-guard: ink-ok
              fontSize: 'var(--sb-t-body-s)', fontWeight: 600, cursor: newLabel.trim() ? 'pointer' : 'not-allowed',
            }}>Generate</button>
            <button onClick={() => setCreatingToken(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-ink-3)', padding: '4px', display: 'flex', alignItems: 'center' }}>
              <X size={ICON.sm} />
            </button>
          </div>
        )}

        {/* Revealed token (shown once) */}
        {revealedToken && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10,
            padding: '10px 13px', borderRadius: 'var(--sb-r-nav)',
            background: 'color-mix(in srgb, var(--sb-positive) 8%, transparent)',
            border: 'var(--sb-border-width) solid var(--sb-positive)',
          }}>
            <code style={{ flex: 1, fontSize: 'var(--sb-t-meta)', fontFamily: 'monospace', color: 'var(--sb-ink-1)', wordBreak: 'break-all', lineHeight: 1.5 }}>{revealedToken}</code>
            <button onClick={copyToken} style={{
              flexShrink: 0, padding: '5px 11px', borderRadius: 'var(--sb-r-chip)',
              background: copied ? 'color-mix(in srgb, var(--sb-positive) 14%, transparent)' : 'var(--sb-card)',
              border: 'var(--sb-border-width) solid var(--sb-border)',
              fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: copied ? 'var(--sb-positive)' : 'var(--sb-ink-2)', cursor: 'pointer',
            }}>{copied ? 'Copied' : 'Copy'}</button>
            <button onClick={() => setRevealedToken(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sb-ink-3)', padding: '4px', display: 'flex', alignItems: 'center' }}>
              <X size={ICON.sm} />
            </button>
          </div>
        )}

        {/* Token list */}
        {tokens.length === 0 && !creatingToken && (
          <EmptyState compact>No tokens yet.</EmptyState>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {tokens.map((tok, i) => (
            <div key={tok.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '9px 13px', borderRadius: 'var(--sb-r-nav)',
              background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
              borderBottom: i === tokens.length - 1 ? undefined : undefined,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-1)' }}>{tok.label}</p>
                <p style={{ margin: '2px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
                  Created {new Date(tok.created_at).toLocaleDateString()}
                  {tok.last_used_at ? ` · Last used ${new Date(tok.last_used_at).toLocaleDateString()}` : ' · Never used'}
                </p>
              </div>
              <code style={{ fontSize: 'var(--sb-t-meta)', fontFamily: 'monospace', color: 'var(--sb-ink-3)', flexShrink: 0 }}>prof_sk_…</code>
              <button onClick={() => void handleRevoke(tok.id)} style={{
                flexShrink: 0, padding: '4px 10px', borderRadius: 'var(--sb-r-chip)',
                background: 'none', border: 'var(--sb-border-width) solid var(--sb-border)',
                fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: 'var(--sb-negative)', cursor: 'pointer',
              }}>Revoke</button>
            </div>
          ))}
        </div>
      </div>

      {/* ── TELEGRAM ─────────────────────────────────────────────────────────── */}
      <div style={{ marginTop: 24 }}>
        <div style={{ marginBottom: 12 }}>
          <p style={{ margin: 0, fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.14em', color: 'var(--sb-ink-3)', textTransform: 'uppercase' }}>Telegram</p>
          <p style={{ margin: '2px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.4 }}>
            Talk to Professor from Telegram — ask about tasks, habits and finances, or add things on the go.
          </p>
        </div>

        {/* Connected chats */}
        {telegramLinks.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 14 }}>
            {telegramLinks.map(link => (
              <div key={link.chat_id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '9px 13px', borderRadius: 'var(--sb-r-nav)',
                background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
              }}>
                <MessageSquare size={ICON.lg} strokeWidth={STROKE.rest} aria-hidden />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-1)' }}>
                    Chat #{link.chat_id}
                  </p>
                  <p style={{ margin: '2px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
                    Connected {new Date(link.linked_at).toLocaleDateString()}
                  </p>
                </div>
                <span style={{
                  fontSize: 'var(--sb-t-meta)', fontWeight: 700, letterSpacing: '0.08em',
                  padding: '2px 7px', borderRadius: 'var(--sb-r-chip)',
                  background: 'color-mix(in srgb, var(--sb-positive) 10%, transparent)',
                  // 4.06:1 as `--sb-positive` on its own tint, at 10px. The
                  // deep sibling exists for this and reads 5.5.
                  color: 'var(--sb-positive-deep)', textTransform: 'uppercase',
                }}>Active</span>
                <button onClick={() => void handleRevokeTelegram(link.chat_id)} style={{
                  flexShrink: 0, padding: '4px 10px', borderRadius: 'var(--sb-r-chip)',
                  background: 'none', border: 'var(--sb-border-width) solid var(--sb-border)',
                  fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: 'var(--sb-negative)', cursor: 'pointer',
                }}>Disconnect</button>
              </div>
            ))}
          </div>
        ) : null}

        {/* Setup instructions */}
        <div style={{
          padding: '13px 15px', borderRadius: 'var(--sb-r-nav)',
          background: 'var(--sb-accent-tint)', border: 'var(--sb-border-width) solid var(--sb-border)',
          borderStyle: 'dashed',
        }}>
          <p style={{ margin: '0 0 8px', fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-1)' }}>
            {telegramLinks.length === 0 ? 'Connect your Telegram' : 'Connect another device'}
          </p>
          <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 5 }}>
            {[
              'Generate a token above (label it "Telegram")',
              'Open Telegram and search for your Professor bot',
              <>Send: <code style={{ fontSize: 'var(--sb-t-meta)', fontFamily: 'monospace', background: 'var(--sb-card)', padding: '1px 5px', borderRadius: 4 }}>/connect prof_sk_…</code></>,
              'That\'s it — just talk to it naturally after that',
            ].map((step, i) => (
              <li key={i} style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-2)', lineHeight: 1.45 }}>{step}</li>
            ))}
          </ol>
          <p style={{ margin: '10px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.4 }}>
            The bot can read and add tasks, log habits, and check your balance. Full AI responses when an Anthropic key is set in Supabase.
          </p>
        </div>
      </div>

      {/* ── SIRI SHORTCUTS ───────────────────────────────────────────────────── */}
      <div style={{ marginTop: 24, paddingTop: 20, borderTop: 'var(--sb-border-width) solid var(--sb-hairline)' }}>
        <div style={{ marginBottom: 12 }}>
          <p style={{ margin: 0, fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.14em', color: 'var(--sb-ink-3)', textTransform: 'uppercase' }}>Siri Shortcuts</p>
          <p style={{ margin: '2px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.4 }}>
            Say "Hey Siri, {siriName}" and talk to your AI naturally — add tasks, log habits, check your calendar, and more. This is the hands-free way, and the only one that works with the app closed or the screen locked.
          </p>
        </div>

        {/* Token picker */}
        <div style={{ marginBottom: 14 }}>
          <p style={{ margin: '0 0 7px', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
            Pick a token to use (generate one above if you don't have one yet):
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {tokens.filter(t => !t.revoked).map(t => (
              <button
                key={t.id}
                onClick={() => setSiriToken(siriToken === t.token ? null : t.token)}
                style={{
                  padding: '5px 12px', borderRadius: 'var(--sb-r-chip)', fontSize: 'var(--sb-t-meta)', fontWeight: 600,
                  cursor: 'pointer', border: 'var(--sb-border-width) solid',
                  borderColor: siriToken === t.token ? 'var(--sb-ink-1)' : 'var(--sb-border)',
                  background:  siriToken === t.token ? 'var(--sb-ink-1)' : 'var(--sb-card)',
                  color:       siriToken === t.token ? 'var(--sb-bg)'    : 'var(--sb-ink-2)',
                }}
              >{t.label || 'Unnamed'}</button>
            ))}
            {tokens.filter(t => !t.revoked).length === 0 && (
              <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>No tokens yet — generate one in the Connections block above.</span>
            )}
          </div>
        </div>

        {siriToken && siriBaseUrl && (() => {
          const shortcutUrl = `${siriBaseUrl}?token=${siriToken}&text={ShortcutInput}`
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* URL row */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <code style={{
                  flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  fontFamily: 'var(--sb-font-mono)', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)',
                  background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)',
                  borderRadius: 'var(--sb-r-chip)', padding: '7px 9px',
                }}>{shortcutUrl}</code>
                <button
                  style={{
                    flexShrink: 0, padding: '6px 13px', borderRadius: 'var(--sb-r-chip)',
                    border: 'var(--sb-border-width) solid var(--sb-border)',
                    background: copiedSiri ? 'var(--sb-positive-tint)' : 'var(--sb-card)',
                    color: copiedSiri ? 'var(--sb-positive)' : 'var(--sb-ink-2)',
                    fontSize: 'var(--sb-t-meta)', fontWeight: 600, cursor: 'pointer',
                  }}
                  onClick={() => {
                    navigator.clipboard.writeText(shortcutUrl).then(() => {
                      setCopiedSiri(true)
                      setTimeout(() => setCopiedSiri(false), 2000)
                    })
                  }}
                >{copiedSiri ? 'Copied ✓' : 'Copy URL'}</button>
              </div>

              {/* Setup instructions */}
              <div style={{
                padding: '13px 15px', borderRadius: 'var(--sb-r-nav)',
                background: 'var(--sb-accent-tint)', border: 'var(--sb-border-width) solid var(--sb-border)', borderStyle: 'dashed',
              }}>
                <p style={{ margin: '0 0 8px', fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-1)' }}>
                  Set up the "{siriName}" shortcut
                </p>
                <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {[
                    <>On iPhone or iPad, open <b>Shortcuts</b> → <b>+</b> → name it <em>{siriName}</em> — Siri answers to the shortcut’s name</>,
                    <>Add action: <b>Ask for Input</b> — prompt "What do you want to ask {siriName}?"</>,
                    <>Add action: <b>Get Contents of URL</b> → paste the URL above (replace <code style={{ fontFamily: 'monospace', fontSize: 'var(--sb-t-meta)' }}>{'{ShortcutInput}'}</code> with the "Provided Input" variable)</>,
                    <>Add action: <b>Speak Text</b> — set input to the result from the previous step</>,
                    <>Then say <b>"Hey Siri, {siriName}"</b>. Its name is the phrase; no extra setting is needed</>,
                  ].map((step, i) => (
                    <li key={i} style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-2)', lineHeight: 1.5 }}>{step}</li>
                  ))}
                </ol>
                <p style={{ margin: '10px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.4 }}>
                  You can also make specific shortcuts — e.g. one that always says "What's on today?" with no input step.
                  The URL is the whole credential; delete the token above to revoke access.
                </p>
              </div>
            </div>
          )
        })()}
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
          padding: '10px 0', borderBottom: i === arr.length - 1 ? 'none' : 'var(--sb-border-width) solid var(--sb-hairline)',
        }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', fontWeight: 500, color: 'var(--sb-ink-1)' }}>{row.label}</p>
            <p style={{ margin: '1px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>{row.sub}</p>
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
              <p style={{ margin: 0, fontSize: 'var(--sb-t-label)', fontWeight: 600, color: rule.enabled ? 'var(--sb-ink-1)' : 'var(--sb-ink-3)', lineHeight: 1.3 }}>
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
      <p style={{ margin: '14px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.5 }}>
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
              <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', fontVariantNumeric: 'tabular-nums', flexShrink: 0, width: 92 }}>
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
                  <p style={{ margin: '1px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>{item.sub}</p>
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
            // Evergreen's negative (#B4574A) on its own 8% tint reads 4.1:1
            // at 12.5px, which WCAG counts as normal text. The deep sibling
            // is what that pairing is for.
            fontSize: 'var(--sb-t-body-s)', fontWeight: 500, color: 'var(--sb-negative-deep)', cursor: 'pointer',
          }}>
            <Trash2 size={ICON.sm} /> Delete account
          </button>
        </div>
      </div>
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
  tasks: 'work',    habits: 'work',  library: 'work',
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
              margin: '1px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.35,
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

        // Companies — through `mergeCompanies`, which is the one answer.
        //
        // This used to be a **second** merge, written by hand here, and it
        // carried only `users` and `hidden` forward from the browser: a
        // database missing a column answers it empty, so opening Settings
        // wrote that blank over `account_id`, `email_domain`, `calendar_id`
        // and now `logo_url`. That is the exact failure `mergeCompanies`
        // exists to stop — link an account, refresh, gone — surviving in a
        // copy one file along, and App's own loader was protecting the key
        // that this screen then overwrote. Two answers to one question.
        //
        // The users *backup* stays on top of it: that is a different
        // question (a separate localStorage key, for a list the DB may never
        // have held) rather than a second field merge.
        const dbCompanies = await loadCompaniesFromDB()
        if (dbCompanies.length > 0) {
          const localBackup: Record<string, CompanyUser[]> = ls('professor-company-users', {})
          const merged = mergeCompanies(
            dbCompanies as unknown as DbSyncCompanyRow[],
            companies as unknown as DbSyncCompanyRow[],
          ).map(c => ({
            ...(c as unknown as CompanyRow),
            users: c.users?.length ? c.users : (localBackup[c.id] ?? []),
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
          <SectionCard id="library" active={activeSection === 'library'}>
            <LibrarySection />
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
            fontSize: 'var(--sb-t-meta)', fontWeight: 700,
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
              <span style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', flex: 1, userSelect: 'none' }}>Find a setting</span>
              <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', opacity: 0.7 }}>⌘K</span>
            </div>
          </div>

          {/* Grouped nav */}
          <div style={{ padding: '0 12px', flex: 1, minHeight: 0 }}>
            {NAV_GROUPS.map(group => (
              <div key={group.label} style={{ marginBottom: 0 }}>
                <div style={{ fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.14em', color: 'var(--sb-ink-3)', padding: '7px 12px 3px', textTransform: 'uppercase' as const }}>
                  {group.label}
                </div>
                {group.ids.map(id => navItem(id))}
              </div>
            ))}
          </div>

          {/* Footer */}
          <div style={{ padding: '10px 18px 11px', borderTop: 'var(--sb-border-width) solid var(--sb-hairline)', flexShrink: 0 }}>
            <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ width: 6, height: 6, borderRadius: 'var(--sb-r-pill)', background: 'var(--sb-positive)', flexShrink: 0 }} />
              Every change saves itself
            </div>
            {/* Which build this page is. "It is not deployed" and "your browser
                is holding the last one" look identical from the outside, and
                without this the only way to tell them apart is to guess. */}
            <div
              title={`Built ${new Date(__BUILD_AT__).toLocaleString('en-GB')}`}
              style={{
                marginTop: 5, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)',
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
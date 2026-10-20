import { useState, useEffect, useRef } from 'react'
import { NAV_H } from '@/App'
import { RefreshCw, CalendarDays, Wand2, Sparkles, ArrowUpRight, Database } from 'lucide-react'
import { signOut as googleSignOut } from '@/lib/google'
import { useAuthStore } from '@/store/authStore'
import { useHabitsStore } from '@/store/habitsStore'
import { loadAccounts, type ConnectedAccount } from '@/lib/multiAccount'
import { saveProfileToDB, savePrefsToDB, loadCompaniesFromDB, mergeCompanies, saveHabitsToDB, saveHabitLogsToDB, loadSettingsFromDB, loadAccountsFromDB, type CompanyRow as DbSyncCompanyRow } from '@/lib/dbSync'
import { loadLogs, loadQuantityLogs } from '@/store/habitsStore'
import { ICON, STROKE } from '@/lib/type'
import { type AppSettings, type CompanyRow, type CompanyUser, DEFAULTS, checkSupabase, loadCompanies, loadSettings, ls, saveCompanies, saveSettings } from './model'
import { GhostPill } from './ui'
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
import { IntegrationsSection } from './sections/Integrations'
import { BlockingRulesSection } from './sections/BlockingRules'
import { SyncRulesSection } from './sections/SyncRules'
import { AutomationSection } from './sections/Automation'
import { NotificationsMatrixSection } from './sections/Notifications'
import { DataPrivacySection } from './sections/DataPrivacy'
import { FinanceSection } from './sections/Finance'



export { type AIConfig, misplacedAnthropicKey, cleanKey, maskKey, loadAIConfig } from './model'

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
import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { signOut as googleSignOut } from '@/lib/google'
import { useAuthStore } from '@/store/authStore'
import { loadAccounts, type ConnectedAccount } from '@/lib/multiAccount'
import { saveProfileToDB, savePrefsToDB, loadCompaniesFromDB, mergeCompanies, loadSettingsFromDB, loadAccountsFromDB, type CompanyRow as DbSyncCompanyRow } from '@/lib/dbSync'
import { type AppSettings, type CompanyRow, type CompanyUser, DEFAULTS, loadCompanies, loadSettings, ls, saveCompanies, saveSettings } from './model'
import { Block, GhostPill } from './ui'
import { NAV_GROUPS, SECTION_META, SEARCH_KEYWORDS, DEFAULT_CLOSED_GROUPS, groupOf, isSectionId, pageFor, type SectionId } from './nav'
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

// ─── One shell, one page per rail item ────────────────────────────────────────
// A floating card of folding groups on the left, one rounded panel on the
// right. The panel's title and save status stay put; only what is under them
// scrolls, inside the panel's own border — the page itself never scrolls.

type SaveState = 'saved' | 'saving' | 'local'

const SAVE_LABEL: Record<SaveState, string> = {
  saved:  'All changes saved',
  saving: 'Saving…',
  local:  'Saved on this device only',
}

const GROUPS_KEY = 'settings-groups-closed'

function loadClosedGroups(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(GROUPS_KEY) ?? 'null')
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string')
  } catch { /* private mode / bad json */ }
  return DEFAULT_CLOSED_GROUPS
}

export function Settings() {
  const [settings, setSettings]         = useState<AppSettings>(loadSettings)
  const [companies, setCompanies]       = useState<CompanyRow[]>(loadCompanies)
  const [accounts, setAccounts]         = useState<ConnectedAccount[]>(loadAccounts)
  const [activeSection, setActiveSection] = useState<SectionId>(() => {
    try {
      const v = localStorage.getItem('settings-active-section')
      return isSectionId(v) ? v : 'profile'
    } catch { return 'profile' }
  })
  const [closed, setClosed]             = useState<string[]>(loadClosedGroups)
  const [query, setQuery]               = useState('')
  const [refreshing, setRefreshing]     = useState(false)
  const [saveState, setSaveState]       = useState<SaveState>('saved')
  const authUser = useAuthStore(s => s.user)
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  // ── Autosave ───────────────────────────────────────────────────────────────
  // The key is the whole settings object. `syncedKey` is what the server last
  // agreed with — set on hydration and after every landed save — so a change
  // is "anything that differs from that", not "whatever happens after a flag".
  // (The flag this replaces swallowed the next edit whenever the server's copy
  // happened to equal the local one, because nothing re-ran to clear it.)
  const settingsKey = JSON.stringify(settings)
  const syncedKey = useRef<string | null>(null)

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

  // ── On mount: load all data from DB (authoritative source) ───────────────────
  useEffect(() => {
    void (async () => {
      try {
        // Settings
        const dbSettings = await loadSettingsFromDB(DEFAULTS)
        // What the server holds is, by definition, in sync: not an edit.
        syncedKey.current = JSON.stringify(dbSettings)
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

  // Every edit saves itself: profile first, then prefs, one after the other —
  // both read-modify-write `schedule_rules`, so run side by side one would
  // overwrite the other. Debounced so typing a name is one write, not twelve.
  useEffect(() => {
    if (syncedKey.current === null) { syncedKey.current = settingsKey; return }
    if (settingsKey === syncedKey.current) return
    setSaveState('saving')
    let cancelled = false
    const t = setTimeout(() => {
      void (async () => {
        try {
          await saveProfileToDB(settingsRef.current)
          await savePrefsToDB(settingsRef.current)
          syncedKey.current = settingsKey
          if (!cancelled) setSaveState('saved')
        } catch (err) {
          console.error('[Settings autosave]', err)
          if (!cancelled) setSaveState('local')
        }
      })()
    }, 1200)
    return () => { cancelled = true; clearTimeout(t) }
  }, [settingsKey])

  // ── Pull the authoritative record back down from the DB ─────────────────────
  async function handleRefresh() {
    setRefreshing(true)
    try {
      const dbSettings = await loadSettingsFromDB(DEFAULTS)
      syncedKey.current = JSON.stringify(dbSettings)
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
      setSaveState('saved')
    } catch (err) {
      console.error('[Settings refresh]', err)
    } finally {
      setRefreshing(false)
    }
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

  // ── Navigation ──────────────────────────────────────────────────────────────
  const page = pageFor(activeSection)
  const meta = SECTION_META.find(m => m.id === page)!

  useEffect(() => {
    try { localStorage.setItem(GROUPS_KEY, JSON.stringify(closed)) } catch { /* noop */ }
  }, [closed])

  // A link into a folded group (the palette, the budget screen) must not land
  // on a page whose own menu entry is hidden.
  useEffect(() => {
    const g = groupOf(activeSection)
    if (g) setClosed(c => (c.includes(g) ? c.filter(x => x !== g) : c))
  }, [activeSection])

  function select(id: SectionId) {
    setActiveSection(id)
    try { localStorage.setItem('settings-active-section', id) } catch { /* noop */ }
  }
  function toggleGroup(label: string) {
    setClosed(c => (c.includes(label) ? c.filter(x => x !== label) : [...c, label]))
  }

  const q = query.trim().toLowerCase()
  const groups = useMemo(() => NAV_GROUPS
    .map(g => ({
      ...g,
      ids: g.ids.filter(id => {
        if (!q) return true
        const m = SECTION_META.find(x => x.id === id)!
        return `${m.title} ${m.description} ${SEARCH_KEYWORDS[id] ?? ''}`.toLowerCase().includes(q)
      }),
    }))
    .filter(g => g.ids.length > 0), [q])

  // ── Fill the window exactly, so only the panel scrolls ──────────────────────
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [fitH, setFitH] = useState(640)
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const fit = () => {
      if (el.offsetParent === null) return          // the module is hidden
      setFitH(Math.max(560, Math.round(window.innerHeight - el.getBoundingClientRect().top)))
    }
    fit()
    window.addEventListener('resize', fit)
    const ro = new ResizeObserver(fit)               // fires when the module is shown again
    ro.observe(el)
    return () => { window.removeEventListener('resize', fit); ro.disconnect() }
  }, [])
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }) }, [page])

  function body() {
    switch (page) {
      case 'profile': return (
        <Block>
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
        </Block>
      )
      case 'billing': return <Block bare><BillingSection /></Block>
      case 'companies': return <Block bare><DataPrivacySection onExport={exportAllSettings} /></Block>
      case 'accounts': return (
        <Block bare>
          <AccountsAndCompaniesSection
            companies={companies}
            setCompanies={c => { setCompanies(c); saveCompanies(c) }}
            accounts={accounts}
            setAccounts={setAccounts}
            primaryEmail={primaryEmail}
          />
        </Block>
      )
      case 'blocking': return (
        <>
          <Block title="Connected tools" bare><IntegrationsSection /></Block>
          <Block title="Calendar blocking" sub="Which calendars block your focus time" bare><BlockingRulesSection /></Block>
          <Block title="Sync rules" sub="How often, where things land, who wins" bare><SyncRulesSection /></Block>
        </>
      )
      case 'schedule': return <Block><ScheduleSection s={settings} set={update} /></Block>
      case 'tasks': return <Block bare><TaskStatusesSection /></Block>
      case 'habits': return <Block bare><HabitsSection /></Block>
      case 'library': return <Block><LibrarySection /></Block>
      case 'finance': return <Block bare><FinanceSection /></Block>
      case 'professor': return (
        <>
          <Block title="Model and autonomy" sub="Who answers, and what the assistant may write for you"><ProfessorSection /></Block>
          <Block title="Voice and instructions" sub="Tone, the morning brief, and what the assistant always knows"><AIVoiceSection s={settings} set={update} /></Block>
          <Block title="Behavioral OS" sub="Rank scoring and an operating mode, on top of the assistant" bare><BehavioralSection /></Block>
        </>
      )
      case 'automation': return <Block bare><AutomationSection /></Block>
      case 'notifications': return <Block bare><NotificationsMatrixSection /></Block>
      case 'appearance': return <Block bare><AppearanceSection s={settings} set={update} /></Block>
      default: return null
    }
  }

  function navItem(id: SectionId) {
    const m = SECTION_META.find(x => x.id === id)!
    const Icon = m.icon
    const isActive = id === page
    let badge: number | null = null
    if (id === 'habits') {
      try {
        const hs = JSON.parse(localStorage.getItem('professor-habits') ?? '[]')
        const n  = hs.filter((h: { isActive?: boolean }) => h.isActive !== false).length
        badge = n > 0 ? n : null
      } catch { badge = null }
    }
    return (
      <button
        key={id}
        type="button"
        aria-current={isActive ? 'page' : undefined}
        onClick={() => select(id)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 14,
          padding: '7px 12px', borderRadius: 'var(--sb-r-sm)', cursor: 'pointer',
          background: isActive ? 'var(--sb-card)' : 'transparent',
          boxShadow: isActive ? '0 1px 3px rgba(25,23,18,.16)' : 'none',
          border: 'none', textAlign: 'left',
          color: isActive ? 'var(--sb-ink-1)' : 'var(--sb-ink-3)',
          fontSize: 'var(--sb-t-body)', fontWeight: isActive ? 600 : 500, fontFamily: 'inherit',
          transition: 'background 0.12s, color 0.12s',
        }}
      >
        <Icon size={16} strokeWidth={1.9} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</span>
        {badge !== null && (
          <span style={{
            height: 17, minWidth: 17, boxSizing: 'border-box', padding: '0 5px', borderRadius: 'var(--sb-r-pill)',
            background: 'var(--sb-field)', color: 'var(--sb-ink-3)',
            fontSize: 'var(--sb-t-meta)', fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>{badge}</span>
        )}
      </button>
    )
  }

  return (
    <div ref={rootRef} style={{
      height: fitH, background: 'var(--sb-page)', boxSizing: 'border-box',
      display: 'flex', alignItems: 'stretch', gap: 22, padding: '8px 32px 24px 8px', overflow: 'hidden',
    }}>
      <style>{`
        .sx-row:last-child { border-bottom: 0 !important; }
        .sx-scroll { scrollbar-width: thin; scrollbar-color: var(--sb-border) transparent; }
        .sx-scroll::-webkit-scrollbar { width: 8px; }
        .sx-scroll::-webkit-scrollbar-thumb { background: var(--sb-border); border-radius: 8px; }
        .sx-gl:hover { color: var(--sb-ink-1); }
      `}</style>

      {/* ── NAV CARD — floats beside the panel ───────────────────────────── */}
      <nav aria-label="Settings sections" className="sx-scroll" style={{
        width: 276, flexShrink: 0, alignSelf: 'flex-start', maxHeight: '100%', overflowY: 'auto',
        boxSizing: 'border-box', padding: '12px 12px 14px',
        background: 'var(--sb-header)', border: 'var(--sb-border-width) solid var(--sb-border)',
        borderRadius: 'var(--sb-r-card)', boxShadow: 'var(--sb-shadow-control)',
      }}>
        <label style={{
          display: 'flex', alignItems: 'center', gap: 8, height: 38, padding: '0 12px',
          background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-nav)',
        }}>
          <Search size={14} strokeWidth={2} color="var(--sb-ink-3)" style={{ flexShrink: 0 }} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') setQuery('')
              if (e.key === 'Enter' && groups[0]?.ids[0]) { select(groups[0].ids[0]); setQuery('') }
            }}
            placeholder="Find a setting"
            aria-label="Find a setting"
            style={{
              flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent',
              fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)', fontFamily: 'inherit',
            }}
          />
        </label>

        {groups.length === 0 && (
          <p style={{ margin: '16px 12px', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>Nothing matches “{query.trim()}”.</p>
        )}

        {groups.map(g => {
          const open = q ? true : !closed.includes(g.label)
          return (
            <div key={g.label}>
              <button
                type="button" className="sx-gl"
                aria-expanded={open}
                onClick={() => toggleGroup(g.label)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 12px 6px', marginTop: 4, background: 'transparent', border: 'none', cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.12em',
                  textTransform: 'uppercase', color: 'var(--sb-ink-3)',
                }}
              >
                {g.label}
                <ChevronDown size={14} strokeWidth={2} style={{ transition: 'transform 0.15s', transform: open ? 'none' : 'rotate(-90deg)' }} />
              </button>
              {open && (
                <div style={{ margin: '0 0 4px 16px', paddingLeft: 6, borderLeft: 'var(--sb-border-width) solid var(--sb-hairline)' }}>
                  {g.ids.map(id => navItem(id))}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      {/* ── CONFIGURATION PANEL — one rounded box; its header stays, the rest scrolls ── */}
      <section aria-label={meta.title} style={{
        flex: 1, minWidth: 0, maxWidth: 920, display: 'flex', flexDirection: 'column', overflow: 'hidden',
        background: 'var(--sb-header)', border: 'var(--sb-border-width) solid var(--sb-border)',
        borderRadius: 'var(--sb-r-card)', boxShadow: 'var(--sb-shadow-control)',
      }}>
        <header style={{
          flexShrink: 0, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
          padding: '26px 36px 18px', borderBottom: 'var(--sb-border-width) solid var(--sb-hairline)',
        }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h1)', fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1.1, color: 'var(--sb-ink-1)' }}>{meta.title}</h2>
            <p style={{ margin: '6px 0 0', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', lineHeight: 1.45 }}>{meta.description}</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 6 }}>
            {page === 'billing' && <GhostPill>Manage</GhostPill>}
            <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
              <span style={{
                width: 7, height: 7, borderRadius: 'var(--sb-r-pill)', flexShrink: 0,
                background: saveState === 'saved' ? 'var(--sb-positive)' : saveState === 'saving' ? 'var(--sb-ink-3)' : 'var(--sb-warning)',
              }} />
              {SAVE_LABEL[saveState]}
            </div>
          </div>
        </header>
        <div ref={scrollRef} className="sx-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '24px 28px 8px 36px' }}>
          {body()}
        </div>
      </section>
    </div>
  )
}

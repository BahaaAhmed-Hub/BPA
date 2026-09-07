import { useEffect, useRef, useState } from 'react'
import { AssistantPanel, AssistantToggle } from './modules/assistant/AssistantPanel'
import { ExecutiveDashboard } from './modules/dashboard/ExecutiveDashboard'
import { TaskCommand } from './modules/tasks/TaskCommand'
import { CalendarModule } from './modules/calendar/CalendarModule'
import { InboxModule } from './modules/inbox/InboxModule'
import { HabitsModule } from './modules/habits/HabitsModule'
import { ReviewModule } from './modules/review/ReviewModule'
import { MorningModule } from './modules/morning/MorningModule'
import { CommandPalette } from './modules/search/CommandPalette'
import { SettingsModule } from './modules/settings/SettingsModule'
import { BehavioralOS } from './modules/behavioral/BehavioralOS'
import { PlanningAssistant } from './modules/planning/PlanningAssistant'
import { FinanceModule } from './modules/finance/FinanceModule'
import { useUIStore } from './store/uiStore'
import { useAuthStore } from './store/authStore'
import { useTaskStore } from './store/taskStore'
import { useHabitsStore } from './store/habitsStore'
import { supabase } from './lib/supabase'
import { signInWithGoogle, getPendingAddAccount, clearPendingAddAccount } from './lib/google'
import { addAccount, loadAccounts, saveAccounts } from './lib/multiAccount'
import { saveAccountsToDB, loadCompaniesFromDB, loadRawSettingsFromDB, loadAccountsFromDB } from './lib/dbSync'
import { startPrefSync } from './lib/prefSync'
import { startLiveSync } from './lib/liveSync'
import { useFinanceStore } from './modules/finance/financeStore'
import { runReminders } from './modules/finance/reminders'
import { runBudgetEntries } from './modules/finance/budgetEntries'
import { loadRules } from './modules/finance/modals/BudgetRuleModal'
import { SyncGapBanner } from './modules/shell/SyncGapBanner'
import { seedToken, seedFromLocalStorage, clearAllTokens, getGoogleToken } from './lib/tokenManager'
import { refreshPrimaryToken } from './lib/googleCalendar'
import { SetupWizard } from './modules/wizard/SetupWizard'
import { Search } from 'lucide-react'

// ─── Sunlit Bento — Login screen (1A) ────────────────────────────────────────


// ─── Login screen — 1A (Sunlit Bento) ────────────────────────────────────────

const LIVE_STATS = [
  { value: '23',   label: 'tasks completed this week' },
  { value: '5 / 7', label: 'habits logged today'       },
  { value: '4.5 h', label: 'focus hours blocked'       },
]

function LoginScreen() {
  const [signing, setSigning] = useState(false)

  async function handleSignIn() {
    setSigning(true)
    try { await signInWithGoogle() } catch { setSigning(false) }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(160deg, #F7F4EA 0%, #EEE8D0 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '32px 24px',
      fontFamily: "'Instrument Sans', system-ui, sans-serif",
    }}>
      {/* Main card */}
      <div style={{
        width: '100%',
        maxWidth: 960,
        display: 'grid',
        gridTemplateColumns: '1fr 400px',
        gap: 0,
        background: '#FFFFFF',
        borderRadius: 24,
        boxShadow: '0 26px 64px -34px rgba(48,40,20,.5)',
        overflow: 'hidden',
        border: '1px solid #E8E1CE',
      }}>
        {/* Left — promise */}
        <div style={{
          background: 'linear-gradient(160deg, #F7F4EA 0%, #EEE8D0 100%)',
          padding: '60px 56px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}>
          {/* Mark */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 56 }}>
            <div style={{
              width: 38, height: 38, borderRadius: 10,
              background: '#191712',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              {/* Graduation cap inline SVG */}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                stroke="#FDF8E7" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
                <path d="M6 12v5c3.333 2 8.667 2 12 0v-5"/>
              </svg>
            </div>
            <span style={{
              fontFamily: "'Outfit', system-ui, sans-serif",
              fontWeight: 700, fontSize: 17, color: '#191712', letterSpacing: '-.02em',
            }}>
              The Professor
            </span>
          </div>

          {/* Headline */}
          <div style={{ flex: 1 }}>
            <h1 style={{
              margin: '0 0 16px',
              fontFamily: "'Outfit', system-ui, sans-serif",
              fontWeight: 700, fontSize: 42, lineHeight: 1.06,
              color: '#191712', letterSpacing: '-.03em',
            }}>
              Your personal<br />operating system.
            </h1>
            <p style={{
              margin: '0 0 48px',
              fontSize: 15, color: '#6C6553', lineHeight: 1.7, maxWidth: 380,
            }}>
              Reads your calendar, tasks, habits and finances — then tells you
              exactly what to do next, in plain sentences, with the numbers behind them.
            </p>

            {/* Live numbers */}
            <div style={{ display: 'flex', gap: 32 }}>
              {LIVE_STATS.map(s => (
                <div key={s.label}>
                  <div style={{
                    fontFamily: "'Outfit', system-ui, sans-serif",
                    fontWeight: 700, fontSize: 26, color: '#191712', letterSpacing: '-.02em',
                    fontVariantNumeric: 'tabular-nums',
                  }}>{s.value}</div>
                  <div style={{ fontSize: 11.5, color: '#8A8272', marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right — form */}
        <div style={{
          padding: '60px 48px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          background: '#FFFFFF',
        }}>
          <h2 style={{
            margin: '0 0 6px',
            fontFamily: "'Outfit', system-ui, sans-serif",
            fontWeight: 600, fontSize: 22, color: '#191712', letterSpacing: '-.02em',
          }}>
            Sign in
          </h2>
          <p style={{ margin: '0 0 32px', fontSize: 13, color: '#6C6553' }}>
            Continue to your operating system.
          </p>

          {/* Google button */}
          <button
            onClick={() => void handleSignIn()}
            disabled={signing}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              width: '100%', padding: '13px 20px',
              borderRadius: 10,
              background: signing ? '#FAF7EC' : '#191712',
              border: '1px solid #191712',
              color: '#FDF8E7',
              fontSize: 14, fontWeight: 600,
              cursor: signing ? 'wait' : 'pointer',
              fontFamily: "'Instrument Sans', system-ui, sans-serif",
              transition: 'background 140ms ease-out, box-shadow 140ms ease-out',
              boxShadow: '0 2px 0 rgba(120,92,0,.10)',
            }}
          >
            {/* Google G mark */}
            <svg width="18" height="18" viewBox="0 0 18 18">
              <path fill={signing ? '#8A8272' : '#FEF7DE'} fillOpacity=".9"
                d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908C16.658 14.076 17.64 11.768 17.64 9.2z"/>
              <path fill={signing ? '#8A8272' : '#FEF7DE'} fillOpacity=".75"
                d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
              <path fill={signing ? '#8A8272' : '#FEF7DE'} fillOpacity=".6"
                d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"/>
              <path fill={signing ? '#8A8272' : '#FEF7DE'} fillOpacity=".9"
                d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 6.294C4.672 4.169 6.656 3.58 9 3.58z"/>
            </svg>
            {signing ? 'Redirecting…' : 'Continue with Google'}
          </button>

          {/* Divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '24px 0' }}>
            <div style={{ flex: 1, height: 1, background: '#E8E1CE' }} />
            <span style={{ fontSize: 11.5, color: '#8A8272' }}>or</span>
            <div style={{ flex: 1, height: 1, background: '#E8E1CE' }} />
          </div>

          {/* Email (passive — redirects to Google OAuth anyway) */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#4A4438', marginBottom: 5 }}>
              Email
            </label>
            <input
              type="email"
              placeholder="you@example.com"
              disabled
              style={{
                width: '100%', padding: '11px 14px', borderRadius: 9,
                background: '#FAF7EC', border: '1px solid #E8E1CE',
                color: '#8A8272', fontSize: 13,
                outline: 'none', cursor: 'not-allowed',
                fontFamily: 'inherit', boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#4A4438', marginBottom: 5 }}>
              Password
            </label>
            <input
              type="password"
              placeholder="••••••••"
              disabled
              style={{
                width: '100%', padding: '11px 14px', borderRadius: 9,
                background: '#FAF7EC', border: '1px solid #E8E1CE',
                color: '#8A8272', fontSize: 13,
                outline: 'none', cursor: 'not-allowed',
                fontFamily: 'inherit', boxSizing: 'border-box',
              }}
            />
          </div>

          <button
            disabled
            style={{
              width: '100%', padding: '12px',
              borderRadius: 10,
              background: '#FAF7EC', border: '1px solid #E8E1CE',
              color: '#8A8272', fontSize: 14, fontWeight: 600,
              cursor: 'not-allowed', fontFamily: 'inherit',
            }}
          >
            Log in
          </button>

          <p style={{ margin: '24px 0 0', fontSize: 11.5, color: '#8A8272', textAlign: 'center', lineHeight: 1.65 }}>
            By continuing, you agree to our{' '}
            <span style={{ color: '#4A4438', textDecoration: 'underline', cursor: 'pointer' }}>Terms</span>
            {' '}and{' '}
            <span style={{ color: '#4A4438', textDecoration: 'underline', cursor: 'pointer' }}>Privacy Policy</span>.
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── Loading screen ────────────────────────────────────────────────────────────

function LoadingScreen() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh',
      background: 'linear-gradient(160deg, #F7F4EA 0%, #EEE8D0 100%)',
      gap: 16,
      fontFamily: "'Instrument Sans', system-ui, sans-serif",
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: 11,
        background: '#191712',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'sbPulse 1.6s ease-in-out infinite',
      }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
          stroke="#FDF8E7" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
          <path d="M6 12v5c3.333 2 8.667 2 12 0v-5"/>
        </svg>
      </div>
      <span style={{ fontSize: 13, color: '#6C6553', fontWeight: 500 }}>Loading your system…</span>
      <style>{`
        @keyframes sbPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.65; transform: scale(0.94); }
        }
      `}</style>
    </div>
  )
}

// ─── Top navigation bar — 6B shell ────────────────────────────────────────────

// Nav SVG icons matching the 6B design spec
const NAV_ICONS: Record<string, React.ReactNode> = {
  morning: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"/>
    </svg>
  ),
  calendar: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/>
    </svg>
  ),
  tasks: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 12.5l2.6 2.5L16 9.5"/>
    </svg>
  ),
  habits: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/>
    </svg>
  ),
  finance: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18"/>
    </svg>
  ),
  settings: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>
    </svg>
  ),
}

const NAV_ITEMS = [
  { id: 'morning',   label: 'Today'    },
  { id: 'calendar',  label: 'Calendar' },
  { id: 'tasks',     label: 'Tasks'    },
  { id: 'habits',    label: 'Habits'   },
  { id: 'finance',   label: 'Finance'  },
  { id: 'settings',  label: 'Settings' },
] as const

function TopNav() {
  const activeModule    = useUIStore(s => s.activeModule)
  const setActiveModule = useUIStore(s => s.setActiveModule)
  const user            = useAuthStore(s => s.user)

  const initials = user?.name
    ? user.name.split(' ').map((p: string) => p[0]).join('').slice(0, 2).toUpperCase()
    : user?.email?.slice(0, 2).toUpperCase() ?? '?'

  return (
    <header style={{
      height: 66, flexShrink: 0,
      background: '#FCFAF4',
      borderBottom: '1px solid #E8E1CE',
      display: 'flex', alignItems: 'center',
      padding: '0 22px', gap: 16,
    }}>
      {/* Product mark — left 1/3 */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
        <div style={{
          width: 30, height: 30, borderRadius: 8, background: '#191712', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="#FDF8E7" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
            <path d="M6 12v5c3.333 2 8.667 2 12 0v-5"/>
          </svg>
        </div>
        <span style={{
          fontFamily: "'Outfit', system-ui, sans-serif",
          fontWeight: 700, fontSize: 14.5, color: '#191712', letterSpacing: '-.02em',
          whiteSpace: 'nowrap',
        }}>
          The Professor
        </span>
      </div>

      {/* Nav pills — center */}
      <nav style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
        {NAV_ITEMS.map(item => {
          const active = activeModule === item.id ||
            (item.id === 'morning' && activeModule === 'dashboard')
          return (
            <button
              key={item.id}
              onClick={() => setActiveModule(item.id)}
              style={{
                height: 38, padding: '0 15px', borderRadius: 999,
                border: 'none', cursor: 'pointer',
                background: active ? '#FFFFFF' : 'transparent',
                boxShadow: active ? '0 1px 3px rgba(25,23,18,.16)' : 'none',
                color:      active ? '#191712' : '#6C6553',
                fontSize: 13.5, fontWeight: active ? 600 : 500,
                fontFamily: "'Instrument Sans', system-ui, sans-serif",
                transition: 'background 120ms ease-out, color 120ms ease-out, box-shadow 120ms ease-out',
                whiteSpace: 'nowrap',
                display: 'flex', alignItems: 'center', gap: 7,
              }}
              onMouseEnter={e => {
                if (!active) {
                  const el = e.currentTarget as HTMLButtonElement
                  el.style.background = '#FFFFFF'
                  el.style.boxShadow = '0 1px 3px rgba(25,23,18,.08)'
                }
              }}
              onMouseLeave={e => {
                if (!active) {
                  const el = e.currentTarget as HTMLButtonElement
                  el.style.background = 'transparent'
                  el.style.boxShadow = 'none'
                }
              }}
            >
              {NAV_ICONS[item.id]}
              {item.label}
            </button>
          )
        })}
      </nav>

      {/* Right — search + icon buttons + avatar */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 9, minWidth: 0 }}>
        {/* Search — opens the platform-wide palette */}
        <div
          onClick={() => window.dispatchEvent(new Event('professor:openSearch'))}
          title="Search everything (⌘K)"
          style={{
            display: 'flex', alignItems: 'center', gap: 7,
            padding: '6px 12px',
            background: '#FFFFFF', border: '1px solid #E8E1CE',
            borderRadius: 12, cursor: 'pointer',
          }}>
          <Search size={13} color="#6C6553" />
          <span style={{ fontSize: 12.5, color: '#8A8272', userSelect: 'none' }}>Search</span>
          <span style={{
            marginLeft: 4,
            fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
            color: '#8A8272', opacity: 0.7,
          }}>⌘K</span>
        </div>

        {/* Bell */}
        <div style={{
          width: 34, height: 34, borderRadius: 12,
          background: '#FFFFFF', border: '1px solid #E8E1CE',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', flexShrink: 0, color: '#6C6553',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 16V11a6 6 0 1 0-12 0v5l-1.5 2.5h15z"/>
            <path d="M10 20a2 2 0 0 0 4 0"/>
          </svg>
        </div>

        {/* Avatar */}
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          background: '#191712',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer',
          overflow: 'hidden', flexShrink: 0,
        }}>
          {user?.avatarUrl ? (
            <img src={user.avatarUrl} alt={initials} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <span style={{ fontSize: 12, fontWeight: 600, color: '#FDF8E7', letterSpacing: '0.02em' }}>
              {initials}
            </span>
          )}
        </div>
      </div>
    </header>
  )
}

// ─── Active module router ──────────────────────────────────────────────────────

function ActiveModule() {
  const activeModule = useUIStore(s => s.activeModule)
  switch (activeModule) {
    case 'dashboard':    return <ExecutiveDashboard />
    case 'tasks':        return <TaskCommand />
    case 'calendar':     return <CalendarModule />
    case 'inbox':        return <InboxModule />
    case 'habits':       return <HabitsModule />
    case 'review':       return <ReviewModule />
    case 'morning':      return <MorningModule />
    case 'settings':     return <SettingsModule />
    case 'behavioral':   return <BehavioralOS />
    case 'planning':     return <PlanningAssistant />
    case 'finance':      return <FinanceModule />
    default:             return <ExecutiveDashboard />
  }
}

// ─── App ──────────────────────────────────────────────────────────────────────

const LAST_USER_KEY = 'professor-last-user-id'

/**
 * Load all user data from DB into localStorage so every module reads fresh data.
 * Called on every sign-in — database is the source of truth.
 */
async function loadAllFromDB(
  loadTasksFn: () => Promise<void>,
  loadHabitsFn: () => Promise<void>,
): Promise<void> {
  await Promise.allSettled([
    loadTasksFn(),
    loadHabitsFn(),
    // Finance writes through to Supabase on every change but nothing ever read
    // it back, so a transaction added on the laptop simply did not exist on the
    // iPad — each device saw only what it had entered itself.
    useFinanceStore.getState().loadFromDB(),
    // Companies
    loadCompaniesFromDB().then(companies => {
      if (companies.length > 0)
        localStorage.setItem('professor-companies', JSON.stringify(companies))
    }),
    // Settings (partial — Settings component merges with its own DEFAULTS)
    loadRawSettingsFromDB().then(partial => {
      if (Object.keys(partial).length > 0) {
        const stored = (() => {
          try { return JSON.parse(localStorage.getItem('professor-settings') ?? '{}') as object }
          catch { return {} }
        })()
        localStorage.setItem('professor-settings', JSON.stringify({ ...stored, ...partial }))
      }
    }),
    // Connected accounts — DB provides metadata, local provides tokens.
    // Union: keep local-only accounts (e.g. just added, not yet saved to DB).
    loadAccountsFromDB().then(dbAccounts => {
      const local = loadAccounts()
      if (dbAccounts.length === 0 && local.length === 0) return
      const tokenMap = new Map(local.map(a => [a.email, a as typeof local[number]]))
      // DB accounts enriched with local tokens
      const fromDb = dbAccounts.map(a => {
        const localAcc = tokenMap.get(a.email)
        return {
          ...a,
          providerToken:        localAcc?.providerToken ?? '',
          providerTokenSavedAt: localAcc?.providerTokenSavedAt,
          supabaseAccessToken:  localAcc?.supabaseAccessToken,
          supabaseRefreshToken: localAcc?.supabaseRefreshToken,
        }
      })
      // Keep local accounts not yet in DB (e.g. just added via OAuth, saveAccountsToDB pending)
      const dbEmails = new Set(dbAccounts.map(a => a.email))
      const localOnly = local.filter(a => !dbEmails.has(a.email))
      saveAccounts([...fromDb, ...localOnly])
    }),
  ])
}

/** Wipe every user-specific key from localStorage and reset in-memory stores. */
function clearUserData(clearTasks: () => void, clearHabits: () => void) {
  const userKeys = [
    'professor-tasks', 'professor-habits', 'professor-habit-logs',
    'professor-companies', 'professor-company-users', 'professor-connected-accounts',
    'professor-review-hours', 'professor-section-order',
    'cal-view-mode', 'cal-hidden-calendars', 'cal-intel-hidden', 'cal-list-cache',
    'google_provider_token', 'google_provider_token_saved_at',
  ]
  userKeys.forEach(k => localStorage.removeItem(k))
  // Clear dynamic day-plan keys
  Object.keys(localStorage)
    .filter(k => k.startsWith('professor-dayplan-'))
    .forEach(k => localStorage.removeItem(k))
  // Reset in-memory Zustand stores
  clearTasks()
  clearHabits()
  saveAccounts([])
}

function App() {
  const { setUser, setLoading, user, loading } = useAuthStore()
  const themeId = useUIStore(s => s.themeId)
  const stopPrefSync = useRef<(() => void) | null>(null)
  const stopLiveSync = useRef<(() => void) | null>(null)
  useEffect(() => () => { stopPrefSync.current?.(); stopLiveSync.current?.() }, [])
  const loadTasksFromDB  = useTaskStore(s => s.loadFromDB)
  const clearTasks       = useTaskStore(s => s.clearAll)
  const loadHabitsFromDB = useHabitsStore(s => s.loadFromDB)
  const clearHabits      = useHabitsStore(s => s.clearAll)

  /** Keep this device in step with the others while it is open, rather than
   *  only at sign-in. Restarting is safe — it tears the previous one down. */
  function beginLiveSync(userId: string) {
    stopLiveSync.current?.()
    stopLiveSync.current = startLiveSync(userId, {
      habits:  loadHabitsFromDB,
      tasks:   loadTasksFromDB,
      finance: () => useFinanceStore.getState().loadFromDB(),
    })
  }

  // themeId kept in store for backward compat — Sunlit Bento uses CSS tokens only
  void themeId

  useEffect(() => {
    // Capture BEFORE subscription runs — onAuthStateChange may clear it in INITIAL_SESSION
    const hasPendingOnLoad = !!getPendingAddAccount()
    // Remember the original user so we can identify intermediate sessions from the new account
    const originalUserIdOnLoad = localStorage.getItem(LAST_USER_KEY)
    // Guard: prevents getSession() and onAuthStateChange from both processing add-account
    let addAccountHandled = false

    /**
     * Try to complete the add-account flow with the given session.
     * Returns true if handled (caller should return/skip normal flow).
     */
    function tryHandleAddAccount(session: { user: { id: string; email?: string; user_metadata?: Record<string,unknown> }; provider_token?: string | null; provider_refresh_token?: string | null; access_token: string; refresh_token?: string } | null): boolean {
      if (addAccountHandled || !hasPendingOnLoad) return false
      const pending = getPendingAddAccount()
      if (!pending) { console.log('[AddAccount] pending key missing'); return false }
      if (!session?.provider_token) { console.log('[AddAccount] no provider_token in session, event may be INITIAL_SESSION — will retry on SIGNED_IN'); return false }
      if (!session.user) { console.log('[AddAccount] no user in session'); return false }
      addAccountHandled = true
      clearPendingAddAccount()
      const email = session.user.email ?? ''
      console.log('[AddAccount] ✓ Adding account:', email)
      addAccount({
        email,
        name:                 (session.user.user_metadata?.full_name as string) ?? '',
        avatarUrl:            session.user.user_metadata?.avatar_url as string | undefined,
        providerToken:        session.provider_token,
        supabaseAccessToken:  session.access_token,
        supabaseRefreshToken: session.refresh_token ?? '',
        scopes:               ['calendar', 'calendar.events', 'gmail.readonly'],
        isPrimary:            false,
      })
      // Seed tokenManager cache so the first fetchAllEvents doesn't hit the Edge Function
      if (session.provider_token) seedToken(email, session.provider_token)
      // Capture refresh token now — we'll save it to DB AFTER restoring the primary
      // session, because the RLS policy requires auth.uid() = user_id. While the
      // extra account's session is active, auth.uid() = extraAccountId ≠ primaryUserId,
      // so any upsert attempted here would silently fail the RLS check.
      const googleRefreshToken = session.provider_refresh_token ?? null
      // Notify Settings (and any other listeners) to re-read accounts from localStorage
      window.dispatchEvent(new CustomEvent('professor:accountsUpdated'))
      // Restore original session, then refresh to get a fresh primary Google token
      void supabase.auth.setSession(pending)
        .then(async () => {
          // ── Save account metadata + tokens via edge function ─────────────────
          // Primary session is now active → JWT auth passes as the primary user.
          // Always call save_account so google_accounts metadata row is created even
          // when provider_refresh_token is absent (needed for the bootstrap fallback).
          if (session.provider_token) {
            const expiresAt = new Date(Date.now() + 3500 * 1000).toISOString()
            const body: Record<string, unknown> = {
              action:       'save_account',
              email,
              name:         (session.user.user_metadata?.full_name as string) ?? null,
              avatar_url:   session.user.user_metadata?.avatar_url as string | undefined ?? null,
              access_token: session.provider_token,
              scopes:       ['calendar', 'calendar.events', 'gmail.readonly'],
            }
            // Include refresh_token only when Google provided one — Edge Function skips
            // google_account_tokens upsert when absent.
            if (googleRefreshToken) {
              body.refresh_token = googleRefreshToken
              body.expires_at    = expiresAt
            } else {
              console.warn('[AddAccount] No provider_refresh_token — google_account_tokens row will be created on first successful bootstrap')
            }
            const { error: fnErr } = await supabase.functions.invoke('google-oauth', { body })
            if (fnErr) console.warn('[AddAccount] Failed to save via google-oauth edge fn:', fnErr)
            else console.log('[AddAccount] ✓ Account row saved for', email, googleRefreshToken ? '(with refresh token)' : '(metadata only)')
          } else {
            console.warn('[AddAccount] No provider_token — account not persisted to DB')
          }
          try {
            const { data } = await supabase.auth.refreshSession()
            if (data.session?.provider_token) {
              localStorage.setItem('google_provider_token', data.session.provider_token)
              localStorage.setItem('google_provider_token_saved_at', Date.now().toString())
              console.log('[AddAccount] ✓ Primary Google token refreshed after session restore')
            } else {
              // Supabase didn't return a fresh Google token — mark existing one as fresh
              // so it is used directly without triggering unnecessary refresh loops.
              // (The token itself may still be valid; we just reset the staleness timestamp.)
              const existing = localStorage.getItem('google_provider_token')
              if (existing) {
                localStorage.setItem('google_provider_token_saved_at', Date.now().toString())
                console.log('[AddAccount] Primary Google token TTL reset (no new token from refresh)')
              }
            }
          } catch (e) {
            console.warn('[AddAccount] Could not refresh primary token:', e)
          }
          return saveAccountsToDB(loadAccounts())
        })
        .catch(console.warn)
      return true
    }

    // ── Initial session check ────────────────────────────────────────────────
    void supabase.auth.getSession().then(({ data }) => {
      const s = data.session
      console.log('[getSession] hasPendingOnLoad:', hasPendingOnLoad, 'user:', s?.user?.email, 'hasProviderToken:', !!s?.provider_token)
      if (hasPendingOnLoad) {
        // Try with getSession result (works when provider_token is stored in session)
        tryHandleAddAccount(s as Parameters<typeof tryHandleAddAccount>[0])
        // Regardless: skip normal init — onAuthStateChange handles setUser + setLoading
        return
      }
      const u = s?.user
      if (u) {
        const lastUserId = localStorage.getItem(LAST_USER_KEY)
        if (lastUserId && lastUserId !== u.id) clearUserData(clearTasks, clearHabits)
        localStorage.setItem(LAST_USER_KEY, u.id)
      }
      setUser(u ? { id: u.id, email: u.email ?? '', name: u.user_metadata?.full_name as string | undefined, avatarUrl: u.user_metadata?.avatar_url as string | undefined } : null)
      if (u) {
        void loadAllFromDB(loadTasksFromDB, loadHabitsFromDB)
        beginLiveSync(u.id)
        // Preferences that are your work rather than this device's.
        stopPrefSync.current?.()
        stopPrefSync.current = startPrefSync()
      }
      setLoading(false)
    })

    // ── Auth state changes ───────────────────────────────────────────────────
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      console.log('[onAuthStateChange]', _event, 'user:', session?.user?.email, 'hasProviderToken:', !!session?.provider_token, 'hasPendingOnLoad:', hasPendingOnLoad)

      // ── Add-account flow ───────────────────────────────────────────────────
      if (hasPendingOnLoad) {
        if (tryHandleAddAccount(session as Parameters<typeof tryHandleAddAccount>[0])) return
        // tryHandleAddAccount returned false (no provider_token yet, or already handled):
        // fall through to normal path so setUser + setLoading are called
      }

      // ── Normal sign-in / sign-out ──────────────────────────────────────────
      const u = session?.user
      setUser(u ? { id: u.id, email: u.email ?? '', name: u.user_metadata?.full_name as string | undefined, avatarUrl: u.user_metadata?.avatar_url as string | undefined } : null)
      setLoading(false)

      if (u) {
        if (hasPendingOnLoad) {
          // During add-account flow: NEVER clear user data.
          // Also skip loadAllFromDB for the intermediate new-account session (after addAccountHandled)
          // — only run it for the original user (pre-add or restored session).
          localStorage.setItem(LAST_USER_KEY, u.id)
          const isIntermediateSession = addAccountHandled && u.id !== originalUserIdOnLoad
          if (!isIntermediateSession) {
            if (session?.provider_token) {
              localStorage.setItem('google_provider_token', session.provider_token)
              localStorage.setItem('google_provider_token_saved_at', Date.now().toString())
            }
            void loadAllFromDB(loadTasksFromDB, loadHabitsFromDB)
            beginLiveSync(u.id)
          }
        } else {
          // Normal sign-in: check for user switch
          const lastUserId = localStorage.getItem(LAST_USER_KEY)
          if (lastUserId && lastUserId !== u.id) clearUserData(clearTasks, clearHabits)
          localStorage.setItem(LAST_USER_KEY, u.id)
          if (session?.provider_token) {
            localStorage.setItem('google_provider_token', session.provider_token)
            localStorage.setItem('google_provider_token_saved_at', Date.now().toString())
          }
          // Persist primary email so blockingRules.getToken() can identify the primary
          // account even when professor-connected-accounts is empty (e.g. after clearUserData)
          if (u.email) localStorage.setItem('google_primary_email', u.email)
          // Warm tokenManager cache from any fresh extra-account tokens in localStorage
          seedFromLocalStorage()
          // Persist primary account tokens to secure google_account_tokens via edge function.
          // Retry up to 3 times — this is fire-and-forget at sign-in but critical for
          // token refresh to work after the 1-hour access token expires.
          // Always call save_primary when provider_token is present — this ensures the
          // google_accounts metadata row exists even when provider_refresh_token is absent
          // (which happens on every sign-in after the first). Without the metadata row,
          // handleRefresh in the Edge Function can't resolve the account by email and
          // returns reconnect_required even when a valid Google refresh token is in the DB.
          if (session?.provider_token && u.email) {
            const expiresAt = new Date(Date.now() + 3500 * 1000).toISOString()
            const body: Record<string, unknown> = {
              action:       'save_primary',
              email:        u.email,
              name:         u.user_metadata?.full_name as string | undefined ?? null,
              avatar_url:   u.user_metadata?.avatar_url as string | undefined ?? null,
              access_token: session.provider_token,
              expires_at:   expiresAt,
              scopes:       ['calendar', 'calendar.events', 'gmail.readonly'],
            }
            // Include refresh_token only when Google provides it (first OAuth grant only)
            if (session.provider_refresh_token) body.refresh_token = session.provider_refresh_token
            ;(async () => {
              for (let attempt = 1; attempt <= 3; attempt++) {
                const { error } = await supabase.functions.invoke('google-oauth', { body })
                if (!error) { console.log('[App] ✓ Primary tokens saved to google_account_tokens'); break }
                console.warn(`[App] save_primary attempt ${attempt}/3 failed:`, error)
                if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 1500))
              }
            })()
          }
          void loadAllFromDB(loadTasksFromDB, loadHabitsFromDB)
          beginLiveSync(u.id)
        }
      } else if (!session) {
        stopLiveSync.current?.()
        stopLiveSync.current = null
        localStorage.removeItem('google_provider_token')
        localStorage.removeItem('google_provider_token_saved_at')
        localStorage.removeItem(LAST_USER_KEY)
        clearAllTokens()
      }
    })

    return () => subscription.unsubscribe()
  }, [setUser, setLoading, loadTasksFromDB, clearTasks, clearHabits])

  // ── Proactive 45-min background token refresh ────────────────────────────────
  // Prevents the 60-min Google token expiry from silently breaking calendar fetches
  // while the tab is open but idle. Runs for both primary and all extra accounts.
  useEffect(() => {
    if (!user) return
    const refresh = async () => {
      await refreshPrimaryToken()
      const extras = loadAccounts().filter(a => !a.isPrimary)
      await Promise.all(extras.map(a => getGoogleToken(a.email)))
    }
    const id = setInterval(refresh, 45 * 60 * 1000)
    return () => clearInterval(id)
  }, [user])

  // Money reminders become ordinary tasks: the board pushes anything scheduled
  // with a date onto the calendar, so nothing here has to know about calendars.
  // Runs once the categories are in, again whenever the rules change, and daily
  // for a session left open across midnight.
  const financeCategories = useFinanceStore(s => s.categories)
  useEffect(() => {
    if (!user || financeCategories.length === 0) return
    // Read the stores at call time rather than subscribing to the task list:
    // this writes to it, and depending on it would run again on its own output.
    const run = () => {
      const ts = useTaskStore.getState()
      runReminders(financeCategories, ts.tasks, {
        addTask: ts.addTask, updateTask: ts.updateTask, deleteTask: ts.deleteTask,
      })
      // A budget with a day on it writes the entry itself, unpaid, rather than
      // a task about it. Read at call time for the same reason: this writes to
      // the ledger it is looking at.
      const fs = useFinanceStore.getState()
      runBudgetEntries(
        fs.categories, loadRules(), fs.transactions,
        fs.accounts[0]?.id, fs.currentYear,
        { add: txs => void fs.upsertTransactions(txs), remove: id => void fs.removeTransaction(id) },
      )
    }
    run()
    window.addEventListener('professor:moneyRemindersChanged', run)
    const id = setInterval(run, 12 * 60 * 60 * 1000)
    return () => {
      window.removeEventListener('professor:moneyRemindersChanged', run)
      clearInterval(id)
    }
  }, [user, financeCategories])

  const [assistantOpen, setAssistantOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  // ⌘K / Ctrl-K anywhere, and the magnifier in the nav, open the same palette
  useEffect(() => {
    const openIt = () => setSearchOpen(true)
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(o => !o) }
    }
    window.addEventListener('professor:openSearch', openIt)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('professor:openSearch', openIt)
      document.removeEventListener('keydown', onKey)
    }
  }, [])
  const [showWizard, setShowWizard] = useState(false)
  const wizardChecked = useRef(false)

  // Show wizard on first login (once per account), and on professor:openWizard event
  useEffect(() => {
    if (!user || wizardChecked.current) return
    wizardChecked.current = true
    if (!localStorage.getItem('bpa-wizard-done')) setShowWizard(true)
  }, [user])

  useEffect(() => {
    const handler = () => { setShowWizard(true) }
    window.addEventListener('professor:openWizard', handler)
    return () => window.removeEventListener('professor:openWizard', handler)
  }, [])

  if (loading) return <LoadingScreen />
  if (!user)   return <LoginScreen />

  return (
    <div style={{
      height: '100dvh',
      overflow: 'hidden',
      background: '#F7F4EA',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      fontFamily: "'Instrument Sans', system-ui, sans-serif",
    }}>
      {/* The shell owns the viewport: the nav stays put and only the module
          below it scrolls. */}
      <div style={{
        width: '100%',
        maxWidth: 1560,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: '#F7F4EA',
      }}>
        <TopNav />
        <SyncGapBanner />
        <main style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', background: '#F7F4EA' }}>
          <ActiveModule />
        </main>
      </div>
      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
      <AssistantPanel open={assistantOpen} onClose={() => setAssistantOpen(false)} />
      <AssistantToggle open={assistantOpen} onClick={() => setAssistantOpen(o => !o)} />
      {showWizard && <SetupWizard onClose={() => setShowWizard(false)} />}
    </div>
  )
}

export default App

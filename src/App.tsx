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
import { NavRow } from './components/ui'
import { useUIStore } from './store/uiStore'
import {
  collect, loadNotifSettings, inQuietHours, markSeen, dormantKinds, NOTIF_EVENT,
  type Notification, type NotifSetting,
} from './lib/notifications'
import { checkRank } from '@/lib/rankWatch'
import { useAuthStore } from './store/authStore'
import { useTaskStore } from './store/taskStore'
import { useHabitsStore } from './store/habitsStore'
import { supabase } from './lib/supabase'
import { signInWithGoogle, signOut as googleSignOut, getPendingAddAccount, clearPendingAddAccount } from './lib/google'
import { addAccount, loadAccounts, saveAccounts, setAccountScopes } from './lib/multiAccount'
import { readScopes, cachedScopes } from './lib/googleScopes'
import { saveAccountsToDB, loadCompaniesFromDB, loadRawSettingsFromDB, loadAccountsFromDB, mergeCompanies } from './lib/dbSync'
import type { CompanyRow } from './lib/dbSync'
import { startPrefSync } from './lib/prefSync'
import { startLiveSync } from './lib/liveSync'
import { useFinanceStore } from './modules/finance/financeStore'
import { runReminders } from './modules/finance/reminders'
import { startAutomation } from './lib/automation'
import { runBudgetEntries } from './modules/finance/budgetEntries'
import { loadRules } from './modules/finance/modals/BudgetRuleModal'
import { SyncGapBanner } from './modules/shell/SyncGapBanner'
import { UndoBar } from './components/UndoBar'
import { BeLogo } from './components/BeLogo'
import { useTaskCalendarPush } from './lib/taskAutoSchedule'
import { seedToken, seedFromLocalStorage, clearAllTokens, getGoogleToken } from './lib/tokenManager'
import { refreshPrimaryToken } from './lib/googleCalendar'
import { SetupWizard } from './modules/wizard/SetupWizard'
import { Search, Settings, LogOut } from 'lucide-react'
import { ICON } from '@/lib/type'

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
      background: 'linear-gradient(160deg, var(--sb-page) 0%, var(--sb-accent-tint) 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '32px 24px',
      fontFamily: 'var(--sb-font-ui)',
    }}>
      {/* Main card */}
      <div style={{
        width: '100%',
        maxWidth: 960,
        display: 'grid',
        gridTemplateColumns: '1fr 400px',
        gap: 0,
        background: 'var(--sb-card)',
        borderRadius: 'var(--sb-r-frame)',
        boxShadow: 'var(--sb-shadow-frame)',
        overflow: 'hidden',
        border: 'var(--sb-border-width) solid var(--sb-border)',
      }}>
        {/* Left — promise */}
        <div style={{
          background: 'linear-gradient(160deg, var(--sb-page) 0%, var(--sb-accent-tint) 100%)',
          padding: '60px 56px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}>
          {/* Mark — the same one the app wears, at the size a first screen
              can carry. It stands alone here too. */}
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 56 }}>
            <BeLogo variant="amber" size={88} title="Be" />
          </div>

          {/* Headline */}
          <div style={{ flex: 1 }}>
            <h1 style={{
              margin: '0 0 16px',
              fontFamily: 'var(--sb-font-num)',
              fontWeight: 700, fontSize: 42, lineHeight: 1.06,
              color: 'var(--sb-ink-1)', letterSpacing: '-.03em',
            }}>
              Your personal<br />operating system.
            </h1>
            <p style={{
              margin: '0 0 48px',
              fontSize: 'var(--sb-t-h3)', color: 'var(--sb-ink-3)', lineHeight: 1.7, maxWidth: 380,
            }}>
              Reads your calendar, tasks, habits and finances — then tells you
              exactly what to do next, in plain sentences, with the numbers behind them.
            </p>

            {/* Live numbers */}
            <div style={{ display: 'flex', gap: 32 }}>
              {LIVE_STATS.map(s => (
                <div key={s.label}>
                  <div style={{
                    fontFamily: 'var(--sb-font-num)',
                    fontWeight: 700, fontSize: 'var(--sb-t-h1)', color: 'var(--sb-ink-1)', letterSpacing: '-.02em',
                    fontVariantNumeric: 'tabular-nums',
                  }}>{s.value}</div>
                  <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', marginTop: 2 }}>{s.label}</div>
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
          background: 'var(--sb-card)',
        }}>
          <h2 style={{
            margin: '0 0 6px',
            fontFamily: 'var(--sb-font-num)',
            fontWeight: 600, fontSize: 'var(--sb-t-h2)', color: 'var(--sb-ink-1)', letterSpacing: '-.02em',
          }}>
            Sign in
          </h2>
          <p style={{ margin: '0 0 32px', fontSize: 'var(--sb-t-label)', color: 'var(--sb-ink-3)' }}>
            Continue to your operating system.
          </p>

          {/* Google button */}
          <button
            onClick={() => void handleSignIn()}
            disabled={signing}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              width: '100%', padding: '13px 20px',
              borderRadius: 'var(--sb-r-nav)',
              background: signing ? 'var(--sb-field)' : 'var(--sb-ink-1)',
              border: 'var(--sb-border-width) solid var(--sb-ink-1)',
              color: 'var(--sb-ink-on-dark)',
              fontSize: 'var(--sb-t-label)', fontWeight: 600,
              cursor: signing ? 'wait' : 'pointer',
              fontFamily: 'var(--sb-font-ui)',
              transition: 'background 140ms ease-out, box-shadow 140ms ease-out',
              boxShadow: 'var(--sb-shadow-accent)',
            }}
          >
            {/* Google G mark */}
            <svg width="18" height="18" viewBox="0 0 18 18">
              <path fill={signing ? 'var(--sb-ink-4)' : 'var(--sb-accent-tint)'} fillOpacity=".9"
                d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908C16.658 14.076 17.64 11.768 17.64 9.2z"/>
              <path fill={signing ? 'var(--sb-ink-4)' : 'var(--sb-accent-tint)'} fillOpacity=".75"
                d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
              <path fill={signing ? 'var(--sb-ink-4)' : 'var(--sb-accent-tint)'} fillOpacity=".6"
                d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"/>
              <path fill={signing ? 'var(--sb-ink-4)' : 'var(--sb-accent-tint)'} fillOpacity=".9"
                d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 6.294C4.672 4.169 6.656 3.58 9 3.58z"/>
            </svg>
            {signing ? 'Redirecting…' : 'Continue with Google'}
          </button>

          {/* Divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '24px 0' }}>
            <div style={{ flex: 1, height: 1, background: 'var(--sb-border)' }} />
            <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)' }}>or</span>
            <div style={{ flex: 1, height: 1, background: 'var(--sb-border)' }} />
          </div>

          {/* Email (passive — redirects to Google OAuth anyway) */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 'var(--sb-t-body-s)', fontWeight: 500, color: 'var(--sb-ink-2)', marginBottom: 5 }}>
              Email
            </label>
            <input
              type="email"
              placeholder="you@example.com"
              disabled
              style={{
                width: '100%', padding: '11px 14px', borderRadius: 'var(--sb-r-sm)',
                background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)',
                color: 'var(--sb-ink-4)', fontSize: 'var(--sb-t-body)',
                outline: 'none', cursor: 'not-allowed',
                fontFamily: 'inherit', boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 'var(--sb-t-body-s)', fontWeight: 500, color: 'var(--sb-ink-2)', marginBottom: 5 }}>
              Password
            </label>
            <input
              type="password"
              placeholder="••••••••"
              disabled
              style={{
                width: '100%', padding: '11px 14px', borderRadius: 'var(--sb-r-sm)',
                background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)',
                color: 'var(--sb-ink-4)', fontSize: 'var(--sb-t-body)',
                outline: 'none', cursor: 'not-allowed',
                fontFamily: 'inherit', boxSizing: 'border-box',
              }}
            />
          </div>

          <button
            disabled
            style={{
              width: '100%', padding: '12px',
              borderRadius: 'var(--sb-r-nav)',
              background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)',
              color: 'var(--sb-ink-4)', fontSize: 'var(--sb-t-label)', fontWeight: 600,
              cursor: 'not-allowed', fontFamily: 'inherit',
            }}
          >
            Log in
          </button>

          <p style={{ margin: '24px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', textAlign: 'center', lineHeight: 1.65 }}>
            By continuing, you agree to our{' '}
            <span style={{ color: 'var(--sb-ink-2)', textDecoration: 'underline', cursor: 'pointer' }}>Terms</span>
            {' '}and{' '}
            <span style={{ color: 'var(--sb-ink-2)', textDecoration: 'underline', cursor: 'pointer' }}>Privacy Policy</span>.
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
      background: 'linear-gradient(160deg, var(--sb-page) 0%, var(--sb-accent-tint) 100%)',
      gap: 16,
      fontFamily: 'var(--sb-font-ui)',
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: 'var(--sb-r-nav)',
        background: 'var(--sb-ink-1)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'sbPulse 1.6s ease-in-out infinite',
      }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
          stroke="var(--sb-ink-on-dark)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
          <path d="M6 12v5c3.333 2 8.667 2 12 0v-5"/>
        </svg>
      </div>
      <span style={{ fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-3)', fontWeight: 500 }}>Loading your system…</span>
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
  inbox: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7.5l8.5 6 8.5-6"/>
    </svg>
  ),
  settings: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>
    </svg>
  ),
}

/** The top bar's height. The mark sets it: 60px of logo needs somewhere to sit
 *  with air around it, and everything that fills the rest of the window
 *  measures itself against this. */
/** The shell's own height, as a CSS length rather than a number: it is
 *  --sb-h-header, which a theme moves, and the two screens that size
 *  themselves against it read it the same way. */
export const NAV_H = 'var(--sb-h-header)'

const NAV_ITEMS = [
  { id: 'morning',   label: 'Today'    },
  { id: 'calendar',  label: 'Calendar' },
  // The mail module has existed since the beginning and had no way in: it was
  // reachable only by something else setting the module for you.
  { id: 'inbox',     label: 'Mail'     },
  { id: 'tasks',     label: 'Tasks'    },
  { id: 'habits',    label: 'Habits'   },
  { id: 'finance',   label: 'Finance'  },
  // The dashboard was the module the app opened on and the one place with no
  // way back to it — Today's pill lit up for it instead, which named the wrong
  // screen. Settings left the row for the avatar menu, where the things about
  // *you* rather than about your work belong.
  { id: 'dashboard', label: 'Dashboard' },
] as const


// ─── The bell ────────────────────────────────────────────────────────────────
// What is under it is decided by Settings → Notifications: a kind with its Push
// switch off is never listed, and quiet hours hold the count back rather than
// the list — you can always look, you are just not tapped on the shoulder.

function NotificationBell() {
  const focusOn = useUIStore(s => s.focusOn)
  const setActiveModule = useUIStore(s => s.setActiveModule)
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState<NotifSetting[]>(() => loadNotifSettings())
  const [items, setItems] = useState<Notification[]>(() => collect(loadNotifSettings()))
  const ref = useRef<HTMLDivElement>(null)

  // Re-read on any change to the matrix or to what it is derived from, and on
  // a slow tick so "not logged today" and Sunday evening arrive on their own.
  useEffect(() => {
    const refresh = () => {
      // The rank is worked out here rather than only on the Behavioral OS page,
      // or a promotion would be announced when you happened to open that page
      // rather than when it happened.
      checkRank()
      const next = loadNotifSettings()
      setSettings(next)
      setItems(collect(next))
    }
    refresh()
    const id = window.setInterval(refresh, 120_000)
    for (const ev of [NOTIF_EVENT, 'storage', 'focus']) window.addEventListener(ev, refresh)
    return () => {
      window.clearInterval(id)
      for (const ev of [NOTIF_EVENT, 'storage', 'focus']) window.removeEventListener(ev, refresh)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [open])

  const quiet = inQuietHours()
  const dormant = dormantKinds(settings)
  const count = items.length

  function goTo(n: Notification) {
    setOpen(false)
    markSeen([n.id])
    setItems(prev => prev.filter(x => x.id !== n.id))
    if (!n.go) return
    if (n.go.id) focusOn({ module: n.go.module, id: n.go.id, ...(n.go.date ? { date: n.go.date } : {}) })
    else setActiveModule(n.go.module)
  }

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => setOpen(o => !o)}
        title={count ? `${count} thing${count === 1 ? '' : 's'} waiting` : 'Nothing waiting'}
        aria-label="Notifications"
        aria-expanded={open}
        style={{
          width: 'var(--sb-h-pill)', height: 'var(--sb-h-pill)', borderRadius: 'var(--sb-r-nav)', padding: 0,
          background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', color: 'var(--sb-ink-3)', position: 'relative',
        }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 16V11a6 6 0 1 0-12 0v5l-1.5 2.5h15z"/>
          <path d="M10 20a2 2 0 0 0 4 0"/>
        </svg>
        {/* Quiet hours mean you are not interrupted — the list is still there. */}
        {count > 0 && !quiet && (
          <span style={{
            position: 'absolute', top: -4, right: -4, minWidth: 17, height: 17, padding: '0 4px',
            borderRadius: 'var(--sb-r-pill)', background: 'var(--sb-negative)', color: 'var(--sb-ink-on-fill)',
            fontSize: 'var(--sb-t-micro)', fontWeight: 700, lineHeight: '17px', textAlign: 'center',
            boxShadow: '0 0 0 2px var(--sb-header)',
          }}>{count > 9 ? '9+' : count}</span>
        )}
      </button>

      {open && (
        <div role="menu" style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 120,
          width: 340, maxHeight: 460, overflowY: 'auto', scrollbarWidth: 'thin',
          background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-card)', padding: 6,
          boxShadow: 'var(--sb-shadow-frame)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px 10px', borderBottom: 'var(--sb-border-width) solid var(--sb-hairline)' }}>
            <p style={{ margin: 0, flex: 1, fontSize: 'var(--sb-t-label)', fontWeight: 600, color: 'var(--sb-ink-1)' }}>
              Notifications{count ? ` · ${count}` : ''}
            </p>
            {count > 0 && (
              <button onClick={() => { markSeen(items.map(i => i.id)); setItems([]) }}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', padding: 0,
                }}>Clear all</button>
            )}
          </div>

          {items.map(n => (
            <button key={n.id} role="menuitem" onClick={() => goTo(n)}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 9, width: '100%',
                padding: '9px 10px', borderRadius: 'var(--sb-r-sm)', border: 'none', background: 'transparent',
                cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
              }}>
              <span style={{
                width: 7, height: 7, borderRadius: 'var(--sb-r-pill)', flexShrink: 0, marginTop: 5,
                background: KIND_COLOR[n.kind] ?? 'var(--sb-accent)',
              }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{
                  display: 'block', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)', lineHeight: 1.35,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{n.title}</span>
                <span style={{ display: 'block', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', lineHeight: 1.35 }}>{n.detail}</span>
              </span>
            </button>
          ))}

          {count === 0 && (
            <p style={{ margin: 0, padding: '18px 12px', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-4)', lineHeight: 1.5, textAlign: 'center' }}>
              Nothing is waiting for you.
            </p>
          )}

          {quiet && (
            <p style={{ margin: '4px 6px 0', padding: '8px 10px', borderRadius: 'var(--sb-r-sm)', background: 'var(--sb-field)', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.45 }}>
              Quiet hours — you are not being interrupted, but nothing is hidden.
            </p>
          )}

          {/* A kind that is on and cannot speak yet says what it is waiting
              on. An empty bell for a reason is not the same as a quiet day. */}
          {dormant.map(d => (
            <p key={d.setting.id} style={{ margin: '4px 6px 0', padding: '8px 10px', fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)', lineHeight: 1.45 }}>
              {d.setting.label} — {d.why}.
            </p>
          ))}

          <button onClick={() => { setOpen(false); setActiveModule('settings') }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%', height: 'var(--sb-h-pill)', marginTop: 4,
              padding: '0 10px', borderRadius: 'var(--sb-r-sm)', border: 'none', background: 'transparent',
              color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-body-s)', fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left',
            }}>
            <Settings size={ICON.sm} color="var(--sb-ink-4)" /> What gets notified
          </button>
        </div>
      )}
    </div>
  )
}

const KIND_COLOR: Record<string, string> = {
  decision: 'var(--sb-negative)', conflict: 'var(--sb-accent)', habit: 'var(--sb-positive)', review: 'var(--sb-accent)',
}

function TopNav() {
  const activeModule    = useUIStore(s => s.activeModule)
  const setActiveModule = useUIStore(s => s.setActiveModule)
  const user            = useAuthStore(s => s.user)

  const initials = user?.name
    ? user.name.split(' ').map((p: string) => p[0]).join('').slice(0, 2).toUpperCase()
    : user?.email?.slice(0, 2).toUpperCase() ?? '?'

  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menuOpen) return
    const away = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false) }
    const esc  = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [menuOpen])

  return (
    <header style={{
      height: NAV_H, flexShrink: 0,
      background: 'var(--sb-header)',
      borderBottom: 'var(--sb-border-width) solid var(--sb-border)',
      display: 'flex', alignItems: 'center',
      padding: '0 22px', gap: 16,
    }}>
      {/* Product mark — left 1/3 */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
        {/* The mark alone. The handoff is explicit about this — "never restate
            the word beside the mark", because the mark already contains it —
            and at this size the wordmark beside it was competing with it. */}
        <BeLogo variant="amber" size={60} title="Be" />
      </div>

      {/* Nav pills — center */}
      <nav style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
        {NAV_ITEMS.map(item => {
          const active = activeModule === item.id
          return (
            <NavRow
              key={item.id}
              onClick={() => setActiveModule(item.id)}
              active={active}
              icon={NAV_ICONS[item.id]}
              label={item.label}
              style={{ width: 'auto' }}
            />
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
            background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
            borderRadius: 'var(--sb-r-nav)', cursor: 'pointer',
          }}>
          <Search size={ICON.sm} color="var(--sb-ink-3)" />
          <span style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-4)', userSelect: 'none' }}>Search</span>
          <span style={{
            marginLeft: 4,
            fontSize: 'var(--sb-t-micro)', fontFamily: 'var(--sb-font-mono)',
            color: 'var(--sb-ink-4)', opacity: 0.7,
          }}>⌘K</span>
        </div>

        <NotificationBell />

        {/* Avatar — and what is behind it */}
        <div ref={menuRef} style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => setMenuOpen(o => !o)}
            title={user?.email ?? 'Your account'}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            style={{
              width: 32, height: 32, borderRadius: 'var(--sb-r-pill)', padding: 0,
              background: 'var(--sb-ink-1)', border: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', overflow: 'hidden',
            }}>
            {user?.avatarUrl ? (
              <img src={user.avatarUrl} alt={initials} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span style={{ fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-on-dark)', letterSpacing: '0.02em' }}>
                {initials}
              </span>
            )}
          </button>
          {menuOpen && (
            <div role="menu" style={{
              position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 120, minWidth: 216,
              background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-card)', padding: 6,
              boxShadow: 'var(--sb-shadow-frame)',
            }}>
              <div style={{ padding: '8px 10px 10px', borderBottom: 'var(--sb-border-width) solid var(--sb-hairline)', marginBottom: 5 }}>
                <p style={{
                  margin: 0, fontSize: 'var(--sb-t-label)', fontWeight: 600, color: 'var(--sb-ink-1)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{user?.name ?? 'Your account'}</p>
                <p style={{
                  margin: '2px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{user?.email}</p>
              </div>
              <button
                role="menuitem"
                onClick={() => { setMenuOpen(false); setActiveModule('settings') }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 9, width: '100%', height: 'var(--sb-h-nav)',
                  padding: '0 10px', borderRadius: 'var(--sb-r-sm)', border: 'none', cursor: 'pointer',
                  background: activeModule === 'settings' ? 'var(--sb-accent-tint)' : 'transparent',
                  color: 'var(--sb-ink-1)', fontSize: 'var(--sb-t-body)', fontFamily: 'inherit', textAlign: 'left',
                }}>
                <Settings size={ICON.md} color="var(--sb-ink-3)" /> Settings
              </button>
              <button
                role="menuitem"
                onClick={() => { setMenuOpen(false); void googleSignOut() }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 9, width: '100%', height: 'var(--sb-h-nav)',
                  padding: '0 10px', borderRadius: 'var(--sb-r-sm)', border: 'none', cursor: 'pointer',
                  background: 'transparent', color: 'var(--sb-negative)', fontSize: 'var(--sb-t-body)',
                  fontFamily: 'inherit', textAlign: 'left',
                }}>
                <LogOut size={ICON.md} color="var(--sb-negative)" /> Sign out
              </button>
            </div>
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
      if (companies.length === 0) return
      // Never write a blank over something this browser knows: a database
      // missing a column hands back an empty account_id, and overwriting with
      // it is what un-linked every company on each refresh.
      const local = (() => {
        try { return JSON.parse(localStorage.getItem('professor-companies') ?? '[]') as CompanyRow[] }
        catch { return [] as CompanyRow[] }
      })()
      localStorage.setItem('professor-companies', JSON.stringify(mergeCompanies(companies, local)))
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
      // The scopes stored here used to be three strings typed out by hand,
      // which is why the Drive badge said "not granted" however many times you
      // granted it. `readScopes` asks the token; it lands a moment later, and
      // the row is redrawn by `professor:accountsUpdated` when it does.
      void readScopes(email, session.provider_token).then((sc: string[] | null) => {
        if (sc) { setAccountScopes(email, sc); window.dispatchEvent(new CustomEvent('professor:accountsUpdated')) }
      })
      addAccount({
        email,
        name:                 (session.user.user_metadata?.full_name as string) ?? '',
        avatarUrl:            session.user.user_metadata?.avatar_url as string | undefined,
        providerToken:        session.provider_token,
        supabaseAccessToken:  session.access_token,
        supabaseRefreshToken: session.refresh_token ?? '',
        // Empty rather than invented: what the token carries is read from the
        // token, and until that answers, nothing here claims otherwise.
        scopes:               cachedScopes(email) ?? [],
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
              scopes:       (await readScopes(email, session.provider_token)) ?? cachedScopes(email) ?? [],
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
              // Filled in by the block below, which can await the token.
              scopes:       cachedScopes(u.email) ?? [],
            }
            // Include refresh_token only when Google provides it (first OAuth grant only)
            if (session.provider_refresh_token) body.refresh_token = session.provider_refresh_token
            ;(async () => {
              // Ask the token what it carries before telling the server. The
              // three strings that used to sit here were a guess that outlived
              // every grant the user ever made.
              const measured = await readScopes(u.email ?? '', session.provider_token as string)
              if (measured) body.scopes = measured
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
  // Depend on *which* categories there are, not on the array. `loadFromDB`
  // replaces the list on every sync, so the identity changes every 45 seconds —
  // and this effect wrote a month of budget entries each time it did, against a
  // ledger the reload had just emptied. That is how one rent became four.
  const categoryKey = financeCategories.map(c => c.id).sort().join('|')
  const financeLoading = useFinanceStore(s => s.loading)
  useEffect(() => {
    if (!user || categoryKey === '' || financeLoading) return
    // Read the stores at call time rather than subscribing to the task list:
    // this writes to it, and depending on it would run again on its own output.
    const run = () => {
      const ts = useTaskStore.getState()
      runReminders(useFinanceStore.getState().categories, ts.tasks, {
        addTask: ts.addTask, updateTask: ts.updateTask, deleteTask: ts.deleteTask,
      })
      // A budget with a day on it writes the entry itself, unpaid, rather than
      // a task about it. Read at call time for the same reason: this writes to
      // the ledger it is looking at.
      const fs = useFinanceStore.getState()
      // A load in flight means the list on hand is about to be replaced;
      // deciding what is missing from it now is deciding from stale data.
      if (fs.loading) return
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
  }, [user, categoryKey, financeLoading])

  const [assistantOpen, setAssistantOpen] = useState(false)
  // Put aside, not closed: the thread survives and the tab brings it back.
  const [assistantAside, setAssistantAside] = useState(false)
  // A dated task belongs on the calendar wherever it was given its date — the
  // Today screen, the palette, the planner — not only while the board is open.
  useTaskCalendarPush()
  // The seven rules in Settings → Automation run from here — a minute tick,
  // while signed in; the stop function goes with the session.
  useEffect(() => (user ? startAutomation() : undefined), [user])

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
      background: 'var(--sb-page)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      fontFamily: 'var(--sb-font-ui)',
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
        background: 'var(--sb-page)',
      }}>
        <TopNav />
        <SyncGapBanner />
        <main style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', background: 'var(--sb-page)' }}>
          <ActiveModule />
        </main>
      </div>
      <UndoBar />
      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
      <AssistantPanel
        open={assistantOpen}
        minimised={assistantAside}
        onMinimise={() => setAssistantAside(true)}
        onRestore={() => setAssistantAside(false)}
        onClose={() => { setAssistantOpen(false); setAssistantAside(false) }} />
      {/* While it is put aside the button is back in its "open me" state, so
          either the tab or the button brings it back. */}
      <AssistantToggle
        open={assistantOpen && !assistantAside}
        onClick={() => {
          if (assistantOpen && !assistantAside) { setAssistantOpen(false); return }
          setAssistantOpen(true)
          setAssistantAside(false)
        }} />
      {showWizard && <SetupWizard onClose={() => setShowWizard(false)} />}
    </div>
  )
}

export default App

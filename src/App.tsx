
import { useEffect, useState } from 'react'
import { Sidebar } from './components/layout/Sidebar'
import { PageShell } from './components/layout/PageShell'
import { ExecutiveDashboard } from './modules/dashboard/ExecutiveDashboard'
import { TaskCommand } from './modules/tasks/TaskCommand'
import { CalendarModule } from './modules/calendar/CalendarModule'
import { InboxModule } from './modules/inbox/InboxModule'
import { HabitsModule } from './modules/habits/HabitsModule'
import { ReviewModule } from './modules/review/ReviewModule'
import { MorningModule } from './modules/morning/MorningModule'
import { SettingsModule } from './modules/settings/SettingsModule'
import { useUIStore } from './store/uiStore'
import { useAuthStore } from './store/authStore'
import { supabase } from './lib/supabase'
import { signInWithGoogle } from './lib/google'
import { GraduationCap, Calendar, Mail, CheckSquare, Brain, ArrowRight } from 'lucide-react'

// ─── Feature pills shown on the login screen ──────────────────────────────────

const FEATURES = [
  { icon: Brain,       label: 'AI Meeting Prep'     },
  { icon: Mail,        label: 'Inbox Triage'         },
  { icon: Calendar,   label: 'Calendar Intelligence' },
  { icon: CheckSquare, label: 'Task Command'         },
]

// ─── Login screen ─────────────────────────────────────────────────────────────

function LoginScreen() {
  const [hovered, setHovered] = useState(false)
  const [signing, setSigning]   = useState(false)

  async function handleSignIn() {
    setSigning(true)
    try { await signInWithGoogle() } catch { setSigning(false) }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0D0F1A',
      display: 'flex',
      overflow: 'hidden',
      position: 'relative',
    }}>
      {/* Ambient glow blobs */}
      <div style={{
        position: 'absolute', top: '-20%', left: '-10%',
        width: 600, height: 600, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(124,58,237,0.08) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', bottom: '-10%', right: '-5%',
        width: 500, height: 500, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(127,119,221,0.06) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* Left panel — branding */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '60px 80px',
        position: 'relative',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 56 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            background: 'linear-gradient(135deg, #7C3AED 0%, #A78BFA 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 8px 24px rgba(124,58,237,0.35)',
          }}>
            <GraduationCap size={24} color="#0D0F1A" strokeWidth={2.5} />
          </div>
          <span style={{
            fontFamily: "'Cabinet Grotesk', sans-serif",
            fontWeight: 800, fontSize: 22, color: '#E8EAF6', letterSpacing: '-0.5px',
          }}>
            The Professor
          </span>
        </div>

        {/* Headline */}
        <div style={{ maxWidth: 520 }}>
          <h1 style={{
            margin: '0 0 20px',
            fontSize: 52, fontWeight: 900,
            fontFamily: "'Cabinet Grotesk', sans-serif",
            color: '#E8EAF6', letterSpacing: '-2px', lineHeight: 1.08,
          }}>
            Your AI Executive<br />
            <span style={{
              background: 'linear-gradient(135deg, #7C3AED 0%, #A78BFA 60%, #7C3AED 100%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>
              Operating System
            </span>
          </h1>
          <p style={{
            margin: '0 0 48px',
            fontSize: 17, color: '#6B7280', lineHeight: 1.7, maxWidth: 420,
          }}>
            Triage emails, prep for meetings, manage tasks, and track habits — all powered by AI and connected to your Google workspace.
          </p>

          {/* Feature pills */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 56 }}>
            {FEATURES.map(({ icon: Icon, label }) => (
              <div key={label} style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '8px 14px', borderRadius: 100,
                background: 'rgba(124,58,237,0.07)',
                border: '1px solid rgba(124,58,237,0.18)',
              }}>
                <Icon size={13} color="#7C3AED" />
                <span style={{ fontSize: 12.5, color: '#94A3B8', fontWeight: 500 }}>{label}</span>
              </div>
            ))}
          </div>

          {/* Sign in button */}
          <button
            onClick={() => void handleSignIn()}
            disabled={signing}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 12,
              padding: '15px 28px', borderRadius: 14,
              background: hovered
                ? 'rgba(124,58,237,0.18)'
                : 'rgba(124,58,237,0.10)',
              border: `1px solid ${hovered ? 'rgba(124,58,237,0.5)' : 'rgba(124,58,237,0.25)'}`,
              color: '#E8EAF6', fontSize: 15, fontWeight: 600, cursor: signing ? 'wait' : 'pointer',
              fontFamily: "'Cabinet Grotesk', sans-serif",
              transition: 'all 0.2s ease',
              transform: hovered ? 'translateY(-1px)' : 'none',
              boxShadow: hovered ? '0 8px 24px rgba(124,58,237,0.15)' : 'none',
              opacity: signing ? 0.7 : 1,
            }}
          >
            <svg width="20" height="20" viewBox="0 0 18 18">
              <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
              <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
              <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"/>
              <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 6.294C4.672 4.169 6.656 3.58 9 3.58z"/>
            </svg>
            {signing ? 'Redirecting…' : 'Continue with Google'}
            {!signing && <ArrowRight size={16} color="#7C3AED" />}
          </button>

          <p style={{ margin: '16px 0 0', fontSize: 12, color: '#374151' }}>
            Your data is isolated and encrypted. Only you can access it.
          </p>
        </div>
      </div>

      {/* Right panel — decorative dashboard preview */}
      <div style={{
        width: 440,
        background: 'rgba(255,255,255,0.018)',
        borderLeft: '1px solid rgba(124,58,237,0.1)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '48px 40px',
        gap: 14,
        position: 'relative',
      }}>
        <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '1.2px' }}>
          Live Preview
        </p>

        {/* Mock stat cards */}
        {[
          { label: 'Meetings today',     value: '4',          sub: '2h 45m scheduled',       color: '#7C3AED' },
          { label: 'Unread emails',      value: '12',         sub: '3 need decisions',        color: '#7F77DD' },
          { label: 'Tasks in progress',  value: '7',          sub: '2 due today',             color: '#1D9E75' },
          { label: 'Habit streak',       value: '14 days',    sub: 'Morning routine',         color: '#A78BFA' },
        ].map(card => (
          <div key={card.label} style={{
            padding: '16px 18px', borderRadius: 12,
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.06)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div>
              <p style={{ margin: '0 0 3px', fontSize: 11.5, color: '#64748B' }}>{card.label}</p>
              <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#E8EAF6', fontFamily: "'Cabinet Grotesk', sans-serif", letterSpacing: '-0.5px' }}>
                {card.value}
              </p>
              <p style={{ margin: '2px 0 0', fontSize: 11, color: '#64748B' }}>{card.sub}</p>
            </div>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: `${card.color}18`,
              border: `1px solid ${card.color}30`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: card.color, opacity: 0.85 }} />
            </div>
          </div>
        ))}

        {/* Mock email triage */}
        <div style={{
          padding: '16px 18px', borderRadius: 12,
          background: 'rgba(124,58,237,0.04)',
          border: '1px solid rgba(124,58,237,0.12)',
          marginTop: 4,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
            <Brain size={12} color="#7C3AED" />
            <span style={{ fontSize: 11, fontWeight: 600, color: '#7C3AED', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
              AI Triage
            </span>
          </div>
          {[
            { from: 'Sarah K.',    subject: 'Q4 Budget Review',    tag: 'Decision', tagColor: '#7C3AED' },
            { from: 'Dev Team',    subject: 'PR #247 merged',      tag: 'FYI',      tagColor: '#7F77DD' },
            { from: 'Alex M.',     subject: 'Client proposal',     tag: 'Urgent',   tagColor: '#E05252' },
          ].map(email => (
            <div key={email.subject} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.04)',
            }}>
              <div>
                <span style={{ fontSize: 12, color: '#94A3B8', fontWeight: 500 }}>{email.from}</span>
                <span style={{ fontSize: 11.5, color: '#64748B', marginLeft: 8 }}>{email.subject}</span>
              </div>
              <span style={{
                fontSize: 10, padding: '2px 7px', borderRadius: 4, fontWeight: 600,
                background: `${email.tagColor}18`, color: email.tagColor,
                border: `1px solid ${email.tagColor}30`,
              }}>
                {email.tag}
              </span>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}

// ─── Loading screen ────────────────────────────────────────────────────────────

function LoadingScreen() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: '#0D0F1A', gap: 16,
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: 11,
        background: 'linear-gradient(135deg, #7C3AED 0%, #A78BFA 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 8px 24px rgba(124,58,237,0.3)',
        animation: 'pulse 1.5s ease-in-out infinite',
      }}>
        <GraduationCap size={22} color="#0D0F1A" strokeWidth={2.5} />
      </div>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.7; transform: scale(0.95); }
        }
      `}</style>
    </div>
  )
}

// ─── Active module router ──────────────────────────────────────────────────────

function ActiveModule() {
  const activeModule = useUIStore(s => s.activeModule)
  switch (activeModule) {
    case 'dashboard':  return <ExecutiveDashboard />
    case 'tasks':      return <TaskCommand />
    case 'calendar':   return <CalendarModule />
    case 'inbox':      return <InboxModule />
    case 'habits':     return <HabitsModule />
    case 'review':     return <ReviewModule />
    case 'morning':    return <MorningModule />
    case 'settings':   return <SettingsModule />
    default:           return <ExecutiveDashboard />
  }
}

// ─── App ──────────────────────────────────────────────────────────────────────

function App() {
  const { setUser, setLoading, user, loading } = useAuthStore()

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user
      setUser(u ? { id: u.id, email: u.email ?? '', name: u.user_metadata?.full_name as string | undefined, avatarUrl: u.user_metadata?.avatar_url as string | undefined } : null)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user
      setUser(u ? { id: u.id, email: u.email ?? '', name: u.user_metadata?.full_name as string | undefined, avatarUrl: u.user_metadata?.avatar_url as string | undefined } : null)
      setLoading(false)
      if (session?.provider_token) {
        localStorage.setItem('google_provider_token', session.provider_token)
      } else if (!session) {
        localStorage.removeItem('google_provider_token')
      }
    })

    return () => subscription.unsubscribe()
  }, [setUser, setLoading])

  if (loading) return <LoadingScreen />
  if (!user)   return <LoginScreen />

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0D0F1A' }}>
      <Sidebar />
      <PageShell>
        <ActiveModule />
      </PageShell>
    </div>
  )
}

export default App

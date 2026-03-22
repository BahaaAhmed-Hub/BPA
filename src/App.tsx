
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
        background: 'radial-gradient(circle, rgba(30,64,175,0.08) 0%, transparent 70%)',
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
            background: 'linear-gradient(135deg, #1E40AF 0%, #60A5FA 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 8px 24px rgba(30,64,175,0.35)',
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
              background: 'linear-gradient(135deg, #1E40AF 0%, #60A5FA 60%, #1E40AF 100%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>
              Operating System
            </span>
          </h1>
          <p style={{
            margin: '0 0 48px',
            fontSize: 17, color: '#FFFFFF', lineHeight: 1.7, maxWidth: 420,
          }}>
            Triage emails, prep for meetings, manage tasks, and track habits — all powered by AI and connected to your Google workspace.
          </p>

          {/* Feature pills */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 56 }}>
            {FEATURES.map(({ icon: Icon, label }) => (
              <div key={label} style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '8px 14px', borderRadius: 100,
                background: 'rgba(30,64,175,0.07)',
                border: '1px solid rgba(30,64,175,0.18)',
              }}>
                <Icon size={13} color="#1E40AF" />
                <span style={{ fontSize: 12.5, color: '#FFFFFF', fontWeight: 500 }}>{label}</span>
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
                ? 'rgba(30,64,175,0.18)'
                : 'rgba(30,64,175,0.10)',
              border: `1px solid ${hovered ? 'rgba(30,64,175,0.5)' : 'rgba(30,64,175,0.25)'}`,
              color: '#E8EAF6', fontSize: 15, fontWeight: 600, cursor: signing ? 'wait' : 'pointer',
              fontFamily: "'Cabinet Grotesk', sans-serif",
              transition: 'all 0.2s ease',
              transform: hovered ? 'translateY(-1px)' : 'none',
              boxShadow: hovered ? '0 8px 24px rgba(30,64,175,0.15)' : 'none',
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
            {!signing && <ArrowRight size={16} color="#1E40AF" />}
          </button>

          <p style={{ margin: '16px 0 0', fontSize: 12, color: '#FFFFFF' }}>
            Your data is isolated and encrypted. Only you can access it.
          </p>
        </div>
      </div>

      {/* Right panel — SVG illustration */}
      <div style={{
        width: 440,
        background: 'rgba(255,255,255,0.018)',
        borderLeft: '1px solid rgba(30,64,175,0.15)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 40px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Ambient glow behind SVG */}
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 340, height: 340, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(30,64,175,0.12) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />

        <svg viewBox="0 0 360 400" fill="none" xmlns="http://www.w3.org/2000/svg"
          style={{ width: '100%', maxWidth: 360, position: 'relative', zIndex: 1 }}>
          <defs>
            <linearGradient id="gBlue" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#3B82F6" />
              <stop offset="100%" stopColor="#1E40AF" />
            </linearGradient>
            <linearGradient id="gTeal" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#34D399" />
              <stop offset="100%" stopColor="#059669" />
            </linearGradient>
            <linearGradient id="gIndigo" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#818CF8" />
              <stop offset="100%" stopColor="#4F46E5" />
            </linearGradient>
            <linearGradient id="gOrange" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#FB923C" />
              <stop offset="100%" stopColor="#EA580C" />
            </linearGradient>
          </defs>

          {/* ── Central AI Brain ── */}
          <circle cx="180" cy="180" r="56" fill="url(#gBlue)" opacity="0.15" />
          <circle cx="180" cy="180" r="44" fill="url(#gBlue)" opacity="0.18" />
          <circle cx="180" cy="180" r="32" fill="url(#gBlue)" opacity="0.9" />
          {/* Brain icon paths */}
          <g transform="translate(163, 163)">
            <path d="M17 8.5C17 5.46 14.54 3 11.5 3C10.24 3 9.09 3.45 8.2 4.2C7.48 3.46 6.49 3 5.39 3C3.52 3 1.96 4.27 1.5 6C0.62 6.34 0 7.18 0 8.17C0 8.9 0.32 9.56 0.83 10.02C0.31 10.48 0 11.16 0 11.92C0 13.07 0.75 14.04 1.79 14.38C1.94 16.37 3.59 17.94 5.61 18H8V22H9V18H11V22H12V18H12.39C14.41 18 16.07 16.43 16.21 14.43C17.25 14.1 18 13.12 18 11.96C18 11.21 17.69 10.54 17.18 10.08C17.71 9.62 18 8.97 18 8.27L17 8.5Z" fill="white" fillOpacity="0.9" />
          </g>

          {/* ── Orbit ring ── */}
          <circle cx="180" cy="180" r="80" stroke="rgba(59,130,246,0.2)" strokeWidth="1" strokeDasharray="4 6" />
          <circle cx="180" cy="180" r="110" stroke="rgba(59,130,246,0.1)" strokeWidth="1" strokeDasharray="2 8" />

          {/* ── Satellite nodes ── */}
          {/* Calendar - top */}
          <circle cx="180" cy="100" r="22" fill="#161929" stroke="rgba(59,130,246,0.4)" strokeWidth="1.5" />
          <rect x="171" y="108" width="18" height="14" rx="2" fill="none" stroke="#3B82F6" strokeWidth="1.4" />
          <line x1="171" y1="113" x2="189" y2="113" stroke="#3B82F6" strokeWidth="1.2" />
          <rect x="174" y="116" width="3" height="3" rx="0.5" fill="#3B82F6" />
          <rect x="179" y="116" width="3" height="3" rx="0.5" fill="#3B82F6" />
          <rect x="184" y="116" width="3" height="3" rx="0.5" fill="#60A5FA" opacity="0.5" />
          <line x1="175" y1="108" x2="175" y2="105" stroke="#3B82F6" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="185" y1="108" x2="185" y2="105" stroke="#3B82F6" strokeWidth="1.5" strokeLinecap="round" />
          <text x="180" y="97" textAnchor="middle" fontSize="8" fill="#60A5FA" fontFamily="DM Sans">Calendar</text>

          {/* Inbox - right */}
          <circle cx="260" cy="180" r="22" fill="#161929" stroke="rgba(129,140,248,0.4)" strokeWidth="1.5" />
          <rect x="251" y="173" width="18" height="13" rx="2" fill="none" stroke="#818CF8" strokeWidth="1.4" />
          <polyline points="251,174 260,181 269,174" fill="none" stroke="#818CF8" strokeWidth="1.2" />
          <text x="260" y="210" textAnchor="middle" fontSize="8" fill="#818CF8" fontFamily="DM Sans">Inbox</text>

          {/* Habits - bottom */}
          <circle cx="180" cy="260" r="22" fill="#161929" stroke="rgba(52,211,153,0.4)" strokeWidth="1.5" />
          <circle cx="180" cy="260" r="10" fill="none" stroke="#34D399" strokeWidth="1.4" strokeDasharray="3 2" />
          <circle cx="180" cy="260" r="5" fill="#34D399" opacity="0.8" />
          <text x="180" y="292" textAnchor="middle" fontSize="8" fill="#34D399" fontFamily="DM Sans">Habits</text>

          {/* Tasks - left */}
          <circle cx="100" cy="180" r="22" fill="#161929" stroke="rgba(251,146,60,0.4)" strokeWidth="1.5" />
          <line x1="93" y1="175" x2="107" y2="175" stroke="#FB923C" strokeWidth="1.3" strokeLinecap="round" />
          <line x1="93" y1="180" x2="107" y2="180" stroke="#FB923C" strokeWidth="1.3" strokeLinecap="round" />
          <line x1="93" y1="185" x2="102" y2="185" stroke="#FB923C" strokeWidth="1.3" strokeLinecap="round" opacity="0.5" />
          <polyline points="90,173 93,176 99,170" fill="none" stroke="#34D399" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          <text x="100" y="210" textAnchor="middle" fontSize="8" fill="#FB923C" fontFamily="DM Sans">Tasks</text>

          {/* ── Connector lines from center to nodes ── */}
          <line x1="180" y1="148" x2="180" y2="122" stroke="rgba(59,130,246,0.3)" strokeWidth="1" />
          <line x1="212" y1="168" x2="238" y2="180" stroke="rgba(129,140,248,0.3)" strokeWidth="1" />
          <line x1="180" y1="212" x2="180" y2="238" stroke="rgba(52,211,153,0.3)" strokeWidth="1" />
          <line x1="148" y1="180" x2="122" y2="180" stroke="rgba(251,146,60,0.3)" strokeWidth="1" />

          {/* ── Floating data pills ── */}
          {/* Pill 1 - top right */}
          <rect x="218" y="118" width="96" height="24" rx="12" fill="rgba(59,130,246,0.1)" stroke="rgba(59,130,246,0.25)" strokeWidth="1" />
          <circle cx="230" cy="130" r="5" fill="#3B82F6" opacity="0.9" />
          <text x="240" y="134" fontSize="9.5" fill="white" fontFamily="DM Sans" fontWeight="500">AI Meeting Prep</text>

          {/* Pill 2 - bottom right */}
          <rect x="218" y="248" width="90" height="24" rx="12" fill="rgba(52,211,153,0.1)" stroke="rgba(52,211,153,0.25)" strokeWidth="1" />
          <circle cx="230" cy="260" r="5" fill="#34D399" opacity="0.9" />
          <text x="240" y="264" fontSize="9.5" fill="white" fontFamily="DM Sans" fontWeight="500">Streak: 14 days</text>

          {/* Pill 3 - top left */}
          <rect x="46" y="118" width="86" height="24" rx="12" fill="rgba(251,146,60,0.1)" stroke="rgba(251,146,60,0.25)" strokeWidth="1" />
          <circle cx="58" cy="130" r="5" fill="#FB923C" opacity="0.9" />
          <text x="68" y="134" fontSize="9.5" fill="white" fontFamily="DM Sans" fontWeight="500">7 Tasks Due</text>

          {/* Pill 4 - bottom left */}
          <rect x="46" y="248" width="90" height="24" rx="12" fill="rgba(129,140,248,0.1)" stroke="rgba(129,140,248,0.25)" strokeWidth="1" />
          <circle cx="58" cy="260" r="5" fill="#818CF8" opacity="0.9" />
          <text x="68" y="264" fontSize="9.5" fill="white" fontFamily="DM Sans" fontWeight="500">12 Emails AI'd</text>

          {/* ── Bottom tagline ── */}
          <text x="180" y="355" textAnchor="middle" fontSize="12" fill="rgba(255,255,255,0.35)" fontFamily="DM Sans" letterSpacing="0.5">
            One AI. Every workflow.
          </text>
        </svg>
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
        background: 'linear-gradient(135deg, #1E40AF 0%, #60A5FA 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 8px 24px rgba(30,64,175,0.3)',
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

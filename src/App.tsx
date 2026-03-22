
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

      {/* Right panel — Power illustration */}
      <div style={{
        flex: '0 0 480px',
        background: 'linear-gradient(160deg, rgba(30,64,175,0.08) 0%, rgba(13,15,26,0) 60%)',
        borderLeft: '1px solid rgba(59,130,246,0.18)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden',
        minHeight: '100vh',
      }}>
        {/* Multi-layer ambient glow */}
        <div style={{ position:'absolute', top:'20%', left:'50%', transform:'translate(-50%,-50%)', width:500, height:500, borderRadius:'50%', background:'radial-gradient(circle, rgba(59,130,246,0.13) 0%, transparent 65%)', pointerEvents:'none' }} />
        <div style={{ position:'absolute', bottom:'15%', left:'30%', width:300, height:300, borderRadius:'50%', background:'radial-gradient(circle, rgba(52,211,153,0.08) 0%, transparent 65%)', pointerEvents:'none' }} />
        <div style={{ position:'absolute', top:'50%', right:'10%', width:200, height:200, borderRadius:'50%', background:'radial-gradient(circle, rgba(251,146,60,0.07) 0%, transparent 65%)', pointerEvents:'none' }} />

        <svg viewBox="0 0 440 580" fill="none" xmlns="http://www.w3.org/2000/svg"
          style={{ width:'100%', height:'100%', maxHeight:'100vh', position:'relative', zIndex:1 }}>
          <defs>
            <linearGradient id="gCore" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#60A5FA" />
              <stop offset="100%" stopColor="#1D4ED8" />
            </linearGradient>
            <linearGradient id="gTeal" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#6EE7B7" />
              <stop offset="100%" stopColor="#059669" />
            </linearGradient>
            <linearGradient id="gAmber" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#FCD34D" />
              <stop offset="100%" stopColor="#F59E0B" />
            </linearGradient>
            <linearGradient id="gRose" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#FDA4AF" />
              <stop offset="100%" stopColor="#E11D48" />
            </linearGradient>
            <linearGradient id="gIndigo" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#A5B4FC" />
              <stop offset="100%" stopColor="#4338CA" />
            </linearGradient>
            <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#1E40AF" stopOpacity="0" />
            </radialGradient>
            <filter id="blur1"><feGaussianBlur stdDeviation="8" /></filter>
            <filter id="blur2"><feGaussianBlur stdDeviation="3" /></filter>
          </defs>

          {/* ── Deep glow behind core ── */}
          <circle cx="220" cy="240" r="120" fill="url(#coreGlow)" filter="url(#blur1)" />
          <circle cx="220" cy="240" r="80"  fill="rgba(59,130,246,0.12)" filter="url(#blur2)" />

          {/* ── Rotating orbit rings ── */}
          <circle cx="220" cy="240" r="130" stroke="rgba(59,130,246,0.18)" strokeWidth="1.5" strokeDasharray="6 9"  style={{ transformOrigin:'220px 240px', animation:'spin 22s linear infinite' }} />
          <circle cx="220" cy="240" r="100" stroke="rgba(99,102,241,0.15)"  strokeWidth="1"   strokeDasharray="3 12" style={{ transformOrigin:'220px 240px', animation:'spinR 16s linear infinite' }} />
          <circle cx="220" cy="240" r="160" stroke="rgba(52,211,153,0.10)"  strokeWidth="1"   strokeDasharray="2 14" style={{ transformOrigin:'220px 240px', animation:'spin 30s linear infinite' }} />

          {/* ── Connector beams (center → satellites) ── */}
          <line x1="220" y1="195" x2="220" y2="115"  stroke="url(#gCore)"  strokeWidth="1.5" opacity="0.4" />
          <line x1="260" y1="215" x2="326" y2="162"  stroke="url(#gIndigo)" strokeWidth="1.5" opacity="0.4" />
          <line x1="265" y1="255" x2="336" y2="310"  stroke="url(#gTeal)"  strokeWidth="1.5" opacity="0.4" />
          <line x1="220" y1="285" x2="220" y2="355"  stroke="url(#gAmber)" strokeWidth="1.5" opacity="0.4" />
          <line x1="175" y1="255" x2="104" y2="310"  stroke="url(#gRose)"  strokeWidth="1.5" opacity="0.4" />
          <line x1="180" y1="215" x2="114" y2="162"  stroke="url(#gCore)"  strokeWidth="1.5" opacity="0.4" />

          {/* ── Central AI Core ── */}
          <circle cx="220" cy="240" r="58" fill="rgba(30,58,138,0.6)" stroke="rgba(96,165,250,0.6)" strokeWidth="2" />
          <circle cx="220" cy="240" r="46" fill="rgba(29,78,216,0.8)" stroke="rgba(147,197,253,0.3)" strokeWidth="1" style={{ animation:'pulse 3s ease-in-out infinite' }} />
          {/* AI lightning bolt — power symbol */}
          <polygon points="224,218 214,242 222,242 216,262 230,236 221,236" fill="white" opacity="0.95" />
          {/* Inner glow ring */}
          <circle cx="220" cy="240" r="58" fill="none" stroke="rgba(147,197,253,0.25)" strokeWidth="8" style={{ animation:'pulse 3s ease-in-out infinite' }} />

          {/* ══ Satellite: Calendar (top) ══ */}
          <circle cx="220" cy="100" r="30" fill="rgba(14,20,50,0.95)" stroke="rgba(96,165,250,0.7)" strokeWidth="2" style={{ animation:'floatY 4s ease-in-out infinite' }} />
          <rect x="209" y="110" width="22" height="17" rx="3" fill="none" stroke="#60A5FA" strokeWidth="1.8" />
          <line x1="209" y1="116" x2="231" y2="116" stroke="#60A5FA" strokeWidth="1.4" />
          <rect x="212" y="119" width="4" height="4" rx="1" fill="#60A5FA" />
          <rect x="218" y="119" width="4" height="4" rx="1" fill="#60A5FA" />
          <rect x="224" y="119" width="4" height="4" rx="1" fill="#93C5FD" opacity="0.5" />
          <line x1="213" y1="110" x2="213" y2="106" stroke="#60A5FA" strokeWidth="2" strokeLinecap="round" />
          <line x1="227" y1="110" x2="227" y2="106" stroke="#60A5FA" strokeWidth="2" strokeLinecap="round" />
          <text x="220" y="93" textAnchor="middle" fontSize="10" fontWeight="700" fill="#93C5FD" fontFamily="DM Sans" letterSpacing="0.5">CALENDAR</text>

          {/* ══ Satellite: Inbox (top-right) ══ */}
          <circle cx="340" cy="155" r="28" fill="rgba(14,20,50,0.95)" stroke="rgba(165,180,252,0.7)" strokeWidth="2" style={{ animation:'floatY 5s ease-in-out infinite 0.5s' }} />
          <rect x="329" y="147" width="22" height="16" rx="3" fill="none" stroke="#A5B4FC" strokeWidth="1.8" />
          <polyline points="329,148 340,157 351,148" fill="none" stroke="#A5B4FC" strokeWidth="1.6" />
          <text x="340" y="143" textAnchor="middle" fontSize="10" fontWeight="700" fill="#C7D2FE" fontFamily="DM Sans" letterSpacing="0.5">INBOX</text>
          <text x="340" y="194" textAnchor="middle" fontSize="9" fill="rgba(165,180,252,0.6)" fontFamily="DM Sans">12 triaged by AI</text>

          {/* ══ Satellite: Habits (bottom-right) ══ */}
          <circle cx="340" cy="325" r="28" fill="rgba(14,20,50,0.95)" stroke="rgba(110,231,183,0.7)" strokeWidth="2" style={{ animation:'floatY 4.5s ease-in-out infinite 1s' }} />
          <circle cx="340" cy="325" r="13" fill="none" stroke="#6EE7B7" strokeWidth="1.8" strokeDasharray="4 3" />
          <circle cx="340" cy="325" r="6"  fill="#34D399" opacity="0.9" style={{ animation:'pulse 2.5s ease-in-out infinite' }} />
          <text x="340" y="313" textAnchor="middle" fontSize="10" fontWeight="700" fill="#6EE7B7" fontFamily="DM Sans" letterSpacing="0.5">HABITS</text>
          <text x="340" y="364" textAnchor="middle" fontSize="9" fill="rgba(110,231,183,0.6)" fontFamily="DM Sans">🔥 14-day streak</text>

          {/* ══ Satellite: Tasks (bottom) ══ */}
          <circle cx="220" cy="375" r="30" fill="rgba(14,20,50,0.95)" stroke="rgba(253,211,77,0.7)" strokeWidth="2" style={{ animation:'floatY 3.8s ease-in-out infinite 0.8s' }} />
          <line x1="210" y1="370" x2="230" y2="370" stroke="#FCD34D" strokeWidth="1.8" strokeLinecap="round" />
          <line x1="210" y1="376" x2="230" y2="376" strokeWidth="1.8" strokeLinecap="round" stroke="#FCD34D" />
          <line x1="210" y1="382" x2="222" y2="382" stroke="#FCD34D" strokeWidth="1.8" strokeLinecap="round" opacity="0.5" />
          <polyline points="207,367 210,371 217,364" fill="none" stroke="#6EE7B7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <text x="220" y="363" textAnchor="middle" fontSize="10" fontWeight="700" fill="#FDE68A" fontFamily="DM Sans" letterSpacing="0.5">TASKS</text>
          <text x="220" y="415" textAnchor="middle" fontSize="9" fill="rgba(253,211,77,0.6)" fontFamily="DM Sans">7 done today</text>

          {/* ══ Satellite: Review (bottom-left) ══ */}
          <circle cx="100" cy="325" r="28" fill="rgba(14,20,50,0.95)" stroke="rgba(253,164,175,0.7)" strokeWidth="2" style={{ animation:'floatY 4.2s ease-in-out infinite 1.5s' }} />
          <path d="M91 325 A9 9 0 1 1 109 325" fill="none" stroke="#FDA4AF" strokeWidth="1.8" strokeLinecap="round" />
          <polyline points="109,320 109,325 114,325" fill="none" stroke="#FDA4AF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <text x="100" y="313" textAnchor="middle" fontSize="10" fontWeight="700" fill="#FECDD3" fontFamily="DM Sans" letterSpacing="0.5">REVIEW</text>
          <text x="100" y="364" textAnchor="middle" fontSize="9" fill="rgba(253,164,175,0.6)" fontFamily="DM Sans">Weekly insights</text>

          {/* ══ Satellite: Morning Brief (top-left) ══ */}
          <circle cx="100" cy="155" r="28" fill="rgba(14,20,50,0.95)" stroke="rgba(253,211,77,0.5)" strokeWidth="2" style={{ animation:'floatY 5s ease-in-out infinite 2s' }} />
          {/* Sun rays */}
          <circle cx="100" cy="155" r="7" fill="#FCD34D" opacity="0.9" />
          <line x1="100" y1="143" x2="100" y2="140" stroke="#FCD34D" strokeWidth="2" strokeLinecap="round" />
          <line x1="100" y1="167" x2="100" y2="170" stroke="#FCD34D" strokeWidth="2" strokeLinecap="round" />
          <line x1="88"  y1="155" x2="85"  y2="155" stroke="#FCD34D" strokeWidth="2" strokeLinecap="round" />
          <line x1="112" y1="155" x2="115" y2="155" stroke="#FCD34D" strokeWidth="2" strokeLinecap="round" />
          <line x1="92"  y1="147" x2="90"  y2="145" stroke="#FCD34D" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="108" y1="163" x2="110" y2="165" stroke="#FCD34D" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="108" y1="147" x2="110" y2="145" stroke="#FCD34D" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="92"  y1="163" x2="90"  y2="165" stroke="#FCD34D" strokeWidth="1.5" strokeLinecap="round" />
          <text x="100" y="143" textAnchor="middle" fontSize="9" fontWeight="700" fill="#FDE68A" fontFamily="DM Sans" letterSpacing="0.3">MORNING</text>
          <text x="100" y="194" textAnchor="middle" fontSize="9" fill="rgba(253,211,77,0.6)" fontFamily="DM Sans">Daily briefing</text>

          {/* ── Floating spark particles ── */}
          <circle cx="170" cy="160" r="2.5" fill="#60A5FA" opacity="0.7" style={{ animation:'spark 3s ease-in-out infinite' }} />
          <circle cx="275" cy="195" r="2"   fill="#A5B4FC" opacity="0.6" style={{ animation:'spark 4s ease-in-out infinite 1s' }} />
          <circle cx="260" cy="290" r="2.5" fill="#6EE7B7" opacity="0.7" style={{ animation:'spark 3.5s ease-in-out infinite 0.5s' }} />
          <circle cx="170" cy="295" r="2"   fill="#FDA4AF" opacity="0.6" style={{ animation:'spark 4.5s ease-in-out infinite 1.5s' }} />
          <circle cx="300" cy="240" r="1.8" fill="#FCD34D" opacity="0.5" style={{ animation:'spark 2.8s ease-in-out infinite 0.8s' }} />
          <circle cx="140" cy="240" r="1.8" fill="#60A5FA" opacity="0.5" style={{ animation:'spark 3.2s ease-in-out infinite 1.2s' }} />

          {/* ── Bottom power tagline ── */}
          <text x="220" y="500" textAnchor="middle" fontSize="18" fontWeight="800" fill="white" fontFamily="Cabinet Grotesk" letterSpacing="-0.5" opacity="0.92">
            One AI. Total Command.
          </text>
          <text x="220" y="522" textAnchor="middle" fontSize="11" fill="rgba(147,197,253,0.55)" fontFamily="DM Sans" letterSpacing="0.3">
            Every workflow. Every day. Amplified.
          </text>
        </svg>
      </div>

      <style>{`
        @keyframes spin  { from { transform: rotate(0deg);   } to { transform: rotate(360deg);  } }
        @keyframes spinR { from { transform: rotate(0deg);   } to { transform: rotate(-360deg); } }
        @keyframes pulse {
          0%, 100% { opacity: 1;   transform: scale(1);    }
          50%       { opacity: 0.6; transform: scale(0.93); }
        }
        @keyframes floatY {
          0%, 100% { transform: translateY(0px);  }
          50%       { transform: translateY(-8px); }
        }
        @keyframes spark {
          0%, 100% { opacity: 0.2; transform: scale(0.8); }
          50%       { opacity: 1;   transform: scale(1.4); }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0);    }
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

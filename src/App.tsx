import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AssistantPanel, AssistantToggle } from './modules/assistant/AssistantPanel'
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
import { BehavioralOS } from './modules/behavioral/BehavioralOS'
import { PlanningAssistant } from './modules/planning/PlanningAssistant'
import { useUIStore } from './store/uiStore'
import { useAuthStore } from './store/authStore'
import { useTaskStore } from './store/taskStore'
import { useHabitsStore } from './store/habitsStore'
import { useBehavioralStore } from './store/behavioralStore'
import { supabase } from './lib/supabase'
import { signInWithGoogle, getPendingAddAccount, clearPendingAddAccount } from './lib/google'
import { addAccount, loadAccounts, saveAccounts } from './lib/multiAccount'
import { saveAccountsToDB, loadCompaniesFromDB, loadRawSettingsFromDB, loadAccountsFromDB } from './lib/dbSync'
import { seedToken, seedFromLocalStorage, clearAllTokens, getGoogleToken } from './lib/tokenManager'
import { refreshPrimaryToken } from './lib/googleCalendar'
import { getTheme, applyThemeVars } from './lib/themes'
import { GraduationCap, Calendar, Mail, CheckSquare, Brain, ArrowRight } from 'lucide-react'
import { SetupWizard } from './modules/wizard/SetupWizard'

// ─── Mode-specific login themes ──────────────────────────────────────────────

interface LoginTheme {
  bg: string; surface: string
  accent: string; accentBright: string
  text: string; textDim: string; textMuted: string
  glow1: string; glow2: string; border: string
  headline: string; sub: string; tagline: string
  badge: string | null; available: boolean
  btnText: string; btnBorder: string; btnBg: string; btnBgHover: string
}

const LOGIN_MODES: Record<string, LoginTheme> = {
  default: {
    bg: '#0D0F1A', surface: 'rgba(14,28,72,0.92)',
    accent: '#1E40AF', accentBright: '#60A5FA',
    text: '#E8EAF6', textDim: '#94A3B8', textMuted: 'rgba(255,255,255,0.5)',
    glow1: 'rgba(30,64,175,0.08)', glow2: 'rgba(127,119,221,0.06)',
    border: 'rgba(30,64,175,0.25)',
    headline: 'Your AI Executive', sub: 'Operating System',
    tagline: 'Triage emails, prep for meetings, manage tasks, and track habits — all powered by AI.',
    badge: null, available: true,
    btnText: '#E8EAF6', btnBorder: 'rgba(30,64,175,0.3)',
    btnBg: 'rgba(30,64,175,0.10)', btnBgHover: 'rgba(30,64,175,0.2)',
  },
  samurai: {
    bg: '#0A0804', surface: 'rgba(19,18,16,0.96)',
    accent: '#8B1A1A', accentBright: '#C0392B',
    text: '#EDE4D3', textDim: '#7A6E5E', textMuted: 'rgba(237,228,211,0.4)',
    glow1: 'rgba(139,26,26,0.10)', glow2: 'rgba(139,26,26,0.05)',
    border: 'rgba(139,26,26,0.3)',
    headline: 'Discipline.', sub: 'Precision. Mastery.',
    tagline: 'Walk the path. Execute without hesitation. Rise.',
    badge: 'SAMURAI MODE', available: true,
    btnText: '#EDE4D3', btnBorder: 'rgba(139,26,26,0.5)',
    btnBg: 'rgba(139,26,26,0.12)', btnBgHover: 'rgba(139,26,26,0.22)',
  },
  pharaoh: {
    bg: '#090700', surface: 'rgba(20,16,5,0.96)',
    accent: '#C9A227', accentBright: '#F5D060',
    text: '#F5E6C8', textDim: '#9B8B6A', textMuted: 'rgba(245,230,200,0.4)',
    glow1: 'rgba(201,162,39,0.09)', glow2: 'rgba(201,162,39,0.04)',
    border: 'rgba(201,162,39,0.3)',
    headline: 'Build Your', sub: 'Legacy.',
    tagline: 'Your empire begins with systems. Command time. Shape history.',
    badge: 'PHARAOH MODE', available: false,
    btnText: '#F5E6C8', btnBorder: 'rgba(201,162,39,0.4)',
    btnBg: 'rgba(201,162,39,0.08)', btnBgHover: 'rgba(201,162,39,0.16)',
  },
  astral: {
    bg: '#04020E', surface: 'rgba(8,5,22,0.97)',
    accent: '#7C3AED', accentBright: '#A78BFA',
    text: '#EDE9FE', textDim: '#8B83C4', textMuted: 'rgba(237,233,254,0.4)',
    glow1: 'rgba(124,58,237,0.08)', glow2: 'rgba(45,212,191,0.05)',
    border: 'rgba(124,58,237,0.3)',
    headline: 'Think in', sub: 'Horizons.',
    tagline: 'Clarity at the cosmic scale. Operate from vision, not reaction.',
    badge: 'ASTRAL MODE', available: false,
    btnText: '#EDE9FE', btnBorder: 'rgba(124,58,237,0.4)',
    btnBg: 'rgba(124,58,237,0.10)', btnBgHover: 'rgba(124,58,237,0.20)',
  },
}

const FEATURES = [
  { icon: Brain,       label: 'AI Meeting Prep'      },
  { icon: Mail,        label: 'Inbox Triage'          },
  { icon: Calendar,    label: 'Calendar Intelligence' },
  { icon: CheckSquare, label: 'Task Command'          },
]

const MODE_PHOTOS: Record<string, string> = {
  default: 'https://images.unsplash.com/photo-1580851977566-8a01e4b1e3a8?auto=format&fit=crop&w=900&q=85',
  samurai: 'https://images.unsplash.com/photo-1580851977566-8a01e4b1e3a8?auto=format&fit=crop&w=900&q=85',
  pharaoh: 'https://images.unsplash.com/photo-1539650116574-8efeb43e2750?auto=format&fit=crop&w=900&q=85',
  astral:  'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?auto=format&fit=crop&w=900&q=85',
}

const MODE_QUOTES: Record<string, string> = {
  default: 'Stay ahead. Stay organized.',
  samurai: '七転び八起き — Fall seven times. Rise eight.',
  pharaoh: 'Eternal systems outlast their builders.',
  astral:  'Operate from the longest timeline.',
}

// ─── Background art layers ────────────────────────────────────────────────────

function BgDefault({ T }: { T: LoginTheme }) {
  return (
    <>
      <div style={{ position:'absolute', top:'-20%', left:'-10%', width:600, height:600, borderRadius:'50%', background:`radial-gradient(circle, ${T.glow1} 0%, transparent 70%)`, pointerEvents:'none' }} />
      <div style={{ position:'absolute', bottom:'-10%', right:'-5%', width:500, height:500, borderRadius:'50%', background:`radial-gradient(circle, ${T.glow2} 0%, transparent 70%)`, pointerEvents:'none' }} />
    </>
  )
}

function BgSamurai({ T }: { T: LoginTheme }) {
  return (
    <>
      {/* Crimson glow at bottom */}
      <div style={{ position:'absolute', bottom:0, left:'50%', transform:'translateX(-50%)', width:'80%', height:300, background:`radial-gradient(ellipse at bottom, ${T.glow1} 0%, transparent 70%)`, pointerEvents:'none' }} />
      {/* Top-left ink splatter */}
      <svg style={{ position:'absolute', top:0, left:0, opacity:0.07, pointerEvents:'none' }} width="420" height="380" viewBox="0 0 420 380" fill="none">
        <path d="M0,0 Q60,40 30,120 Q10,180 80,200 Q120,220 60,280 Q20,320 0,380 Z" fill={T.accent}/>
        <path d="M0,0 Q80,20 100,80 Q130,140 70,160 Q30,175 50,240 Q70,290 0,320 Z" fill={T.accentBright} opacity="0.5"/>
      </svg>
      {/* Mountain silhouette at bottom */}
      <svg style={{ position:'absolute', bottom:0, left:0, width:'100%', pointerEvents:'none' }} viewBox="0 0 1200 180" preserveAspectRatio="none" fill="none">
        <path d="M0,180 L0,120 Q150,30 280,90 Q380,140 450,60 Q530,-10 620,80 Q700,150 780,50 Q860,-30 940,70 Q1020,150 1100,40 L1200,30 L1200,180 Z" fill="#0D0B07" opacity="0.9"/>
        <path d="M0,180 L0,140 Q100,80 200,120 Q300,155 380,90 Q460,40 540,110 Q620,170 700,100 Q780,50 860,120 Q940,170 1020,90 Q1100,30 1200,80 L1200,180 Z" fill="#110E0A" opacity="0.95"/>
      </svg>
      {/* Ink brush horizontal strokes */}
      <svg style={{ position:'absolute', top:'35%', right:0, opacity:0.04, pointerEvents:'none' }} width="300" height="200" viewBox="0 0 300 200">
        <path d="M300,30 Q200,20 100,40 Q50,50 10,35" stroke={T.accent} strokeWidth="18" strokeLinecap="round" fill="none"/>
        <path d="M300,80 Q220,65 140,85 Q80,95 20,75" stroke={T.accent} strokeWidth="12" strokeLinecap="round" fill="none"/>
        <path d="M300,130 Q240,115 170,135 Q100,148 30,130" stroke={T.accent} strokeWidth="8" strokeLinecap="round" fill="none"/>
      </svg>
    </>
  )
}

function BgPharaoh({ T }: { T: LoginTheme }) {
  return (
    <>
      {/* Gold horizon glow */}
      <div style={{ position:'absolute', bottom:0, left:'50%', transform:'translateX(-50%)', width:'90%', height:350, background:`radial-gradient(ellipse at bottom, rgba(201,162,39,0.12) 0%, transparent 65%)`, pointerEvents:'none' }} />
      {/* Star field */}
      {Array.from({ length: 80 }).map((_, i) => (
        <div key={i} style={{
          position:'absolute',
          left:`${(i * 37 + i * 13) % 100}%`,
          top:`${(i * 31 + i * 7) % 65}%`,
          width: i % 5 === 0 ? 2 : 1,
          height: i % 5 === 0 ? 2 : 1,
          borderRadius:'50%',
          background: i % 7 === 0 ? T.accentBright : 'rgba(245,230,200,0.6)',
          animation: `starTwinkle ${1.5 + (i % 3) * 0.7}s ease-in-out infinite ${(i % 5) * 0.4}s`,
          pointerEvents:'none',
        }} />
      ))}
      {/* Desert horizon line */}
      <svg style={{ position:'absolute', bottom:0, left:0, width:'100%', pointerEvents:'none' }} viewBox="0 0 1200 120" preserveAspectRatio="none" fill="none">
        <path d="M0,120 L0,80 Q200,60 350,70 Q500,80 600,65 Q750,50 900,72 Q1050,88 1200,70 L1200,120 Z" fill="#0E0A02" opacity="0.97"/>
      </svg>
    </>
  )
}

function BgAstral({ T }: { T: LoginTheme }) {
  return (
    <>
      {/* Nebula blobs */}
      <div style={{ position:'absolute', top:'10%', left:'20%', width:500, height:400, borderRadius:'60% 40% 70% 30%', background:`radial-gradient(ellipse, rgba(124,58,237,0.08) 0%, transparent 70%)`, pointerEvents:'none' }} />
      <div style={{ position:'absolute', bottom:'20%', right:'15%', width:400, height:350, borderRadius:'40% 60% 30% 70%', background:`radial-gradient(ellipse, rgba(45,212,191,0.05) 0%, transparent 70%)`, pointerEvents:'none' }} />
      <div style={{ position:'absolute', top:'40%', right:'30%', width:300, height:300, borderRadius:'50%', background:`radial-gradient(ellipse, rgba(251,113,133,0.04) 0%, transparent 70%)`, pointerEvents:'none' }} />
      {/* Star field */}
      {Array.from({ length: 120 }).map((_, i) => (
        <div key={i} style={{
          position:'absolute',
          left:`${(i * 43 + i * 17) % 100}%`,
          top:`${(i * 29 + i * 11) % 100}%`,
          width: i % 8 === 0 ? 2.5 : i % 4 === 0 ? 1.5 : 1,
          height: i % 8 === 0 ? 2.5 : i % 4 === 0 ? 1.5 : 1,
          borderRadius:'50%',
          background: i % 6 === 0 ? T.accentBright : i % 11 === 0 ? 'rgba(45,212,191,0.9)' : 'rgba(255,255,255,0.6)',
          animation: `starTwinkle ${1.2 + (i % 4) * 0.6}s ease-in-out infinite ${(i % 7) * 0.3}s`,
          pointerEvents:'none',
        }} />
      ))}
    </>
  )
}

// ─── Login screen ─────────────────────────────────────────────────────────────

function LoginScreen() {
  const [hovered, setHovered] = useState(false)
  const [signing, setSigning]   = useState(false)
  const { enabled, mode } = useBehavioralStore()
  const key = enabled ? mode : 'default'
  const T = LOGIN_MODES[key] ?? LOGIN_MODES.default

  async function handleSignIn() {
    setSigning(true)
    try { await signInWithGoogle() } catch { setSigning(false) }
  }

  return (
    <div style={{
      height: '100vh',
      background: T.bg,
      display: 'flex',
      overflow: 'hidden',
      position: 'relative',
    }}>
      {/* Mode-specific background art */}
      {key === 'default' && <BgDefault T={T} />}
      {key === 'samurai' && <BgSamurai T={T} />}
      {key === 'pharaoh' && <BgPharaoh T={T} />}
      {key === 'astral'  && <BgAstral  T={T} />}

      {/* Left panel — branding */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '60px 80px',
        position: 'relative',
        overflowY: 'auto',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: T.badge ? 24 : 48 }}>
          <div style={{
            width: 48, height: 48, borderRadius: key === 'samurai' ? 4 : 12,
            background: key === 'default'
              ? 'linear-gradient(135deg, #1E40AF 0%, #60A5FA 100%)'
              : `linear-gradient(135deg, ${T.accent} 0%, ${T.accentBright} 100%)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: `0 8px 24px ${T.glow1.replace('0.08','0.35').replace('0.09','0.35').replace('0.07','0.35')}`,
          }}>
            <GraduationCap size={24} color={T.bg} strokeWidth={2.5} />
          </div>
          <div>
            <span style={{
              display: 'block',
              fontFamily: "'Cabinet Grotesk', sans-serif",
              fontWeight: 800, fontSize: 22, color: T.text, letterSpacing: key === 'samurai' ? '1px' : '-0.5px',
            }}>
              The Professor
            </span>
            {T.badge && (
              <span style={{
                display: 'inline-block', marginTop: 3,
                fontSize: 9, fontWeight: 700, letterSpacing: '2px',
                padding: '2px 8px', borderRadius: 3,
                background: `${T.accent}22`, border: `1px solid ${T.accent}55`,
                color: T.accentBright,
              }}>
                {T.badge}
              </span>
            )}
          </div>
        </div>

        {/* Headline */}
        <div style={{ maxWidth: 520 }}>
          <h1 style={{
            margin: '0 0 20px',
            fontSize: key === 'samurai' ? 58 : 52,
            fontWeight: 900,
            fontFamily: "'Cabinet Grotesk', sans-serif",
            color: T.text,
            letterSpacing: key === 'samurai' ? '-1px' : '-2px',
            lineHeight: key === 'samurai' ? 1.0 : 1.08,
          }}>
            {T.headline}
            <br />
            <span style={{
              background: key === 'default'
                ? 'linear-gradient(135deg, #3B82F6 0%, #93C5FD 50%, #60A5FA 100%)'
                : `linear-gradient(135deg, ${T.accentBright} 0%, ${T.accent} 50%, ${T.accentBright} 100%)`,
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>
              {T.sub}
            </span>
          </h1>
          <p style={{
            margin: '0 0 40px',
            fontSize: 16, color: T.text, lineHeight: 1.7, maxWidth: 420,
            opacity: 0.75,
            fontFamily: key === 'samurai' ? "'DM Sans', sans-serif" : undefined,
            letterSpacing: key === 'samurai' ? '0.2px' : undefined,
          }}>
            {T.tagline}
          </p>

          {/* Feature pills */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 48 }}>
            {FEATURES.map(({ icon: Icon, label }) => (
              <div key={label} style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '8px 16px',
                borderRadius: key === 'samurai' ? 4 : 100,
                background: `${T.accent}18`,
                border: `1px solid ${T.accent}45`,
              }}>
                <Icon size={13} color={T.accentBright} />
                <span style={{ fontSize: 12.5, color: T.text, fontWeight: 500, opacity: 0.85 }}>{label}</span>
              </div>
            ))}
          </div>

          {/* Sign in button */}
          {T.available ? (
            <>
              <button
                onClick={() => void handleSignIn()}
                disabled={signing}
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 12,
                  padding: '15px 32px',
                  borderRadius: key === 'samurai' ? 6 : 14,
                  background: hovered ? T.btnBgHover : T.btnBg,
                  border: `1.5px solid ${hovered ? T.accentBright : T.accentBright + '60'}`,
                  color: T.text, fontSize: 15, fontWeight: 700,
                  cursor: signing ? 'wait' : 'pointer',
                  fontFamily: key === 'samurai' ? "'DM Sans', sans-serif" : "'Cabinet Grotesk', sans-serif",
                  letterSpacing: key === 'samurai' ? '0.5px' : undefined,
                  transition: 'all 0.2s ease',
                  transform: hovered ? 'translateY(-2px)' : 'none',
                  boxShadow: hovered ? `0 10px 30px ${T.glow1}, 0 0 0 1px ${T.accent}40` : `0 4px 16px ${T.glow1}`,
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
                {!signing && <ArrowRight size={16} color={T.accentBright} />}
              </button>
              <p style={{ margin: '16px 0 0', fontSize: 12, color: T.textMuted }}>
                Your data is isolated and encrypted. Only you can access it.
              </p>
            </>
          ) : (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 10,
              padding: '14px 24px', borderRadius: 10,
              background: `${T.accent}0A`, border: `1px solid ${T.accent}30`,
              color: T.textDim, fontSize: 14,
            }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.5px', color: T.accentBright }}>COMING SOON</span>
              <span style={{ color: T.textMuted }}>·</span>
              <span>This mode is under development</span>
            </div>
          )}
        </div>
      </div>

      {/* Right panel — HD photo */}
      <div style={{
        flex: '0 0 460px',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Photo */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: `url('${MODE_PHOTOS[key]}')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center top',
          filter: 'brightness(0.72) contrast(1.08)',
        }} />
        {/* Left-edge fade — blends into the left panel */}
        <div style={{
          position: 'absolute', inset: 0,
          background: `linear-gradient(to right, ${T.bg} 0%, ${T.bg}CC 6%, ${T.bg}66 18%, transparent 38%)`,
          pointerEvents: 'none',
        }} />
        {/* Top/bottom vignette */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.38) 0%, rgba(0,0,0,0.06) 40%, rgba(0,0,0,0.62) 100%)',
          pointerEvents: 'none',
        }} />
        {/* Accent colour tint */}
        <div style={{
          position: 'absolute', inset: 0,
          background: `radial-gradient(ellipse at 65% 45%, ${T.glow1} 0%, transparent 65%)`,
          pointerEvents: 'none',
        }} />
        {/* Bottom quote */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          padding: '56px 36px 36px',
          background: `linear-gradient(to top, ${T.bg}F0 0%, ${T.bg}AA 45%, transparent 100%)`,
          textAlign: 'center',
          pointerEvents: 'none',
        }}>
          <p style={{
            margin: 0,
            fontFamily: key === 'samurai' ? "'DM Sans', sans-serif" : "'Cabinet Grotesk', sans-serif",
            fontSize: 13,
            fontWeight: key === 'samurai' ? 600 : 500,
            letterSpacing: key === 'samurai' ? '1.8px' : '0.4px',
            color: T.textDim,
            lineHeight: 1.65,
            textTransform: key === 'samurai' ? 'uppercase' : 'none',
          }}>
            {MODE_QUOTES[key]}
          </p>
        </div>
      </div>

      <style>{`
        @keyframes starTwinkle { 0%,100%{opacity:.3;transform:scale(.8)} 50%{opacity:1;transform:scale(1.3)} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
      `}</style>
    </div>
  )
}

// ─── Loading screen ────────────────────────────────────────────────────────────

function LoadingScreen() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: 'var(--color-bg, #0D0F1A)', gap: 16,
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: 11,
        background: 'linear-gradient(135deg, #1E40AF 0%, #60A5FA 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 8px 24px rgba(30,64,175,0.3)',
        animation: 'pulse 1.5s ease-in-out infinite',
      }}>
        <GraduationCap size={22} color="var(--color-bg, #0D0F1A)" strokeWidth={2.5} />
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
  const loadTasksFromDB  = useTaskStore(s => s.loadFromDB)
  const clearTasks       = useTaskStore(s => s.clearAll)
  const loadHabitsFromDB = useHabitsStore(s => s.loadFromDB)
  const clearHabits      = useHabitsStore(s => s.clearAll)

  const behavioralEnabled = useBehavioralStore(s => s.enabled)
  const behavioralMode    = useBehavioralStore(s => s.mode)

  // Apply CSS variables immediately before first paint, then on every theme change.
  useLayoutEffect(() => {
    applyThemeVars(getTheme(themeId))
  }, [themeId, behavioralEnabled, behavioralMode])

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
      if (u) void loadAllFromDB(loadTasksFromDB, loadHabitsFromDB)
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
        }
      } else if (!session) {
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

  const [assistantOpen, setAssistantOpen] = useState(false)
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
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--color-bg, #0D0F1A)' }}>
      <Sidebar />
      <PageShell>
        <ActiveModule />
      </PageShell>
      <AssistantPanel open={assistantOpen} onClose={() => setAssistantOpen(false)} />
      <AssistantToggle open={assistantOpen} onClick={() => setAssistantOpen(o => !o)} />
      {showWizard && <SetupWizard onClose={() => setShowWizard(false)} />}
    </div>
  )
}

export default App

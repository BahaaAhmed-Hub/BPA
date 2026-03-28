
import { useEffect, useLayoutEffect, useState } from 'react'
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
import { useTaskStore } from './store/taskStore'
import { supabase } from './lib/supabase'
import { signInWithGoogle, getPendingAddAccount, clearPendingAddAccount } from './lib/google'
import { addAccount, loadAccounts } from './lib/multiAccount'
import { saveAccountsToDB } from './lib/dbSync'
import { getTheme, applyThemeVars } from './lib/themes'
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
      height: '100vh',
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
        overflowY: 'auto',
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

      {/* Right panel — Human illustration */}
      <div style={{
        flex: '0 0 460px',
        height: '100%',
        background: 'linear-gradient(170deg, rgba(30,64,175,0.1) 0%, rgba(13,15,26,0.0) 55%)',
        borderLeft: '1px solid rgba(59,130,246,0.15)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Glow blobs */}
        <div style={{ position:'absolute', top:'30%', left:'40%', width:320, height:320, borderRadius:'50%', background:'radial-gradient(circle, rgba(59,130,246,0.1) 0%, transparent 70%)', pointerEvents:'none' }} />
        <div style={{ position:'absolute', bottom:'20%', right:'10%', width:180, height:180, borderRadius:'50%', background:'radial-gradient(circle, rgba(52,211,153,0.07) 0%, transparent 70%)', pointerEvents:'none' }} />

        <svg viewBox="0 0 420 560" fill="none" xmlns="http://www.w3.org/2000/svg"
          style={{ width:'100%', maxHeight:'90vh', position:'relative', zIndex:1 }}>
          <defs>
            <linearGradient id="bodyGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#60A5FA" />
              <stop offset="100%" stopColor="#1E40AF" />
            </linearGradient>
            <linearGradient id="skinGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FBBF24" />
              <stop offset="100%" stopColor="#D97706" />
            </linearGradient>
            <linearGradient id="shadowGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(30,64,175,0.3)" />
              <stop offset="100%" stopColor="rgba(30,64,175,0)" />
            </linearGradient>
            <filter id="glow"><feGaussianBlur stdDeviation="4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
            <filter id="softBlur"><feGaussianBlur stdDeviation="6"/></filter>
          </defs>

          {/* ── Ground shadow ── */}
          <ellipse cx="210" cy="470" rx="90" ry="12" fill="url(#shadowGrad)" />

          {/* ── Speed lines (motion trail) ── */}
          <line x1="20"  y1="310" x2="110" y2="300" stroke="rgba(59,130,246,0.25)" strokeWidth="2" strokeLinecap="round" style={{ animation:'trailFade 1.8s ease-in-out infinite' }} />
          <line x1="10"  y1="325" x2="95"  y2="318" stroke="rgba(59,130,246,0.18)" strokeWidth="1.5" strokeLinecap="round" style={{ animation:'trailFade 1.8s ease-in-out infinite 0.15s' }} />
          <line x1="25"  y1="340" x2="100" y2="335" stroke="rgba(59,130,246,0.12)" strokeWidth="1" strokeLinecap="round" style={{ animation:'trailFade 1.8s ease-in-out infinite 0.3s' }} />
          <line x1="30"  y1="355" x2="108" y2="350" stroke="rgba(59,130,246,0.08)" strokeWidth="1" strokeLinecap="round" style={{ animation:'trailFade 1.8s ease-in-out infinite 0.45s' }} />

          {/* ══ HUMAN FIGURE (running, leaning forward) ══ */}

          {/* Back leg (extended behind) */}
          <g style={{ animation:'legBack 0.9s ease-in-out infinite alternate' }}>
            {/* Upper back leg */}
            <path d="M200 370 Q185 395 175 420" stroke="url(#bodyGrad)" strokeWidth="14" strokeLinecap="round" fill="none"/>
            {/* Lower back leg */}
            <path d="M175 420 Q168 442 180 455" stroke="url(#bodyGrad)" strokeWidth="12" strokeLinecap="round" fill="none"/>
            {/* Back foot */}
            <ellipse cx="183" cy="456" rx="14" ry="7" fill="#1E40AF" transform="rotate(-15 183 456)"/>
          </g>

          {/* Front leg (driving forward) */}
          <g style={{ animation:'legFront 0.9s ease-in-out infinite alternate' }}>
            {/* Upper front leg */}
            <path d="M215 370 Q240 390 248 415" stroke="#2563EB" strokeWidth="14" strokeLinecap="round" fill="none"/>
            {/* Lower front leg */}
            <path d="M248 415 Q255 440 242 458" stroke="#2563EB" strokeWidth="12" strokeLinecap="round" fill="none"/>
            {/* Front foot */}
            <ellipse cx="245" cy="459" rx="16" ry="7" fill="#3B82F6" transform="rotate(10 245 459)"/>
          </g>

          {/* Torso (leaning forward ~20°) */}
          <path d="M195 290 Q205 330 208 368" stroke="url(#bodyGrad)" strokeWidth="28" strokeLinecap="round" fill="none"/>
          {/* Torso highlight */}
          <path d="M200 295 Q208 330 210 362" stroke="rgba(147,197,253,0.3)" strokeWidth="10" strokeLinecap="round" fill="none"/>

          {/* ── Back arm (swinging back, holding phone) ── */}
          <g style={{ animation:'armBack 0.9s ease-in-out infinite alternate' }}>
            <path d="M200 305 Q175 325 162 350" stroke="#1D4ED8" strokeWidth="12" strokeLinecap="round" fill="none"/>
            <path d="M162 350 Q155 368 160 382" stroke="#1D4ED8" strokeWidth="10" strokeLinecap="round" fill="none"/>
            {/* Phone in back hand */}
            <rect x="148" y="378" width="22" height="34" rx="4" fill="#0F172A" stroke="#38BDF8" strokeWidth="1.5" style={{ animation:'floatCard 2s ease-in-out infinite 0.5s' }}/>
            <rect x="152" y="382" width="14" height="20" rx="2" fill="#1E3A5F"/>
            <line x1="155" y1="386" x2="163" y2="386" stroke="#38BDF8" strokeWidth="1" opacity="0.8"/>
            <line x1="155" y1="390" x2="161" y2="390" stroke="#38BDF8" strokeWidth="1" opacity="0.5"/>
            <circle cx="159" cy="396" r="2" fill="#34D399"/>
          </g>

          {/* ── Front arm (raised forward, holding tablet with tasks) ── */}
          <g style={{ animation:'armFront 0.9s ease-in-out infinite alternate' }}>
            <path d="M215 305 Q245 280 265 265" stroke="#3B82F6" strokeWidth="12" strokeLinecap="round" fill="none"/>
            <path d="M265 265 Q280 255 285 245" stroke="#3B82F6" strokeWidth="10" strokeLinecap="round" fill="none"/>
            {/* Tablet/clipboard in front hand */}
            <rect x="278" y="218" width="68" height="52" rx="6" fill="#0D1B3E" stroke="#60A5FA" strokeWidth="1.8" style={{ animation:'floatCard 2.2s ease-in-out infinite' }}/>
            <rect x="283" y="223" width="58" height="38" rx="3" fill="#0F2458"/>
            {/* Task list on tablet */}
            <line x1="288" y1="230" x2="335" y2="230" stroke="white" strokeWidth="1.2" opacity="0.6"/>
            <line x1="288" y1="237" x2="328" y2="237" stroke="white" strokeWidth="1.2" opacity="0.5"/>
            <line x1="288" y1="244" x2="320" y2="244" stroke="white" strokeWidth="1.2" opacity="0.4"/>
            <line x1="288" y1="251" x2="330" y2="251" stroke="white" strokeWidth="1.2" opacity="0.3"/>
            <circle cx="285" cy="230" r="2.5" fill="#34D399"/>
            <circle cx="285" cy="237" r="2.5" fill="#34D399"/>
            <circle cx="285" cy="244" r="2.5" fill="#FCD34D"/>
            <circle cx="285" cy="251" r="2.5" fill="rgba(255,255,255,0.3)"/>
          </g>

          {/* Neck */}
          <rect x="202" y="272" width="16" height="22" rx="7" fill="#D97706"/>

          {/* Head */}
          <circle cx="210" cy="255" r="28" fill="url(#skinGrad)" style={{ animation:'headBob 0.9s ease-in-out infinite alternate' }}/>
          {/* Hair */}
          <path d="M185 248 Q190 228 210 226 Q230 228 235 248 Q228 234 210 232 Q192 234 185 248Z" fill="#92400E"/>
          {/* Face — determined expression */}
          <circle cx="203" cy="252" r="2.5" fill="#1C1C1E"/>
          <circle cx="217" cy="252" r="2.5" fill="#1C1C1E"/>
          {/* Focused brow */}
          <path d="M199 246 Q203 243 207 246" stroke="#92400E" strokeWidth="2" strokeLinecap="round" fill="none"/>
          <path d="M213 246 Q217 243 221 246" stroke="#92400E" strokeWidth="2" strokeLinecap="round" fill="none"/>
          {/* Slight smile */}
          <path d="M204 260 Q210 265 216 260" stroke="#92400E" strokeWidth="1.8" strokeLinecap="round" fill="none"/>

          {/* ── Floating UI cards orbiting the figure ── */}

          {/* Card: Calendar — top left */}
          <g style={{ animation:'floatCard 3s ease-in-out infinite' }}>
            <rect x="42" y="145" width="100" height="70" rx="10" fill="rgba(14,28,72,0.92)" stroke="rgba(96,165,250,0.5)" strokeWidth="1.5"/>
            <rect x="50" y="153" width="84" height="54" rx="6" fill="rgba(30,58,138,0.5)"/>
            <text x="55" y="167" fontSize="8" fontWeight="700" fill="#93C5FD" fontFamily="DM Sans" letterSpacing="0.8">CALENDAR</text>
            <line x1="50" y1="171" x2="126" y2="171" stroke="rgba(96,165,250,0.3)" strokeWidth="1"/>
            <text x="55" y="183" fontSize="9" fill="white" fontFamily="DM Sans">4 meetings</text>
            <text x="55" y="195" fontSize="8" fill="rgba(147,197,253,0.6)" fontFamily="DM Sans">Next: 9:30 AM</text>
            <rect x="106" y="176" width="22" height="16" rx="4" fill="rgba(59,130,246,0.3)" stroke="rgba(96,165,250,0.4)" strokeWidth="1"/>
            <text x="117" y="187" textAnchor="middle" fontSize="9" fill="#60A5FA" fontFamily="DM Sans">✓</text>
          </g>

          {/* Card: Inbox — top right */}
          <g style={{ animation:'floatCard 2.8s ease-in-out infinite 0.7s' }}>
            <rect x="288" y="100" width="100" height="65" rx="10" fill="rgba(14,28,72,0.92)" stroke="rgba(165,180,252,0.5)" strokeWidth="1.5"/>
            <text x="298" y="116" fontSize="8" fontWeight="700" fill="#A5B4FC" fontFamily="DM Sans" letterSpacing="0.8">INBOX</text>
            <line x1="294" y1="120" x2="382" y2="120" stroke="rgba(165,180,252,0.3)" strokeWidth="1"/>
            <text x="298" y="132" fontSize="9" fill="white" fontFamily="DM Sans">12 emails</text>
            <text x="298" y="144" fontSize="8" fill="rgba(165,180,252,0.6)" fontFamily="DM Sans">3 need action</text>
            <rect x="355" y="125" width="28" height="14" rx="7" fill="rgba(165,180,252,0.2)" stroke="rgba(165,180,252,0.4)" strokeWidth="1"/>
            <text x="369" y="135" textAnchor="middle" fontSize="8" fill="#A5B4FC" fontFamily="DM Sans">AI</text>
          </g>

          {/* Card: Habits — bottom right */}
          <g style={{ animation:'floatCard 3.4s ease-in-out infinite 1.2s' }}>
            <rect x="300" y="395" width="100" height="65" rx="10" fill="rgba(14,28,72,0.92)" stroke="rgba(52,211,153,0.5)" strokeWidth="1.5"/>
            <text x="310" y="411" fontSize="8" fontWeight="700" fill="#34D399" fontFamily="DM Sans" letterSpacing="0.8">HABITS</text>
            <line x1="306" y1="415" x2="394" y2="415" stroke="rgba(52,211,153,0.3)" strokeWidth="1"/>
            <text x="310" y="428" fontSize="9" fill="white" fontFamily="DM Sans">🔥 14-day streak</text>
            {/* Mini progress bar */}
            <rect x="310" y="434" width="80" height="5" rx="2.5" fill="rgba(52,211,153,0.15)"/>
            <rect x="310" y="434" width="62" height="5" rx="2.5" fill="#34D399"/>
            <text x="310" y="450" fontSize="8" fill="rgba(52,211,153,0.6)" fontFamily="DM Sans">Morning routine 78%</text>
          </g>

          {/* Card: AI Brief — bottom left */}
          <g style={{ animation:'floatCard 2.6s ease-in-out infinite 1.8s' }}>
            <rect x="22" y="400" width="108" height="65" rx="10" fill="rgba(14,28,72,0.92)" stroke="rgba(253,211,77,0.4)" strokeWidth="1.5"/>
            <text x="32" y="416" fontSize="8" fontWeight="700" fill="#FCD34D" fontFamily="DM Sans" letterSpacing="0.8">AI BRIEF</text>
            <line x1="28" y1="420" x2="124" y2="420" stroke="rgba(253,211,77,0.3)" strokeWidth="1"/>
            <text x="32" y="433" fontSize="8.5" fill="white" fontFamily="DM Sans">Good morning!</text>
            <text x="32" y="445" fontSize="8" fill="rgba(253,211,77,0.6)" fontFamily="DM Sans">3 priorities today</text>
            <text x="32" y="457" fontSize="8" fill="rgba(255,255,255,0.4)" fontFamily="DM Sans">Focus: Q4 review</text>
          </g>

          {/* ── Floating sparkles / energy dots ── */}
          <circle cx="158" cy="230" r="3" fill="#60A5FA" style={{ animation:'sparkle 2s ease-in-out infinite' }}/>
          <circle cx="268" cy="310" r="2.5" fill="#34D399" style={{ animation:'sparkle 2.5s ease-in-out infinite 0.6s' }}/>
          <circle cx="140" cy="350" r="2" fill="#FCD34D" style={{ animation:'sparkle 1.8s ease-in-out infinite 1s' }}/>
          <circle cx="290" cy="380" r="2" fill="#A5B4FC" style={{ animation:'sparkle 2.2s ease-in-out infinite 0.3s' }}/>
          <circle cx="175" cy="195" r="2.5" fill="#FCD34D" style={{ animation:'sparkle 3s ease-in-out infinite 1.4s' }}/>
          <circle cx="310" cy="210" r="2" fill="#60A5FA" style={{ animation:'sparkle 2.4s ease-in-out infinite 0.8s' }}/>

          {/* ── Tagline ── */}
          <text x="210" y="512" textAnchor="middle" fontSize="17" fontWeight="800" fill="white" fontFamily="Cabinet Grotesk" letterSpacing="-0.5" opacity="0.95">
            Stay ahead. Stay organized.
          </text>
          <text x="210" y="532" textAnchor="middle" fontSize="10.5" fill="rgba(147,197,253,0.5)" fontFamily="DM Sans" letterSpacing="0.2">
            Your AI co-pilot for every workday.
          </text>
        </svg>
      </div>

      <style>{`
        @keyframes floatCard {
          0%, 100% { transform: translateY(0px);  }
          50%       { transform: translateY(-7px); }
        }
        @keyframes sparkle {
          0%, 100% { opacity: 0.15; transform: scale(0.7); }
          50%       { opacity: 1;   transform: scale(1.5);  }
        }
        @keyframes headBob {
          0%   { transform: translateY(0px) rotate(-3deg); }
          100% { transform: translateY(-4px) rotate(2deg); }
        }
        @keyframes armFront {
          0%   { transform: rotate(-5deg); transform-origin: 215px 305px; }
          100% { transform: rotate(5deg);  transform-origin: 215px 305px; }
        }
        @keyframes armBack {
          0%   { transform: rotate(5deg);  transform-origin: 200px 305px; }
          100% { transform: rotate(-5deg); transform-origin: 200px 305px; }
        }
        @keyframes legFront {
          0%   { transform: rotate(-6deg); transform-origin: 215px 370px; }
          100% { transform: rotate(4deg);  transform-origin: 215px 370px; }
        }
        @keyframes legBack {
          0%   { transform: rotate(4deg);  transform-origin: 200px 370px; }
          100% { transform: rotate(-6deg); transform-origin: 200px 370px; }
        }
        @keyframes trailFade {
          0%, 100% { opacity: 0.1; }
          50%       { opacity: 1;   }
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
  const themeId = useUIStore(s => s.themeId)
  const loadTasksFromDB = useTaskStore(s => s.loadFromDB)

  // Apply CSS variables immediately before first paint, then on every theme change
  useLayoutEffect(() => {
    applyThemeVars(getTheme(themeId))
  }, [themeId])

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user
      setUser(u ? { id: u.id, email: u.email ?? '', name: u.user_metadata?.full_name as string | undefined, avatarUrl: u.user_metadata?.avatar_url as string | undefined } : null)
      if (u) void loadTasksFromDB()   // hydrate tasks from DB on session restore
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      // ── Additional account flow: restore original session ─────────────────
      const pending = getPendingAddAccount()
      if (pending && session?.provider_token && session.user) {
        clearPendingAddAccount()
        // Store new Google account's token + info
        addAccount({
          email:                session.user.email ?? '',
          name:                 session.user.user_metadata?.full_name as string ?? '',
          avatarUrl:            session.user.user_metadata?.avatar_url as string | undefined,
          providerToken:        session.provider_token,
          supabaseAccessToken:  session.access_token,
          supabaseRefreshToken: session.refresh_token ?? '',
          scopes:               ['calendar', 'calendar.events', 'gmail.readonly'],
          isPrimary:            false,
        })
        // Persist accounts to DB (token stripped server-side)
        void saveAccountsToDB(loadAccounts()).catch(console.warn)
        // Restore the previous session without changing current user
        void supabase.auth.setSession(pending).catch(() => {/* expired token – user must re-login */})
        return
      }

      // ── Normal sign-in / sign-out ─────────────────────────────────────────
      const u = session?.user
      setUser(u ? { id: u.id, email: u.email ?? '', name: u.user_metadata?.full_name as string | undefined, avatarUrl: u.user_metadata?.avatar_url as string | undefined } : null)
      setLoading(false)
      if (session?.provider_token) {
        localStorage.setItem('google_provider_token', session.provider_token)
        localStorage.setItem('google_provider_token_saved_at', Date.now().toString())
      } else if (!session) {
        localStorage.removeItem('google_provider_token')
        localStorage.removeItem('google_provider_token_saved_at')
      }
      // On sign-in: pull all data from DB so nothing is lost across devices/sessions
      if (u) void loadTasksFromDB()
    })

    return () => subscription.unsubscribe()
  }, [setUser, setLoading, loadTasksFromDB])

  if (loading) return <LoadingScreen />
  if (!user)   return <LoginScreen />

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--color-bg, #0D0F1A)' }}>
      <Sidebar />
      <PageShell>
        <ActiveModule />
      </PageShell>
    </div>
  )
}

export default App

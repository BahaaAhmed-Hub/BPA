import { useEffect, useLayoutEffect, useState } from 'react'
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
import { getTheme, applyThemeVars, applySamuraiModeOverride } from './lib/themes'
import { GraduationCap, Calendar, Mail, CheckSquare, Brain, ArrowRight } from 'lucide-react'

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

// ─── Right-panel illustrations ────────────────────────────────────────────────

function IllustrationDefault() {
  return (
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
      </defs>
      <ellipse cx="210" cy="470" rx="90" ry="12" fill="url(#shadowGrad)" />
      <line x1="20" y1="310" x2="110" y2="300" stroke="rgba(59,130,246,0.25)" strokeWidth="2" strokeLinecap="round" style={{ animation:'trailFade 1.8s ease-in-out infinite' }} />
      <line x1="10" y1="325" x2="95"  y2="318" stroke="rgba(59,130,246,0.18)" strokeWidth="1.5" strokeLinecap="round" style={{ animation:'trailFade 1.8s ease-in-out infinite 0.15s' }} />
      <line x1="25" y1="340" x2="100" y2="335" stroke="rgba(59,130,246,0.12)" strokeWidth="1" strokeLinecap="round" style={{ animation:'trailFade 1.8s ease-in-out infinite 0.3s' }} />
      <g style={{ animation:'legBack 0.9s ease-in-out infinite alternate' }}>
        <path d="M200 370 Q185 395 175 420" stroke="url(#bodyGrad)" strokeWidth="14" strokeLinecap="round" fill="none"/>
        <path d="M175 420 Q168 442 180 455" stroke="url(#bodyGrad)" strokeWidth="12" strokeLinecap="round" fill="none"/>
        <ellipse cx="183" cy="456" rx="14" ry="7" fill="#1E40AF" transform="rotate(-15 183 456)"/>
      </g>
      <g style={{ animation:'legFront 0.9s ease-in-out infinite alternate' }}>
        <path d="M215 370 Q240 390 248 415" stroke="#2563EB" strokeWidth="14" strokeLinecap="round" fill="none"/>
        <path d="M248 415 Q255 440 242 458" stroke="#2563EB" strokeWidth="12" strokeLinecap="round" fill="none"/>
        <ellipse cx="245" cy="459" rx="16" ry="7" fill="#3B82F6" transform="rotate(10 245 459)"/>
      </g>
      <path d="M195 290 Q205 330 208 368" stroke="url(#bodyGrad)" strokeWidth="28" strokeLinecap="round" fill="none"/>
      <path d="M200 295 Q208 330 210 362" stroke="rgba(147,197,253,0.3)" strokeWidth="10" strokeLinecap="round" fill="none"/>
      <g style={{ animation:'armBack 0.9s ease-in-out infinite alternate' }}>
        <path d="M200 305 Q175 325 162 350" stroke="#1D4ED8" strokeWidth="12" strokeLinecap="round" fill="none"/>
        <path d="M162 350 Q155 368 160 382" stroke="#1D4ED8" strokeWidth="10" strokeLinecap="round" fill="none"/>
        <rect x="148" y="378" width="22" height="34" rx="4" fill="#0F172A" stroke="#38BDF8" strokeWidth="1.5" style={{ animation:'floatCard 2s ease-in-out infinite 0.5s' }}/>
        <rect x="152" y="382" width="14" height="20" rx="2" fill="#1E3A5F"/>
        <line x1="155" y1="386" x2="163" y2="386" stroke="#38BDF8" strokeWidth="1" opacity="0.8"/>
        <line x1="155" y1="390" x2="161" y2="390" stroke="#38BDF8" strokeWidth="1" opacity="0.5"/>
        <circle cx="159" cy="396" r="2" fill="#34D399"/>
      </g>
      <g style={{ animation:'armFront 0.9s ease-in-out infinite alternate' }}>
        <path d="M215 305 Q245 280 265 265" stroke="#3B82F6" strokeWidth="12" strokeLinecap="round" fill="none"/>
        <path d="M265 265 Q280 255 285 245" stroke="#3B82F6" strokeWidth="10" strokeLinecap="round" fill="none"/>
        <rect x="278" y="218" width="68" height="52" rx="6" fill="#0D1B3E" stroke="#60A5FA" strokeWidth="1.8" style={{ animation:'floatCard 2.2s ease-in-out infinite' }}/>
        <rect x="283" y="223" width="58" height="38" rx="3" fill="#0F2458"/>
        <line x1="288" y1="230" x2="335" y2="230" stroke="white" strokeWidth="1.2" opacity="0.6"/>
        <line x1="288" y1="237" x2="328" y2="237" stroke="white" strokeWidth="1.2" opacity="0.5"/>
        <line x1="288" y1="244" x2="320" y2="244" stroke="white" strokeWidth="1.2" opacity="0.4"/>
        <circle cx="285" cy="230" r="2.5" fill="#34D399"/>
        <circle cx="285" cy="237" r="2.5" fill="#34D399"/>
        <circle cx="285" cy="244" r="2.5" fill="#FCD34D"/>
      </g>
      <rect x="202" y="272" width="16" height="22" rx="7" fill="#D97706"/>
      <circle cx="210" cy="255" r="28" fill="url(#skinGrad)" style={{ animation:'headBob 0.9s ease-in-out infinite alternate' }}/>
      <path d="M185 248 Q190 228 210 226 Q230 228 235 248 Q228 234 210 232 Q192 234 185 248Z" fill="#92400E"/>
      <circle cx="203" cy="252" r="2.5" fill="#1C1C1E"/>
      <circle cx="217" cy="252" r="2.5" fill="#1C1C1E"/>
      <path d="M199 246 Q203 243 207 246" stroke="#92400E" strokeWidth="2" strokeLinecap="round" fill="none"/>
      <path d="M213 246 Q217 243 221 246" stroke="#92400E" strokeWidth="2" strokeLinecap="round" fill="none"/>
      <path d="M204 260 Q210 265 216 260" stroke="#92400E" strokeWidth="1.8" strokeLinecap="round" fill="none"/>
      <g style={{ animation:'floatCard 3s ease-in-out infinite' }}>
        <rect x="42" y="145" width="100" height="70" rx="10" fill="rgba(14,28,72,0.92)" stroke="rgba(96,165,250,0.5)" strokeWidth="1.5"/>
        <text x="55" y="167" fontSize="8" fontWeight="700" fill="#93C5FD" fontFamily="DM Sans" letterSpacing="0.8">CALENDAR</text>
        <line x1="50" y1="171" x2="126" y2="171" stroke="rgba(96,165,250,0.3)" strokeWidth="1"/>
        <text x="55" y="183" fontSize="9" fill="white" fontFamily="DM Sans">4 meetings</text>
        <text x="55" y="195" fontSize="8" fill="rgba(147,197,253,0.6)" fontFamily="DM Sans">Next: 9:30 AM</text>
      </g>
      <g style={{ animation:'floatCard 2.8s ease-in-out infinite 0.7s' }}>
        <rect x="288" y="100" width="100" height="65" rx="10" fill="rgba(14,28,72,0.92)" stroke="rgba(165,180,252,0.5)" strokeWidth="1.5"/>
        <text x="298" y="116" fontSize="8" fontWeight="700" fill="#A5B4FC" fontFamily="DM Sans" letterSpacing="0.8">INBOX</text>
        <line x1="294" y1="120" x2="382" y2="120" stroke="rgba(165,180,252,0.3)" strokeWidth="1"/>
        <text x="298" y="132" fontSize="9" fill="white" fontFamily="DM Sans">12 emails</text>
        <text x="298" y="144" fontSize="8" fill="rgba(165,180,252,0.6)" fontFamily="DM Sans">3 need action</text>
      </g>
      <g style={{ animation:'floatCard 3.4s ease-in-out infinite 1.2s' }}>
        <rect x="300" y="395" width="100" height="65" rx="10" fill="rgba(14,28,72,0.92)" stroke="rgba(52,211,153,0.5)" strokeWidth="1.5"/>
        <text x="310" y="411" fontSize="8" fontWeight="700" fill="#34D399" fontFamily="DM Sans" letterSpacing="0.8">HABITS</text>
        <line x1="306" y1="415" x2="394" y2="415" stroke="rgba(52,211,153,0.3)" strokeWidth="1"/>
        <text x="310" y="428" fontSize="9" fill="white" fontFamily="DM Sans">14-day streak</text>
        <rect x="310" y="434" width="80" height="5" rx="2.5" fill="rgba(52,211,153,0.15)"/>
        <rect x="310" y="434" width="62" height="5" rx="2.5" fill="#34D399"/>
      </g>
      <g style={{ animation:'floatCard 2.6s ease-in-out infinite 1.8s' }}>
        <rect x="22" y="400" width="108" height="65" rx="10" fill="rgba(14,28,72,0.92)" stroke="rgba(253,211,77,0.4)" strokeWidth="1.5"/>
        <text x="32" y="416" fontSize="8" fontWeight="700" fill="#FCD34D" fontFamily="DM Sans" letterSpacing="0.8">AI BRIEF</text>
        <line x1="28" y1="420" x2="124" y2="420" stroke="rgba(253,211,77,0.3)" strokeWidth="1"/>
        <text x="32" y="433" fontSize="8.5" fill="white" fontFamily="DM Sans">Good morning!</text>
        <text x="32" y="445" fontSize="8" fill="rgba(253,211,77,0.6)" fontFamily="DM Sans">3 priorities today</text>
      </g>
      <circle cx="158" cy="230" r="3" fill="#60A5FA" style={{ animation:'sparkle 2s ease-in-out infinite' }}/>
      <circle cx="268" cy="310" r="2.5" fill="#34D399" style={{ animation:'sparkle 2.5s ease-in-out infinite 0.6s' }}/>
      <circle cx="140" cy="350" r="2" fill="#FCD34D" style={{ animation:'sparkle 1.8s ease-in-out infinite 1s' }}/>
      <circle cx="290" cy="380" r="2" fill="#A5B4FC" style={{ animation:'sparkle 2.2s ease-in-out infinite 0.3s' }}/>
      <text x="210" y="512" textAnchor="middle" fontSize="17" fontWeight="800" fill="white" fontFamily="Cabinet Grotesk" letterSpacing="-0.5" opacity="0.95">Stay ahead. Stay organized.</text>
      <text x="210" y="532" textAnchor="middle" fontSize="10.5" fill="rgba(147,197,253,0.5)" fontFamily="DM Sans" letterSpacing="0.2">Your AI co-pilot for every workday.</text>
    </svg>
  )
}

function IllustrationSamurai({ T }: { T: LoginTheme }) {
  return (
    <svg viewBox="0 0 420 560" fill="none" xmlns="http://www.w3.org/2000/svg"
      style={{ width:'100%', maxHeight:'90vh', position:'relative', zIndex:1 }}>
      <defs>
        <linearGradient id="samuraiGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#C0392B" stopOpacity="0.7"/>
          <stop offset="100%" stopColor="#5C0A0A" stopOpacity="0.3"/>
        </linearGradient>
        <radialGradient id="groundGlow" cx="50%" cy="100%" r="50%">
          <stop offset="0%" stopColor="#8B1A1A" stopOpacity="0.25"/>
          <stop offset="100%" stopColor="#8B1A1A" stopOpacity="0"/>
        </radialGradient>
        <filter id="sBlur"><feGaussianBlur stdDeviation="3"/></filter>
      </defs>

      {/* Ground glow */}
      <ellipse cx="210" cy="490" rx="160" ry="40" fill="url(#groundGlow)" />

      {/* Moon */}
      <circle cx="340" cy="80" r="42" fill="#1A1410" stroke="#2A1F18" strokeWidth="1"/>
      <circle cx="340" cy="80" r="38" fill="#1E1812"/>
      <circle cx="328" cy="72" r="28" fill="#0A0804"/>

      {/* Moon halo */}
      <circle cx="340" cy="80" r="52" fill="none" stroke="rgba(139,26,26,0.12)" strokeWidth="8"/>
      <circle cx="340" cy="80" r="65" fill="none" stroke="rgba(139,26,26,0.06)" strokeWidth="10"/>

      {/* Distant torii gate silhouette */}
      <g opacity="0.18" fill="#1A0E0E">
        <rect x="100" y="310" width="8" height="100"/>
        <rect x="155" y="310" width="8" height="100"/>
        <rect x="92" y="305" width="79" height="10" rx="2"/>
        <rect x="96" y="295" width="71" height="7" rx="1"/>
      </g>

      {/* Floating cherry blossom petals */}
      {[
        {cx:80,  cy:140, r:6, delay:'0s',   dur:'3.2s'},
        {cx:320, cy:180, r:5, delay:'0.8s',  dur:'2.8s'},
        {cx:150, cy:220, r:7, delay:'1.5s',  dur:'3.5s'},
        {cx:360, cy:260, r:4, delay:'0.3s',  dur:'2.6s'},
        {cx:60,  cy:300, r:5, delay:'1.1s',  dur:'3.0s'},
        {cx:280, cy:130, r:6, delay:'2.0s',  dur:'2.9s'},
        {cx:380, cy:360, r:4, delay:'0.6s',  dur:'3.4s'},
        {cx:110, cy:380, r:5, delay:'1.7s',  dur:'2.7s'},
      ].map((p, i) => (
        <g key={i} style={{ animation:`petalFloat ${p.dur} ease-in-out infinite ${p.delay}` }}>
          <ellipse cx={p.cx}   cy={p.cy}   rx={p.r}     ry={p.r*0.6}  fill={T.accentBright} opacity="0.5" transform={`rotate(${i*40} ${p.cx} ${p.cy})`}/>
          <ellipse cx={p.cx+p.r*0.6} cy={p.cy-p.r*0.4} rx={p.r*0.8} ry={p.r*0.5} fill={T.accentBright} opacity="0.4" transform={`rotate(${i*40+45} ${p.cx} ${p.cy})`}/>
          <ellipse cx={p.cx-p.r*0.5} cy={p.cy-p.r*0.5} rx={p.r*0.7} ry={p.r*0.45} fill="#C0392B" opacity="0.3" transform={`rotate(${i*40+90} ${p.cx} ${p.cy})`}/>
        </g>
      ))}

      {/* Samurai figure — standing, katana at side raised */}
      {/* Shadow */}
      <ellipse cx="210" cy="480" rx="45" ry="10" fill="rgba(0,0,0,0.5)"/>

      {/* Hakama (wide pants) */}
      <path d="M185 380 Q180 420 170 475 L200 478 Q205 445 210 425 Q215 445 220 478 L250 475 Q240 420 235 380 Z" fill="#1A1410" stroke="#2A1E18" strokeWidth="1"/>

      {/* Kimono / torso */}
      <path d="M180 280 Q175 310 178 380 L242 380 Q245 310 240 280 Q225 260 210 258 Q195 260 180 280Z" fill="#1E1812" stroke="#2E2218" strokeWidth="1"/>
      {/* Kimono collar — crimson */}
      <path d="M200 280 Q210 270 220 280 Q215 300 210 310 Q205 300 200 280Z" fill="#8B1A1A" opacity="0.7"/>
      {/* Sash/obi */}
      <rect x="182" y="330" width="56" height="22" rx="2" fill="#5C0A0A" stroke="#8B1A1A" strokeWidth="0.5" opacity="0.9"/>
      <rect x="200" y="330" width="20" height="22" rx="1" fill="#8B1A1A" opacity="0.8"/>

      {/* Left arm — down at side */}
      <path d="M182 285 Q165 310 162 345" stroke="#1A1410" strokeWidth="14" strokeLinecap="round" fill="none"/>
      <path d="M162 345 Q158 365 162 380" stroke="#1A1410" strokeWidth="10" strokeLinecap="round" fill="none"/>

      {/* Right arm — raised, holding katana */}
      <g style={{ animation:'swordReady 4s ease-in-out infinite' }}>
        <path d="M238 285 Q255 260 270 240" stroke="#1A1410" strokeWidth="14" strokeLinecap="round" fill="none"/>
        <path d="M270 240 Q280 225 285 210" stroke="#1A1410" strokeWidth="10" strokeLinecap="round" fill="none"/>
        {/* Tsuba (guard) */}
        <ellipse cx="288" cy="205" rx="10" ry="6" fill="#3D2B10" stroke="#8B6914" strokeWidth="1" transform="rotate(-30 288 205)"/>
        {/* Katana blade */}
        <path d="M291 200 Q330 155 365 95" stroke="rgba(200,200,220,0.85)" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
        <path d="M293 202 Q332 157 366 97" stroke="rgba(255,255,255,0.3)" strokeWidth="1" strokeLinecap="round" fill="none"/>
        {/* Blade tip glow */}
        <circle cx="366" cy="96" r="4" fill="rgba(192,57,43,0.6)" style={{ animation:'sparkle 1.8s ease-in-out infinite' }}/>
        {/* Katana handle */}
        <path d="M284 208 Q278 218 274 228" stroke="#6B4226" strokeWidth="9" strokeLinecap="round" fill="none"/>
        <line x1="279" y1="210" x2="282" y2="220" stroke="#C9A227" strokeWidth="1" opacity="0.6"/>
        <line x1="276" y1="216" x2="279" y2="226" stroke="#C9A227" strokeWidth="1" opacity="0.5"/>
      </g>

      {/* Neck */}
      <rect x="204" y="262" width="12" height="20" rx="5" fill="#2A2018" opacity="0.9"/>

      {/* Head */}
      <circle cx="210" cy="248" r="26" fill="#1E1812"/>
      {/* Mempo / war mask lower face */}
      <path d="M192 250 Q210 240 228 250 Q228 268 210 272 Q192 268 192 250Z" fill="#1A1410" stroke="#2A1E18" strokeWidth="0.8" opacity="0.9"/>
      {/* Mask teeth hint */}
      <path d="M200 264 Q205 268 210 264 Q215 268 220 264" stroke="#8B1A1A" strokeWidth="1" strokeLinecap="round" fill="none" opacity="0.5"/>
      {/* Eyes — glowing crimson */}
      <ellipse cx="202" cy="247" rx="5" ry="3.5" fill="#0A0804"/>
      <ellipse cx="218" cy="247" rx="5" ry="3.5" fill="#0A0804"/>
      <ellipse cx="202" cy="247" rx="3" ry="2" fill="#8B1A1A" style={{ animation:'eyeGlow 2.5s ease-in-out infinite' }}/>
      <ellipse cx="218" cy="247" rx="3" ry="2" fill="#8B1A1A" style={{ animation:'eyeGlow 2.5s ease-in-out infinite 0.3s' }}/>
      {/* Kabuto (helmet) */}
      <path d="M185 248 Q185 215 210 210 Q235 215 235 248 Q230 230 210 226 Q190 230 185 248Z" fill="#1A1410" stroke="#2A1E18" strokeWidth="1"/>
      {/* Kabuto front piece */}
      <path d="M200 218 Q210 208 220 218 Q218 225 210 222 Q202 225 200 218Z" fill="#5C0A0A" stroke="#8B1A1A" strokeWidth="0.5"/>
      {/* Kuwagata (horns) */}
      <path d="M198 218 Q186 195 190 180 Q194 190 200 210" fill="#2A1E18" stroke="#3A2E28" strokeWidth="0.5"/>
      <path d="M222 218 Q234 195 230 180 Q226 190 220 210" fill="#2A1E18" stroke="#3A2E28" strokeWidth="0.5"/>

      {/* Floating rank card */}
      <g style={{ animation:'floatCard 3s ease-in-out infinite 1s' }}>
        <rect x="28" y="160" width="110" height="72" rx="8" fill="rgba(10,8,4,0.94)" stroke="rgba(139,26,26,0.5)" strokeWidth="1.2"/>
        <text x="40" y="178" fontSize="7.5" fontWeight="700" fill="#C0392B" fontFamily="DM Sans" letterSpacing="1.2">RANK</text>
        <line x1="34" y1="182" x2="132" y2="182" stroke="rgba(139,26,26,0.3)" strokeWidth="0.8"/>
        <text x="40" y="198" fontSize="13" fontWeight="800" fill="#EDE4D3" fontFamily="Cabinet Grotesk">SAMURAI</text>
        <text x="40" y="212" fontSize="8" fill="#7A6E5E" fontFamily="DM Sans">Score: 58 / 100</text>
        <rect x="40" y="218" width="82" height="4" rx="2" fill="rgba(139,26,26,0.2)"/>
        <rect x="40" y="218" width="48" height="4" rx="2" fill="#8B1A1A"/>
      </g>

      {/* Floating objectives card */}
      <g style={{ animation:'floatCard 2.8s ease-in-out infinite 0.4s' }}>
        <rect x="282" y="300" width="118" height="80" rx="8" fill="rgba(10,8,4,0.94)" stroke="rgba(139,26,26,0.4)" strokeWidth="1.2"/>
        <text x="294" y="318" fontSize="7.5" fontWeight="700" fill="#C0392B" fontFamily="DM Sans" letterSpacing="1.2">OBJECTIVES</text>
        <line x1="288" y1="322" x2="394" y2="322" stroke="rgba(139,26,26,0.3)" strokeWidth="0.8"/>
        <text x="294" y="336" fontSize="8.5" fill="#EDE4D3" fontFamily="DM Sans">Q4 Strategy Review</text>
        <text x="294" y="350" fontSize="8.5" fill="#7A6E5E" fontFamily="DM Sans">Close 2 contracts</text>
        <text x="294" y="364" fontSize="8.5" fill="#7A6E5E" fontFamily="DM Sans" opacity="0.6">Team alignment</text>
      </g>

      {/* Energy dots */}
      <circle cx="155" cy="200" r="2.5" fill="#C0392B" style={{ animation:'sparkle 2s ease-in-out infinite' }}/>
      <circle cx="340" cy="320" r="2" fill="#8B1A1A" style={{ animation:'sparkle 2.5s ease-in-out infinite 0.6s' }}/>
      <circle cx="100" cy="320" r="2" fill="#C0392B" style={{ animation:'sparkle 2.2s ease-in-out infinite 1.2s' }}/>
      <circle cx="370" cy="180" r="1.5" fill="#EDE4D3" style={{ animation:'sparkle 1.8s ease-in-out infinite 0.8s' }} opacity="0.4"/>

      {/* Bottom text */}
      <text x="210" y="510" textAnchor="middle" fontSize="14" fontWeight="700" fill="#EDE4D3" fontFamily="Cabinet Grotesk" letterSpacing="2" opacity="0.6">七転び八起き</text>
      <text x="210" y="528" textAnchor="middle" fontSize="9" fill="#7A6E5E" fontFamily="DM Sans" letterSpacing="0.5">Fall seven times. Rise eight.</text>
    </svg>
  )
}

function IllustrationPharaoh({ T }: { T: LoginTheme }) {
  return (
    <svg viewBox="0 0 420 560" fill="none" xmlns="http://www.w3.org/2000/svg"
      style={{ width:'100%', maxHeight:'90vh', position:'relative', zIndex:1 }}>
      <defs>
        <linearGradient id="pharaohSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#090700"/>
          <stop offset="60%" stopColor="#120E03"/>
          <stop offset="100%" stopColor="#1E1705"/>
        </linearGradient>
        <linearGradient id="goldGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F5D060"/>
          <stop offset="100%" stopColor="#8B6914"/>
        </linearGradient>
        <radialGradient id="horizonGlow" cx="50%" cy="100%" r="60%">
          <stop offset="0%" stopColor="#C9A227" stopOpacity="0.2"/>
          <stop offset="100%" stopColor="#C9A227" stopOpacity="0"/>
        </radialGradient>
      </defs>

      {/* Sky */}
      <rect x="0" y="0" width="420" height="560" fill="url(#pharaohSky)"/>
      {/* Horizon glow */}
      <ellipse cx="210" cy="560" rx="250" ry="120" fill="url(#horizonGlow)"/>

      {/* Stars */}
      {[{x:50,y:40},{x:120,y:25},{x:200,y:60},{x:280,y:30},{x:370,y:55},{x:80,y:85},{x:160,y:95},{x:320,y:80},{x:400,y:40},{x:40,y:130},{x:380,y:110}].map((s,i) => (
        <circle key={i} cx={s.x} cy={s.y} r={i%3===0?2:1} fill={T.accentBright} opacity="0.8" style={{ animation:`starTwinkle ${1.5+(i%3)*0.8}s ease-in-out infinite ${i*0.3}s` }}/>
      ))}

      {/* Large pyramid */}
      <path d="M210,120 L360,400 L60,400 Z" fill="#0E0C04" stroke="#1E1905" strokeWidth="1.5"/>
      <path d="M210,120 L360,400 L285,400 L210,200 Z" fill="#130F04" opacity="0.6"/>
      {/* Pyramid gold outline */}
      <path d="M210,120 L360,400 L60,400 Z" fill="none" stroke={T.accentBright} strokeWidth="0.6" opacity="0.3"/>

      {/* Eye of Horus (on pyramid) */}
      <g transform="translate(210,265)" style={{ animation:'eyeGlow 3s ease-in-out infinite' }}>
        <ellipse cx="0" cy="0" rx="22" ry="12" fill="none" stroke={T.accent} strokeWidth="1.2" opacity="0.8"/>
        <circle cx="0" cy="0" r="7" fill={T.accent} opacity="0.7"/>
        <circle cx="0" cy="0" r="3.5" fill={T.accentBright} opacity="0.9"/>
        <path d="M-22,0 Q-30,8 -25,14 Q-18,10 -22,0" fill={T.accent} opacity="0.5"/>
        <path d="M22,0 Q30,8 25,14 Q18,10 22,0" fill={T.accent} opacity="0.3"/>
        <circle cx="0" cy="0" r="12" fill="none" stroke={T.accentBright} strokeWidth="0.5" opacity="0.4"/>
      </g>

      {/* Ground line */}
      <rect x="0" y="400" width="420" height="160" fill="#0A0800"/>
      <line x1="0" y1="400" x2="420" y2="400" stroke={T.accent} strokeWidth="0.5" opacity="0.3"/>

      {/* Pharaoh figure — standing, holding crook & flail */}
      {/* Shadow */}
      <ellipse cx="210" cy="492" rx="40" ry="9" fill="rgba(0,0,0,0.6)"/>

      {/* Body */}
      <path d="M192 370 Q188 400 185 475 L200 476 Q205 450 210 430 Q215 450 220 476 L235 475 Q232 400 228 370 Z" fill="#0E0C04" stroke="#1E1905" strokeWidth="0.8"/>

      {/* White kilt */}
      <path d="M192 340 Q188 365 188 395 Q195 400 210 400 Q225 400 232 395 Q232 365 228 340 Q220 350 210 350 Q200 350 192 340Z" fill="#E8D97A" opacity="0.85"/>
      <line x1="196" y1="355" x2="224" y2="355" stroke="#C9A227" strokeWidth="0.5" opacity="0.4"/>
      <line x1="194" y1="365" x2="226" y2="365" stroke="#C9A227" strokeWidth="0.5" opacity="0.3"/>
      <line x1="192" y1="375" x2="228" y2="375" stroke="#C9A227" strokeWidth="0.5" opacity="0.2"/>

      {/* Torso / ceremonial collar */}
      <path d="M190 270 Q188 305 192 340 Q200 355 210 355 Q220 355 228 340 Q232 305 230 270 Q220 258 210 256 Q200 258 190 270Z" fill="#1A1506" stroke="#2A2008" strokeWidth="0.8"/>
      {/* Usekh collar */}
      <path d="M188 270 Q210 250 232 270 Q228 285 210 288 Q192 285 188 270Z" fill="#C9A227" opacity="0.7" stroke="#F5D060" strokeWidth="0.5"/>
      {/* Collar detail lines */}
      {[0.3,0.6,0.9].map((o,i) => (
        <path key={i} d={`M${190+i*2} ${272+i*5} Q210 ${260+i*6} ${230-i*2} ${272+i*5}`} fill="none" stroke="#F5D060" strokeWidth="0.5" opacity={o*0.5}/>
      ))}

      {/* Left arm — holding crook (heqa) */}
      <path d="M190 280 Q172 300 165 330" stroke="#0E0C04" strokeWidth="13" strokeLinecap="round" fill="none"/>
      <path d="M165 330 Q160 350 162 365" stroke="#0E0C04" strokeWidth="10" strokeLinecap="round" fill="none"/>
      {/* Crook */}
      <path d="M162 362 Q155 340 145 325 Q138 315 140 305 Q150 298 158 308" stroke={T.accent} strokeWidth="3.5" strokeLinecap="round" fill="none" opacity="0.8"/>

      {/* Right arm — holding flail (nekhakha) */}
      <path d="M230 280 Q248 300 255 330" stroke="#0E0C04" strokeWidth="13" strokeLinecap="round" fill="none"/>
      <path d="M255 330 Q260 350 258 365" stroke="#0E0C04" strokeWidth="10" strokeLinecap="round" fill="none"/>
      {/* Flail handle */}
      <line x1="258" y1="363" x2="268" y2="340" stroke={T.accent} strokeWidth="3" strokeLinecap="round" opacity="0.8"/>
      {/* Flail beads */}
      <circle cx="270" cy="334" r="4" fill={T.accentBright} opacity="0.6"/>
      <circle cx="268" cy="323" r="4" fill={T.accent} opacity="0.7"/>
      <circle cx="274" cy="312" r="4" fill={T.accentBright} opacity="0.5"/>

      {/* Neck */}
      <rect x="205" y="255" width="10" height="18" rx="4" fill="#1A1506"/>

      {/* Head */}
      <circle cx="210" cy="242" r="25" fill="#C49A3C" opacity="0.9"/>
      {/* Nemes headdress */}
      <path d="M186 238 Q186 210 210 205 Q234 210 234 238 Q228 222 210 218 Q192 222 186 238Z" fill="#E8D97A" opacity="0.85"/>
      {/* Nemes side pieces */}
      <path d="M186 238 Q178 255 180 278 Q186 274 188 265 Q190 252 192 240Z" fill="#E8D97A" opacity="0.7"/>
      <path d="M234 238 Q242 255 240 278 Q234 274 232 265 Q230 252 228 240Z" fill="#E8D97A" opacity="0.7"/>
      {/* Nemes stripe lines */}
      <line x1="194" y1="220" x2="192" y2="270" stroke="#C9A227" strokeWidth="0.8" opacity="0.4"/>
      <line x1="200" y1="218" x2="198" y2="272" stroke="#C9A227" strokeWidth="0.8" opacity="0.4"/>
      <line x1="220" y1="218" x2="222" y2="272" stroke="#C9A227" strokeWidth="0.8" opacity="0.4"/>
      <line x1="226" y1="220" x2="228" y2="270" stroke="#C9A227" strokeWidth="0.8" opacity="0.4"/>
      {/* Uraeus (cobra on crown) */}
      <path d="M208 206 Q205 195 207 185 Q210 180 213 185 Q215 195 212 206" fill="#8B1A1A" stroke="#C0392B" strokeWidth="0.5" opacity="0.8"/>
      <circle cx="210" cy="183" r="4" fill="#C9A227" opacity="0.9"/>
      {/* Eyes */}
      <ellipse cx="203" cy="241" rx="4.5" ry="3" fill="#0A0800" stroke="#C9A227" strokeWidth="0.5"/>
      <ellipse cx="217" cy="241" rx="4.5" ry="3" fill="#0A0800" stroke="#C9A227" strokeWidth="0.5"/>
      <line x1="198" y1="241" x2="195" y2="244" stroke="#C9A227" strokeWidth="1" opacity="0.7"/>
      <line x1="222" y1="241" x2="225" y2="244" stroke="#C9A227" strokeWidth="1" opacity="0.7"/>
      {/* Kohl lines */}
      <path d="M199 241 Q197 239 196 236" stroke="#1A1506" strokeWidth="1.2" strokeLinecap="round" fill="none"/>
      <path d="M221 241 Q223 239 224 236" stroke="#1A1506" strokeWidth="1.2" strokeLinecap="round" fill="none"/>

      {/* Floating legacy card */}
      <g style={{ animation:'floatCard 3.2s ease-in-out infinite 0.5s' }}>
        <rect x="20" y="150" width="118" height="72" rx="8" fill="rgba(9,7,0,0.95)" stroke="rgba(201,162,39,0.5)" strokeWidth="1.2"/>
        <text x="32" y="168" fontSize="7.5" fontWeight="700" fill={T.accentBright} fontFamily="DM Sans" letterSpacing="1.2">LEGACY SCORE</text>
        <line x1="26" y1="172" x2="132" y2="172" stroke="rgba(201,162,39,0.3)" strokeWidth="0.8"/>
        <text x="32" y="192" fontSize="20" fontWeight="800" fill={T.accentBright} fontFamily="Cabinet Grotesk">94</text>
        <text x="64" y="192" fontSize="9" fill={T.textDim} fontFamily="DM Sans">/ 100</text>
        <text x="32" y="206" fontSize="8" fill={T.textDim} fontFamily="DM Sans">Daimyo Tier</text>
        <rect x="32" y="212" width="88" height="3.5" rx="1.5" fill="rgba(201,162,39,0.2)"/>
        <rect x="32" y="212" width="83" height="3.5" rx="1.5" fill={T.accent}/>
      </g>

      {/* Hieroglyph-like decorative column right */}
      <g opacity="0.12" stroke={T.accent} strokeWidth="1">
        <rect x="370" y="100" width="24" height="300" rx="2" fill="none"/>
        {[120,145,170,195,220,245,270,295,320,345].map((y,i) => (
          <rect key={i} x="374" y={y} width="16" height={i%3===0?16:10} rx="2" fill={T.accent}/>
        ))}
      </g>

      {/* Gold sparkles */}
      <circle cx="160" cy="160" r="2.5" fill={T.accentBright} style={{ animation:'sparkle 2s ease-in-out infinite' }}/>
      <circle cx="340" cy="200" r="2" fill={T.accent} style={{ animation:'sparkle 2.5s ease-in-out infinite 0.7s' }}/>
      <circle cx="80" cy="280" r="1.5" fill={T.accentBright} style={{ animation:'sparkle 2.2s ease-in-out infinite 1.2s' }}/>

      <text x="210" y="520" textAnchor="middle" fontSize="13" fontWeight="700" fill={T.text} fontFamily="Cabinet Grotesk" letterSpacing="2" opacity="0.5">𓂀 𓆣 𓁹 𓆙 𓂋</text>
      <text x="210" y="538" textAnchor="middle" fontSize="9" fill={T.textDim} fontFamily="DM Sans" letterSpacing="0.5">Eternal systems outlast their builders.</text>
    </svg>
  )
}

function IllustrationAstral({ T }: { T: LoginTheme }) {
  return (
    <svg viewBox="0 0 420 560" fill="none" xmlns="http://www.w3.org/2000/svg"
      style={{ width:'100%', maxHeight:'90vh', position:'relative', zIndex:1 }}>
      <defs>
        <radialGradient id="orb" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#A78BFA" stopOpacity="0.4"/>
          <stop offset="40%" stopColor="#7C3AED" stopOpacity="0.2"/>
          <stop offset="100%" stopColor="#7C3AED" stopOpacity="0"/>
        </radialGradient>
        <radialGradient id="coreOrb" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#EDE9FE" stopOpacity="0.95"/>
          <stop offset="30%" stopColor="#A78BFA" stopOpacity="0.8"/>
          <stop offset="70%" stopColor="#7C3AED" stopOpacity="0.5"/>
          <stop offset="100%" stopColor="#3B0764" stopOpacity="0.2"/>
        </radialGradient>
        <radialGradient id="nebulaA" cx="40%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#7C3AED" stopOpacity="0.2"/>
          <stop offset="100%" stopColor="#7C3AED" stopOpacity="0"/>
        </radialGradient>
        <radialGradient id="nebulaB" cx="60%" cy="60%" r="60%">
          <stop offset="0%" stopColor="#2DD4BF" stopOpacity="0.12"/>
          <stop offset="100%" stopColor="#2DD4BF" stopOpacity="0"/>
        </radialGradient>
        <filter id="orbGlow"><feGaussianBlur stdDeviation="8" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>

      {/* Background nebula */}
      <ellipse cx="200" cy="240" rx="180" ry="140" fill="url(#nebulaA)"/>
      <ellipse cx="240" cy="300" rx="160" ry="120" fill="url(#nebulaB)"/>

      {/* Outer glow ring */}
      <circle cx="210" cy="240" r="145" fill="url(#orb)"/>

      {/* Orbital rings */}
      <ellipse cx="210" cy="240" rx="148" ry="40" fill="none" stroke="rgba(167,139,250,0.15)" strokeWidth="1" style={{ animation:'orbitRotate 8s linear infinite' }}/>
      <ellipse cx="210" cy="240" rx="118" ry="32" fill="none" stroke="rgba(45,212,191,0.12)" strokeWidth="1" style={{ animation:'orbitRotate 12s linear infinite reverse' }}/>
      <ellipse cx="210" cy="240" rx="88" ry="24" fill="none" stroke="rgba(167,139,250,0.18)" strokeWidth="0.8" style={{ animation:'orbitRotate 6s linear infinite' }}/>

      {/* Orbiting dot on outer ring */}
      <circle r="5" fill={T.accentBright} style={{ animation:'orbitDotOuter 8s linear infinite', filter:'drop-shadow(0 0 4px #A78BFA)' }}/>
      <circle r="3.5" fill="#2DD4BF" style={{ animation:'orbitDotInner 12s linear infinite reverse', filter:'drop-shadow(0 0 3px #2DD4BF)' }}/>

      {/* Main orb */}
      <circle cx="210" cy="240" r="72" fill="url(#coreOrb)" filter="url(#orbGlow)"/>
      {/* Orb surface detail */}
      <circle cx="210" cy="240" r="72" fill="none" stroke="rgba(167,139,250,0.4)" strokeWidth="1.5"/>
      <ellipse cx="210" cy="240" rx="72" ry="20" fill="none" stroke="rgba(167,139,250,0.15)" strokeWidth="1"/>
      <ellipse cx="210" cy="240" rx="50" ry="72" fill="none" stroke="rgba(167,139,250,0.12)" strokeWidth="1"/>
      {/* Continents/swirls */}
      <path d="M185 220 Q195 210 215 215 Q230 220 225 235 Q215 245 200 240 Q185 235 185 220Z" fill="rgba(124,58,237,0.3)"/>
      <path d="M215 255 Q230 248 238 260 Q235 272 220 268 Q210 264 215 255Z" fill="rgba(45,212,191,0.2)"/>
      <path d="M178 250 Q186 240 195 248 Q196 258 188 260 Q178 258 178 250Z" fill="rgba(251,113,133,0.15)"/>
      {/* Shimmer */}
      <circle cx="190" cy="218" r="18" fill="rgba(255,255,255,0.06)"/>

      {/* Stars scattered around orb */}
      {[
        {x:80,y:100},{x:340,y:90},{x:60,y:180},{x:370,y:160},
        {x:50,y:340},{x:380,y:320},{x:100,y:420},{x:330,y:430},
        {x:155,y:70},{x:285,y:65},{x:140,y:440},{x:300,y:450},
      ].map((s,i) => (
        <circle key={i} cx={s.x} cy={s.y} r={i%4===0?2.5:1.5} fill={i%5===0?'#2DD4BF':T.accentBright} opacity="0.8"
          style={{ animation:`sparkle ${1.5+(i%4)*0.5}s ease-in-out infinite ${i*0.25}s` }}/>
      ))}

      {/* Floating data cards */}
      <g style={{ animation:'floatCard 3s ease-in-out infinite 0.8s' }}>
        <rect x="18" y="110" width="114" height="72" rx="8" fill="rgba(4,2,14,0.95)" stroke="rgba(124,58,237,0.5)" strokeWidth="1.2"/>
        <text x="30" y="128" fontSize="7.5" fontWeight="700" fill={T.accentBright} fontFamily="DM Sans" letterSpacing="1.2">VISION CLARITY</text>
        <line x1="24" y1="132" x2="126" y2="132" stroke="rgba(124,58,237,0.3)" strokeWidth="0.8"/>
        <text x="30" y="152" fontSize="22" fontWeight="800" fill={T.text} fontFamily="Cabinet Grotesk">87</text>
        <text x="62" y="152" fontSize="9" fill={T.textDim} fontFamily="DM Sans">%</text>
        <text x="30" y="166" fontSize="8" fill={T.textDim} fontFamily="DM Sans">Astral clarity index</text>
        <rect x="30" y="172" width="88" height="3.5" rx="1.5" fill="rgba(124,58,237,0.2)"/>
        <rect x="30" y="172" width="76" height="3.5" rx="1.5" fill={T.accent}/>
      </g>

      <g style={{ animation:'floatCard 2.7s ease-in-out infinite 1.5s' }}>
        <rect x="290" y="360" width="114" height="72" rx="8" fill="rgba(4,2,14,0.95)" stroke="rgba(45,212,191,0.4)" strokeWidth="1.2"/>
        <text x="302" y="378" fontSize="7.5" fontWeight="700" fill="#5EEAD4" fontFamily="DM Sans" letterSpacing="1.2">HORIZON</text>
        <line x1="296" y1="382" x2="398" y2="382" stroke="rgba(45,212,191,0.3)" strokeWidth="0.8"/>
        <text x="302" y="398" fontSize="10" fill={T.text} fontFamily="DM Sans">Q4 Strategy</text>
        <text x="302" y="412" fontSize="10" fill={T.textDim} fontFamily="DM Sans" opacity="0.7">3-year vision</text>
        <text x="302" y="426" fontSize="10" fill={T.textDim} fontFamily="DM Sans" opacity="0.4">10-year purpose</text>
      </g>

      {/* Constellation lines */}
      <g opacity="0.08" stroke={T.accentBright} strokeWidth="0.8">
        <line x1="80" y1="100" x2="60" y2="180"/>
        <line x1="340" y1="90" x2="370" y2="160"/>
        <line x1="50" y1="340" x2="100" y2="420"/>
        <line x1="380" y1="320" x2="330" y2="430"/>
      </g>

      <text x="210" y="514" textAnchor="middle" fontSize="13" fontWeight="700" fill={T.text} fontFamily="Cabinet Grotesk" letterSpacing="3" opacity="0.5">∞ · ✦ · ∞</text>
      <text x="210" y="532" textAnchor="middle" fontSize="9" fill={T.textDim} fontFamily="DM Sans" letterSpacing="0.5">Operate from the longest timeline.</text>
    </svg>
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
                ? 'linear-gradient(135deg, #1E40AF 0%, #60A5FA 60%, #1E40AF 100%)'
                : `linear-gradient(135deg, ${T.accent} 0%, ${T.accentBright} 60%, ${T.accent} 100%)`,
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>
              {T.sub}
            </span>
          </h1>
          <p style={{
            margin: '0 0 40px',
            fontSize: 16, color: T.textDim, lineHeight: 1.7, maxWidth: 420,
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
                padding: '7px 14px',
                borderRadius: key === 'samurai' ? 4 : 100,
                background: `${T.accent}0F`,
                border: `1px solid ${T.accent}2A`,
              }}>
                <Icon size={13} color={T.accentBright} />
                <span style={{ fontSize: 12.5, color: T.textDim, fontWeight: 500 }}>{label}</span>
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
                  padding: '15px 28px',
                  borderRadius: key === 'samurai' ? 6 : 14,
                  background: hovered ? T.btnBgHover : T.btnBg,
                  border: `1px solid ${hovered ? T.accentBright + '80' : T.btnBorder}`,
                  color: T.btnText, fontSize: 15, fontWeight: 600,
                  cursor: signing ? 'wait' : 'pointer',
                  fontFamily: key === 'samurai' ? "'DM Sans', sans-serif" : "'Cabinet Grotesk', sans-serif",
                  letterSpacing: key === 'samurai' ? '0.5px' : undefined,
                  transition: 'all 0.2s ease',
                  transform: hovered ? 'translateY(-1px)' : 'none',
                  boxShadow: hovered ? `0 8px 24px ${T.glow1}` : 'none',
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

      {/* Right panel — Mode illustration */}
      <div style={{
        flex: '0 0 460px',
        height: '100%',
        background: key === 'default'
          ? 'linear-gradient(170deg, rgba(30,64,175,0.1) 0%, rgba(13,15,26,0.0) 55%)'
          : `linear-gradient(170deg, ${T.glow1} 0%, transparent 55%)`,
        borderLeft: `1px solid ${T.accent}20`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Inner glow */}
        <div style={{ position:'absolute', top:'30%', left:'40%', width:320, height:320, borderRadius:'50%', background:`radial-gradient(circle, ${T.glow1} 0%, transparent 70%)`, pointerEvents:'none' }} />
        <div style={{ position:'absolute', bottom:'20%', right:'10%', width:180, height:180, borderRadius:'50%', background:`radial-gradient(circle, ${T.glow2} 0%, transparent 70%)`, pointerEvents:'none' }} />

        {key === 'default' && <IllustrationDefault />}
        {key === 'samurai' && <IllustrationSamurai T={T} />}
        {key === 'pharaoh' && <IllustrationPharaoh T={T} />}
        {key === 'astral'  && <IllustrationAstral  T={T} />}
      </div>

      {false && <svg viewBox="0 0 1 1"><path d="M0 0"/></svg>}

      <style>{`
        @keyframes floatCard  { 0%,100%{transform:translateY(0)}  50%{transform:translateY(-7px)} }
        @keyframes sparkle    { 0%,100%{opacity:.15;transform:scale(.7)} 50%{opacity:1;transform:scale(1.5)} }
        @keyframes headBob    { 0%{transform:translateY(0) rotate(-3deg)} 100%{transform:translateY(-4px) rotate(2deg)} }
        @keyframes armFront   { 0%{transform:rotate(-5deg)} 100%{transform:rotate(5deg)} }
        @keyframes armBack    { 0%{transform:rotate(5deg)} 100%{transform:rotate(-5deg)} }
        @keyframes legFront   { 0%{transform:rotate(-6deg)} 100%{transform:rotate(4deg)} }
        @keyframes legBack    { 0%{transform:rotate(4deg)} 100%{transform:rotate(-6deg)} }
        @keyframes trailFade  { 0%,100%{opacity:.1} 50%{opacity:1} }
        @keyframes petalFloat { 0%,100%{transform:translateY(0) rotate(0deg)} 50%{transform:translateY(-14px) rotate(20deg)} }
        @keyframes swordReady { 0%,100%{transform:rotate(0deg)} 50%{transform:rotate(-4deg)} }
        @keyframes eyeGlow    { 0%,100%{opacity:.7} 50%{opacity:1} }
        @keyframes starTwinkle{ 0%,100%{opacity:.3;transform:scale(.8)} 50%{opacity:1;transform:scale(1.3)} }
        @keyframes orbitRotate{ from{transform:rotateX(70deg) rotate(0deg)} to{transform:rotateX(70deg) rotate(360deg)} }
        @keyframes orbitDotOuter {
          0%   { offset-path:path('M210,240 m-148,0 a148,40 0 1,0 296,0 a148,40 0 1,0 -296,0'); offset-distance:0% }
          100% { offset-distance:100% }
        }
        @keyframes orbitDotInner {
          0%   { offset-path:path('M210,240 m-118,0 a118,32 0 1,0 236,0 a118,32 0 1,0 -236,0'); offset-distance:0% }
          100% { offset-distance:100% }
        }
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
  // Samurai mode overrides the selected theme with its own palette.
  useLayoutEffect(() => {
    if (behavioralEnabled && behavioralMode === 'samurai') {
      applySamuraiModeOverride()
    } else {
      applyThemeVars(getTheme(themeId))
    }
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

  if (loading) return <LoadingScreen />
  if (!user)   return <LoginScreen />

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--color-bg, #0D0F1A)' }}>
      <Sidebar />
      <PageShell>
        <ActiveModule />
      </PageShell>
      <AssistantPanel open={assistantOpen} onClose={() => setAssistantOpen(false)} />
      <AssistantToggle open={assistantOpen} onClick={() => setAssistantOpen(o => !o)} />
    </div>
  )
}

export default App

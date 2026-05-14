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
import { GraduationCap, Swords, Crown, Sparkles, Calendar, Mail, CheckSquare, Brain, ArrowRight } from 'lucide-react'

const MODE_ICONS: Record<string, typeof GraduationCap> = {
  default: GraduationCap,
  samurai: Swords,
  pharaoh: Crown,
  astral:  Sparkles,
}

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

const MODE_QUOTES: Record<string, string> = {
  default: 'Stay ahead. Stay organized.',
  samurai: '七転び八起き — Fall seven times. Rise eight.',
  pharaoh: 'Eternal systems outlast their builders.',
  astral:  'Operate from the longest timeline.',
}

// ─── Cinematic right-panel scenes ────────────────────────────────────────────

function SceneSamurai() {
  return (
    <svg style={{ position:'absolute', inset:0, width:'100%', height:'100%' }}
      viewBox="0 0 460 720" preserveAspectRatio="xMidYMax slice" fill="none">
      <defs>
        <filter id="sceneGrain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="4" stitchTiles="stitch" result="noise"/>
          <feColorMatrix type="saturate" values="0" in="noise" result="grey"/>
          <feBlend in="SourceGraphic" in2="grey" mode="overlay"/>
        </filter>
        <radialGradient id="smMoon" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#2A0A0A"/><stop offset="70%" stopColor="#180606"/><stop offset="100%" stopColor="#0F0303"/></radialGradient>
        <radialGradient id="smMoonGlow" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#8B1A1A" stopOpacity="0.55"/><stop offset="50%" stopColor="#5C0A0A" stopOpacity="0.2"/><stop offset="100%" stopColor="#8B1A1A" stopOpacity="0"/></radialGradient>
        <linearGradient id="smMist" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3D0808" stopOpacity="0"/><stop offset="100%" stopColor="#5C1010" stopOpacity="0.35"/></linearGradient>
      </defs>

      {/* Sky */}
      <rect width="460" height="720" fill="#060202"/>
      {/* Moon corona */}
      <circle cx="338" cy="148" r="200" fill="url(#smMoonGlow)"/>
      {/* Moon disc */}
      <circle cx="338" cy="148" r="94" fill="url(#smMoon)"/>
      <path d="M308,112 Q324,100 348,108 Q366,120 368,142 Q360,162 340,156 Q314,148 308,112Z" fill="#0F0303" opacity="0.45"/>
      <circle cx="326" cy="136" r="22" fill="#0F0303" opacity="0.35"/>
      <circle cx="338" cy="148" r="94" fill="none" stroke="#6B1010" strokeWidth="1.5" opacity="0.4"/>

      {/* Stars */}
      {[[44,42],[112,28],[190,68],[22,118],[82,176],[158,92],[432,62],[406,195],[60,240],[22,300]].map(([x,y],i)=>(
        <circle key={i} cx={x} cy={y} r={i%4===0?1.8:1} fill="white" opacity={0.3+i%3*0.15}/>
      ))}

      {/* Mountain layers — far to near */}
      <path d="M0,435 L45,345 L95,398 L155,318 L210,378 L265,292 L318,358 L370,275 L418,328 L460,302 L460,720 L0,720Z" fill="#130808" opacity="0.75"/>
      <path d="M0,490 L55,402 L115,450 L175,372 L235,428 L292,350 L352,408 L412,365 L460,388 L460,720 L0,720Z" fill="#0E0505" opacity="0.88"/>
      <path d="M0,545 L62,455 L125,505 L185,425 L248,482 L308,408 L365,462 L422,432 L460,452 L460,720 L0,720Z" fill="#090303"/>
      <path d="M0,590 Q115,568 230,572 Q345,577 460,562 L460,720 L0,720Z" fill="#060202"/>

      {/* Ground mist */}
      <rect x="0" y="545" width="460" height="175" fill="url(#smMist)"/>
      <ellipse cx="230" cy="610" rx="230" ry="55" fill="#4A0A0A" opacity="0.1"/>

      {/* Samurai silhouette */}
      <g transform="translate(162,328)">
        <ellipse cx="58" cy="244" rx="40" ry="9" fill="#3D0808" opacity="0.45"/>
        {/* Feet */}
        <ellipse cx="44" cy="243" rx="13" ry="5" fill="#060202" transform="rotate(-6,44,243)"/>
        <ellipse cx="72" cy="243" rx="14" ry="5" fill="#060202" transform="rotate(5,72,243)"/>
        {/* Hakama */}
        <path d="M32,178 Q27,205 25,240 L58,242 Q60,214 58,194 Q56,214 58,240 L76,242 Q82,205 80,178Z" fill="#060202"/>
        {/* Kimono / body */}
        <path d="M26,92 Q22,132 28,178 L88,178 Q94,132 90,92 Q78,74 58,71 Q38,74 26,92Z" fill="#060202"/>
        {/* Sash */}
        <rect x="28" y="138" width="60" height="16" rx="1" fill="#0A0202"/>
        {/* Left arm – at rest */}
        <path d="M28,98 Q12,124 8,158" stroke="#060202" strokeWidth="17" strokeLinecap="round" fill="none"/>
        <path d="M8,158 Q4,174 7,190" stroke="#060202" strokeWidth="13" strokeLinecap="round" fill="none"/>
        {/* Right arm – raised, holding katana */}
        <path d="M88,98 Q106,72 122,50" stroke="#060202" strokeWidth="17" strokeLinecap="round" fill="none"/>
        <path d="M122,50 Q132,34 138,18" stroke="#060202" strokeWidth="13" strokeLinecap="round" fill="none"/>
        {/* Katana blade */}
        <path d="M140,14 L78,-105" stroke="#1A0606" strokeWidth="3.5" strokeLinecap="round"/>
        <path d="M140,14 L78,-105" stroke="#6B1010" strokeWidth="1.2" strokeLinecap="round" opacity="0.5"/>
        {/* Tsuba */}
        <ellipse cx="140" cy="14" rx="9" ry="5" fill="#0A0202" stroke="#3D1010" strokeWidth="1" transform="rotate(-50,140,14)"/>
        {/* Handle */}
        <path d="M142,18 Q148,32 152,44" stroke="#0A0202" strokeWidth="10" strokeLinecap="round" fill="none"/>
        {/* Head */}
        <circle cx="58" cy="60" r="26" fill="#060202"/>
        {/* Kabuto */}
        <path d="M33,58 Q33,24 58,18 Q83,24 83,58 Q76,38 58,34 Q40,38 33,58Z" fill="#060202"/>
        {/* Kuwagata horns */}
        <path d="M50,20 Q42,4 46,-8 Q50,4 52,18" fill="#060202"/>
        <path d="M66,20 Q74,4 70,-8 Q66,4 64,18" fill="#060202"/>
        <line x1="58" y1="18" x2="58" y2="0" stroke="#6B1010" strokeWidth="1.5" opacity="0.35"/>
      </g>

      {/* Scattered petals (static) */}
      {[[82,390,30],[310,420,45],[150,460,15],[390,350,60],[46,510,20]].map(([x,y,r],i)=>(
        <ellipse key={i} cx={x} cy={y} rx={5} ry={3} fill="#8B1A1A" opacity="0.22" transform={`rotate(${r},${x},${y})`}/>
      ))}

      {/* Grain overlay */}
      <rect width="460" height="720" fill="#080202" opacity="0.04" filter="url(#sceneGrain)"/>
    </svg>
  )
}

function ScenePharaoh() {
  return (
    <svg style={{ position:'absolute', inset:0, width:'100%', height:'100%' }}
      viewBox="0 0 460 720" preserveAspectRatio="xMidYMax slice" fill="none">
      <defs>
        <filter id="phGrain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="4" stitchTiles="stitch" result="noise"/>
          <feColorMatrix type="saturate" values="0" in="noise" result="grey"/>
          <feBlend in="SourceGraphic" in2="grey" mode="overlay"/>
        </filter>
        <radialGradient id="phHorizon" cx="50%" cy="100%" r="60%"><stop offset="0%" stopColor="#C9A227" stopOpacity="0.3"/><stop offset="100%" stopColor="#C9A227" stopOpacity="0"/></radialGradient>
        <radialGradient id="phMoon" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#2A2208"/><stop offset="70%" stopColor="#1A1504"/><stop offset="100%" stopColor="#100E02"/></radialGradient>
      </defs>

      <rect width="460" height="720" fill="#060500"/>
      <ellipse cx="230" cy="720" rx="280" ry="180" fill="url(#phHorizon)"/>

      {/* Stars */}
      {[[40,38],[110,22],[185,52],[270,28],[355,48],[420,30],[68,82],[160,74],[308,68],[422,90],[25,130],[390,145],[80,170],[240,155],[440,195]].map(([x,y],i)=>(
        <circle key={i} cx={x} cy={y} r={i%5===0?2:1.2} fill={i%7===0?'#F5D060':'white'} opacity={0.4+i%3*0.2}/>
      ))}

      {/* Moon */}
      <circle cx="360" cy="130" r="52" fill="url(#phMoon)"/>
      <circle cx="360" cy="130" r="52" fill="none" stroke="#4A3D10" strokeWidth="1" opacity="0.6"/>
      <circle cx="348" cy="120" r="20" fill="#100E02" opacity="0.5"/>

      {/* Ground horizon */}
      <rect x="0" y="520" width="460" height="200" fill="#060500"/>
      <path d="M0,520 Q100,510 230,515 Q360,520 460,508 L460,720 L0,720Z" fill="#080600"/>
      <line x1="0" y1="522" x2="460" y2="510" stroke="#C9A227" strokeWidth="0.6" opacity="0.25"/>

      {/* Pyramid silhouettes — three, different sizes */}
      <path d="M230,165 L390,518 L70,518Z" fill="#0C0900"/>
      {/* Pyramid face shading */}
      <path d="M230,165 L390,518 L310,518 L230,250Z" fill="#100D02" opacity="0.5"/>
      <path d="M230,165 L390,518 L70,518Z" fill="none" stroke="#C9A227" strokeWidth="0.7" opacity="0.18"/>

      <path d="M95,280 L188,518 L2,518Z" fill="#090700"/>
      <path d="M95,280 L188,518 L140,518 L95,340Z" fill="#0E0B02" opacity="0.5"/>

      <path d="M395,310 L452,518 L338,518Z" fill="#090700"/>

      {/* Sand dunes */}
      <path d="M0,558 Q80,536 160,548 Q240,560 320,542 Q390,530 460,545 L460,720 L0,720Z" fill="#060500"/>

      {/* Eye of Horus (faint, on main pyramid) */}
      <g transform="translate(230,360)" opacity="0.3">
        <ellipse cx="0" cy="0" rx="22" ry="11" fill="none" stroke="#C9A227" strokeWidth="1.2"/>
        <circle cx="0" cy="0" r="5.5" fill="#C9A227" opacity="0.6"/>
        <circle cx="0" cy="0" r="2.5" fill="#F5D060"/>
        <path d="M-22,0 Q-30,8 -24,14" fill="none" stroke="#C9A227" strokeWidth="1" opacity="0.7"/>
      </g>

      {/* Grain */}
      <rect width="460" height="720" fill="#060500" opacity="0.05" filter="url(#phGrain)"/>
    </svg>
  )
}

function SceneAstral() {
  return (
    <svg style={{ position:'absolute', inset:0, width:'100%', height:'100%' }}
      viewBox="0 0 460 720" preserveAspectRatio="xMidYMax slice" fill="none">
      <defs>
        <filter id="asGrain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="4" stitchTiles="stitch" result="noise"/>
          <feColorMatrix type="saturate" values="0" in="noise" result="grey"/>
          <feBlend in="SourceGraphic" in2="grey" mode="overlay"/>
        </filter>
        <radialGradient id="asNebA" cx="40%" cy="38%" r="55%"><stop offset="0%" stopColor="#7C3AED" stopOpacity="0.28"/><stop offset="100%" stopColor="#7C3AED" stopOpacity="0"/></radialGradient>
        <radialGradient id="asNebB" cx="65%" cy="62%" r="55%"><stop offset="0%" stopColor="#2DD4BF" stopOpacity="0.15"/><stop offset="100%" stopColor="#2DD4BF" stopOpacity="0"/></radialGradient>
        <radialGradient id="asPlanet" cx="40%" cy="35%" r="50%"><stop offset="0%" stopColor="#4C1D95"/><stop offset="60%" stopColor="#2E1065"/><stop offset="100%" stopColor="#1A0840"/></radialGradient>
        <radialGradient id="asRing" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#7C3AED" stopOpacity="0"/><stop offset="85%" stopColor="#7C3AED" stopOpacity="0.3"/><stop offset="100%" stopColor="#7C3AED" stopOpacity="0"/></radialGradient>
      </defs>

      <rect width="460" height="720" fill="#04020E"/>

      {/* Nebula washes */}
      <ellipse cx="190" cy="280" rx="220" ry="200" fill="url(#asNebA)"/>
      <ellipse cx="300" cy="420" rx="200" ry="180" fill="url(#asNebB)"/>
      <ellipse cx="380" cy="180" rx="140" ry="120" fill="#4C1D95" opacity="0.08"/>

      {/* Star field - two sizes */}
      {Array.from({length:80},(_,i)=>([
        (i*137+i*43)%460, (i*97+i*31)%720, i%8===0?2.2:i%4===0?1.5:0.9,
        i%9===0?'#2DD4BF':i%7===0?'#A78BFA':'white',
        0.3+i%5*0.14,
      ])).map(([x,y,r,c,o],i)=>(
        <circle key={i} cx={x as number} cy={y as number} r={r as number} fill={c as string} opacity={o as number}/>
      ))}

      {/* Planet */}
      <circle cx="330" cy="185" r="78" fill="url(#asPlanet)"/>
      {/* Ring system */}
      <ellipse cx="330" cy="185" rx="118" ry="28" fill="none" stroke="#7C3AED" strokeWidth="8" opacity="0.25"/>
      <ellipse cx="330" cy="185" rx="118" ry="28" fill="none" stroke="#A78BFA" strokeWidth="1.5" opacity="0.35"/>
      <ellipse cx="330" cy="185" rx="98" ry="22" fill="none" stroke="#7C3AED" strokeWidth="5" opacity="0.18"/>
      {/* Planet surface detail */}
      <path d="M280,168 Q305,158 340,162 Q365,168 370,182 Q360,196 335,192 Q305,186 280,168Z" fill="#3B0F8C" opacity="0.5"/>
      <path d="M285,190 Q312,182 345,188 Q355,196 340,202 Q318,204 285,190Z" fill="#2DD4BF" opacity="0.1"/>
      {/* Planet shadow edge */}
      <circle cx="330" cy="185" r="78" fill="none" stroke="#A78BFA" strokeWidth="1.5" opacity="0.4"/>

      {/* Grain */}
      <rect width="460" height="720" fill="#04020E" opacity="0.04" filter="url(#asGrain)"/>
    </svg>
  )
}

function SceneDefault() {
  return (
    <svg style={{ position:'absolute', inset:0, width:'100%', height:'100%' }}
      viewBox="0 0 460 720" preserveAspectRatio="xMidYMax slice" fill="none">
      <defs>
        <filter id="dfGrain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="4" stitchTiles="stitch" result="noise"/>
          <feColorMatrix type="saturate" values="0" in="noise" result="grey"/>
          <feBlend in="SourceGraphic" in2="grey" mode="overlay"/>
        </filter>
        <radialGradient id="dfGlow" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#1E40AF" stopOpacity="0.35"/><stop offset="100%" stopColor="#1E40AF" stopOpacity="0"/></radialGradient>
        <radialGradient id="dfMoon" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#1A2A4A"/><stop offset="70%" stopColor="#0E1D36"/><stop offset="100%" stopColor="#0A1428"/></radialGradient>
      </defs>

      <rect width="460" height="720" fill="#060810"/>
      <circle cx="290" cy="195" r="190" fill="url(#dfGlow)"/>

      {/* Stars */}
      {[[50,45],[118,28],[192,60],[35,120],[88,175],[162,92],[440,62],[410,195],[60,240],[25,305],[445,320],[18,390]].map(([x,y],i)=>(
        <circle key={i} cx={x} cy={y} r={i%4===0?1.8:1.1} fill={i%5===0?'#93C5FD':'white'} opacity={0.3+i%3*0.18}/>
      ))}

      {/* Moon */}
      <circle cx="290" cy="195" r="86" fill="url(#dfMoon)"/>
      <circle cx="278" cy="180" r="25" fill="#0A1428" opacity="0.5"/>
      <circle cx="305" cy="210" r="14" fill="#0A1428" opacity="0.38"/>
      <circle cx="290" cy="195" r="86" fill="none" stroke="#1E3A8A" strokeWidth="1.5" opacity="0.5"/>
      <circle cx="290" cy="195" r="100" fill="none" stroke="#1E3A8A" strokeWidth="0.8" opacity="0.2"/>

      {/* Mountain layers */}
      <path d="M0,432 L42,348 L95,396 L152,318 L208,375 L262,295 L316,352 L368,278 L416,326 L460,300 L460,720 L0,720Z" fill="#0C1220" opacity="0.8"/>
      <path d="M0,488 L52,400 L112,448 L172,368 L232,425 L290,345 L350,404 L410,362 L460,385 L460,720 L0,720Z" fill="#080E1A" opacity="0.9"/>
      <path d="M0,545 L60,455 L122,505 L182,425 L244,480 L305,408 L362,462 L420,432 L460,452 L460,720 L0,720Z" fill="#060A14"/>

      {/* City lights at base */}
      {Array.from({length:28},(_,i)=>([
        (i*37+i*11)%420+20, 548+(i%3)*4, i%6===0?3:i%3===0?2:1.5, i%5===0?'#60A5FA':i%3===0?'#F59E0B':'#E2E8F0'
      ])).map(([x,y,r,c],i)=>(
        <circle key={i} cx={x as number} cy={y as number} r={r as number} fill={c as string} opacity={0.4+i%4*0.12}/>
      ))}
      <rect x="0" y="560" width="460" height="160" fill="#060810" opacity="0.7"/>

      {/* Grain */}
      <rect width="460" height="720" fill="#060810" opacity="0.04" filter="url(#dfGrain)"/>
    </svg>
  )
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
            {(() => { const ModeIcon = MODE_ICONS[key] ?? GraduationCap; return <ModeIcon size={24} color={T.bg} strokeWidth={2.5} /> })()}
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

      {/* Right panel — cinematic scene */}
      <div style={{
        flex: '0 0 460px',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        background: key === 'samurai' ? '#060202' : key === 'pharaoh' ? '#060500' : key === 'astral' ? '#04020E' : '#060810',
      }}>
        {/* Cinematic scene */}
        {key === 'samurai' && <SceneSamurai />}
        {key === 'pharaoh' && <ScenePharaoh />}
        {key === 'astral'  && <SceneAstral />}
        {key === 'default' && <SceneDefault />}

        {/* Left-edge fade — blends into the left panel */}
        <div style={{
          position: 'absolute', inset: 0,
          background: `linear-gradient(to right, ${T.bg} 0%, ${T.bg}D0 5%, ${T.bg}70 18%, transparent 40%)`,
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

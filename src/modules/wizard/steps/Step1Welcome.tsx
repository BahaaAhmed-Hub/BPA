import { THEMES, getTheme, applyThemeVars } from '@/lib/themes'
import type { WizardData } from '../SetupWizard'

interface Props {
  data: WizardData
  onChange: (p: Partial<WizardData>) => void
}

// Hero SVG illustration — warm landscape with sunrise, trees and a person
function HeroIllustration() {
  return (
    <svg width="100%" viewBox="0 0 560 220" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', borderRadius: 14 }}>
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#FEF3C7" />
          <stop offset="50%"  stopColor="#FDE68A" />
          <stop offset="100%" stopColor="#FBBF24" />
        </linearGradient>
        <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#6B7280" />
          <stop offset="100%" stopColor="#374151" />
        </linearGradient>
        <radialGradient id="sun" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#FFFBEB" />
          <stop offset="60%"  stopColor="#FDE68A" />
          <stop offset="100%" stopColor="#F59E0B" />
        </radialGradient>
        <radialGradient id="glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#FDE68A" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#FDE68A" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Sky */}
      <rect width="560" height="220" fill="url(#sky)" />

      {/* Sun glow */}
      <ellipse cx="280" cy="130" rx="80" ry="60" fill="url(#glow)" />

      {/* Sun */}
      <circle cx="280" cy="138" r="36" fill="url(#sun)" />
      <circle cx="280" cy="138" r="30" fill="#FEF3C7" opacity="0.8" />

      {/* Sun rays */}
      {[0,30,60,90,120,150,180,210,240,270,300,330].map((deg, i) => (
        <line key={i}
          x1={280 + Math.cos(deg * Math.PI/180) * 42}
          y1={138 + Math.sin(deg * Math.PI/180) * 42}
          x2={280 + Math.cos(deg * Math.PI/180) * 56}
          y2={138 + Math.sin(deg * Math.PI/180) * 56}
          stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round" opacity="0.7"
        />
      ))}

      {/* Rolling hills */}
      <path d="M0,180 Q80,140 160,165 Q240,185 320,155 Q400,128 480,160 Q520,174 560,165 L560,220 L0,220 Z" fill="#4B5563" />
      <path d="M0,195 Q60,178 140,188 Q220,198 300,182 Q380,168 460,185 Q510,193 560,180 L560,220 L0,220 Z" fill="#374151" />
      <path d="M0,208 Q80,200 160,204 Q240,208 320,200 Q400,194 480,202 L560,205 L560,220 L0,220 Z" fill="#1F2937" />

      {/* Path / road */}
      <path d="M250,220 Q260,200 265,185 Q270,170 272,158" stroke="#6B7280" strokeWidth="3" strokeLinecap="round" opacity="0.5" />

      {/* Left pine trees */}
      <g opacity="0.85">
        <polygon points="52,185 68,140 84,185" fill="#1F2937" />
        <polygon points="60,185 72,150 84,185" fill="#374151" />
        <rect x="64" y="185" width="7" height="12" fill="#111827" />

        <polygon points="24,188 38,148 52,188" fill="#1F2937" />
        <polygon points="30,188 40,156 50,188" fill="#374151" />
        <rect x="34" y="188" width="6" height="10" fill="#111827" />

        <polygon points="80,188 92,153 104,188" fill="#374151" opacity="0.7" />
        <rect x="88" y="188" width="5" height="10" fill="#111827" opacity="0.7" />
      </g>

      {/* Right pine trees */}
      <g opacity="0.85">
        <polygon points="476,185 492,140 508,185" fill="#1F2937" />
        <polygon points="484,185 496,150 508,185" fill="#374151" />
        <rect x="489" y="185" width="7" height="12" fill="#111827" />

        <polygon points="505,188 519,148 533,188" fill="#1F2937" />
        <polygon points="511,188 521,156 531,188" fill="#374151" />
        <rect x="515" y="188" width="6" height="10" fill="#111827" />

        <polygon points="455,188 467,153 479,188" fill="#374151" opacity="0.7" />
        <rect x="463" y="188" width="5" height="10" fill="#111827" opacity="0.7" />
      </g>

      {/* Person (hiker silhouette) */}
      <g transform="translate(255, 168)">
        {/* Body */}
        <ellipse cx="9" cy="5" rx="4" ry="5" fill="#111827" />
        {/* Head */}
        <circle cx="9" cy="-3" r="4" fill="#111827" />
        {/* Backpack */}
        <rect x="11" y="1" width="5" height="7" rx="1.5" fill="#374151" />
        {/* Legs */}
        <line x1="7" y1="10" x2="4" y2="19" stroke="#111827" strokeWidth="2.5" strokeLinecap="round" />
        <line x1="11" y1="10" x2="14" y2="19" stroke="#111827" strokeWidth="2.5" strokeLinecap="round" />
        {/* Arms */}
        <line x1="5" y1="4" x2="1" y2="10" stroke="#111827" strokeWidth="2" strokeLinecap="round" />
        <line x1="13" y1="4" x2="17" y2="10" stroke="#111827" strokeWidth="2" strokeLinecap="round" />
        {/* Walking stick */}
        <line x1="17" y1="10" x2="20" y2="22" stroke="#4B5563" strokeWidth="1.8" strokeLinecap="round" />
      </g>

      {/* Stars (subtle) */}
      {[[40,20],[100,12],[160,8],[380,6],[440,15],[500,10],[530,22],[80,35],[200,18]].map(([x,y],i) => (
        <circle key={i} cx={x} cy={y} r="1.2" fill="#FEF3C7" opacity="0.6" />
      ))}
    </svg>
  )
}

const FEATURES = [
  { emoji: '🧠', title: 'AI Prioritization', desc: 'Eisenhower matrix for ruthless focus' },
  { emoji: '☀️', title: 'Morning Brief',     desc: 'Start each day with AI-powered clarity' },
  { emoji: '🔥', title: 'Habit Tracking',   desc: 'Build systems that compound over time' },
]

export function Step1Welcome({ data, onChange }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <style>{`
        .wz-theme-card { transition: transform 0.15s ease, box-shadow 0.15s ease; }
        .wz-theme-card:hover { transform: translateY(-2px) scale(1.03); }
        .wz-feature-card { transition: transform 0.15s, box-shadow 0.15s; }
        .wz-feature-card:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.08)!important; }
      `}</style>

      {/* Hero illustration */}
      <div style={{ borderRadius: 14, overflow: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}>
        <HeroIllustration />
      </div>

      {/* Heading */}
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 24, fontWeight: 800, color: '#111827', lineHeight: 1.3 }}>
          Welcome to The Professor 👋
        </h1>
        <p style={{ margin: 0, fontSize: 14.5, color: '#6B7280', lineHeight: 1.6 }}>
          Let's set up your AI executive OS in just a few minutes.
        </p>
      </div>

      {/* Feature cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
        {FEATURES.map(f => (
          <div key={f.title} className="wz-feature-card" style={{
            padding: '14px 12px', borderRadius: 12, textAlign: 'center',
            background: '#F8F8FC', border: '1px solid #EBEBF0',
            boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
          }}>
            <div style={{ fontSize: 26, marginBottom: 8 }}>{f.emoji}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 4 }}>{f.title}</div>
            <div style={{ fontSize: 11.5, color: '#9CA3AF', lineHeight: 1.4 }}>{f.desc}</div>
          </div>
        ))}
      </div>

      {/* Name field */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          What should we call you?
        </label>
        <input
          type="text"
          value={data.displayName}
          onChange={e => onChange({ displayName: e.target.value })}
          placeholder="Your name..."
          autoFocus
          style={{
            background: '#FFFFFF', border: '1.5px solid #E5E7EB', borderRadius: 10,
            padding: '11px 14px', color: '#111827', fontSize: 14, outline: 'none',
            width: '100%', boxSizing: 'border-box',
            boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
            transition: 'border-color 0.15s',
          }}
          onFocus={e => { e.target.style.borderColor = '#F5D14E' }}
          onBlur={e => { e.target.style.borderColor = '#E5E7EB' }}
        />
      </div>

      {/* Theme picker (compact) */}
      <div>
        <label style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 10 }}>
          Choose your theme
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
          {THEMES.map(theme => {
            const active = data.themeId === theme.id
            return (
              <button key={theme.id} className="wz-theme-card" onClick={() => {
                applyThemeVars(getTheme(theme.id))
                onChange({ themeId: theme.id })
              }} style={{
                padding: 0, border: active ? `2.5px solid ${theme.accent}` : '2.5px solid transparent',
                borderRadius: 10, background: 'transparent', cursor: 'pointer', outline: 'none',
                boxShadow: active ? `0 0 0 3px ${theme.accent}33` : 'none',
                transition: 'all 0.15s',
              }}>
                <div style={{ height: 42, background: theme.bg, borderRadius: '7px 7px 0 0', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: theme.accent, boxShadow: `0 0 6px ${theme.accent}99` }} />
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 10, background: theme.surface, borderTop: `1px solid ${theme.border}` }} />
                  {active && (
                    <div style={{ position: 'absolute', top: 3, right: 3, width: 13, height: 13, borderRadius: '50%', background: theme.accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="7" height="7" viewBox="0 0 7 7"><polyline points="1,3.5 2.8,5.2 6,1.5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>
                    </div>
                  )}
                </div>
                <div style={{ padding: '4px 3px 5px', background: '#F8F8FC', borderRadius: '0 0 7px 7px', borderTop: '1px solid #EBEBF0' }}>
                  <div style={{ fontSize: 10, color: active ? theme.accent : '#6B7280', fontWeight: active ? 700 : 500, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {theme.emoji} {theme.name}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <p style={{ margin: 0, fontSize: 12, color: '#9CA3AF', textAlign: 'center', fontStyle: 'italic' }}>
        This will only take about 2 minutes. Let's get started!
      </p>
    </div>
  )
}

import { THEMES, applyAppearance } from '@/lib/themes'
import type { WizardData } from '../SetupWizard'

interface Props {
  data: WizardData
  onChange: (p: Partial<WizardData>) => void
}

// Hero SVG illustration — warm landscape with sunrise, trees and a person
function HeroIllustration() {
  return (
    <svg width="100%" viewBox="0 0 560 220" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', borderRadius: 'var(--sb-r-card)' }}>
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="var(--sb-accent-tint)" />
          <stop offset="50%"  stopColor="var(--sb-accent)" />
          <stop offset="100%" stopColor="var(--sb-accent)" />
        </linearGradient>
        <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="var(--sb-ink-4)" />
          <stop offset="100%" stopColor="var(--sb-ink-2)" />
        </linearGradient>
        <radialGradient id="sun" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="var(--sb-accent-tint)" />
          <stop offset="60%"  stopColor="var(--sb-accent)" />
          <stop offset="100%" stopColor="var(--sb-warning)" />
        </radialGradient>
        <radialGradient id="glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="var(--sb-accent)" stopOpacity="0.5" />
          <stop offset="100%" stopColor="var(--sb-accent)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Sky */}
      <rect width="560" height="220" fill="url(#sky)" />

      {/* Sun glow */}
      <ellipse cx="280" cy="130" rx="80" ry="60" fill="url(#glow)" />

      {/* Sun */}
      <circle cx="280" cy="138" r="36" fill="url(#sun)" />
      <circle cx="280" cy="138" r="30" fill="var(--sb-accent-tint)" opacity="0.8" />

      {/* Sun rays */}
      {[0,30,60,90,120,150,180,210,240,270,300,330].map((deg, i) => (
        <line key={i}
          x1={280 + Math.cos(deg * Math.PI/180) * 42}
          y1={138 + Math.sin(deg * Math.PI/180) * 42}
          x2={280 + Math.cos(deg * Math.PI/180) * 56}
          y2={138 + Math.sin(deg * Math.PI/180) * 56}
          stroke="var(--sb-warning)" strokeWidth="2.5" strokeLinecap="round" opacity="0.7"
        />
      ))}

      {/* Rolling hills */}
      <path d="M0,180 Q80,140 160,165 Q240,185 320,155 Q400,128 480,160 Q520,174 560,165 L560,220 L0,220 Z" fill="var(--sb-ink-3)" />
      <path d="M0,195 Q60,178 140,188 Q220,198 300,182 Q380,168 460,185 Q510,193 560,180 L560,220 L0,220 Z" fill="var(--sb-ink-2)" />
      <path d="M0,208 Q80,200 160,204 Q240,208 320,200 Q400,194 480,202 L560,205 L560,220 L0,220 Z" fill="var(--sb-ink-1)" />

      {/* Path / road */}
      <path d="M250,220 Q260,200 265,185 Q270,170 272,158" stroke="var(--sb-ink-4)" strokeWidth="3" strokeLinecap="round" opacity="0.5" />

      {/* Left pine trees */}
      <g opacity="0.85">
        <polygon points="52,185 68,140 84,185" fill="var(--sb-ink-1)" />
        <polygon points="60,185 72,150 84,185" fill="var(--sb-ink-2)" />
        <rect x="64" y="185" width="7" height="12" fill="var(--sb-ink-1)" />

        <polygon points="24,188 38,148 52,188" fill="var(--sb-ink-1)" />
        <polygon points="30,188 40,156 50,188" fill="var(--sb-ink-2)" />
        <rect x="34" y="188" width="6" height="10" fill="var(--sb-ink-1)" />

        <polygon points="80,188 92,153 104,188" fill="var(--sb-ink-2)" opacity="0.7" />
        <rect x="88" y="188" width="5" height="10" fill="var(--sb-ink-1)" opacity="0.7" />
      </g>

      {/* Right pine trees */}
      <g opacity="0.85">
        <polygon points="476,185 492,140 508,185" fill="var(--sb-ink-1)" />
        <polygon points="484,185 496,150 508,185" fill="var(--sb-ink-2)" />
        <rect x="489" y="185" width="7" height="12" fill="var(--sb-ink-1)" />

        <polygon points="505,188 519,148 533,188" fill="var(--sb-ink-1)" />
        <polygon points="511,188 521,156 531,188" fill="var(--sb-ink-2)" />
        <rect x="515" y="188" width="6" height="10" fill="var(--sb-ink-1)" />

        <polygon points="455,188 467,153 479,188" fill="var(--sb-ink-2)" opacity="0.7" />
        <rect x="463" y="188" width="5" height="10" fill="var(--sb-ink-1)" opacity="0.7" />
      </g>

      {/* Person (hiker silhouette) */}
      <g transform="translate(255, 168)">
        {/* Body */}
        <ellipse cx="9" cy="5" rx="4" ry="5" fill="var(--sb-ink-1)" />
        {/* Head */}
        <circle cx="9" cy="-3" r="4" fill="var(--sb-ink-1)" />
        {/* Backpack */}
        <rect x="11" y="1" width="5" height="7" rx="1.5" fill="var(--sb-ink-2)" />
        {/* Legs */}
        <line x1="7" y1="10" x2="4" y2="19" stroke="var(--sb-ink-1)" strokeWidth="2.5" strokeLinecap="round" />
        <line x1="11" y1="10" x2="14" y2="19" stroke="var(--sb-ink-1)" strokeWidth="2.5" strokeLinecap="round" />
        {/* Arms */}
        <line x1="5" y1="4" x2="1" y2="10" stroke="var(--sb-ink-1)" strokeWidth="2" strokeLinecap="round" />
        <line x1="13" y1="4" x2="17" y2="10" stroke="var(--sb-ink-1)" strokeWidth="2" strokeLinecap="round" />
        {/* Walking stick */}
        <line x1="17" y1="10" x2="20" y2="22" stroke="var(--sb-ink-3)" strokeWidth="1.8" strokeLinecap="round" />
      </g>

      {/* Stars (subtle) */}
      {[[40,20],[100,12],[160,8],[380,6],[440,15],[500,10],[530,22],[80,35],[200,18]].map(([x,y],i) => (
        <circle key={i} cx={x} cy={y} r="1.2" fill="var(--sb-accent-tint)" opacity="0.6" />
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
      <div style={{ borderRadius: 'var(--sb-r-card)', overflow: 'hidden', boxShadow: 'var(--sb-shadow-hover)' }}>
        <HeroIllustration />
      </div>

      {/* Heading */}
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 'var(--sb-t-h1)', fontWeight: 800, color: 'var(--sb-ink-1)', lineHeight: 1.3 }}>
          Welcome to The Professor 👋
        </h1>
        <p style={{ margin: 0, fontSize: 'var(--sb-t-h3)', color: 'var(--sb-ink-3)', lineHeight: 1.6 }}>
          Let's set up your AI executive OS in just a few minutes.
        </p>
      </div>

      {/* Feature cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
        {FEATURES.map(f => (
          <div key={f.title} className="wz-feature-card" style={{
            padding: '14px 12px', borderRadius: 'var(--sb-r-nav)', textAlign: 'center',
            background: 'var(--sb-info-tint)', border: '1px solid color-mix(in srgb, var(--sb-info) 20%, transparent)',
            boxShadow: 'var(--sb-shadow-control)',
          }}>
            <div style={{ fontSize: 'var(--sb-t-h1)', marginBottom: 8 }}>{f.emoji}</div>
            <div style={{ fontSize: 'var(--sb-t-label)', fontWeight: 700, color: 'var(--sb-ink-1)', marginBottom: 4 }}>{f.title}</div>
            <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', lineHeight: 1.4 }}>{f.desc}</div>
          </div>
        ))}
      </div>

      {/* Name field */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          What should we call you?
        </label>
        <input
          type="text"
          value={data.displayName}
          onChange={e => onChange({ displayName: e.target.value })}
          placeholder="Your name..."
          autoFocus
          style={{
            background: 'var(--sb-card)', border: '1px solid var(--sb-hairline)', borderRadius: 'var(--sb-r-nav)',
            padding: '11px 14px', color: 'var(--sb-ink-1)', fontSize: 'var(--sb-t-body)', outline: 'none',
            width: '100%', boxSizing: 'border-box',
            boxShadow: 'var(--sb-shadow-control)',
            transition: 'border-color 0.15s',
          }}
          onFocus={e => { e.target.style.borderColor = 'var(--sb-accent)' }}
          onBlur={e => { e.target.style.borderColor = 'var(--sb-hairline)' }}
        />
      </div>

      {/* Theme picker (compact) */}
      <div>
        <label style={{ fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 10 }}>
          Choose your theme
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 9 }}>
          {THEMES.map(theme => {
            const active = data.themeId === theme.id
            // The tile is the theme: page behind, card on top, its ink as the
            // lines a card holds, its accent as the mark, its name in its own
            // display face.
            const tk = theme.tokens
            return (
              <button key={theme.id} className="wz-theme-card" onClick={() => {
                applyAppearance({ themeId: theme.id })
                onChange({ themeId: theme.id })
              }} style={{
                padding: 0, textAlign: 'left', overflow: 'hidden', cursor: 'pointer', outline: 'none',
                borderRadius: 'var(--sb-r-nav)', background: tk['--sb-page'],
                border: `2px solid ${active ? 'var(--sb-ink-1)' : 'var(--sb-border)'}`,
                boxShadow: active ? 'var(--sb-shadow-control)' : 'none',
                fontFamily: 'inherit', transition: 'border-color 0.15s',
              }}>
                <div style={{ padding: 9 }}>
                  <div style={{
                    background: tk['--sb-card'], border: `1px solid ${tk['--sb-border']}`,
                    borderRadius: 'var(--sb-r-chip)', padding: 8, display: 'flex', alignItems: 'center', gap: 7,
                  }}>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ display: 'block', height: 5, width: '76%', borderRadius: 'var(--sb-r-pill)', background: tk['--sb-ink-1'] }} />
                      <span style={{ display: 'block', height: 4, width: '50%', borderRadius: 'var(--sb-r-pill)', background: tk['--sb-ink-3'] }} />
                    </div>
                    <span style={{
                      flexShrink: 0, width: 18, height: 18, borderRadius: 'var(--sb-r-pill)',
                      background: tk['--sb-accent'],
                    }} />
                  </div>
                </div>
                <div style={{
                  padding: '0 10px 9px', color: tk['--sb-ink-1'], fontFamily: tk['--sb-font-num'],
                  fontSize: 'var(--sb-t-body-s)', fontWeight: active ? 700 : 600, letterSpacing: '-0.01em',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {theme.name}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-4)', textAlign: 'center', fontStyle: 'italic' }}>
        This will only take about 2 minutes. Let's get started!
      </p>
    </div>
  )
}

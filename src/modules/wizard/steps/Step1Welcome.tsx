import { THEMES, getTheme, applyThemeVars } from '@/lib/themes'
import type { WizardData } from '../SetupWizard'

interface Props {
  data: WizardData
  onChange: (p: Partial<WizardData>) => void
}

export function Step1Welcome({ data, onChange }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <style>{`
        @keyframes step1-fadein {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .step1-theme-card {
          transition: transform 0.15s ease, box-shadow 0.15s ease;
        }
        .step1-theme-card:hover {
          transform: translateY(-2px);
        }
      `}</style>

      {/* Greeting */}
      <div style={{ animation: 'step1-fadein 0.4s ease' }}>
        <h1 style={{
          fontSize: 26,
          fontWeight: 800,
          color: 'var(--color-text)',
          margin: 0,
          lineHeight: 1.3,
        }}>
          Welcome to The Professor 👋
        </h1>
        <p style={{
          fontSize: 14,
          color: 'var(--color-text-dim)',
          margin: '8px 0 0',
          lineHeight: 1.6,
        }}>
          Let's personalize your workspace before you dive in.
        </p>
      </div>

      {/* Name field */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Your name
        </label>
        <input
          type="text"
          value={data.displayName}
          onChange={e => onChange({ displayName: e.target.value })}
          placeholder="Enter your name..."
          style={{
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 7,
            padding: '8px 12px',
            color: 'var(--color-text)',
            fontSize: 13,
            outline: 'none',
            width: '100%',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Theme picker */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Choose a theme
        </label>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
          gap: 10,
        }}>
          {THEMES.map(theme => {
            const isActive = data.themeId === theme.id
            return (
              <button
                key={theme.id}
                className="step1-theme-card"
                onClick={() => {
                  applyThemeVars(getTheme(theme.id))
                  onChange({ themeId: theme.id })
                }}
                style={{
                  width: '100%',
                  border: isActive
                    ? `2px solid ${theme.accent}`
                    : '2px solid transparent',
                  borderRadius: 10,
                  background: 'transparent',
                  cursor: 'pointer',
                  padding: 0,
                  outline: 'none',
                  boxShadow: isActive
                    ? `0 0 12px ${theme.accent}55, 0 0 0 1px ${theme.accent}33`
                    : 'none',
                }}
              >
                {/* Color swatch */}
                <div style={{
                  width: '100%',
                  height: 56,
                  background: theme.bg,
                  borderRadius: '8px 8px 0 0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative',
                }}>
                  {/* Accent dot */}
                  <div style={{
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    background: theme.accent,
                    boxShadow: `0 0 8px ${theme.accent}88`,
                  }} />
                  {/* Mini surface strip */}
                  <div style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: 12,
                    background: theme.surface,
                    borderTop: `1px solid ${theme.border}`,
                  }} />
                  {/* Active check */}
                  {isActive && (
                    <div style={{
                      position: 'absolute',
                      top: 4,
                      right: 4,
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      background: theme.accent,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                      <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                        <polyline points="1.5,4 3,5.5 6.5,2" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                  )}
                </div>
                {/* Theme label */}
                <div style={{
                  padding: '5px 4px',
                  background: 'var(--color-surface)',
                  borderRadius: '0 0 8px 8px',
                  borderTop: `1px solid var(--color-border)`,
                }}>
                  <div style={{ fontSize: 13, lineHeight: 1 }}>{theme.emoji}</div>
                  <div style={{
                    fontSize: 10,
                    color: isActive ? 'var(--color-accent, #7F77DD)' : 'var(--color-text-dim)',
                    fontWeight: isActive ? 600 : 400,
                    marginTop: 2,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {theme.name}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Tip */}
      <p style={{
        fontSize: 12,
        color: 'var(--color-text-muted)',
        margin: 0,
        fontStyle: 'italic',
      }}>
        You can always change your theme in Settings.
      </p>
    </div>
  )
}

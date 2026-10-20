import { Swords } from 'lucide-react'
import { useBehavioralStore, type BehavioralMode } from '@/store/behavioralStore'
import { ICON, STROKE } from '@/lib/type'

export function BehavioralSection() {
  const { enabled, mode, setEnabled, setMode } = useBehavioralStore()
  const SB = {
    bg: 'var(--sb-page)', surface: 'var(--sb-card)', surface2: 'var(--sb-field)', border: 'var(--sb-border)',
    accent: 'var(--sb-accent)', accentFill: 'rgba(var(--sb-accent-rgb),0.12)', accentBright: 'var(--sb-warning)',
    text: 'var(--sb-ink-1)', textDim: 'var(--sb-ink-3)', textMuted: 'var(--sb-ink-4)',
  }

  const modes: { id: BehavioralMode; label: string; desc: string; available: boolean }[] = [
    { id: 'samurai', label: 'Samurai',  desc: 'Disciplined executor. Tactical tone. Rank system active.', available: true  },
    { id: 'pharaoh', label: 'Pharaoh',  desc: 'Strategic builder. Legacy-focused framework.',             available: false },
    { id: 'astral',  label: 'Astral',   desc: 'Vision-first. Long-horizon thinking & reflection.',        available: false },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Enable toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: SB.surface2, borderRadius: 'var(--sb-r-nav)', border: `var(--sb-border-width) solid ${SB.border}` }}>
        <div>
          <div style={{ fontSize: 'var(--sb-t-label)', fontWeight: 600, color: SB.text }}>Enable Behavioral OS</div>
          <div style={{ fontSize: 'var(--sb-t-body-s)', color: SB.textDim, marginTop: 2 }}>Activates rank tracking, identity detection & mode-aware AI</div>
        </div>
        <button
          onClick={() => setEnabled(!enabled)}
          style={{
            width: 44, height: 24, borderRadius: 'var(--sb-r-nav)', border: 'none', cursor: 'pointer', flexShrink: 0,
            background: enabled ? SB.accent : SB.border,
            position: 'relative', transition: 'background 0.2s',
          }}
        >
          <span style={{
            position: 'absolute', top: 2, left: enabled ? 22 : 2,
            width: 20, height: 20, borderRadius: 'var(--sb-r-pill)', background: 'var(--sb-ink-on-fill)',
            transition: 'left 0.2s',
          }} />
        </button>
      </div>

      {/* Mode selection */}
      {enabled && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 700, color: SB.accentBright, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 2 }}>Operating Mode</div>
          {modes.map(m => (
            <button
              key={m.id}
              disabled={!m.available}
              onClick={() => m.available && setMode(m.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 14px', borderRadius: 'var(--sb-r-nav)', cursor: m.available ? 'pointer' : 'default',
                background: mode === m.id ? SB.accentFill : SB.surface2,
                border: `var(--sb-border-width) solid ${mode === m.id ? SB.accent : SB.border}`,
                textAlign: 'left', width: '100%', opacity: m.available ? 1 : 0.5,
              }}
            >
              <Swords size={ICON.md} color={mode === m.id ? SB.accent : SB.textDim} strokeWidth={STROKE.rest} style={{ flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 'var(--sb-t-label)', fontWeight: 600, color: SB.text }}>{m.label}</span>
                  {!m.available && <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 700, padding: '2px 6px', borderRadius: 'var(--sb-r-chip)', background: SB.border, color: SB.textDim, letterSpacing: '0.5px' }}>SOON</span>}
                </div>
                <div style={{ fontSize: 'var(--sb-t-body-s)', color: SB.textDim, marginTop: 2 }}>{m.desc}</div>
              </div>
              {mode === m.id && <div style={{ width: 8, height: 8, borderRadius: 'var(--sb-r-pill)', background: SB.accent, flexShrink: 0 }} />}
            </button>
          ))}
        </div>
      )}

      {/* Samurai info */}
      {enabled && mode === 'samurai' && (
        <div style={{ padding: '12px 14px', borderRadius: 'var(--sb-r-nav)', background: 'color-mix(in srgb, var(--sb-negative-deep) 8.0%, transparent)', border: 'var(--sb-border-width) solid color-mix(in srgb, var(--sb-negative-deep) 25.0%, transparent)' }}>
          <div style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-negative)', fontWeight: 600, marginBottom: 4 }}>Samurai Mode Active</div>
          <div style={{ fontSize: 'var(--sb-t-body-s)', color: SB.textDim, lineHeight: 1.5 }}>
            The Behavioral OS page will appear in the sidebar. Your rank (Ronin → Shogun) is calculated from task completion, habit consistency, and planning quality. The AI assistant will adopt a tactical, no-filler communication style.
          </div>
        </div>
      )}
    </div>
  )
}

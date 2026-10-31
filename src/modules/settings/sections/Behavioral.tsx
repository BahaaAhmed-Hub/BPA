import { Swords } from 'lucide-react'
import { useBehavioralStore, type BehavioralMode } from '@/store/behavioralStore'
import { ICON, STROKE } from '@/lib/type'
import { Block, DRow, Toggle } from '../ui'

// The wrapper in Settings.tsx prints the "Behavioral OS" title; the switch, the modes
// and the active-mode note are each a block of rows under it.
export function BehavioralSection() {
  const { enabled, mode, setEnabled, setMode } = useBehavioralStore()

  const modes: { id: BehavioralMode; label: string; desc: string; available: boolean }[] = [
    { id: 'samurai', label: 'Samurai',  desc: 'Disciplined executor. Tactical tone. Rank system active.', available: true  },
    { id: 'pharaoh', label: 'Pharaoh',  desc: 'Strategic builder. Legacy-focused framework.',             available: false },
    { id: 'astral',  label: 'Astral',   desc: 'Vision-first. Long-horizon thinking & reflection.',        available: false },
  ]

  return (
    <div>
      <Block>
        <DRow label="Enable Behavioral OS" sub="Activates rank tracking, identity detection & mode-aware AI" last>
          <Toggle checked={enabled} onChange={setEnabled} />
        </DRow>
      </Block>

      {/* Mode selection */}
      {enabled && (
        <Block title="Operating mode" sub="How the assistant speaks to you and how your rank is read.">
          {modes.map((m, i) => (
            <DRow key={m.id} label={m.label} sub={m.desc} last={i === modes.length - 1}>
              {!m.available && <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 700, padding: '2px 6px', borderRadius: 'var(--sb-r-chip)', background: 'var(--sb-field)', color: 'var(--sb-ink-3)', letterSpacing: '0.5px' }}>SOON</span>}
              <button
                disabled={!m.available}
                aria-pressed={mode === m.id}
                onClick={() => m.available && setMode(m.id)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 'var(--sb-r-chip)',
                  cursor: m.available ? 'pointer' : 'default', opacity: m.available ? 1 : 0.5,
                  background: mode === m.id ? 'rgba(var(--sb-accent-rgb),0.12)' : 'var(--sb-card)',
                  border: `var(--sb-border-width) solid ${mode === m.id ? 'var(--sb-accent)' : 'var(--sb-border)'}`,
                  color: 'var(--sb-ink-1)', fontSize: 'var(--sb-t-body-s)', fontWeight: 600,
                }}
              >
                <Swords size={ICON.sm} strokeWidth={STROKE.rest} />
                {mode === m.id ? 'Active' : 'Use'}
              </button>
            </DRow>
          ))}
        </Block>
      )}

      {/* Samurai info */}
      {enabled && mode === 'samurai' && (
        <Block>
          <DRow label="Samurai Mode Active" sub="The Behavioral OS page will appear in the sidebar. Your rank (Ronin → Shogun) is calculated from task completion, habit consistency, and planning quality. The AI assistant will adopt a tactical, no-filler communication style." last>
            <span />
          </DRow>
        </Block>
      )}
    </div>
  )
}

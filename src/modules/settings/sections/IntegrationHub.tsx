import { BeLogo } from '@/components/BeLogo'

// ─── The hub — the platform in the middle, every app it talks to around it ──
//
// Presentational only: it is told which apps are connected and draws that. An
// app that is connected is in colour with a beam running from it to the
// platform; one that is not is the same mark in grey with no beam, and one
// that does not exist yet is the same again. Nothing here is a button — a
// control that reaches nothing is not drawn (`shell.md`) — so the logos are
// a picture of the state, and the cards below it are where it is changed.
//
// The beam is the `AnimatedBeam` idea (a bright dash travelling a line over a
// faint one, 3s) rebuilt in SVG with no dependency: the registry component is
// Tailwind and `cn`, and this app has neither.

export type HubState = 'on' | 'off' | 'soon'
export interface HubNode { id: string; label: string; mark: React.ReactNode; state: HubState }

const W = 560, H = 300, CX = W / 2, CY = H / 2, RX = 215, RY = 102, NODE = 48

const pos = (i: number, n: number) => {
  const a = (i / n) * Math.PI * 2 - Math.PI / 2
  return { x: CX + RX * Math.cos(a), y: CY + RY * Math.sin(a) }
}

const STATE_WORD: Record<HubState, string> = { on: 'connected', off: 'not connected', soon: 'not available yet' }

export function IntegrationHub({ nodes }: { nodes: HubNode[] }) {
  return (
    <div data-integration-hub style={{ position: 'relative', width: '100%', maxWidth: W, aspectRatio: `${W} / ${H}`, margin: '0 auto' }}>
      <style>{`
        @keyframes hub-beam { from { stroke-dashoffset: 22 } to { stroke-dashoffset: -100 } }
        .hub-beam { animation: hub-beam 3s linear infinite }
        @media (prefers-reduced-motion: reduce) { .hub-beam { animation: none; stroke-dasharray: none } }
      `}</style>

      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
        {nodes.map((n, i) => {
          const p = pos(i, nodes.length)
          const d = `M ${p.x} ${p.y} L ${CX} ${CY}`
          return (
            <g key={n.id}>
              <path d={d} fill="none" strokeWidth={1.5} vectorEffect="non-scaling-stroke"
                stroke="color-mix(in srgb, var(--sb-ink-1) 12%, transparent)" />
              {n.state === 'on' && (
                <path d={d} pathLength={100} fill="none" strokeWidth={2.5} strokeLinecap="round"
                  vectorEffect="non-scaling-stroke" className="hub-beam"
                  stroke="var(--sb-accent)" strokeDasharray="22 78"
                  style={{ animationDelay: `${(i * 0.37) % 3}s` }} />
              )}
            </g>
          )
        })}
      </svg>

      <div data-hub-centre style={{
        position: 'absolute', left: `${(CX / W) * 100}%`, top: `${(CY / H) * 100}%`, transform: 'translate(-50%, -50%)',
        width: 84, height: 84, borderRadius: '50%', background: 'var(--sb-overlay)',
        border: 'var(--sb-border-width) solid var(--sb-border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 2px 10px -4px rgba(25, 23, 18, .16), 0 10px 30px -18px rgba(25, 23, 18, .22)',
      }}>
        <BeLogo variant="amber" size={58} />
      </div>

      <ul aria-label="Integrations" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {nodes.map((n, i) => {
          const p = pos(i, nodes.length)
          return (
            <li key={n.id} data-hub-node={n.id} data-state={n.state}
              aria-label={`${n.label}, ${STATE_WORD[n.state]}`}
              style={{
                position: 'absolute', left: `${(p.x / W) * 100}%`, top: `${(p.y / H) * 100}%`,
                transform: 'translate(-50%, -50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              }}>
              <span style={{
                width: NODE, height: NODE, borderRadius: '50%', background: 'var(--sb-overlay)',
                border: `var(--sb-border-width) solid ${n.state === 'on' ? 'var(--sb-accent)' : 'var(--sb-border)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                // Grey means no colour at all, not a dimmed colour: one filter on
                // the mark, so every logo greys the same way.
                filter: n.state === 'on' ? 'none' : 'grayscale(1)',
                opacity: n.state === 'on' ? 1 : n.state === 'off' ? 0.7 : 0.5,
              }}>{n.mark}</span>
              <span style={{ fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: 'var(--sb-ink-3)', whiteSpace: 'nowrap' }}>{n.label}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

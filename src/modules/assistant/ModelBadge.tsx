import { describeModel, type ModelMarkKind } from '@/lib/modelInfo'

/**
 * The model's mark and its version, in the header — where it used to say
 * "Anthropic · Claude", which is true of every Claude model and so of none in
 * particular. Colour comes from theme tokens, never a brand hex: the marks have
 * to read on every one of the four grounds.
 */
function Mark({ kind, size }: { kind: ModelMarkKind; size: number }) {
  if (kind === 'claude') {
    // Eight rays, long and short alternating — a burst, not a star.
    const rays = [0, 45, 90, 135, 180, 225, 270, 315]
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden focusable="false" style={{ display: 'block', color: 'var(--sb-accent-deep)' }}>
        <g stroke="currentColor" strokeWidth="2.7" strokeLinecap="round">
          {rays.map((a, i) => (
            <line key={a} x1="12" y1={i % 2 === 0 ? 2.6 : 5.2} x2="12" y2="8.4" transform={`rotate(${a} 12 12)`} />
          ))}
        </g>
      </svg>
    )
  }
  if (kind === 'groq') {
    // A ring with a bar through its mouth: a "g" without a font.
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden focusable="false" style={{ display: 'block', color: 'var(--sb-ink-2)' }}>
        <g fill="none" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 8.6A8 8 0 1 0 20 12h-7" />
        </g>
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden focusable="false" style={{ display: 'block', color: 'var(--sb-ink-3)' }}>
      <circle cx="12" cy="12" r="5" fill="currentColor" />
    </svg>
  )
}

export function ModelBadge({ provider, model }: { provider: 'anthropic' | 'groq'; model: string }) {
  const m = describeModel(provider, model)
  return (
    <span data-model-badge data-model-id={m.id} title={`${m.id} · ${m.vendor}`} aria-label={`Model: ${m.vendor} ${m.label}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, margin: 0, fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: 'var(--sb-ink-3)' }}>
      <Mark kind={m.mark} size={14} />
      <span>{m.label}</span>
    </span>
  )
}

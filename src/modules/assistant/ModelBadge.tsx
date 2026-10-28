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

/** The usage counter that sits beside the model name. `short` is what is drawn, `long` the tooltip. */
export interface BadgeUsage { short: string; long: string; live: boolean; tokens: number; usd: number | null }

export function ModelBadge({ provider, model, usage }: { provider: 'anthropic' | 'groq'; model: string; usage?: BadgeUsage }) {
  const m = describeModel(provider, model)
  return (
    // Long ids ("meta-llama/llama-4-scout-17b-16e-instruct", or whatever a person typed) are cut with an ellipsis rather
    // than pushing the header's buttons out; the whole id is the tooltip and the accessible name.
    <span data-model-badge data-model-id={m.id} title={`${m.id} · ${m.vendor}${usage ? `\n${usage.long}` : ''}`} aria-label={`Model: ${m.vendor} ${m.label}${usage ? `. ${usage.short}` : ''}`}
      style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, minWidth: 0, maxWidth: '100%', fontSize: 'var(--sb-t-meta)', fontWeight: 600, color: 'var(--sb-ink-3)' }}>
      <span style={{ display: 'inline-flex', flexShrink: 0 }}><Mark kind={m.mark} size={14} /></span>
      <span data-model-label style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.label}</span>
      {/* The counter keeps its width and the name gives way: the name is also the tooltip, the numbers are the point. */}
      {usage && (
        <span data-usage-counter data-usage-tokens={usage.tokens} data-usage-usd={usage.usd ?? ''} data-usage-live={usage.live ? 'true' : 'false'}
          style={{ flexShrink: 0, whiteSpace: 'nowrap', fontWeight: 500, color: 'var(--sb-ink-3)', fontVariantNumeric: 'tabular-nums' }}>
          <span aria-hidden style={{ opacity: 0.6 }}>· </span>{usage.short}
        </span>
      )}
    </span>
  )
}

/** The mark alone, for a screen that draws a provider choice (the setup guide). */
export { Mark as ModelMark }

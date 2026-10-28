import { waitText, type LimitsView } from '@/lib/providerLimits'

/**
 * Under the model name: how much room the PROVIDER says is left — its own number, off the headers of the last reply, for the
 * whole account (everything using that key or organisation), which is what decides whether the next message works. Quiet
 * while there is plenty; says so plainly when it is running low or out, and what the person can do about it.
 */
export function LimitsLine({ view, ageText }: { view: LimitsView; ageText: string }) {
  const out = view.level === 'out', low = view.level === 'low'
  const wait = view.retryAfter !== undefined ? view.retryAfter : view.tightest?.resetsInMs != null ? Math.ceil(view.tightest.resetsInMs / 1000) : undefined
  const text = out ? `Limit reached${view.line ? ` · ${view.line}` : ''}${wait !== undefined ? ` · opens again in ${waitText(wait)}` : ''}`
    : low ? `Running low · ${view.line}`
    : view.line
  const tip = [
    ...view.lines,
    `As of ${ageText}. This is the provider’s own count for your whole account — everything using this key or organisation — not only this app.`,
    ...(out || low ? ['What you can do: wait for the window to refill, switch the model or provider in Settings → AI, or raise the limit with the provider.'] : []),
  ].join('\n')
  return (
    <span data-limits-line data-limits-level={view.level} title={tip} aria-label={`Provider limits. ${text}`}
      style={{
        display: 'block', margin: '1px 0 0', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        fontSize: 'var(--sb-t-meta)', fontWeight: out || low ? 600 : 500, fontVariantNumeric: 'tabular-nums',
        color: out ? 'var(--sb-negative)' : low ? 'var(--sb-accent-deep)' : 'var(--sb-ink-3)',
      }}>
      {text}
    </span>
  )
}

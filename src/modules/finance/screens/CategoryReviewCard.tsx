import { useMemo, useState, useEffect } from 'react'
import { Check, RotateCcw } from 'lucide-react'
import { ICON, STROKE } from '@/lib/type'
import { acct } from '../format'
import {
  reviewCategories, loadKept, keepAsIs, forgetAllKept, REVIEW_EVENT,
  type Finding, type ReviewInput,
} from '../categoryReview'

// ─── What your categories look like from outside ─────────────────────────────
//
//  Folded away by default, the same as the forecast rules: the screen that
//  opens is the one that was always there, and this is what you come to when
//  the envelopes stop telling you anything.
//
//  Every row can be answered, and **"Keep as it is" is a real answer** — it
//  sticks, and the row does not come back until the evidence behind it moves.
//  A list of suggestions with no way to disagree is a list you learn to scroll
//  past, and one you scroll past is worse than none at all.

const CARD: React.CSSProperties = {
  background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
  borderRadius: 'var(--sb-r-card)', overflow: 'hidden',
}
const SUMMARY: React.CSSProperties = {
  cursor: 'pointer', listStyle: 'none', padding: '13px 18px',
  display: 'flex', alignItems: 'baseline', gap: '2px 10px', flexWrap: 'wrap',
  fontFamily: 'var(--sb-font-display)', fontSize: 'var(--sb-t-body)', fontWeight: 600,
  letterSpacing: '-0.02em', color: 'var(--sb-ink-1)',
}
const WHY: React.CSSProperties = {
  marginLeft: 'auto', fontFamily: 'system-ui', fontWeight: 400,
  fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)', letterSpacing: 0,
}
const PILL: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5, height: 28, padding: '0 11px',
  borderRadius: 'var(--sb-r-pill)', border: 'var(--sb-border-width) solid var(--sb-border)',
  background: 'var(--sb-card)', color: 'var(--sb-ink-2)', cursor: 'pointer',
  fontFamily: 'inherit', fontSize: 'var(--sb-t-meta)', fontWeight: 600,
}

export function CategoryReviewCard({ input, onOpenCategory }: {
  input: ReviewInput
  /** Takes you to the category a finding is about. */
  onOpenCategory?: (categoryId: string) => void
}) {
  const [kept, setKept] = useState<Set<string>>(() => loadKept())
  useEffect(() => {
    const sync = () => setKept(loadKept())
    window.addEventListener(REVIEW_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => { window.removeEventListener(REVIEW_EVENT, sync); window.removeEventListener('storage', sync) }
  }, [])

  const review = useMemo(() => reviewCategories(input), [input])
  const open = review.findings.filter(f => !kept.has(f.id))
  const hidden = review.findings.length - open.length
  const worth = open.filter(f => f.severity === 'worth-a-look').length

  const money = (n: number) => acct(n, { currency: review.currency, decimals: 0 })

  if (review.readFrom < 3) {
    return (
      <div style={{ ...CARD, padding: '13px 18px', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)' }}>
        <b style={{ color: 'var(--sb-ink-3)', fontWeight: 600 }}>How your categories are holding up</b>
        {' — '}
        {review.readFrom === 0
          ? 'nothing has been logged yet, so there is nothing to read.'
          : `only ${review.readFrom} month${review.readFrom === 1 ? '' : 's'} of entries so far. A tree read from that is a tree nobody has used yet.`}
      </div>
    )
  }

  return (
    <details style={CARD}>
      <summary style={SUMMARY}>
        How your categories are holding up
        <span style={WHY}>
          {open.length === 0
            ? hidden > 0 ? `nothing new · ${hidden} you have already answered` : 'nothing to raise'
            : `${open.length} thing${open.length === 1 ? '' : 's'} to read${worth ? ` · ${worth} worth a look` : ''}`}
        </span>
      </summary>

      <div style={{
        padding: '4px 18px 16px', borderTop: 'var(--sb-border-width) solid var(--sb-hairline)',
        display: 'flex', flexDirection: 'column',
      }}>
        {open.length === 0 && (
          <p style={{ margin: '12px 0 0', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.5 }}>
            Nothing stands out in {review.readFrom} months of entries. Your categories are
            doing their job.
          </p>
        )}

        {open.map(f => (
          <Row key={f.id} f={f} money={money}
            onKeep={() => { keepAsIs(f); setKept(loadKept()) }}
            onOpen={onOpenCategory} />
        ))}

        {hidden > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            marginTop: 14, paddingTop: 12, borderTop: 'var(--sb-border-width) solid var(--sb-hairline)',
            fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)',
          }}>
            <span>
              {hidden} {hidden === 1 ? 'thing is' : 'things are'} how you want {hidden === 1 ? 'it' : 'them'}.
            </span>
            <button style={PILL} onClick={() => { forgetAllKept(); setKept(loadKept()) }}>
              <RotateCcw size={ICON.sm} strokeWidth={STROKE.rest} /> Show {hidden === 1 ? 'it' : 'them'} again
            </button>
          </div>
        )}
      </div>
    </details>
  )
}

function Row({ f, money, onKeep, onOpen }: {
  f: Finding
  money: (n: number) => string
  onKeep: () => void
  onOpen?: (categoryId: string) => void
}) {
  const hot = f.severity === 'worth-a-look'
  return (
    <div style={{
      padding: '13px 0', borderBottom: 'var(--sb-border-width) solid var(--sb-hairline)',
      display: 'flex', flexDirection: 'column', gap: 6,
      // One measure for the content, but the rule under it runs the whole card,
      // the way the summary's does. Left to the card's own width the figure
      // ends up a screen away from the title it belongs to, reading as a
      // number about something else; a rule that stops short of the card reads
      // as a second column that is not there.
      alignItems: 'stretch',
    }}>
      <div style={{ maxWidth: 780, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        {/* Severity is never colour alone: the word is the signal, the tint
            only makes it findable. */}
        <span style={{
          fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.1em',
          textTransform: 'uppercase', padding: '2px 8px', borderRadius: 'var(--sb-r-pill)',
          background: hot ? 'var(--sb-accent-tint2)' : 'var(--sb-field)',
          color: hot ? 'var(--sb-accent-deep)' : 'var(--sb-ink-4)',
        }}>{hot ? 'Worth a look' : 'Noted'}</span>
        <span style={{
          flex: 1, minWidth: 0, fontFamily: 'var(--sb-font-display)', fontSize: 'var(--sb-t-body-s)',
          fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--sb-ink-1)',
        }}>{f.title}</span>
        {f.amount != null && f.amount > 0 && (
          <span style={{
            fontFamily: 'var(--sb-font-mono)', fontVariantNumeric: 'tabular-nums',
            fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-2)',
          }}>{money(f.amount)}</span>
        )}
      </div>

      <p style={{ margin: 0, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', lineHeight: 1.5 }}>
        {f.detail}
      </p>

      {/* The evidence, so a finding can be checked rather than believed. */}
      {f.evidence.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {f.evidence.map((e, i) => (
            <span key={i} style={{
              fontFamily: 'var(--sb-font-mono)', fontSize: 'var(--sb-t-micro)',
              color: 'var(--sb-ink-4)', background: 'var(--sb-field)',
              border: 'var(--sb-border-width) solid var(--sb-hairline)',
              borderRadius: 'var(--sb-r-chip)', padding: '2px 7px',
            }}>{e}</span>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 2 }}>
        {onOpen && f.categoryIds.length > 0 && (
          <button style={PILL} onClick={() => onOpen(f.categoryIds[0])}>
            Open {f.categoryIds.length > 1 ? 'the first one' : 'it'}
          </button>
        )}
        {/* Nothing here changes a category. This is the answer that says the
            tree is already how you meant it, and it is remembered. */}
        <button style={PILL} onClick={onKeep} title="This is how I want it — stop raising it">
          <Check size={ICON.sm} strokeWidth={STROKE.active} /> Keep as it is
        </button>
      </div>
      </div>
    </div>
  )
}

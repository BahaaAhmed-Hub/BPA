import { useMemo, useState } from 'react'
import { acct } from '../format'
import { adviseMonth, monthName, type MonthsAhead, type AheadMonth, type MonthState } from '../monthsAhead'

// ─── Which months run short ──────────────────────────────────────────────────
//
//  The forecast rules beside this card say what the plan assumes. This says
//  what the plan *does*: your balance carried forward, month by month, against
//  the cushion you asked to keep back.
//
//  Two things it will not do. It never colours a year it cannot see — under
//  three complete months the medians behind it are a guess, and a guess drawn
//  in red is worse than nothing. And no figure here is ever colour alone: the
//  sentence at the top names the months in words, and an opened month carries
//  a chip that says which of the three states it is in.

const CARD: React.CSSProperties = {
  background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
  borderRadius: 'var(--sb-r-card)', overflow: 'hidden',
}
const EB: React.CSSProperties = {
  fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.14em',
  textTransform: 'uppercase', color: 'var(--sb-ink-4)',
}
const TAG: React.CSSProperties = {
  fontFamily: 'var(--sb-font-mono)', fontSize: 'var(--sb-t-micro)',
  color: 'var(--sb-ink-4)', background: 'var(--sb-field)',
  border: 'var(--sb-border-width) solid var(--sb-hairline)',
  borderRadius: 'var(--sb-r-chip)', padding: '1px 6px', whiteSpace: 'nowrap',
}

const TONE: Record<MonthState, { ink: string; bg: string; word: string }> = {
  ok:      { ink: 'var(--sb-positive-deep)', bg: 'var(--sb-positive-tint)', word: 'Above your cushion' },
  cushion: { ink: 'var(--sb-accent-deep)',   bg: 'var(--sb-accent-tint2)',  word: 'Into your cushion' },
  short:   { ink: 'var(--sb-negative-deep)', bg: 'var(--sb-negative-tint)', word: 'Short' },
}

/** The card's own short month, so a 280px column is not asked for "September". */
function shortMonth(key: string): string {
  const d = new Date(`${key}-01T12:00:00`)
  return Number.isNaN(d.getTime()) ? key.slice(5) : d.toLocaleDateString('en-GB', { month: 'short' })
}

export function MonthsAheadCard({ ahead, currency, onOpenEntry }: {
  ahead: MonthsAhead
  currency: string
  /** Opens the entry a move is about, where the screen can. */
  onOpenEntry?: (txId: string) => void
}) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const money = (n: number) => acct(n, { currency, decimals: 0 })

  // ── The drawing ────────────────────────────────────────────────────────────
  // Computed from the data rather than laid out by hand, so the scale is
  // honest for any ledger: the plot always contains zero, the cushion and
  // every reading, and the labels are placed off the same scale as the marks.
  const geo = useMemo(() => {
    // The side padding is the widest month label's half-width, not a round
    // number: at 4px the first label was cut in half by the drawing's own edge.
    const W = 300, H = 104, L = 15, R = 15, T = 10, B = 18
    const vals = ahead.months.map(m => m.closing)
    const lo = Math.min(0, ...vals)
    const hi = Math.max(ahead.buffer, ...vals)
    const pad = (hi - lo) * 0.12 || 1
    const min = lo - pad, max = hi + pad
    const x = (i: number) => L + (i * (W - L - R)) / Math.max(1, ahead.months.length - 1)
    const y = (v: number) => T + (1 - (v - min) / (max - min)) * (H - T - B)
    return { W, H, B, x, y, zero: y(0), cushion: y(ahead.buffer) }
  }, [ahead])

  const thin = ahead.readFrom < 3
  const open = openKey ? ahead.months.find(m => m.month === openKey) ?? null : null

  // The two months worth a mark: where it first goes wrong, and where it is
  // worst. Marking every month is a number on every point, which reads as
  // noise and hides the two that matter.
  const marked = new Set<string>()
  if (!thin && ahead.firstBreach) marked.add(ahead.firstBreach.month)
  if (!thin && ahead.worst && ahead.worst.state !== 'ok') marked.add(ahead.worst.month)

  return (
    <div style={CARD}>
      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={EB}>The months ahead</span>
        <Headline ahead={ahead} thin={thin} money={money} />
      </div>

      {!thin && (
        <div style={{ padding: '0 10px 6px' }}>
          <svg viewBox={`0 0 ${geo.W} ${geo.H}`} style={{ display: 'block', width: '100%', height: 'auto' }}
            role="img"
            aria-label={`Your balance across the next ${ahead.months.length} months, from ${money(ahead.months[0]?.opening ?? 0)} to ${money(ahead.months[ahead.months.length - 1]?.closing ?? 0)}.`}>
            {/* zero, then the cushion above it. Both recessive: they are the
                lines the readings are judged against, not readings themselves. */}
            <line x1="0" y1={geo.zero} x2={geo.W} y2={geo.zero}
              stroke="var(--sb-ink-4)" strokeWidth="1" opacity="0.5" />
            <line x1="0" y1={geo.cushion} x2={geo.W} y2={geo.cushion}
              stroke="var(--sb-accent-deep)" strokeWidth="1" strokeDasharray="4 3" opacity="0.7" />

            <polyline
              points={ahead.months.map((m, i) => `${geo.x(i)},${geo.y(m.closing)}`).join(' ')}
              fill="none" stroke="var(--sb-ink-2)" strokeWidth="2"
              strokeLinejoin="round" strokeLinecap="round" />

            {ahead.months.map((m, i) => marked.has(m.month) && (
              <circle key={m.month} cx={geo.x(i)} cy={geo.y(m.closing)} r="4.5"
                fill={TONE[m.state].ink} stroke="var(--sb-card)" strokeWidth="2" />
            ))}

            {/* Every month is a hit target, whether or not it is marked. */}
            {ahead.months.map((m, i) => (
              <rect key={m.month}
                x={geo.x(i) - geo.W / (ahead.months.length * 2)} y="0"
                width={geo.W / ahead.months.length} height={geo.H - geo.B + 8}
                fill="transparent" style={{ cursor: 'pointer' }}
                onClick={() => setOpenKey(k => (k === m.month ? null : m.month))}>
                <title>{`${monthName(m.month)} · ${money(m.closing)}`}</title>
              </rect>
            ))}

            {ahead.months.map((m, i) => (
              (ahead.months.length <= 8 || i % 2 === 0) && (
                <text key={m.month} x={geo.x(i)} y={geo.H - 4} textAnchor="middle"
                  fontFamily="var(--sb-font-mono)" fontSize="7.5"
                  fill={m.state === 'ok' ? 'var(--sb-ink-4)' : TONE[m.state].ink}>
                  {shortMonth(m.month).toUpperCase()}
                </text>
              )
            ))}
          </svg>
        </div>
      )}

      {!thin && (
        <div style={{ padding: '0 16px 14px', display: 'flex', gap: 12, flexWrap: 'wrap', ...EB, letterSpacing: '0.06em' }}>
          {(['ok', 'cushion', 'short'] as const).map(s => (
            <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: TONE[s].ink }} />
              {TONE[s].word}
            </span>
          ))}
        </div>
      )}

      {open && <MonthPanel month={open} ahead={ahead} money={money} onOpenEntry={onOpenEntry} />}

      {!thin && !open && (
        <div style={{
          padding: '10px 16px 14px', borderTop: 'var(--sb-border-width) solid var(--sb-hairline)',
          fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-4)',
        }}>
          Tap a month to see what lands in it.
          {ahead.unconvertible > 0 && ` ${ahead.unconvertible} entr${ahead.unconvertible === 1 ? 'y is' : 'ies are'} in a currency with no rate, so they are in no month here.`}
          {ahead.blindFrom && ` From ${monthName(ahead.blindFrom)} these are your usual month and your budgets only — next year's entries are not loaded yet.`}
        </div>
      )}
    </div>
  )
}

/** The sentence the whole card exists to produce. It says nothing it cannot
 *  back: a year that holds says so, and a ledger too short to read says that
 *  instead of guessing. */
function Headline({ ahead, thin, money }: {
  ahead: MonthsAhead; thin: boolean; money: (n: number) => string
}) {
  const S: React.CSSProperties = {
    fontFamily: 'var(--sb-font-display)', fontSize: 'var(--sb-t-body)', fontWeight: 500,
    letterSpacing: '-0.02em', lineHeight: 1.35, color: 'var(--sb-ink-1)',
  }
  if (thin) return (
    <span style={{ ...S, color: 'var(--sb-ink-3)' }}>
      {ahead.readFrom === 0
        ? 'No complete month has been logged yet, so there is nothing to carry forward.'
        : `Only ${ahead.readFrom} complete month${ahead.readFrom === 1 ? '' : 's'} of history — not enough to say what next year looks like.`}
    </span>
  )
  if (!ahead.firstBreach) return (
    <span style={S}>
      Every month clears your cushion. The tightest is {monthName(ahead.worst!.month)} on{' '}
      <b>{money(ahead.worst!.closing)}</b>.
    </span>
  )
  const worst = ahead.worst!
  const same = worst.month === ahead.firstBreach.month
  return (
    <span style={S}>
      {monthName(ahead.firstBreach.month)} is the first month into your cushion
      {same ? '' : <>, and by {monthName(worst.month)} you are </>}
      {same ? ', on ' : ''}
      <b style={{ color: TONE[worst.state].ink }}>
        {worst.state === 'short' ? `${money(Math.abs(worst.closing))} short` : money(worst.closing)}
      </b>.
    </span>
  )
}

function MonthPanel({ month, ahead, money, onOpenEntry }: {
  month: AheadMonth
  ahead: MonthsAhead
  money: (n: number) => string
  onOpenEntry?: (txId: string) => void
}) {
  const moves = adviseMonth(ahead, month)
  const tone = TONE[month.state]
  const Row = ({ k, tag, v, dim }: { k: string; tag?: string; v: string; dim?: boolean }) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 'var(--sb-t-meta)' }}>
      <span style={{ flex: 1, minWidth: 0, color: dim ? 'var(--sb-ink-4)' : 'var(--sb-ink-2)' }}>{k}</span>
      {tag && <span style={TAG}>{tag}</span>}
      <span style={{
        fontFamily: 'var(--sb-font-mono)', fontVariantNumeric: 'tabular-nums',
        color: dim ? 'var(--sb-ink-4)' : 'var(--sb-ink-1)',
      }}>{v}</span>
    </div>
  )
  return (
    <div style={{
      padding: '13px 16px 15px', borderTop: 'var(--sb-border-width) solid var(--sb-hairline)',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{
          fontFamily: 'var(--sb-font-display)', fontSize: 'var(--sb-t-body)', fontWeight: 600,
          letterSpacing: '-0.02em', color: 'var(--sb-ink-1)',
        }}>{monthName(month.month)}</span>
        <span style={{
          ...EB, letterSpacing: '0.1em', padding: '2px 8px', borderRadius: 'var(--sb-r-pill)',
          background: tone.bg, color: tone.ink,
        }}>{tone.word}</span>
      </div>

      <Row k="You start the month on" v={money(month.opening)} />
      {month.charges.map((c, i) => (
        <Row key={`${c.txId ?? c.source}-${i}`}
          k={c.label}
          tag={c.source === 'usual' ? 'your usual' : c.source === 'budget' ? 'budget' : 'in your ledger'}
          v={money(c.amount)} />
      ))}
      {/* What stood down, so the card can be checked rather than trusted. */}
      {month.charges.filter(c => (c.replaces ?? 0) > 0).map(c => (
        <Row key={`back-${c.txId}`} dim
          k={`${c.label} was already in your usual month`}
          tag="not charged twice" v={money(c.replaces!)} />
      ))}

      <div style={{ height: 1, background: 'var(--sb-hairline)', margin: '2px 0' }} />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 'var(--sb-t-meta)' }}>
        <span style={{ flex: 1, minWidth: 0, color: 'var(--sb-ink-1)', fontWeight: 600 }}>You end the month on</span>
        <span style={{
          fontFamily: 'var(--sb-font-mono)', fontVariantNumeric: 'tabular-nums',
          fontWeight: 600, color: tone.ink,
        }}>{money(month.closing)}</span>
      </div>

      {moves.length > 0 && (
        <div style={{
          background: 'var(--sb-accent-tint2)', borderRadius: 'var(--sb-r-nav)',
          padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8, marginTop: 2,
        }}>
          {moves.map((m, i) => (
            <span key={i} style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-1)', lineHeight: 1.45 }}>
              {m.text}
            </span>
          ))}
          {onOpenEntry && moves.find(m => m.txId) && (
            <button
              onClick={() => { const id = moves.find(x => x.txId)?.txId; if (id) onOpenEntry(id) }}
              style={{
                alignSelf: 'flex-start', height: 30, padding: '0 12px', borderRadius: 'var(--sb-r-pill)',
                background: 'var(--sb-ink-1)', color: 'var(--sb-ink-on-dark)', border: 'none',
                cursor: 'pointer', fontFamily: 'inherit', fontSize: 'var(--sb-t-meta)', fontWeight: 600,
              }}>Open that entry</button>
          )}
        </div>
      )}
    </div>
  )
}

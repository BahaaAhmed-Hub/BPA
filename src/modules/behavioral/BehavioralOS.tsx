import { useEffect, useState } from 'react'
import { getTheme } from '@/lib/themes'
import { Button } from '@/components/ui'
import { RefreshCw, ChevronRight } from 'lucide-react'
import { useBehavioralStore } from '@/store/behavioralStore'
import { useTaskStore } from '@/store/taskStore'
import { useHabitsStore, loadLogs } from '@/store/habitsStore'
import {
  evaluateRank, detectIdentities, generateInsights,
  getDecisiveObjectives, RANK_META,
} from '@/lib/behavioralEngine'
import type { IdentityResult, Rank, IdentityStage } from '@/store/behavioralStore'
import { ICON } from '@/lib/type'
import { alpha } from '@/lib/alpha'

// ─── Drawn dark, whatever the app's theme is ─────────────────────────────────
// This screen being near-black is the mode, not a preference, and it used to
// say so by keeping eight colours of its own — reading the retired --color-*
// names with dark hexes as fallbacks, which is how it survived P1 at all.
//
// It says the same thing through the token contract now: a dark theme's tokens,
// scoped to this subtree. Every element below still reads var(--sb-*), so
// nothing here holds a colour, and the values are a theme's rather than this
// file's opinion of one.

const DARK_SCOPE = getTheme('glass-depth').tokens as React.CSSProperties

// ─── Micro-components ─────────────────────────────────────────────────────────

const STAGE_LABEL: Record<IdentityStage, string> = {
  emerging:    'EMERGING',
  developing:  'DEVELOPING',
  established: 'ESTABLISHED',
  core:        'CORE',
}

const STAGE_COLOR: Record<IdentityStage, string> = {
  emerging:    'var(--sb-ink-4)',
  developing:  'var(--sb-ink-3)',
  established: 'var(--sb-ink-3)',
  core:        'var(--sb-accent-deep)',
}

const RANK_ORDER: Rank[] = ['ronin', 'samurai', 'daimyo', 'shogun']

function RankProgressBar({ score }: { score: number }) {
  const thresholds = [0, 36, 61, 81, 100]
  return (
    <div style={{ marginTop: 20 }}>
      {/* Score bar */}
      <div style={{ height: 3, background: 'var(--sb-border)', borderRadius: 'var(--sb-r-chip)', overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 'var(--sb-r-chip)',
          width: `${score}%`,
          background: `linear-gradient(90deg, var(--sb-accent), var(--sb-accent-deep))`,
          transition: 'width 1s cubic-bezier(0.16, 1, 0.3, 1)',
        }} />
      </div>
      {/* Threshold markers */}
      <div style={{ position: 'relative', height: 20, marginTop: 4 }}>
        {thresholds.slice(1, -1).map(t => (
          <div key={t} style={{
            position: 'absolute', left: `${t}%`,
            width: 1, height: 6, background: 'var(--sb-ink-4)', top: 0,
          }} />
        ))}
        {RANK_ORDER.map((r, i) => (
          <span key={r} style={{
            position: 'absolute',
            left: `${thresholds[i]}%`,
            fontSize: 'var(--sb-t-micro)',
            letterSpacing: '0.08em',
            color: score >= thresholds[i] ? 'var(--sb-ink-3)' : 'var(--sb-ink-4)',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
          }}>
            {RANK_META[r].label}
          </span>
        ))}
      </div>
    </div>
  )
}

function ComponentBar({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-3)', letterSpacing: '0.08em', width: 110, flexShrink: 0, textTransform: 'uppercase' }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 2, background: 'var(--sb-border)', borderRadius: 'var(--sb-r-chip)' }}>
        <div style={{
          height: '100%', borderRadius: 'var(--sb-r-chip)',
          width: `${value}%`,
          background: value >= 60 ? 'var(--sb-accent)' : value >= 40 ? 'var(--sb-ink-3)' : 'var(--sb-ink-4)',
          transition: 'width 0.8s ease',
        }} />
      </div>
      <span style={{ fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-3)', width: 26, textAlign: 'right' }}>{value}</span>
    </div>
  )
}

function RankArtwork({ rank, rankMeta }: { rank: Rank; rankMeta: { label: string } | null }) {
  const base = import.meta.env.BASE_URL
  const [src, setSrc] = useState(`${base}ranks/${rank}.png`)
  const [imgOk, setImgOk] = useState(true)

  function handleError() {
    if (src.endsWith('.png')) setSrc(`${base}ranks/${rank}.svg`)
    else setImgOk(false)
  }

  return (
    <div style={{
      width: 88, height: 88, borderRadius: 'var(--sb-r-chip)', flexShrink: 0,
      overflow: 'hidden',
      border: 'var(--sb-border-width) solid var(--sb-negative-deep)',
      background: 'var(--sb-page)',
      position: 'relative',
    }}>
      {imgOk ? (
        <img
          src={src}
          alt={rankMeta?.label}
          onError={handleError}
          style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top', display: 'block' }}
        />
      ) : (
        <div style={{
          width: '100%', height: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 'var(--sb-t-h1)', fontWeight: 900, color: 'var(--sb-negative-deep)', opacity: 0.25,
          fontFamily: 'serif', letterSpacing: '-0.03em',
        }}>
          {rankMeta?.label?.[0]}
        </div>
      )}
    </div>
  )
}

function IdentityCard({ identity }: { identity: IdentityResult }) {
  return (
    <div style={{
      padding: '16px 18px',
      border: `var(--sb-border-width) solid ${identity.stage === 'core' ? 'var(--sb-accent)' : 'var(--sb-border)'}`,
      borderRadius: 'var(--sb-r-chip)',
      background: identity.stage === 'core' ? alpha('var(--sb-accent)', 3.9) : 'transparent',
      transition: 'border-color 0.2s',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 'var(--sb-t-h3)', lineHeight: 1 }}>{identity.emoji}</span>
        <span style={{
          fontSize: 'var(--sb-t-micro)', letterSpacing: '0.12em', textTransform: 'uppercase',
          color: STAGE_COLOR[identity.stage],
          fontWeight: 500,
        }}>
          {STAGE_LABEL[identity.stage]}
        </span>
      </div>
      <div style={{ fontSize: 'var(--sb-t-body-s)', fontWeight: 500, color: 'var(--sb-ink-1)', letterSpacing: '0.03em', marginBottom: 4 }}>
        {identity.name}
      </div>
      <div style={{ fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-3)', lineHeight: 1.5 }}>
        {identity.description}
      </div>
      {/* Score bar */}
      <div style={{ marginTop: 12, height: 1, background: 'var(--sb-border)' }}>
        <div style={{
          height: '100%', width: `${identity.score}%`,
          background: identity.stage === 'core' ? 'var(--sb-accent)' : 'var(--sb-ink-3)',
        }} />
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function BehavioralOS() {
  const { mode, cachedRank, cachedIdentities, cachedInsights, lastEvaluated, setEvaluation } = useBehavioralStore()
  const tasks   = useTaskStore(s => s.tasks)
  const habits  = useHabitsStore(s => s.habits)
  const [evaluating, setEvaluating] = useState(false)
  const [expandComponents, setExpandComponents] = useState(false)

  const logs = loadLogs()
  const objectives = getDecisiveObjectives(tasks)

  function evaluate() {
    setEvaluating(true)
    setTimeout(() => {
      const rank       = evaluateRank(tasks, habits, logs)
      const identities = detectIdentities(tasks, habits, logs)
      const insights   = generateInsights(rank, identities)
      setEvaluation(rank, identities, insights)
      setEvaluating(false)
    }, 600)
  }

  // Auto-evaluate on first load or if stale (>6h)
  useEffect(() => {
    if (!cachedRank || !lastEvaluated) { evaluate(); return }
    const stale = Date.now() - new Date(lastEvaluated).getTime() > 6 * 60 * 60 * 1000
    if (stale) evaluate()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const rank = cachedRank
  const rankMeta = rank ? RANK_META[rank.rank] : null
  const nextRank = rankMeta?.next ? RANK_META[rankMeta.next] : null

  const modeLabel = mode === 'samurai' ? 'SAMURAI' : mode === 'pharaoh' ? 'PHARAOH' : 'ASTRAL'

  return (
    <div style={{
      ...DARK_SCOPE,
      flex: 1, overflowY: 'auto',
      background: 'var(--sb-page)',
      color: 'var(--sb-ink-1)',
      fontFamily: 'var(--sb-font-ui)',
      minHeight: '100vh',
    }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '36px 32px 80px' }}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 48 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <h1 style={{
                margin: 0, fontSize: 'var(--sb-t-h2)', fontWeight: 600, letterSpacing: '-0.02em',
                color: 'var(--sb-ink-1)',
              }}>
                Behavioral OS
              </h1>
              <span style={{
                fontSize: 'var(--sb-t-micro)', letterSpacing: '0.18em', fontWeight: 600,
                color: 'var(--sb-accent)', border: 'var(--sb-border-width) solid var(--sb-accent)',
                padding: '3px 8px', borderRadius: 'var(--sb-r-chip)',
              }}>
                {modeLabel}
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', letterSpacing: '0.02em' }}>
              Adaptive discipline framework — 14-day evaluation window
            </p>
          </div>

          <Button
            variant="secondary"
            size="sm"
            onClick={evaluate}
            disabled={evaluating}
          >
            <RefreshCw size={ICON.sm} style={{ animation: evaluating ? 'spin 1s linear infinite' : 'none' }} />
            {evaluating ? 'Evaluating…' : 'Refresh'}
          </Button>
        </div>

        {/* ── Rank Panel ─────────────────────────────────────────────────── */}
        <section style={{ marginBottom: 48 }}>
          <div style={{
            padding: '28px 32px 24px',
            border: 'var(--sb-border-width) solid var(--sb-border)',
            borderRadius: 'var(--sb-r-chip)',
          }}>
            {rank ? (
              <>
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 4 }}>
                  <div>
                    <div style={{
                      fontSize: 'var(--sb-t-micro)', letterSpacing: '0.2em', textTransform: 'uppercase',
                      color: 'var(--sb-ink-3)', marginBottom: 10,
                    }}>
                      Your Rank
                    </div>
                    <div style={{
                      fontSize: 38, fontWeight: 700, letterSpacing: '-0.03em',
                      color: 'var(--sb-ink-1)', lineHeight: 1,
                    }}>
                      {rankMeta?.label.toUpperCase()}
                    </div>
                    <div style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', marginTop: 8, letterSpacing: '0.02em' }}>
                      {rankMeta?.philosophy}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
                    {mode === 'samurai' && <RankArtwork rank={rank.rank} rankMeta={rankMeta} />}
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 36, fontWeight: 300, color: rank.score >= 60 ? 'var(--sb-accent)' : 'var(--sb-ink-3)', lineHeight: 1 }}>
                        {rank.score}
                      </div>
                      <div style={{ fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 4 }}>
                        /&nbsp;100
                      </div>
                    </div>
                  </div>
                </div>

                <RankProgressBar score={rank.score} />

                {nextRank && (
                  <div style={{ marginTop: 20, fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-3)', letterSpacing: '0.03em' }}>
                    Next threshold: {nextRank.label} at {nextRank.threshold}
                  </div>
                )}

                {/* Component breakdown — expandable */}
                <div style={{ marginTop: 20, borderTop: 'var(--sb-border-width) solid var(--sb-border)', paddingTop: 16 }}>
                  <button
                    onClick={() => setExpandComponents(v => !v)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-micro)', letterSpacing: '0.1em',
                      textTransform: 'uppercase', padding: 0, marginBottom: expandComponents ? 14 : 0,
                    }}
                  >
                    <ChevronRight size={ICON.sm} style={{ transform: expandComponents ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
                    Evaluation Components
                  </button>
                  {expandComponents && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <ComponentBar label="Task Completion" value={rank.components.taskCompletion} />
                      <ComponentBar label="Habit Consistency" value={rank.components.habitConsistency} />
                      <ComponentBar label="Planning Quality" value={rank.components.planningQuality} />
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-body-s)' }}>
                {evaluating ? 'Evaluating your behavioral patterns…' : 'No evaluation data. Click Refresh.'}
              </div>
            )}
          </div>
        </section>

        {/* ── Decisive Objectives ────────────────────────────────────────── */}
        <section style={{ marginBottom: 48 }}>
          <div style={{
            fontSize: 'var(--sb-t-micro)', letterSpacing: '0.2em', textTransform: 'uppercase',
            color: 'var(--sb-ink-3)', marginBottom: 16,
          }}>
            Decisive Objectives
          </div>

          {objectives.length === 0 ? (
            <div style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-4)', padding: '16px 0', borderTop: 'var(--sb-border-width) solid var(--sb-border)' }}>
              No open objectives. The field is clear.
            </div>
          ) : (
            <div style={{ borderTop: 'var(--sb-border-width) solid var(--sb-border)' }}>
              {objectives.map((t, i) => (
                <div key={t.id} style={{
                  display: 'flex', alignItems: 'center', gap: 16,
                  padding: '14px 0',
                  borderBottom: 'var(--sb-border-width) solid var(--sb-border)',
                }}>
                  <span style={{
                    fontSize: 'var(--sb-t-micro)', letterSpacing: '0.1em', color: 'var(--sb-ink-4)',
                    width: 18, flexShrink: 0,
                  }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span style={{ flex: 1, fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)', letterSpacing: '0.01em', lineHeight: 1.4 }}>
                    {t.title}
                  </span>
                  {t.dueDate && (
                    <span style={{ fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-3)', flexShrink: 0 }}>
                      {new Date(t.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                  <div style={{
                    width: 14, height: 14, borderRadius: 'var(--sb-r-chip)',
                    border: `var(--sb-border-width) solid ${t.quadrant === 'do' ? 'var(--sb-accent)' : 'var(--sb-border)'}`,
                    flexShrink: 0,
                  }} />
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Behavioral Patterns (Identities) ───────────────────────────── */}
        {cachedIdentities.length > 0 && (
          <section style={{ marginBottom: 48 }}>
            <div style={{
              fontSize: 'var(--sb-t-micro)', letterSpacing: '0.2em', textTransform: 'uppercase',
              color: 'var(--sb-ink-3)', marginBottom: 16,
            }}>
              Behavioral Patterns
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 190px), 1fr))',
              gap: 12,
            }}>
              {cachedIdentities.map(identity => (
                <IdentityCard key={identity.id} identity={identity} />
              ))}
            </div>
            <p style={{ marginTop: 14, fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)', lineHeight: 1.6 }}>
              Identities are inferred from repeated behavior over 30 days. They are not assigned — they are earned.
            </p>
          </section>
        )}

        {/* ── System Insights ────────────────────────────────────────────── */}
        {cachedInsights.length > 0 && (
          <section style={{ marginBottom: 48 }}>
            <div style={{
              fontSize: 'var(--sb-t-micro)', letterSpacing: '0.2em', textTransform: 'uppercase',
              color: 'var(--sb-ink-3)', marginBottom: 16,
            }}>
              System Insights
            </div>
            <div style={{ borderLeft: 'var(--sb-border-width) solid var(--sb-border)', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
              {cachedInsights.map((insight, i) => (
                <p key={i} style={{ margin: 0, fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-1)', lineHeight: 1.7, letterSpacing: '0.01em' }}>
                  {insight}
                </p>
              ))}
            </div>
          </section>
        )}

        {/* ── Last evaluated ─────────────────────────────────────────────── */}
        {lastEvaluated && (
          <div style={{ fontSize: 'var(--sb-t-micro)', color: 'var(--sb-ink-4)', letterSpacing: '0.05em' }}>
            Last evaluated {new Date(lastEvaluated).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}

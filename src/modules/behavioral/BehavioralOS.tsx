import { useEffect, useState } from 'react'
import { RefreshCw, ChevronRight } from 'lucide-react'
import { useBehavioralStore } from '@/store/behavioralStore'
import { useTaskStore } from '@/store/taskStore'
import { useHabitsStore, loadLogs } from '@/store/habitsStore'
import {
  evaluateRank, detectIdentities, generateInsights,
  getDecisiveObjectives, RANK_META,
} from '@/lib/behavioralEngine'
import type { IdentityResult, Rank, IdentityStage } from '@/store/behavioralStore'

// ─── Samurai palette (applied over current theme when mode is samurai) ────────

const S: Record<string, string> = {
  bg:        'var(--color-bg, #0C0B09)',
  surface:   'var(--color-surface, #131210)',
  border:    'var(--color-border, #1E1C18)',
  accent:    'var(--color-accent, #8B1A1A)',
  accentFg:  'var(--color-accent-bright, #C0392B)',
  text:      'var(--color-text, #EDE4D3)',
  dim:       'var(--color-text-dim, #7A6E5E)',
  muted:     'var(--color-text-muted, #3C3530)',
}

// ─── Micro-components ─────────────────────────────────────────────────────────

const STAGE_LABEL: Record<IdentityStage, string> = {
  emerging:    'EMERGING',
  developing:  'DEVELOPING',
  established: 'ESTABLISHED',
  core:        'CORE',
}

const STAGE_COLOR: Record<IdentityStage, string> = {
  emerging:    S.muted,
  developing:  S.dim,
  established: S.dim,
  core:        S.accentFg,
}

const RANK_ORDER: Rank[] = ['ronin', 'samurai', 'daimyo', 'shogun']

function RankProgressBar({ score }: { score: number }) {
  const thresholds = [0, 36, 61, 81, 100]
  return (
    <div style={{ marginTop: 20 }}>
      {/* Score bar */}
      <div style={{ height: 3, background: S.border, borderRadius: 2, overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 2,
          width: `${score}%`,
          background: `linear-gradient(90deg, ${S.accent}, ${S.accentFg})`,
          transition: 'width 1s cubic-bezier(0.16, 1, 0.3, 1)',
        }} />
      </div>
      {/* Threshold markers */}
      <div style={{ position: 'relative', height: 20, marginTop: 4 }}>
        {thresholds.slice(1, -1).map(t => (
          <div key={t} style={{
            position: 'absolute', left: `${t}%`,
            width: 1, height: 6, background: S.muted, top: 0,
          }} />
        ))}
        {RANK_ORDER.map((r, i) => (
          <span key={r} style={{
            position: 'absolute',
            left: `${thresholds[i]}%`,
            fontSize: 9,
            letterSpacing: '0.08em',
            color: score >= thresholds[i] ? S.dim : S.muted,
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
      <span style={{ fontSize: 10, color: S.dim, letterSpacing: '0.08em', width: 110, flexShrink: 0, textTransform: 'uppercase' }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 2, background: S.border, borderRadius: 1 }}>
        <div style={{
          height: '100%', borderRadius: 1,
          width: `${value}%`,
          background: value >= 60 ? S.accent : value >= 40 ? S.dim : S.muted,
          transition: 'width 0.8s ease',
        }} />
      </div>
      <span style={{ fontSize: 10, color: S.dim, width: 26, textAlign: 'right' }}>{value}</span>
    </div>
  )
}

function RankArtwork({ rank, rankMeta, score }: { rank: Rank; rankMeta: { label: string } | null; score: number }) {
  const [imgOk, setImgOk] = useState(true)
  const RANK_ART: Record<Rank, string> = {
    ronin:   '/ranks/ronin.png',
    samurai: '/ranks/samurai.png',
    daimyo:  '/ranks/daimyo.png',
    shogun:  '/ranks/shogun.png',
  }
  const RANK_BG: Record<Rank, string> = {
    ronin:   'linear-gradient(135deg, #0C0B09 0%, #1A1410 50%, #0C0B09 100%)',
    samurai: 'linear-gradient(135deg, #0C0B09 0%, #1A0A0A 50%, #0C0B09 100%)',
    daimyo:  'linear-gradient(135deg, #0C0B09 0%, #0A0D1A 50%, #0C0B09 100%)',
    shogun:  'linear-gradient(135deg, #0C0B09 0%, #1A0A0A 60%, #2A0A0A 100%)',
  }
  return (
    <div style={{ position: 'relative', width: '100%', height: 260, overflow: 'hidden', background: RANK_BG[rank] }}>
      {imgOk && (
        <img
          src={RANK_ART[rank]}
          alt={rankMeta?.label}
          onError={() => setImgOk(false)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top', display: 'block' }}
        />
      )}
      {/* Decorative pattern when no image */}
      {!imgOk && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{
            fontSize: 96, fontWeight: 900, letterSpacing: '-0.05em',
            color: '#8B1A1A', opacity: 0.08, userSelect: 'none',
            fontFamily: 'serif',
          }}>
            {rankMeta?.label?.toUpperCase()}
          </div>
        </div>
      )}
      {/* Gradient fade */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(to bottom, rgba(12,11,9,0) 40%, rgba(12,11,9,0.85) 80%, rgba(12,11,9,1) 100%)',
      }} />
      {/* Rank label overlay */}
      <div style={{
        position: 'absolute', bottom: 20, left: 28,
        fontSize: 9, letterSpacing: '0.28em', textTransform: 'uppercase',
        color: '#C0392B', fontWeight: 600,
      }}>
        {rankMeta?.label} · {score} / 100
      </div>
    </div>
  )
}


  return (
    <div style={{
      padding: '16px 18px',
      border: `1px solid ${identity.stage === 'core' ? S.accent : S.border}`,
      borderRadius: 2,
      background: identity.stage === 'core' ? `${S.accent}0A` : 'transparent',
      transition: 'border-color 0.2s',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 15, lineHeight: 1 }}>{identity.emoji}</span>
        <span style={{
          fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase',
          color: STAGE_COLOR[identity.stage],
          fontWeight: 500,
        }}>
          {STAGE_LABEL[identity.stage]}
        </span>
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 500, color: S.text, letterSpacing: '0.03em', marginBottom: 4 }}>
        {identity.name}
      </div>
      <div style={{ fontSize: 10.5, color: S.dim, lineHeight: 1.5 }}>
        {identity.description}
      </div>
      {/* Score bar */}
      <div style={{ marginTop: 12, height: 1, background: S.border }}>
        <div style={{
          height: '100%', width: `${identity.score}%`,
          background: identity.stage === 'core' ? S.accent : S.dim,
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
      flex: 1, overflowY: 'auto',
      background: S.bg,
      color: S.text,
      fontFamily: "'DM Sans', sans-serif",
      minHeight: '100vh',
    }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '36px 32px 80px' }}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 48 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <h1 style={{
                margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em',
                color: S.text,
              }}>
                Behavioral OS
              </h1>
              <span style={{
                fontSize: 9, letterSpacing: '0.18em', fontWeight: 600,
                color: S.accent, border: `1px solid ${S.accent}`,
                padding: '3px 8px', borderRadius: 1,
              }}>
                {modeLabel}
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 12, color: S.dim, letterSpacing: '0.02em' }}>
              Adaptive discipline framework — 14-day evaluation window
            </p>
          </div>

          <button
            onClick={evaluate}
            disabled={evaluating}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'none', border: `1px solid ${S.border}`, borderRadius: 2,
              padding: '7px 14px', cursor: evaluating ? 'default' : 'pointer',
              color: evaluating ? S.muted : S.dim, fontSize: 11, letterSpacing: '0.06em',
              transition: 'border-color 0.15s, color 0.15s',
            }}
            onMouseEnter={e => { if (!evaluating) { (e.currentTarget as HTMLElement).style.borderColor = S.dim; (e.currentTarget as HTMLElement).style.color = S.text } }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = S.border; (e.currentTarget as HTMLElement).style.color = S.dim }}
          >
            <RefreshCw size={12} style={{ animation: evaluating ? 'spin 1s linear infinite' : 'none' }} />
            {evaluating ? 'Evaluating…' : 'Refresh'}
          </button>
        </div>

        {/* ── Rank Panel ─────────────────────────────────────────────────── */}
        <section style={{ marginBottom: 48 }}>
          <div style={{
            border: `1px solid ${S.border}`,
            borderRadius: 2,
            overflow: 'hidden',
          }}>
            {rank ? (
              <>
                {/* Rank artwork — samurai mode only */}
                {mode === 'samurai' && (
                  <RankArtwork rank={rank.rank} rankMeta={rankMeta} score={rank.score} />
                )}

                <div style={{ padding: '24px 32px 24px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 4 }}>
                    <div>
                      {mode !== 'samurai' && (
                        <div style={{
                          fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase',
                          color: S.dim, marginBottom: 10,
                        }}>
                          Your Rank
                        </div>
                      )}
                      <div style={{
                        fontSize: 38, fontWeight: 700, letterSpacing: '-0.03em',
                        color: S.text, lineHeight: 1,
                      }}>
                        {rankMeta?.label.toUpperCase()}
                      </div>
                      <div style={{ fontSize: 12, color: S.dim, marginTop: 8, letterSpacing: '0.02em' }}>
                        {rankMeta?.philosophy}
                      </div>
                    </div>
                    {mode !== 'samurai' && (
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 36, fontWeight: 300, color: rank.score >= 60 ? S.accent : S.dim, lineHeight: 1 }}>
                          {rank.score}
                        </div>
                        <div style={{ fontSize: 9, color: S.muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 4 }}>
                          /&nbsp;100
                        </div>
                      </div>
                    )}
                  </div>

                  <RankProgressBar score={rank.score} />

                  {nextRank && (
                    <div style={{ marginTop: 20, fontSize: 10.5, color: S.dim, letterSpacing: '0.03em' }}>
                      Next threshold: {nextRank.label} at {nextRank.threshold}
                    </div>
                  )}

                {/* Component breakdown — expandable */}
                <div style={{ marginTop: 20, borderTop: `1px solid ${S.border}`, paddingTop: 16 }}>
                  <button
                    onClick={() => setExpandComponents(v => !v)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: S.dim, fontSize: 10, letterSpacing: '0.1em',
                      textTransform: 'uppercase', padding: 0, marginBottom: expandComponents ? 14 : 0,
                    }}
                  >
                    <ChevronRight size={10} style={{ transform: expandComponents ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
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
                </div>{/* end padding wrapper */}
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '24px 0', color: S.dim, fontSize: 12 }}>
                {evaluating ? 'Evaluating your behavioral patterns…' : 'No evaluation data. Click Refresh.'}
              </div>
            )}
          </div>
        </section>

        {/* ── Decisive Objectives ────────────────────────────────────────── */}
        <section style={{ marginBottom: 48 }}>
          <div style={{
            fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase',
            color: S.dim, marginBottom: 16,
          }}>
            Decisive Objectives
          </div>

          {objectives.length === 0 ? (
            <div style={{ fontSize: 12, color: S.muted, padding: '16px 0', borderTop: `1px solid ${S.border}` }}>
              No open objectives. The field is clear.
            </div>
          ) : (
            <div style={{ borderTop: `1px solid ${S.border}` }}>
              {objectives.map((t, i) => (
                <div key={t.id} style={{
                  display: 'flex', alignItems: 'center', gap: 16,
                  padding: '14px 0',
                  borderBottom: `1px solid ${S.border}`,
                }}>
                  <span style={{
                    fontSize: 9, letterSpacing: '0.1em', color: S.muted,
                    width: 18, flexShrink: 0,
                  }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span style={{ flex: 1, fontSize: 13, color: S.text, letterSpacing: '0.01em', lineHeight: 1.4 }}>
                    {t.title}
                  </span>
                  {t.dueDate && (
                    <span style={{ fontSize: 10, color: S.dim, flexShrink: 0 }}>
                      {new Date(t.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                  <div style={{
                    width: 14, height: 14, borderRadius: 1,
                    border: `1px solid ${t.quadrant === 'do' ? S.accent : S.border}`,
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
              fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase',
              color: S.dim, marginBottom: 16,
            }}>
              Behavioral Patterns
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
              gap: 12,
            }}>
              {cachedIdentities.map(identity => (
                <IdentityCard key={identity.id} identity={identity} />
              ))}
            </div>
            <p style={{ marginTop: 14, fontSize: 10.5, color: S.muted, lineHeight: 1.6 }}>
              Identities are inferred from repeated behavior over 30 days. They are not assigned — they are earned.
            </p>
          </section>
        )}

        {/* ── System Insights ────────────────────────────────────────────── */}
        {cachedInsights.length > 0 && (
          <section style={{ marginBottom: 48 }}>
            <div style={{
              fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase',
              color: S.dim, marginBottom: 16,
            }}>
              System Insights
            </div>
            <div style={{ borderLeft: `1px solid ${S.border}`, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
              {cachedInsights.map((insight, i) => (
                <p key={i} style={{ margin: 0, fontSize: 13, color: S.text, lineHeight: 1.7, letterSpacing: '0.01em' }}>
                  {insight}
                </p>
              ))}
            </div>
          </section>
        )}

        {/* ── Last evaluated ─────────────────────────────────────────────── */}
        {lastEvaluated && (
          <div style={{ fontSize: 10, color: S.muted, letterSpacing: '0.05em' }}>
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

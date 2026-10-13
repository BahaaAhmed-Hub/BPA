import { useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { Button, Card, Segmented } from '@/components/ui'
import { ICON } from '@/lib/type'
import { Eyebrow, Field, NumField, Row } from './fields'
import { inputStyle } from './fieldStyle'
import { fmtProgress, GOAL_STATE_INK, GOAL_STATE_LABEL, goalSentence, goalStatus, KIND_LABEL } from './goalStats'
import { useLibraryStore } from './libraryStore'
import { todayISO } from './readingStats'
import type { GoalKind } from './types'

const KINDS: { value: GoalKind; label: string }[] = [
  { value: 'books', label: 'Books' }, { value: 'pages', label: 'Pages' }, { value: 'minutes', label: 'Hours' },
]

/** A time goal is typed in hours and stored in minutes, like every other duration here. */
const toTarget = (kind: GoalKind, typed: number) => (kind === 'minutes' ? typed * 60 : typed)
const toTyped = (kind: GoalKind, target: number) => (kind === 'minutes' ? Math.round(target / 60) : target)

/**
 * Yearly goals, and challenges — a goal narrowed to one list or category.
 *
 * Both are the same row: a year, a kind (books finished, pages read, hours
 * spent) and a target, with a list when it is a challenge. Progress is counted
 * from finished books and the session log (`goalStatus`), never stored, so the
 * bar moves when a finish date is corrected or a session deleted.
 *
 * The target writes straight through. A second goal for the same year, kind and
 * scope is refused in words rather than left to the table's unique.
 */
export function GoalsCard() {
  const goals = useLibraryStore(s => s.goals)
  const missing = useLibraryStore(s => s.goalsMissing)
  const books = useLibraryStore(s => s.books)
  const links = useLibraryStore(s => s.links)
  const lists = useLibraryStore(s => s.lists)
  const sessions = useLibraryStore(s => s.sessions)
  const addGoal = useLibraryStore(s => s.addGoal)
  const updateGoalTarget = useLibraryStore(s => s.updateGoalTarget)
  const deleteGoal = useLibraryStore(s => s.deleteGoal)

  const today = todayISO()
  const thisYear = Number(today.slice(0, 4))
  const [year, setYear] = useState(thisYear)
  const [kind, setKind] = useState<GoalKind>('books')
  const [typed, setTyped] = useState('')
  const [listId, setListId] = useState('')
  const [err, setErr] = useState<string | null>(null)

  if (missing) {
    return (
      <Card style={{ padding: '16px 18px' }}>
        <Eyebrow>Goals</Eyebrow>
        <div role="status" style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-accent-deep)' }}>
          Goals need migration <code>20260033_library_goals.sql</code>.
        </div>
      </Card>
    )
  }

  const mine = goals.filter(g => g.year === year).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const listName = (id?: string) => (id ? lists.find(l => l.id === id)?.name ?? 'a removed list' : undefined)

  function add() {
    const n = parseInt(typed, 10)
    if (!Number.isFinite(n) || n < 1) { setErr(kind === 'minutes' ? 'How many hours? At least 1.' : 'How many? At least 1.'); return }
    const target = toTarget(kind, n)
    if (target > 1_000_000) { setErr('That is more than a year holds.'); return }
    const made = addGoal({ year, kind, target, ...(listId ? { listId } : {}) })
    if (!made) { setErr(`You already have a ${KIND_LABEL[kind].toLowerCase()} goal for ${listId ? `“${listName(listId)}”` : 'the whole library'} in ${year}. Change its target instead.`); return }
    setErr(null); setTyped('')
  }

  return (
    <Card style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ flex: 1 }}><Eyebrow>Goals</Eyebrow></div>
        <button type="button" onClick={() => setYear(y => y - 1)} aria-label="Previous year" style={yearBtn}><ChevronLeft size={ICON.sm} /></button>
        <span aria-live="polite" style={{ minWidth: 44, textAlign: 'center', fontWeight: 600, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)', marginTop: -8 }}>{year}</span>
        <button type="button" onClick={() => setYear(y => y + 1)} aria-label="Next year" style={yearBtn}><ChevronRight size={ICON.sm} /></button>
      </div>

      {mine.length === 0 && (
        <div style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>
          No goals for {year} yet. Set one below — a number of books, pages or hours, for the whole library or for one list.
        </div>
      )}

      {mine.map(g => {
        const st = goalStatus(g, books, links, sessions, today)
        const scope = listName(g.listId)
        const title = `${KIND_LABEL[g.kind]}${scope ? ` · ${scope}` : ''}`
        return (
          <div key={g.id} role="group" aria-label={`${title} goal`} style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 10, borderTop: 'var(--sb-border-width) solid var(--sb-hairline)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-1)', flex: '1 1 140px', minWidth: 0 }}>
                {title}{scope ? <span style={{ fontWeight: 500, color: 'var(--sb-ink-3)' }}> · challenge</span> : null}
              </span>
              <span style={{ fontWeight: 600, fontSize: 'var(--sb-t-body-s)', color: GOAL_STATE_INK[st.state] }}>{GOAL_STATE_LABEL[st.state]}</span>
              <button type="button" onClick={() => deleteGoal(g.id)} aria-label={`Remove the ${title} goal`} title="Remove this goal"
                style={{ all: 'unset', cursor: 'pointer', color: 'var(--sb-ink-3)', display: 'flex', padding: 4 }}>
                <Trash2 size={ICON.sm} />
              </button>
            </div>
            <div role="progressbar" aria-label={`${title} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={st.pct}
              style={{ height: 8, borderRadius: 'var(--sb-r-pill)', background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-hairline)', overflow: 'hidden' }}>
              <div style={{ width: `${st.pct}%`, height: '100%', background: 'var(--sb-accent)' }} />
            </div>
            <div style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-2)' }}>
              {fmtProgress(g.kind, st.progress, g.target)} · {st.pct}%
            </div>
            <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>{goalSentence(g.kind, st)}</div>
            <div style={{ maxWidth: 140 }}>
              <NumField label={g.kind === 'minutes' ? 'Target (hours)' : 'Target'} value={toTyped(g.kind, g.target)}
                onPush={v => { if (v && v > 0 && toTarget(g.kind, v) <= 1_000_000) updateGoalTarget(g.id, toTarget(g.kind, v)) }} />
            </div>
          </div>
        )
      })}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 10, borderTop: 'var(--sb-border-width) solid var(--sb-hairline)' }}>
        <Row>
          <Segmented value={kind} onChange={setKind} options={KINDS} />
          <div style={{ width: 110 }}>
            <Field label={kind === 'minutes' ? 'Hours' : 'Target'}>
              <input value={typed} inputMode="numeric" aria-label="New goal target" placeholder={kind === 'books' ? '24' : kind === 'pages' ? '10000' : '100'}
                onChange={e => { setTyped(e.target.value.replace(/[^\d]/g, '')); setErr(null) }}
                onKeyDown={e => { if (e.key === 'Enter') add() }} style={inputStyle} />
            </Field>
          </div>
          <Field label="For" grow={2}>
            <select aria-label="Goal scope" value={listId} onChange={e => { setListId(e.target.value); setErr(null) }} style={inputStyle}>
              <option value="">The whole library</option>
              {lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
          <Button size="sm" variant="secondary" onClick={add}><Plus size={ICON.sm} /> Set goal</Button>
        </Row>
        {listId && <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>A challenge: it counts only the books on “{listName(listId)}”.</div>}
        {err && <div role="alert" style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-negative)' }}>{err}</div>}
      </div>
    </Card>
  )
}

const yearBtn = { all: 'unset', cursor: 'pointer', display: 'flex', padding: 6, color: 'var(--sb-ink-2)', marginTop: -8 } as const

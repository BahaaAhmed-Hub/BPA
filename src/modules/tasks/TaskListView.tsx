// ─── List view ───────────────────────────────────────────────────────────────
// The switcher in 9B–9F offers Board | Matrix | List but no artboard draws the
// list, so it reuses the 9E row verbatim and the popover's grouping.

import { useLayoutEffect, useRef } from 'react'
import gsap from 'gsap'
import { Flip } from 'gsap/Flip'
import type { Task } from '@/types'
import { TaskRow } from './TaskRow'
import { buildTaskGroups, sortUrgentFirst, type TaskGroupBy } from './taskVisuals'
import { CountBadge } from './controls'

gsap.registerPlugin(Flip)

// Rows glide to their new place when a filter, a grouping or a tick re-lays the
// list. The positions are read after every commit and replayed on the next one,
// because React has already moved the DOM by the time an effect can run.
// Flip is skipped under prefers-reduced-motion.
function useFlipRows(signature: string) {
  const ref = useRef<HTMLDivElement>(null)
  const last = useRef<Flip.FlipState | null>(null)
  const settled = useRef(true)

  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    const rows = root.querySelectorAll('[data-flip-id]')
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const record = () => { last.current = Flip.getState(rows); settled.current = true }

    if (last.current && !reduce) {
      settled.current = false
      Flip.from(last.current, {
        targets: rows,
        duration: 0.35,
        ease: 'power2.out',
        absolute: true,
        onEnter: els => gsap.fromTo(els, { opacity: 0 }, { opacity: 1, duration: 0.25 }),
        onComplete: record,
        onInterrupt: record,
      })
    } else {
      record()
    }
    return () => { if (!settled.current) Flip.killFlipsOf(rows) }
  }, [signature])

  return ref
}

export function TaskListView({ tasks, onOpen, hideCompleted, groupBy, filteredTaskIds }: {
  tasks: Task[]
  onOpen: (id: string) => void
  hideCompleted?: boolean
  groupBy?: TaskGroupBy
  filteredTaskIds?: Set<string> | null
}) {
  const visible = tasks
    .filter(t => (hideCompleted ? !t.completed : true))
    .filter(t => (filteredTaskIds ? filteredTaskIds.has(t.id) : true))

  const groups = groupBy && groupBy !== 'none'
    ? buildTaskGroups(visible, groupBy)
    : [{ key: 'all', label: '', emoji: '', color: 'var(--sb-ink-4)', tasks: sortUrgentFirst(visible) }]

  const signature = groups.map(g => g.key + ':' + g.tasks.map(t => t.id).join(',')).join('|')
  const listRef = useFlipRows(signature)

  return (
    <div ref={listRef} style={{ padding: '4px 28px 28px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      {visible.length === 0 && (
        <p style={{ margin: 0, padding: '40px 0', textAlign: 'center', color: 'var(--sb-ink-4)', fontSize: 'var(--sb-t-body)' }}>
          Nothing here.
        </p>
      )}
      {groups.map(g => (
        <div key={g.key} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {g.label && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 2px' }}>
              <span style={{ width: 8, height: 8, borderRadius: 'var(--sb-r-pill)', background: g.color, flexShrink: 0 }} />
              <span style={{ fontSize: 'var(--sb-t-label)', fontWeight: 600, color: 'var(--sb-ink-1)' }}>{g.label}</span>
              <CountBadge value={g.tasks.length} />
            </div>
          )}
          {g.tasks.map(t => <div key={t.id} data-flip-id={t.id}><TaskRow task={t} onOpen={onOpen} /></div>)}
        </div>
      ))}
    </div>
  )
}

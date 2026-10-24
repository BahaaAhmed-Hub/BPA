import { useMemo } from 'react'
import { Check } from 'lucide-react'
import { useProjectStore } from '@/store/projectStore'
import { useUIStore } from '@/store/uiStore'
import { STROKE } from '@/lib/type'

// ─── A milestone, where the calendar can draw it ─────────────────────────────
// A milestone is not an event: nothing is written to Google, nobody is invited,
// and it has no hour. The calendar draws it as a marker on its day — a pill
// that reads as "something is due" beside the day's real events, and opens its
// project rather than an event panel.

export interface MilestoneMarker {
  id: string
  title: string
  /** YYYY-MM-DD */
  date: string
  done: boolean
  projectId: string
  projectName: string
  color?: string
}

/** Dated milestones of projects still being worked on, by day. Archived
 *  projects draw nothing — an archived project is one put away — and an undated
 *  milestone has no day to draw on. */
export function useMilestoneMarkers(): Map<string, MilestoneMarker[]> {
  const projects = useProjectStore(s => s.projects)
  const milestones = useProjectStore(s => s.milestones)
  return useMemo(() => {
    const live = new Map(projects.filter(p => !p.archived).map(p => [p.id, p]))
    const byDay = new Map<string, MilestoneMarker[]>()
    for (const m of milestones) {
      const p = live.get(m.projectId)
      if (!p || !m.dueDate) continue
      const list = byDay.get(m.dueDate) ?? []
      list.push({ id: m.id, title: m.title, date: m.dueDate, done: m.done, projectId: p.id, projectName: p.name, color: p.color })
      byDay.set(m.dueDate, list)
    }
    for (const list of byDay.values()) list.sort((a, b) => a.projectName.localeCompare(b.projectName) || a.title.localeCompare(b.title))
    return byDay
  }, [projects, milestones])
}

/** The diamond: a milestone's own shape, in the project's colour. A fill, never
 *  text, so a colour somebody chose cannot fail a contrast pair. */
export function Diamond({ color, size = 9, hollow }: { color?: string; size?: number; hollow?: boolean }) {
  return (
    <span aria-hidden style={{
      width: size, height: size, flexShrink: 0, transform: 'rotate(45deg)', boxSizing: 'border-box',
      background: hollow ? 'transparent' : (color ?? 'var(--sb-ink-4)'),
      border: `2px solid ${color ?? 'var(--sb-ink-4)'}`, borderRadius: 2, display: 'inline-block',
    }} />
  )
}

/** One marker, as a pill. `compact` is for a month cell, which is already busy. */
export function MilestoneChip({ marker, compact }: { marker: MilestoneMarker; compact?: boolean }) {
  const focusOn = useUIStore(s => s.focusOn)
  return (
    <button
      type="button"
      data-milestone-marker={marker.id}
      title={`${marker.title} — ${marker.projectName}${marker.done ? ' (done)' : ''}`}
      aria-label={`Milestone ${marker.title}, ${marker.projectName}${marker.done ? ', done' : ''}. Open the project`}
      // The cell around a chip opens the day; the chip opens its project.
      onClick={e => { e.stopPropagation(); focusOn({ module: 'projects', id: marker.projectId }) }}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, maxWidth: '100%', cursor: 'pointer',
        height: compact ? 22 : 22, padding: '0 9px', borderRadius: 999, font: 'inherit',
        background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)', textAlign: 'left',
      }}>
      {marker.done
        ? <Check size={11} strokeWidth={STROKE.active} style={{ flexShrink: 0, color: 'var(--sb-positive-deep)' }} />
        : <Diamond color={marker.color} size={8} />}
      <span style={{
        minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        fontSize: 11.5, fontWeight: 500, color: marker.done ? 'var(--sb-ink-3)' : 'var(--sb-ink-1)',
        textDecoration: marker.done ? 'line-through' : 'none',
      }}>{marker.title}</span>
    </button>
  )
}

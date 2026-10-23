import { useProjectStore } from '@/store/projectStore'

/** "Project" while an event is still being composed. There is no event id yet, so nothing can be
 *  linked: this only holds the choice, and the calendar links it once Google has made the event
 *  (a failed create therefore leaves no link behind). Same pill as the one on an existing event. */
export function ComposerProjectRow({ value, onChange, wrap }: { value: string; onChange: (projectId: string) => void; wrap?: React.CSSProperties }) {
  const projects = useProjectStore(s => s.projects)
  const choices = projects.filter(p => !p.archived && p.status !== 'done')
  if (choices.length === 0) return null
  const current = choices.find(p => p.id === value)
  return (
    <span data-composer-project style={{ display: 'flex', alignItems: 'center', gap: 8, ...wrap }}>
      <span style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-3)' }}>Project</span>
      <span style={{ flex: 1 }} />
      <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6, height: 'var(--sb-h-pill)', padding: '0 11px', minWidth: 0, maxWidth: 220,
        borderRadius: 'var(--sb-r-pill)', background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)' }}>
        <span aria-hidden style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, background: current?.color ?? 'transparent', border: current ? 'none' : 'var(--sb-border-width) solid var(--sb-border)' }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: current ? 'var(--sb-ink-1)' : 'var(--sb-ink-4)' }}>
          {current ? current.name : 'No project'}
        </span>
        <select aria-label="Project for this event" value={current?.id ?? ''} onChange={e => onChange(e.target.value)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', border: 'none' }}>
          <option value="">No project</option>
          {choices.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </span>
    </span>
  )
}

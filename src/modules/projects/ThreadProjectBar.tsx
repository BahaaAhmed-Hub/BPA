import { useMemo, useState } from 'react'
import { Button } from '@/components/ui'
import { useProjectStore } from '@/store/projectStore'
import {
  dismissSuggestion, loadDismissed, suggestProject, threadMeta, threadRef, type ThreadLike,
} from './threadLinks'

/** "Project" in the mail reader — the mail side of the link the project page
 *  lists under Mail. When the thread has no project and exactly one clearly
 *  fits, it says which and why, and links only when you press Link. */
export function ThreadProjectBar({ thread }: { thread: ThreadLike }) {
  const projects = useProjectStore(s => s.projects)
  const links = useProjectStore(s => s.links)
  const addLink = useProjectStore(s => s.addLink)
  const removeLinksByRef = useProjectStore(s => s.removeLinksByRef)
  const [dismissed, setDismissed] = useState(loadDismissed)
  const ref = threadRef(thread.accountEmail, thread.threadId)

  const linked = links.find(l => l.kind === 'thread' && l.refId === ref)
  const current = projects.find(p => p.id === linked?.projectId)
  const choices = projects.filter(p => (!p.archived && p.status !== 'done') || p.id === current?.id)
  const suggestion = useMemo(
    () => suggestProject(thread, ref, projects, links, dismissed),
    [thread, ref, projects, links, dismissed])
  if (projects.length === 0) return null

  const link = (projectId: string) => {
    removeLinksByRef('thread', ref)
    if (projectId) addLink(projectId, 'thread', ref, threadMeta(thread))
  }

  return (
    <div data-thread-project style={{
      display: 'flex', flexDirection: 'column', gap: 8, padding: '9px 14px',
      borderBottom: 'var(--sb-border-width) solid var(--sb-hairline)',
    }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-3)' }}>Project</span>
        <span style={{ flex: 1 }} />
        <span style={{
          position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6, height: 'var(--sb-h-pill)', padding: '0 11px', minWidth: 0, maxWidth: 240,
          borderRadius: 'var(--sb-r-pill)', background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-border)',
        }}>
          <span aria-hidden style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, background: current?.color ?? 'transparent', border: current ? 'none' : 'var(--sb-border-width) solid var(--sb-border)' }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: current ? 'var(--sb-ink-1)' : 'var(--sb-ink-4)' }}>
            {current ? current.name : 'No project'}
          </span>
          <select aria-label="Project for this thread" value={current?.id ?? ''} onChange={e => link(e.target.value)}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', border: 'none' }}>
            <option value="">No project</option>
            {choices.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </span>
      </span>

      {suggestion && (
        <span data-project-suggestion={suggestion.project.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ flex: '1 1 180px', minWidth: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-2)', lineHeight: 1.4 }}>
            Looks like <b style={{ color: 'var(--sb-ink-1)' }}>{suggestion.project.name}</b> — {suggestion.reason}.
          </span>
          <Button size="sm" variant="accent" onClick={() => link(suggestion.project.id)}>Link</Button>
          <Button size="sm" variant="ghost" onClick={() => { dismissSuggestion(ref, suggestion.project.id); setDismissed(loadDismissed()) }}>Not this</Button>
        </span>
      )}
    </div>
  )
}

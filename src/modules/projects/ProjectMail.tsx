import { useMemo } from 'react'
import { ArrowUpRight, Mail, X } from 'lucide-react'
import { ICON, STROKE } from '@/lib/type'
import { useProjectStore } from '@/store/projectStore'
import { useUIStore } from '@/store/uiStore'
import type { Project, ProjectLink, ThreadMeta } from './types'

const CARD: React.CSSProperties = {
  background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
  borderRadius: 'var(--sb-r-card)', boxShadow: 'var(--sb-shadow-control)',
}
const CAP: React.CSSProperties = {
  fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--sb-ink-3)',
}
const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: new Date(ms).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })

/** The threads linked to a project, newest first. A link made before its
 *  snapshot arrived has no subject yet and says so rather than guessing. */
export function projectThreads(project: Pick<Project, 'id'>, links: ProjectLink[]) {
  return links
    .filter(l => l.projectId === project.id && l.kind === 'thread')
    .map(l => ({ link: l, meta: l.meta as ThreadMeta | undefined }))
    .sort((a, b) => (b.meta?.at ?? 0) - (a.meta?.at ?? 0))
}

export function ProjectMail({ project }: { project: Project }) {
  const links = useProjectStore(s => s.links)
  const removeLink = useProjectStore(s => s.removeLink)
  const focusOn = useUIStore(s => s.focusOn)
  const rows = useMemo(() => projectThreads(project, links), [project, links])

  if (rows.length === 0) {
    return (
      <div data-project-mail-empty style={{ ...CARD, padding: '22px 20px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <Mail size={ICON.lg} style={{ color: 'var(--sb-ink-3)', flexShrink: 0, marginTop: 2 }} />
        <p style={{ margin: 0, fontSize: 'var(--sb-t-body)', lineHeight: 1.5, color: 'var(--sb-ink-3)' }}>
          No conversations filed here yet. Open a thread in Mail and choose this project — when a subject plainly names it, Mail offers it for you.
        </p>
      </div>
    )
  }
  return (
    <div data-project-mail style={{ ...CARD, overflow: 'hidden' }}>
      <div style={{ ...CAP, padding: '12px 12px 6px' }}>Conversations · {rows.length}</div>
      {rows.map(({ link, meta }) => (
        <div key={link.id} data-project-thread={link.refId}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderBottom: 'var(--sb-border-width) solid var(--sb-hairline)', flexWrap: 'wrap' }}>
          <span style={{ flex: '1 1 220px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 'var(--sb-t-body)', fontWeight: 600, color: 'var(--sb-ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {meta?.subject || 'A conversation'}
            </span>
            <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {meta ? `${meta.fromName || meta.fromEmail} · ${meta.at ? fmtDate(meta.at) : ''} · ${meta.accountEmail}` : link.refId.split('|')[0]}
            </span>
          </span>
          <button type="button" aria-label={`Open ${meta?.subject || 'the conversation'} in Mail`} title="Open it in Mail"
            onClick={() => focusOn({ module: 'inbox', id: link.refId })}
            style={{ flexShrink: 0, background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: 'var(--sb-ink-3)', display: 'flex' }}>
            <ArrowUpRight size={ICON.sm} strokeWidth={STROKE.rest} />
          </button>
          <button type="button" aria-label={`Take ${meta?.subject || 'the conversation'} out of this project`} title="Take it out of this project — the thread stays in your mail"
            onClick={() => removeLink(link.id)}
            style={{ flexShrink: 0, background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: 'var(--sb-ink-4)', display: 'flex' }}>
            <X size={ICON.sm} />
          </button>
        </div>
      ))}
    </div>
  )
}

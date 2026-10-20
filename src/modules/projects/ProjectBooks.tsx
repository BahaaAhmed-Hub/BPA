import { useMemo } from 'react'
import { X } from 'lucide-react'
import { ICON } from '@/lib/type'
import { inputStyle } from '@/modules/library/fieldStyle'
import { useLibraryStore } from '@/modules/library/libraryStore'
import { progressOf } from '@/modules/library/readingStats'
import { useProjectStore } from '@/store/projectStore'
import type { Project } from './types'

const CARD: React.CSSProperties = {
  background: 'var(--sb-card)', border: 'var(--sb-border-width) solid var(--sb-border)',
  borderRadius: 'var(--sb-r-card)', boxShadow: 'var(--sb-shadow-control)',
}
const CAP: React.CSSProperties = {
  fontSize: 'var(--sb-t-micro)', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--sb-ink-3)',
}
const STATUS: Record<string, string> = { want: 'Want to read', reading: 'Reading', finished: 'Finished', paused: 'Paused', abandoned: 'Set aside' }

/** The reading behind a project. Progress is the Library's own derived figure
 *  (the furthest page any sitting reached) — never stored here, so a sitting
 *  logged in the Library moves it with no second write. */
export function ProjectBooks({ project }: { project: Project }) {
  const books = useLibraryStore(s => s.books)
  const sessions = useLibraryStore(s => s.sessions)
  const links = useProjectStore(s => s.links)
  const addLink = useProjectStore(s => s.addLink)
  const removeLink = useProjectStore(s => s.removeLink)

  const mine = links.filter(l => l.projectId === project.id && l.kind === 'book')
  const taken = new Set(mine.map(l => l.refId))
  const options = useMemo(() => books.filter(b => !taken.has(b.id)).sort((a, b) => a.title.localeCompare(b.title)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [books, links, project.id])

  return (
    <div data-project-books style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ ...CARD, padding: 12 }}>
        <select aria-label="Link a book" value="" style={{ ...inputStyle, width: '100%' }}
          onChange={e => { if (e.target.value) addLink(project.id, 'book', e.target.value) }}>
          <option value="">{options.length ? 'Link a book from your shelf…' : 'No more books on your shelf to link'}</option>
          {options.map(b => <option key={b.id} value={b.id}>{b.title}{b.authors[0] ? ` — ${b.authors[0]}` : ''}</option>)}
        </select>
      </div>

      {mine.length === 0 ? (
        <p data-project-books-empty style={{ margin: '8px 0', textAlign: 'center', fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-3)' }}>
          No books linked yet. Link what you are reading for this project and how far you have got shows here.
        </p>
      ) : (
        <div style={{ ...CARD, overflow: 'hidden' }}>
          <div style={{ ...CAP, padding: '12px 12px 6px' }}>Books · {mine.length}</div>
          {mine.map(l => {
            const b = books.find(x => x.id === l.refId)
            const prog = b ? progressOf(b, sessions.filter(s => s.bookId === b.id)) : null
            return (
              <div key={l.id} data-project-book={l.refId}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderBottom: 'var(--sb-border-width) solid var(--sb-hairline)', flexWrap: 'wrap' }}>
                <span aria-hidden style={{
                  width: 30, height: 44, borderRadius: 4, flexShrink: 0, overflow: 'hidden', background: b?.spineColor ?? 'var(--sb-field)',
                  border: 'var(--sb-border-width) solid var(--sb-border)',
                }}>
                  {b?.coverUrl && <img src={b.coverUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
                </span>
                <span style={{ flex: '1 1 180px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 'var(--sb-t-body)', fontWeight: 600, color: b ? 'var(--sb-ink-1)' : 'var(--sb-ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {b ? b.title : 'This book was removed from your shelf'}
                  </span>
                  {b && <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>{b.authors.join(', ') || 'Unknown author'} · {STATUS[b.status] ?? b.status}</span>}
                </span>
                {b && prog && (
                  <span style={{ flex: '0 1 180px', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 110 }}>
                    <span role="progressbar" aria-label={`${b.title} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={prog.pct ?? 0}
                      style={{ height: 6, borderRadius: 999, background: 'var(--sb-field)', overflow: 'hidden', display: 'block' }}>
                      <span style={{ display: 'block', height: '100%', width: `${prog.pct ?? 0}%`, background: project.color ?? 'var(--sb-ink-3)', borderRadius: 999 }} />
                    </span>
                    <span data-book-progress style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', fontVariantNumeric: 'tabular-nums' }}>
                      {prog.page !== null ? `p. ${prog.page}${b.pages ? ` of ${b.pages}` : ''}${prog.pct !== null ? ` · ${prog.pct}%` : ''}` : b.status === 'finished' ? 'Finished' : 'No pages logged yet'}
                    </span>
                  </span>
                )}
                <button type="button" aria-label={`Unlink ${b?.title ?? 'the book'} from this project`} title="Unlink it — the book stays on your shelf"
                  onClick={() => removeLink(l.id)}
                  style={{ flexShrink: 0, background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: 'var(--sb-ink-4)', display: 'flex' }}>
                  <X size={ICON.sm} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

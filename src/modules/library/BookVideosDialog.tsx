import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, Star, X } from 'lucide-react'
import { Button, Segmented } from '@/components/ui'
import { ICON } from '@/lib/type'
import { findVideos, thumbUrl, watchUrl, youtubeSearchUrl, type VideoResult, type VideoTopic } from './bookVideos'
import { clearMark, loadMarks, saveMark, type MarkKind, type VideoMark } from './videoMarksDb'
import type { Book } from './types'

const TOPICS: { value: VideoTopic; label: string }[] = [
  { value: 'review', label: 'Reviews & summaries' },
  { value: 'author', label: 'The author' },
]

const NOTE = {
  not_configured: 'Video search is not switched on for this app yet.',
  quota: 'Today’s video searches have all been used. They come back tomorrow.',
  unreachable: 'YouTube could not be reached just now.',
  unavailable: 'Video search is not available right now.',
} as const

const STEP = 12

type View = 'all' | 'favourites' | 'hidden'
type Card = { id: string; title: string; channel: string; publishedAt: string; strict?: boolean }

/**
 * Videos about one book, with their thumbnails — and a list the person keeps.
 *
 * **Only videos that name this book are shown.** YouTube returns neighbours (other books
 * by the author, "books like…", trailers); the function marks each one `strict` when its
 * title names this book, the rest wait behind "Show looser matches" and say so on the card.
 * **Favourites and removed videos are per book** and kept on the server, so they survive a
 * new search, a reload and another device. A removed video is not gone — it is under
 * Removed, with a way back. **Show more** reveals what was already fetched (free);
 * **Search for more** asks YouTube for the next page (it spends the shared quota, and says so).
 * When the function cannot answer, the person is told why and still has the plain YouTube link.
 */
export function BookVideosDialog({ book, onClose }: { book: Book; onClose: () => void }) {
  const [topic, setTopic] = useState<VideoTopic>('review')
  const [answer, setAnswer] = useState<{ key: string; result: VideoResult } | null>(null)
  const [again, setAgain] = useState(0)
  const [view, setView] = useState<View>('all')
  const [looser, setLooser] = useState(false)
  const [shown, setShown] = useState(STEP)
  const [searchingMore, setSearchingMore] = useState(false)
  const [marks, setMarks] = useState<VideoMark[]>([])
  const [marksState, setMarksState] = useState<'loading' | 'ok' | 'missing' | 'error'>('loading')
  const [note, setNote] = useState('')

  const authorsKey = book.authors.join('|')
  const key = `${book.id}|${topic}|${again}`
  const result = answer?.key === key ? answer.result : null
  const loading = result === null

  useEffect(() => {
    let live = true
    void findVideos({ id: book.id, title: book.title, authors: authorsKey ? authorsKey.split('|') : [] }, topic)
      .then(r => { if (live) setAnswer({ key, result: r }) })
    return () => { live = false }
  }, [book.id, book.title, authorsKey, topic, key])

  useEffect(() => {
    let live = true
    void loadMarks(book.id).then(r => {
      if (!live) return
      if (r.status === 'ok') { setMarks(r.marks); setMarksState('ok') } else setMarksState(r.status)
    })
    return () => { live = false }
  }, [book.id])

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])

  const byId = useMemo(() => new Map(marks.map(m => [m.videoId, m])), [marks])
  const favourites = useMemo(() => marks.filter(m => m.mark === 'favorite'), [marks])
  const removed = useMemo(() => marks.filter(m => m.mark === 'hidden'), [marks])
  const canMark = marksState === 'ok'

  const items = result?.status === 'ok' ? result.items : []
  const notRemoved = items.filter(v => byId.get(v.id)?.mark !== 'hidden')
  const candidates = notRemoved.filter(v => v.strict || looser)
  const looserCount = notRemoved.filter(v => !v.strict).length
  const visible = candidates.slice(0, shown)

  /** Optimistic: the card moves at once, and comes back with a sentence if the server said no. */
  async function decide(c: Card, mark: MarkKind | null) {
    const before = marks
    const row: VideoMark = { videoId: c.id, mark: mark ?? 'favorite', title: c.title, channel: c.channel, publishedAt: c.publishedAt }
    setNote('')
    setMarks(prev => mark ? [row, ...prev.filter(m => m.videoId !== c.id)] : prev.filter(m => m.videoId !== c.id))
    const saved = mark ? await saveMark(book.id, row).catch(() => 'error' as const) : await clearMark(book.id, c.id).catch(() => 'error' as const)
    if (saved !== 'ok') { setMarks(before); setNote(saved === 'missing' ? 'Favourites need a database update, so that was not kept.' : 'That could not be saved — it has been put back.') }
  }

  async function searchMore() {
    setSearchingMore(true); setNote('')
    const r = await findVideos({ id: book.id, title: book.title, authors: authorsKey ? authorsKey.split('|') : [] }, topic, true)
    setSearchingMore(false)
    if (r.status !== 'ok') { setNote(NOTE[r.status]); return }
    setAnswer({ key, result: r })
    if (r.moreStatus) setNote(r.moreStatus === 'quota' ? NOTE.quota : r.moreStatus === 'not_configured' ? NOTE.not_configured : 'YouTube could not be reached just now, so nothing more was added.')
    else setShown(s => s + STEP)
  }

  const small = { margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', lineHeight: 1.5 } as const
  const grid = { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 } as const

  /** One video: a link to YouTube, with the two things you do to it laid over its picture (never inside the link). */
  const card = (c: Card, kind: 'result' | 'favourite' | 'removed') => {
    const fav = byId.get(c.id)?.mark === 'favorite'
    const overlay = { position: 'absolute', top: 6, width: 32, height: 32, display: 'grid', placeItems: 'center', borderRadius: '50%', cursor: canMark ? 'pointer' : 'default', padding: 0,
      background: 'color-mix(in srgb, var(--sb-overlay) 90%, transparent)', color: 'var(--sb-ink-1)', border: 'var(--sb-border-width) solid var(--sb-border)' } as const
    return (
      <li key={c.id} style={{ position: 'relative' }} data-video={c.id}>
        <a href={watchUrl(c.id)} target="_blank" rel="noopener noreferrer" title={`${c.title} — opens on YouTube`}
          style={{ display: 'flex', flexDirection: 'column', gap: 6, textDecoration: 'none', color: 'inherit' }}>
          <span style={{ display: 'block', aspectRatio: '16 / 9', background: 'var(--sb-field)', borderRadius: 'var(--sb-r-nav)', overflow: 'hidden', border: 'var(--sb-border-width) solid var(--sb-border)' }}>
            <img src={thumbUrl(c.id)} alt="" loading="lazy" referrerPolicy="no-referrer"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              onError={e => { e.currentTarget.style.visibility = 'hidden' }} />
          </span>
          <span style={{ fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-1)', lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{c.title}</span>
          {c.channel && <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>{c.channel}</span>}
        </a>
        {kind === 'result' && c.strict === false && (
          <span style={{ alignSelf: 'flex-start', fontSize: 'var(--sb-t-meta)', color: 'var(--sb-accent-deep)' }}>Looser match — may be about another book</span>
        )}
        {kind !== 'removed' && (
          <button type="button" aria-pressed={fav} disabled={!canMark} data-act="favourite"
            title={fav ? 'Remove from favourites' : 'Add to favourites'} aria-label={`${fav ? 'Remove from favourites' : 'Add to favourites'}: ${c.title}`}
            onClick={() => void decide(c, fav ? null : 'favorite')} style={{ ...overlay, left: 6 }}>
            <Star size={ICON.sm} fill={fav ? 'var(--sb-accent)' : 'none'} color={fav ? 'var(--sb-accent-deep)' : 'currentColor'} />
          </button>
        )}
        {kind === 'result' && (
          <button type="button" disabled={!canMark} data-act="remove"
            title="Remove from this list — you can bring it back under Removed" aria-label={`Remove from this list: ${c.title}`}
            onClick={() => void decide(c, 'hidden')} style={{ ...overlay, right: 6 }}>
            <X size={ICON.sm} />
          </button>
        )}
        {kind === 'removed' && (
          <Button size="sm" variant="secondary" data-act="restore" aria-label={`Bring back: ${c.title}`} onClick={() => void decide(c, null)} style={{ marginTop: 6 }}>Bring back</Button>
        )}
      </li>
    )
  }

  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget) onClose() }} className="sb-above-modal"
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--sb-scrim)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label={`Videos about ${book.title}`} style={{
        width: 'min(880px, 100%)', maxHeight: '94vh', display: 'flex', flexDirection: 'column',
        background: 'var(--sb-overlay)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-frame)', boxShadow: 'var(--sb-shadow-frame)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px 4px' }}>
          <h2 style={{ margin: 0, flex: 1, minWidth: 0, fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h2)', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--sb-ink-1)' }}>Videos</h2>
          <Button variant="ghost" iconOnly title="Close" aria-label="Close" onClick={onClose}><X size={ICON.md} /></Button>
        </div>
        <div style={{ overflowY: 'auto', padding: '8px 20px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={small}>For <strong style={{ color: 'var(--sb-ink-2)' }}>{book.title}</strong>{book.authors[0] ? ` by ${book.authors[0]}` : ''}.</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <Segmented value={topic} onChange={t => { setTopic(t); setShown(STEP); setLooser(false) }} options={TOPICS} aria-label="What to look for" />
            <Segmented value={view} onChange={setView} aria-label="Which videos"
              options={[{ value: 'all', label: 'Results' }, { value: 'favourites', label: `Favourites${favourites.length ? ` (${favourites.length})` : ''}` }, { value: 'hidden', label: `Removed${removed.length ? ` (${removed.length})` : ''}` }]} />
          </div>
          {marksState === 'missing' && <p role="alert" style={{ ...small, color: 'var(--sb-accent-deep)' }}>Favourites and removing need the database update <code>20260047_library_video_marks.sql</code>. Videos still show.</p>}
          {marksState === 'error' && <p role="alert" style={{ ...small, color: 'var(--sb-accent-deep)' }}>Your favourites could not be read just now.</p>}

          <div aria-live="polite" style={{ minHeight: 20 }}>
            {note && <p style={{ ...small, color: 'var(--sb-accent-deep)' }}>{note}</p>}
          </div>

          {view === 'all' && (
            <>
              <div aria-live="polite" style={{ minHeight: 20 }}>
                {loading && <p style={small}>Looking on YouTube…</p>}
                {result && result.status !== 'ok' && <p style={small}>{NOTE[result.status]} You can still search YouTube yourself.</p>}
                {result?.status === 'ok' && result.stale && <p style={small}>Showing an earlier search — YouTube could not be reached just now.</p>}
                {result?.status === 'ok' && items.length === 0 && <p style={small}>No videos found for this book.</p>}
                {result?.status === 'ok' && items.length > 0 && candidates.length === 0 && <p style={small}>None of the results names this book{looserCount ? ` — ${looserCount} looser match${looserCount === 1 ? '' : 'es'} ${looserCount === 1 ? 'is' : 'are'} hidden` : ''}.</p>}
              </div>
              {visible.length > 0 && <ul style={grid} aria-label="Videos">{visible.map(v => card(v, 'result'))}</ul>}
              {result?.status === 'ok' && items.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
                  <p style={small} data-count>Showing {visible.length} of {candidates.length} that name this book{canMark && removed.length ? ` · ${removed.length} removed` : ''}.</p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {candidates.length > shown && <Button size="sm" variant="secondary" onClick={() => setShown(s => s + STEP)}>Show more ({candidates.length - shown} left)</Button>}
                    {result.canMore && <Button size="sm" variant="secondary" disabled={searchingMore} onClick={() => void searchMore()} title="Asks YouTube for the next page — this uses part of the app’s daily video searches">{searchingMore ? 'Searching…' : 'Search for more'}</Button>}
                    {looserCount > 0 && <Button size="sm" variant="ghost" aria-pressed={looser} onClick={() => { const on = !looser; setLooser(on); setShown(on ? notRemoved.length : STEP) }}>{looser ? 'Hide looser matches' : `Show looser matches (${looserCount})`}</Button>}
                  </div>
                  {!result.canMore && candidates.length <= shown && <p style={small}>That is everything YouTube returned for this search.</p>}
                </div>
              )}
            </>
          )}

          {view === 'favourites' && (
            favourites.length === 0
              ? <p style={small}>{canMark ? 'No favourites for this book yet. Press the star on a video to keep it here.' : 'Favourites are not available yet.'}</p>
              : <ul style={grid} aria-label="Favourite videos">{favourites.map(m => card({ id: m.videoId, title: m.title || 'Video', channel: m.channel, publishedAt: m.publishedAt }, 'favourite'))}</ul>
          )}

          {view === 'hidden' && (
            removed.length === 0
              ? <p style={small}>Nothing removed. A video you remove from the results waits here, and can be brought back.</p>
              : <ul style={grid} aria-label="Removed videos">{removed.map(m => card({ id: m.videoId, title: m.title || 'Video', channel: m.channel, publishedAt: m.publishedAt }, 'removed'))}</ul>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '8px 20px 16px 20px', paddingRight: 56 }}>
          {result && (result.status === 'unreachable' || result.status === 'unavailable') && (
            <Button variant="secondary" onClick={() => { setAnswer(null); setAgain(n => n + 1) }}>Try again</Button>
          )}
          <a href={youtubeSearchUrl(book, topic)} target="_blank" rel="noopener noreferrer" className="sb-btn" data-variant="accent" style={{ textDecoration: 'none' }}>
            Search on YouTube <ExternalLink size={ICON.sm} aria-hidden />
          </a>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { ExternalLink, X } from 'lucide-react'
import { Button, Segmented } from '@/components/ui'
import { ICON } from '@/lib/type'
import { findVideos, watchUrl, youtubeSearchUrl, type VideoResult, type VideoTopic } from './bookVideos'
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

/**
 * Videos about one book, with their thumbnails. The answer comes from the
 * `library-videos` function (the YouTube key and quota are the project's); when it
 * cannot give one, the person is told why in a sentence and still has the link
 * that searches YouTube for them — an empty dialog is never the outcome.
 */
export function BookVideosDialog({ book, onClose }: { book: Book; onClose: () => void }) {
  const [topic, setTopic] = useState<VideoTopic>('review')
  const [answer, setAnswer] = useState<{ key: string; result: VideoResult } | null>(null)
  const [again, setAgain] = useState(0)

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
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])

  const note = { margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', lineHeight: 1.5 } as const

  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget) onClose() }} className="sb-above-modal"
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--sb-scrim)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label={`Videos about ${book.title}`} style={{
        width: 'min(720px, 100%)', maxHeight: '94vh', display: 'flex', flexDirection: 'column',
        background: 'var(--sb-overlay)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-frame)', boxShadow: 'var(--sb-shadow-frame)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px 4px' }}>
          <h2 style={{ margin: 0, flex: 1, minWidth: 0, fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h2)', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--sb-ink-1)' }}>Videos</h2>
          <Button variant="ghost" iconOnly title="Close" aria-label="Close" onClick={onClose}><X size={ICON.md} /></Button>
        </div>
        <div style={{ overflowY: 'auto', padding: '8px 20px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={note}>For <strong style={{ color: 'var(--sb-ink-2)' }}>{book.title}</strong>{book.authors[0] ? ` by ${book.authors[0]}` : ''}.</p>
          <Segmented value={topic} onChange={setTopic} options={TOPICS} aria-label="What to look for" />

          <div aria-live="polite" style={{ minHeight: 24 }}>
            {loading && <p style={note}>Looking on YouTube…</p>}
            {result && result.status !== 'ok' && (
              <p style={note}>{NOTE[result.status]} You can still search YouTube yourself.</p>
            )}
            {result?.status === 'ok' && result.items.length === 0 && <p style={note}>No videos found for this book.</p>}
            {result?.status === 'ok' && result.stale && <p style={note}>Showing an earlier search — YouTube could not be reached just now.</p>}
          </div>

          {result?.status === 'ok' && result.items.length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }}>
              {result.items.map(v => (
                <li key={v.id}>
                  <a href={watchUrl(v.id)} target="_blank" rel="noopener noreferrer" title={`${v.title} — opens on YouTube`}
                    style={{ display: 'flex', flexDirection: 'column', gap: 6, textDecoration: 'none', color: 'inherit' }}>
                    <span style={{ display: 'block', aspectRatio: '16 / 9', background: 'var(--sb-field)', borderRadius: 'var(--sb-r-nav)', overflow: 'hidden', border: 'var(--sb-border-width) solid var(--sb-border)' }}>
                      <img src={v.thumb} alt="" loading="lazy" referrerPolicy="no-referrer"
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        onError={e => { e.currentTarget.style.visibility = 'hidden' }} />
                    </span>
                    <span style={{ fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-1)', lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{v.title}</span>
                    {v.channel && <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>{v.channel}</span>}
                  </a>
                </li>
              ))}
            </ul>
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

import { useState, type CSSProperties } from 'react'
import { useInkOn } from '@/lib/ink'
import { spineColorOf } from './spine'
import type { Book } from './types'

/**
 * A book's face: its cover where there is one, otherwise a title-page drawn in
 * the book's own spine colour. A cover URL that 404s — Open Library answers a
 * 1×1 gif for a missing one, Google a broken link — falls back the same way
 * rather than leaving a hole.
 */
export function CoverArt({ book, style, rounded = true }: {
  book: Pick<Book, 'id' | 'title' | 'authors' | 'coverUrl' | 'spineColor'>
  style?: CSSProperties
  rounded?: boolean
}) {
  const [broken, setBroken] = useState<string | null>(null)
  const inkOn = useInkOn()
  const bg = spineColorOf(book)
  const ink = inkOn(bg)
  const showImg = book.coverUrl && broken !== book.coverUrl

  return (
    <div style={{
      position: 'relative', aspectRatio: '2 / 3', overflow: 'hidden', containerType: 'inline-size',
      borderRadius: rounded ? 'var(--sb-r-chip)' : 0, background: bg, color: ink,
      boxShadow: 'inset 3px 0 0 rgba(255,255,255,.2), var(--sb-shadow-control)', ...style,
    }}>
      {showImg ? (
        <img src={book.coverUrl} alt="" loading="lazy" draggable={false}
          onError={() => setBroken(book.coverUrl ?? null)}
          onLoad={e => {
            // Open Library's "no cover" placeholder is a tiny image, not an error.
            const im = e.currentTarget
            if (im.naturalWidth <= 2) setBroken(book.coverUrl ?? null)
          }}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : (
        <div style={{ position: 'absolute', inset: 0, padding: '12% 10%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div style={{ fontFamily: 'var(--sb-font-num)', fontWeight: 600, fontSize: 'clamp(11px, 9cqw, 16px)', lineHeight: 1.2, letterSpacing: '-0.01em', overflowWrap: 'anywhere' }}>
            {book.title}
          </div>
          <div style={{ fontSize: 'var(--sb-t-meta)', opacity: 0.9, overflowWrap: 'anywhere' }}>{book.authors.join(', ')}</div>
        </div>
      )}
    </div>
  )
}

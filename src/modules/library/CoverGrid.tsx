import { CoverArt } from './CoverArt'
import { authorLine } from './spine'
import type { Book } from './types'

/** The same books, face out — for when the cover is how you recognise it. */
export function CoverGrid({ books, pickedId, onPick }: {
  books: Book[]
  pickedId: string | null
  onPick: (b: Book, el: HTMLElement) => void
}) {
  return (
    <div role="group" aria-label="Your books" style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(124px, 1fr))', gap: '22px 16px', padding: '16px 4px 28px',
    }}>
      {books.map(b => (
        <button key={b.id} className="lib-cover" data-picked={pickedId === b.id ? '' : undefined}
          aria-label={`${b.title}${b.authors.length ? ` by ${authorLine(b)}` : ''}`}
          onClick={e => onPick(b, e.currentTarget.querySelector<HTMLElement>('[data-cover-face]') ?? e.currentTarget)}>
          <div data-cover-face><CoverArt book={b} /></div>
          <span style={{ marginTop: 8, fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-1)', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{b.title}</span>
          {b.authors.length > 0 && (
            <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{authorLine(b)}</span>
          )}
        </button>
      ))}
    </div>
  )
}

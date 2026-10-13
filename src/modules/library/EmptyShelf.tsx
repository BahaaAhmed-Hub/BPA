import { Plus } from 'lucide-react'
import { Button } from '@/components/ui'
import { Bay, Bookcase } from './Bookcase'

// Heights of the outlines on the bottom shelf — uneven on purpose, a row of equal
// slots reads as a table rather than as room waiting for books.
const GHOSTS = [150, 172, 158, 180, 146, 166]

/**
 * An empty case, drawn as one: bare boards, a pair of bookends holding nothing
 * up, faint outlines where books will stand, and the way to start on a card set
 * on the middle shelf. The words are on the card's own ground (`--sb-overlay`),
 * never on the wood.
 */
export function EmptyShelf({ onAdd }: { onAdd: () => void }) {
  return (
    <Bookcase label="Your shelf, with no books on it yet">
      <Bay minHeight={120}>
        <span className="lib-bookend" aria-hidden />
        <span style={{ flex: 1 }} />
        <span className="lib-bookend" data-right aria-hidden />
      </Bay>
      <Bay minHeight={0}>
        <div className="lib-plaque">
          <div style={{ fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h2)', fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 6, color: 'var(--sb-ink-1)' }}>Your shelf is empty</div>
          <p style={{ margin: '0 0 16px', fontSize: 'var(--sb-t-body)', color: 'var(--sb-ink-3)', lineHeight: 1.5 }}>
            Type a title and its cover and details are found for you. You can shelve it under a category or a list as you add it.
          </p>
          <Button variant="accent" onClick={onAdd}><Plus size={16} /> Add your first book</Button>
        </div>
      </Bay>
      <Bay minHeight={190}>
        {GHOSTS.map((h, i) => <span key={i} className="lib-ghost" aria-hidden style={{ height: h, width: 36 + (i % 3) * 8 }} />)}
      </Bay>
    </Bookcase>
  )
}

import { Check, Plus, ShoppingCart } from 'lucide-react'
import { Button, Card } from '@/components/ui'
import { ICON } from '@/lib/type'
import type { BookCandidate } from './bookLookup'
import { CoverArt } from './CoverArt'

const SOURCE_NAME = { openlibrary: 'Open Library', google: 'Google Books', manual: '' } as const

/** A search result drawn as a book would be, so the cover is the same object. */
export function ResultCard({ c, onShelfId, onAdd, onBuy, onOpen }: { c: BookCandidate; onShelfId?: string; onAdd: () => void; onBuy: () => void; onOpen: (id: string) => void }) {
  return (
    <Card style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <CoverArt book={{ id: c.sourceKey ?? c.title, title: c.title, authors: c.authors, coverUrl: c.coverUrl }} />
      <div style={{ minWidth: 0 }}>
        <div title={c.title} style={{ fontSize: 'var(--sb-t-body-s)', fontWeight: 600, color: 'var(--sb-ink-1)', lineHeight: 1.3,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{c.title}</div>
        <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {[c.authors[0], c.publishedYear].filter(Boolean).join(' · ') || SOURCE_NAME[c.source]}
        </div>
      </div>
      {onShelfId ? (
        <Button size="sm" variant="secondary" onClick={() => onOpen(onShelfId)} aria-label={`On your shelf: ${c.title}`} title="Open it on your shelf">
          <Check size={ICON.sm} color="var(--sb-positive)" /> On your shelf
        </Button>
      ) : (
        <div style={{ display: 'flex', gap: 6 }}>
          <Button size="sm" variant="accent" onClick={onAdd} aria-label={`Want to read: ${c.title}`} style={{ flex: 1, minWidth: 0 }}>
            <Plus size={ICON.sm} /> Want to read
          </Button>
          <Button size="sm" variant="secondary" iconOnly onClick={onBuy} aria-label={`Buy later: ${c.title}`} title="Put it on your buy-later list">
            <ShoppingCart size={ICON.sm} />
          </Button>
        </div>
      )}
    </Card>
  )
}


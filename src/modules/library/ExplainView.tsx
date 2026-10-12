import { useState } from 'react'
import { Sparkles, Trash2 } from 'lucide-react'
import { Button, Card } from '@/components/ui'
import { ICON } from '@/lib/type'
import { Eyebrow } from './fields'
import { explainQuote, readExplanation, serializeExplanation } from './explainQuote'
import { AiFailure } from './aiFailure'
import { useLibraryStore } from './libraryStore'
import { SPINE_COLORS } from './spine'
import { placeOf } from './types'
import type { BoardItem } from './quoteBoardData'

function ExplainRow({ item, onOpenBook }: { item: BoardItem; onOpenBook: (id: string) => void }) {
  const { quote, book } = item
  const update = useLibraryStore(s => s.updateQuote)
  const notes = useLibraryStore(s => s.notes)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ex = readExplanation(quote.explanation)

  async function run() {
    setBusy(true); setError(null)
    try {
      const mine = notes.filter(n => n.quoteId === quote.id).map(n => n.body)
      const out = await explainQuote({ text: quote.body ?? '', title: book.title, authors: book.authors, notes: mine })
      update(quote.id, { explanation: serializeExplanation(out) })
    } catch (e) {
      setError(e instanceof AiFailure ? e.message : 'The explanation could not be made just now.')
    } finally { setBusy(false) }
  }

  return (
    <Card style={{ padding: '16px 18px', display: 'flex', gap: 12 }}>
      <span aria-hidden style={{ width: 4, flexShrink: 0, borderRadius: 'var(--sb-r-pill)', background: quote.color ?? SPINE_COLORS[0] }} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p style={{ margin: 0, fontStyle: 'italic', lineHeight: 1.55, color: 'var(--sb-ink-1)', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>“{quote.body}”</p>
        <div style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
          <button type="button" onClick={() => onOpenBook(book.id)} style={{ all: 'unset', cursor: 'pointer', fontWeight: 600, textDecoration: 'underline' }}>{book.title}</button>
          {placeOf(quote) && ` · ${placeOf(quote)}`}
        </div>

        {ex ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 10, borderTop: 'var(--sb-border-width) solid var(--sb-hairline)' }}>
            <div>
              <Eyebrow>What it says</Eyebrow>
              <p style={{ margin: 0, lineHeight: 1.55, color: 'var(--sb-ink-2)', fontSize: 'var(--sb-t-body)' }}>{ex.meaning}</p>
            </div>
            {ex.apply.length > 0 && (
              <div>
                <Eyebrow>Try this</Eyebrow>
                <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4, color: 'var(--sb-ink-2)', fontSize: 'var(--sb-t-body)', lineHeight: 1.5 }}>
                  {ex.apply.map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)', marginRight: 'auto' }}>An AI explanation of the words alone — it has not read the book.</span>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run()}><Sparkles size={ICON.sm} /> {busy ? 'Working…' : 'Explain again'}</Button>
              <Button size="sm" variant="ghost" iconOnly disabled={busy} title="Remove the explanation" aria-label="Remove the explanation" onClick={() => update(quote.id, { explanation: null })}><Trash2 size={ICON.sm} /></Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run()} style={{ alignSelf: 'flex-start' }}>
            <Sparkles size={ICON.sm} /> {busy ? 'Reading it…' : 'Explain this'}
          </Button>
        )}
        {error && <div role="alert" style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-negative)' }}>{error}</div>}
      </div>
    </Card>
  )
}

/** Quotes with their explanations. Asking is one quote at a time and never
 *  automatic: each answer is a model call, and a board that spent them on every
 *  open would be a bill nobody chose. */
export function ExplainView({ items, onOpenBook }: { items: BoardItem[]; onOpenBook: (id: string) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 760 }}>
      {items.map(i => <ExplainRow key={i.quote.id} item={i} onOpenBook={onOpenBook} />)}
    </div>
  )
}

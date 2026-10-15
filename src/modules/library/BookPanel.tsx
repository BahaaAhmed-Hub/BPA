import { useState } from 'react'
import { Bookmark, Trash2, X, Search } from 'lucide-react'
import { Button, Card, Pill, Segmented } from '@/components/ui'
import { CAPS, ICON } from '@/lib/type'
import { CoverArt } from './CoverArt'
import { BookLookup } from './BookLookup'
import { AreaField, DateField, Eyebrow, NumField, Row, Stars, TextField } from './fields'
import { applyCandidate } from './applyCandidate'
import { BookFileCard } from './BookFileCard'
import { BookLinksCard } from './BookLinksCard'
import { PurchaseCard } from './PurchaseCard'
import { SizeCard } from './SizeCard'
import { CoverCard } from './CoverCard'
import { WatchCard } from './WatchCard'
import { ReadingLogCard } from './ReadingLogCard'
import { PlanCard } from './PlanCard'
import { BookNotesCard } from './Notes'
import { QuotesCard } from './QuotesCard'
import { useLibraryStore } from './libraryStore'
import { FORMAT_LABEL, STATUS_LABEL, type Book, type BookFormat, type BookStatus } from './types'

const STATUSES: BookStatus[] = ['want', 'reading', 'finished', 'paused', 'abandoned']
const FORMATS = (Object.keys(FORMAT_LABEL) as BookFormat[]).map(v => ({ value: v, label: FORMAT_LABEL[v] }))

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * One book, docked beside the shelf the way the task panel sits beside its
 * board. A shell in the page's own cream holding white cards — the separation
 * between sections is that ground, not a rule.
 *
 * **Every control writes straight through.** A pill or a tick is a decision and
 * goes the moment it is made; words are held 700ms so a keystroke is not a
 * request. There is no Save button because there is nothing to save.
 */
export function BookPanel({ book, flying, narrow, onClose, onManageLists, onOpenReader }: {
  book: Book
  /** A phone: the panel takes the whole column instead of docking beside the shelf. */
  narrow?: boolean
  /** The cover is in the air; keep the real one hidden until it lands. */
  flying: boolean
  onClose: () => void
  onManageLists: () => void
  onOpenReader: () => void
}) {
  const update = useLibraryStore(s => s.updateBook)
  const del = useLibraryStore(s => s.deleteBook)
  const lists = useLibraryStore(s => s.lists)
  const links = useLibraryStore(s => s.links)
  const setBookLists = useLibraryStore(s => s.setBookLists)
  const [finding, setFinding] = useState(false)
  const extrasMissing = useLibraryStore(s => s.extrasMissing)
  const sessionsMissing = useLibraryStore(s => s.sessionsMissing)
  const plansMissing = useLibraryStore(s => s.plansMissing)
  const marked = useLibraryStore(s => s.bookmarks.some(m => m.kind === 'book' && m.bookId === book.id))
  const toggleMark = useLibraryStore(s => s.toggleBookmark)

  const mine = links.filter(l => l.bookId === book.id).map(l => l.listId)
  const patch = (p: Partial<Book>) => update(book.id, p)

  function setStatus(status: BookStatus) {
    const p: Partial<Book> = { status }
    // Starting and finishing are dated by the act, unless you already said.
    if (status === 'reading' && !book.startedOn) p.startedOn = today()
    if (status === 'finished') { p.finishedOn = book.finishedOn ?? today(); p.startedOn = book.startedOn ?? p.finishedOn }
    // Coming off finished clears the date, or history shows one for a book that is back on the list.
    if (status !== 'finished' && book.status === 'finished') p.finishedOn = undefined
    patch(p)
  }

  const toggleList = (id: string) =>
    setBookLists(book.id, mine.includes(id) ? mine.filter(x => x !== id) : [...mine, id])

  const shelving = [...lists.filter(l => l.kind === 'category'), ...lists.filter(l => l.kind === 'list')]

  return (
    <aside aria-label={`${book.title} — details`} style={{
      width: narrow ? '100%' : 'clamp(300px, 32vw, 420px)', flexShrink: 0, boxSizing: 'border-box', maxHeight: '100%', overflowY: 'auto',
      display: 'flex', flexDirection: 'column', gap: 12, padding: 14, paddingBottom: 56,
      background: 'var(--sb-page)', border: 'var(--sb-border-width) solid var(--sb-border)',
      borderRadius: 'var(--sb-r-card)', boxShadow: 'var(--sb-shadow-panel)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ ...CAPS, color: 'var(--sb-ink-3)', flex: 1 }}>Book</span>
        {/* What you do *to* the book, then the way out — a different glyph from
            Close and no stronger than it. Deleting is one ⌘Z away. */}
        <Button variant="ghost" iconOnly title={marked ? 'Remove from favourites' : 'Add to favourites'} aria-label={marked ? 'Remove from favourites' : 'Add to favourites'}
          aria-pressed={marked} disabled={extrasMissing} onClick={() => toggleMark({ kind: 'book', bookId: book.id })}>
          <Bookmark size={ICON.md} fill={marked ? 'var(--sb-accent)' : 'none'} color={marked ? 'var(--sb-accent-deep)' : 'currentColor'} />
        </Button>
        <Button variant="ghost" iconOnly title="Delete this book" aria-label="Delete this book"
          onClick={() => { del(book.id); onClose() }}><Trash2 size={ICON.md} /></Button>
        <Button variant="ghost" iconOnly title="Close" aria-label="Close" onClick={onClose}><X size={ICON.md} /></Button>
      </div>

      <Card style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <div data-book-cover-target style={{ width: 118, flexShrink: 0, visibility: flying ? 'hidden' : 'visible' }}>
            <CoverArt book={book} />
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <TextField label="Title" value={book.title} onPush={v => v.trim() && patch({ title: v.trim() })} />
            <TextField label="Author" value={book.authors.join(', ')} placeholder="One or more, separated by commas"
              onPush={v => patch({ authors: v.split(',').map(a => a.trim()).filter(Boolean) })} />
          </div>
        </div>
        <TextField label="Subtitle" value={book.subtitle ?? ''} onPush={v => patch({ subtitle: v.trim() || undefined })} />
        <Stars value={book.rating} onChange={rating => patch({ rating })} />
        <Button size="sm" variant="secondary" onClick={() => setFinding(f => !f)} aria-expanded={finding}>
          <Search size={ICON.sm} /> Find cover &amp; details
        </Button>
        {finding && (
          <BookLookup initialQuery={`${book.title} ${book.authors[0] ?? ''}`.trim()} autoFocus
            onPick={c => { patch(applyCandidate(book, c)); setFinding(false) }} />
        )}
      </Card>

      <CoverCard book={book} />

      <Card style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Eyebrow>Reading</Eyebrow>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {STATUSES.map(s => (
            <Pill key={s} on={book.status === s} onClick={() => setStatus(s)}>{STATUS_LABEL[s]}</Pill>
          ))}
        </div>
        <Segmented value={book.format} onChange={format => patch({ format })} options={FORMATS} />
        <Row>
          <DateField label="Started" value={book.startedOn} onPush={startedOn => patch({ startedOn })} />
          <DateField label="Finished" value={book.finishedOn} onPush={finishedOn => patch({ finishedOn })} />
        </Row>
      </Card>

      <ReadingLogCard book={book} disabled={sessionsMissing} />

      <PlanCard book={book} disabled={plansMissing} />

      <Card style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Eyebrow>Details</Eyebrow>
        <Row>
          <NumField label="Pages" value={book.pages} onPush={pages => patch({ pages })} />
          <NumField label="Year" value={book.publishedYear} onPush={publishedYear => patch({ publishedYear })} />
        </Row>
        <Row>
          <TextField label="ISBN" value={book.isbn ?? ''} onPush={v => patch({ isbn: v.replace(/[^0-9Xx]/g, '') || undefined })} />
          <TextField label="Language" value={book.language ?? ''} onPush={v => patch({ language: v.trim() || undefined })} />
        </Row>
        <TextField label="Publisher" value={book.publisher ?? ''} onPush={v => patch({ publisher: v.trim() || undefined })} />
        <TextField label="Cover image address" value={book.coverUrl ?? ''} placeholder="https://…"
          onPush={v => patch({ coverUrl: v.trim() || undefined })} />
        <AreaField label="About" value={book.description ?? ''} rows={5} onPush={v => patch({ description: v.trim() || undefined })} />
      </Card>

      <Card style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Eyebrow>Shelved under</Eyebrow>
        {shelving.length === 0 ? (
          <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>
            No lists or categories yet.
          </p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {shelving.map(l => (
              <Pill key={l.id} on={mine.includes(l.id)} onClick={() => toggleList(l.id)}
                title={l.kind === 'category' ? 'Category' : 'List'}>{l.name}</Pill>
            ))}
          </div>
        )}
        <Button size="sm" variant="ghost" onClick={onManageLists} style={{ alignSelf: 'flex-start' }}>Manage lists &amp; categories</Button>
      </Card>

      <BookLinksCard book={book} />

      <SizeCard book={book} />

      <PurchaseCard book={book} />

      {book.status !== 'finished' && <WatchCard book={book} />}

      <BookFileCard book={book} onOpen={onOpenReader} />

      <QuotesCard bookId={book.id} disabled={extrasMissing} />
      <BookNotesCard bookId={book.id} disabled={extrasMissing} />

      <Card style={{ padding: '16px 18px' }}>
        <AreaField label="Your review" value={book.review ?? ''} rows={4} placeholder="What stayed with you?"
          onPush={v => patch({ review: v.trim() || undefined })} />
      </Card>
    </aside>
  )
}

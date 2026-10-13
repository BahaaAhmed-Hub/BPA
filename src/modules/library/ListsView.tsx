import { useState } from 'react'
import { BookOpen, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button, Card, Segmented } from '@/components/ui'
import { CAPS, ICON } from '@/lib/type'
import { useInkOn } from '@/lib/ink'
import { CoverArt } from './CoverArt'
import { Eyebrow, Field } from './fields'
import { inputStyle } from './fieldStyle'
import { SidePanel } from './SidePanel'
import { SPINE_COLORS } from './spine'
import { useLibraryStore } from './libraryStore'
import type { Book, LibList, ListKind } from './types'

/** A list's face: the picture you gave it, else its first three covers fanned
 *  out, else a wash of its own colour. Always something — an empty grey square
 *  says "unfinished" about a thing that is merely new. */
function Thumb({ list, books }: { list: LibList; books: Book[] }) {
  const inkOn = useInkOn()
  const tint = list.color ?? 'var(--sb-field)'
  const base: React.CSSProperties = { height: 124, borderRadius: 'var(--sb-r-nav)', overflow: 'hidden', position: 'relative', background: `color-mix(in srgb, ${tint} 22%, var(--sb-overlay))` }
  if (list.thumbUrl) {
    return <div style={base}><img src={list.thumbUrl} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></div>
  }
  const some = books.slice(0, 3)
  return (
    <div style={{ ...base, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {some.length === 0
        ? <BookOpen size={26} color={inkOn(`color-mix(in srgb, ${tint} 22%, var(--sb-overlay))`)} style={{ opacity: .55 }} aria-hidden />
        : some.map((b, i) => (
          <div key={b.id} style={{ width: 62, marginLeft: i ? -22 : 0, transform: `rotate(${(i - (some.length - 1) / 2) * 7}deg)`, zIndex: 3 - i, boxShadow: 'var(--sb-shadow-hover)', borderRadius: 3 }}>
            <CoverArt book={b} rounded={false} />
          </div>
        ))}
    </div>
  )
}

export type ListEditing = { list?: LibList; kind: ListKind }

/** Make or edit a category or list, in the panel beside the shelf. */
export function ListPanel({ initial, kind, narrow, onClose, onSaved }: {
  initial?: LibList; kind: ListKind; narrow?: boolean; onClose: () => void; onSaved?: (l: LibList) => void
}) {
  const addList = useLibraryStore(s => s.addList)
  const updateList = useLibraryStore(s => s.updateList)
  const deleteList = useLibraryStore(s => s.deleteList)
  const [name, setName] = useState(initial?.name ?? '')
  const [k, setK] = useState<ListKind>(initial?.kind ?? kind)
  const [description, setDescription] = useState(initial?.description ?? '')
  const [thumbUrl, setThumbUrl] = useState(initial?.thumbUrl ?? '')
  const [color, setColor] = useState(initial?.color ?? SPINE_COLORS[0])

  function save() {
    const extra = { description: description.trim() || undefined, thumbUrl: thumbUrl.trim() || undefined, color }
    if (initial) { updateList(initial.id, { name: name.trim(), kind: k, ...extra }); onClose() }
    else onSaved?.(addList(name, k, extra))
  }

  return (
    <SidePanel label={initial ? `Edit ${k}` : `New ${k}`} eyebrow={initial ? `Edit ${k}` : `New ${k}`} narrow={narrow} onClose={onClose}
      actions={initial && (
        <Button variant="ghost" iconOnly title="Delete — the books stay" aria-label="Delete"
          onClick={() => { deleteList(initial.id); onClose() }}><Trash2 size={ICON.md} /></Button>
      )}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="accent" disabled={!name.trim()} onClick={save}>{initial ? 'Save' : 'Create'}</Button>
      </>}>
      <Card style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Segmented value={k} onChange={setK} options={[
          { value: 'category', label: 'Category', title: 'What a book is — Fiction, Business' },
          { value: 'list', label: 'List', title: 'What you are doing with it — Summer reading' },
        ]} />
        <Field label="Name"><input autoFocus value={name} onChange={e => setName(e.target.value)} style={inputStyle}
          onKeyDown={e => { if (e.key === 'Enter' && name.trim()) save() }} /></Field>
        <Field label="About"><textarea value={description} rows={2} onChange={e => setDescription(e.target.value)} style={{ ...inputStyle, resize: 'vertical' }} /></Field>
        <Field label="Picture address"><input value={thumbUrl} placeholder="https://… — or leave empty to use its covers" onChange={e => setThumbUrl(e.target.value)} style={inputStyle} /></Field>
        <div>
          <div style={{ ...CAPS, color: 'var(--sb-ink-4)', marginBottom: 6 }}>Colour</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {SPINE_COLORS.map(c => (
              <button key={c} type="button" aria-label={`Colour ${SPINE_COLORS.indexOf(c) + 1}`} aria-pressed={color === c} onClick={() => setColor(c)}
                style={{ width: 32, height: 32, borderRadius: 'var(--sb-r-pill)', background: c, cursor: 'pointer', border: 'none',
                  outline: color === c ? '2px solid var(--sb-ink-1)' : 'none', outlineOffset: 2 }} />
            ))}
          </div>
        </div>
      </Card>
    </SidePanel>
  )
}

export function ListsView({ onOpen, onEdit }: { onOpen: (listId: string) => void; onEdit: (e: ListEditing) => void }) {
  const lists = useLibraryStore(s => s.lists)
  const books = useLibraryStore(s => s.books)
  const links = useLibraryStore(s => s.links)

  const booksOf = (id: string) => {
    const ids = new Set(links.filter(l => l.listId === id).map(l => l.bookId))
    return books.filter(b => ids.has(b.id))
  }

  const section = (kind: ListKind, title: string, blurb: string) => {
    const mine = lists.filter(l => l.kind === kind)
    return (
      <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <Eyebrow>{title}</Eyebrow>
            <div style={{ marginTop: -4, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>{blurb}</div>
          </div>
          <Button size="sm" variant="secondary" onClick={() => onEdit({ kind })}><Plus size={ICON.sm} /> New {kind}</Button>
        </div>
        {mine.length === 0 ? (
          <Card style={{ padding: '18px 20px', color: 'var(--sb-ink-3)', fontSize: 'var(--sb-t-body-s)' }}>None yet.</Card>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 14 }}>
            {mine.map(l => {
              const inside = booksOf(l.id)
              return (
                <Card key={l.id} variant="interactive" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, position: 'relative' }}>
                  <button type="button" onClick={() => onOpen(l.id)} aria-label={`Open ${l.name}`}
                    style={{ all: 'unset', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <Thumb list={l} books={inside} />
                    <span style={{ fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h3)', fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--sb-ink-1)' }}>{l.name}</span>
                    <span style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>{inside.length} book{inside.length === 1 ? '' : 's'}</span>
                    {l.description && <span style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{l.description}</span>}
                  </button>
                  <Button variant="ghost" iconOnly size="sm" title="Edit" aria-label={`Edit ${l.name}`}
                    onClick={() => onEdit({ list: l, kind: l.kind })}
                    style={{ position: 'absolute', top: 16, right: 16, background: 'var(--sb-overlay)' }}><Pencil size={ICON.sm} /></Button>
                </Card>
              )
            })}
          </div>
        )}
      </section>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 26, padding: '16px 4px 40px' }}>
      {section('category', 'Categories', 'What a book is — Fiction, Business, Philosophy.')}
      {section('list', 'Lists', 'What you are doing with it — Summer reading, Lend out, Buy next.')}
    </div>
  )
}

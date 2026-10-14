import { useState } from 'react'
import { Card, Button } from '@/components/ui'
import { checkDims } from './bookDimensions'
import { findDimensions } from './findDimensions'
import { Eyebrow, NumField, Row } from './fields'
import { dimsKnown } from './libraryDb'
import { useLibraryStore } from './libraryStore'
import { boxOf } from './spine'
import type { Book } from './types'

const SOURCE: Record<NonNullable<Book['dimsSource']> | 'none', string> = {
  measured: 'Found online and checked', cover: 'Shape from the cover, size from the page count',
  estimate: 'Worked out from the page count', manual: 'Typed by you', none: 'Not looked up yet',
}

/** The size the shelf stands this book at, where it came from, and a way to correct it. A typed size is
 *  kept for good: a later lookup never replaces it. */
export function SizeCard({ book }: { book: Book }) {
  const patch = useLibraryStore(s => s.updateBook)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const box = boxOf(book)
  const known = dimsKnown()
  const h = book.heightMm, w = book.widthMm, t = book.thicknessMm

  // Each box writes the whole triple as a typed size, but only when it is a believable book.
  const set = (k: 'heightMm' | 'widthMm' | 'thicknessMm') => (v: number | undefined) => {
    const next = { heightMm: h, widthMm: w, thicknessMm: t, [k]: v }
    if (next.heightMm && next.widthMm && next.thicknessMm) {
      const verdict = checkDims(next, { pages: book.pages })
      if (!verdict.ok) { setMsg(`Not saved — ${verdict.problems[0]}.`); return }
    }
    setMsg('')
    patch(book.id, { ...next, dimsSource: next.heightMm && next.widthMm && next.thicknessMm ? 'manual' : book.dimsSource })
  }

  const again = async () => {
    setBusy(true); setMsg('')
    try {
      const r = await findDimensions(book)
      const d = r.settled.dims
      patch(book.id, { heightMm: d.heightMm, widthMm: d.widthMm, thicknessMm: d.thicknessMm, dimsSource: r.settled.source })
      setMsg(r.failed.length ? `${r.failed.join(' and ')} could not be reached. ${r.settled.notes.at(-1) ?? ''}` : r.settled.notes.at(-1) ?? '')
    } catch { setMsg('Could not look it up just now.') }
    setBusy(false)
  }

  return (
    <Card style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Eyebrow>Size on the shelf</Eyebrow>
      <div style={{ fontSize: 'var(--sb-t-body)' }}>
        {Math.round(box.h / 1.1)} × {Math.round(box.d / 1.1)} × {Math.round(box.w / 1.1)} mm
        <span style={{ color: 'var(--sb-ink-3)' }}> · {SOURCE[book.dimsSource ?? 'none']}</span>
      </div>
      <Row>
        <NumField label="Height (mm)" value={h} onPush={set('heightMm')} />
        <NumField label="Width (mm)" value={w} onPush={set('widthMm')} />
        <NumField label="Thickness (mm)" value={t} onPush={set('thicknessMm')} />
      </Row>
      <div style={{ minHeight: 18, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>
        {known ? msg : 'Sizes are not saved yet on this project (migration 20260041 has not run).'}
      </div>
      <Button size="sm" variant="ghost" onClick={again} disabled={busy || !known} style={{ alignSelf: 'flex-start' }}>
        {busy ? 'Looking…' : 'Measure again online'}
      </Button>
    </Card>
  )
}

import { useRef, useState } from 'react'
import { BookOpen, FileUp, Trash2 } from 'lucide-react'
import { Button, Card } from '@/components/ui'
import { ICON } from '@/lib/type'
import { Eyebrow } from './fields'
import { MAX_PDF_BYTES, removeBookFile, uploadBookPdf } from './libraryFiles'
import { useLibraryStore } from './libraryStore'
import type { Book } from './types'

/**
 * The book's own file. One PDF per book: Upload becomes Replace once there is
 * one, and Open is the reader. Removing the file is the one thing here that
 * cannot be undone — the bytes are deleted — so it asks twice, inline, rather
 * than being a trash glyph one slip from gone.
 */
export function BookFileCard({ book, disabled, onOpen }: { book: Book; disabled?: boolean; onOpen: () => void }) {
  const updateBook = useLibraryStore(s => s.updateBook)
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sure, setSure] = useState(false)

  async function pick(file: File | undefined) {
    if (!file) return
    setBusy(true); setError(null)
    try {
      const path = await uploadBookPdf(book.id, file)
      updateBook(book.id, { filePath: path })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The upload failed.')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''   // so choosing the same file again still fires
    }
  }

  async function remove() {
    setBusy(true); setError(null)
    try {
      if (book.filePath) await removeBookFile(book.filePath)
      updateBook(book.id, { filePath: undefined })
      setSure(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The file could not be removed.')
    } finally { setBusy(false) }
  }

  return (
    <Card style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Eyebrow>Your copy</Eyebrow>
      <input ref={input} type="file" accept="application/pdf,.pdf" hidden aria-label="Choose a PDF" onChange={e => void pick(e.target.files?.[0])} />
      {book.filePath ? (
        <>
          <Button variant="primary" onClick={onOpen} disabled={busy}><BookOpen size={ICON.md} /> Open and read</Button>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button size="sm" variant="secondary" disabled={busy || disabled} onClick={() => input.current?.click()}>
              <FileUp size={ICON.sm} /> {busy ? 'Working…' : 'Replace PDF'}
            </Button>
            {sure ? (
              <>
                <Button size="sm" variant="danger" disabled={busy} onClick={() => void remove()}>Yes, delete the file</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setSure(false)}>Keep it</Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setSure(true)}><Trash2 size={ICON.sm} /> Remove file</Button>
            )}
          </div>
        </>
      ) : (
        <>
          <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', lineHeight: 1.5 }}>
            Add a PDF of this book to read it here, select passages as quotes and bookmark pages. Up to {MAX_PDF_BYTES / 1048576} MB; kept private to you.
          </p>
          <Button variant="secondary" disabled={busy || disabled} onClick={() => input.current?.click()}>
            <FileUp size={ICON.md} /> {busy ? 'Uploading…' : 'Upload a PDF'}
          </Button>
        </>
      )}
      {error && <div role="alert" style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-negative)' }}>{error}</div>}
    </Card>
  )
}

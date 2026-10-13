import { useEffect, useMemo, useState } from 'react'
import { Copy, Download, X } from 'lucide-react'
import { Button, Segmented } from '@/components/ui'
import { notify } from '@/lib/undo'
import { ICON } from '@/lib/type'
import { Eyebrow } from './fields'
import { buildExport, type ExportFormat, type ExportOptions } from './exportQuotes'
import { useLibraryStore } from './libraryStore'
import { makeZip } from './zip'
import type { Quote } from './types'

const HINT: Record<ExportFormat, string> = {
  markdown: 'One Markdown file with every book as a heading.',
  obsidian: 'One note per book, with its author, status and rating as properties, and a block id on each quote so another note can embed it. Several books come as a zip to unzip into your vault.',
  notion: 'Markdown that Notion reads. Copy it and paste into a page, or download it and use Import → Text & Markdown.',
}

function save(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Exports what the board is showing. Nothing is uploaded — the text is built
 *  here and handed to the browser to download or the clipboard to copy. */
export function ExportDialog({ quotes, onClose }: { quotes: Quote[]; onClose: () => void }) {
  const books = useLibraryStore(s => s.books)
  const notes = useLibraryStore(s => s.notes)
  const bookmarks = useLibraryStore(s => s.bookmarks)
  const [format, setFormat] = useState<ExportFormat>('markdown')
  const [opts, setOpts] = useState<ExportOptions>({ notes: true, explanations: false })

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])

  const files = useMemo(() => {
    const marked = new Set(bookmarks.filter(m => m.kind === 'quote' && m.quoteId).map(m => m.quoteId as string))
    return buildExport(format, { books, quotes, notes, marked }, opts)
  }, [format, books, quotes, notes, bookmarks, opts])

  const single = files.length === 1
  const preview = files[0]?.content ?? ''

  function download() {
    if (single) save(files[0].name, files[0].content, 'text/markdown;charset=utf-8')
    else save('Library quotes.zip', makeZip(files.map(f => ({ name: f.name, content: f.content }))), 'application/zip')
  }
  async function copy() {
    try { await navigator.clipboard.writeText(preview); notify('Copied') }
    catch { notify('Could not copy — download it instead') }
  }

  const box = (label: string, key: keyof ExportOptions) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-2)', cursor: 'pointer' }}>
      <input type="checkbox" checked={opts[key]} onChange={e => setOpts(o => ({ ...o, [key]: e.target.checked }))} /> {label}
    </label>
  )

  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget) onClose() }} className="sb-above-modal"
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--sb-scrim)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label="Export quotes" style={{
        width: 'min(620px, 100%)', maxHeight: '94vh', display: 'flex', flexDirection: 'column',
        background: 'var(--sb-overlay)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-frame)', boxShadow: 'var(--sb-shadow-frame)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px 4px' }}>
          <h2 style={{ margin: 0, flex: 1, fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h2)', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--sb-ink-1)' }}>Export quotes</h2>
          <Button variant="ghost" iconOnly title="Close" aria-label="Close" onClick={onClose}><X size={ICON.md} /></Button>
        </div>
        <div style={{ overflowY: 'auto', padding: '8px 20px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Segmented value={format} onChange={setFormat} options={[
            { value: 'markdown', label: 'Markdown' }, { value: 'obsidian', label: 'Obsidian' }, { value: 'notion', label: 'Notion' },
          ]} />
          <p style={{ margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', lineHeight: 1.5 }}>{HINT[format]}</p>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {box('My notes', 'notes')}
            {box('AI explanations', 'explanations')}
          </div>
          <div>
            <Eyebrow>{files.length ? `${quotes.length} quote${quotes.length === 1 ? '' : 's'} · ${files.length} file${files.length === 1 ? '' : 's'}${files.length > 1 ? ' — showing the first' : ''}` : 'Nothing to export'}</Eyebrow>
            <textarea readOnly value={preview} aria-label="Preview" rows={10} style={{
              width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, lineHeight: 1.5,
              background: 'var(--sb-field)', color: 'var(--sb-ink-1)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-nav)', padding: 10,
            }} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '8px 20px 16px 20px', paddingRight: 56 }}>
          <Button variant="secondary" disabled={!single} title={single ? 'Copy to the clipboard' : 'Several files: download the zip'} onClick={() => void copy()}><Copy size={ICON.sm} /> Copy</Button>
          <Button variant="accent" disabled={!files.length} onClick={download}><Download size={ICON.sm} /> {single ? 'Download .md' : 'Download .zip'}</Button>
        </div>
      </div>
    </div>
  )
}

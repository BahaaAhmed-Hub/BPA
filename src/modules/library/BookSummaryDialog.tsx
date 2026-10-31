import { useEffect, useRef, useState } from 'react'
import { Copy, Download, RotateCcw, Square, X } from 'lucide-react'
import { Button, Segmented } from '@/components/ui'
import { notify } from '@/lib/undo'
import { ICON } from '@/lib/type'
import { Eyebrow } from './fields'
import { writeSummary } from './bookSummary'
import { loadSummary, saveSummary, type LoadResult } from './summaryDb'
import {
  LENGTHS, LENGTH_ORDER, docPages, docWords, isComplete, paragraphs, summaryMarkdown,
  type SummaryDoc, type SummaryLength,
} from './summaryPlan'
import type { Book } from './types'

const LENGTH_OPTIONS = LENGTH_ORDER.map(v => ({ value: v, label: `${LENGTHS[v].label} · ~${LENGTHS[v].pages} pages` }))

function save(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** A file name a download keeps whole: no path characters, no em dash (see the quote export). */
const fileName = (title: string) => `${title.replace(/[\\/:*?"<>|#^[\]]/g, '').replace(/\.+$/, '').trim() || 'Book'} - summary.md`

/**
 * A written summary of one book, in a length the person picks.
 *
 * **Said plainly: it is the model's memory of the book, not the book.** The notice
 * sits above every summary and the Markdown export carries it too. **Saved a section
 * at a time**, so closing the dialog, a refused key or a dropped connection keeps what
 * was written and offers to carry on. **Regenerating asks first**: it costs the same
 * again and replaces what is there.
 */
export function BookSummaryDialog({ book, onClose }: { book: Book; onClose: () => void }) {
  const [load, setLoad] = useState<LoadResult | null>(null)
  const [doc, setDoc] = useState<SummaryDoc | null>(null)
  const [length, setLength] = useState<SummaryLength>('standard')
  const [busy, setBusy] = useState<{ index: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [unsaved, setUnsaved] = useState(false)
  const [asking, setAsking] = useState(false)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    let live = true
    void loadSummary(book.id).then(r => {
      if (!live) return
      setLoad(r)
      if (r.status === 'ok' && r.doc) { setDoc(r.doc); setLength(r.doc.length) }
    })
    return () => { live = false }
  }, [book.id])

  // Leaving stops the writing; what was written is already saved.
  useEffect(() => () => abort.current?.abort(), [])
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])

  async function run(len: SummaryLength, resume: SummaryDoc | null) {
    const ac = new AbortController()
    abort.current = ac
    setError(null); setAsking(false); setUnsaved(false)
    setBusy({ index: resume?.sections.length ?? 0, total: resume?.outline.length || LENGTHS[len].sections })
    try {
      await writeSummary({
        book: { id: book.id, title: book.title, authors: book.authors, description: book.description, publishedYear: book.publishedYear },
        length: len, resume, signal: ac.signal,
        onStep: (index, total) => setBusy({ index, total }),
        onUpdate: async d => {
          setDoc(d)
          const saved = await saveSummary(d).catch(() => 'error' as const)
          if (saved !== 'ok') setUnsaved(true)
        },
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The summary did not work just now.')
    } finally {
      setBusy(null); abort.current = null
    }
  }

  const ready = load?.status === 'ok'
  const partial = !!doc && doc.outline.length > 0 && !isComplete(doc)
  const plan = LENGTHS[length]
  const note = { margin: 0, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', lineHeight: 1.5 } as const

  async function copy() {
    if (!doc) return
    try { await navigator.clipboard.writeText(summaryMarkdown(book, doc)); notify('Copied') }
    catch { notify('Could not copy — download it instead') }
  }

  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget) onClose() }} className="sb-above-modal"
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--sb-scrim)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label={`Summary of ${book.title}`} style={{
        width: 'min(760px, 100%)', maxHeight: 'calc(94 * var(--vh))', display: 'flex', flexDirection: 'column',
        background: 'var(--sb-overlay)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-frame)', boxShadow: 'var(--sb-shadow-frame)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px 4px' }}>
          <h2 style={{ margin: 0, flex: 1, minWidth: 0, fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h2)', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--sb-ink-1)' }}>Summary</h2>
          <Button variant="ghost" iconOnly title="Close" aria-label="Close" onClick={onClose}><X size={ICON.md} /></Button>
        </div>

        <div style={{ overflowY: 'auto', padding: '8px 20px 12px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {load === null && <p style={note}>Opening…</p>}
          {load?.status === 'missing' && (
            <p style={{ ...note, color: 'var(--sb-accent-deep)' }} role="alert">
              Summaries need the database update <code>20260046_library_book_media.sql</code>. Nothing was written, so nothing was spent.
            </p>
          )}
          {load?.status === 'error' && <p style={{ ...note, color: 'var(--sb-accent-deep)' }} role="alert">Could not read the saved summary. Close this and open it again.</p>}

          {/* Choosing — only when there is nothing yet, or the person is replacing it. */}
          {ready && !busy && (!doc || asking) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Eyebrow>How long</Eyebrow>
              <Segmented value={length} onChange={setLength} options={LENGTH_OPTIONS} aria-label="Length of the summary" />
              <p style={note}>
                About {plan.pages} pages in {plan.sections} sections, written for <strong style={{ color: 'var(--sb-ink-2)' }}>{book.title}</strong>.
                It takes {plan.sections + 1} requests to the AI service with your Anthropic key, one section at a time, and each is kept as it arrives.
              </p>
              <p style={note}>
                The AI writes from what it knows about the book — it is not given the book itself — and says so when it does not know it.
                {book.description ? ' The About text is passed along to help.' : ' Adding the publisher’s blurb under About gives it more to go on.'}
              </p>
              {asking && <p style={note}>This replaces the summary you have now.</p>}
            </div>
          )}

          {busy && (
            <div role="status" aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-2)' }}>
                {doc && doc.outline[busy.index]
                  ? `Writing section ${busy.index + 1} of ${busy.total}: ${doc.outline[busy.index].title}`
                  : 'Planning the sections…'}
              </div>
              <div aria-hidden style={{ height: 6, borderRadius: 3, background: 'var(--sb-field)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.round(((doc?.sections.length ?? 0) / Math.max(1, busy.total)) * 100)}%`, background: 'var(--sb-accent)', transition: 'width .3s' }} />
              </div>
            </div>
          )}

          {error && <p role="alert" style={{ ...note, color: 'var(--sb-accent-deep)' }}>{error}</p>}
          {unsaved && <p role="alert" style={{ ...note, color: 'var(--sb-accent-deep)' }}>This could not be saved, so it will be gone when you close this. Copy or download it first.</p>}

          {doc && doc.sections.length > 0 && (
            <article dir="auto" aria-label="The summary" style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: '64ch' }}>
              <p style={note}>
                {isComplete(doc) ? `About ${docPages(doc)} pages · ${docWords(doc).toLocaleString()} words · ` : `${doc.sections.length} of ${doc.outline.length} sections · `}
                An AI summary written from the model’s knowledge of the book, not from its text. Check any detail that matters.
              </p>
              <p style={{ margin: 0, padding: '2px 0 2px 12px', borderInlineStart: '3px solid var(--sb-border)', color: 'var(--sb-ink-2)', fontSize: 'var(--sb-t-body)', lineHeight: 1.6, fontStyle: 'italic' }}>{doc.premise}</p>
              {doc.sections.map((s, i) => (
                <section key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <h3 style={{ margin: 0, fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h3, 18px)', fontWeight: 600, color: 'var(--sb-ink-1)' }}>{i + 1}. {s.title}</h3>
                  {paragraphs(s.text).map((p, n) => (
                    <p key={n} style={{ margin: 0, fontSize: 'var(--sb-t-body)', lineHeight: 1.65, color: 'var(--sb-ink-1)' }}>{p}</p>
                  ))}
                </section>
              ))}
            </article>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap', padding: '8px 20px 16px 20px', paddingRight: 56 }}>
          {busy && <Button variant="secondary" onClick={() => abort.current?.abort()}><Square size={ICON.sm} /> Stop</Button>}
          {ready && !busy && !doc && <Button variant="accent" onClick={() => void run(length, null)}>Write the summary</Button>}
          {ready && !busy && asking && (
            <>
              <Button variant="secondary" onClick={() => setAsking(false)}>Keep this one</Button>
              <Button variant="accent" onClick={() => void run(length, null)}>Write it again</Button>
            </>
          )}
          {ready && !busy && doc && !asking && (
            <>
              {partial && <Button variant="accent" onClick={() => void run(doc.length, doc)}>Continue ({doc.sections.length} of {doc.outline.length} written)</Button>}
              <Button variant="secondary" disabled={!doc.sections.length} onClick={() => void copy()}><Copy size={ICON.sm} /> Copy</Button>
              <Button variant="secondary" disabled={!doc.sections.length} onClick={() => save(fileName(book.title), summaryMarkdown(book, doc), 'text/markdown;charset=utf-8')}><Download size={ICON.sm} /> Download .md</Button>
              <Button variant="ghost" onClick={() => setAsking(true)}><RotateCcw size={ICON.sm} /> Write again</Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

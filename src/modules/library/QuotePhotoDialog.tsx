import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui'
import { readAttachment, type Attachment } from '@/lib/chatAttachments'
import { CAPS, ICON } from '@/lib/type'
import { Eyebrow, Field } from './fields'
import { inputStyle } from './fieldStyle'
import { uploadQuoteImage } from './libraryFiles'
import { isHeic, readableImage } from './heic'
import { useLibraryStore } from './libraryStore'
import { readPassage, PassageError } from './readPassage'

/**
 * A photographed page, turned into a quote.
 *
 * The photo is shown beside the words it was read as, because **what comes
 * back is a draft**: a model reading a phone photo of a curved page gets words
 * wrong, and the person is the only one who can see which. It says so on the
 * screen rather than in a manual.
 *
 * Three ways it can go wrong, and none of them costs the quote: the photo
 * cannot be prepared (say so), the page cannot be read (say why, and the text
 * box is still there to type in), the upload fails (the quote is **not**
 * saved, since a quote pointing at a photo that is not there is worse than
 * none).
 */
export function QuotePhotoDialog({ bookId, file, onClose }: { bookId: string; file: File; onClose: () => void }) {
  const addQuote = useLibraryStore(s => s.addQuote)
  const [att, setAtt] = useState<Attachment | null>(null)
  const [phase, setPhase] = useState<'preparing' | 'reading' | 'ready'>('preparing')
  const [note, setNote] = useState<string | null>(null)         // why it could not be read
  const [fatal, setFatal] = useState<string | null>(null)       // why the photo cannot be used at all
  const [text, setText] = useState('')
  const [page, setPage] = useState('')
  const [marked, setMarked] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const run = useRef(0)

  const read = useCallback(async (a: Attachment) => {
    const mine = ++run.current
    setPhase('reading'); setNote(null)
    try {
      const r = await readPassage({ data: a.data ?? '', mediaType: a.mediaType })
      if (mine !== run.current) return
      setText(r.text); setMarked(r.marked)
      if (r.page) setPage(p => p || String(r.page))
      if (!r.text) setNote('No readable text was found in that photo. Type the quote below, or try a closer shot.')
    } catch (e) {
      if (mine !== run.current) return
      setNote(e instanceof PassageError ? e.message : 'The page could not be read just now. You can still type the quote.')
    }
    setPhase('ready')
  }, [])

  useEffect(() => {
    let live = true
    void (async () => {
      if (!file.type.startsWith('image/') && !isHeic(file)) { setFatal(`${file.name || 'That file'} is not an image.`); setPhase('ready'); return }
      try {
        const a = await readAttachment(await readableImage(file))
        if (!live) return
        setAtt(a)
        await read(a)
      } catch (e) {
        if (live) { setFatal(e instanceof Error ? e.message : 'That photo could not be opened.'); setPhase('ready') }
      }
    })()
    // `run` is a request counter, not a DOM node: bumping it on the way out is what
    // makes an in-flight read stop writing into a dialog that has closed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { live = false; run.current++ }
  }, [file, read])

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose, saving])

  async function save() {
    if (!att) return
    setSaving(true); setSaveError(null)
    try {
      const blob = await (await fetch(`data:${att.mediaType};base64,${att.data}`)).blob()
      const imagePath = await uploadQuoteImage(bookId, blob, att.mediaType)
      const p = parseInt(page, 10)
      addQuote(bookId, { kind: 'image', body: text.trim() || undefined, imagePath, page: Number.isFinite(p) && p >= 0 ? p : undefined })
      onClose()
    } catch (e) {
      // Nothing was saved: the photo did not arrive, so neither does the quote.
      setSaveError(`The photo could not be saved — ${e instanceof Error ? e.message : 'the upload failed'}. Nothing was added.`)
      setSaving(false)
    }
  }

  const busy = phase !== 'ready'
  const preview = att ? `data:${att.mediaType};base64,${att.data}` : null

  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget && !saving) onClose() }} className="sb-above-modal"
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--sb-scrim)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label="Quote from a photo" style={{
        width: 'min(560px, 100%)', maxHeight: 'calc(94 * var(--vh))', display: 'flex', flexDirection: 'column',
        background: 'var(--sb-overlay)', border: 'var(--sb-border-width) solid var(--sb-border)',
        borderRadius: 'var(--sb-r-frame)', boxShadow: 'var(--sb-shadow-frame)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px 4px' }}>
          <h2 style={{ margin: 0, flex: 1, fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h2)', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--sb-ink-1)' }}>Quote from a photo</h2>
          <Button variant="ghost" iconOnly title="Close" aria-label="Close" disabled={saving} onClick={onClose}><X size={ICON.md} /></Button>
        </div>

        <div style={{ overflowY: 'auto', padding: '8px 20px 8px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {fatal ? (
            <div role="alert" style={{ color: 'var(--sb-negative)', fontSize: 'var(--sb-t-body)' }}>{fatal}</div>
          ) : (
            <>
              {preview && (
                <img src={preview} alt="The photographed page" style={{
                  width: '100%', maxHeight: 'calc(34 * var(--vh))', objectFit: 'contain', borderRadius: 'var(--sb-r-sm)',
                  background: 'var(--sb-field)', border: 'var(--sb-border-width) solid var(--sb-hairline)',
                }} />
              )}
              <div aria-live="polite" style={{ fontSize: 'var(--sb-t-body-s)', color: note ? 'var(--sb-accent-deep)' : 'var(--sb-ink-3)', minHeight: 18 }}>
                {phase === 'preparing' && 'Preparing the photo…'}
                {phase === 'reading' && 'Reading the page…'}
                {phase === 'ready' && note}
                {phase === 'ready' && !note && (marked ? 'Read the marked passage. Check it against the photo.' : 'Read the whole page. Cut it down to the passage you want, and check it against the photo.')}
              </div>
              <div>
                <Eyebrow>The words</Eyebrow>
                <textarea value={text} rows={6} aria-label="Quote text" disabled={busy && !text} placeholder="The passage, as printed"
                  onChange={e => setText(e.target.value)} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5, fontStyle: 'italic' }} />
              </div>
              <Field label="Page (optional)">
                <input value={page} inputMode="numeric" aria-label="Page (optional)" onChange={e => setPage(e.target.value)} style={{ ...inputStyle, maxWidth: 120 }} />
              </Field>
              {saveError && <div role="alert" style={{ color: 'var(--sb-negative)', fontSize: 'var(--sb-t-body-s)' }}>{saveError}</div>}
            </>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '12px 56px 16px 20px', borderTop: 'var(--sb-border-width) solid var(--sb-hairline)' }}>
          {att && !fatal && (
            <Button variant="ghost" disabled={busy || saving} onClick={() => void read(att)} style={{ marginRight: 'auto' }}>
              <RefreshCw size={ICON.sm} /> Read again
            </Button>
          )}
          {!att && !fatal && <span style={{ ...CAPS, color: 'var(--sb-ink-3)', marginRight: 'auto' }}>One moment</span>}
          <Button variant="secondary" disabled={saving} onClick={onClose}>Cancel</Button>
          {/* A photo with no words is still a quote worth keeping — the page you
              want to come back to — so Save does not wait for text. */}
          <Button variant="accent" disabled={!att || !!fatal || saving || phase === 'preparing'} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save quote'}
          </Button>
        </div>
      </div>
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, Check, ScanBarcode, ShoppingCart, X } from 'lucide-react'
import { Button } from '@/components/ui'
import { ICON } from '@/lib/type'
import { bookFromCandidate } from './applyCandidate'
import { lookupByIsbn, shelfMatch, type BookCandidate } from './bookLookup'
import { firstIsbn, makeScanner, readIsbnFromImage, type Scanner } from './barcodeScan'
import { CoverArt } from './CoverArt'
import { inputStyle } from './fieldStyle'
import { parseIsbn } from './isbn'
import { readableImage } from './heic'
import { useLibraryStore } from './libraryStore'

type Cam = 'starting' | 'on' | 'denied' | 'none' | 'insecure' | 'error'
type Phase =
  | { k: 'scan' }
  | { k: 'looking'; isbn: string }
  | { k: 'found'; isbn: string; c: BookCandidate; added?: 'want' | 'buy' }
  | { k: 'unknown'; isbn: string }
  | { k: 'offline'; isbn: string }

const CAM_WORDS: Record<Exclude<Cam, 'starting' | 'on'>, string> = {
  denied: 'The camera was refused. Allow it for this site in your browser’s settings — or type the ISBN, or take a photo of the barcode, below.',
  none: 'No camera was found on this device. Type the ISBN, or choose a photo of the barcode, below.',
  insecure: 'The camera only works on a secure (https) page. Type the ISBN, or choose a photo of the barcode, below.',
  error: 'The camera could not be started. Type the ISBN, or choose a photo of the barcode, below.',
}

/**
 * Scan a book's barcode and shelve it.
 *
 * Three ways in, because a camera is the one that is sometimes not there: the
 * **live camera**, a **photo** of the barcode, and the number **typed**. All
 * three end in the same place — a valid ISBN, looked up, shown as a book to
 * confirm. **A scan never adds anything by itself**: it shows what it found and
 * waits, so a misread that happens to pass the check digit is one tap from
 * being ignored rather than one tap from being on the shelf.
 *
 * The scanner pauses while a result is on screen, so a camera still pointing at
 * the same book does not find it again; **Scan next** resumes it. The camera is
 * stopped when the dialog closes (the browser's recording light going out is
 * the proof) and whenever the tab is hidden by closing, since a stream nobody
 * can see is still a stream.
 */
export function ScanIsbnDialog({ onClose, onOpenBook, onAddByHand }: {
  onClose: () => void
  onOpenBook: (id: string) => void
  onAddByHand: (isbn: string) => void
}) {
  const books = useLibraryStore(s => s.books)
  const addBook = useLibraryStore(s => s.addBook)
  const video = useRef<HTMLVideoElement>(null)
  const scanner = useRef<Scanner | null>(null)
  const phaseRef = useRef<Phase['k']>('scan')
  const [cam, setCam] = useState<Cam>('starting')
  const [phase, setPhaseState] = useState<Phase>({ k: 'scan' })
  const [typed, setTyped] = useState('')
  const [typedError, setTypedError] = useState<string | null>(null)
  const [added, setAdded] = useState(0)
  const [photoNote, setPhotoNote] = useState<string | null>(null)
  const setPhase = (p: Phase) => { phaseRef.current = p.k; setPhaseState(p) }

  const handle = useCallback(async (isbn: string) => {
    phaseRef.current = 'looking'; setPhaseState({ k: 'looking', isbn })
    const r = await lookupByIsbn(isbn)
    const hit = r.candidates[0]
    if (hit) setPhase({ k: 'found', isbn, c: { ...hit, isbn } })      // the edition in the hand, not the catalogue's first
    else if (r.failed.length >= 2) setPhase({ k: 'offline', isbn })
    else setPhase({ k: 'unknown', isbn })
  }, [])

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])

  // The camera, from start to the last track stopped.
  useEffect(() => {
    let live = true
    let stream: MediaStream | null = null
    let timer = 0
    const el = video.current
    async function start() {
      if (!window.isSecureContext) { setCam('insecure'); return }
      if (!navigator.mediaDevices?.getUserMedia) { setCam('none'); return }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false })
      } catch (e) {
        const n = (e as DOMException)?.name
        if (live) setCam(n === 'NotAllowedError' || n === 'SecurityError' ? 'denied' : n === 'NotFoundError' || n === 'OverconstrainedError' ? 'none' : 'error')
        return
      }
      if (!live) { stream.getTracks().forEach(t => t.stop()); return }
      const v = el
      if (!v) return
      v.srcObject = stream
      try { await v.play() } catch { /* autoplay refusal: the frame still decodes once it plays */ }
      try { scanner.current = await makeScanner() } catch { if (live) setCam('error'); return }
      if (!live) return
      setCam('on')
      const tick = async () => {
        if (!live) return
        if (phaseRef.current === 'scan' && v.readyState >= 2 && scanner.current) {
          const isbn = firstIsbn(await scanner.current.read(v).catch(() => []))
          if (isbn && live && phaseRef.current === 'scan') void handle(isbn)
        }
        if (live) timer = window.setTimeout(() => void tick(), 140)
      }
      void tick()
    }
    void start()
    return () => {
      live = false
      clearTimeout(timer)
      stream?.getTracks().forEach(t => t.stop())
      if (el) el.srcObject = null
    }
  }, [handle])

  function submitTyped() {
    const isbn = parseIsbn(typed)
    if (!isbn) { setTypedError('That is not a valid ISBN — the check digit does not add up. Look again at the number above the barcode.'); return }
    setTypedError(null); setTyped(''); void handle(isbn)
  }

  async function onPhoto(file: File | undefined) {
    if (!file) return
    setPhotoNote(null)
    try {
      scanner.current ??= await makeScanner()
      const isbn = await readIsbnFromImage(await readableImage(file), scanner.current)
      if (isbn) void handle(isbn); else setPhotoNote('No ISBN barcode could be read in that photo. Fill the frame with the barcode, in good light — or type the number.')
    } catch { setPhotoNote('That photo could not be read.') }
  }

  const onShelf = phase.k === 'found' ? shelfMatch(books, phase.c) : undefined
  const add = (toBuy: boolean) => {
    if (phase.k !== 'found') return
    addBook({ ...bookFromCandidate(phase.c), ...(toBuy ? { toBuy: true } : {}) })
    setAdded(n => n + 1)
    setPhase({ ...phase, added: toBuy ? 'buy' : 'want' })
  }
  const scanNext = () => { setPhotoNote(null); setPhase({ k: 'scan' }) }

  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget) onClose() }} className="sb-above-modal"
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--sb-scrim)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label="Scan an ISBN" style={{
        width: 'min(520px, 100%)', maxHeight: '94vh', display: 'flex', flexDirection: 'column',
        background: 'var(--sb-overlay)', border: 'var(--sb-border-width) solid var(--sb-border)', borderRadius: 'var(--sb-r-frame)', boxShadow: 'var(--sb-shadow-frame)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px 4px' }}>
          <h2 style={{ margin: 0, flex: 1, fontFamily: 'var(--sb-font-num)', fontSize: 'var(--sb-t-h2)', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--sb-ink-1)' }}>Scan an ISBN</h2>
          {added > 0 && <span style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)', marginRight: 8 }}>{added} added</span>}
          <Button variant="ghost" iconOnly title="Close" aria-label="Close" onClick={onClose}><X size={ICON.md} /></Button>
        </div>

        <div style={{ overflowY: 'auto', padding: '8px 20px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {cam !== 'starting' && cam !== 'on' ? (
            <div role="status" style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-accent-deep)', lineHeight: 1.5 }}>{CAM_WORDS[cam]}</div>
          ) : (
            <div style={{ position: 'relative', borderRadius: 'var(--sb-r-card)', overflow: 'hidden', background: '#000', aspectRatio: '4 / 3' }}>
              <video ref={video} playsInline muted aria-label="Camera" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              {phase.k === 'scan' && (
                <div aria-hidden style={{ position: 'absolute', left: '12%', right: '12%', top: '30%', bottom: '30%', border: '2px solid rgba(255,255,255,.85)', borderRadius: 10, boxShadow: '0 0 0 9999px rgba(0,0,0,.35)' }} />
              )}
              {cam === 'starting' && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff', fontSize: 'var(--sb-t-body-s)' }}>Starting the camera…</div>}
            </div>
          )}
          {cam === 'on' && phase.k === 'scan' && (
            <div aria-live="polite" style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>Hold the book’s barcode inside the frame — the long one, not the QR code.</div>
          )}

          {phase.k === 'looking' && <div role="status" style={{ color: 'var(--sb-ink-2)' }}>Found {phase.isbn} — looking it up…</div>}
          {phase.k === 'offline' && (
            <div role="alert" style={{ color: 'var(--sb-negative)' }}>Read {phase.isbn}, but the book catalogues could not be reached. Check your connection and scan again.</div>
          )}
          {phase.k === 'unknown' && (
            <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ color: 'var(--sb-ink-2)' }}>No catalogue knows {phase.isbn}. It may be a new or small-press edition.</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="accent" size="sm" onClick={() => { onAddByHand(phase.isbn); onClose() }}>Add it by hand</Button>
              </div>
            </div>
          )}
          {phase.k === 'found' && (
            <div style={{ display: 'flex', gap: 12, padding: 10, borderRadius: 'var(--sb-r-nav)', border: 'var(--sb-border-width) solid var(--sb-border)', background: 'var(--sb-card)' }}>
              <div style={{ width: 64, flexShrink: 0 }}>
                <CoverArt book={{ id: phase.c.sourceKey ?? phase.isbn, title: phase.c.title, authors: phase.c.authors, coverUrl: phase.c.coverUrl }} />
              </div>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontWeight: 600, color: 'var(--sb-ink-1)', lineHeight: 1.3 }}>{phase.c.title}</div>
                <div style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-3)' }}>
                  {[phase.c.authors.join(', '), phase.c.publishedYear, `ISBN ${phase.isbn}`].filter(Boolean).join(' · ')}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                  {phase.added ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-positive)' }}>
                      <Check size={ICON.sm} /> {phase.added === 'buy' ? 'Added to your buy list' : 'Added to your shelf'}
                    </span>
                  ) : onShelf ? (
                    <Button size="sm" variant="secondary" onClick={() => { onOpenBook(onShelf.id); onClose() }}><Check size={ICON.sm} color="var(--sb-positive)" /> On your shelf — open it</Button>
                  ) : (
                    <>
                      <Button size="sm" variant="accent" onClick={() => add(false)}>Want to read</Button>
                      <Button size="sm" variant="secondary" onClick={() => add(true)}><ShoppingCart size={ICON.sm} /> Buy later</Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
          {phase.k !== 'scan' && phase.k !== 'looking' && (
            <div><Button size="sm" variant={phase.k === 'found' ? 'primary' : 'secondary'} onClick={scanNext}><ScanBarcode size={ICON.sm} /> Scan next</Button></div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 4, borderTop: 'var(--sb-border-width) solid var(--sb-hairline)' }}>
            <label style={{ fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }} htmlFor="isbn-typed">Or type the ISBN</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input id="isbn-typed" value={typed} inputMode="numeric" placeholder="978-1-61268-019-4" onChange={e => { setTyped(e.target.value); setTypedError(null) }}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitTyped() } }} style={inputStyle} />
              <Button variant="secondary" disabled={!typed.trim()} onClick={submitTyped}>Look up</Button>
            </div>
            {typedError && <div role="alert" style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-negative)' }}>{typedError}</div>}
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-ink-2)', textDecoration: 'underline', alignSelf: 'flex-start' }}>
              <Camera size={ICON.sm} /> Use a photo of the barcode instead
              {/* No `capture`: it forces the camera and takes the photo library away. */}
              <input type="file" accept="image/*,.heic,.heif" hidden aria-label="Choose a photo of a barcode" onChange={e => { void onPhoto(e.target.files?.[0]); e.target.value = '' }} />
            </label>
            {photoNote && <div role="alert" style={{ fontSize: 'var(--sb-t-body-s)', color: 'var(--sb-negative)' }}>{photoNote}</div>}
          </div>
        </div>
      </div>
    </div>
  )
}

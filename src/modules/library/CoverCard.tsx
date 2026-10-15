import { useRef, useState } from 'react'
import { Camera, ImageOff, Images } from 'lucide-react'
import { Button, Card } from '@/components/ui'
import { ICON } from '@/lib/type'
import { coverOptions } from './bookLookup'
import { readableImage } from './heic'
import { Eyebrow } from './fields'
import { useLibraryStore } from './libraryStore'
import type { Book } from './types'

const MAX_EDGE = 520          // a cover on a shelf or a panel never needs more
const MAX_CHARS = 180_000     // the picture is stored in the book's own row, so it stays small

/** A picture from the person's device, made small enough to live in the row: scaled to ≤520px on its long edge and
 *  saved as JPEG, stepping the quality down until it fits. Returns null when the file is not a picture. */
export async function coverFromFile(file: File): Promise<string | null> {
  const f = await readableImage(file)
  if (!f.type.startsWith('image/') && !/\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name)) return null
  let bmp: ImageBitmap
  try { bmp = await createImageBitmap(f, { imageOrientation: 'from-image' }) } catch { return null }
  const k = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k))
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  for (const q of [0.88, 0.78, 0.66, 0.5]) {
    const url = c.toDataURL('image/jpeg', q)
    if (url.length <= MAX_CHARS) return url
  }
  return null
}

/** Change a book's cover: a picture of your own, another edition's cover from the catalogues, or none at all. Each
 *  one writes straight through like every control in the panel. */
export function CoverCard({ book }: { book: Book }) {
  const update = useLibraryStore(s => s.updateBook)
  const file = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState('')
  const [options, setOptions] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)

  const upload = async (f?: File) => {
    if (!f) return
    setMsg('')
    const url = await coverFromFile(f)
    if (!url) { setMsg('That file could not be used as a picture. Try a JPEG or PNG.'); return }
    update(book.id, { coverUrl: url })
  }

  const browse = async () => {
    setBusy(true); setMsg('')
    const [a, b] = await Promise.all([
      coverOptions(`${book.title} ${book.authors[0] ?? ''}`.trim()),
      book.isbn ? coverOptions(`isbn:${book.isbn}`) : Promise.resolve({ urls: [] as string[], failed: [] as string[] }),
    ])
    // The ISBN's own pictures first: they are of the edition in hand.
    const urls = [...new Set([...b.urls, ...a.urls])].filter(u => u !== book.coverUrl).slice(0, 12)
    setOptions(urls)
    const failed = [...new Set([...a.failed, ...b.failed])]
    setMsg(urls.length ? (failed.length ? `${failed.join(' and ')} could not be reached; showing the rest.` : '')
      : failed.length ? `${failed.join(' and ')} could not be reached.` : 'No other covers found for this book.')
    setBusy(false)
  }

  return (
    <Card style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Eyebrow>Cover</Eyebrow>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Button size="sm" variant="secondary" onClick={() => file.current?.click()}><Camera size={ICON.sm} /> Use my own picture</Button>
        <Button size="sm" variant="secondary" onClick={browse} disabled={busy}><Images size={ICON.sm} /> {busy ? 'Looking…' : 'Other covers online'}</Button>
        {book.coverUrl && <Button size="sm" variant="ghost" onClick={() => { update(book.id, { coverUrl: undefined }); setOptions(null) }}><ImageOff size={ICON.sm} /> Remove cover</Button>}
      </div>
      {/* No `capture`: it would take the photo library away; the plain picker offers the camera too on a phone. */}
      <input ref={file} type="file" accept="image/*,.heic,.heif" aria-label="Choose a cover picture" hidden
        onChange={e => { void upload(e.target.files?.[0]); e.target.value = '' }} />
      {options && options.length > 0 && (
        <div role="group" aria-label="Other covers" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))', gap: 8 }}>
          {options.map(u => (
            <button key={u} type="button" aria-label="Use this cover" onClick={() => { update(book.id, { coverUrl: u }); setOptions(null) }}
              style={{ padding: 0, border: '1px solid var(--sb-border)', borderRadius: 'var(--sb-r-chip)', background: 'var(--sb-field)', cursor: 'pointer', aspectRatio: '2 / 3', overflow: 'hidden' }}>
              <img src={u} alt="" loading="lazy" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                onError={e => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none' }} />
            </button>
          ))}
        </div>
      )}
      <div style={{ minHeight: 18, fontSize: 'var(--sb-t-meta)', color: 'var(--sb-ink-3)' }}>{msg}</div>
    </Card>
  )
}

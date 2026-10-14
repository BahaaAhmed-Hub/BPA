import { useEffect, useState } from 'react'

// The colour a book's spine should be: the cover's own. Read by drawing the cover small onto a canvas.
// A canvas refuses to be read once it has drawn a picture from a host that does not send CORS headers
// (Google's thumbnails; Open Library's covers do), and that refusal is ordinary — the spine then keeps
// the colour it already had. Nothing is stored: the colour of a cover is a fact about the picture.

const cache = new Map<string, string | null>()
const inflight = new Map<string, Promise<string | null>>()

export function toneOf(pixels: Uint8ClampedArray): string | null {
  let r = 0, g = 0, b = 0, wsum = 0
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 200) continue
    const R = pixels[i], G = pixels[i + 1], B = pixels[i + 2]
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B)
    // The page margin and the black of the type say nothing about the book: weigh by saturation, and
    // ignore near-white and near-black altogether.
    if (mx > 238 && mn > 225) continue
    if (mx < 22) continue
    const w = 0.15 + (mx - mn) / 255
    r += R * w; g += G * w; b += B * w; wsum += w
  }
  if (!wsum) return null
  // Cloth is darker than a printed cover under the same light.
  const k = 0.86
  const hex = (v: number) => Math.round(Math.min(255, (v / wsum) * k)).toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

function read(url: string): Promise<string | null> {
  return new Promise(resolve => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    const done = (v: string | null) => { img.onload = img.onerror = null; resolve(v) }
    const timer = setTimeout(() => done(null), 6000)
    img.onerror = () => { clearTimeout(timer); done(null) }
    img.onload = () => {
      clearTimeout(timer)
      try {
        if (img.naturalWidth <= 2) return done(null)
        const c = document.createElement('canvas'); c.width = c.height = 16
        const ctx = c.getContext('2d', { willReadFrequently: true })
        if (!ctx) return done(null)
        ctx.drawImage(img, 0, 0, 16, 16)
        done(toneOf(ctx.getImageData(0, 0, 16, 16).data))
      } catch { done(null) }   // tainted canvas
    }
    img.src = url
  })
}

export function coverTone(url: string): Promise<string | null> {
  if (cache.has(url)) return Promise.resolve(cache.get(url) ?? null)
  let p = inflight.get(url)
  if (!p) { p = read(url).then(v => { cache.set(url, v); inflight.delete(url); return v }); inflight.set(url, p) }
  return p
}

/** The cover's colour once it has been read; `undefined` until then and when it cannot be read. */
export function useCoverTone(url?: string): string | undefined {
  const [tone, setTone] = useState<string | undefined>(() => (url ? cache.get(url) ?? undefined : undefined))
  useEffect(() => {
    if (!url) { setTone(undefined); return }
    let live = true
    void coverTone(url).then(v => { if (live) setTone(v ?? undefined) })
    return () => { live = false }
  }, [url])
  return tone
}

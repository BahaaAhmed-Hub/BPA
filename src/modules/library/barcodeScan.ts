// ─── Reading a barcode from a camera frame or a photo ────────────────────────
// Two engines behind one function, chosen at the moment of use:
//   · the browser's own `BarcodeDetector` where it has one and says it reads
//     EAN-13 (Chrome on Android and macOS, Edge) — fast, free, and costs no
//     bytes of ours;
//   · ZXing everywhere else, which in practice means **Safari on iPhone and
//     iPad** — the devices this is for. It is loaded the first time it is
//     needed, so nobody who never scans pays for it.
// "Where it has one and *says it reads EAN-13*": a detector that exists but does
// not list the format would scan for ever and find nothing, so that case falls
// through to ZXing too.
//
// Only EAN-13 is asked for. That is every book barcode; asking for all formats
// makes both engines slower and lets a QR code on the table across the room win.
import { parseIsbn } from './isbn'

interface NativeDetector { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> }
interface NativeCtor { new (o: { formats: string[] }): NativeDetector; getSupportedFormats?: () => Promise<string[]> }

export interface Scanner {
  kind: 'native' | 'zxing'
  /** Every value the engine saw in this frame, unfiltered. */
  read(src: HTMLVideoElement | HTMLCanvasElement): Promise<string[]>
}

export async function makeScanner(): Promise<Scanner> {
  const Native = (globalThis as { BarcodeDetector?: NativeCtor }).BarcodeDetector
  if (Native) {
    let ok = true
    try { ok = !Native.getSupportedFormats || (await Native.getSupportedFormats()).includes('ean_13') } catch { ok = false }
    if (ok) {
      const det = new Native({ formats: ['ean_13'] })
      return { kind: 'native', read: async src => (await det.detect(src)).map(r => r.rawValue) }
    }
  }
  const z = await import('@zxing/library')
  const reader = new z.MultiFormatReader()
  reader.setHints(new Map<number, unknown>([
    [z.DecodeHintType.POSSIBLE_FORMATS, [z.BarcodeFormat.EAN_13]],
    [z.DecodeHintType.TRY_HARDER, true],
  ]))
  const canvas = document.createElement('canvas')
  return {
    kind: 'zxing',
    async read(src) {
      const w = src instanceof HTMLVideoElement ? src.videoWidth : src.width
      const h = src instanceof HTMLVideoElement ? src.videoHeight : src.height
      if (!w || !h) return []
      // A frame bigger than this is more pixels to decode and no more bars.
      const scale = Math.min(1, 960 / w)
      canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale)
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return []
      ctx.drawImage(src, 0, 0, canvas.width, canvas.height)
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const lum = new Uint8ClampedArray(canvas.width * canvas.height)
      for (let i = 0, j = 0; i < data.length; i += 4, j++) lum[j] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000
      try {
        const bitmap = new z.BinaryBitmap(new z.HybridBinarizer(new z.RGBLuminanceSource(lum, canvas.width, canvas.height)))
        return [reader.decode(bitmap).getText()]
      } catch { return [] }   // NotFoundException is the ordinary "no barcode in this frame"
    },
  }
}

/** The first valid ISBN-13 among what an engine saw — anything else (a UPC on a
 *  bookmark, a magazine's 977) is not a book and is passed over. */
export const firstIsbn = (values: string[]): string | null => {
  for (const v of values) { const i = parseIsbn(v); if (i) return i }
  return null
}

/** A photo of a barcode, for when the live camera is refused or unavailable.
 *  Tried upright and then turned a quarter each way, since a phone photo of a
 *  paperback's back cover is as often sideways as not. */
export async function readIsbnFromImage(file: Blob, scanner: Scanner): Promise<string | null> {
  const bmp = await createImageBitmap(file)
  try {
    const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
    const w = Math.round(bmp.width * s), h = Math.round(bmp.height * s)
    for (const turn of [0, 90, 270]) {
      const c = document.createElement('canvas')
      const sideways = turn !== 0
      c.width = sideways ? h : w; c.height = sideways ? w : h
      const ctx = c.getContext('2d')
      if (!ctx) return null
      ctx.translate(c.width / 2, c.height / 2); ctx.rotate((turn * Math.PI) / 180)
      ctx.drawImage(bmp, -w / 2, -h / 2, w, h)
      const hit = firstIsbn(await scanner.read(c))
      if (hit) return hit
    }
    return null
  } finally { bmp.close() }
}

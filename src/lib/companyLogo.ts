// ─── A company's logo — pixels, held by the company ──────────────────────────
//
// `DynamicCompany` had no logo at all, so every tile in the rail and every card
// in Settings drew a tinted disc with two initials in it. That was the right
// answer while there was nothing to draw: *nothing is invented*, and a made-up
// mark is worse than letters. This is the way to give it the real one.
//
// Three decisions, each of which could have gone another way:
//
// - **What is stored is a data URL, not a link.** A link is a request to
//   somebody else's server on every render, it dies when their path changes,
//   and most company marks sit behind a sign-in anyway. A data URL is in the
//   `companies` row, so it travels to every device the way the colour does and
//   is there with no network at all.
// - **What is stored is pixels, never markup.** An SVG is rasterised like
//   everything else, so nothing the app draws from this field can ever be
//   markup — the one shape in, the one shape out. (An `<img>` is already a
//   non-scripting context, so this is belt to that braces, and it also means a
//   50KB SVG with a font in it costs what a 128px bitmap costs.)
// - **It is small on purpose, and no logo is ever refused for being big.** A
//   logo is drawn at 40px in the rail and 38px in Settings, so 128px is
//   already more than any screen asks of it, and the row it rides in is read
//   on every load. Over the cap the *encoder* is asked again rather than the
//   person.
//
// The ladder is two rungs, and the second one is why there is no size
// refusal. Measured in Chromium, on the densest thing that can be in a 128px
// box — pure RGB noise — and on a flat mark:
//
//                            PNG     WebP .85
//     noise  128px        75,574       39,000   ← measured through this
//     photo  128px        65,458       10,000     picker, not a standalone
//     flat   128px         1,186          800     encode
//
// PNG is first because it is lossless and, for the flat marks most logos
// are, *smaller*. WebP is second because its worst case is under the cap
// whatever is handed in, so the second rung always fits. **Noise is the bound
// by construction** — nothing of a fixed pixel count compresses worse than
// maximum entropy — so 39KB is the ceiling of this ladder and the 48KB cap
// sits above it rather than in front of anybody. Quality moves that figure
// far less than it looks: 0.9 measured 41KB and 0.85 measured 39KB, because
// what costs the bytes is the entropy, not the quantiser.
// A 96px rung and a "that image is too big" refusal were both written before
// this was measured and both were unreachable; unreachable guards are worse
// than none, so they went.
//
// Never JPEG: a logo is usually transparent, and JPEG would put a black or
// white square behind every mark in a column of circles.

/** Drawn at 40px; stored at this, so a retina screen still has pixels left. */
export const LOGO_PX = 128
/** Past this the row itself becomes the cost. The WebP rung's own worst case
 *  is about 20KB, so this is a ceiling the ladder cannot reach rather than a
 *  gate anybody meets. */
export const LOGO_MAX_BYTES = 48_000
/** The one place that says what may be handed in. */
export const LOGO_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/avif'

/** Roughly how many bytes a data URL costs in the row. base64 is 4 bytes for
 *  every 3, and the row is stored as text, so this is the figure that matters
 *  rather than the file's own size. */
export function logoBytes(dataUrl: string): number {
  return dataUrl.length
}

/** Human bytes, for a message that has to name a size. */
export function kb(n: number): string {
  return `${Math.round(n / 1024)}KB`
}

/**
 *  One file in, one `image/png` or `image/webp` data URL out.
 *
 *  Throws an `Error` whose message is a sentence meant to be shown: a picker
 *  that fails silently is indistinguishable from one that is not wired up,
 *  which is the thing this app keeps finding.
 */
export async function logoFromFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error(`${file.name || 'That file'} is not an image`)
  }
  const bitmap = await decode(file)
  // `contain`, centred, on a transparent ground: a wordmark is wider than it
  // is tall and cropping it to a square would cut the name in half.
  const scale = Math.min(LOGO_PX / bitmap.width, LOGO_PX / bitmap.height)
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))

  const png = draw(bitmap, w, h, 'image/png')
  if (png && logoBytes(png) <= LOGO_MAX_BYTES) return png

  // Lossless was over the cap, which means a photographic mark. WebP keeps
  // the alpha, and 0.85 rather than 0.9 because the measurement through this
  // picker — not the standalone encode — put pure noise at 41KB against a
  // 48KB cap, and 15% of headroom is not headroom.
  const webp = draw(bitmap, w, h, 'image/webp', 0.85)
  if (webp && logoBytes(webp) <= LOGO_MAX_BYTES) return webp

  // The one way to arrive here: a browser with no WebP *encoder*, where
  // `toDataURL('image/webp')` quietly answers with a PNG — the spec's own
  // fallback. So the sentence names the fix rather than the mechanism.
  throw new Error(`That image is ${kb(logoBytes(webp || png || ''))} and this browser cannot shrink it further — try a flatter logo, or save it smaller first`)
}

/** The canvas is square, so every logo comes back the same shape and a column
 *  of them lines up whatever each file's proportions were. */
function draw(bitmap: ImageBitmap | HTMLImageElement, w: number, h: number, type: string, quality?: number): string | null {
  const canvas = document.createElement('canvas')
  canvas.width = LOGO_PX; canvas.height = LOGO_PX
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(bitmap, (LOGO_PX - w) / 2, (LOGO_PX - h) / 2, w, h)
  try { return canvas.toDataURL(type, quality) } catch { return null }
}

/** `createImageBitmap` is the fast path and refuses an SVG in some browsers,
 *  so an `<img>` is the fallback — which is also the only thing that will
 *  render an SVG at all. A mark with no intrinsic size says so rather than
 *  coming back as a 0×0 canvas nobody can see. */
async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (!file.type.includes('svg') && typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file) } catch { /* fall through */ }
  }
  const url = await readAsDataUrl(file)
  const img = new Image()
  img.decoding = 'sync'
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error(`${file.name || 'That image'} could not be read`))
    img.src = url
  })
  if (!img.naturalWidth || !img.naturalHeight) {
    throw new Error(`${file.name || 'That image'} has no size of its own — an SVG needs a width or a viewBox`)
  }
  return img
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('That file could not be read'))
    r.readAsDataURL(file)
  })
}

/** The first image on a drop or a paste, or null. A screenshot pasted from the
 *  clipboard arrives exactly this way, which is how most logos are to hand. */
export function imageFrom(data: DataTransfer | null): File | null {
  if (!data) return null
  for (const item of Array.from(data.files)) {
    if (item.type.startsWith('image/')) return item
  }
  return null
}

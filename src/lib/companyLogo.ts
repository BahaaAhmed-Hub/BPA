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
// - **The stored square is what the circle shows, edge to edge.** A logo
//   drawn `contain` with a margin, inside a circular clip, reads as a *square
//   floating in a circle* — which is exactly what a navy app mark and a white
//   wordmark looked like in the rail. A mark has one of two kinds of ground
//   and they want opposite things, so `logoFromFile` asks which:
//     · **transparent** (a PNG cut out) — the company's own tint is its
//       ground, so it is drawn contained with a margin and the tint fills the
//       rest of the circle.
//     · **opaque** (its own background baked in) — that background *is* the
//       mark's ground, so the canvas is filled with it first and the mark
//       drawn over it. A square logo comes out unchanged; a wide one gets its
//       own colour either side rather than white bars or a crop, so nothing
//       is ever cut off and the circle is full.
//   Either way the stored 128px square is already *made to be a circle*, so
//   `CompanyMark` draws it edge to edge with no padding and no second rule.
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
  const ground = groundOf(bitmap)

  // With no ground of its own the mark is drawn a little smaller, so it has
  // air inside the circle rather than touching its edge. With one, it is
  // drawn at full size: the ground is extended to the corners instead, which
  // is what makes the circle full without cropping anything.
  const box = ground ? LOGO_PX : Math.round(LOGO_PX * 0.84)
  const scale = Math.min(box / bitmap.width, box / bitmap.height)
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))

  const png = draw(bitmap, w, h, ground, 'image/png')
  if (png && logoBytes(png) <= LOGO_MAX_BYTES) return png

  // Lossless was over the cap, which means a photographic mark. WebP keeps
  // the alpha, and 0.85 rather than 0.9 because the measurement through this
  // picker — not the standalone encode — put pure noise at 41KB against a
  // 48KB cap, and 15% of headroom is not headroom.
  const webp = draw(bitmap, w, h, ground, 'image/webp', 0.85)
  if (webp && logoBytes(webp) <= LOGO_MAX_BYTES) return webp

  // The one way to arrive here: a browser with no WebP *encoder*, where
  // `toDataURL('image/webp')` quietly answers with a PNG — the spec's own
  // fallback. So the sentence names the fix rather than the mechanism.
  throw new Error(`That image is ${kb(logoBytes(webp || png || ''))} and this browser cannot shrink it further — try a flatter logo, or save it smaller first`)
}

/**
 *  The colour this image sits on, or `null` where it has none.
 *
 *  Read from the **edge**, not from one corner: a mark on a white card with a
 *  coloured bar down one side would answer differently at each corner, and
 *  guessing wrong fills a circle with a colour the logo does not use.
 *
 *  Twelve points round the border, and the answer is the one **nine of them
 *  agree on** rather than all twelve. Unanimity was the first rule and it is
 *  too strict for real logos: a mark that touches an edge — or merely reaches
 *  the middle of one, which plenty of wide marks do — puts its own colour
 *  under a sample point and the whole image is then read as having no ground,
 *  which puts the square back inside the circle. A photograph still answers
 *  `null`, because its border does not have nine points within a hair of each
 *  other; so does any cut-out, since **one** transparent sample is enough to
 *  say the image has no ground of its own.
 */
function groundOf(bitmap: ImageBitmap | HTMLImageElement): string | null {
  const w = bitmap.width, h = bitmap.height
  if (!w || !h) return null
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(bitmap, 0, 0)

  const x1 = 0, x2 = Math.floor(w / 2), x3 = w - 1
  const y1 = 0, y2 = Math.floor(h / 2), y3 = h - 1
  const points: [number, number][] = [
    [x1, y1], [x2, y1], [x3, y1],   // top
    [x1, y2],           [x3, y2],   // sides
    [x1, y3], [x2, y3], [x3, y3],   // bottom
    // One ring in, so a 1px border or a JPEG's ringing does not decide it.
    [1, 1], [x3 - 1, 1], [1, y3 - 1], [x3 - 1, y3 - 1],
  ]
  const seen: number[][] = []
  for (const [x, y] of points) {
    let px: Uint8ClampedArray
    try { px = ctx.getImageData(Math.max(0, x), Math.max(0, y), 1, 1).data }
    catch { return null }          // a tainted canvas cannot be read
    if (px[3] < 250) return null   // any transparency at the edge: a cut-out
    seen.push([px[0], px[1], px[2]])
  }
  // 6 of 255 per channel: a JPEG of a flat background wobbles by a couple.
  const alike = (a: number[], b: number[]) =>
    Math.abs(a[0] - b[0]) <= 6 && Math.abs(a[1] - b[1]) <= 6 && Math.abs(a[2] - b[2]) <= 6
  let best: number[] | null = null
  let bestCount = 0
  for (const s of seen) {
    const n = seen.filter(o => alike(s, o)).length
    if (n > bestCount) { bestCount = n; best = s }
  }
  if (!best || bestCount < 9) return null
  return `rgb(${best[0]}, ${best[1]}, ${best[2]})`
}

/** The canvas is square, so every logo comes back the same shape and a column
 *  of them lines up whatever each file's proportions were — and `ground`, when
 *  the image has one, is painted across the whole of it first, so the corners
 *  the circle needs are the mark's own colour rather than a hole. */
function draw(bitmap: ImageBitmap | HTMLImageElement, w: number, h: number, ground: string | null, type: string, quality?: number): string | null {
  const canvas = document.createElement('canvas')
  canvas.width = LOGO_PX; canvas.height = LOGO_PX
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  if (ground) { ctx.fillStyle = ground; ctx.fillRect(0, 0, LOGO_PX, LOGO_PX) }
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

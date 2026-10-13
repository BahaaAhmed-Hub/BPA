// ─── Cutting a shelf photograph into pieces a model can read ─────────────────
// A shelf is wide. A phone photo of one is 4000 pixels across, and the model
// takes at most ~1568 on an edge — so sending the whole thing shrinks every
// spine to a smear. Better: cut it into overlapping tiles, each near native
// resolution, read each, and merge. The overlap is so a spine on a cut line is
// whole in at least one tile.
//
// `planTiles` is pure (rectangles in, rectangles out) so the geometry is tested
// without a browser; `cutTiles` draws them.

export interface Rect { x: number; y: number; w: number; h: number }

/** The most pieces one photo is cut into: each is a model call. */
export const MAX_TILES = 12
/** Aim for pieces no bigger than this on their long edge, so they need no downscale. */
export const TILE_EDGE = 1000
/** How far each piece reaches into its neighbour, as a share of a step. */
export const OVERLAP = 0.18
/** The model's own ceiling on an edge; a piece larger than this is scaled to it. */
export const SEND_EDGE = 1568

export function planTiles(w: number, h: number): Rect[] {
  if (!(w > 0) || !(h > 0)) return []
  // Columns first (shelves are wide), then rows, then squeeze to the cap.
  let cols = Math.max(1, Math.ceil(w / TILE_EDGE))
  let rows = Math.max(1, Math.ceil(h / TILE_EDGE))
  while (cols * rows > MAX_TILES) {
    if (cols >= rows && cols > 1) cols--
    else if (rows > 1) rows--
    else break
  }
  const stepX = w / cols, stepY = h / rows
  const ovX = cols > 1 ? stepX * OVERLAP : 0, ovY = rows > 1 ? stepY * OVERLAP : 0
  const out: Rect[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = Math.max(0, Math.round(c * stepX - ovX)), x1 = Math.min(w, Math.round((c + 1) * stepX + ovX))
      const y0 = Math.max(0, Math.round(r * stepY - ovY)), y1 = Math.min(h, Math.round((r + 1) * stepY + ovY))
      out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
    }
  }
  return out
}

export interface Tile { data: string; mediaType: string; label: string }

/** Draws each planned rectangle to JPEG, scaled down only if it is over the model's edge. */
/** Safari rejects the options bag (and some builds the Blob) outright, so a failure
 *  there is not "this file is bad": try the plain call, then an <img>, which is
 *  what every browser has always been able to decode (and orients by EXIF itself). */
export async function openBitmap(file: Blob): Promise<ImageBitmap | null> {
  const viaOptions = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null)
  if (viaOptions) return viaOptions
  const plain = await createImageBitmap(file).catch(() => null)
  if (plain) return plain
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return await createImageBitmap(img).catch(() => null)
  } catch { return null } finally { URL.revokeObjectURL(url) }
}

export async function cutTiles(file: File): Promise<Tile[]> {
  const bmp = await openBitmap(file)
  if (!bmp) throw new Error('That photo could not be opened.')
  try {
    const rects = planTiles(bmp.width, bmp.height)
    const tiles: Tile[] = []
    for (const [i, r] of rects.entries()) {
      const scale = Math.min(1, SEND_EDGE / Math.max(r.w, r.h))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(r.w * scale)); canvas.height = Math.max(1, Math.round(r.h * scale))
      const g = canvas.getContext('2d')
      if (!g) throw new Error('This browser cannot prepare the photo.')
      g.drawImage(bmp, r.x, r.y, r.w, r.h, 0, 0, canvas.width, canvas.height)
      const url = canvas.toDataURL('image/jpeg', 0.9)
      tiles.push({ data: url.slice(url.indexOf(',') + 1), mediaType: 'image/jpeg', label: rects.length > 1 ? `part ${i + 1} of ${rects.length}` : 'the photo' })
    }
    return tiles
  } finally { bmp.close() }
}

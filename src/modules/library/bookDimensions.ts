// ─── How big a book really is ────────────────────────────────────────────────
// The shelf stands each book at its real height and thickness, so a size has to
// be something we would stake a spine on. Nothing here asks the network (see
// `findDimensions.ts`); it is the part that decides what to believe.
//
// **A figure is checked before it is used, and a doubtful one is dropped, not
// averaged in.** Catalogues are full of editions: a listing for the hardback
// attached to the paperback's ISBN, a "9" that meant inches, a thickness in the
// wrong column. So every source is validated alone (is it a plausible book? does
// the thickness fit the page count? does the shape fit the cover picture?), then
// sources that agree reinforce each other, and when nothing survives the book is
// *estimated* from its page count and said to be — never presented as measured.

export interface Dims { heightMm: number; widthMm: number; thicknessMm: number }
export type DimsSource = 'measured' | 'cover' | 'estimate' | 'manual'
export type Binding = 'paperback' | 'hardcover'

/** Plausible ranges for a book you would shelve. Mirrors the migration's CHECKs, a little tighter. */
export const LIMITS = { h: [90, 420], w: [60, 300], t: [3, 130] } as const

const IN = 25.4
const round = (n: number) => Math.round(n)

/**
 * "24 x 16 x 3 cm", "9.5 x 6.25 x 1.5 inches", "8 inches", "216 mm" — the shapes catalogues write —
 * or Google's separate fields ("24.00 cm"). Order is height, width, thickness. No unit means the
 * number could be inches or centimetres, so it is **refused** rather than guessed.
 */
export function parseDimensions(raw: string | { height?: string; width?: string; thickness?: string } | null | undefined): Partial<Dims> | null {
  if (!raw) return null
  if (typeof raw === 'object') {
    const one = (s?: string) => (s ? parseDimensions(s)?.heightMm : undefined)
    const d: Partial<Dims> = { heightMm: one(raw.height), widthMm: one(raw.width), thicknessMm: one(raw.thickness) }
    return d.heightMm || d.widthMm || d.thicknessMm ? d : null
  }
  const s = raw.toLowerCase().replace(/,/g, '.').replace(/[×*]/g, ' x ')
  const unit = /(millimet|\bmm\b)/.test(s) ? 'mm' : /(centimet|\bcm\b)/.test(s) ? 'cm' : /(inch|\bin\b|")/.test(s) ? 'in' : null
  if (!unit) return null
  const nums = (s.match(/\d+(?:\.\d+)?/g) ?? []).map(Number).filter(n => n > 0).slice(0, 3)
  if (!nums.length) return null
  const mm = nums.map(n => round(unit === 'mm' ? n : unit === 'cm' ? n * 10 : n * IN))
  const [h, w, t] = mm
  return { heightMm: h, ...(w ? { widthMm: w } : {}), ...(t ? { thicknessMm: t } : {}) }
}

export interface Context { pages?: number; coverAspect?: number }
export interface Verdict { ok: boolean; problems: string[] }

/** Is this (possibly partial) set of figures a believable book? Only what is present is judged. */
export function checkDims(d: Partial<Dims>, ctx: Context = {}): Verdict {
  const bad: string[] = []
  const range = (v: number | undefined, [lo, hi]: readonly [number, number], what: string) => {
    if (v !== undefined && !(v >= lo && v <= hi)) bad.push(`${what} ${v} mm is outside ${lo}–${hi} mm`)
  }
  range(d.heightMm, LIMITS.h, 'height'); range(d.widthMm, LIMITS.w, 'width'); range(d.thicknessMm, LIMITS.t, 'thickness')
  if (d.heightMm && d.widthMm) {
    const r = d.widthMm / d.heightMm
    if (r < 0.45 || r > 1.3) bad.push(`width/height ${r.toFixed(2)} is not the shape of a book`)
    // The cover picture is the book's actual proportion. A listing that disagrees with it by more than
    // a measuring tolerance is a different edition (or a different book).
    if (ctx.coverAspect && Math.abs(r - ctx.coverAspect) / ctx.coverAspect > 0.12) {
      bad.push(`its shape ${r.toFixed(2)} disagrees with the cover picture ${ctx.coverAspect.toFixed(2)}`)
    }
  }
  if (d.thicknessMm && ctx.pages && ctx.pages >= 16) {
    // Paper plus covers: from airy cloth-bound to thin-paper dictionary stays within this band.
    const perPage = d.thicknessMm / ctx.pages
    if (perPage < 0.025 || perPage > 0.25) bad.push(`${d.thicknessMm} mm for ${ctx.pages} pages is not credible`)
  }
  return { ok: bad.length === 0, problems: bad }
}

/** Typical trim by binding. A stated starting point for an estimate, labelled as one. */
const TRIM: Record<Binding, { h: number; w: number; board: number; sheet: number }> = {
  paperback: { h: 205, w: 135, board: 3, sheet: 0.055 },
  hardcover: { h: 235, w: 156, board: 9, sheet: 0.06 },
}

/** Everything worked out from the pages: used when no catalogue could be trusted. */
export function estimateDims(a: { pages?: number; binding?: Binding; coverAspect?: number }): Dims {
  const t = TRIM[a.binding ?? 'paperback']
  const pages = a.pages && a.pages > 0 ? a.pages : 280
  // A long book is usually a bigger one: a 900-page paperback is not 205 mm.
  const h = round(t.h + Math.min(30, Math.max(0, (pages - 400) / 20)))
  const aspect = a.coverAspect && a.coverAspect >= 0.5 && a.coverAspect <= 1.0 ? a.coverAspect : t.w / t.h
  return {
    heightMm: h,
    widthMm: round(h * aspect),
    thicknessMm: Math.min(LIMITS.t[1], Math.max(LIMITS.t[0], round(pages * t.sheet + t.board))),
  }
}

export interface Reading { dims: Partial<Dims>; from: string }
export interface Settled { dims: Dims; source: DimsSource; confidence: 'high' | 'medium' | 'low'; notes: string[] }

const near = (a: number, b: number, tol = 0.06) => Math.abs(a - b) / Math.max(a, b) <= tol

/**
 * The size to stand a book at. Readings are validated one by one; those that pass and agree on height
 * reinforce each other (`high`), a lone passing reading is `medium`, and with none the book is estimated
 * (`low`). Missing figures in a good reading are filled from the cover's shape and the page count, and the
 * notes say so. A hand-typed size is never second-guessed.
 */
export function settleDims(readings: Reading[], ctx: Context & { binding?: Binding; manual?: Dims }): Settled {
  if (ctx.manual) return { dims: ctx.manual, source: 'manual', confidence: 'high', notes: ['typed by hand'] }
  const notes: string[] = []
  const good: Reading[] = []
  for (const r of readings) {
    if (!r.dims.heightMm && !r.dims.thicknessMm) { notes.push(`${r.from}: nothing usable`); continue }
    const v = checkDims(r.dims, ctx)
    if (v.ok) good.push(r); else notes.push(`${r.from} rejected: ${v.problems.join('; ')}`)
  }
  const withH = good.filter(r => r.dims.heightMm)
  const agreed = withH.filter(r => withH.some(o => o !== r && near(o.dims.heightMm!, r.dims.heightMm!)))
  const basis = agreed.length ? agreed : withH.length ? [withH[0]] : good
  if (!basis.length) {
    const est = estimateDims({ pages: ctx.pages, binding: ctx.binding, coverAspect: ctx.coverAspect })
    return { dims: est, source: ctx.coverAspect ? 'cover' : 'estimate', confidence: 'low', notes: [...notes, ctx.coverAspect ? 'shape from the cover, size from the page count' : 'worked out from the page count'] }
  }
  const avg = (k: keyof Dims) => {
    const vs = basis.map(r => r.dims[k]).filter((v): v is number => !!v)
    return vs.length ? round(vs.reduce((a, b) => a + b, 0) / vs.length) : undefined
  }
  const est = estimateDims({ pages: ctx.pages, binding: ctx.binding, coverAspect: ctx.coverAspect })
  const h = avg('heightMm'), w = avg('widthMm'), t = avg('thicknessMm')
  if (!h || !w || !t) notes.push(`${[!h && 'height', !w && 'width', !t && 'thickness'].filter(Boolean).join(', ')} not listed — filled from the ${ctx.coverAspect && !w ? 'cover shape and ' : ''}page count`)
  const height = h ?? est.heightMm
  return {
    dims: { heightMm: height, widthMm: w ?? (ctx.coverAspect ? round(height * ctx.coverAspect) : est.widthMm), thicknessMm: t ?? est.thicknessMm },
    source: 'measured',
    confidence: agreed.length ? 'high' : 'medium',
    notes: [...notes, `from ${basis.map(r => r.from).join(' + ')}`],
  }
}

/** Several cover pictures' proportions (width / height) → one, or null if they disagree (different editions). */
export function agreeAspect(aspects: number[]): number | null {
  const ok = aspects.filter(a => a >= 0.45 && a <= 1.3).sort((a, b) => a - b)
  if (!ok.length) return null
  const mid = ok[Math.floor(ok.length / 2)]
  // One stray picture (a fan edition, a box set) must not move the shape; the majority decides.
  const agree = ok.filter(a => near(a, mid, 0.08))
  return agree.length * 2 > ok.length || ok.length === 1 ? Math.round((agree.reduce((a, b) => a + b, 0) / agree.length) * 1000) / 1000 : null
}

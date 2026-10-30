import { APP_SCALE } from './accent'

// ─── One space for every position the app reads ──────────────────────────────
//
//  The app is drawn at APP_SCALE (a page zoom of 0.9), and a page zoom is not a
//  browser zoom. A browser zoom changes what a CSS pixel *is*, so every number
//  the page can read agrees with every length it can write. A page zoom scales
//  what is *drawn* and leaves the readings split in two:
//
//    still in the app's own units   offsetWidth, scrollTop/Height, computed
//                                   styles, ResizeObserver, documentElement.client*
//    scaled by the zoom             getBoundingClientRect, pointer clientX/Y and
//                                   pageX/Y, window scroll, innerWidth/Height,
//                                   elementFromPoint, IntersectionObserver rects
//
//  Code written in CSS pixels mixes the two without knowing: `top = rect.bottom`,
//  `(pointerY - laneTop) / hourPx`, a drag library adding a pointer delta to a
//  transform. At 0.9 each of those is 10% wrong — an event dropped on the wrong
//  half hour, a menu opened beside the thing it belongs to.
//
//  So the scaled half is divided back, once, here, before anything else runs
//  (this is the first import in main.tsx). Everything the app and its libraries
//  read is then in the units the CSS is written in, and none of them has to know.
//  Measured against a 100% render of the same actions: scripts/app-is-at-90.mjs.

declare global { interface Window { __zoomSpace?: number } }

function install(scale: number): void {
  if (scale === 1 || typeof window === 'undefined' || window.__zoomSpace) return
  window.__zoomSpace = scale
  const k = 1 / scale
  /** The browser lays out in 1/64px steps, so a 36px control drawn at 0.9 is 32.390625 and
   *  divides back to 35.9896 — and every `>= 36` test in the app calls it too small. Sizes in
   *  this app are whole pixels far more often than not; anything within 0.02px of one is it. */
  const clean = (n: number) => { const r = Math.round(n); return Math.abs(n - r) < 0.02 ? r : Math.round(n * 1e4) / 1e4 }

  const rect = (r: DOMRectReadOnly) => new DOMRect(clean(r.x * k), clean(r.y * k), clean(r.width * k), clean(r.height * k))
  const rects = (list: DOMRectList) => {
    const out = Array.from(list, rect)
    return Object.assign(out, { item: (i: number) => out[i] ?? null }) as unknown as DOMRectList
  }

  const el = Element.prototype
  const gBCR = el.getBoundingClientRect, gCR = el.getClientRects
  el.getBoundingClientRect = function () { return rect(gBCR.call(this)) }
  el.getClientRects = function () { return rects(gCR.call(this)) }

  const rg = Range.prototype
  const rBCR = rg.getBoundingClientRect, rCR = rg.getClientRects
  rg.getBoundingClientRect = function () { return rect(rBCR.call(this)) }
  rg.getClientRects = function () { return rects(rCR.call(this)) }

  /** Redefine a numeric getter on a prototype to read through `k`. */
  const scaled = (proto: object, names: string[]) => {
    for (const name of names) {
      const d = Object.getOwnPropertyDescriptor(proto, name)
      if (!d?.get) continue
      const get = d.get
      Object.defineProperty(proto, name, { ...d, get() { return clean((get.call(this) as number) * k) } })
    }
  }
  scaled(MouseEvent.prototype, ['clientX', 'clientY', 'pageX', 'pageY', 'x', 'y'])
  if (typeof Touch !== 'undefined') scaled(Touch.prototype, ['clientX', 'clientY', 'pageX', 'pageY'])
  // Own accessors of the window object itself, not of Window.prototype.
  for (const name of ['innerWidth', 'innerHeight', 'scrollX', 'scrollY', 'pageXOffset', 'pageYOffset'] as const) {
    const d = Object.getOwnPropertyDescriptor(window, name)
    if (!d?.get) continue
    const get = d.get
    Object.defineProperty(window, name, { ...d, get() { return clean((get.call(window) as number) * k) } })
  }

  // Scrolling the window is addressed in the same units it is read in.
  const wScrollTo = window.scrollTo.bind(window), wScrollBy = window.scrollBy.bind(window)
  const unscale = (a: unknown, b?: number): [number, number] | ScrollToOptions => {
    if (typeof a === 'object' && a) {
      const o = a as ScrollToOptions
      return { ...o, left: o.left != null ? o.left * scale : o.left, top: o.top != null ? o.top * scale : o.top }
    }
    return [(a as number) * scale, (b ?? 0) * scale]
  }
  window.scrollTo = ((a?: unknown, b?: number) => { const r = unscale(a, b); Array.isArray(r) ? wScrollTo(r[0], r[1]) : wScrollTo(r) }) as typeof window.scrollTo
  window.scroll = window.scrollTo
  window.scrollBy = ((a?: unknown, b?: number) => { const r = unscale(a, b); Array.isArray(r) ? wScrollBy(r[0], r[1]) : wScrollBy(r) }) as typeof window.scrollBy

  // Hit-testing takes the same coordinates a pointer event reports.
  const efp = Document.prototype.elementFromPoint, efps = Document.prototype.elementsFromPoint
  Document.prototype.elementFromPoint = function (x: number, y: number) { return efp.call(this, x * scale, y * scale) }
  Document.prototype.elementsFromPoint = function (x: number, y: number) { return efps.call(this, x * scale, y * scale) }

  if (typeof IntersectionObserverEntry !== 'undefined') {
    for (const name of ['boundingClientRect', 'intersectionRect', 'rootBounds'] as const) {
      const d = Object.getOwnPropertyDescriptor(IntersectionObserverEntry.prototype, name)
      if (!d?.get) continue
      const get = d.get
      Object.defineProperty(IntersectionObserverEntry.prototype, name, {
        ...d, get() { const r = get.call(this) as DOMRectReadOnly | null; return r ? rect(r) : r },
      })
    }
  }
}

install(APP_SCALE)

/** For a test: has the layer been installed, and at what scale. */
export const zoomSpaceScale = (): number | undefined => (typeof window === 'undefined' ? undefined : window.__zoomSpace)

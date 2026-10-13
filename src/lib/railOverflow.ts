import { useCallback, useEffect, useRef } from 'react'

/**
 *  ─── Does a one-line filter rail have more to the right? ────────────────────
 *
 *  `.mail-filter-rail` scrolls sideways with its scrollbar hidden — 15px of
 *  furniture under a 27px row that appears and disappears as counts change —
 *  so the `mask-image` fade at its right edge is the only thing that says
 *  there is more. A fade that is always drawn is just a dimmed last pill, so
 *  it is drawn only while something is behind it (`data-overflow`) and only
 *  until you have scrolled to it (`data-at-end`).
 *
 *  **One hook, two rails.** The smart view's rail and the flat list's are the
 *  same object with the same stylesheet rules behind it; the measurement lived
 *  in `InboxModule` and the smart view therefore had no fade at all. Two
 *  copies of one answer drift, and this one is about a CSS rule neither file
 *  owns.
 *
 *  `watch` re-measures when the *contents* change rather than the box: a count
 *  going from 9 to 10 widens a pill without resizing the rail.
 */
export function useRailOverflow(watch?: unknown) {
  const ref = useRef<HTMLDivElement | null>(null)

  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    const more = el.scrollWidth > el.clientWidth + 2
    el.toggleAttribute('data-overflow', more)
    el.toggleAttribute('data-at-end', el.scrollLeft + el.clientWidth >= el.scrollWidth - 2)
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    measure()
    // The column changes width when the reader opens, so one measurement at
    // mount is the wrong number by lunch.
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    el.addEventListener('scroll', measure, { passive: true })
    return () => { ro.disconnect(); el.removeEventListener('scroll', measure) }
  }, [measure, watch])

  return ref
}

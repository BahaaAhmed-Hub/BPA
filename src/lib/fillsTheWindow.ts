import { useLayoutEffect, useRef, useState } from 'react'

/**
 * How tall a thing may be, **measured**, not guessed at.
 *
 * `height: 100%` is no use where the parent is sized to its content: a
 * percentage against an `auto` height is ignored, so the box falls back to its
 * own content and grows — and the scroll then belongs to whatever ancestor
 * does have `overflow: auto`, usually the page. That is how the Financials
 * table scrolled away when you scrolled its entries panel: `ActiveModule`
 * renders each module in a bare `<div>` with no height, so Finance's
 * `height: 100%` resolved to auto, the module came out 67px taller than
 * `<main>`, and `<main>` became the scroller for the whole screen. The panel's
 * own `overflowY: auto` never fired, because its content fitted the box it had
 * grown to.
 *
 * A `calc(100vh - 212px)` in its place would be a guess about the height of
 * every bar above it — the mistake the calendar panel made, which put its
 * footer below the fold. So ask where the box actually starts and take the
 * rest of the window, and ask again whenever the window changes.
 *
 * @param min  never shorter than this, so a mis-measurement is not a sliver.
 * @param gap  leave this much under it.
 */
export function useFillsTheWindow<T extends HTMLElement = HTMLDivElement>(min = 260, gap = 0) {
  const ref = useRef<T>(null)
  const [height, setHeight] = useState<number>()

  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current
      if (!el) return
      const top = el.getBoundingClientRect().top
      setHeight(Math.max(min, window.innerHeight - top - gap))
    }
    measure()
    window.addEventListener('resize', measure)
    // The bars above it can change height without the window doing anything —
    // a banner appearing, a filter rail wrapping — and then the box is the
    // wrong size until you resize. Watching the document catches that.
    const ro = new ResizeObserver(measure)
    if (document.body) ro.observe(document.body)
    return () => { window.removeEventListener('resize', measure); ro.disconnect() }
  }, [min, gap])

  return { ref, height }
}

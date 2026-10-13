import { useLayoutEffect, useRef } from 'react'
import { CoverArt } from './CoverArt'
import type { Book } from './types'

/**
 * The picked book travelling from its place on the shelf to its place in the
 * panel — turning from spine-on to face-on as it comes. It is a clone drawn
 * `fixed` and moved with a transform only (translate + scale + rotateY), so it
 * costs the compositor and nothing else; the real cover in the panel stays
 * hidden until this lands, and there is never a frame with two.
 *
 * Reduced motion skips it outright: the panel simply appears.
 */
export function BookFlight({ book, from, onDone }: { book: Book; from: DOMRect; onDone: () => void }) {
  const el = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const node = el.current
    const target = document.querySelector<HTMLElement>('[data-book-cover-target]')
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!node || !target || reduce) { onDone(); return }

    const to = target.getBoundingClientRect()
    if (!to.width) { onDone(); return }
    // Sized and placed at the target here, not at render: on a first pick the
    // panel has only just mounted and there was nothing to measure.
    Object.assign(node.style, { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px` })
    const dx = from.left - to.left, dy = from.top - to.top
    const sx = from.width / to.width, sy = from.height / to.height

    const anim = node.animate([
      { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy}) rotateY(-70deg)`, opacity: 0.95 },
      { transform: 'translate(0, 0) scale(1, 1) rotateY(0deg)', opacity: 1 },
    ], { duration: 520, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' })
    anim.onfinish = onDone
    return () => anim.cancel()
    // `from` is measured once, at the tap; the flight is not re-run for a re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div aria-hidden style={{ position: 'fixed', inset: 0, zIndex: 1250, pointerEvents: 'none', perspective: 900 }}>
      <div ref={el} style={{
        position: 'fixed', left: from.left, top: from.top, width: from.width, height: from.height,
        transformOrigin: 'top left', willChange: 'transform',
      }}>
        <CoverArt book={book} style={{ width: '100%', height: '100%', aspectRatio: 'auto' }} />
      </div>
    </div>
  )
}

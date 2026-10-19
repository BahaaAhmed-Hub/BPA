import { useLayoutEffect, useRef } from 'react'
import gsap from 'gsap'
import { Flip } from 'gsap/Flip'

gsap.registerPlugin(Flip)

// Children marked `data-flip-id` glide to their new place when `signature`
// changes. React has moved the DOM by the time an effect can run, so the
// positions are read after every commit and replayed on the next one.
// `snap` re-lays without animating (a window being dragged re-packs on every
// frame; a glide per frame is a smear). prefers-reduced-motion always snaps.
export function useFlip<T extends HTMLElement>(signature: string, snap = false) {
  const ref = useRef<T>(null)
  const last = useRef<Flip.FlipState | null>(null)
  const settled = useRef(true)
  const snapNow = useRef(snap)
  snapNow.current = snap

  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    const items = root.querySelectorAll('[data-flip-id]')
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const record = () => { last.current = Flip.getState(items); settled.current = true }

    if (last.current && !reduce && !snapNow.current) {
      settled.current = false
      Flip.from(last.current, {
        targets: items,
        duration: 0.4,
        ease: 'power2.out',
        absolute: true,
        onEnter: els => gsap.fromTo(els, { opacity: 0 }, { opacity: 1, duration: 0.25 }),
        onComplete: record,
        onInterrupt: record,
      })
    } else {
      record()
    }
    return () => { if (!settled.current) Flip.killFlipsOf(items) }
  }, [signature])

  return ref
}

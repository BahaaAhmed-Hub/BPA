import { useSyncExternalStore } from 'react'

// ─── Is the window narrow? ───────────────────────────────────────────────────
// One answer to "is this a phone-width window", read from the media query
// rather than measured, so it is right on first paint and follows a rotation.
// The Library had the only copy; this is it, lifted, so a second screen that
// needs to rearrange itself does not write a third.

/** Under this a 300px side panel leaves a phone ~90px of what it sits beside. */
export const NARROW_PX = 760

export function useNarrow(maxWidth: number = NARROW_PX): boolean {
  const query = () => window.matchMedia(`(max-width: ${maxWidth}px)`)
  return useSyncExternalStore(
    cb => { const mq = query(); mq.addEventListener('change', cb); return () => mq.removeEventListener('change', cb) },
    () => query().matches,
    () => false,
  )
}

/**
 * How wide the assistant's floating window is, and that it stays that wide.
 *
 * The window is anchored to the bottom-right corner above the assistant's
 * button, so widening it means dragging its LEFT edge further left. The width
 * the person last chose is theirs: it is kept per device (a laptop and a phone
 * have nothing to say to each other about how much of the screen a chat
 * deserves) and is only ever bent to fit — a stored 800 on a 600px window is
 * drawn at what fits, and comes back to 800 on a screen that can hold it.
 */
export const WIDTH_KEY = 'assistant-window-width'
export const DEFAULT_WIDTH = 420
export const MIN_WIDTH = 340
export const MAX_WIDTH = 860
/** Air kept between the window and the viewport's left edge. */
const LEFT_GAP = 12

/** How far in from the right edge the window sits: the button's own margin, tighter on a phone. */
export function rightGap(viewportW: number): number {
  return viewportW < 480 ? 12 : 24
}

/** The widest it may be on a viewport this wide: never wider than the cap, never past the left edge. */
export function maxFor(viewportW: number): number {
  return Math.max(0, Math.min(MAX_WIDTH, Math.floor(viewportW) - rightGap(viewportW) - LEFT_GAP))
}

/** The narrowest it may be — the usable minimum, unless the screen itself is narrower. */
export function minFor(viewportW: number): number {
  return Math.min(MIN_WIDTH, maxFor(viewportW))
}

/** `w` bent into what this viewport allows. Not a number is the default, not zero. */
export function clampWidth(w: number, viewportW: number): number {
  const n = Number.isFinite(w) ? w : DEFAULT_WIDTH
  return Math.round(Math.min(maxFor(viewportW), Math.max(minFor(viewportW), n)))
}

/**
 * What the person chose last, exactly as chosen — NOT bent to this screen. The
 * window is drawn through `clampWidth`, so a phone shows what fits while the
 * choice itself survives to the next screen that can hold it.
 */
export function loadChosenWidth(): number {
  try {
    const raw = localStorage.getItem(WIDTH_KEY)
    if (raw !== null) {
      const n = Number(raw)
      // `Number('')` is 0 and `Number(null)` is 0: an empty or junk value is "never chose", not "chose 0".
      if (Number.isFinite(n) && n > 0) return n
    }
  } catch { /* storage can throw in a private window — the default is the answer */ }
  return DEFAULT_WIDTH
}

/** What the person chose last, bent to fit now. */
export function loadWidth(viewportW: number): number {
  return clampWidth(loadChosenWidth(), viewportW)
}

/** Keep the choice — the clamped number the person saw, never a raw pointer position. */
export function saveWidth(w: number): void {
  try { localStorage.setItem(WIDTH_KEY, String(Math.round(w))) } catch { /* nothing to do */ }
}

/**
 * The width after a drag of the left edge. Moving the pointer left (x smaller)
 * widens the window, because the right edge is the one that is fixed.
 */
export function widthFromDrag(startW: number, startX: number, x: number, viewportW: number): number {
  return clampWidth(startW + (startX - x), viewportW)
}

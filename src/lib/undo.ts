// ─── Taking it back ──────────────────────────────────────────────────────────
//
// Everything in this app writes the moment you touch it: no Save button, no
// dialog asking whether you meant it. That is the right trade — until the
// gesture was a mistake, and there was nothing between a slipped finger and a
// deleted task.
//
// So every destructive or wholesale action registers how to reverse itself
// before it happens. What is stored is not a diff but a **snapshot of what was
// there** — the whole task list, the event's old times, the entry as it stood.
// A diff has to be right about every field it does not mention; a snapshot only
// has to be put back.
//
// Two ways in: the bar that appears in the corner naming what just happened,
// and ⌘Z / Ctrl-Z anywhere that is not a text field. Inside a text field the
// browser's own undo is better than anything here, so it is left alone — and
// the panel's edits are coalesced into one entry per burst of typing, so ⌘Z
// after clicking away takes back the sentence rather than the last letter.
//
// There is no redo. Redoing means an inverse of the inverse, and every action
// here would need to describe one; saying so is better than a Cmd-Shift-Z that
// works in three places out of thirty.

export interface UndoEntry {
  id: string
  /** What it says on the bar: "Deleted 'Renew the passport'". */
  label: string
  at: number
  run: () => void | Promise<void>
  /** Successive edits sharing a key inside the window are one entry. */
  coalesceKey?: string
}

/** Deep enough for a session's mistakes, shallow enough not to hold the whole
 *  task list a hundred times over. */
const LIMIT = 40

/** How long a burst of typing stays one entry. */
const COALESCE_MS = 2_500

const stack: UndoEntry[] = []
const listeners = new Set<() => void>()

function announce() { listeners.forEach(l => l()) }

export function subscribeUndo(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** While this is running, nothing registers itself. Wrap the many small writes
 *  a bulk action makes, having remembered the state once beforehand, so taking
 *  it back is one ⌘Z rather than forty. */
let quiet = 0
export function suppressUndo<T>(fn: () => T): T {
  quiet++
  try { return fn() } finally { quiet-- }
}

export function undoStack(): readonly UndoEntry[] { return stack }
export function topUndo(): UndoEntry | null { return stack[stack.length - 1] ?? null }

/**
 *  Register how to take back what is about to happen.
 *
 *  Call it *before* the change, with a closure over the state as it is now.
 *  `coalesceKey` folds a burst — a title being typed, a slider being dragged —
 *  into the single entry that restores the state before the burst began.
 */
export function pushUndo(
  label: string,
  run: () => void | Promise<void>,
  opts: { coalesceKey?: string } = {},
): void {
  if (quiet > 0) return
  const top = stack[stack.length - 1]
  if (opts.coalesceKey && top?.coalesceKey === opts.coalesceKey && Date.now() - top.at < COALESCE_MS) {
    // Keep the *older* run — it restores further back, which is what a person
    // means by undoing what they just typed.
    top.label = label
    top.at = Date.now()
    announce()
    return
  }
  stack.push({ id: crypto.randomUUID(), label, at: Date.now(), run, coalesceKey: opts.coalesceKey })
  if (stack.length > LIMIT) stack.shift()
  announce()
}

/** Take back the last one. Returns what it was, or null if there was nothing. */
export async function undoLast(): Promise<UndoEntry | null> {
  const entry = stack.pop()
  announce()
  if (!entry) return null
  try { await entry.run() } catch (e) { console.warn('undo failed', e) }
  return entry
}

export function dropUndo(id: string): void {
  const i = stack.findIndex(e => e.id === id)
  if (i >= 0) { stack.splice(i, 1); announce() }
}

export function clearUndo(): void {
  stack.length = 0
  announce()
}

/** A line in the same corner that is not about undoing anything — "could not
 *  add that to your calendar". Transient, and never blocks. */
export function notify(text: string): void {
  window.dispatchEvent(new CustomEvent('professor:notify', { detail: text }))
}

/** Where the caret is decides whose undo this is. */
export function inTextField(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return (el as HTMLElement).isContentEditable === true
}

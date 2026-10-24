// ─── Asking, without the browser's pop-ups ───────────────────────────────────
// `window.confirm` and `window.prompt` are unthemed, block the page, cannot be
// styled or tested, and read as a different app. This is the same question put
// by the app: `await askConfirm({...})` / `await askText({...})`, answered by
// the ConfirmHost mounted once in App.
//
// A destructive action that CAN be reversed should not ask at all — it does the
// thing and registers an undo (src/lib/undo.ts). This is for the ones that
// cannot be taken back (a Google Calendar delete, a bulk rewrite of the ledger)
// and for the two places that genuinely need a typed answer.

export interface ConfirmOptions {
  title: string
  body?: string
  confirmLabel?: string
  cancelLabel?: string
  /** The confirm button is the destructive kind (default true). */
  danger?: boolean
}

export interface TextOptions {
  title: string
  body?: string
  label: string
  placeholder?: string
  confirmLabel?: string
  /** Empty answers are refused until this is false. Default true. */
  required?: boolean
  type?: 'text' | 'url'
}

export type AskRequest =
  | { kind: 'confirm'; opts: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: 'text'; opts: TextOptions; resolve: (answer: string | null) => void }

type Listener = (r: AskRequest | null) => void
let listener: Listener | null = null
const queue: AskRequest[] = []

/** The host calls this once; returns its cleanup. */
export function attachAskHost(fn: Listener): () => void {
  listener = fn
  if (queue.length) fn(queue[0])
  return () => { if (listener === fn) listener = null }
}

/** The host calls this when the current question is answered. */
export function nextAsk(): AskRequest | null {
  queue.shift()
  return queue[0] ?? null
}

function enqueue(r: AskRequest) {
  queue.push(r)
  if (queue.length === 1) listener?.(r)
}

/** Resolves true on the confirm button, false on Cancel, Escape or the scrim. */
export function askConfirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise(resolve => enqueue({ kind: 'confirm', opts, resolve }))
}

/** Resolves with the trimmed text, or null if it was cancelled. */
export function askText(opts: TextOptions): Promise<string | null> {
  return new Promise(resolve => enqueue({ kind: 'text', opts, resolve }))
}

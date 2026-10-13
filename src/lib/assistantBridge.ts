// ─── Asking the assistant from somewhere else ────────────────────────────────
// The search box, the voice listener and a deep link all want to say "ask the
// assistant this". The panel is mounted once in App and may be closed, so the
// request is *parked* and taken by whoever is listening — now, or when the panel
// next mounts or opens (the open-book request in `libraryPrefs` works the same way).
export interface AskRequest {
  /** What to ask. Empty means "I'm here": open the panel and wait. */
  text: string
  /** It was spoken, so the answer should be too (if the person has that on). */
  spoken: boolean
}

export const ASK_EVENT = 'professor:askAssistant'
let pending: AskRequest | null = null

export function askAssistant(req: AskRequest): void {
  pending = req
  window.dispatchEvent(new Event(ASK_EVENT))
}

export function takePendingAsk(): AskRequest | null {
  const r = pending
  pending = null
  return r
}

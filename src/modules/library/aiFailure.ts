// ─── Why a model call failed, in words a person can act on ───────────────────
// Shared by everything in the Library that asks Claude something. The status is
// the SDK's; the sentence says where to fix it, because "401" means nothing on a
// phone and "check Settings → AI" does.

/** Thrown for a failure the screen can say out loud. */
export class AiFailure extends Error {}

export function describeAiFailure(e: unknown, whatItWasDoing: string, fallbackHint: string): AiFailure {
  if (e instanceof AiFailure) return e
  const status = (e as { status?: number })?.status
  return new AiFailure(
    status === 401 || status === 403 ? 'Your Anthropic key was refused. Check it under Settings → AI.'
    : status === 429 ? `The AI service is rate-limited right now. Try again in a minute. ${fallbackHint}`.trim()
    : status === 400 ? `The AI service refused this request. ${fallbackHint}`.trim()
    : `${whatItWasDoing} did not work just now — the AI service did not answer. ${fallbackHint}`.trim(),
  )
}

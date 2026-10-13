// ─── What the person calls the assistant — the bots' copy ────────────────────
// Pure (no Deno), so the test runs the real module. The app's rule is
// `src/lib/assistantName.ts` (`cleanName`); Deno cannot import the bundle, so it
// is restated here and `scripts/assistant-name-agrees.mjs` runs both over the
// same inputs. The name goes into a system prompt, so it is cleaned: letters,
// digits, spaces and a few name punctuation marks, 24 characters at most — a
// name with a newline and an instruction in it is not a name.
export const NAME_MAX = 24

export function cleanName(raw: string): string {
  const t = (raw ?? '').normalize('NFKC').replace(/[^\p{L}\p{N}\s'’.-]/gu, '').replace(/\s+/g, ' ').trim()
  return t.slice(0, NAME_MAX).trim()
}

/** The name out of `users.schedule_rules.shared_prefs`, or '' when there is none. */
export function personaName(bag: Record<string, string> | undefined | null): string {
  const raw = bag?.['assistant-persona']
  if (typeof raw !== 'string') return ''
  try {
    const p = JSON.parse(raw) as { name?: unknown }
    return typeof p.name === 'string' ? cleanName(p.name) : ''
  } catch { return '' }
}

/** The sentence added to a prompt; empty when the person has not named it. */
export const calledLine = (name: string): string =>
  name ? ` The user calls you ${name}; answer to that name and, if asked who you are, say it.` : ''

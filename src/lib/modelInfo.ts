/**
 * Which model the assistant is, said once.
 *
 * The panel header used to print "Anthropic · Claude" — true of every Claude
 * model and so of none in particular — while the request itself named
 * `claude-sonnet-4-6` in two other files. A label that does not read the same
 * constant the request reads can drift from it without anything failing, so the
 * id lives here and both the call and the badge take it from here.
 */
export const ASSISTANT_CLAUDE_MODEL = 'claude-sonnet-4-6'

export type ModelMarkKind = 'claude' | 'groq' | 'other'

export interface ModelInfo {
  /** Which mark to draw. */
  mark: ModelMarkKind
  vendor: string
  /** "Sonnet", "Llama" — the name without the number. */
  family: string
  /** "4.6", "3.3" — empty when the id carries none. */
  version: string
  /** What the header shows: "Sonnet 4.6", "Llama 3.3 70B". */
  label: string
  /** The id exactly as sent. */
  id: string
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** `claude-sonnet-4-6` and `claude-sonnet-4-5-20250929` are 4.6 and 4.5; `claude-3-5-sonnet-20241022` is 3.5. A date is never a minor version. */
function claudeParts(id: string): { family: string; version: string } | null {
  const m = /^claude-(opus|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?(?:-|$)/.exec(id)
  if (m) return { family: m[1], version: m[3] !== undefined ? `${m[2]}.${m[3]}` : m[2] }
  const old = /^claude-(\d+)(?:-(\d{1,2}))?-(opus|sonnet|haiku)(?:-|$)/.exec(id)
  if (old) return { family: old[3], version: old[2] !== undefined ? `${old[1]}.${old[2]}` : old[1] }
  return null
}

/** Words an open-weights id carries that say nothing a person reads. */
const NOISE = new Set(['versatile', 'instant', 'preview', 'it', 'chat', 'instruct', 'latest', 'tool', 'use'])

/** Letters that are an initialism, not a word: "gpt-oss" is GPT OSS, not "Gpt Oss". */
const ACRONYMS = new Set(['gpt', 'oss', 'moe', 'vl'])

function openParts(id: string): { family: string; version: string; label: string } {
  // "openai/gpt-oss-120b", "meta-llama/llama-4-scout-17b-16e-instruct": the part before the slash is who published it,
  // which the header already says with its mark. Showing it made "Openai/gpt Oss 120B".
  const base = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id
  const tokens = base.toLowerCase().split('-').filter(Boolean)
  const shown: string[] = []
  let version = ''
  for (const t of tokens) {
    if (NOISE.has(t) || /^\d{4,}$/.test(t)) continue                       // "versatile", a 32768-token context window
    if (/^\d+(\.\d+)?$/.test(t)) { if (!version) version = t; shown.push(t); continue }
    if (/^(\d+x)?\d+(\.\d+)?b$/.test(t)) { shown.push(t.toUpperCase()); continue }   // 70b → 70B, 8x7b → 8X7B
    shown.push(ACRONYMS.has(t) ? t.toUpperCase() : cap(t))
  }
  const label = shown.join(' ').replace(/(\d)X(\d)/g, '$1x$2')
  return { family: tokens.length ? cap(tokens[0]) : id, version, label: label || id }
}

/** What to show for the model in use. `provider` decides the mark; the id decides the words. */
export function describeModel(provider: 'anthropic' | 'groq', id: string): ModelInfo {
  if (provider === 'anthropic') {
    const c = claudeParts(id)
    if (c) return { mark: 'claude', vendor: 'Anthropic', family: cap(c.family), version: c.version, label: `${cap(c.family)} ${c.version}`, id }
    // An id this does not recognise is shown as itself: an invented name is a wrong answer.
    return { mark: 'claude', vendor: 'Anthropic', family: 'Claude', version: '', label: id, id }
  }
  const o = openParts(id)
  return { mark: 'groq', vendor: 'Groq', family: o.family, version: o.version, label: o.label, id }
}

// ─── What a quote means, and what to do with it ──────────────────────────────
// Asks Claude (the key in Settings → AI) to explain a passage the person has
// saved. Opt-in, one quote at a time: it costs a model call, and the answer is
// stored on the quote so it is paid for once.
//
// **Grounded in what was given, not in the book.** The model is handed the
// passage, the title and author, and the person's own notes on that quote —
// nothing else — and told not to invent context from the book it cannot see. A
// confident explanation of a chapter it never read is the failure this is built
// against, so "apply" is about the *idea* in the words, and the screen labels the
// whole thing as an AI explanation.
import { anthropic, anthropicKey } from '@/lib/professor'
import { AiFailure, describeAiFailure } from './aiFailure'
import { activeClaudeModel } from '@/lib/modelInfo'

export interface Explanation {
  /** Two or three plain sentences on what the passage is saying. */
  meaning: string
  /** Concrete things to try — each short enough to become a task (2e). */
  apply: string[]
}

const SYSTEM = `You explain a passage someone saved from a book they are reading.

You are given the passage, the book's title and author, and sometimes the reader's own notes on it. You have NOT read the book. Explain only what the words say.

Rules:
- "meaning": two or three plain sentences saying what the passage claims or asks of the reader. No praise, no preamble, no "this quote".
- "apply": two or three concrete, specific things the reader could do this week, each one short enough to be a to-do item and starting with a verb. Base them on the idea in the passage and on the reader's notes if there are any.
- Do NOT invent context from the book (chapters, characters, what comes before or after). If the passage is too short or ambiguous to explain well, say so in "meaning" and give fewer, more general actions.
- If the reader's notes disagree with a reading of the passage, respect the notes.

Reply with ONLY a JSON object, no other words:
{"meaning": string, "apply": string[]}`

export async function explainQuote(input: { text: string; title: string; authors: string[]; notes: string[] }): Promise<Explanation> {
  if (!anthropicKey()) {
    throw new AiFailure('Add an Anthropic key under Settings → AI to have quotes explained.')
  }
  const prompt = [
    `Book: ${input.title}${input.authors.length ? ` — ${input.authors.join(', ')}` : ''}`,
    `Passage: “${input.text}”`,
    input.notes.length ? `The reader's notes on it:\n${input.notes.map(n => `- ${n}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n')

  let raw = ''
  try {
    const msg = await anthropic().messages.create({
      model: activeClaudeModel(), max_tokens: 700, system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    })
    raw = msg.content.find(b => b.type === 'text')?.text ?? ''
  } catch (e) {
    throw describeAiFailure(e, 'The explanation', '')
  }
  const out = parseExplanation(raw)
  if (!out) throw new AiFailure('The AI service answered, but not in a form that could be read. Try again.')
  return out
}

/** `null` when it is not an explanation — an empty or malformed reply must not be
 *  stored as one, or the board shows a blank "explained" card with no way to ask again. */
export function parseExplanation(raw: string): Explanation | null {
  const cleaned = raw.trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim()
  try {
    const j = JSON.parse(cleaned) as { meaning?: unknown; apply?: unknown }
    const meaning = typeof j.meaning === 'string' ? j.meaning.trim() : ''
    const apply = Array.isArray(j.apply) ? j.apply.filter((a): a is string => typeof a === 'string' && !!a.trim()).map(a => a.trim()).slice(0, 5) : []
    return meaning ? { meaning, apply } : null
  } catch { return null }
}

/** What is stored on the quote — and what is read back. A hand-edited or older
 *  value that is not JSON is shown as plain meaning rather than lost. */
export const serializeExplanation = (e: Explanation): string => JSON.stringify(e)
export function readExplanation(stored: string | null | undefined): Explanation | null {
  if (!stored) return null
  return parseExplanation(stored) ?? { meaning: stored, apply: [] }
}

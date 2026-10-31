// ─── Writing a book summary with Claude ──────────────────────────────────────
// The key from Settings → AI, the same client the rest of the Library uses. An
// outline first, then one request per section; every step is handed to
// `onUpdate` so the caller saves it, and a failure partway leaves what was
// already written. Nothing here knows about the screen or the database.
import { anthropic, anthropicKey } from '@/lib/professor'
import { activeClaudeModel } from '@/lib/modelInfo'
import { AiFailure, describeAiFailure } from './aiFailure'
import {
  LENGTHS, OUTLINE_SYSTEM, SECTION_SYSTEM, cleanSection, outlinePrompt, parseOutline, sectionPrompt, sectionTokens,
  trimToSentence, type SummaryBook, type SummaryDoc, type SummaryLength,
} from './summaryPlan'

export interface WriteOptions {
  book: SummaryBook
  length: SummaryLength
  /** A partly written summary of the same length to carry on from. */
  resume?: SummaryDoc | null
  /** Called with the whole document after the outline and after every section — save it. */
  onUpdate: (doc: SummaryDoc) => void | Promise<void>
  /** Called as a section begins: 0-based index and the number planned. */
  onStep?: (index: number, total: number) => void
  signal?: AbortSignal
}

async function ask(system: string, user: string, maxTokens: number, signal?: AbortSignal): Promise<{ text: string; truncated: boolean }> {
  try {
    const msg = await anthropic().messages.create(
      { model: activeClaudeModel(), max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] },
      { signal },
    )
    return { text: msg.content.find(b => b.type === 'text')?.text ?? '', truncated: msg.stop_reason === 'max_tokens' }
  } catch (e) {
    throw describeAiFailure(e, 'The summary', 'What was written so far is kept — you can continue it.')
  }
}

/**
 * Returns the document as far as it got. Stopping (the signal) returns a partial one;
 * a failure throws an `AiFailure` — the caller already holds everything `onUpdate` saw.
 */
export async function writeSummary(o: WriteOptions): Promise<SummaryDoc> {
  if (!anthropicKey()) throw new AiFailure('Add an Anthropic key under Settings → AI to have a summary written.')
  const plan = LENGTHS[o.length]
  let doc: SummaryDoc = o.resume && o.resume.length === o.length && o.resume.outline.length
    ? o.resume
    : { bookId: o.book.id, length: o.length, premise: '', outline: [], sections: [], model: '', updatedAt: new Date().toISOString() }

  if (!doc.outline.length) {
    const { text } = await ask(OUTLINE_SYSTEM, outlinePrompt(o.book, plan), 1200, o.signal)
    const outline = parseOutline(text, plan.sections)
    if (!outline) throw new AiFailure('The AI service answered, but not in a form that could be read. Try again.')
    if ('unknown' in outline) {
      throw new AiFailure('The AI does not know this book well enough to summarise it without inventing things, so it wrote nothing. Adding the publisher’s blurb under About gives it more to go on.')
    }
    doc = { ...doc, premise: outline.premise, outline: outline.sections, model: activeClaudeModel(), updatedAt: new Date().toISOString() }
    await o.onUpdate(doc)
  }

  for (let i = doc.sections.length; i < doc.outline.length; i++) {
    if (o.signal?.aborted) break
    o.onStep?.(i, doc.outline.length)
    let reply: { text: string; truncated: boolean }
    try { reply = await ask(SECTION_SYSTEM, sectionPrompt(o.book, doc, i, plan), sectionTokens(plan), o.signal) }
    catch (e) { if (o.signal?.aborted) break; throw e }
    const text = cleanSection(trimToSentence(reply.text, reply.truncated))
    // An empty section is not saved: it would read as written, and the loop would never ask again.
    if (!text) throw new AiFailure('The AI service answered a section with nothing in it. Try continuing.')
    doc = { ...doc, sections: [...doc.sections, { title: doc.outline[i].title, text }], updatedAt: new Date().toISOString() }
    await o.onUpdate(doc)
  }
  return doc
}

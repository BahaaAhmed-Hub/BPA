// ─── Reading a photographed page ─────────────────────────────────────────────
// A photo of a page goes to Claude vision, which returns the passage as text.
// It uses the key in Settings → AI like everything else here — there is no
// second key and nothing server-side.
//
// **The result is a draft, never a fact.** A model reading a phone photo of a
// curved page gets words wrong, so the caller shows it beside the photo to be
// checked, and every failure here is a message the screen can say: the quote
// can always still be typed by hand.
import { anthropic, anthropicKey } from '@/lib/professor'
import { AiFailure, describeAiFailure } from './aiFailure'
import { activeClaudeModel } from '@/lib/modelInfo'

export interface PassageRead {
  text: string
  /** The page number if one was printed in the shot. */
  page?: number
  /** True if the model found something marked (highlighted, underlined, boxed)
   *  and read only that; false if it read the whole page. */
  marked: boolean
}

const SYSTEM = `You transcribe text from a photograph of a book page.

If part of the page is marked — highlighted, underlined, bracketed, or boxed — transcribe ONLY the marked part. Otherwise transcribe the whole readable text on the page.

Rules:
- Copy the words exactly. Do not correct, paraphrase, summarise or complete them.
- Join lines that wrap within a paragraph into one line; keep paragraph breaks as a blank line. Remove the hyphen where a word was split across lines.
- Leave out running headers, footers and page furniture; a printed page number is reported separately.
- If a word is illegible write [illegible] rather than guessing.
- If the image contains no readable text, return an empty string.

Reply with ONLY a JSON object, no other words:
{"text": string, "page": number | null, "marked": boolean}`

/** Why it could not be read, in words the person can act on. */
export const PassageError = AiFailure

export async function readPassage(image: { data: string; mediaType: string }): Promise<PassageRead> {
  if (!anthropicKey()) {
    throw new PassageError('Add an Anthropic key under Settings → AI to have the page read for you. You can still type the quote.')
  }
  let raw = ''
  try {
    const msg = await anthropic().messages.create({
      model: activeClaudeModel(),
      max_tokens: 2000,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: image.mediaType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif', data: image.data } },
          { type: 'text', text: 'Transcribe this page.' },
        ],
      }],
    })
    raw = msg.content.find(b => b.type === 'text')?.text ?? ''
  } catch (e) {
    throw describeAiFailure(e, 'Reading the page', 'You can still type the quote.')
  }
  return parsePassage(raw)
}

/** Tolerant of a model that wraps its JSON in fences or forgets it entirely:
 *  if there is no JSON the whole reply is taken as the text, which is the more
 *  useful failure than none. */
export function parsePassage(raw: string): PassageRead {
  const cleaned = raw.trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim()
  try {
    const j = JSON.parse(cleaned) as { text?: unknown; page?: unknown; marked?: unknown }
    const page = typeof j.page === 'number' && Number.isInteger(j.page) && j.page > 0 && j.page < 10000 ? j.page : undefined
    return { text: typeof j.text === 'string' ? j.text.trim() : '', page, marked: j.marked === true }
  } catch {
    return { text: cleaned, marked: false }
  }
}

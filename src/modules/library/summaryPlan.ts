// ─── A book summary: how long, how it is planned, how it is read back ────────
// Pure — no network, no store — so the prompts and the parsing can be asserted
// without a model. `bookSummary.ts` is the part that talks to Claude.
//
// **A summary is written in sections.** One request for 9,000 words is one
// failure away from nothing, and a model asked for that much in a single reply
// drifts: the last pages restate the first. So an outline is asked for first and
// then each section on its own, handed the whole outline so it knows what the
// others cover. A failure keeps the sections already written (they are saved one
// at a time) and the rest can be continued.
//
// **It is written from what the model knows, and the screen says so.** The model
// is not given the book. The outline prompt lets it answer "I do not know this
// book" instead of inventing one, and the section prompt tells it to leave out
// any detail it is not sure of.

export type SummaryLength = 'short' | 'standard' | 'long'

/** A printed page of prose. The page counts below are words ÷ this. */
export const WORDS_PER_PAGE = 500

export interface LengthPlan {
  label: string
  /** What the person is told, and the ceiling: Long stays inside 15–20 pages. */
  pages: number
  sections: number
  wordsPerSection: number
}

export const LENGTHS: Record<SummaryLength, LengthPlan> = {
  short:    { label: 'Short',    pages: 5,  sections: 5,  wordsPerSection: 500 },
  standard: { label: 'Standard', pages: 10, sections: 8,  wordsPerSection: 625 },
  long:     { label: 'Long',     pages: 18, sections: 12, wordsPerSection: 750 },
}
export const LENGTH_ORDER: SummaryLength[] = ['short', 'standard', 'long']

export interface OutlineItem { title: string; focus: string }
export interface SummarySection { title: string; text: string }

export interface SummaryDoc {
  bookId: string
  length: SummaryLength
  premise: string
  outline: OutlineItem[]
  sections: SummarySection[]
  model: string
  updatedAt: string
}

export interface SummaryBook { id: string; title: string; authors: string[]; description?: string; publishedYear?: number }

/* ── what has been written ─────────────────────────────────────────────── */

export const wordCount = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length
export const docWords = (d: SummaryDoc): number => d.sections.reduce((n, s) => n + wordCount(s.text), 0)
export const docPages = (d: SummaryDoc): number => Math.max(1, Math.round(docWords(d) / WORDS_PER_PAGE))
/** Complete = every planned section is written. An outline alone is not a summary. */
export const isComplete = (d: SummaryDoc): boolean => d.outline.length > 0 && d.sections.length >= d.outline.length

/* ── the prompts ───────────────────────────────────────────────────────── */

export const OUTLINE_SYSTEM = `You plan a written summary of a book for someone who owns it or means to read it.

You are given the title, the author and sometimes the publisher's blurb. You do NOT have the text of the book.

Rules:
- Use only what you reliably know about this book. If you do not recognise it well enough to summarise it without inventing things, reply {"unknown": true} and nothing else.
- Plan the requested number of sections. Each has a short "title" and a "focus": one sentence on what the section covers. Follow the book's real structure (its parts, its argument, or its story arc) where you know it. Do not invent chapter numbers or chapter titles.
- "premise": one or two sentences saying what the book is and what it argues or tells.
- Write in the language of the book's title.

Reply with ONLY a JSON object, no other words:
{"premise": string, "sections": [{"title": string, "focus": string}]}
or {"unknown": true}`

export const SECTION_SYSTEM = `You write one section of a longer summary of a book. The reader has not read it and wants the substance.

You do NOT have the text of the book. You write from what you reliably know.

Rules:
- Put it in your own words. Never reproduce sentences from the book. Use at most one short quoted phrase (under 15 words) in the whole section, and only if you are certain of it.
- If you are not sure of a detail (a name, a number, a date, a quotation, a case study), leave it out. A shorter accurate section is better than a full one with invented parts.
- Write plain paragraphs separated by a blank line. No headings, no bullet lists, no Markdown, no preamble such as "In this section", and no recap of the whole book at the end.
- Do not repeat what the other sections cover. You are given the outline so you know what they are.
- Write in the language of the book's title.`

const byline = (b: SummaryBook) => `${b.title}${b.authors.length ? ` — ${b.authors.join(', ')}` : ''}${b.publishedYear ? ` (${b.publishedYear})` : ''}`

export function outlinePrompt(b: SummaryBook, plan: LengthPlan): string {
  const blurb = b.description?.trim()
  return [
    `Book: ${byline(b)}`,
    blurb ? `Publisher's blurb (it may be incomplete):\n${blurb.slice(0, 1200)}` : '',
    `Plan exactly ${plan.sections} sections.`,
  ].filter(Boolean).join('\n\n')
}

export function sectionPrompt(b: SummaryBook, doc: Pick<SummaryDoc, 'premise' | 'outline'>, i: number, plan: LengthPlan): string {
  const list = doc.outline.map((o, n) => `${n + 1}. ${o.title} — ${o.focus}`).join('\n')
  const here = doc.outline[i]
  return [
    `Book: ${byline(b)}`,
    `What the book is: ${doc.premise}`,
    `The whole summary is planned as these sections, in order:\n${list}`,
    `Write section ${i + 1} of ${doc.outline.length}: “${here.title}”.`,
    `It covers: ${here.focus}`,
    `Length: about ${plan.wordsPerSection} words.`,
  ].join('\n\n')
}

/** A token ceiling that a section of the planned length fits under with room, and no more. */
export const sectionTokens = (plan: LengthPlan): number => Math.round(plan.wordsPerSection * 2.2) + 200

/* ── reading the replies ───────────────────────────────────────────────── */

export type ParsedOutline = { unknown: true } | { premise: string; sections: OutlineItem[] }

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')

/** `null` when the reply is not an outline — it must never be stored as one. */
export function parseOutline(raw: string, max: number): ParsedOutline | null {
  const cleaned = raw.trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim()
  const body = cleaned.startsWith('{') ? cleaned : cleaned.match(/\{[\s\S]*\}/)?.[0] ?? ''
  try {
    const j = JSON.parse(body) as { unknown?: unknown; premise?: unknown; sections?: unknown }
    if (j.unknown === true) return { unknown: true }
    if (!Array.isArray(j.sections)) return null
    const sections = j.sections
      .map((s: { title?: unknown; focus?: unknown }) => ({ title: str(s?.title, 120), focus: str(s?.focus, 300) }))
      .filter(s => s.title && s.focus)
      .slice(0, max)
    const premise = str(j.premise, 600)
    return sections.length >= 2 && premise ? { premise, sections } : null
  } catch { return null }
}

const SENTENCE_END = /[.!?؟…。]["'”’)»\]]*(?=\s|$)/g

/** A reply cut off by the token ceiling ends mid-sentence; keep up to the last whole one. */
export function trimToSentence(text: string, truncated: boolean): string {
  const t = text.trim()
  if (!truncated) return t
  let last = -1
  for (const m of t.matchAll(SENTENCE_END)) last = (m.index ?? 0) + m[0].length
  return last > t.length * 0.5 ? t.slice(0, last).trim() : t
}

/** The model was told no Markdown; this is for the day it does it anyway. */
export function cleanSection(text: string): string {
  return text
    .split('\n').filter(l => !/^\s{0,3}#{1,6}\s/.test(l)).join('\n')
    .replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1')
    .replace(/\n{3,}/g, '\n\n').trim()
}

export const paragraphs = (text: string): string[] => text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)

/* ── leaving the app ───────────────────────────────────────────────────── */

export function summaryMarkdown(b: Pick<SummaryBook, 'title' | 'authors'>, d: SummaryDoc): string {
  const lines = [
    `# ${b.title} — summary`,
    '',
    `*${b.authors.join(', ') ? `${b.authors.join(', ')} · ` : ''}About ${docPages(d)} pages. An AI summary written from the model's general knowledge of the book, not from its text.*`,
    '',
    `> ${d.premise}`,
    '',
  ]
  d.sections.forEach((s, i) => { lines.push(`## ${i + 1}. ${s.title}`, '', ...paragraphs(s.text).flatMap(p => [p, '']))})
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

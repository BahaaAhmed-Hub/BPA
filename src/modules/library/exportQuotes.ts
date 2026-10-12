// ─── Quotes out of the app, as plain Markdown ────────────────────────────────
// Three destinations, one body. **Markdown** is a single file. **Obsidian** is a
// note per book with its properties in front-matter, so the vault can query by
// author or status, and a block id on every quote so another note can embed one.
// **Notion** reads the same Markdown on import or paste, so it is the single
// file again — a separate "Notion format" would be the same text with a
// different name. Nothing leaves the browser: this builds text, the person
// downloads or copies it.
//
// **What is exported is exactly what is on the board** (its filters decide), and
// the notes that belong to those quotes and books come with them. A quote with a
// photo and no words is kept as a line saying so — silently dropping it would
// make the export a count short of the screen.
import { readExplanation } from './explainQuote'
import { placeOf, type Book, type Note, type Quote } from './types'

export type ExportFormat = 'markdown' | 'obsidian' | 'notion'
export interface ExportOptions { notes: boolean; explanations: boolean }
export interface ExportInput { books: Book[]; quotes: Quote[]; notes: Note[]; marked: Set<string> }
export interface ExportFile { name: string; content: string }

const quoteBlock = (text: string) => text.split('\n').map(l => `> ${l}`.trimEnd()).join('\n')
const indent = (text: string, by = '  ') => text.split('\n').map((l, i) => (i ? by + l : l)).join('\n')

/** A file name any filesystem takes, and Obsidian can link to: the characters
 *  that break a wikilink (`# ^ [ ] |`) and a path are replaced. */
export function safeName(s: string): string {
  const n = s.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100).replace(/[. ]+$/, '')
  return n || 'Untitled'
}

const yaml = (v: string) => JSON.stringify(v)   // a JSON string is a valid YAML double-quoted scalar

function frontMatter(b: Book): string {
  const lines = ['---', `title: ${yaml(b.title)}`]
  if (b.authors.length) lines.push('author:', ...b.authors.map(a => `  - ${yaml(a)}`))
  lines.push('tags:', '  - book')
  lines.push(`status: ${yaml(b.status)}`)
  if (b.rating) lines.push(`rating: ${b.rating}`)
  if (b.isbn) lines.push(`isbn: ${yaml(b.isbn)}`)
  if (b.publishedYear) lines.push(`published: ${b.publishedYear}`)
  lines.push('---')
  return lines.join('\n')
}

function bookBody(b: Book, input: ExportInput, opts: ExportOptions, level: 1 | 2, obsidian: boolean): string {
  const h = '#'.repeat(level)
  const out: string[] = []
  out.push(`${h} ${b.title}${!obsidian && b.authors.length ? ` — ${b.authors.join(', ')}` : ''}`)
  if (obsidian && b.authors.length) out.push(`*${b.authors.join(', ')}*`)

  const qs = input.quotes.filter(q => q.bookId === b.id).sort((a, c) => (a.page ?? 1e9) - (c.page ?? 1e9) || a.createdAt.localeCompare(c.createdAt))
  for (const q of qs) {
    const place = placeOf(q)
    const tail = [place, input.marked.has(q.id) ? 'bookmarked' : ''].filter(Boolean).join(' · ')
    const lines: string[] = []
    lines.push(q.body?.trim() ? quoteBlock(q.body.trim()) : `> *(a photo of the page${place ? `, ${place}` : ''} — no text yet)*`)
    if (q.body?.trim() && tail) lines.push(`> — ${tail}${obsidian ? ` ^q-${q.id.slice(0, 8)}` : ''}`)
    else if (obsidian) lines.push(`^q-${q.id.slice(0, 8)}`)
    out.push(lines.join('\n'))

    if (opts.notes) {
      const mine = input.notes.filter(n => n.quoteId === q.id)
      if (mine.length) out.push(mine.map(n => `- ${indent(n.body.trim())}`).join('\n'))
    }
    if (opts.explanations) {
      const ex = readExplanation(q.explanation)
      if (ex) {
        const items = [`- **Explanation (AI):** ${indent(ex.meaning, '  ')}`, ...ex.apply.map(a => `  - Try: ${a}`)]
        out.push(items.join('\n'))
      }
    }
  }

  if (opts.notes) {
    const bn = input.notes.filter(n => n.bookId === b.id && (n.scope === 'book' || n.scope === 'page' || n.scope === 'line'))
      .sort((a, c) => (a.page ?? -1) - (c.page ?? -1) || (a.line ?? -1) - (c.line ?? -1))
    if (bn.length) {
      out.push(`${'#'.repeat(level + 1)} Notes`)
      out.push(bn.map(n => { const p = placeOf(n); return `- ${p ? `**${p}** — ` : ''}${indent(n.body.trim())}` }).join('\n'))
    }
  }
  return out.join('\n\n')
}

/** The books that have something to say — a book with no quotes on the board is
 *  not a heading with nothing under it. */
function booksIn(input: ExportInput): Book[] {
  const ids = new Set(input.quotes.map(q => q.bookId))
  return input.books.filter(b => ids.has(b.id)).sort((a, b) => a.title.localeCompare(b.title))
}

export function buildExport(format: ExportFormat, input: ExportInput, opts: ExportOptions): ExportFile[] {
  const books = booksIn(input)
  if (!books.length) return []

  if (format === 'obsidian') {
    const used = new Map<string, number>()
    return books.map(b => {
      const base = safeName(b.title)
      const n = (used.get(base.toLowerCase()) ?? 0) + 1
      used.set(base.toLowerCase(), n)
      return { name: `${n > 1 ? `${base} (${n})` : base}.md`, content: `${frontMatter(b)}\n\n${bookBody(b, input, opts, 1, true)}\n` }
    })
  }

  const count = input.quotes.length
  const head = `# Quotes from my library\n\n${count} quote${count === 1 ? '' : 's'} from ${books.length} book${books.length === 1 ? '' : 's'}.`
  const body = books.map(b => bookBody(b, input, opts, 2, false)).join('\n\n---\n\n')
  return [{ name: books.length === 1 ? `${safeName(books[0].title)} - quotes.md` : 'Library quotes.md', content: `${head}\n\n${body}\n` }]
}

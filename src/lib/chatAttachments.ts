// ─── Files in the chat ───────────────────────────────────────────────────────
//
// A screenshot of an invoice, a PDF statement, a CSV of last month's spending:
// the fastest way to tell the assistant something is to show it. This turns a
// dropped, pasted or picked file into what each provider actually accepts, and
// says plainly when one of them cannot take it.
//
// Three kinds, because there are three things a model can be given:
// - **image** — Anthropic takes base64 blocks; Groq takes a data URL, and only
//   on a vision model.
// - **pdf** — Anthropic reads it natively. Groq does not, and pretending
//   otherwise would send a request that fails halfway.
// - **text** — CSV, Markdown, JSON, plain text. Inlined into the message, which
//   every model can read, with the file named around it so the model knows
//   where it came from.
//
// Anything else is refused up front rather than sent and rejected.

/** Anthropic's own guidance: an image longer than this on either edge is
 *  scaled down before it is sent, and the tokens it costs come down with it. */
const MAX_EDGE = 1568
/** Per file. Images are re-encoded below this anyway; a PDF is not. */
const MAX_IMAGE = 5 * 1024 * 1024
const MAX_PDF   = 24 * 1024 * 1024
const MAX_TEXT  = 200 * 1024
/** Everything in one message. Past this the request itself starts failing. */
export const MAX_TOTAL = 24 * 1024 * 1024

export type AttachmentKind = 'image' | 'pdf' | 'text'

export interface Attachment {
  id: string
  name: string
  /** Bytes as sent, which for an image is after any downscaling. */
  size: number
  kind: AttachmentKind
  mediaType: string
  /** base64, no data: prefix. Absent for text. */
  data?: string
  /** The whole file, for a text one. */
  text?: string
  /** Set when the file was too big to send whole. */
  truncated?: boolean
}

const TEXT_TYPES = /^(text\/|application\/(json|xml|csv|x-ndjson|x-yaml)|$)/i
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|ya?ml|log|xml|html?|ics|srt|ts|tsx|js|jsx|py|sql|sh|css)$/i

export function kindOf(file: File): AttachmentKind | null {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pdf'
  if (TEXT_TYPES.test(file.type) || TEXT_EXT.test(file.name)) return 'text'
  return null
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('That file could not be read.'))
    r.readAsDataURL(file)
  })
}

const stripPrefix = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(',') + 1)

/** Down to `MAX_EDGE` on the long side, and to JPEG where that is smaller.
 *  A 12-megapixel phone photo is four megabytes of detail nobody reads. */
async function shrinkImage(file: File): Promise<{ data: string; mediaType: string; size: number }> {
  const original = await readAsDataUrl(file)
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('That image could not be opened.'))
    el.src = original
  })
  const long = Math.max(img.width, img.height)
  const smallEnough = long <= MAX_EDGE && file.size <= MAX_IMAGE
  // A PNG screenshot that is already small keeps its own encoding: re-encoding
  // it as JPEG only adds artefacts to the text in it.
  if (smallEnough) return { data: stripPrefix(original), mediaType: file.type || 'image/png', size: file.size }

  const scale = Math.min(1, MAX_EDGE / long)
  const canvas = document.createElement('canvas')
  canvas.width  = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return { data: stripPrefix(original), mediaType: file.type || 'image/png', size: file.size }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const out = canvas.toDataURL('image/jpeg', 0.85)
  const data = stripPrefix(out)
  return { data, mediaType: 'image/jpeg', size: Math.round((data.length * 3) / 4) }
}

/** One file, ready to send — or an error naming what is wrong with it. */
export async function readAttachment(file: File): Promise<Attachment> {
  const kind = kindOf(file)
  if (!kind) throw new Error(`${file.name} is not something the assistant can read — images, PDFs and text files only.`)

  if (kind === 'image') {
    const { data, mediaType, size } = await shrinkImage(file)
    if (size > MAX_IMAGE) throw new Error(`${file.name} is too big to send even after scaling.`)
    return { id: crypto.randomUUID(), name: file.name, size, kind, mediaType, data }
  }

  if (kind === 'pdf') {
    if (file.size > MAX_PDF) throw new Error(`${file.name} is ${Math.round(file.size / 1048576)} MB — too big to send. The limit is ${MAX_PDF / 1048576} MB.`)
    return {
      id: crypto.randomUUID(), name: file.name, size: file.size, kind,
      mediaType: 'application/pdf', data: stripPrefix(await readAsDataUrl(file)),
    }
  }

  const whole = await file.text()
  const truncated = whole.length > MAX_TEXT
  return {
    id: crypto.randomUUID(), name: file.name, size: file.size, kind,
    mediaType: file.type || 'text/plain',
    text: truncated ? whole.slice(0, MAX_TEXT) : whole,
    ...(truncated ? { truncated: true } : {}),
  }
}

/** A text file becomes part of the message, named so the model knows what it
 *  is looking at rather than finding a wall of commas above the question. */
function asTextBlock(a: Attachment): string {
  return `--- ${a.name}${a.truncated ? ' (first 200 KB — the file is longer)' : ''} ---\n${a.text ?? ''}\n--- end of ${a.name} ---`
}

/** Anthropic content blocks: images and PDFs travel as themselves. */
export function toAnthropicContent(text: string, atts: Attachment[]): unknown[] {
  const blocks: unknown[] = []
  for (const a of atts) {
    if (a.kind === 'image') blocks.push({ type: 'image', source: { type: 'base64', media_type: a.mediaType, data: a.data } })
    if (a.kind === 'pdf')   blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.data } })
  }
  const texts = atts.filter(a => a.kind === 'text').map(asTextBlock)
  blocks.push({ type: 'text', text: [...texts, text].filter(Boolean).join('\n\n') || '(no message)' })
  return blocks
}

/** Groq speaks OpenAI: images as data URLs, and nothing else. */
export function toGroqContent(text: string, atts: Attachment[]): unknown {
  const images = atts.filter(a => a.kind === 'image')
  const texts  = atts.filter(a => a.kind === 'text').map(asTextBlock)
  const body   = [...texts, text].filter(Boolean).join('\n\n') || '(no message)'
  if (images.length === 0) return body
  return [
    { type: 'text', text: body },
    ...images.map(a => ({ type: 'image_url', image_url: { url: `data:${a.mediaType};base64,${a.data}` } })),
  ]
}

/** What this provider cannot take, said before the request rather than after.
 *  Groq has no way to read a PDF, and a silent drop would look like the model
 *  ignoring the thing you just handed it. */
export function unsupported(provider: string, atts: Attachment[]): string | null {
  if (provider !== 'groq') return null
  const pdfs = atts.filter(a => a.kind === 'pdf')
  if (pdfs.length === 0) return null
  const names = pdfs.map(p => p.name).join(', ')
  return `Groq cannot read a PDF (${names}). Switch to Anthropic in Settings → AI, or attach it as an image or text.`
}

export function tooLarge(atts: Attachment[]): string | null {
  const total = atts.reduce((n, a) => n + a.size, 0)
  if (total <= MAX_TOTAL) return null
  return `That is ${Math.round(total / 1048576)} MB in one message — the limit is ${MAX_TOTAL / 1048576} MB. Send fewer files.`
}

export function prettySize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

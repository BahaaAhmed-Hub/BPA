// ─── A book's file, in the private `library` bucket (20260026) ───────────────
// The path's first segment is the owner's id, which is what the bucket's
// policies compare against `auth.uid()` — a name you guess is still refused.
import { supabase } from '@/lib/supabase'
import { markLocalWrite } from '@/lib/liveSync'

const BUCKET = 'library'

/** Supabase's free tier refuses an object over 50 MB, and says so only after
 *  the whole upload — better to say it before. */
export const MAX_PDF_BYTES = 50 * 1024 * 1024

async function uid(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const id = data.session?.user.id
  if (!id) throw new Error('Not signed in')
  return id
}

/** A PDF begins `%PDF-`. The extension and the MIME type are what a person or a
 *  browser claims; the first five bytes are what the file is. */
export async function looksLikePdf(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer())
  return String.fromCharCode(...head) === '%PDF-'
}

/** Stored as `<owner>/<book>/book.pdf`, replacing whatever was there — one
 *  file per book, so "Replace" is the same call as the first upload. */
export async function uploadBookPdf(bookId: string, file: File): Promise<string> {
  if (file.size > MAX_PDF_BYTES) throw new Error(`That file is ${(file.size / 1048576).toFixed(0)} MB; the limit is 50 MB.`)
  if (!(await looksLikePdf(file))) throw new Error('That does not look like a PDF.')
  markLocalWrite('library')
  const path = `${await uid()}/${bookId}/book.pdf`
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true, contentType: 'application/pdf' })
  if (error) throw new Error(error.message)
  return path
}

export async function downloadBookFile(path: string): Promise<ArrayBuffer> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path)
  if (error || !data) throw new Error(error?.message ?? 'The file could not be fetched.')
  return data.arrayBuffer()
}

export async function removeBookFile(path: string): Promise<void> {
  markLocalWrite('library')
  const { error } = await supabase.storage.from(BUCKET).remove([path])
  if (error) throw new Error(error.message)
}

// ─── Quote photos ────────────────────────────────────────────────────────────
// `<owner>/<book>/quotes/<random>.<ext>` — under the same first segment the
// bucket's policy checks. The name is random rather than the quote's id so the
// photo can be uploaded *before* the quote exists, and a failed upload never
// leaves a quote pointing at nothing.

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }
const TYPE: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }

export async function uploadQuoteImage(bookId: string, bytes: Blob, mediaType: string): Promise<string> {
  markLocalWrite('library')
  const path = `${await uid()}/${bookId}/quotes/${crypto.randomUUID()}.${EXT[mediaType] ?? 'jpg'}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: mediaType, upsert: false })
  if (error) throw new Error(error.message)
  return path
}

const urls = new Map<string, Promise<string>>()

/** A displayable address for a stored photo, fetched once per path per session
 *  (the bucket is private, so it cannot simply be an <img src>). */
export function quoteImageUrl(path: string): Promise<string> {
  let hit = urls.get(path)
  if (!hit) {
    hit = downloadBookFile(path).then(buf => URL.createObjectURL(new Blob([buf], { type: TYPE[path.split('.').pop() ?? ''] ?? 'image/jpeg' })))
    // A failed fetch must not be remembered, or the photo stays broken until reload.
    hit.catch(() => urls.delete(path))
    urls.set(path, hit)
  }
  return hit
}

// ─── HEIC/HEIF photos ────────────────────────────────────────────────────────
// An iPhone's native format. Only Safari can draw one, and Chrome/Firefox often
// report an empty MIME type for it, so a picked .heic is "not an image" to the
// shelf reader and a broken <img> in the preview. Convert to JPEG up front; the
// converter (~1 MB) is imported only when a HEIC actually turns up.

/** Extension first, because the MIME type is exactly what a desktop browser leaves blank. */
export function isHeic(file: Blob & { name?: string }): boolean {
  return /^image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name ?? '')
}

export async function heicToJpeg(file: File): Promise<File> {
  const { default: heic2any } = await import('heic2any')
  const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 }).catch(() => null)
  const blob = Array.isArray(out) ? out[0] : out
  if (!blob) throw new Error('That HEIC photo could not be converted. Try exporting it as JPEG.')
  return new File([blob], (file.name || 'photo').replace(/\.hei[cf]$/i, '') + '.jpg', { type: 'image/jpeg' })
}

/** A file any canvas can draw: HEIC converted, everything else returned as it came. */
export async function readableImage(file: File): Promise<File> {
  return isHeic(file) ? heicToJpeg(file) : file
}

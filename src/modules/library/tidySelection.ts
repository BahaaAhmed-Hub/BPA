/** Selected text arrives as the PDF's own lines: hard breaks mid-sentence and a
 *  hyphen where a word wrapped. A quote is a sentence, so join them back. */
export const tidySelection = (s: string): string => s.replace(/-\n(?=\p{Ll})/gu, '').replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim()

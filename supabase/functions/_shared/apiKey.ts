/**
 * Keep only what an API key can contain (letters, digits, `-`, `_`). Stripping
 * whitespace alone left zero-width spaces, LTR/RTL marks, curly quotes and `…`
 * in the key, and a header that is not a ByteString makes `fetch` throw before
 * anything is sent. Mirror of `src/lib/apiKey.ts`; keep the two identical.
 */
export const cleanKey = (k: string | undefined | null): string => (k ?? '').replace(/[^A-Za-z0-9_-]+/g, '')

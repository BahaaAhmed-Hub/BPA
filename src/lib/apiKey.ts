/**
 * An API key is plain ASCII: Anthropic's are `sk-ant-…` and Groq's `gsk_…`, both
 * letters, digits, `-` and `_` and nothing else. A paste very often carries more:
 * a trailing newline from a terminal, a space from a chat — and, invisibly, a
 * zero-width space, a left-to-right / right-to-left mark (an Arabic keyboard adds
 * these), a curly quote or a `…` from a masked display.
 *
 * Stripping whitespace alone left the invisible ones in, and a header that is not
 * a ByteString makes `fetch` throw before anything is sent:
 * "Failed to construct 'Request': 'headers' … is not a valid ByteString".
 * So keep only what a key can contain. A key that comes out wrong is then refused
 * by the provider with a 401, which names the key — instead of a browser error
 * that names nothing.
 *
 * Mirrored in `supabase/functions/_shared/apiKey.ts`; keep the two identical.
 */
export const cleanKey = (k: string | undefined | null): string => (k ?? '').replace(/[^A-Za-z0-9_-]+/g, '')

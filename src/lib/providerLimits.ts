// The provider-limit readings live in `supabase/functions/_shared/providerLimits.ts`: the `assistant-chat` function reads the
// headers on the server (where they are always visible) and the page reads them for its own in-browser requests, with the
// very same parser.
export * from '../../supabase/functions/_shared/providerLimits.ts'

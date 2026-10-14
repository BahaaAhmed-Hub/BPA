// The consent policy lives in `supabase/functions/_shared/assistantGate.ts`: the Telegram bot and Siri
// import the very same file, so an act is gated the same way on all three.
export * from '../../supabase/functions/_shared/assistantGate.ts'

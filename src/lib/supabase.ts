import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-key'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

/** Which Supabase project this build talks to. Baked in at build time from a
 *  GitHub secret, so it is not obvious from anywhere in the app — and running
 *  a migration against a different project than the one the app uses looks
 *  exactly like the migration not working. */
export const supabaseProjectRef: string = (() => {
  try { return new URL(supabaseUrl).hostname.split('.')[0] } catch { return 'unknown' }
})()

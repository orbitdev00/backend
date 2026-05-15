import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

// flowType: 'implicit' makes email confirmation use hash tokens (#access_token=...)
// instead of PKCE codes (?code=...). This allows confirmation links to work on any
// device/browser, not just the one used to sign up (which had the code_verifier).
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { flowType: 'implicit' },
})

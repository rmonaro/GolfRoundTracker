import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anon) {
  console.warn(
    '[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY — copy .env.example to .env.local'
  );
}

// Note: we intentionally don't pass the Database generic here. The Postgrest
// type inference is strict in supabase-js v2, and our repository layer in
// src/services/* is the source of truth for entity shapes.
export const supabase: SupabaseClient = createClient(
  url ?? 'http://localhost:54321',
  anon ?? 'public-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: typeof window === 'undefined' ? undefined : window.localStorage
    }
  }
);

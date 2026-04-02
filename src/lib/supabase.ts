import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
const supabaseKey = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  ''
).trim();

let supabaseClient: SupabaseClient | null = null;

export function hasSupabaseRealtimeConfig() {
  return supabaseUrl.length > 0 && supabaseKey.length > 0;
}

export function getMissingSupabaseRealtimeEnvVars() {
  const missing: string[] = [];

  if (!supabaseUrl) {
    missing.push('VITE_SUPABASE_URL');
  }

  if (!supabaseKey) {
    missing.push('VITE_SUPABASE_PUBLISHABLE_KEY');
  }

  return missing;
}

export function getSupabaseClient() {
  if (!hasSupabaseRealtimeConfig()) {
    return null;
  }

  if (!supabaseClient) {
    supabaseClient = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return supabaseClient;
}

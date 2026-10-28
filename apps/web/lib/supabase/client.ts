import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser Supabase client (Phase 2, @supabase/ssr).
 *
 * Cookie-based sessions, so the server (middleware / Server Actions)
 * sees the same session as the browser. With placeholder env vars
 * this client cannot authenticate — see lib/supabase/config.ts.
 * Never put the service-role key here.
 */
export function createBrowserSupabaseClient(): SupabaseClient {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co";
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder-anon-key";
  return createBrowserClient(url, key);
}

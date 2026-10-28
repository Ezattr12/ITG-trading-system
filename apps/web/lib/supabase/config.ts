/**
 * Supabase configuration status (Phase 2).
 *
 * Supabase is NOT connected yet (Phase 0 audit): there is no project,
 * no URL and no keys. The app must therefore never pretend auth works.
 * `isSupabaseConfigured()` is the single source of truth for that:
 * auth / onboarding / upload UI is disabled with a clear notice until
 * real env vars are present. Placeholder values from `.env.example`
 * count as NOT configured.
 */
export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !key) return false;
  if (url.includes("placeholder") || url.includes("your-project-ref")) return false;
  if (key.includes("placeholder") || key.includes("your-supabase")) return false;
  return url.startsWith("https://") && url.includes(".supabase.co");
}

export function supabaseNotConnectedMessage(): string {
  return "Supabase is not connected yet. Authentication, onboarding and photo upload will work once a Supabase project is created and its URL and keys are set in the environment. Nothing here is a demo login.";
}

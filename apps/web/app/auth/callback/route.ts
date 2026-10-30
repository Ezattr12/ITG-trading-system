import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { safeNextPath } from "@/lib/auth/redirect";

/**
 * Supabase Auth callback (Phase 2, spec §6).
 * Exchanges the `code` from an email verification / password-reset
 * link for a session, then redirects to `next` (default /onboarding).
 * OAuth providers can be added here later — the route already
 * accepts any provider's code exchange.
 *
 * Phase 27: `next` is validated by safeNextPath — an
 * unvalidated value concatenated onto the origin would allow
 * open redirects (e.g. `next=@evil.com` parses with evil.com
 * as the host). Anything that is not a plain in-app path
 * falls back to /onboarding.
 */
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = safeNextPath(requestUrl.searchParams.get("next"));
  const origin = requestUrl.origin;

  if (code) {
    const response = NextResponse.redirect(`${origin}${next}`);
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder-anon-key",
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options),
            );
          },
        },
      },
    );
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
    }
    return response;
  }
  return NextResponse.redirect(`${origin}/login`);
}

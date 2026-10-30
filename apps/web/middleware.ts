import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Route protection (Phase 2).
 * - Public: /, /login, /register, /forgot-password, /reset-password,
 *   /auth/callback (and static assets / API auth callbacks).
 * - Protected: /dashboard, /onboarding, /profile and every future
 *   app route — unauthenticated users are sent to /login.
 * - Authenticated users visiting /login or /register go to /dashboard.
 * - API routes (/api/*) are NOT page-protected here: they
 *   authenticate themselves. Today that is only the internal
 *   coach endpoint (Phase 20), which requires a Supabase
 *   Bearer token and answers 401 JSON — a /login redirect
 *   would make token-only callers (the MCP server) unusable.
 * Onboarding completion is checked in the dashboard/onboarding
 * pages (it needs a DB read), not here.
 */
const PUBLIC_PATHS = ["/", "/login", "/register", "/forgot-password", "/reset-password"];
const AUTH_PAGES = ["/login", "/register"];

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith("/api/")) return NextResponse.next();
  const { response, user } = await updateSession(request);

  const isPublic =
    PUBLIC_PATHS.includes(pathname) || pathname.startsWith("/auth/");
  if (!user && !isPublic) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }
  if (user && AUTH_PAGES.includes(pathname)) {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = "/dashboard";
    return NextResponse.redirect(dashboardUrl);
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

/**
 * Security headers (Phase 11, spec §5).
 *
 * Pure function so the list is unit-testable; `next.config.ts`
 * applies it to every route. The Content-Security-Policy keeps
 * `'unsafe-inline'` for scripts and styles: Next.js needs inline
 * scripts for hydration data and inline styles for its runtime,
 * so a nonce-based CSP is a Phase 12+ improvement, not a silent
 * breakage introduced here. `frame-ancestors 'none'` plus
 * X-Frame-Options DENY means the app can never be framed.
 *
 * Connect sources are the app itself plus Supabase (REST +
 * Realtime websocket). No other third-party origin is loaded.
 *
 * Phase 27 hardening: `object-src 'none'` — the app renders no
 * <object>/<embed>/<applet> content anywhere (verified by a
 * source scan), so plugin content is refused outright instead
 * of falling back to `default-src 'self'`.
 */
export interface SecurityHeader {
  key: string;
  value: string;
}

export function securityHeaders(): SecurityHeader[] {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
  ].join("; ");
  return [
    {
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=()",
    },
    { key: "Content-Security-Policy", value: csp },
  ];
}

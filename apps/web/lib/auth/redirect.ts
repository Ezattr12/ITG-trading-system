/**
 * Same-origin redirect targets (Phase 27).
 *
 * The auth callback redirects to the caller-supplied `next`
 * parameter after exchanging the Supabase code. Concatenating
 * an unvalidated value onto the origin is not enough: a value
 * like `@evil.com` turns `https://app@evil.com` into a URL
 * whose HOST is evil.com (the app origin becomes userinfo),
 * and `//evil.com` / backslash variants are protocol-relative
 * in several browsers. Only a plain absolute path survives:
 *
 * - must start with exactly one `/` (not `//`, not `/\`);
 * - must not contain a backslash anywhere (browsers that
 *   normalise `\` to `/` could otherwise re-form `//`).
 *
 * Anything else falls back to the given default. Legitimate
 * in-app targets ("/onboarding", "/reset-password",
 * "/onboarding?done=1") pass unchanged.
 */
export function safeNextPath(raw: string | null | undefined, fallback = "/onboarding"): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  if (raw.includes("\\")) return fallback;
  return raw;
}

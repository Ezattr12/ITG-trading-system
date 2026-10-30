/**
 * In-memory sliding-window rate limiting for auth Server Actions
 * (Phase 2, spec §5 "rate limiting where appropriate").
 *
 * Scope: this is a per-instance, in-memory limiter. It is correct
 * for a single Next.js server instance and for tests; on Vercel with
 * multiple instances it is a best-effort guard, not a distributed
 * limiter. If abuse is observed, replace the backing store with a
 * shared one (e.g. Upstash Redis) — the call sites do not change.
 *
 * Limits are deliberately generous for legitimate use and tight
 * enough to stop floods: an admin does 20 writes a minute at most,
 * a trader creates 30 trades per 10 minutes at most, and uploads
 * are capped at 10 per 10 minutes.
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

const buckets = new Map<string, number[]>();

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): RateLimitResult {
  const timestamps = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (timestamps.length >= limit) {
    const oldest = timestamps[0] ?? now;
    const retryAfterSeconds = Math.ceil((oldest + windowMs - now) / 1000);
    buckets.set(key, timestamps);
    return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(retryAfterSeconds, 1) };
  }
  timestamps.push(now);
  buckets.set(key, timestamps);
  return { allowed: true, remaining: limit - timestamps.length, retryAfterSeconds: 0 };
}

/** Test-only: clear all buckets. */
export function __clearRateLimitBuckets(): void {
  buckets.clear();
}

/**
 * Auth attempts: 5 per 15 minutes per email. (Phase 27 doc fix:
 * the call sites in lib/auth/actions.ts key the bucket on the
 * email address only — no IP component — so per-account
 * throttling is what is actually enforced; Supabase Auth's own
 * platform limits sit behind it.)
 */
export const AUTH_RATE_LIMIT = { limit: 5, windowMs: 15 * 60 * 1000 };
/** Password-reset requests: 3 per hour per email. */
export const RESET_RATE_LIMIT = { limit: 3, windowMs: 60 * 60 * 1000 };
/** Admin writes (Phase 11): 20 per minute per admin, per action. */
export const ADMIN_RATE_LIMIT = { limit: 20, windowMs: 60 * 1000 };
/** Trade creation (Phase 11): 30 per 10 minutes per trader. */
export const TRADE_RATE_LIMIT = { limit: 30, windowMs: 10 * 60 * 1000 };
/** File uploads (Phase 11): 10 per 10 minutes per trader. */
export const UPLOAD_RATE_LIMIT = { limit: 10, windowMs: 10 * 60 * 1000 };

export interface RateLimitPreset {
  limit: number;
  windowMs: number;
}

/** Check a named preset. `now` is injectable so tests can fill a bucket without waiting. */
export function checkPresetRateLimit(
  key: string,
  preset: RateLimitPreset,
  now = Date.now(),
): RateLimitResult {
  return checkRateLimit(key, preset.limit, preset.windowMs, now);
}

/** Standard user-facing message for a blocked action. */
export function rateLimitMessage(action: string, result: RateLimitResult): string {
  return `Too many ${action} attempts. Try again in ${result.retryAfterSeconds} seconds.`;
}

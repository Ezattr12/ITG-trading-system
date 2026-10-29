/**
 * Per-user token bucket (design §2.8): 60 calls per minute per
 * authenticated trader, refilling continuously at 1/second.
 * In-process only — the POC is a single server process, and a
 * misbehaving client is stopped before it can hammer the DB.
 */

export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; updatedAt: number }>();

  constructor(
    private readonly capacity = 60,
    private readonly refillPerSecond = 1,
  ) {}

  /** Consume one token for `key`. Returns false when the budget is exhausted. */
  allow(key: string, nowMs: number = Date.now()): boolean {
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, updatedAt: nowMs };
    const elapsedSeconds = Math.max(0, (nowMs - bucket.updatedAt) / 1000);
    const tokens = Math.min(
      this.capacity,
      bucket.tokens + elapsedSeconds * this.refillPerSecond,
    );
    if (tokens < 1) {
      this.buckets.set(key, { tokens, updatedAt: nowMs });
      return false;
    }
    this.buckets.set(key, { tokens: tokens - 1, updatedAt: nowMs });
    return true;
  }
}

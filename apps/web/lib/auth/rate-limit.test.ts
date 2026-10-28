import { describe, expect, it, beforeEach } from "vitest";
import {
  checkRateLimit,
  checkPresetRateLimit,
  rateLimitMessage,
  ADMIN_RATE_LIMIT,
  TRADE_RATE_LIMIT,
  UPLOAD_RATE_LIMIT,
  __clearRateLimitBuckets,
} from "./rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => __clearRateLimitBuckets());

  it("allows attempts up to the limit", () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit("login:test@example.com", 5, 60_000, 1_000 + i).allowed).toBe(true);
    }
  });
  it("blocks the attempt over the limit and reports a retry delay", () => {
    for (let i = 0; i < 5; i++) checkRateLimit("login:x@y.co", 5, 60_000, 1_000 + i);
    const result = checkRateLimit("login:x@y.co", 5, 60_000, 1_006);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });
  it("allows again after the window passes", () => {
    for (let i = 0; i < 5; i++) checkRateLimit("login:z@z.co", 5, 60_000, 1_000 + i);
    expect(checkRateLimit("login:z@z.co", 5, 60_000, 61_001).allowed).toBe(true);
  });
  it("tracks different keys independently", () => {
    for (let i = 0; i < 5; i++) checkRateLimit("login:a@a.co", 5, 60_000, 1_000 + i);
    expect(checkRateLimit("login:b@b.co", 5, 60_000, 1_006).allowed).toBe(true);
  });
});

describe("Phase 11 rate-limit presets", () => {
  beforeEach(() => __clearRateLimitBuckets());

  it("blocks the 21st admin write in a minute", () => {
    for (let i = 0; i < ADMIN_RATE_LIMIT.limit; i++) {
      expect(checkPresetRateLimit("admin:u1:role-change", ADMIN_RATE_LIMIT, 1_000 + i).allowed).toBe(true);
    }
    const blocked = checkPresetRateLimit("admin:u1:role-change", ADMIN_RATE_LIMIT, 1_021);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("scopes the admin limit per action, so one action cannot starve another", () => {
    for (let i = 0; i < ADMIN_RATE_LIMIT.limit; i++) {
      checkPresetRateLimit("admin:u1:role-change", ADMIN_RATE_LIMIT, 1_000 + i);
    }
    expect(checkPresetRateLimit("admin:u1:certificate-revoke", ADMIN_RATE_LIMIT, 1_021).allowed).toBe(true);
  });

  it("blocks the 31st trade creation in 10 minutes", () => {
    for (let i = 0; i < TRADE_RATE_LIMIT.limit; i++) {
      expect(checkPresetRateLimit("trade:u1", TRADE_RATE_LIMIT, 1_000 + i).allowed).toBe(true);
    }
    expect(checkPresetRateLimit("trade:u1", TRADE_RATE_LIMIT, 1_031).allowed).toBe(false);
  });

  it("blocks the 11th upload in 10 minutes", () => {
    for (let i = 0; i < UPLOAD_RATE_LIMIT.limit; i++) {
      expect(checkPresetRateLimit("upload:u1", UPLOAD_RATE_LIMIT, 1_000 + i).allowed).toBe(true);
    }
    expect(checkPresetRateLimit("upload:u1", UPLOAD_RATE_LIMIT, 1_011).allowed).toBe(false);
  });

  it("produces a user-facing message with the retry delay", () => {
    const message = rateLimitMessage("trade creation", {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 42,
    });
    expect(message).toBe("Too many trade creation attempts. Try again in 42 seconds.");
  });
});

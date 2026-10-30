import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeSupabase, type Row } from "@/lib/test-helpers/fake-supabase";
import { __clearRateLimitBuckets } from "@/lib/auth/rate-limit";
import type { ApiAuditEntry, ApiDeps } from "@/lib/api/auth";

/**
 * Mobile weekly-review handler tests (Phase 21, M2):
 * the +30 XP and its per-review idempotency come from the
 * shared core (the web action's existing logic), the
 * aggregates are computed from the week's real trades.
 */

const harness = vi.hoisted(() => ({
  adminClient: null as unknown,
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => {
    throw new Error("handlers receive clients via deps");
  },
  createServiceRoleSupabaseClient: () => harness.adminClient,
}));
vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: () => true,
  supabaseNotConnectedMessage: () => "not configured",
}));

import { handleSaveWeeklyReview } from "./reviews";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function attachAuth(fake: unknown, userId: string | null) {
  (fake as { auth: unknown }).auth = {
    getUser: async () =>
      userId
        ? { data: { user: { id: userId } }, error: null }
        : { data: { user: null }, error: new Error("invalid token") },
  };
}

function closedTrade(id: string, userId: string, pnl: number, closedAt: string): Row {
  return {
    id,
    user_id: userId,
    pair: "XAUUSD",
    direction: "long",
    status: "closed",
    pnl,
    strategy_id: null,
    opened_at: closedAt,
    closed_at: closedAt,
  };
}

function makeDeps() {
  const tables: Record<string, Row[]> = {
    // Week of 2026-10-26 (Mon) – 2026-11-01 (Sun): A closed
    // two trades (+100, −40); the winner is journaled.
    trades: [
      closedTrade("t-win", USER_A, 100, "2026-10-27T10:00:00Z"),
      closedTrade("t-loss", USER_A, -40, "2026-10-28T10:00:00Z"),
      closedTrade("t-other-week", USER_A, 999, "2026-10-20T10:00:00Z"),
      closedTrade("t-b", USER_B, 500, "2026-10-27T10:00:00Z"),
    ],
    psychology_records: [{ id: "p1", trade_id: "t-win", user_id: USER_A }],
    lessons: [],
    strategies: [],
    weekly_reviews: [],
    xp_transactions: [],
    user_levels: [],
    achievements: [],
    user_achievements: [],
    notifications: [],
    audit_logs: [],
    profiles: [{ id: USER_A }, { id: USER_B }],
    risk_events: [],
    goals: [],
    daily_activity: [],
  };
  const a = fakeSupabase(tables);
  const b = fakeSupabase(tables);
  const bad = fakeSupabase(tables);
  const admin = fakeSupabase(tables);
  attachAuth(a.fake, USER_A);
  attachAuth(b.fake, USER_B);
  attachAuth(bad.fake, null);
  harness.adminClient = admin.fake;
  const audits: ApiAuditEntry[] = [];
  const deps: ApiDeps = {
    makeTokenClient: (token: string): SupabaseClient =>
      token === "token-a" ? a.client : token === "token-b" ? b.client : bad.client,
    makeAdminClient: () => admin.client,
    auditApi: async (entry) => {
      audits.push(entry);
    },
    rateLimit: () => ({ allowed: true, remaining: 59, retryAfterSeconds: 0 }),
    now: () => new Date("2026-10-30T12:00:00Z"),
  };
  return { deps, audits, tables, a, b, admin };
}

const reviewBody = {
  weekStartDate: "2026-10-26",
  reviewText: "Followed the plan on gold; one early exit to fix.",
  mainMistake: "Exited the winner early.",
  focusNextWeek: "Hold to target.",
};

beforeEach(() => {
  harness.adminClient = null;
  __clearRateLimitBuckets();
});

describe("handleSaveWeeklyReview", () => {
  it("no token → 401 and nothing is written", async () => {
    const { deps, tables } = makeDeps();
    const res = await handleSaveWeeklyReview({ token: null, body: reviewBody }, deps);
    expect(res.status).toBe(401);
    expect(tables.weekly_reviews).toHaveLength(0);
    expect(tables.xp_transactions).toHaveLength(0);
  });

  it("smuggled user_id → 400 naming it; unknown key → 400 naming it; no write", async () => {
    const { deps, tables } = makeDeps();
    const smuggled = await handleSaveWeeklyReview(
      { token: "token-a", body: { ...reviewBody, user_id: USER_B } },
      deps,
    );
    expect(smuggled.status).toBe(400);
    expect(String(smuggled.body.message)).toContain("user_id");
    const unknown = await handleSaveWeeklyReview(
      { token: "token-a", body: { ...reviewBody, xp: 9999 } },
      deps,
    );
    expect(unknown.status).toBe(400);
    expect(String(unknown.body.message)).toContain("xp");
    expect(tables.weekly_reviews).toHaveLength(0);
  });

  it("schema-invalid → 400 with the web schema messages", async () => {
    const { deps } = makeDeps();
    const badDate = await handleSaveWeeklyReview(
      { token: "token-a", body: { ...reviewBody, weekStartDate: "26/10/2026" } },
      deps,
    );
    expect(badDate.status).toBe(400);
    expect(badDate.body.message).toBe("Enter a valid date (YYYY-MM-DD).");
    const shortText = await handleSaveWeeklyReview(
      { token: "token-a", body: { ...reviewBody, reviewText: "short" } },
      deps,
    );
    expect(shortText.status).toBe(400);
    expect(shortText.body.message).toBe("Write at least a short reflection (10 characters).");
  });

  it("happy path → 200 { review_id, xp_awarded: 30 }, aggregates from the week's real trades only", async () => {
    const { deps, audits, tables, a, admin } = makeDeps();
    const res = await handleSaveWeeklyReview({ token: "token-a", body: reviewBody }, deps);
    expect(res.status).toBe(200);
    expect(res.body.xp_awarded).toBe(30);
    const reviewId = res.body.review_id as string;
    expect(typeof reviewId).toBe("string");
    const stored = tables.weekly_reviews.find((r) => r.id === reviewId);
    expect(stored).toMatchObject({
      user_id: USER_A,
      week_start_date: "2026-10-26",
      week_end_date: "2026-11-01",
      trades_count: 2,
      total_pnl: 60,
      win_rate_pct: 50,
      journal_completion_pct: 50,
      status: "completed",
    });
    const xp = admin.fake.insertsFor("xp_transactions");
    expect(xp).toHaveLength(1);
    expect(xp[0]).toMatchObject({ user_id: USER_A, reason: "weekly_review", amount: 30, source_ref_id: reviewId });
    expect(admin.fake.insertsFor("notifications").map((n) => n.type)).toContain("weekly_report");
    expect(a.fake.upsertsFor("weekly_reviews")).toHaveLength(1);
    expect(audits.filter((e) => e.operation === "weekly_review_saved")).toHaveLength(1);
    // Phase 27: alongside the API-layer row, the core now writes
    // the domain audit row (review.weekly_saved) — the web
    // action path previously had no domain row at all.
    const domainAudit = admin.fake.insertsFor("audit_logs");
    expect(
      domainAudit.some((r) => r.action === "review.weekly_saved" && r.entity_id === reviewId),
    ).toBe(true);
  });

  it("re-saving the same week → xp_awarded 0 and still exactly one XP row (idempotent)", async () => {
    const { deps, tables, admin } = makeDeps();
    const first = await handleSaveWeeklyReview({ token: "token-a", body: reviewBody }, deps);
    expect(first.body.xp_awarded).toBe(30);
    const second = await handleSaveWeeklyReview(
      { token: "token-a", body: { ...reviewBody, reviewText: "Updated reflection for the week." } },
      deps,
    );
    expect(second.status).toBe(200);
    expect(second.body.xp_awarded).toBe(0);
    expect(second.body.review_id).toBe(first.body.review_id);
    expect(admin.fake.insertsFor("xp_transactions")).toHaveLength(1);
    expect(tables.weekly_reviews).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeSupabase, type Row } from "@/lib/test-helpers/fake-supabase";
import {
  handleCoachInsightsCompute,
  type CoachEndpointAuditEntry,
  type CoachInsightsEndpointDeps,
} from "./endpoint";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WEEK = "2026-10-12"; // Monday; week runs to 2026-10-18.

function closedTrade(overrides: Partial<Row> & { id: string }): Row {
  return {
    user_id: USER_A,
    pair: "XAUUSD",
    direction: "long",
    status: "closed",
    pnl: 10,
    r_multiple: 1,
    sl: 100,
    tp: null,
    session: "london",
    strategy_id: null,
    opened_at: "2026-10-13T09:00:00Z",
    closed_at: "2026-10-13T10:00:00Z",
    ...overrides,
  };
}

function makeDeps(overrides: Partial<CoachInsightsEndpointDeps> = {}) {
  const tables: Record<string, Row[]> = {
    trades: [
      closedTrade({ id: "t1", pnl: 120, r_multiple: 2 }),
      closedTrade({ id: "t2", pnl: -50, r_multiple: -1, closed_at: "2026-10-14T10:00:00Z" }),
      closedTrade({ id: "t3", pnl: 30, r_multiple: 0.6, closed_at: "2026-10-15T10:00:00Z" }),
      closedTrade({ id: "tb", user_id: USER_B, pnl: 9999, closed_at: "2026-10-13T11:00:00Z" }),
    ],
    psychology_records: [
      { trade_id: "t1", user_id: USER_A, confidence: 4, emotion: "calm", discipline: "good" },
      { trade_id: "t2", user_id: USER_A, confidence: 3, emotion: "fear", discipline: "poor" },
      { trade_id: "t3", user_id: USER_A, confidence: 5, emotion: "calm", discipline: "good" },
    ],
    strategies: [],
    lessons: [],
    goals: [],
    risk_events: [],
    ai_insights: [],
  };
  const { client, fake } = fakeSupabase(tables);
  const audits: CoachEndpointAuditEntry[] = [];
  const deps: CoachInsightsEndpointDeps = {
    validateToken: async (token) =>
      token === "token-a" ? { userId: USER_A, client } : null,
    audit: async (entry) => {
      audits.push(entry);
    },
    rateLimit: () => ({ allowed: true, remaining: 29, retryAfterSeconds: 0 }),
    // Fixed clock inside the seeded week (Wednesday).
    now: () => new Date("2026-10-14T12:00:00Z"),
    ...overrides,
  };
  return { deps, audits, fake };
}

describe("handleCoachInsightsCompute — auth", () => {
  it("no token → 401 unauthenticated, audited with a null actor", async () => {
    const { deps, audits } = makeDeps();
    const res = await handleCoachInsightsCompute({ token: null, body: {} }, deps);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthenticated" });
    expect(audits).toEqual([
      { userId: null, outcome: "unauthenticated", weekStart: null, insightsCount: null },
    ]);
  });

  it("invalid token → 401 unauthenticated", async () => {
    const { deps, audits } = makeDeps();
    const res = await handleCoachInsightsCompute({ token: "forged", body: {} }, deps);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthenticated" });
    expect(audits).toHaveLength(1);
    expect(audits[0].outcome).toBe("unauthenticated");
  });
});

describe("handleCoachInsightsCompute — request validation", () => {
  it("smuggled user_id → 400 naming the field, even with a valid token", async () => {
    const { deps, audits } = makeDeps();
    const res = await handleCoachInsightsCompute(
      { token: "token-a", body: { week_start: WEEK, user_id: USER_B } },
      deps,
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_argument");
    expect(String(res.body.message)).toContain("user_id");
    expect(audits).toHaveLength(1);
    expect(audits[0].userId).toBe(USER_A);
    expect(audits[0].outcome).toBe("invalid_argument");
  });

  it.each(["tenant_id", "profile_id", "userId"])(
    "smuggled %s → 400 naming the field",
    async (key) => {
      const { deps } = makeDeps();
      const res = await handleCoachInsightsCompute(
        { token: "token-a", body: { [key]: "x" } },
        deps,
      );
      expect(res.status).toBe(400);
      expect(String(res.body.message)).toContain(key);
    },
  );

  it("malformed JSON → 400", async () => {
    const { deps } = makeDeps();
    const res = await handleCoachInsightsCompute(
      { token: "token-a", body: null, jsonMalformed: true },
      deps,
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_argument");
  });

  it("impossible week_start (2026-02-30) → 400", async () => {
    const { deps } = makeDeps();
    const res = await handleCoachInsightsCompute(
      { token: "token-a", body: { week_start: "2026-02-30" } },
      deps,
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_argument");
  });

  it("non-object body → 400", async () => {
    const { deps } = makeDeps();
    const res = await handleCoachInsightsCompute(
      { token: "token-a", body: ["week_start"] },
      deps,
    );
    expect(res.status).toBe(400);
  });
});

describe("handleCoachInsightsCompute — compute", () => {
  it("computes for the TOKEN's user only; the other trader's data never leaks", async () => {
    const { deps, audits, fake } = makeDeps();
    const res = await handleCoachInsightsCompute(
      { token: "token-a", body: { week_start: "2026-10-15" } }, // Wednesday → Monday
      deps,
    );
    expect(res.status).toBe(200);
    expect(res.body.week_start).toBe(WEEK);
    expect(res.body.period_start).toBe("2026-10-12");
    expect(res.body.period_end).toBe("2026-10-18");
    expect(res.body.insufficient_data).toBe(false);
    const insights = res.body.insights as { type: string; title: string; metrics_snapshot: Row }[];
    expect(insights.length).toBeGreaterThan(0);
    // USER_A total is 120 - 50 + 30 = 100; USER_B's 9999 must not appear.
    expect(insights.some((i) => i.metrics_snapshot.totalPnl === 100)).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain("10099");
    // Exactly one audit row, for the token's user, action-level fields only.
    expect(audits).toEqual([
      { userId: USER_A, outcome: "ok", weekStart: WEEK, insightsCount: insights.length },
    ]);
    // Compute ONLY: the endpoint never writes ai_insights.
    expect(fake.insertsFor("ai_insights")).toHaveLength(0);
    expect(fake.inserts).toHaveLength(0);
  });

  it("defaults to the current week's Monday (UTC) when week_start is omitted", async () => {
    const { deps } = makeDeps();
    const res = await handleCoachInsightsCompute({ token: "token-a", body: null }, deps);
    expect(res.status).toBe(200);
    expect(res.body.week_start).toBe(WEEK); // now() is Wed 2026-10-14
  });

  it("insufficient data is a 200 with insufficient_data true and empty insights", async () => {
    const { deps, audits } = makeDeps();
    const res = await handleCoachInsightsCompute(
      { token: "token-a", body: { week_start: "2026-11-02" } }, // a week with no trades
      deps,
    );
    expect(res.status).toBe(200);
    expect(res.body.insufficient_data).toBe(true);
    expect(res.body.insights).toEqual([]);
    expect(audits).toEqual([
      { userId: USER_A, outcome: "insufficient_data", weekStart: "2026-11-02", insightsCount: 0 },
    ]);
  });

  it("rate limit trips → 429 rate_limited, audited", async () => {
    const { deps, audits } = makeDeps({
      rateLimit: () => ({ allowed: false, remaining: 0, retryAfterSeconds: 0 }),
    });
    const res = await handleCoachInsightsCompute(
      { token: "token-a", body: { week_start: WEEK } },
      deps,
    );
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: "rate_limited" });
    expect(audits).toEqual([
      { userId: USER_A, outcome: "rate_limited", weekStart: WEEK, insightsCount: null },
    ]);
  });
});

import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeSupabase, type Row } from "@/lib/test-helpers/fake-supabase";
import {
  CoachStoreUnavailableError,
  computeCoachInsights,
  refreshCoachInsights,
  refreshCoachInsightsSafely,
  stableStringify,
} from "./service";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
// Week of Monday 2026-10-12 … Sunday 2026-10-18.
const WEEK = "2026-10-12";

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

function weekTables(): Record<string, Row[]> {
  return {
    trades: [
      closedTrade({ id: "t1", pnl: 120, r_multiple: 2, closed_at: "2026-10-13T10:00:00Z" }),
      closedTrade({
        id: "t2",
        pair: "EURUSD",
        direction: "short",
        pnl: -50,
        r_multiple: -1,
        closed_at: "2026-10-14T10:00:00Z",
      }),
      closedTrade({
        id: "t3",
        pair: "GBPUSD",
        pnl: 30,
        r_multiple: 0.6,
        sl: null,
        closed_at: "2026-10-15T10:00:00Z",
      }),
      // Another trader's trade in the same week — must never
      // leak into USER_A's analysis.
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
}

describe("stableStringify", () => {
  it("is key-order independent and value sensitive", () => {
    expect(stableStringify({ a: 1, b: { c: 2, d: 3 } })).toBe(
      stableStringify({ b: { d: 3, c: 2 }, a: 1 }),
    );
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });
});

describe("computeCoachInsights", () => {
  it("computes the week's analysis and performs ZERO writes", async () => {
    const { client, fake } = fakeSupabase(weekTables());
    const result = await computeCoachInsights(client, USER_A, "2026-10-14");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.analysis.periodStart).toBe("2026-10-12");
    expect(result.analysis.periodEnd).toBe("2026-10-18");
    expect(result.analysis.insights.length).toBeGreaterThan(0);
    // Only USER_A's trades: 120 - 50 + 30 = 100, never USER_B's 9999.
    const snapshots = result.analysis.insights.map((i) => i.metricsSnapshot);
    expect(snapshots.some((s) => s.totalPnl === 100)).toBe(true);
    expect(snapshots.some((s) => s.totalPnl === 10099)).toBe(false);
    expect(fake.inserts).toHaveLength(0);
  });

  it("reports insufficient_data below the minimum trade count, still with zero writes", async () => {
    const tables = weekTables();
    tables.trades = tables.trades.filter((t) => t.id === "t1" || t.id === "tb");
    const { client, fake } = fakeSupabase(tables);
    const result = await computeCoachInsights(client, USER_A, WEEK);
    expect(result.status).toBe("insufficient_data");
    expect(fake.inserts).toHaveLength(0);
  });

  it("reports invalid_week for a non-date", async () => {
    const { client } = fakeSupabase(weekTables());
    const result = await computeCoachInsights(client, USER_A, "not-a-date");
    expect(result.status).toBe("invalid_week");
  });
});

describe("refreshCoachInsights", () => {
  it("inserts once; a second identical refresh inserts nothing (idempotent)", async () => {
    const tables = weekTables();
    const reader = fakeSupabase(tables);
    const admin = fakeSupabase(tables);

    const first = await refreshCoachInsights({
      supabase: reader.client,
      admin: admin.client,
      userId: USER_A,
      weekStartDate: WEEK,
    });
    expect(first.insufficientData).toBe(false);
    expect(first.inserted).toBeGreaterThan(0);
    expect(first.inserted).toBe(admin.fake.insertsFor("ai_insights").length);
    // Stored rows carry the engine's real period + titles.
    const stored = admin.fake.insertsFor("ai_insights");
    expect(stored.every((r) => r.user_id === USER_A)).toBe(true);
    expect(stored.every((r) => r.period_start === "2026-10-12" && r.period_end === "2026-10-18")).toBe(true);

    const second = await refreshCoachInsights({
      supabase: reader.client,
      admin: admin.client,
      userId: USER_A,
      weekStartDate: WEEK,
    });
    expect(second.inserted).toBe(0);
    expect(second.skipped).toBe(first.inserted);
    expect(admin.fake.insertsFor("ai_insights")).toHaveLength(first.inserted);
  });

  it("inserts new rows when the week's snapshot changes", async () => {
    const tables = weekTables();
    const reader = fakeSupabase(tables);
    const admin = fakeSupabase(tables);
    const args = {
      supabase: reader.client,
      admin: admin.client,
      userId: USER_A,
      weekStartDate: WEEK,
    };
    const first = await refreshCoachInsights(args);
    // A fourth closed trade lands in the same week: the
    // performance snapshot changes, so new rows are stored.
    tables.trades.push(
      closedTrade({ id: "t4", pnl: 500, r_multiple: 5, closed_at: "2026-10-16T10:00:00Z" }),
    );
    const second = await refreshCoachInsights(args);
    expect(second.inserted).toBeGreaterThan(0);
    expect(admin.fake.insertsFor("ai_insights").length).toBeGreaterThan(first.inserted);
  });

  it("inserts nothing on insufficient data", async () => {
    const tables = weekTables();
    tables.trades = tables.trades.filter((t) => t.id === "t1");
    tables.psychology_records = tables.psychology_records.filter((p) => p.trade_id === "t1");
    const reader = fakeSupabase(tables);
    const admin = fakeSupabase(tables);
    const result = await refreshCoachInsights({
      supabase: reader.client,
      admin: admin.client,
      userId: USER_A,
      weekStartDate: WEEK,
    });
    expect(result.insufficientData).toBe(true);
    expect(result.inserted).toBe(0);
    expect(admin.fake.inserts).toHaveLength(0);
  });

  it("throws CoachStoreUnavailableError when insights exist but no store client", async () => {
    const reader = fakeSupabase(weekTables());
    await expect(
      refreshCoachInsights({
        supabase: reader.client,
        admin: null,
        userId: USER_A,
        weekStartDate: WEEK,
      }),
    ).rejects.toBeInstanceOf(CoachStoreUnavailableError);
  });
});

describe("refreshCoachInsightsSafely", () => {
  it("returns the refresh result on success", async () => {
    const tables = weekTables();
    const result = await refreshCoachInsightsSafely({
      supabase: fakeSupabase(tables).client,
      admin: fakeSupabase(tables).client,
      userId: USER_A,
      weekStartDate: WEEK,
    });
    expect(result).not.toBeNull();
    expect(result?.inserted).toBeGreaterThan(0);
  });

  it("swallows a throwing store client and returns null — never throws", async () => {
    const throwing = {
      from: () => {
        throw new Error("database is down");
      },
    } as unknown as SupabaseClient;
    await expect(
      refreshCoachInsightsSafely({
        supabase: fakeSupabase(weekTables()).client,
        admin: throwing,
        userId: USER_A,
        weekStartDate: WEEK,
      }),
    ).resolves.toBeNull();
  });

  it("swallows a compute failure (evidence assembly rejects) and returns null", async () => {
    // A chainable query stub whose await always rejects —
    // shaped like the real client's builder so Promise.all
    // in the evidence assembly handles every rejection.
    const rejectingChain = (): Record<string, unknown> => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "not", "gte", "lte", "order", "limit", "in", "is"]) {
        chain[m] = () => chain;
      }
      chain.then = (_resolve: unknown, reject: (e: Error) => void) => {
        reject(new Error("database is down"));
      };
      return chain;
    };
    const rejecting = { from: () => rejectingChain() } as unknown as SupabaseClient;
    await expect(
      refreshCoachInsightsSafely({
        supabase: rejecting,
        admin: null,
        userId: USER_A,
        weekStartDate: WEEK,
      }),
    ).resolves.toBeNull();
  });
});

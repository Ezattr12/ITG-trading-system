import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeSupabase, type Row } from "@/lib/test-helpers/fake-supabase";
import { __clearRateLimitBuckets } from "@/lib/auth/rate-limit";
import type { ApiAuditEntry, ApiDeps } from "@/lib/api/auth";

/**
 * Mobile summary handler tests (Phase 21, M2): the API's
 * one read endpoint. deps.now is pinned to Friday
 * 2026-10-30T12:00:00Z, so the current week is Mon
 * 2026-10-26 – Sun 2026-11-01 and the current month is
 * 2026-10-01 – 2026-10-31. The summary comes from the real
 * getReportSummary over the fake's trades.
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

import { handleSummaryRead } from "./summary";

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
    r_multiple: null,
    strategy_id: null,
    setup_id: null,
    market_condition: null,
    session: null,
    opened_at: closedAt,
    closed_at: closedAt,
  };
}

function makeDeps() {
  const tables: Record<string, Row[]> = {
    trades: [
      closedTrade("w1", USER_A, 100, "2026-10-27T10:00:00Z"),
      closedTrade("w2", USER_A, -40, "2026-10-29T10:00:00Z"),
      closedTrade("earlier-oct", USER_A, 500, "2026-10-05T10:00:00Z"),
      closedTrade("september", USER_A, 700, "2026-09-15T10:00:00Z"),
      closedTrade("b-week", USER_B, 9999, "2026-10-27T10:00:00Z"),
    ],
    psychology_records: [],
    lessons: [],
    strategies: [],
    setups: [],
    audit_logs: [],
    profiles: [{ id: USER_A }, { id: USER_B }],
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

beforeEach(() => {
  harness.adminClient = null;
  __clearRateLimitBuckets();
});

describe("handleSummaryRead", () => {
  it("no token → 401, audited null-actor", async () => {
    const { deps, audits } = makeDeps();
    const res = await handleSummaryRead({ token: null, rangeParam: null, queryKeys: [] }, deps);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthenticated" });
    expect(audits[0]).toMatchObject({ userId: null, operation: "summary_read", outcome: "unauthenticated" });
  });

  it("default range → current week Mon–Sun UTC with the caller's aggregates only", async () => {
    const { deps, audits } = makeDeps();
    const res = await handleSummaryRead({ token: "token-a", rangeParam: null, queryKeys: [] }, deps);
    expect(res.status).toBe(200);
    expect(res.body.range).toBe("week");
    expect(res.body.period_start).toBe("2026-10-26");
    expect(res.body.period_end).toBe("2026-11-01");
    const summary = res.body.summary as { tradesCount: number; totalPnl: number };
    expect(summary.tradesCount).toBe(2);
    expect(summary.totalPnl).toBe(60);
    expect(audits.filter((e) => e.operation === "summary_read" && e.outcome === "ok")).toHaveLength(1);
  });

  it("range=month → current calendar month, wider aggregates", async () => {
    const { deps } = makeDeps();
    const res = await handleSummaryRead(
      { token: "token-a", rangeParam: "month", queryKeys: ["range"] },
      deps,
    );
    expect(res.status).toBe(200);
    expect(res.body.period_start).toBe("2026-10-01");
    expect(res.body.period_end).toBe("2026-10-31");
    const summary = res.body.summary as { tradesCount: number; totalPnl: number };
    expect(summary.tradesCount).toBe(3);
    expect(summary.totalPnl).toBe(560);
  });

  it("invalid range → 400 naming the value", async () => {
    const { deps } = makeDeps();
    const res = await handleSummaryRead(
      { token: "token-a", rangeParam: "year", queryKeys: ["range"] },
      deps,
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_argument");
    expect(String(res.body.message)).toContain("year");
  });

  it("identity query param (?user_id=) → 400 naming it, even alongside a valid range", async () => {
    const { deps } = makeDeps();
    const res = await handleSummaryRead(
      { token: "token-a", rangeParam: "week", queryKeys: ["range", "user_id"] },
      deps,
    );
    expect(res.status).toBe(400);
    expect(String(res.body.message)).toContain("user_id");
  });
});

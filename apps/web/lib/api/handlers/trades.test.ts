import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeSupabase, type Row } from "@/lib/test-helpers/fake-supabase";
import { __clearRateLimitBuckets } from "@/lib/auth/rate-limit";
import type { ApiAuditEntry, ApiDeps } from "@/lib/api/auth";

/**
 * Mobile trade handler contract tests (Phase 21): auth,
 * identity-smuggling refusal, strict bodies, status
 * mapping, token-user scoping and cross-user isolation —
 * all against recording fakes, with the service-role
 * engines wired to a shared admin fake (mocked server
 * module), exactly as in production wiring.
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

import {
  handleCorrectTrade,
  handleCreateTrade,
  handleSaveTradeReview,
} from "./trades";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TRADE_A = "11111111-1111-4111-8111-111111111111";
const TRADE_B = "22222222-2222-4222-8222-222222222222";

function attachAuth(fake: unknown, userId: string | null) {
  (fake as { auth: unknown }).auth = {
    getUser: async () =>
      userId
        ? { data: { user: { id: userId } }, error: null }
        : { data: { user: null }, error: new Error("invalid token") },
  };
}

function tradeRow(id: string, userId: string): Row {
  return {
    id,
    user_id: userId,
    pair: "XAUUSD",
    direction: "long",
    status: "closed",
    pnl: 120,
    r_multiple: 1,
    sl: 100,
    tp: null,
    session: "london",
    strategy_id: null,
    setup_id: null,
    market_condition: null,
    trade_reason: null,
    notes: null,
    opened_at: "2026-10-12T09:00:00Z",
    closed_at: "2026-10-12T10:00:00Z",
  };
}

function makeDeps() {
  const tables: Record<string, Row[]> = {
    trades: [tradeRow(TRADE_A, USER_A), tradeRow(TRADE_B, USER_B)],
    psychology_records: [],
    strategies: [],
    setups: [],
    lessons: [],
    goals: [],
    risk_events: [],
    risk_rules: [],
    profiles: [
      { id: USER_A, trading_capital: null },
      { id: USER_B, trading_capital: null },
    ],
    ai_insights: [],
    xp_transactions: [],
    audit_logs: [],
    user_levels: [],
    achievements: [],
    user_achievements: [],
    notifications: [],
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

const closedBody = {
  pair: "XAUUSD",
  direction: "long",
  entryPrice: 2000,
  exitPrice: 2010,
  tp: 2020,
  sl: 1995,
  positionSize: 100,
  leverage: 1,
  fees: 0,
  openedAt: "2026-10-14T09:00:00Z",
  closedAt: "2026-10-14T10:00:00Z",
};

beforeEach(() => {
  harness.adminClient = null;
  __clearRateLimitBuckets();
});

describe("handleCreateTrade", () => {
  it("no token → 401, audited with a null actor, no write", async () => {
    const { deps, audits, tables } = makeDeps();
    const res = await handleCreateTrade({ token: null, body: closedBody }, deps);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthenticated" });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ userId: null, operation: "trade_created", outcome: "unauthenticated" });
    expect(tables.trades).toHaveLength(2);
  });

  it("invalid token → 401", async () => {
    const { deps } = makeDeps();
    const res = await handleCreateTrade({ token: "forged", body: closedBody }, deps);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthenticated" });
  });

  it("smuggled user_id → 400 naming the field, and NO write is performed", async () => {
    const { deps, audits, tables } = makeDeps();
    const res = await handleCreateTrade(
      { token: "token-a", body: { ...closedBody, user_id: USER_B } },
      deps,
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_argument");
    expect(String(res.body.message)).toContain("user_id");
    expect(tables.trades).toHaveLength(2);
    expect(audits[0]).toMatchObject({ userId: USER_A, outcome: "invalid_argument" });
  });

  it("malformed JSON (bodyError) → 400; unknown key → 400 naming it", async () => {
    const { deps } = makeDeps();
    const malformed = await handleCreateTrade(
      { token: "token-a", body: null, bodyError: "request body must be valid JSON" },
      deps,
    );
    expect(malformed.status).toBe(400);
    expect(malformed.body.error).toBe("invalid_argument");
    const unknown = await handleCreateTrade(
      { token: "token-a", body: { ...closedBody, pnl: 999999 } },
      deps,
    );
    expect(unknown.status).toBe(400);
    expect(String(unknown.body.message)).toContain("pnl");
  });

  it("zod-invalid body → 400 with the existing schema message", async () => {
    const { deps } = makeDeps();
    const res = await handleCreateTrade(
      { token: "token-a", body: { ...closedBody, entryPrice: -5 } },
      deps,
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_argument");
    expect(res.body.message).toBe("Entry price must be greater than 0");
  });

  it("happy path → 201, trade stored for the TOKEN user with server metrics, one API audit row", async () => {
    const { deps, audits, tables, a } = makeDeps();
    const res = await handleCreateTrade({ token: "token-a", body: closedBody }, deps);
    expect(res.status).toBe(201);
    const trade = res.body.trade as Row;
    expect(trade.pnl).toBe(1000);
    expect(trade.status).toBe("closed");
    const stored = a.fake.insertsFor("trades");
    expect(stored).toHaveLength(1);
    expect(stored[0].user_id).toBe(USER_A);
    expect(tables.trades.filter((r) => r.user_id === USER_B)).toHaveLength(1);
    const apiAudits = audits.filter((e) => e.operation === "trade_created");
    expect(apiAudits).toHaveLength(1);
    expect(apiAudits[0]).toMatchObject({ userId: USER_A, outcome: "ok", entityId: trade.id });
  });

  it("rate limit → 429", async () => {
    const { deps } = makeDeps();
    deps.rateLimit = () => ({ allowed: false, remaining: 0, retryAfterSeconds: 42 });
    const res = await handleCreateTrade({ token: "token-a", body: closedBody }, deps);
    expect(res.status).toBe(429);
    expect(res.body.error).toBe("rate_limited");
  });
});

describe("handleSaveTradeReview", () => {
  const reviewBody = {
    strategyId: null,
    setupName: null,
    marketCondition: "trending",
    tradeReason: null,
    session: null,
    confidence: 4,
    emotion: "calm",
    discipline: "good",
    lesson: null,
    notes: "Reviewed via API",
  };

  it("invalid UUID in path → 400", async () => {
    const { deps } = makeDeps();
    const res = await handleSaveTradeReview(
      { token: "token-a", body: reviewBody, tradeId: "not-a-uuid" },
      deps,
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_argument");
  });

  it("happy path → 200 and the trade is updated", async () => {
    const { deps, tables } = makeDeps();
    const res = await handleSaveTradeReview(
      { token: "token-a", body: reviewBody, tradeId: TRADE_A },
      deps,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ trade_id: TRADE_A });
    expect(tables.trades.find((r) => r.id === TRADE_A)?.notes).toBe("Reviewed via API");
  });

  it("another trader's trade → 404 not_found, identical shape, no write", async () => {
    const { deps, tables } = makeDeps();
    const res = await handleSaveTradeReview(
      { token: "token-a", body: reviewBody, tradeId: TRADE_B },
      deps,
    );
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "not_found" });
    expect(tables.trades.find((r) => r.id === TRADE_B)?.notes).toBeNull();
    // A nonexistent id gives the identical response (no oracle).
    const missing = await handleSaveTradeReview(
      { token: "token-a", body: reviewBody, tradeId: "33333333-3333-4333-8333-333333333333" },
      deps,
    );
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual(res.body);
  });
});

describe("handleCorrectTrade", () => {
  it("happy path → 201 with the correcting id; the original is reversed", async () => {
    const { deps, tables } = makeDeps();
    const res = await handleCorrectTrade(
      { token: "token-a", body: closedBody, tradeId: TRADE_A },
      deps,
    );
    expect(res.status).toBe(201);
    expect(res.body.reversed_trade_id).toBe(TRADE_A);
    expect(typeof res.body.trade_id).toBe("string");
    expect(tables.trades.find((r) => r.id === TRADE_A)?.status).toBe("reversed");
  });

  it("another trader's trade → 404 and nothing is created or reversed", async () => {
    const { deps, tables } = makeDeps();
    const res = await handleCorrectTrade(
      { token: "token-b", body: closedBody, tradeId: TRADE_A },
      deps,
    );
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "not_found" });
    expect(tables.trades).toHaveLength(2);
    expect(tables.trades.find((r) => r.id === TRADE_A)?.status).toBe("closed");
  });

  it("correcting an already-reversed trade → 422 with the legacy message", async () => {
    const { deps, tables } = makeDeps();
    const row = tables.trades.find((r) => r.id === TRADE_A);
    if (row) row.status = "reversed";
    const res = await handleCorrectTrade(
      { token: "token-a", body: closedBody, tradeId: TRADE_A },
      deps,
    );
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("validation_failed");
    expect(res.body.message).toBe("This trade has already been corrected or cancelled.");
  });
});

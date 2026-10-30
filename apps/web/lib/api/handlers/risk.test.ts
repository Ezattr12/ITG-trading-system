import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeSupabase, type Row } from "@/lib/test-helpers/fake-supabase";
import { __clearRateLimitBuckets } from "@/lib/auth/rate-limit";
import type { ApiAuditEntry, ApiDeps } from "@/lib/api/auth";

/**
 * Mobile risk handler contract tests (Phase 21, M2):
 * risk-rules PUT and trading-plan PUT on the M1 pipeline,
 * against the same cores the web actions use.
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

import { handleSaveRiskRules, handleSaveTradingPlan } from "./risk";

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

function makeDeps() {
  const tables: Record<string, Row[]> = {
    risk_rules: [],
    trading_plans: [],
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

const rulesBody = {
  maxRiskPerTradePct: 1,
  maxDailyLoss: 250,
  maxTradesPerDay: 5,
  maxConsecutiveLosses: 3,
  maxLeverage: 20,
};

const planBody = {
  name: "London Gold Plan",
  markets: ["XAUUSD"],
  sessions: ["london"],
  riskPerTradePct: 1,
  maxDailyLoss: 250,
  maxDailyTrades: 5,
  preferredSetupIds: [],
  noTradeConditions: "No trades during red-folder news.",
  psychologyRules: null,
  scheduleNotes: null,
};

beforeEach(() => {
  harness.adminClient = null;
  __clearRateLimitBuckets();
});

describe("handleSaveRiskRules", () => {
  it("no token → 401, audited null-actor, no write", async () => {
    const { deps, audits, tables } = makeDeps();
    const res = await handleSaveRiskRules({ token: null, body: rulesBody }, deps);
    expect(res.status).toBe(401);
    expect(audits[0]).toMatchObject({ userId: null, operation: "risk_rules_saved", outcome: "unauthenticated" });
    expect(tables.risk_rules).toHaveLength(0);
  });

  it("smuggled user_id → 400 naming it, no write; unknown key → 400 naming it", async () => {
    const { deps, tables } = makeDeps();
    const smuggled = await handleSaveRiskRules(
      { token: "token-a", body: { ...rulesBody, user_id: USER_B } },
      deps,
    );
    expect(smuggled.status).toBe(400);
    expect(String(smuggled.body.message)).toContain("user_id");
    const unknown = await handleSaveRiskRules(
      { token: "token-a", body: { ...rulesBody, stopLoss: 1 } },
      deps,
    );
    expect(unknown.status).toBe(400);
    expect(String(unknown.body.message)).toContain("stopLoss");
    expect(tables.risk_rules).toHaveLength(0);
  });

  it("schema-invalid → 400 with the web schema message", async () => {
    const { deps } = makeDeps();
    const res = await handleSaveRiskRules(
      { token: "token-a", body: { ...rulesBody, maxRiskPerTradePct: 0 } },
      deps,
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_argument");
    expect(res.body.message).toBe("Risk per trade must be at least 0.1%.");
  });

  it("happy path → 200 { ok: true }, rules stored for the token user, core audit risk_rules.saved", async () => {
    const { deps, audits, tables, a, admin } = makeDeps();
    const res = await handleSaveRiskRules({ token: "token-a", body: rulesBody }, deps);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const stored = a.fake.insertsFor("risk_rules");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      user_id: USER_A,
      max_risk_per_trade_pct: 1,
      max_daily_loss: 250,
      is_active: true,
    });
    expect(admin.fake.insertsFor("audit_logs").map((r) => r.action)).toContain("risk_rules.saved");
    expect(audits.filter((e) => e.operation === "risk_rules_saved")).toHaveLength(1);
    expect(tables.risk_rules.filter((r) => r.user_id === USER_B)).toHaveLength(0);
  });

  it("second save updates the active row instead of inserting a duplicate", async () => {
    const { deps, tables, a } = makeDeps();
    await handleSaveRiskRules({ token: "token-a", body: rulesBody }, deps);
    const res = await handleSaveRiskRules(
      { token: "token-a", body: { ...rulesBody, maxDailyLoss: 300 } },
      deps,
    );
    expect(res.status).toBe(200);
    expect(a.fake.insertsFor("risk_rules")).toHaveLength(1);
    expect(tables.risk_rules).toHaveLength(1);
    expect(tables.risk_rules[0].max_daily_loss).toBe(300);
  });
});

describe("handleSaveTradingPlan", () => {
  it("happy path → 200 { plan_id }, plan stored for the token user", async () => {
    const { deps, audits, a } = makeDeps();
    const res = await handleSaveTradingPlan({ token: "token-a", body: planBody }, deps);
    expect(res.status).toBe(200);
    const planId = res.body.plan_id as string;
    expect(typeof planId).toBe("string");
    const stored = a.fake.insertsFor("trading_plans");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      id: planId,
      user_id: USER_A,
      name: "London Gold Plan",
      markets: ["XAUUSD"],
      schedule: {},
    });
    expect(audits[0]).toMatchObject({ operation: "trading_plan_saved", outcome: "ok", entityId: planId });
  });

  it("re-save updates the same plan and returns the same plan_id", async () => {
    const { deps, tables } = makeDeps();
    const first = await handleSaveTradingPlan({ token: "token-a", body: planBody }, deps);
    const second = await handleSaveTradingPlan(
      { token: "token-a", body: { ...planBody, name: "Renamed Plan" } },
      deps,
    );
    expect(second.body.plan_id).toBe(first.body.plan_id);
    expect(tables.trading_plans).toHaveLength(1);
    expect(tables.trading_plans[0].name).toBe("Renamed Plan");
  });

  it("schema-invalid (empty name) → 400 with the web schema message", async () => {
    const { deps } = makeDeps();
    const res = await handleSaveTradingPlan(
      { token: "token-a", body: { ...planBody, name: "  " } },
      deps,
    );
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Give the plan a name.");
  });

  it("smuggled identity → 400 and no plan is written", async () => {
    const { deps, tables } = makeDeps();
    const res = await handleSaveTradingPlan(
      { token: "token-a", body: { ...planBody, profile_id: USER_B } },
      deps,
    );
    expect(res.status).toBe(400);
    expect(String(res.body.message)).toContain("profile_id");
    expect(tables.trading_plans).toHaveLength(0);
  });
});

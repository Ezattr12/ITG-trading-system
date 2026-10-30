import { describe, expect, it } from "vitest";
// Reuse the web app's fake-Supabase test helper (design §6):
// it applies recorded eq/in/is/order/limit filters to seeded
// rows, so a query that forgot its user_id filter returns the
// other trader's rows and the test fails.
import { fakeSupabase } from "../../web/lib/test-helpers/fake-supabase";
import { createToolCaller, parseTradeIdArg } from "./tools";
import { RateLimiter } from "./ratelimit";
import type { Authenticator } from "./auth";
import type { McpConfig } from "./config";
import type { DbClient } from "./db";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const TRADE_ID = "a227846a-c32b-46f2-9722-c2857843d741";
const MISSING_ID = "99999999-9999-4999-8999-999999999999";

function tradeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: TRADE_ID,
    user_id: USER_A,
    pair: "XAUUSD",
    direction: "long",
    entry_price: 4030,
    exit_price: 4042,
    tp: 4050,
    sl: 4022,
    position_size: 0.1,
    leverage: 1,
    fees: 0,
    opened_at: "2026-10-29T09:00:00.000Z",
    closed_at: "2026-10-29T10:00:00.000Z",
    status: "closed",
    strategy_id: "4e140f17-c229-4ef3-9f69-bde8a2c8810b",
    setup_id: "876bbdb9-f43f-4362-9c8b-69817278be97",
    market_condition: null,
    trade_reason: null,
    session: "london",
    notes: "Followed the plan.",
    pnl: 1.2,
    roi_pct: 0.297767,
    r_multiple: 1.5,
    risk_reward: 2.5,
    is_win: true,
    duration_seconds: 3600,
    reversal_trade_id: null,
    ...overrides,
  };
}

function seedTables(tradeOverrides: Record<string, unknown> = {}) {
  return {
    trades: [tradeRow(tradeOverrides)],
    psychology_records: [
      {
        trade_id: TRADE_ID,
        user_id: USER_A,
        confidence: 4,
        emotion: "calm",
        discipline: "good",
      },
    ],
    lessons: [
      {
        trade_id: TRADE_ID,
        user_id: USER_A,
        text: "Wait for confirmation before entering.",
        is_repeated_mistake: false,
        created_at: "2026-10-29T10:05:00.000Z",
        deleted_at: null,
      },
    ],
    trade_screenshots: [
      { id: "shot-1", trade_id: TRADE_ID, user_id: USER_A },
      { id: "shot-2", trade_id: TRADE_ID, user_id: USER_A },
    ],
    strategies: [{ id: "4e140f17-c229-4ef3-9f69-bde8a2c8810b", name: "BOS" }],
    setups: [{ id: "876bbdb9-f43f-4362-9c8b-69817278be97", name: "London open breakout" }],
    trading_plans: [
      {
        id: "plan-1",
        user_id: USER_A,
        name: "Main plan",
        risk_per_trade_pct: 1,
        max_daily_loss: 200,
        max_daily_trades: 5,
        is_active: true,
        deleted_at: null,
        updated_at: "2026-10-28T00:00:00.000Z",
      },
    ],
    risk_rules: [
      {
        user_id: USER_A,
        max_risk_per_trade_pct: 1,
        max_daily_loss: 200,
        max_leverage: 20,
        is_active: true,
        deleted_at: null,
        updated_at: "2026-10-28T00:00:00.000Z",
      },
    ],
    risk_events: [],
  };
}

interface AuditRow {
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  tool: string;
  outcome: string;
  durationMs: number;
  tradeId?: string | null;
  correlationId: string;
}

function makeCaller(
  tables: Record<string, Record<string, unknown>[]>,
  opts: { tokenUser?: Record<string, string>; rateLimiter?: RateLimiter } = {},
) {
  const { client } = fakeSupabase(tables);
  const auditRows: AuditRow[] = [];
  // The tool caller receives a service client; this recording
  // stand-in captures the audit_logs row writeAuditLog inserts
  // (column shape) and flattens it back into an AuditRow.
  const recordingServiceClient: DbClient = {
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        const details = row.details as Record<string, unknown>;
        auditRows.push({
          userId: (row.user_id as string | null) ?? null,
          action: String(row.action),
          entityType: String(row.entity_type),
          entityId: (row.entity_id as string | null) ?? null,
          tool: String(details.tool),
          outcome: String(details.outcome),
          durationMs: Number(details.duration_ms),
          tradeId: (details.arguments as { trade_id: string | null }).trade_id,
          correlationId: String(details.correlation_id),
        });
        return { error: null };
      },
    }),
  };
  const tokenUser = opts.tokenUser ?? { "token-a": USER_A, "token-b": USER_B };
  const authenticator: Authenticator = {
    async authenticate(token) {
      if (!token) return null;
      const userId = tokenUser[token];
      if (!userId) return null;
      return { userId, client: client as unknown as DbClient };
    },
  };
  const config: McpConfig = {
    supabaseUrl: "https://example.supabase.co",
    supabaseAnonKey: "anon",
    supabaseServiceRoleKey: "service",
    accessToken: "token-a",
    apiBaseUrl: "https://itg-traderos.vercel.app",
    configured: true,
  };
  const callTool = createToolCaller({
    config,
    authenticator,
    serviceClient: recordingServiceClient,
    rateLimiter: opts.rateLimiter ?? new RateLimiter(60, 1),
  });
  return { callTool, auditRows, setToken: (t: string) => (config.accessToken = t), config };
}

describe("parseTradeIdArg", () => {
  it("accepts exactly one uuid trade_id", () => {
    expect(parseTradeIdArg({ trade_id: TRADE_ID })).toEqual({
      tradeId: TRADE_ID,
      invalidMessage: null,
    });
  });

  it("rejects a smuggled user_id", () => {
    const parsed = parseTradeIdArg({ trade_id: TRADE_ID, user_id: USER_B });
    expect(parsed.invalidMessage).toBe("unknown argument: user_id");
  });

  it("rejects a non-uuid trade_id and a missing trade_id", () => {
    expect(parseTradeIdArg({ trade_id: "not-a-uuid" }).invalidMessage).toBe(
      "trade_id must be a uuid",
    );
    expect(parseTradeIdArg({}).invalidMessage).toBe("trade_id is required");
    expect(parseTradeIdArg(null).invalidMessage).toBe("arguments must be an object");
  });
});

describe("get_trade", () => {
  it("returns the trade with journal context, bounded projection", async () => {
    const { callTool, auditRows } = makeCaller(seedTables());
    const result = await callTool("get_trade", { trade_id: TRADE_ID });
    expect(result.isError).toBe(false);
    const payload = result.payload as {
      trade: { pair: string; metrics: { pnl: number } };
      strategy_name: string;
      setup_name: string;
      psychology: { emotion: string; confidence: number };
      lessons: { text: string }[];
      screenshot_count: number;
    };
    expect(payload.trade.pair).toBe("XAUUSD");
    expect(payload.trade.metrics.pnl).toBe(1.2);
    expect(payload.strategy_name).toBe("BOS");
    expect(payload.setup_name).toBe("London open breakout");
    expect(payload.psychology.emotion).toBe("calm");
    expect(payload.psychology.confidence).toBe(4);
    expect(payload.lessons).toHaveLength(1);
    expect(payload.screenshot_count).toBe(2);
    // Exactly one audit row, action + outcome correct.
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      action: "mcp.get_trade",
      outcome: "ok",
      userId: USER_A,
      entityId: TRADE_ID,
      entityType: "trades",
    });
  });

  it("returns not_found for a nonexistent trade, with one audit row", async () => {
    const { callTool, auditRows } = makeCaller(seedTables());
    const result = await callTool("get_trade", { trade_id: MISSING_ID });
    expect(result.isError).toBe(true);
    expect(result.payload).toEqual({
      error: { code: "not_found", message: "not_found: no such trade" },
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({ outcome: "not_found", entityId: MISSING_ID });
  });

  it("rejects a smuggled user_id argument before any query", async () => {
    const { callTool, auditRows } = makeCaller(seedTables());
    const result = await callTool("get_trade", {
      trade_id: TRADE_ID,
      user_id: USER_B,
    });
    expect(result.isError).toBe(true);
    expect((result.payload as { error: { code: string } }).error.code).toBe(
      "invalid_argument",
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({ outcome: "invalid_argument" });
  });

  it("rejects a malformed uuid", async () => {
    const { callTool, auditRows } = makeCaller(seedTables());
    const result = await callTool("get_trade", { trade_id: "x" });
    expect(result.isError).toBe(true);
    expect((result.payload as { error: { code: string } }).error.code).toBe(
      "invalid_argument",
    );
    expect(auditRows[0]).toMatchObject({ outcome: "invalid_argument", entityId: null });
  });

  it("cross-tenant: user B asking for user A's trade gets the identical not_found shape", async () => {
    const tables = seedTables();
    const asA = makeCaller(tables);
    const missing = await asA.callTool("get_trade", { trade_id: MISSING_ID });

    const asB = makeCaller(tables);
    asB.setToken("token-b");
    const notOwned = await asB.callTool("get_trade", { trade_id: TRADE_ID });

    expect(notOwned.isError).toBe(true);
    // No existence oracle: byte-identical error payload.
    expect(notOwned.payload).toEqual(missing.payload);
    expect(asB.auditRows[0]).toMatchObject({ outcome: "not_found", userId: USER_B });
  });

  it("unauthenticated when the token is invalid", async () => {
    const { callTool, auditRows, setToken } = makeCaller(seedTables());
    setToken("bogus-token");
    const result = await callTool("get_trade", { trade_id: TRADE_ID });
    expect(result.isError).toBe(true);
    expect((result.payload as { error: { code: string } }).error.code).toBe(
      "unauthenticated",
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({ outcome: "unauthenticated", userId: null });
  });

  it("caps long lesson text at 2000 chars with a truncated flag", async () => {
    const tables = seedTables();
    tables.lessons[0] = { ...tables.lessons[0], text: "x".repeat(2500) };
    const { callTool } = makeCaller(tables);
    const result = await callTool("get_trade", { trade_id: TRADE_ID });
    const payload = result.payload as { lessons: { text: string; truncated: boolean }[] };
    expect(payload.lessons[0].text).toHaveLength(2000);
    expect(payload.lessons[0].truncated).toBe(true);
  });
});

describe("analyze_trade", () => {
  it("recomputes metrics that match the stored values", async () => {
    const { callTool, auditRows } = makeCaller(seedTables());
    const result = await callTool("analyze_trade", { trade_id: TRADE_ID });
    expect(result.isError).toBe(false);
    const payload = result.payload as {
      metrics: {
        metrics_match: boolean;
        mismatches: string[];
        recomputed: { pnl: number; r_multiple: number; risk_reward: number };
      };
      plan_adherence: {
        stop_loss_present: boolean;
        leverage: { trade: number; rules_max: number; within_rules_limit: boolean };
        position_risk: { risk_amount: number; risk_pct_note: string };
      };
      journal_completeness: { complete: boolean; missing: string[] };
      findings: { rule: string }[];
    };
    expect(payload.metrics.metrics_match).toBe(true);
    expect(payload.metrics.mismatches).toEqual([]);
    expect(payload.metrics.recomputed.pnl).toBeCloseTo(1.2, 10);
    expect(payload.metrics.recomputed.r_multiple).toBeCloseTo(1.5, 10);
    expect(payload.metrics.recomputed.risk_reward).toBeCloseTo(2.5, 10);
    expect(payload.plan_adherence.stop_loss_present).toBe(true);
    expect(payload.plan_adherence.leverage).toEqual({
      trade: 1,
      rules_max: 20,
      within_rules_limit: true,
    });
    expect(payload.plan_adherence.position_risk.risk_amount).toBeCloseTo(0.8, 10);
    expect(payload.plan_adherence.position_risk.risk_pct_note).toContain(
      "not computable",
    );
    // market_condition / trade_reason are not part of the
    // completeness map; everything tracked is present.
    expect(payload.journal_completeness.complete).toBe(true);
    expect(payload.journal_completeness.missing).toEqual([]);
    expect(auditRows[0]).toMatchObject({
      action: "mcp.analyze_trade",
      outcome: "ok",
    });
  });

  it("flags metrics_match=false when the stored pnl was tampered with", async () => {
    const { callTool } = makeCaller(seedTables({ pnl: 99.99 }));
    const result = await callTool("analyze_trade", { trade_id: TRADE_ID });
    const payload = result.payload as {
      metrics: { metrics_match: boolean; mismatches: string[] };
      findings: { rule: string }[];
    };
    expect(payload.metrics.metrics_match).toBe(false);
    expect(payload.metrics.mismatches).toContain("pnl");
    expect(payload.findings.map((f) => f.rule)).toContain("metrics_drift");
  });

  it("reports missing SL/TP honestly and marks the journal incomplete", async () => {
    const tables = seedTables({
      sl: null,
      tp: null,
      r_multiple: null,
      risk_reward: null,
      session: null,
      notes: null,
    });
    tables.psychology_records = [];
    tables.lessons = [];
    tables.trade_screenshots = [];
    const { callTool } = makeCaller(tables);
    const result = await callTool("analyze_trade", { trade_id: TRADE_ID });
    const payload = result.payload as {
      plan_adherence: { stop_loss_present: boolean; take_profit_present: boolean };
      journal_completeness: { complete: boolean; missing: string[] };
      findings: { rule: string }[];
    };
    expect(payload.plan_adherence.stop_loss_present).toBe(false);
    expect(payload.plan_adherence.take_profit_present).toBe(false);
    expect(payload.journal_completeness.complete).toBe(false);
    expect(payload.journal_completeness.missing).toEqual(
      expect.arrayContaining(["session", "emotion", "lesson", "notes", "screenshot"]),
    );
    expect(payload.findings.map((f) => f.rule)).toEqual(
      expect.arrayContaining(["no_stop_loss", "no_take_profit", "journal_incomplete"]),
    );
  });
});

describe("rate limiting", () => {
  it("trips after 60 calls in a minute for the same trader", async () => {
    const { callTool, auditRows } = makeCaller(seedTables(), {
      rateLimiter: new RateLimiter(60, 0),
    });
    let lastCode = "";
    for (let i = 0; i < 61; i += 1) {
      const result = await callTool("get_trade", { trade_id: TRADE_ID });
      if (result.isError) {
        lastCode = (result.payload as { error: { code: string } }).error.code;
      }
    }
    expect(lastCode).toBe("rate_limited");
    expect(auditRows).toHaveLength(61);
    expect(auditRows[60]).toMatchObject({ outcome: "rate_limited" });
    expect(auditRows.slice(0, 60).every((r) => r.outcome === "ok")).toBe(true);
  });
});

describe("unknown tools", () => {
  it("rejects an unknown tool name and still audits once", async () => {
    const { callTool, auditRows } = makeCaller(seedTables());
    const result = await callTool("delete_trade", { trade_id: TRADE_ID });
    expect(result.isError).toBe(true);
    expect((result.payload as { error: { code: string } }).error.code).toBe(
      "invalid_argument",
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].action).toBe("mcp.unknown_tool");
  });
});

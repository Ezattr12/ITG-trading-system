import { describe, expect, it } from "vitest";
// Same fake-Supabase helper as the Stage 3 tests: it applies
// recorded eq/in/is/order/limit filters to seeded rows, so a
// query that forgot its user_id filter returns the other
// trader's rows and the test fails.
import { fakeSupabase } from "../../web/lib/test-helpers/fake-supabase";
import { createToolCaller, TOOL_DEFINITIONS } from "./tools";
import { mondayOfWeek, addDays } from "./common";
import { RateLimiter } from "./ratelimit";
import type { Authenticator } from "./auth";
import type { McpConfig } from "./config";
import type { DbClient } from "./db";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const S1 = "4e140f17-c229-4ef3-9f69-bde8a2c8810b";
const S2 = "51f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b";

const TODAY = new Date().toISOString().slice(0, 10);
const YESTERDAY = addDays(TODAY, -1);
const MONDAY = mondayOfWeek(TODAY);

// ------------------------------------------------------------ harness

interface RawAuditRow {
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: {
    tool: string;
    outcome: string;
    arguments: Record<string, unknown>;
  };
}

function makeCaller(tables: Record<string, Record<string, unknown>[]>) {
  const { client } = fakeSupabase(tables);
  const auditRows: RawAuditRow[] = [];
  const recordingServiceClient: DbClient = {
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        auditRows.push(row as unknown as RawAuditRow);
        return { error: null };
      },
    }),
  };
  const tokenUser: Record<string, string> = { "token-a": USER_A, "token-b": USER_B };
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
    rateLimiter: new RateLimiter(60, 1),
  });
  return { callTool, auditRows, setToken: (t: string) => (config.accessToken = t) };
}

function errCode(result: { payload: unknown }): string {
  return (result.payload as { error: { code: string } }).error.code;
}
function errMessage(result: { payload: unknown }): string {
  return (result.payload as { error: { message: string } }).error.message;
}

// ------------------------------------------------------------ fixtures
//
// October 2026 closed trades for user A (the performance set):
//   T1 XAUUSD pnl +100, R 2.0, strategy BOS, session london
//   T2 XAUUSD pnl  -50, R -1.0, strategy BOS, session london
//   T3 EURUSD pnl  +30, R 0.6, strategy Liquidity Sweep, session new_york
//   T4 EURUSD pnl  -20, R null, no strategy, no session
// plus T5 (closed in November — out of range), T6 (open),
// T7 (reversed), and TB (user B's trade, pnl +777).
//
// Hand-computed October summary for A:
//   pnls (chronological) = [100, -50, 30, -20]
//   count 4, wins 2, losses 2, breakeven 0, net = 60
//   win rate = 50, loss rate = 50
//   avg win = (100+30)/2 = 65; avg loss = (-50-20)/2 = -35
//   profit factor = gross profit 130 / gross loss 70 ≈ 1.857142857
//   expectancy = 60/4 = 15
//   avg R = (2.0 - 1.0 + 0.6)/3 = 1.6/3 ≈ 0.533333 (T4 has no R)
//   equity curve = [100, 50, 80, 60] → max drawdown = 100-50 = 50
//   current streak: last trade lost, the one before won → -1
//   best = T1 (+100), worst = T2 (-50)

function closedTrade(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    pair: "XAUUSD",
    direction: "long",
    status: "closed",
    opened_at: "2026-10-05T09:00:00.000Z",
    closed_at: "2026-10-05T10:00:00.000Z",
    pnl: 0,
    r_multiple: null,
    strategy_id: null,
    session: null,
    user_id: USER_A,
    ...overrides,
  };
}

function performanceTables() {
  return {
    trades: [
      closedTrade({ id: "t1", pnl: 100, r_multiple: 2, strategy_id: S1, session: "london", opened_at: "2026-10-05T09:00:00.000Z", closed_at: "2026-10-05T10:00:00.000Z" }),
      closedTrade({ id: "t2", direction: "short", pnl: -50, r_multiple: -1, strategy_id: S1, session: "london", opened_at: "2026-10-06T09:00:00.000Z", closed_at: "2026-10-06T11:00:00.000Z" }),
      closedTrade({ id: "t3", pair: "EURUSD", pnl: 30, r_multiple: 0.6, strategy_id: S2, session: "new_york", opened_at: "2026-10-07T09:00:00.000Z", closed_at: "2026-10-07T10:00:00.000Z" }),
      closedTrade({ id: "t4", pair: "EURUSD", pnl: -20, opened_at: "2026-10-08T09:00:00.000Z", closed_at: "2026-10-08T10:00:00.000Z" }),
      closedTrade({ id: "t5", pair: "GBPUSD", pnl: 999, r_multiple: 9, opened_at: "2026-11-01T09:00:00.000Z", closed_at: "2026-11-02T10:00:00.000Z" }),
      { id: "t6", user_id: USER_A, pair: "XAUUSD", direction: "long", status: "open", opened_at: "2026-10-08T12:00:00.000Z", closed_at: null, pnl: null, r_multiple: null, strategy_id: S1 },
      closedTrade({ id: "t7", pair: "EURUSD", pnl: 500, status: "reversed", opened_at: "2026-10-09T09:00:00.000Z", closed_at: "2026-10-09T10:00:00.000Z" }),
      closedTrade({ id: "tb", user_id: USER_B, pair: "BTCUSD", pnl: 777, r_multiple: 1, session: "asia", opened_at: "2026-10-05T09:00:00.000Z", closed_at: "2026-10-05T12:00:00.000Z" }),
    ],
    strategies: [
      { id: S1, name: "BOS" },
      { id: S2, name: "Liquidity Sweep" },
    ],
    psychology_records: [
      { trade_id: "t1", user_id: USER_A, confidence: 4, emotion: "calm", discipline: "good" },
      { trade_id: "t2", user_id: USER_A, confidence: 2, emotion: "revenge", discipline: "poor" },
      { trade_id: "t3", user_id: USER_A, confidence: 5, emotion: "calm", discipline: "good" },
      // t4 deliberately has no psychology record.
    ],
  };
}

const RANGE = { from: "2026-10-01", to: "2026-10-31" };

// ------------------------------------------------------------ catalog

describe("tool catalog", () => {
  it("exposes the 12 DB tools; compute_coach_insights arrived in Phase 20 (13 total)", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    // Stage 4 deferred compute_coach_insights to avoid copying
    // the coach engine into this server; Phase 20 implemented
    // it as an endpoint call instead (see coach.test.ts), so
    // the catalog is now 13 — asserted in full in server.test.ts.
    expect(names).toHaveLength(13);
    expect(names).toContain("compute_coach_insights");
  });
});

// ------------------------------------------------------------ get_recent_trades

describe("get_recent_trades", () => {
  it("returns newest first with strategy names and pagination metadata", async () => {
    const { callTool, auditRows } = makeCaller(performanceTables());
    const result = await callTool("get_recent_trades", {});
    expect(result.isError).toBe(false);
    const payload = result.payload as {
      trades: { id: string; strategy_name: string | null; status: string }[];
      pagination: { returned: number; limit: number; truncated: boolean };
    };
    // All 7 of A's trades (any status), opened_at descending.
    expect(payload.trades.map((t) => t.id)).toEqual([
      "t5", "t7", "t6", "t4", "t3", "t2", "t1",
    ]);
    expect(payload.trades.find((t) => t.id === "t1")?.strategy_name).toBe("BOS");
    expect(payload.trades.find((t) => t.id === "t4")?.strategy_name).toBeNull();
    expect(payload.pagination).toEqual({ returned: 7, limit: 10, truncated: false });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      action: "mcp.get_recent_trades",
      entity_type: "trades",
    });
    expect(auditRows[0].details.outcome).toBe("ok");
    expect(auditRows[0].details.arguments).toEqual({ limit: 10 });
  });

  it("paginates with truncated=true and filters by pair substring", async () => {
    const { callTool } = makeCaller(performanceTables());
    const page = await callTool("get_recent_trades", { limit: 3 });
    const pagePayload = page.payload as {
      trades: { id: string }[];
      pagination: { returned: number; truncated: boolean };
    };
    expect(pagePayload.trades.map((t) => t.id)).toEqual(["t5", "t7", "t6"]);
    expect(pagePayload.pagination.truncated).toBe(true);

    const filtered = await callTool("get_recent_trades", { pair: "xau" });
    const filteredPayload = filtered.payload as { trades: { id: string }[] };
    expect(filteredPayload.trades.map((t) => t.id)).toEqual(["t6", "t2", "t1"]);
  });

  it("validates limit and pair", async () => {
    const { callTool } = makeCaller(performanceTables());
    for (const bad of [{ limit: 0 }, { limit: 51 }, { limit: 2.5 }, { limit: "5" }]) {
      const result = await callTool("get_recent_trades", bad);
      expect(errCode(result)).toBe("invalid_argument");
      expect(errMessage(result)).toContain("limit");
    }
    const badPair = await callTool("get_recent_trades", { pair: "  " });
    expect(errMessage(badPair)).toContain("pair");
  });

  it("cross-tenant: user B sees only their own trades", async () => {
    const { callTool, setToken } = makeCaller(performanceTables());
    setToken("token-b");
    const result = await callTool("get_recent_trades", {});
    const payload = result.payload as { trades: { id: string }[] };
    expect(payload.trades.map((t) => t.id)).toEqual(["tb"]);
  });
});

// ------------------------------------------------------------ get_performance_summary

describe("get_performance_summary", () => {
  it("matches the hand-computed October aggregates", async () => {
    const { callTool, auditRows } = makeCaller(performanceTables());
    const result = await callTool("get_performance_summary", RANGE);
    expect(result.isError).toBe(false);
    const payload = result.payload as {
      summary: Record<string, number | null>;
      best_trade: { id: string; pnl: number } | null;
      worst_trade: { id: string; pnl: number } | null;
    };
    expect(payload.summary).toMatchObject({
      trade_count: 4,
      wins: 2,
      losses: 2,
      breakeven: 0,
      net_pnl: 60,
      win_rate_pct: 50,
      loss_rate_pct: 50,
      avg_win: 65,
      avg_loss: -35,
      expectancy: 15,
      max_drawdown: 50,
      current_streak: -1,
    });
    expect(payload.summary.profit_factor).toBeCloseTo(130 / 70, 10);
    expect(payload.summary.avg_r).toBeCloseTo(1.6 / 3, 10);
    expect(payload.best_trade).toEqual({ id: "t1", pair: "XAUUSD", pnl: 100 });
    expect(payload.worst_trade).toEqual({ id: "t2", pair: "XAUUSD", pnl: -50 });
    expect(auditRows[0]).toMatchObject({ action: "mcp.get_performance_summary" });
    expect(auditRows[0].details.arguments).toEqual(RANGE);
  });

  it("empty range returns honest zeros and nulls, not invented values", async () => {
    const { callTool } = makeCaller(performanceTables());
    const result = await callTool("get_performance_summary", {
      from: "2020-01-01",
      to: "2020-01-31",
    });
    const payload = result.payload as {
      summary: Record<string, number | null>;
      best_trade: unknown;
      worst_trade: unknown;
    };
    expect(payload.summary).toEqual({
      trade_count: 0,
      wins: 0,
      losses: 0,
      breakeven: 0,
      net_pnl: 0,
      win_rate_pct: null,
      loss_rate_pct: null,
      avg_win: null,
      avg_loss: null,
      profit_factor: null,
      expectancy: null,
      avg_r: null,
      max_drawdown: 0,
      current_streak: 0,
    });
    expect(payload.best_trade).toBeNull();
    expect(payload.worst_trade).toBeNull();
  });

  it("cross-tenant: user B's summary counts only their own trade", async () => {
    const { callTool, setToken } = makeCaller(performanceTables());
    setToken("token-b");
    const result = await callTool("get_performance_summary", RANGE);
    const payload = result.payload as { summary: Record<string, number | null> };
    expect(payload.summary).toMatchObject({ trade_count: 1, net_pnl: 777, win_rate_pct: 100 });
  });

  it("validates the range and rejects smuggled arguments, naming the field", async () => {
    const { callTool } = makeCaller(performanceTables());
    const reversed = await callTool("get_performance_summary", {
      from: "2026-10-31",
      to: "2026-10-01",
    });
    expect(errCode(reversed)).toBe("invalid_argument");
    expect(errMessage(reversed)).toContain("from");

    const tooWide = await callTool("get_performance_summary", {
      from: "2025-01-01",
      to: "2026-12-31",
    });
    expect(errMessage(tooWide)).toContain("366");

    const badDate = await callTool("get_performance_summary", {
      from: "10/01/2026",
      to: "2026-10-31",
    });
    expect(errMessage(badDate)).toContain("from");

    const impossible = await callTool("get_performance_summary", {
      from: "2026-02-30",
      to: "2026-10-31",
    });
    expect(errCode(impossible)).toBe("invalid_argument");

    const missing = await callTool("get_performance_summary", { from: "2026-10-01" });
    expect(errMessage(missing)).toContain("to is required");

    const smuggled = await callTool("get_performance_summary", {
      ...RANGE,
      user_id: USER_B,
    });
    expect(errMessage(smuggled)).toContain("unknown argument: user_id");
  });
});

// ------------------------------------------------------------ strategy / session performance

describe("get_strategy_performance", () => {
  it("groups by strategy, sorted by net P&L descending", async () => {
    const { callTool } = makeCaller(performanceTables());
    const result = await callTool("get_strategy_performance", RANGE);
    const payload = result.payload as {
      groups: Record<string, unknown>[];
      groups_total: number;
    };
    expect(payload.groups_total).toBe(3);
    // BOS: pnls [100,-50] → net 50, PF 100/50 = 2, avgR (2-1)/2 = 0.5
    expect(payload.groups[0]).toMatchObject({
      strategy_id: S1,
      strategy_name: "BOS",
      trade_count: 2,
      net_pnl: 50,
      win_rate_pct: 50,
      profit_factor: 2,
      avg_r: 0.5,
    });
    // Liquidity Sweep: [30] → net 30, no losses → profit factor null
    expect(payload.groups[1]).toMatchObject({
      strategy_id: S2,
      strategy_name: "Liquidity Sweep",
      trade_count: 1,
      net_pnl: 30,
      profit_factor: null,
      avg_loss: null,
    });
    // No strategy: [-20] → net -20, profit factor 0/20 = 0
    expect(payload.groups[2]).toMatchObject({
      strategy_id: null,
      strategy_name: "No strategy",
      trade_count: 1,
      net_pnl: -20,
      profit_factor: 0,
      avg_r: null,
    });
  });
});

describe("get_session_performance", () => {
  it("groups by the trade's session, missing sessions as Not Provided", async () => {
    const { callTool } = makeCaller(performanceTables());
    const result = await callTool("get_session_performance", RANGE);
    const payload = result.payload as { groups: Record<string, unknown>[] };
    expect(payload.groups.map((g) => g.session)).toEqual([
      "london",
      "new_york",
      "Not Provided",
    ]);
    expect(payload.groups[0]).toMatchObject({ trade_count: 2, net_pnl: 50 });
    expect(payload.groups[2]).toMatchObject({ trade_count: 1, net_pnl: -20 });
  });
});

// ------------------------------------------------------------ get_psychology_summary
//
// Hand-computed from the fixture (T1 calm/4/good +100, T2 revenge/2/poor -50,
// T3 calm/5/good +30, T4 no record -20):
//   by emotion:  calm {2 trades, net 130, win 100}, revenge {1, -50, 0}
//   bands:       1-2 {1 (T2), -50, 0}, 3 {0, 0, null}, 4-5 {2, 130, 100}
//   by discipline: good {2, 130, 100}, poor {1, -50, 0}
//   avg confidence = (4+2+5)/3 ≈ 3.6667; closed 4, with records 3, without 1

describe("get_psychology_summary", () => {
  it("aggregates emotion, confidence bands and discipline", async () => {
    const { callTool } = makeCaller(performanceTables());
    const result = await callTool("get_psychology_summary", RANGE);
    const payload = result.payload as {
      closed_trades: number;
      with_psychology_records: number;
      without_psychology_records: number;
      by_emotion: Record<string, unknown>[];
      by_confidence_band: Record<string, unknown>[];
      by_discipline: Record<string, unknown>[];
      avg_confidence: number | null;
    };
    expect(payload.closed_trades).toBe(4);
    expect(payload.with_psychology_records).toBe(3);
    expect(payload.without_psychology_records).toBe(1);
    expect(payload.by_emotion).toEqual([
      { emotion: "calm", trades: 2, net_pnl: 130, win_rate_pct: 100 },
      { emotion: "revenge", trades: 1, net_pnl: -50, win_rate_pct: 0 },
    ]);
    expect(payload.by_confidence_band).toEqual([
      { band: "1-2", trades: 1, net_pnl: -50, win_rate_pct: 0 },
      { band: "3", trades: 0, net_pnl: 0, win_rate_pct: null },
      { band: "4-5", trades: 2, net_pnl: 130, win_rate_pct: 100 },
    ]);
    expect(payload.by_discipline).toEqual([
      { discipline: "good", trades: 2, net_pnl: 130, win_rate_pct: 100 },
      { discipline: "poor", trades: 1, net_pnl: -50, win_rate_pct: 0 },
    ]);
    expect(payload.avg_confidence).toBeCloseTo(11 / 3, 10);
  });

  it("empty range states zero presence honestly", async () => {
    const { callTool } = makeCaller(performanceTables());
    const result = await callTool("get_psychology_summary", {
      from: "2020-01-01",
      to: "2020-01-31",
    });
    const payload = result.payload as {
      closed_trades: number;
      by_emotion: unknown[];
      avg_confidence: number | null;
    };
    expect(payload.closed_trades).toBe(0);
    expect(payload.by_emotion).toEqual([]);
    expect(payload.avg_confidence).toBeNull();
  });
});

// ------------------------------------------------------------ get_risk_status

function riskTables() {
  return {
    risk_rules: [
      {
        id: "rr-1",
        user_id: USER_A,
        plan_id: null,
        max_risk_per_trade_pct: 1,
        max_daily_loss: 200,
        max_trades_per_day: 5,
        max_consecutive_losses: 3,
        max_leverage: 20,
        is_active: true,
        deleted_at: null,
        updated_at: "2026-10-28T00:00:00.000Z",
      },
    ],
    trading_plans: [
      {
        id: "plan-1",
        user_id: USER_A,
        name: "Audit Trading Plan",
        risk_per_trade_pct: 1,
        max_daily_loss: 200,
        max_daily_trades: 5,
        is_active: true,
        deleted_at: null,
        updated_at: "2026-10-28T00:00:00.000Z",
      },
    ],
    risk_events: [
      { id: "e1", user_id: USER_A, severity: "warning", created_at: `${TODAY}T08:00:00.000Z`, resolved_at: `${TODAY}T09:00:00.000Z` },
      { id: "e2", user_id: USER_A, severity: "critical", created_at: `${TODAY}T10:00:00.000Z`, resolved_at: null },
      { id: "e3", user_id: USER_A, severity: "warning", created_at: `${YESTERDAY}T10:00:00.000Z`, resolved_at: null },
      { id: "eb", user_id: USER_B, severity: "critical", created_at: `${TODAY}T10:00:00.000Z`, resolved_at: null },
    ],
  };
}

describe("get_risk_status", () => {
  it("returns stored rules, plan, today's events by severity and open count", async () => {
    const { callTool, auditRows } = makeCaller(riskTables());
    const result = await callTool("get_risk_status", {});
    expect(result.isError).toBe(false);
    const payload = result.payload as {
      date: string;
      rules: Record<string, unknown> | null;
      plan: Record<string, unknown> | null;
      todays_events: { total: number; by_severity: Record<string, number> };
      open_events: number;
    };
    expect(payload.date).toBe(TODAY);
    expect(payload.rules).toMatchObject({
      max_risk_per_trade_pct: 1,
      max_daily_loss: 200,
      max_trades_per_day: 5,
      max_consecutive_losses: 3,
      max_leverage: 20,
    });
    expect(payload.plan).toMatchObject({ name: "Audit Trading Plan", max_daily_trades: 5 });
    // e1 (warning, today) + e2 (critical, today); e3 is yesterday; eb is user B's.
    expect(payload.todays_events).toEqual({
      total: 2,
      by_severity: { warning: 1, critical: 1, positive: 0 },
    });
    // Unresolved: e2 + e3 (e1 resolved; eb belongs to B).
    expect(payload.open_events).toBe(2);
    expect(auditRows[0]).toMatchObject({
      action: "mcp.get_risk_status",
      entity_type: "risk_rules",
    });
  });

  it("rejects any argument", async () => {
    const { callTool } = makeCaller(riskTables());
    const result = await callTool("get_risk_status", { user_id: USER_A });
    expect(errCode(result)).toBe("invalid_argument");
    expect(errMessage(result)).toContain("unknown argument: user_id");
  });

  it("no rules and no plan returns nulls, not invented limits", async () => {
    const { callTool } = makeCaller({ risk_rules: [], trading_plans: [], risk_events: [] });
    const result = await callTool("get_risk_status", {});
    const payload = result.payload as { rules: unknown; plan: unknown; open_events: number };
    expect(payload.rules).toBeNull();
    expect(payload.plan).toBeNull();
    expect(payload.open_events).toBe(0);
  });
});

// ------------------------------------------------------------ get_goal_progress
//
// Windows are relative to today, so the fixtures are too:
//   GT1/GT2 opened+closed today (GT1 journaled via a psychology
//   record, GT2 not); GT3 opened+closed yesterday.
//   One activity row today: study 4h, backtesting 3, trading sessions 2.
//   G1 max_trades (daily, target 3): opened today = 2 → 2 (66.67%)
//     — a manual entry of 99 exists and must NOT win over the measurement.
//   G2 journal_completion (weekly, target 2): closed this week ≥ GT1+GT2,
//     journaled = 1 → progress 1 (50%) regardless of GT3's week.
//   G3 study_hours (monthly, target 10): 4 → 40%
//   G4 other (target 10): manual entries 2 (yesterday) then 4 (today) → 4 (40%)
//   G5 performance_target: not measured here, no manual → null + note
//   G6 backtesting_sessions (weekly, target 5): 3 → 60%

function goalTables() {
  const dayTrade = (id: string, date: string) => ({
    id,
    user_id: USER_A,
    opened_at: `${date}T09:00:00.000Z`,
    closed_at: `${date}T10:00:00.000Z`,
    status: "closed",
  });
  return {
    goals: [
      { id: "g1", user_id: USER_A, title: "Max 3 trades a day", period: "daily", goal_type: "max_trades", target_value: 3, target_unit: "trades", start_date: TODAY, end_date: null, status: "active", deleted_at: null, created_at: `${TODAY}T00:00:00.000Z` },
      { id: "g2", user_id: USER_A, title: "Journal every trade", period: "weekly", goal_type: "journal_completion", target_value: 2, target_unit: "trades", start_date: MONDAY, end_date: null, status: "active", deleted_at: null, created_at: `${TODAY}T00:00:00.000Z` },
      { id: "g3", user_id: USER_A, title: "Study 10h a month", period: "monthly", goal_type: "study_hours", target_value: 10, target_unit: "hours", start_date: TODAY.slice(0, 8) + "01", end_date: null, status: "active", deleted_at: null, created_at: `${TODAY}T00:00:00.000Z` },
      { id: "g4", user_id: USER_A, title: "Journaling habit", period: "weekly", goal_type: "other", target_value: 10, target_unit: "entries", start_date: MONDAY, end_date: null, status: "active", deleted_at: null, created_at: `${TODAY}T00:00:00.000Z` },
      { id: "g5", user_id: USER_A, title: "Make 500 this month", period: "monthly", goal_type: "performance_target", target_value: 500, target_unit: "usd", start_date: TODAY.slice(0, 8) + "01", end_date: null, status: "active", deleted_at: null, created_at: `${TODAY}T00:00:00.000Z` },
      { id: "g6", user_id: USER_A, title: "Backtest 5x a week", period: "weekly", goal_type: "backtesting_sessions", target_value: 5, target_unit: "sessions", start_date: MONDAY, end_date: null, status: "active", deleted_at: null, created_at: `${TODAY}T00:00:00.000Z` },
    ],
    goal_progress: [
      { goal_id: "g1", user_id: USER_A, current_value: 99, recorded_date: TODAY },
      { goal_id: "g4", user_id: USER_A, current_value: 2, recorded_date: YESTERDAY },
      { goal_id: "g4", user_id: USER_A, current_value: 4, recorded_date: TODAY },
    ],
    trades: [dayTrade("gt1", TODAY), dayTrade("gt2", TODAY), dayTrade("gt3", YESTERDAY)],
    psychology_records: [{ trade_id: "gt1", user_id: USER_A }],
    lessons: [],
    daily_activity: [
      { user_id: USER_A, activity_date: TODAY, study_hours: 4, backtesting_sessions: 3, trading_sessions_count: 2 },
    ],
  };
}

describe("get_goal_progress", () => {
  it("measures count-based goals, falls back to manual, and is honest about the rest", async () => {
    const { callTool, auditRows } = makeCaller(goalTables());
    const result = await callTool("get_goal_progress", {});
    expect(result.isError).toBe(false);
    const payload = result.payload as {
      goals: Record<string, unknown>[];
      count: number;
    };
    expect(payload.count).toBe(6);
    const byId = new Map(payload.goals.map((g) => [g.id, g]));

    expect(byId.get("g1")).toMatchObject({ progress: 2, progress_source: "measured" });
    expect(byId.get("g1")?.percent).toBeCloseTo(200 / 3, 8);
    expect(byId.get("g2")).toMatchObject({ progress: 1, percent: 50, progress_source: "measured" });
    expect(byId.get("g3")).toMatchObject({ progress: 4, percent: 40, progress_source: "measured" });
    expect(byId.get("g4")).toMatchObject({ progress: 4, percent: 40, progress_source: "manual" });
    expect(byId.get("g5")).toMatchObject({
      progress: null,
      percent: null,
      progress_source: "none",
      progress_note: "Measured in the app",
    });
    expect(byId.get("g6")).toMatchObject({ progress: 3, percent: 60, progress_source: "measured" });
    expect(byId.get("g1")).toMatchObject({ title: "Max 3 trades a day", goal_type: "max_trades", target_value: 3, target_unit: "trades", period: "daily", status: "active" });
    expect(auditRows[0]).toMatchObject({ action: "mcp.get_goal_progress", entity_type: "goals" });
  });

  it("no goals returns an empty list", async () => {
    const { callTool } = makeCaller({ goals: [], goal_progress: [] });
    const result = await callTool("get_goal_progress", {});
    expect(result.payload).toEqual({ goals: [], count: 0 });
  });
});

// ------------------------------------------------------------ get_discipline_status

describe("get_discipline_status", () => {
  it("returns the latest stored events and the unread count", async () => {
    const { callTool } = makeCaller({
      discipline_events: [
        { id: "d1", user_id: USER_A, kind: "missed_journal", level: 1, message: "Day 1 reminder", event_date: "2026-10-27", created_at: "2026-10-27T08:00:00.000Z" },
        { id: "d2", user_id: USER_A, kind: "missed_journal", level: 2, message: "Day 2 warning", event_date: "2026-10-28", created_at: "2026-10-28T08:00:00.000Z" },
        { id: "d3", user_id: USER_A, kind: "rule_breach", level: 1, message: "Risk rule breached", event_date: "2026-10-29", created_at: "2026-10-29T08:00:00.000Z" },
        { id: "db", user_id: USER_B, kind: "missed_journal", level: 3, message: "B event", event_date: "2026-10-29", created_at: "2026-10-29T09:00:00.000Z" },
      ],
      notifications: [
        { id: "n1", user_id: USER_A, is_read: false },
        { id: "n2", user_id: USER_A, is_read: false },
        { id: "n3", user_id: USER_A, is_read: true },
        { id: "n4", user_id: USER_B, is_read: false },
      ],
    });
    const result = await callTool("get_discipline_status", {});
    const payload = result.payload as {
      recent_events: { id: string; kind: string; level: number }[];
      unread_notifications: number;
    };
    expect(payload.recent_events.map((e) => e.id)).toEqual(["d3", "d2", "d1"]);
    expect(payload.recent_events[0]).toMatchObject({ kind: "rule_breach", level: 1 });
    expect(payload.unread_notifications).toBe(2);
  });
});

// ------------------------------------------------------------ get_level_status
//
// XP fixture for A: +30 weekly_review, +25 risk_discipline,
// +15 backtest_session, +10 trade_journal, -5 penalty → total 75.

function levelTables() {
  return {
    levels: [{ id: "lvl-silver", name: "Silver" }],
    user_levels: [
      {
        user_id: USER_A,
        level_id: "lvl-silver",
        score: 47.5,
        score_breakdown: { discipline: 60, risk: 40 },
        calculated_at: "2026-10-29T00:00:00.000Z",
        updated_at: "2026-10-29T00:00:00.000Z",
      },
    ],
    xp_transactions: [
      { user_id: USER_A, amount: 10, reason: "trade_journal", note: "Journal completed", created_at: "2026-10-29T10:00:00.000Z" },
      { user_id: USER_A, amount: 30, reason: "weekly_review", note: null, created_at: "2026-10-29T09:00:00.000Z" },
      { user_id: USER_A, amount: 25, reason: "risk_discipline", note: null, created_at: "2026-10-28T09:00:00.000Z" },
      { user_id: USER_A, amount: -5, reason: "penalty", note: "Rule breach", created_at: "2026-10-27T09:00:00.000Z" },
      { user_id: USER_A, amount: 15, reason: "backtest_session", note: null, created_at: "2026-10-26T09:00:00.000Z" },
    ],
  };
}

describe("get_level_status", () => {
  it("returns the stored level and XP totals by reason", async () => {
    const { callTool, auditRows } = makeCaller(levelTables());
    const result = await callTool("get_level_status", {});
    const payload = result.payload as {
      level: { name: string; score: number; score_breakdown: Record<string, number> } | null;
      level_note: string | null;
      xp: {
        total: number;
        by_reason: { reason: string; total_xp: number; events: number }[];
        recent_events: { reason: string; amount: number }[];
      };
    };
    expect(payload.level).toMatchObject({
      name: "Silver",
      score: 47.5,
      score_breakdown: { discipline: 60, risk: 40 },
    });
    expect(payload.level_note).toBeNull();
    expect(payload.xp.total).toBe(75);
    expect(payload.xp.by_reason).toEqual([
      { reason: "weekly_review", total_xp: 30, events: 1 },
      { reason: "risk_discipline", total_xp: 25, events: 1 },
      { reason: "backtest_session", total_xp: 15, events: 1 },
      { reason: "trade_journal", total_xp: 10, events: 1 },
      { reason: "penalty", total_xp: -5, events: 1 },
    ]);
    expect(payload.xp.recent_events.map((e) => e.amount)).toEqual([10, 30, 25, -5, 15]);
    expect(auditRows[0]).toMatchObject({ action: "mcp.get_level_status", entity_type: "user_levels" });
  });

  it("no stored level returns level null with the honest note (user B)", async () => {
    const { callTool, setToken } = makeCaller(levelTables());
    setToken("token-b");
    const result = await callTool("get_level_status", {});
    const payload = result.payload as {
      level: unknown;
      level_note: string | null;
      xp: { total: number; by_reason: unknown[]; recent_events: unknown[] };
    };
    expect(payload.level).toBeNull();
    expect(payload.level_note).toContain("No stored level yet");
    expect(payload.xp).toMatchObject({ total: 0, by_reason: [], recent_events: [] });
  });
});

// ------------------------------------------------------------ get_weekly_review
//
// Week trades for A (closed Monday +40 R 1.0, Wednesday -10 R -0.5):
//   summary: count 2, net 30, win rate 50, avg win 40, avg loss -10,
//   profit factor 40/10 = 4, expectancy 15, avg R (1 - 0.5)/2 = 0.25,
//   equity [40, 30] → max drawdown 10, streak -1.

function weeklyReviewTables() {
  const wednesday = addDays(MONDAY, 2);
  return {
    weekly_reviews: [
      {
        id: "rev-1",
        user_id: USER_A,
        week_start_date: MONDAY,
        week_end_date: addDays(MONDAY, 6),
        trades_count: 4,
        total_pnl: 60,
        win_rate_pct: 50,
        journal_completion_pct: 75,
        best_strategy: "BOS",
        worst_strategy: "Liquidity Sweep",
        main_mistake: "Chased two entries",
        focus_next_week: "Wait for confirmation",
        review_text: "x".repeat(2500),
        status: "completed",
      },
    ],
    trades: [
      closedTrade({ id: "w1", pnl: 40, r_multiple: 1, opened_at: `${MONDAY}T09:00:00.000Z`, closed_at: `${MONDAY}T10:00:00.000Z` }),
      closedTrade({ id: "w2", pnl: -10, r_multiple: -0.5, opened_at: `${wednesday}T09:00:00.000Z`, closed_at: `${wednesday}T10:00:00.000Z` }),
      closedTrade({ id: "w3", pnl: 500, opened_at: `${addDays(MONDAY, 7)}T09:00:00.000Z`, closed_at: `${addDays(MONDAY, 7)}T10:00:00.000Z` }),
    ],
    strategies: [],
  };
}

describe("get_weekly_review", () => {
  it("returns the stored review (text capped) plus the live week summary", async () => {
    const { callTool, auditRows } = makeCaller(weeklyReviewTables());
    const result = await callTool("get_weekly_review", { week_start: MONDAY });
    expect(result.isError).toBe(false);
    const payload = result.payload as {
      week_start: string;
      week_end: string;
      review: {
        id: string;
        review_text: string;
        review_text_truncated: boolean;
        main_mistake: string;
        stored_aggregates: Record<string, unknown>;
      };
      week_summary: Record<string, number | null>;
    };
    expect(payload.week_start).toBe(MONDAY);
    expect(payload.week_end).toBe(addDays(MONDAY, 6));
    expect(payload.review.id).toBe("rev-1");
    expect(payload.review.review_text).toHaveLength(2000);
    expect(payload.review.review_text_truncated).toBe(true);
    expect(payload.review.main_mistake).toBe("Chased two entries");
    expect(payload.review.stored_aggregates).toMatchObject({
      trades_count: 4,
      total_pnl: 60,
      best_strategy: "BOS",
    });
    expect(payload.week_summary).toMatchObject({
      trade_count: 2,
      net_pnl: 30,
      win_rate_pct: 50,
      avg_win: 40,
      avg_loss: -10,
      profit_factor: 4,
      expectancy: 15,
      avg_r: 0.25,
      max_drawdown: 10,
      current_streak: -1,
    });
    expect(auditRows[0]).toMatchObject({
      action: "mcp.get_weekly_review",
      entity_type: "weekly_reviews",
      entity_id: "rev-1",
    });
  });

  it("normalizes a mid-week date to the Monday, like the app", async () => {
    const { callTool } = makeCaller(weeklyReviewTables());
    const result = await callTool("get_weekly_review", {
      week_start: addDays(MONDAY, 3),
    });
    expect(result.isError).toBe(false);
    expect((result.payload as { week_start: string }).week_start).toBe(MONDAY);
  });

  it("a week with no review is not_found, audited as such", async () => {
    const { callTool, auditRows } = makeCaller(weeklyReviewTables());
    const result = await callTool("get_weekly_review", {
      week_start: addDays(MONDAY, -7),
    });
    expect(result.isError).toBe(true);
    expect(errCode(result)).toBe("not_found");
    expect(auditRows[0].details.outcome).toBe("not_found");
    expect(auditRows[0]).toMatchObject({ entity_type: "weekly_reviews", entity_id: null });
  });

  it("validates week_start as a real date", async () => {
    const { callTool } = makeCaller(weeklyReviewTables());
    for (const bad of [{}, { week_start: "abc" }, { week_start: "2026-02-30" }]) {
      const result = await callTool("get_weekly_review", bad);
      expect(errCode(result)).toBe("invalid_argument");
      expect(errMessage(result)).toContain("week_start");
    }
  });
});

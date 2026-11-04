import { describe, expect, it } from "vitest";
import { fakeSupabase, type Row } from "../test-helpers/fake-supabase";
import { getReportSummary } from "./queries";
import { getIntelligenceData, getWeeklyDigest } from "../intelligence/queries";

/**
 * Figure-integrity regressions for the 500-trade cap (Task 21).
 *
 * Before the fix, every computation read stopped at the 500
 * most recent rows: a period with >500 closed trades silently
 * understated its totals, and the catalog/intelligence fetch
 * (500 most recent of ALL TIME, sliced in memory) made older
 * periods lose trades retroactively as new ones arrived.
 *
 * Fixture 1 proves the oldest trades are now included.
 * Fixture 2 proves a small account's figures are byte-identical
 * to the known production values (test account A's October:
 * 8 closed trades, P&L 3702.50, win rate 87.5%).
 */

const USER = "user-big";

function octoberTrade(i: number, userId: string): Row {
  // Deterministic spread across October 2026. Timestamps carry
  // the index in the minutes so ordering is total (no ties).
  const day = String((i % 28) + 1).padStart(2, "0");
  const minute = String(i % 60).padStart(2, "0");
  return {
    id: `t-${i}`,
    user_id: userId,
    pair: "EURUSD",
    direction: "long",
    session: "london",
    strategy_id: null,
    setup_id: null,
    status: "closed",
    opened_at: `2026-10-${day}T09:${minute}:00Z`,
    closed_at: `2026-10-${day}T11:${minute}:00Z`,
    pnl: i % 2 === 0 ? 10 : -5,
    r_multiple: 1,
    sl: 1.08,
    leverage: 1,
    market_condition: null,
    trade_reason: null,
    entry_price: 1.1,
    position_size: 1,
  };
}

function seedTables(trades: Row[]) {
  return {
    trades,
    psychology_records: [],
    strategies: [],
    setups: [],
    lessons: [],
    goals: [],
    risk_rules: [],
    trading_plans: [],
    profiles: [],
    risk_events: [],
  };
}

describe("report completeness past 500 trades (Task 21)", () => {
  it("a 620-trade period reports all 620 trades, oldest included", async () => {
    const trades = Array.from({ length: 620 }, (_, i) => octoberTrade(i, USER));
    const { client, fake } = fakeSupabase(seedTables(trades));

    const summary = await getReportSummary(client, USER, {
      type: "monthly",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
    });

    // 310 wins x +10 and 310 losses x -5.
    expect(summary.tradesCount).toBe(620);
    expect(summary.totalPnl).toBe(310 * 10 + 310 * -5);
    expect(summary.winRate).toBe(50);
    // The fetch paged: more than one trades query, none capped.
    const tradeQueries = fake.queriesFor("trades");
    expect(tradeQueries.length).toBeGreaterThanOrEqual(2);
    expect(
      tradeQueries.some((q) => q.ops.some((op) => op.kind === "limit")),
    ).toBe(false);
  });

  it("the intelligence fetch (catalog reports' input) is complete too", async () => {
    const trades = Array.from({ length: 620 }, (_, i) => octoberTrade(i, USER));
    const { client } = fakeSupabase(seedTables(trades));

    const data = await getIntelligenceData(client, USER);
    expect(data.trades).toHaveLength(620);
    // The oldest trade (highest index closes latest in this
    // fixture's ordering is index order-independent): every id
    // present, including t-0.
    expect(data.trades.some((t) => t.id === "t-0")).toBe(true);
    expect(data.trades.some((t) => t.id === "t-619")).toBe(true);
  });

  it("a small account's figures are identical to the known production values", async () => {
    // Test account A's October shape: 7 wins / 1 loss, sum 3702.50.
    const pnls = [1500, 1201.2, 600, 250, 100, 50, 1.5, -0.2];
    const trades = pnls.map((pnl, i) => ({
      ...octoberTrade(i, USER),
      id: `a-${i}`,
      pnl,
    }));
    const { client, fake } = fakeSupabase(seedTables(trades));

    const summary = await getReportSummary(client, USER, {
      type: "monthly",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
    });

    expect(summary.tradesCount).toBe(8);
    expect(summary.totalPnl).toBeCloseTo(3702.5, 6);
    expect(summary.winRate).toBe(87.5);
    // Small accounts still cost exactly one page query.
    expect(fake.queriesFor("trades")).toHaveLength(1);
  });
});

describe("weekly digest patterns (Task 21, Part B)", () => {
  function weekTrade(id: string, day: string, pair: string, pnl: number): Row {
    return {
      id,
      user_id: USER,
      pair,
      direction: "long",
      session: "london",
      strategy_id: null,
      setup_id: null,
      status: "closed",
      opened_at: `${day}T09:00:00Z`,
      closed_at: `${day}T11:00:00Z`,
      pnl,
      r_multiple: 1,
      sl: 1.08,
      leverage: 1,
      market_condition: null,
      trade_reason: null,
      entry_price: 1.1,
      position_size: 1,
    };
  }

  it("runs the pattern engine over the week slice alone", async () => {
    const trades = [
      // Week of Mon 2026-10-05: 4 XAUUSD wins, 2 EURUSD losses.
      weekTrade("w1", "2026-10-05", "XAUUSD", 100),
      weekTrade("w2", "2026-10-06", "XAUUSD", 100),
      weekTrade("w3", "2026-10-07", "XAUUSD", 100),
      weekTrade("w4", "2026-10-08", "XAUUSD", 100),
      weekTrade("w5", "2026-10-09", "EURUSD", -50),
      weekTrade("w6", "2026-10-10", "EURUSD", -50),
      // Outside the week: must not leak into the digest.
      weekTrade("x1", "2026-09-20", "GBPUSD", 999),
      weekTrade("x2", "2026-10-20", "GBPUSD", 999),
    ];
    const { client } = fakeSupabase(seedTables(trades));

    const digest = await getWeeklyDigest(client, USER, "2026-10-07");
    expect(digest).not.toBeNull();
    expect(digest!.tradesCount).toBe(6);
    expect(digest!.totalPnl).toBe(300);
    expect(digest!.patterns.status).toBe("ok");
    const pairPattern = digest!.patterns.patterns.find(
      (p) => p.kind === "pair" && p.label === "XAUUSD",
    );
    expect(pairPattern).toBeDefined();
    expect(pairPattern!.direction).toBe("edge");
    expect(pairPattern!.trades).toBe(4);
  });

  it("states insufficient data honestly for a small week", async () => {
    const trades = [
      weekTrade("s1", "2026-10-19", "XAUUSD", 100),
      weekTrade("s2", "2026-10-20", "XAUUSD", -20),
      weekTrade("s3", "2026-10-21", "EURUSD", 40),
    ];
    const { client } = fakeSupabase(seedTables(trades));

    const digest = await getWeeklyDigest(client, USER, "2026-10-21");
    expect(digest).not.toBeNull();
    expect(digest!.tradesCount).toBe(3);
    expect(digest!.patterns.status).toBe("insufficient_data");
    expect(digest!.patterns.tradesCount).toBe(3);
    expect(digest!.patterns.patterns).toEqual([]);
  });
});

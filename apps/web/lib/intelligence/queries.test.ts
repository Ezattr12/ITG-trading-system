import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertScoped, fakeSupabase, type Row } from "@/lib/test-helpers/fake-supabase";
import {
  INTEL_USER_A as USER_A,
  INTEL_USER_B as USER_B,
  intelligenceTables,
} from "@/lib/test-helpers/intelligence-fixture";
import {
  getDrawdownAnalysis,
  getImprovementPlan,
  getIntelligenceData,
  getMonthlyDigest,
  getRiskBehaviorAnalysis,
  getWeeklyDigest,
} from "./queries";

/**
 * Advanced intelligence — service layer (Phase 23).
 *
 * Fixture (USER_A, September 2026; entry 100, size 10 for
 * every trade, so planned risk = |100 − sl| × 10):
 * - d1 Sep 08 +200 (sl 90 → risk 100) Alpha/Breakout, london long
 * - d2 Sep 09 −100 (sl 90 → risk 100) Beta/Pullback, new_york short
 * - d3 Sep 10 −200 (no sl, leverage 8) Beta/Pullback, london short
 * - d4 Sep 11 +160 (sl 92 → risk 80) Alpha/Breakout, asia long
 * - d5 Sep 12 −120 (sl 88 → risk 120) Beta/Pullback, new_york short
 * - d6 Sep 15 +50  (sl 90 → risk 100) Alpha/Breakout, london long
 * - d7 Sep 16 −80  (no sl) Beta/Pullback, london long
 * Total P&L −90. Equity: 200, 100, −100, 60, −60, −10, −90 →
 * max drawdown 300 (peak Sep 08, trough Sep 10), current 290.
 * Capital 10,000; rules: 1% per-trade (limit 100 → only d5
 * over), 150 daily loss (only Sep 10 breaches), leverage 5
 * (only d3 over). Lessons: "Entered before confirmation" on
 * d2 + d5 (impact −220). USER_B owns one +9999 trade and
 * 5,000 capital — never visible in A's results.
 */

describe("getIntelligenceData", () => {
  it("assembles the bundle scoped to the caller, with calcRiskAmount risks", async () => {
    const { client, fake } = fakeSupabase(intelligenceTables());
    const data = await getIntelligenceData(client as SupabaseClient, USER_A);
    expect(data.trades).toHaveLength(7);
    expect(data.trades.every((t) => t.pnl !== 9999)).toBe(true);
    expect(data.capital).toBe(10000);
    expect(data.rules?.max_risk_per_trade_pct).toBe(1);
    expect(data.lessons).toHaveLength(3);
    expect(data.riskEvents).toHaveLength(2);

    const byId = new Map(data.trades.map((t) => [t.id, t]));
    expect(byId.get("d4")?.riskAmount).toBe(80);
    expect(byId.get("d3")?.riskAmount).toBeNull();
    expect(byId.get("d1")?.setupName).toBe("Breakout");
    expect(byId.get("d1")?.strategyName).toBe("Alpha Breakout");
    expect(byId.get("d3")?.journaled).toBe(true); // via its lesson

    for (const q of fake.queriesFor("trades")) assertScoped(q, "user_id", USER_A);
    for (const q of fake.queriesFor("lessons")) assertScoped(q, "user_id", USER_A);
    for (const q of fake.queriesFor("profiles")) assertScoped(q, "id", USER_A);
    for (const q of fake.queriesFor("risk_events")) assertScoped(q, "user_id", USER_A);
  });

  it("gives the other trader only their own rows", async () => {
    const { client } = fakeSupabase(intelligenceTables());
    const data = await getIntelligenceData(client as SupabaseClient, USER_B);
    expect(data.trades).toHaveLength(1);
    expect(data.trades[0].pnl).toBe(9999);
    expect(data.capital).toBe(5000);
    expect(data.rules).toBeNull();
  });
});

describe("service cores over the fixture", () => {
  it("drawdown: max 300, unrecovered, current 290", async () => {
    const { client } = fakeSupabase(intelligenceTables());
    const dd = await getDrawdownAnalysis(client as SupabaseClient, USER_A);
    expect(dd.status).toBe("ok");
    expect(dd.totalPnl).toBe(-90);
    expect(dd.maxDrawdown).toBe(300);
    expect(dd.episode).toMatchObject({
      peakDate: "2026-09-08",
      troughDate: "2026-09-10",
      recovered: false,
    });
    expect(dd.currentDrawdown).toBe(290);
  });

  it("risk behaviour: one trade over the 1% limit, one daily breach, one leverage breach", async () => {
    const { client } = fakeSupabase(intelligenceTables());
    const risk = await getRiskBehaviorAnalysis(client as SupabaseClient, USER_A, "2026-09-20");
    expect(risk.withRiskCount).toBe(5);
    expect(risk.distribution).toMatchObject({ avg: 100, max: 120 });
    expect(risk.overLimitCount).toBe(1);
    expect(risk.dailyLossBreachDays).toBe(1);
    expect(risk.leverageOverCount).toBe(1);
    expect(risk.riskEvents.total).toBe(2);
  });

  it("improvement plan: the five priority actions in order", async () => {
    const { client } = fakeSupabase(intelligenceTables());
    const plan = await getImprovementPlan(client as SupabaseClient, USER_A);
    expect(plan.status).toBe("ok");
    expect(plan.actions.map((a) => a.priority)).toEqual([1, 2, 3, 4, 5]);
    expect(plan.actions[3].title).toContain("Entered before confirmation");
    expect(plan.actions[3].evidence).toContain("lost 220.00");
  });
});

describe("digests", () => {
  it("weekly digest composes the week's summary, slice analyses and coach findings", async () => {
    const { client } = fakeSupabase(intelligenceTables());
    const digest = await getWeeklyDigest(client as SupabaseClient, USER_A, "2026-09-09");
    expect(digest).not.toBeNull();
    expect(digest?.periodStart).toBe("2026-09-07");
    expect(digest?.periodEnd).toBe("2026-09-13");
    expect(digest?.status).toBe("ok");
    expect(digest?.tradesCount).toBe(5);
    expect(digest?.totalPnl).toBe(-60);
    expect(digest?.drawdown.maxDrawdown).toBe(300);
    // The deterministic coach engine ran over the same week
    // (5 closed trades ≥ its 3-trade minimum).
    expect(digest?.coachFindings.length).toBeGreaterThanOrEqual(1);
    expect(digest?.focus.length).toBeGreaterThanOrEqual(1);
    expect(digest?.focus[0].priority).toBe(1);
  });

  it("monthly digest uses the stored ai_insights inside the month", async () => {
    const { client } = fakeSupabase(intelligenceTables());
    const digest = await getMonthlyDigest(client as SupabaseClient, USER_A, "2026-09-15");
    expect(digest?.status).toBe("ok");
    expect(digest?.tradesCount).toBe(7);
    expect(digest?.totalPnl).toBe(-90);
    expect(digest?.coachFindings.map((f) => f.title)).toContain("Stored September insight");
    expect(digest?.recurring.mistakes[0]).toMatchObject({
      text: "Entered before confirmation",
      count: 2,
      totalPnlImpact: -220,
    });
  });

  it("monthly digest for an empty month is honestly insufficient", async () => {
    const { client } = fakeSupabase(intelligenceTables());
    const digest = await getMonthlyDigest(client as SupabaseClient, USER_A, "2026-10-15");
    expect(digest?.status).toBe("insufficient_data");
    expect(digest?.tradesCount).toBe(0);
    expect(digest?.coachFindings).toEqual([]);
    expect(digest?.focus).toEqual([]);
    expect(digest?.drawdown.series).toEqual([]);
  });
});

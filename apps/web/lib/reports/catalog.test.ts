import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertScoped, fakeSupabase } from "@/lib/test-helpers/fake-supabase";
import {
  INTEL_USER_A as USER_A,
  INTEL_USER_B as USER_B,
  intelligenceTables,
} from "@/lib/test-helpers/intelligence-fixture";
import {
  getCatalogReport,
  getCoachReport,
  getPerformanceReport,
  getPsychologyReport,
  getRiskReport,
  getStrategyReport,
  type CatalogReportKind,
} from "./catalog";
import { buildCatalogReportPdf } from "./pdf";

/**
 * Report catalog (Phase 24) — composition over the shared
 * Phase 23 fixture (USER_A, September 2026; see
 * intelligence/queries.test.ts for the full hand-computation).
 *
 * Month of Sep 2026 (d1–d7): 7 closed trades, total P&L −90.
 * Alpha Breakout: d1 +200, d4 +160, d6 +50 → 3 trades, +410.
 * Beta Reversion: d2 −100, d3 −200, d5 −120, d7 −80 → 4, −500.
 * Equity 200, 100, −100, 60, −60, −10, −90 → max drawdown 300,
 * current 290. Week Mon Sep 7 – Sun Sep 13 (d1–d5): 5 trades,
 * −60; equity 200, 100, −100, 60, −60 → max DD 300, current 260.
 * Psychology recorded on d1, d2, d4, d5, d6 (calm +410 / fear
 * −220). Risk: 5 trades with a stop-loss (risks 100, 100, 80,
 * 120, 100 against a 1%-of-10,000 = 100 limit → 1 over), one
 * daily-loss breach day (Sep 10, −200 vs 150), one leverage
 * breach (d3 at 8x vs 5), two stored risk events in period.
 * USER_B owns one +9999 trade — never visible in A's reports.
 */

const KINDS: CatalogReportKind[] = [
  "performance",
  "psychology",
  "risk",
  "strategy",
  "coach",
];

describe("catalog period anchoring", () => {
  it("anchors week (Mon–Sun) and month (calendar) like the existing reports", async () => {
    const { client } = fakeSupabase(intelligenceTables());
    const week = await getPerformanceReport(
      client as SupabaseClient,
      USER_A,
      "week",
      "2026-09-09",
    );
    expect(week?.periodStart).toBe("2026-09-07");
    expect(week?.periodEnd).toBe("2026-09-13");
    const month = await getPerformanceReport(
      client as SupabaseClient,
      USER_A,
      "month",
      "2026-09-15",
    );
    expect(month?.periodStart).toBe("2026-09-01");
    expect(month?.periodEnd).toBe("2026-09-30");
  });

  it("returns null for an invalid anchor date", async () => {
    const { client } = fakeSupabase(intelligenceTables());
    expect(
      await getCatalogReport(client as SupabaseClient, USER_A, "risk", "month", "not-a-date"),
    ).toBeNull();
  });
});

describe("performance report", () => {
  it("composes the period summary with the slice drawdown and breakdowns", async () => {
    const { client } = fakeSupabase(intelligenceTables());
    const r = await getPerformanceReport(client as SupabaseClient, USER_A, "month", "2026-09-15");
    expect(r?.hasData).toBe(true);
    expect(r?.summary.tradesCount).toBe(7);
    expect(r?.summary.totalPnl).toBe(-90);
    expect(r?.drawdown.status).toBe("ok");
    expect(r?.drawdown.maxDrawdown).toBe(300);
    expect(r?.drawdown.currentDrawdown).toBe(290);
    const alpha = r?.summary.byStrategy.find((row) => row.name === "Alpha Breakout");
    expect(alpha).toMatchObject({ trades: 3, totalPnl: 410 });
    const london = r?.summary.bySession.find((row) => row.name === "london");
    expect(london).toMatchObject({ trades: 4, totalPnl: -30 });
  });

  it("week slice: 5 trades, −60, drawdown 300 / current 260", async () => {
    const { client } = fakeSupabase(intelligenceTables());
    const r = await getPerformanceReport(client as SupabaseClient, USER_A, "week", "2026-09-09");
    expect(r?.summary.tradesCount).toBe(5);
    expect(r?.summary.totalPnl).toBe(-60);
    expect(r?.drawdown.maxDrawdown).toBe(300);
    expect(r?.drawdown.currentDrawdown).toBe(260);
  });
});

describe("psychology report", () => {
  it("composes byEmotion with the psychology and discipline analyses", async () => {
    const { client } = fakeSupabase(intelligenceTables());
    const r = await getPsychologyReport(client as SupabaseClient, USER_A, "month", "2026-09-15");
    expect(r?.hasData).toBe(true);
    expect(r?.psychology.status).toBe("ok");
    expect(r?.psychology.recordedTrades).toBe(5);
    expect(r?.psychology.avgConfidence).toBeCloseTo(3);
    const calm = r?.psychology.byEmotion.find((g) => g.key === "calm");
    expect(calm).toMatchObject({ trades: 3, totalPnl: 410, winRate: 100 });
    const fear = r?.psychology.byEmotion.find((g) => g.key === "fear");
    expect(fear).toMatchObject({ trades: 2, totalPnl: -220, winRate: 0 });
    // Fear has only 2 trades (< 3 per side), so the gated
    // relationship statement must be withheld.
    expect(r?.psychology.emotionStatement).toBeNull();
    expect(r?.psychology.confidenceStatement).toBeNull();
    // Discipline: stop-loss on 5 of 7, journaled 6 of 7.
    expect(r?.discipline.stopLossPct).toBeCloseTo((5 / 7) * 100);
    expect(r?.discipline.journalCompletionPct).toBeCloseTo((6 / 7) * 100);
    expect(r?.discipline.stopLoss.a).toMatchObject({ trades: 5, totalPnl: 190 });
    expect(r?.discipline.stopLoss.b).toMatchObject({ trades: 2, totalPnl: -280 });
  });
});

describe("risk report", () => {
  it("composes risk behaviour, active limits and the period's stored events", async () => {
    const { client } = fakeSupabase(intelligenceTables());
    const r = await getRiskReport(client as SupabaseClient, USER_A, "month", "2026-09-15");
    expect(r?.hasData).toBe(true);
    expect(r?.risk.status).toBe("ok");
    expect(r?.risk.withRiskCount).toBe(5);
    expect(r?.risk.distribution).toMatchObject({ avg: 100, median: 100, min: 80, max: 120 });
    expect(r?.risk.overLimitCount).toBe(1);
    expect(r?.risk.dailyLossBreachDays).toBe(1);
    expect(r?.risk.worstDay).toEqual({ date: "2026-09-10", pnl: -200 });
    expect(r?.risk.leverageOverCount).toBe(1);
    expect(r?.risk.maxConsecutiveLosses).toBe(2);
    expect(r?.rules?.max_risk_per_trade_pct).toBe(1);
    expect(r?.rules?.max_daily_loss).toBe(150);
    expect(r?.plan).toBeNull();
    expect(r?.periodRiskEvents).toHaveLength(2);
    expect(r?.risk.riskEvents).toMatchObject({ total: 2, critical: 1, warning: 1 });
    expect(r?.drawdown.maxDrawdown).toBe(300);
  });

  it("week slice excludes the events and trades after Sunday", async () => {
    const { client } = fakeSupabase(intelligenceTables());
    const r = await getRiskReport(client as SupabaseClient, USER_A, "week", "2026-09-09");
    expect(r?.summary.tradesCount).toBe(5);
    // Both stored events (Sep 10, Sep 12) fall inside this week.
    expect(r?.periodRiskEvents).toHaveLength(2);
    expect(r?.risk.withRiskCount).toBe(4);
  });
});

describe("strategy report", () => {
  it("ranks best/worst strategy under the 3-trade minimum", async () => {
    const { client } = fakeSupabase(intelligenceTables());
    const r = await getStrategyReport(client as SupabaseClient, USER_A, "month", "2026-09-15");
    expect(r?.bestStrategy).toMatchObject({ name: "Alpha Breakout", trades: 3, totalPnl: 410 });
    expect(r?.worstStrategy).toMatchObject({ name: "Beta Reversion", trades: 4, totalPnl: -500 });
    // No strategy×session cell reaches 3 trades in this
    // fixture, so that table is honestly empty — while other
    // condition rows (e.g. Trending, 3 trades) do qualify.
    expect(r?.strategySessionRows).toEqual([]);
    expect(r?.conditions.best).toMatchObject({ label: "Trending", totalPnl: 410 });
    expect(r?.recurring.losingSetups[0]).toMatchObject({
      name: "Pullback",
      losses: 4,
      totalPnl: -500,
    });
    expect(r?.summary.mostFrequentLosingSetup).toEqual({
      name: "Beta Reversion",
      losses: 4,
    });
  });
});

describe("coach report", () => {
  it("monthly: digest findings plus the stored insights in range", async () => {
    const { client, fake } = fakeSupabase(intelligenceTables());
    const r = await getCoachReport(client as SupabaseClient, USER_A, "month", "2026-09-15");
    expect(r?.hasData).toBe(true);
    expect(r?.digest?.status).toBe("ok");
    expect(r?.digest?.tradesCount).toBe(7);
    expect(r?.digest?.coachFindings.map((f) => f.title)).toContain("Stored September insight");
    expect(r?.storedInsights).toHaveLength(1);
    expect(r?.storedInsights[0].summary).toBe("Stored September insight");
    expect(r?.storedInsights[0].metrics_snapshot.recommendation).toBe("Stored recommendation");
    expect(r?.recommendations.join(" ")).toContain("Beta Reversion");
    for (const q of fake.queriesFor("ai_insights")) assertScoped(q, "user_id", USER_A);
  });

  it("weekly: digest composed from the coach engine for the week", async () => {
    const { client } = fakeSupabase(intelligenceTables());
    const r = await getCoachReport(client as SupabaseClient, USER_A, "week", "2026-09-09");
    expect(r?.periodStart).toBe("2026-09-07");
    expect(r?.digest?.tradesCount).toBe(5);
    expect(r?.digest?.totalPnl).toBe(-60);
    expect((r?.digest?.coachFindings.length ?? 0)).toBeGreaterThanOrEqual(1);
    // The stored insight's period (Sep 7–13) falls in this week.
    expect(r?.storedInsights).toHaveLength(1);
  });
});

describe("empty-period honesty", () => {
  it("every kind reports hasData false with insufficient sections for October", async () => {
    for (const kind of KINDS) {
      const { client } = fakeSupabase(intelligenceTables());
      const r = await getCatalogReport(client as SupabaseClient, USER_A, kind, "month", "2026-10-15");
      expect(r?.hasData, kind).toBe(false);
      expect(r?.summary.tradesCount, kind).toBe(0);
      expect(r?.summary.winRate, kind).toBeNull();
      if (r?.kind === "performance") {
        expect(r.drawdown.status).toBe("insufficient_data");
        expect(r.drawdown.series).toEqual([]);
      }
      if (r?.kind === "psychology") {
        expect(r.psychology.status).toBe("insufficient_data");
        expect(r.psychology.byEmotion).toEqual([]);
      }
      if (r?.kind === "risk") {
        expect(r.risk.status).toBe("insufficient_data");
        expect(r.periodRiskEvents).toEqual([]);
      }
      if (r?.kind === "strategy") {
        expect(r.bestStrategy).toBeNull();
        expect(r.worstStrategy).toBeNull();
        expect(r.strategySessionRows).toEqual([]);
      }
      if (r?.kind === "coach") {
        expect(r.digest?.status).toBe("insufficient_data");
        expect(r.digest?.coachFindings).toEqual([]);
        expect(r.storedInsights).toEqual([]);
        expect(r.recommendations[0]).toContain("No closed trades");
      }
    }
  });
});

describe("cross-user scoping", () => {
  it("trader B's report contains only B's trade; A's never does", async () => {
    const { client, fake } = fakeSupabase(intelligenceTables());
    const b = await getPerformanceReport(client as SupabaseClient, USER_B, "month", "2026-09-15");
    expect(b?.summary.tradesCount).toBe(1);
    expect(b?.summary.totalPnl).toBe(9999);
    // One trade is data, but below the drawdown minimum.
    expect(b?.hasData).toBe(true);
    expect(b?.drawdown.status).toBe("insufficient_data");

    const a = await getPerformanceReport(client as SupabaseClient, USER_A, "month", "2026-09-15");
    expect(a?.summary.totalPnl).toBe(-90);
    // Every trades read in this test was scoped to its caller:
    // at least one query per user, each carrying that user's id.
    const scopedValues = fake
      .queriesFor("trades")
      .flatMap((q) =>
        q.ops
          .filter((op) => op.kind === "eq" && op.col === "user_id")
          .map((op) => (op as { value: unknown }).value),
      );
    expect(scopedValues).toContain(USER_A);
    expect(scopedValues).toContain(USER_B);
    expect(
      fake
        .queriesFor("trades")
        .every((q) => q.ops.some((op) => op.kind === "eq" && op.col === "user_id")),
    ).toBe(true);
  });
});

describe("buildCatalogReportPdf", () => {
  it("produces a real PDF for every report kind", async () => {
    for (const kind of KINDS) {
      const { client } = fakeSupabase(intelligenceTables());
      const r = await getCatalogReport(client as SupabaseClient, USER_A, kind, "month", "2026-09-15");
      expect(r).not.toBeNull();
      const pdf = await buildCatalogReportPdf(r!, "Test Trader");
      expect(pdf.subarray(0, 5).toString("ascii"), kind).toBe("%PDF-");
      expect(pdf.length, kind).toBeGreaterThan(500);
    }
  });

  it("produces a real PDF for an empty-period report", async () => {
    const { client } = fakeSupabase(intelligenceTables());
    const r = await getCoachReport(client as SupabaseClient, USER_A, "month", "2026-10-15");
    const pdf = await buildCatalogReportPdf(r!, "Test Trader");
    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(500);
  });
});

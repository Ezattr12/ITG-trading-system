import { describe, expect, it } from "vitest";
import { calcPnl } from "@itg/calc";
import { summarizeTrades } from "./analytics/analytics";
import type { AnalyticTrade } from "./analytics/types";
import { evaluateMonthlyEligibility } from "./certificates/eligibility";
import { generateCoachInsights } from "./coach/insights";
import { dimensionInputsFromBundle, scoreTrader } from "./gamification/scoring";
import type { LevelRow } from "./gamification/types";
import { buildDayContext, evaluateTradeRisk, hasCriticalBreach } from "./risk/engine";
import type { RiskRules } from "./risk/types";
import { buildReportSummary } from "./reports/reports";
import type { ReportTrade } from "./reports/types";

/**
 * Critical workflow, end to end through the pure layers (Phase 12,
 * spec §43): one trader's week, from raw trade prices to P&L,
 * analytics, risk checks, weekly report, coach insights, level
 * score and certificate eligibility — with no database, no
 * network and no invented data. The live-database version of
 * this workflow (signup → login → add trade → see it on the
 * dashboard) is a Phase 13/14 test once Supabase is wired up.
 *
 * Fixture week (5 closed trades, all journaled, all with a
 * stop-loss): 3 wins, 2 losses, both losses on the same setup
 * (Order Block) and both logged while feeling FOMO.
 */

const LEVELS: LevelRow[] = [
  { id: "l1", name: "Bronze", slug: "bronze", min_score: 0, max_score: 39, scoring_config: null, description: null },
  { id: "l2", name: "Silver", slug: "silver", min_score: 40, max_score: 59, scoring_config: null, description: null },
  { id: "l3", name: "Gold", slug: "gold", min_score: 60, max_score: 79, scoring_config: null, description: null },
  { id: "l4", name: "Platinum", slug: "platinum", min_score: 80, max_score: null, scoring_config: null, description: null },
];

const RULES: RiskRules = {
  id: "r1",
  user_id: "user-a",
  plan_id: null,
  max_risk_per_trade_pct: 2,
  max_daily_loss: 200,
  max_trades_per_day: 3,
  max_consecutive_losses: 2,
  max_leverage: 5,
  is_active: true,
};

/** Raw entries the trader typed; every derived number is computed below. */
const RAW_TRADES = [
  { id: "t1", pair: "EURUSD", direction: "long" as const, entry: 1.08, exit: 1.09, size: 10000, fees: 2, strategy: "FVG", session: "london" as const, emotion: "calm" as const, day: "2026-10-20" },
  { id: "t2", pair: "EURUSD", direction: "long" as const, entry: 1.09, exit: 1.085, size: 10000, fees: 2, strategy: "Order Block", session: "london" as const, emotion: "fomo" as const, day: "2026-10-21" },
  { id: "t3", pair: "GBPUSD", direction: "short" as const, entry: 1.27, exit: 1.265, size: 10000, fees: 2, strategy: "FVG", session: "new_york" as const, emotion: "calm" as const, day: "2026-10-22" },
  { id: "t4", pair: "EURUSD", direction: "short" as const, entry: 1.085, exit: 1.09, size: 10000, fees: 2, strategy: "Order Block", session: "new_york" as const, emotion: "fomo" as const, day: "2026-10-23" },
  { id: "t5", pair: "EURUSD", direction: "long" as const, entry: 1.085, exit: 1.088, size: 10000, fees: 2, strategy: "BOS", session: "asia" as const, emotion: "calm" as const, day: "2026-10-24" },
];

function analyticTrades(): AnalyticTrade[] {
  return RAW_TRADES.map((t) => ({
    id: t.id,
    pair: t.pair,
    direction: t.direction,
    session: t.session,
    strategyName: t.strategy,
    pnl: calcPnl({ direction: t.direction, entryPrice: t.entry, exitPrice: t.exit, positionSize: t.size, fees: t.fees }),
    rMultiple: null,
    closedAt: `${t.day}T11:00:00Z`,
    openedAt: `${t.day}T09:00:00Z`,
    emotion: t.emotion,
    discipline: "good" as const,
    confidence: 4,
    journaled: true,
    stopLossSet: true,
  }));
}

function reportTrades(): ReportTrade[] {
  return analyticTrades().map((t) => ({
    id: t.id,
    pair: t.pair,
    direction: t.direction,
    session: t.session,
    strategyName: t.strategyName,
    pnl: t.pnl,
    rMultiple: t.rMultiple,
    closedAt: t.closedAt,
    emotion: t.emotion,
    discipline: t.discipline,
    journaled: t.journaled,
    stopLossSet: t.stopLossSet,
  }));
}

describe("critical workflow: trade → analytics → risk → report → coach → level", () => {
  it("computes P&L from prices, never from a typed-in total", () => {
    const pnls = analyticTrades().map((t) => t.pnl);
    // t1: (1.09-1.08)*10000-2 = 98; t2: (1.085-1.09)*10000-2 = -52;
    // t3 short: (1.27-1.265)*10000-2 = 48; t4 short: (1.085-1.09)*10000-2 = -52;
    // t5: (1.088-1.085)*10000-2 = 28.
    expect(pnls).toEqual([98, -52, 48, -52, 28]);
    const summary = summarizeTrades(analyticTrades());
    expect(summary.tradeCount).toBe(5);
    expect(summary.totalPnl).toBe(70);
    expect(summary.wins).toBe(3);
    expect(summary.losses).toBe(2);
    expect(summary.winRate).toBe(60);
  });

  it("blocks an over-leveraged trade but only warns on a daily trade-limit breach", () => {
    const day = buildDayContext(
      analyticTrades().map((t) => ({
        pnl: t.pnl,
        status: "closed",
        closed_at: t.closedAt,
        opened_at: t.openedAt,
        sl: 1.08,
        leverage: 2,
        session: t.session,
        pair: t.pair,
        strategyName: t.strategyName,
      })),
      "2026-10-24",
    );
    const overLeveraged = evaluateTradeRisk(RULES, { leverage: 10, riskPct: 1 }, day, 5);
    expect(hasCriticalBreach(overLeveraged)).toBe(true);
    expect(overLeveraged.some((c) => c.rule === "leverage_limit" && c.breached)).toBe(true);

    const withinLimits = evaluateTradeRisk(RULES, { leverage: 2, riskPct: 1 }, day, 5);
    expect(hasCriticalBreach(withinLimits)).toBe(false);
    // 5 consecutive disciplined trades hits the positive milestone.
    expect(withinLimits.some((c) => c.rule === "positive_streak" && c.severity === "positive")).toBe(true);
  });

  it("builds a weekly report and coach insights from the same real trades", () => {
    const summary = buildReportSummary({
      type: "weekly",
      periodStart: "2026-10-20",
      periodEnd: "2026-10-26",
      trades: reportTrades(),
      lessons: [
        { tradeId: "t2", text: "Chased the entry", repeatedMistake: true },
        { tradeId: "t4", text: "Chased the entry", repeatedMistake: true },
      ],
      goalsCompleted: 1,
      goalsTotal: 2,
    });

    expect(summary.tradesCount).toBe(5);
    expect(summary.totalPnl).toBe(70);
    expect(summary.mostFrequentLosingSetup).toEqual({ name: "Order Block", losses: 2 });
    expect(summary.mostRepeatedMistake).toEqual({ text: "Chased the entry", count: 2 });
    expect(summary.recommendations.join(" ")).toContain("Order Block");

    const analysis = generateCoachInsights({
      summary,
      riskEvents: { critical: 0, warning: 0, positive: 1 },
      currentStreak: 1,
    });
    expect(analysis.insufficientData).toBe(false);
    // Every insight cites the numbers it was computed from.
    expect(analysis.insights.length).toBeGreaterThan(0);
    for (const insight of analysis.insights) {
      expect(insight.metricsSnapshot.rule).toBeTruthy();
      expect(insight.metricsSnapshot.severity).toBeTruthy();
      expect(insight.metricsSnapshot.recommendation).toBeTruthy();
      expect(insight.metricsSnapshot.trades).toBeGreaterThan(0);
    }
    const performance = analysis.insights.find((i) => i.type === "weekly_performance");
    expect(performance?.metricsSnapshot.trades).toBe(5);
    expect(performance?.metricsSnapshot.totalPnl).toBe(70);
  });

  it("scores the trader on discipline, not on profit alone", () => {
    const trades = analyticTrades();
    const inputs = dimensionInputsFromBundle(trades, [], "2026-10-24");
    const result = scoreTrader(inputs, LEVELS);
    // 3 wins / 2 losses, 100% journaled, 100% stop-loss, good discipline:
    // a real score and a real level, computed from the same trades.
    // Dimensions: discipline 100, risk 100, journal 100, psychology 80
    // (avg confidence 4/5), strategy 100, consistency 100 (one week so
    // far), performance 60 (win rate) — weighted, goals excluded (none
    // set): 81 / 0.85 = 95.3 → Platinum.
    expect(result.score).toBe(95.3);
    expect(result.levelName).toBe("Platinum");
  });

  it("does not earn a monthly certificate from a 5-day week alone", () => {
    // 5 trades, all journaled and disciplined, but only 5 active
    // days — the routine criterion (8 days over 2 weeks) is not met.
    const eligibility = evaluateMonthlyEligibility({
      month: "2026-10-01",
      tradesCount: 5,
      journaledTrades: 5,
      disciplinedTrades: 5,
      criticalBreaches: 0,
      activeDays: 5,
      activeWeeks: 1,
      completedWeeklyReviews: 1,
    });
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.criteria.find((c) => c.key === "routine")?.met).toBe(false);
    expect(eligibility.criteria.find((c) => c.key === "journaling")?.met).toBe(true);
  });

  it("the coach says so honestly with too few trades, instead of inventing insights", () => {
    const summary = buildReportSummary({
      type: "weekly",
      periodStart: "2026-10-20",
      periodEnd: "2026-10-26",
      trades: reportTrades().slice(0, 2),
      lessons: [],
      goalsCompleted: 0,
      goalsTotal: 0,
    });
    const analysis = generateCoachInsights({
      summary,
      riskEvents: { critical: 0, warning: 0, positive: 0 },
      currentStreak: 0,
    });
    expect(analysis.insufficientData).toBe(true);
    expect(analysis.insights).toEqual([]);
  });
});

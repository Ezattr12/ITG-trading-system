import { describe, expect, it } from "vitest";
import { buildReportSummary } from "../reports/reports";
import type { ReportLesson, ReportTrade } from "../reports/types";
import { buildLlmCoachPrompt, generateCoachInsights, type CoachEvidence } from "./insights";

/**
 * AI Coach tests (Phase 9, spec §28, §39).
 *
 * The evidence base is built with the real `buildReportSummary`
 * (Phase 8) from real-shaped trades — the coach never sees
 * invented aggregates. Every test asserts the rule fired AND
 * that the insight's metrics snapshot cites the numbers it was
 * computed from.
 */

function trade(partial: Partial<ReportTrade> & { pnl: number }): ReportTrade {
  return {
    id: partial.id ?? `t-${partial.pnl}-${Math.random()}`,
    pair: partial.pair ?? "EURUSD",
    direction: partial.direction ?? "long",
    session: partial.session ?? "london",
    strategyName: partial.strategyName ?? "FVG",
    pnl: partial.pnl,
    rMultiple: partial.rMultiple ?? null,
    closedAt: partial.closedAt ?? "2026-10-15T10:00:00Z",
    emotion: partial.emotion ?? "calm",
    discipline: partial.discipline ?? "good",
    journaled: partial.journaled ?? true,
    stopLossSet: partial.stopLossSet ?? true,
  };
}

const weekTrades = [
  trade({ id: "a", pnl: 120, strategyName: "FVG", emotion: "calm", session: "london" }),
  trade({ id: "b", pnl: 80, strategyName: "FVG", emotion: "calm", session: "london" }),
  trade({ id: "c", pnl: -200, strategyName: "Order Block", emotion: "fomo", session: "new_york", stopLossSet: false }),
  trade({ id: "d", pnl: -50, strategyName: "Order Block", emotion: "fomo", session: "new_york" }),
  trade({ id: "e", pnl: 0, strategyName: "FVG", emotion: "neutral", session: "london" }),
];

const weekLessons: ReportLesson[] = [
  { tradeId: "c", text: "Entered before confirmation", repeatedMistake: true },
  { tradeId: "d", text: "Entered before confirmation", repeatedMistake: true },
  { tradeId: "e", text: "Moved stop-loss", repeatedMistake: true },
];

function evidence(overrides: Partial<CoachEvidence> = {}): CoachEvidence {
  const summary = buildReportSummary({
    type: "weekly",
    periodStart: "2026-10-12",
    periodEnd: "2026-10-18",
    trades: weekTrades,
    lessons: weekLessons,
    goalsCompleted: 2,
    goalsTotal: 3,
  });
  return {
    summary,
    riskEvents: { critical: 1, warning: 0, positive: 0 },
    currentStreak: -2,
    ...overrides,
  };
}

function rules(analysis: ReturnType<typeof generateCoachInsights>): string[] {
  return analysis.insights.map((i) => i.metricsSnapshot.rule);
}

describe("generateCoachInsights", () => {
  it("says there is not enough data with fewer than 3 closed trades", () => {
    const summary = buildReportSummary({
      type: "weekly",
      periodStart: "2026-10-12",
      periodEnd: "2026-10-18",
      trades: [trade({ pnl: 50 })],
      lessons: [],
      goalsCompleted: 0,
      goalsTotal: 0,
    });
    const analysis = generateCoachInsights({
      summary,
      riskEvents: { critical: 0, warning: 0, positive: 0 },
      currentStreak: 1,
    });
    expect(analysis.insufficientData).toBe(true);
    expect(analysis.insights).toEqual([]);
  });

  it("says there is not enough data with zero trades", () => {
    const summary = buildReportSummary({
      type: "weekly",
      periodStart: "2026-10-12",
      periodEnd: "2026-10-18",
      trades: [],
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

  it("names the most frequent losing setup and the repeated mistake, citing the counts", () => {
    const analysis = generateCoachInsights(evidence());
    expect(analysis.insufficientData).toBe(false);
    const losing = analysis.insights.find((i) => i.metricsSnapshot.rule === "losing_setup");
    expect(losing?.type).toBe("mistakes");
    expect(losing?.metricsSnapshot.name).toBe("Order Block");
    expect(losing?.metricsSnapshot.occurrences).toBe(2);
    expect(losing?.metricsSnapshot.totalPnl).toBe(-50);
    expect(losing?.metricsSnapshot.recommendation).toContain("Order Block");

    const mistake = analysis.insights.find((i) => i.metricsSnapshot.rule === "repeated_mistake");
    expect(mistake?.type).toBe("mistakes");
    expect(mistake?.metricsSnapshot.mistake).toBe("Entered before confirmation");
    expect(mistake?.metricsSnapshot.occurrences).toBe(2);
  });

  it("names the best and worst strategy only when a strategy has at least 2 trades", () => {
    const analysis = generateCoachInsights(evidence());
    const best = analysis.insights.find((i) => i.metricsSnapshot.rule === "best_strategy");
    expect(best?.metricsSnapshot.strategy).toBe("FVG");
    expect(best?.metricsSnapshot.totalPnl).toBe(200);
    const worst = analysis.insights.find((i) => i.metricsSnapshot.rule === "worst_strategy");
    expect(worst?.metricsSnapshot.strategy).toBe("Order Block");
    expect(worst?.metricsSnapshot.totalPnl).toBe(-250);
    expect(worst?.metricsSnapshot.severity).toBe("high");
  });

  it("does not name a strategy traded only once as best or worst", () => {
    const summary = buildReportSummary({
      type: "weekly",
      periodStart: "2026-10-12",
      periodEnd: "2026-10-18",
      trades: [
        trade({ id: "a", pnl: 100, strategyName: "FVG" }),
        trade({ id: "b", pnl: 50, strategyName: "FVG" }),
        trade({ id: "c", pnl: -300, strategyName: "SMT" }),
        trade({ id: "d", pnl: 20, strategyName: "FVG" }),
      ],
      lessons: [],
      goalsCompleted: 0,
      goalsTotal: 0,
    });
    const analysis = generateCoachInsights({
      summary,
      riskEvents: { critical: 0, warning: 0, positive: 0 },
      currentStreak: 0,
    });
    expect(rules(analysis)).not.toContain("worst_strategy");
  });

  it("names the worst session and the worst emotion, citing their P&L", () => {
    const analysis = generateCoachInsights(evidence());
    const session = analysis.insights.find((i) => i.metricsSnapshot.rule === "worst_session");
    expect(session?.metricsSnapshot.session).toBe("new_york");
    expect(session?.metricsSnapshot.totalPnl).toBe(-250);
    const emotion = analysis.insights.find((i) => i.metricsSnapshot.rule === "worst_emotion");
    expect(emotion?.type).toBe("psychology");
    expect(emotion?.metricsSnapshot.emotion).toBe("fomo");
    expect(emotion?.metricsSnapshot.totalPnl).toBe(-250);
    expect(emotion?.metricsSnapshot.trades).toBe(2);
  });

  it("flags discipline when the stop-loss rate is below 100%", () => {
    const analysis = generateCoachInsights(evidence());
    const discipline = analysis.insights.find((i) => i.metricsSnapshot.rule === "stop_loss_rate");
    expect(discipline?.type).toBe("discipline");
    expect(discipline?.metricsSnapshot.disciplinePct).toBe(80);
  });

  it("flags a critical risk breach and cites the counts", () => {
    const analysis = generateCoachInsights(evidence());
    const risk = analysis.insights.find((i) => i.metricsSnapshot.rule === "critical_breach");
    expect(risk?.type).toBe("risk");
    expect(risk?.metricsSnapshot.severity).toBe("high");
    expect(risk?.metricsSnapshot.criticalRiskEvents).toBe(1);
  });

  it("praises a clean risk week instead of inventing a breach", () => {
    const clean = buildReportSummary({
      type: "weekly",
      periodStart: "2026-10-12",
      periodEnd: "2026-10-18",
      trades: [
        trade({ id: "a", pnl: 100, strategyName: "FVG" }),
        trade({ id: "b", pnl: 50, strategyName: "FVG" }),
        trade({ id: "c", pnl: 30, strategyName: "FVG" }),
      ],
      lessons: [],
      goalsCompleted: 0,
      goalsTotal: 0,
    });
    const analysis = generateCoachInsights({
      summary: clean,
      riskEvents: { critical: 0, warning: 0, positive: 0 },
      currentStreak: 3,
    });
    expect(rules(analysis)).toContain("clean_risk_week");
    expect(rules(analysis)).not.toContain("critical_breach");
  });

  it("reports incomplete goals with the real counts", () => {
    const analysis = generateCoachInsights(evidence());
    const goals = analysis.insights.find((i) => i.metricsSnapshot.rule === "goals_incomplete");
    expect(goals?.type).toBe("goals");
    expect(goals?.metricsSnapshot.goalsCompleted).toBe(2);
    expect(goals?.metricsSnapshot.goalsTotal).toBe(3);
  });

  it("picks one focus for next week from the highest-priority problem", () => {
    const analysis = generateCoachInsights(evidence());
    const focus = analysis.insights.find((i) => i.type === "focus_next_week");
    expect(focus).toBeDefined();
    expect(focus?.metricsSnapshot.rule).toBe("focus_next_week");
    expect(focus?.title).toContain("Order Block");
    expect(focus?.metricsSnapshot.recommendation.length).toBeGreaterThan(0);
  });

  it("every insight cites the numbers it used and carries a recommendation", () => {
    const analysis = generateCoachInsights(evidence());
    expect(analysis.insights.length).toBeGreaterThan(0);
    for (const insight of analysis.insights) {
      expect(insight.title.length).toBeGreaterThan(0);
      // Each insight cites numbers: its own subset (strategy /
      // emotion) or the week total — never an uncited claim.
      expect(insight.metricsSnapshot.trades).toBeDefined();
      expect(insight.metricsSnapshot.totalPnl).toBeDefined();
      expect(insight.metricsSnapshot.recommendation.length).toBeGreaterThan(0);
      expect(insight.metricsSnapshot.severity).toMatch(/^(high|medium|low|positive)$/);
    }
    // The weekly overview cites the week totals.
    const overview = analysis.insights.find(
      (i) => i.metricsSnapshot.rule === "weekly_performance",
    );
    expect(overview?.metricsSnapshot.trades).toBe(5);
    expect(overview?.metricsSnapshot.totalPnl).toBe(-50);
  });

  it("generation is deterministic: the same evidence produces identical snapshots", () => {
    const first = generateCoachInsights(evidence());
    const second = generateCoachInsights(evidence());
    // Identical snapshots mean a refresh with unchanged data
    // matches the stored rows exactly, so nothing is inserted
    // twice (the action dedupes on type + snapshot).
    expect(JSON.stringify(second.insights)).toBe(JSON.stringify(first.insights));
  });

  it("the LLM prompt extension point contains only the real numbers, with a do-not-invent instruction", () => {
    const analysis = generateCoachInsights(evidence());
    const prompt = buildLlmCoachPrompt(analysis);
    expect(prompt).toContain("Do not invent any statistic");
    expect(prompt).toContain("-50");
    expect(prompt).toContain("Order Block");
    expect(prompt).toContain("2026-10-12");
  });
});

import { describe, expect, it } from "vitest";
import {
  analyzeConditions,
  analyzeDiscipline,
  analyzeDrawdown,
  analyzePsychology,
  analyzeRecurring,
  analyzeRiskBehavior,
  buildImprovementPlan,
  type RiskContext,
} from "./analysis";
import type { IntelLesson, IntelTrade } from "./types";
import type { RiskRules } from "@/lib/risk/types";

/**
 * Advanced intelligence — pure analysis (Phase 23).
 *
 * Main fixture: 12 closed trades, Sep 2–17 2026, hand-computed:
 * - P&L sequence: +200, −100, +300, −50, −150, +100, −200,
 *   +160, −120, +50, −80, +100 → total +210, 6 wins / 6 losses.
 * - Equity: 200, 100, 400, 350, 200, 300, 100, 260, 140, 190,
 *   110, 210. Max drawdown 300 (peak 400 on Sep 4 → trough
 *   Sep 10), never recovered; current drawdown 190 (47.5% of
 *   peak); longest underwater run 9 trades / 13 days.
 * - Planned risk (10 trades with a stop-loss): 100, 100, 100,
 *   50, 150, 100, 80, 120, 100, 100 → avg/median 100, min 50,
 *   max 150. Capital 10,000, limit 1% → 2 trades over.
 * - Worst day −200 (Sep 10) vs a 150 daily loss limit → 1
 *   breach day. Max leverage 8 vs limit 5 → 1 over.
 * - Emotions: calm 5 trades +810 (100% wins); fear 3 trades
 *   −370 (0% wins); greed 1; neutral 1. Confidence: high
 *   (4–5) 4 trades +650; mid (3) 3 trades +210; low (1–2)
 *   3 trades −370.
 * - Stop-loss split: with 10 trades +490 (60% wins); without
 *   2 trades −280. Journaled 11 of 12.
 * - Mistakes: "Entered before confirmation" ×3, impact −370;
 *   "Moved stop too early" ×2, impact +150.
 * - Losing setup: Pullback — 5 trades, 5 losses, −650.
 * - Conditions (≥3 trades): Trending +750 (5); London · Long
 *   +320 (5); Alpha Breakout · London +550 (3);
 *   Alpha Breakout · Asia +210 (3); Ranging −370 (3);
 *   Beta Reversion · London −430 (3). Best Trending, worst
 *   Beta Reversion · London.
 */

let seq = 0;
function trade(overrides: Partial<IntelTrade>): IntelTrade {
  seq += 1;
  return {
    id: `t${seq}`,
    pair: "XAUUSD",
    direction: "long",
    session: "london",
    strategyName: "Alpha Breakout",
    pnl: 0,
    rMultiple: null,
    closedAt: "2026-09-02T10:00:00Z",
    openedAt: "2026-09-02T09:00:00Z",
    emotion: null,
    discipline: null,
    confidence: null,
    journaled: true,
    stopLossSet: true,
    setupName: "Breakout",
    marketCondition: "trending",
    tradeReason: "strategy",
    leverage: 2,
    riskAmount: 100,
    ...overrides,
  };
}

function day(d: string): string {
  return `2026-09-${d}T10:00:00Z`;
}

const TRADES: IntelTrade[] = [
  trade({ id: "t1", closedAt: day("02"), pnl: 200, rMultiple: 2, emotion: "calm", confidence: 4, discipline: "good", riskAmount: 100 }),
  trade({ id: "t2", closedAt: day("03"), pnl: -100, rMultiple: -1, direction: "short", session: "new_york", strategyName: "Beta Reversion", setupName: "Pullback", marketCondition: "ranging", emotion: "fear", confidence: 2, discipline: "poor", riskAmount: 100 }),
  trade({ id: "t3", closedAt: day("04"), pnl: 300, rMultiple: 3, emotion: "calm", confidence: 5, discipline: "good", riskAmount: 100 }),
  trade({ id: "t4", closedAt: day("05"), pnl: -50, rMultiple: -1, direction: "short", session: "asia", setupName: "Breakout", marketCondition: "choppy", emotion: "greed", confidence: 3, discipline: "average", riskAmount: 50 }),
  trade({ id: "t5", closedAt: day("08"), pnl: -150, rMultiple: -1, strategyName: "Beta Reversion", setupName: "Pullback", marketCondition: "ranging", emotion: "fear", confidence: 2, discipline: "poor", riskAmount: 150 }),
  trade({ id: "t6", closedAt: day("09"), pnl: 100, rMultiple: 1, session: "new_york", setupName: "Breakout", marketCondition: "trending", emotion: "calm", confidence: 4, discipline: "good", riskAmount: 100 }),
  trade({ id: "t7", closedAt: day("10"), pnl: -200, rMultiple: null, direction: "short", strategyName: "Beta Reversion", setupName: "Pullback", marketCondition: "high_volatility", emotion: null, discipline: null, confidence: null, journaled: true, stopLossSet: false, riskAmount: null, leverage: 8 }),
  trade({ id: "t8", closedAt: day("11"), pnl: 160, rMultiple: 2, session: "asia", setupName: "Breakout", marketCondition: "low_volatility", emotion: "calm", confidence: 3, discipline: "good", riskAmount: 80 }),
  trade({ id: "t9", closedAt: day("12"), pnl: -120, rMultiple: -1, direction: "short", session: "new_york", strategyName: "Beta Reversion", setupName: "Pullback", marketCondition: "ranging", emotion: "fear", confidence: 2, discipline: "average", riskAmount: 120 }),
  trade({ id: "t10", closedAt: day("15"), pnl: 50, rMultiple: 0.5, setupName: "Breakout", marketCondition: "trending", emotion: "calm", confidence: 4, discipline: "good", riskAmount: 100 }),
  trade({ id: "t11", closedAt: day("16"), pnl: -80, rMultiple: null, strategyName: "Beta Reversion", setupName: "Pullback", marketCondition: "choppy", emotion: null, discipline: null, confidence: null, journaled: false, stopLossSet: false, riskAmount: null }),
  trade({ id: "t12", closedAt: day("17"), pnl: 100, rMultiple: 1, direction: "short", session: "asia", setupName: "Breakout", marketCondition: "trending", emotion: "neutral", confidence: 3, discipline: "average", riskAmount: 100 }),
];

const LESSONS: IntelLesson[] = [
  { tradeId: "t2", text: "Entered before confirmation", repeatedMistake: true },
  { tradeId: "t5", text: "Entered before confirmation", repeatedMistake: true },
  { tradeId: "t9", text: "Entered before confirmation", repeatedMistake: false },
  { tradeId: "t7", text: "Revenge traded after a loss", repeatedMistake: true },
  { tradeId: "t10", text: "Moved stop too early", repeatedMistake: false },
  { tradeId: "t12", text: "Moved stop too early", repeatedMistake: false },
];

const RULES: RiskRules = {
  id: "rules-1",
  user_id: "user-a",
  plan_id: null,
  max_risk_per_trade_pct: 1,
  max_daily_loss: 150,
  max_trades_per_day: null,
  max_consecutive_losses: null,
  max_leverage: 5,
  is_active: true,
};

const RISK_CTX: RiskContext = {
  rules: RULES,
  plan: null,
  capital: 10000,
  riskEvents: [
    { id: "e1", user_id: "user-a", plan_id: null, risk_rule_id: null, trade_id: null, type: "risk_per_trade", severity: "warning", message: "", details: {}, resolved_at: null, created_at: "2026-09-19T00:00:00Z" },
    { id: "e2", user_id: "user-a", plan_id: null, risk_rule_id: null, trade_id: null, type: "daily_loss_limit", severity: "critical", message: "", details: {}, resolved_at: null, created_at: "2026-09-10T00:00:00Z" },
    { id: "e3", user_id: "user-a", plan_id: null, risk_rule_id: null, trade_id: null, type: "leverage_limit", severity: "warning", message: "", details: {}, resolved_at: null, created_at: "2026-08-01T00:00:00Z" },
  ],
  today: "2026-09-20",
};

describe("analyzeDrawdown", () => {
  it("measures the worst episode, recovery and underwater runs exactly", () => {
    const dd = analyzeDrawdown(TRADES);
    expect(dd.status).toBe("ok");
    expect(dd.totalPnl).toBe(210);
    expect(dd.maxDrawdown).toBe(300);
    expect(dd.maxDrawdownPctOfPeak).toBeCloseTo(75);
    expect(dd.episode).toMatchObject({
      peakEquity: 400,
      peakDate: "2026-09-04",
      troughDate: "2026-09-10",
      daysToTrough: 6,
      recovered: false,
      recoveryDate: null,
    });
    expect(dd.currentDrawdown).toBe(190);
    expect(dd.currentDrawdownPctOfPeak).toBeCloseTo(47.5);
    expect(dd.atPeak).toBe(false);
    expect(dd.longestUnderwater).toMatchObject({
      startDate: "2026-09-04",
      endDate: "2026-09-17",
      trades: 9,
      days: 13,
      recovered: false,
    });
    expect(dd.series).toHaveLength(12);
    expect(dd.series[2]).toMatchObject({ date: "2026-09-04", equity: 400, drawdown: 0 });
  });

  it("reports a recovered episode with its recovery date", () => {
    const trades = [
      trade({ pnl: 100, closedAt: day("02") }),
      trade({ pnl: -40, closedAt: day("03") }),
      trade({ pnl: -20, closedAt: day("04") }),
      trade({ pnl: 80, closedAt: day("05") }),
      trade({ pnl: 10, closedAt: day("06") }),
    ];
    const dd = analyzeDrawdown(trades);
    expect(dd.maxDrawdown).toBe(60);
    expect(dd.episode).toMatchObject({
      peakDate: "2026-09-02",
      troughDate: "2026-09-04",
      recovered: true,
      recoveryDate: "2026-09-05",
    });
    expect(dd.atPeak).toBe(true);
    expect(dd.currentDrawdown).toBe(0);
    expect(dd.longestUnderwater).toMatchObject({ trades: 2, recovered: true });
  });

  it("is insufficient below 5 closed trades but still reports the curve", () => {
    const dd = analyzeDrawdown(TRADES.slice(0, 4));
    expect(dd.status).toBe("insufficient_data");
    expect(dd.tradesCount).toBe(4);
    expect(dd.series).toHaveLength(4);
  });

  it("handles an all-winning curve with no drawdown", () => {
    const trades = Array.from({ length: 6 }, (_, i) =>
      trade({ pnl: 50, closedAt: day(String(10 + i).padStart(2, "0")) }),
    );
    const dd = analyzeDrawdown(trades);
    expect(dd.status).toBe("ok");
    expect(dd.maxDrawdown).toBe(0);
    expect(dd.episode).toBeNull();
    expect(dd.atPeak).toBe(true);
  });
});

describe("analyzeRiskBehavior", () => {
  it("measures distribution, limits, daily loss, leverage and streaks exactly", () => {
    const risk = analyzeRiskBehavior(TRADES, RISK_CTX);
    expect(risk.status).toBe("ok");
    expect(risk.withRiskCount).toBe(10);
    expect(risk.withoutStopLossCount).toBe(2);
    expect(risk.distribution).toMatchObject({ count: 10, avg: 100, median: 100, min: 50, max: 150 });
    expect(risk.avgRiskPctOfCapital).toBeCloseTo(1);
    expect(risk.maxRiskPctOfCapital).toBeCloseTo(1.5);
    expect(risk.riskLimitPct).toBe(1);
    expect(risk.riskLimitSource).toBe("rules");
    expect(risk.overLimitCount).toBe(2);
    expect(risk.withinLimitPct).toBeCloseTo(80);
    expect(risk.worstDay).toEqual({ date: "2026-09-10", pnl: -200 });
    expect(risk.dailyLossBreachDays).toBe(1);
    expect(risk.daysTraded).toBe(12);
    expect(risk.maxLeverageUsed).toBe(8);
    expect(risk.leverageOverCount).toBe(1);
    expect(risk.maxConsecutiveLosses).toBe(2);
    expect(risk.currentStreak).toBe(1);
    expect(risk.trend).toBeNull();
    expect(risk.riskEvents).toMatchObject({ total: 3, critical: 1, warning: 2, positive: 0, last30Days: 2 });
  });

  it("computes the recent-vs-prior risk trend over 40 trades", () => {
    const trades = Array.from({ length: 40 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 7, 1 + i));
      return trade({
        pnl: 10,
        riskAmount: i < 20 ? 100 : 150,
        closedAt: `${d.toISOString().slice(0, 10)}T10:00:00Z`,
      });
    });
    const risk = analyzeRiskBehavior(trades, { ...RISK_CTX, rules: null, capital: null, riskEvents: [] });
    expect(risk.trend).toMatchObject({ recentAvg: 150, priorAvg: 100, recentCount: 20, priorCount: 20 });
    expect(risk.trend?.deltaPct).toBeCloseTo(50);
  });

  it("states honestly when no limit is configured or capital is missing", () => {
    const noLimit = analyzeRiskBehavior(TRADES, { ...RISK_CTX, rules: null, plan: null });
    expect(noLimit.riskLimitNote).toBe("no_limit_configured");
    expect(noLimit.overLimitCount).toBeNull();
    expect(noLimit.dailyLossBreachDays).toBeNull();

    const noCapital = analyzeRiskBehavior(TRADES, { ...RISK_CTX, capital: null });
    expect(noCapital.riskLimitNote).toBe("capital_missing");
    expect(noCapital.overLimitCount).toBeNull();
    expect(noCapital.avgRiskPctOfCapital).toBeNull();
    // Money distribution is still measurable without capital.
    expect(noCapital.distribution?.avg).toBe(100);
  });

  it("is insufficient with no trades", () => {
    const risk = analyzeRiskBehavior([], RISK_CTX);
    expect(risk.status).toBe("insufficient_data");
    expect(risk.distribution).toBeNull();
  });
});

describe("analyzePsychology", () => {
  it("groups by emotion and confidence and states the gated relationships", () => {
    const psych = analyzePsychology(TRADES);
    expect(psych.status).toBe("ok");
    expect(psych.recordedTrades).toBe(10);
    const calm = psych.byEmotion.find((g) => g.key === "calm");
    const fear = psych.byEmotion.find((g) => g.key === "fear");
    expect(calm).toMatchObject({ trades: 5, totalPnl: 810, winRate: 100 });
    expect(fear).toMatchObject({ trades: 3, totalPnl: -370, winRate: 0 });
    expect(psych.avgConfidence).toBeCloseTo(3.2);
    // calm (5 trades, 100%) vs fear (3 trades, 0%): both sides
    // meet the ≥3 rule and the gap is 100 points → statement.
    expect(psych.emotionStatement).toContain("fear");
    expect(psych.emotionStatement).toContain("association");
    const high = psych.byConfidence.find((g) => g.key === "high");
    const low = psych.byConfidence.find((g) => g.key === "low");
    expect(high).toMatchObject({ trades: 4, totalPnl: 650, winRate: 100 });
    expect(low).toMatchObject({ trades: 3, totalPnl: -370, winRate: 0 });
    expect(psych.confidenceStatement).not.toBeNull();
  });

  it("withholds the statement when a side is below 3 trades", () => {
    const trades = [
      trade({ pnl: 100, emotion: "calm", confidence: 5 }),
      trade({ pnl: 100, emotion: "calm", confidence: 5 }),
      trade({ pnl: 100, emotion: "calm", confidence: 5 }),
      trade({ pnl: -50, emotion: "fear", confidence: 1 }),
      trade({ pnl: -50, emotion: "fear", confidence: 1 }),
    ];
    const psych = analyzePsychology(trades);
    expect(psych.emotionStatement).toBeNull();
    expect(psych.byEmotion.find((g) => g.key === "fear")?.trades).toBe(2);
  });

  it("withholds the statement when the win-rate gap is immaterial", () => {
    const mk = (emotion: IntelTrade["emotion"], pnls: number[]) =>
      pnls.map((pnl) => trade({ pnl, emotion, confidence: 3 }));
    const psych = analyzePsychology([
      ...mk("calm", [100, 100, -50, -50]), // 50% wins
      ...mk("fear", [100, -50, -50, -50]), // 25% wins — gap 25... use closer gap below
    ]);
    // 50% vs 25% is a 25-point gap → statement allowed; rebuild tighter:
    const tight = analyzePsychology([
      ...mk("calm", [100, 100, 100, -50, -50]), // 60%
      ...mk("fear", [100, 100, -50, -50, -50]), // 40% — gap 20 exactly meets the rule
    ]);
    expect(tight.emotionStatement).not.toBeNull();
    const tighter = analyzePsychology([
      ...mk("calm", [100, 100, 100, 100, -50, -50, -50, -50, -50, -50]), // 40%
      ...mk("fear", [100, 100, 100, -50, -50, -50, -50, -50, -50, -50]), // 30% — gap 10
    ]);
    expect(tighter.emotionStatement).toBeNull();
    expect(psych.emotionStatement).not.toBeNull();
  });

  it("is insufficient when nothing is recorded", () => {
    const psych = analyzePsychology([trade({}), trade({})]);
    expect(psych.status).toBe("insufficient_data");
    expect(psych.recordedTrades).toBe(0);
  });
});

describe("analyzeDiscipline", () => {
  it("splits by stop-loss, rating and journaling with gated statements", () => {
    const d = analyzeDiscipline(TRADES);
    expect(d.status).toBe("ok");
    expect(d.stopLossPct).toBeCloseTo(83.33, 1);
    expect(d.journalCompletionPct).toBeCloseTo(91.67, 1);
    expect(d.stopLoss.a).toMatchObject({ trades: 10, totalPnl: 490, winRate: 60 });
    expect(d.stopLoss.b).toMatchObject({ trades: 2, totalPnl: -280, winRate: 0 });
    // The no-stop-loss side has only 2 trades → no statement.
    expect(d.stopLoss.statement).toBeNull();
    // Rating: good 5 trades +810 (100%) vs average/poor 5
    // trades −320 (20%) → statement allowed.
    expect(d.rating?.a).toMatchObject({ trades: 5, totalPnl: 810 });
    expect(d.rating?.b).toMatchObject({ trades: 5, totalPnl: -320 });
    expect(d.rating?.statement).not.toBeNull();
    // Journaled side is 11 vs 1 → no statement.
    expect(d.journaled.statement).toBeNull();
  });

  it("returns a null rating split when no trade is rated", () => {
    const d = analyzeDiscipline([trade({ discipline: null }), trade({ discipline: null })]);
    expect(d.rating).toBeNull();
  });
});

describe("analyzeRecurring", () => {
  it("ranks recurring mistakes by count with money impact, and losing setups by losses", () => {
    const r = analyzeRecurring(TRADES, LESSONS);
    expect(r.status).toBe("ok");
    expect(r.totalLessons).toBe(6);
    expect(r.mistakes).toHaveLength(2);
    expect(r.mistakes[0]).toMatchObject({
      text: "Entered before confirmation",
      count: 3,
      flaggedRepeated: true,
      tradesAffected: 3,
      losingTrades: 3,
      totalPnlImpact: -370,
    });
    expect(r.mistakes[1]).toMatchObject({
      text: "Moved stop too early",
      count: 2,
      flaggedRepeated: false,
      totalPnlImpact: 150,
    });
    expect(r.losingSetups).toEqual([
      { name: "Pullback", trades: 5, losses: 5, totalPnl: -650, winRate: 0 },
    ]);
    expect(r.unrecordedSetupTrades).toBe(0);
  });
});

describe("analyzeConditions", () => {
  it("qualifies rows at 3+ trades and picks best/worst across matrices", () => {
    const c = analyzeConditions(TRADES);
    expect(c.status).toBe("ok");
    expect(c.rows).toHaveLength(6);
    expect(c.best).toMatchObject({ label: "Trending", trades: 5, totalPnl: 750, dimension: "market_condition" });
    expect(c.worst).toMatchObject({ label: "Beta Reversion · London", trades: 3, totalPnl: -430, dimension: "strategy_session" });
    const londonLong = c.rows.find((r) => r.label === "London · Long");
    expect(londonLong).toMatchObject({ trades: 5, totalPnl: 320 });
  });

  it("is insufficient when no group reaches 3 trades", () => {
    const c = analyzeConditions(TRADES.slice(0, 2));
    expect(c.status).toBe("insufficient_data");
    expect(c.best).toBeNull();
  });
});

describe("buildImprovementPlan", () => {
  it("produces the five highest-priority actions, each citing evidence", () => {
    const plan = buildImprovementPlan({
      tradesCount: TRADES.length,
      drawdown: analyzeDrawdown(TRADES),
      risk: analyzeRiskBehavior(TRADES, RISK_CTX),
      recurring: analyzeRecurring(TRADES, LESSONS),
      discipline: analyzeDiscipline(TRADES),
      psychology: analyzePsychology(TRADES),
      conditions: analyzeConditions(TRADES),
    });
    expect(plan.status).toBe("ok");
    expect(plan.actions.map((a) => a.priority)).toEqual([1, 2, 3, 4, 5]);
    expect(plan.actions[0].evidence).toContain("2 of 10");
    expect(plan.actions[0].evidence).toContain("1.5%");
    expect(plan.actions[1].evidence).toContain("150.00");
    expect(plan.actions[3].title).toContain("Entered before confirmation");
    expect(plan.actions[3].evidence).toContain("370.00");
    // Priorities 6 (psychology) and 7 (conditions) qualify
    // but are cut by the 5-action cap.
    expect(plan.actions).toHaveLength(5);
  });

  it("returns a keep-the-routine action when nothing qualifies", () => {
    const clean = Array.from({ length: 6 }, (_, i) =>
      trade({
        pnl: 100,
        closedAt: day(String(10 + i).padStart(2, "0")),
        emotion: "calm",
        confidence: 4,
        discipline: "good",
        riskAmount: 50,
      }),
    );
    const plan = buildImprovementPlan({
      tradesCount: clean.length,
      drawdown: analyzeDrawdown(clean),
      risk: analyzeRiskBehavior(clean, RISK_CTX),
      recurring: analyzeRecurring(clean, []),
      discipline: analyzeDiscipline(clean),
      psychology: analyzePsychology(clean),
      conditions: analyzeConditions(clean),
    });
    expect(plan.status).toBe("ok");
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0].title).toContain("Keep the routine");
  });

  it("is insufficient below 5 closed trades", () => {
    const plan = buildImprovementPlan({
      tradesCount: 3,
      drawdown: analyzeDrawdown(TRADES.slice(0, 3)),
      risk: analyzeRiskBehavior(TRADES.slice(0, 3), RISK_CTX),
      recurring: analyzeRecurring(TRADES.slice(0, 3), []),
      discipline: analyzeDiscipline(TRADES.slice(0, 3)),
      psychology: analyzePsychology(TRADES.slice(0, 3)),
      conditions: analyzeConditions(TRADES.slice(0, 3)),
    });
    expect(plan.status).toBe("insufficient_data");
    expect(plan.actions).toEqual([]);
  });
});

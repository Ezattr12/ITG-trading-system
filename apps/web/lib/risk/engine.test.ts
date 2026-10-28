import { describe, expect, it } from "vitest";
import {
  buildDayContext,
  countConsecutiveLosses,
  countDisciplinedStreak,
  evaluatePlanVsActual,
  evaluateTradeRisk,
  hasCriticalBreach,
  type EngineTrade,
} from "./engine";
import type { RiskRules, TradingPlan } from "./types";

/**
 * Risk engine tests (Phase 5, spec §19–20). Pure functions, no I/O.
 * Money here is already-computed P&L from the trade rows.
 */

function trade(over: Partial<EngineTrade> & { pnl: number | null }): EngineTrade {
  return {
    status: "closed",
    closed_at: "2026-10-20T10:00:00.000Z",
    opened_at: "2026-10-20T09:00:00.000Z",
    sl: 1.09,
    leverage: 1,
    session: "london",
    pair: "EUR/USD",
    strategyName: "FVG",
    ...over,
  };
}

function rules(over: Partial<RiskRules> = {}): RiskRules {
  return {
    id: "rule-1",
    user_id: "user-1",
    plan_id: null,
    max_risk_per_trade_pct: 1,
    max_daily_loss: 200,
    max_trades_per_day: 5,
    max_consecutive_losses: 3,
    max_leverage: 10,
    is_active: true,
    ...over,
  };
}

const emptyDay = { tradesToday: 0, dayPnl: null, consecutiveLosses: 0 };

describe("countConsecutiveLosses", () => {
  it("counts the leading run of losses, most recent first", () => {
    const trades = [
      trade({ pnl: -50, closed_at: "2026-10-20T10:00:00.000Z" }),
      trade({ pnl: -30, closed_at: "2026-10-19T10:00:00.000Z" }),
      trade({ pnl: 100, closed_at: "2026-10-18T10:00:00.000Z" }),
      trade({ pnl: -20, closed_at: "2026-10-17T10:00:00.000Z" }),
    ];
    expect(countConsecutiveLosses(trades)).toBe(2);
  });

  it("is 0 with no closed trades", () => {
    expect(countConsecutiveLosses([])).toBe(0);
    expect(
      countConsecutiveLosses([trade({ pnl: null, status: "open", closed_at: null })]),
    ).toBe(0);
  });
});

describe("countDisciplinedStreak", () => {
  it("counts consecutive trades with a stop-loss inside the leverage limit", () => {
    const trades = [
      trade({ pnl: 10, sl: 1.09, leverage: 5 }),
      trade({ pnl: -5, sl: 1.09, leverage: 10 }),
      trade({ pnl: 20, sl: null, leverage: 1 }),
    ];
    expect(countDisciplinedStreak(trades, rules())).toBe(2);
  });

  it("breaks the streak when leverage exceeds the limit", () => {
    const trades = [
      trade({ pnl: 10, sl: 1.09, leverage: 50 }),
      trade({ pnl: 20, sl: 1.09, leverage: 1 }),
    ];
    expect(countDisciplinedStreak(trades, rules())).toBe(0);
  });
});

describe("buildDayContext", () => {
  it("counts trades opened today and P&L closed today (UTC)", () => {
    const trades = [
      trade({ pnl: -40, opened_at: "2026-10-20T09:00:00.000Z", closed_at: "2026-10-20T10:00:00.000Z" }),
      trade({ pnl: 100, opened_at: "2026-10-19T09:00:00.000Z", closed_at: "2026-10-20T11:00:00.000Z" }),
      trade({ pnl: null, status: "open", closed_at: null, opened_at: "2026-10-20T12:00:00.000Z" }),
      trade({ pnl: 5, opened_at: "2026-10-18T09:00:00.000Z", closed_at: "2026-10-18T10:00:00.000Z" }),
    ];
    const day = buildDayContext(trades, "2026-10-20");
    expect(day.tradesToday).toBe(2);
    expect(day.dayPnl).toBe(60);
    expect(day.consecutiveLosses).toBe(0);
  });
});

describe("evaluateTradeRisk", () => {
  it("returns no checks when there are no rules", () => {
    expect(
      evaluateTradeRisk(null, { leverage: 5, riskPct: 2 }, emptyDay, 0),
    ).toEqual([]);
  });

  it("skips unset rules", () => {
    const checks = evaluateTradeRisk(
      rules({ max_leverage: null, max_daily_loss: null, max_trades_per_day: null, max_consecutive_losses: null, max_risk_per_trade_pct: null }),
      { leverage: 100, riskPct: 50 },
      emptyDay,
      0,
    );
    // Only the positive-streak check remains, not breached.
    expect(checks).toHaveLength(1);
    expect(checks[0]?.rule).toBe("positive_streak");
    expect(checks[0]?.breached).toBe(false);
  });

  it("blocks leverage above the maximum as critical", () => {
    const checks = evaluateTradeRisk(
      rules(),
      { leverage: 50, riskPct: null },
      emptyDay,
      0,
    );
    const leverage = checks.find((c) => c.rule === "leverage_limit");
    expect(leverage?.breached).toBe(true);
    expect(leverage?.severity).toBe("critical");
    expect(hasCriticalBreach(checks)).toBe(true);
  });

  it("blocks when the daily loss limit is reached", () => {
    const checks = evaluateTradeRisk(
      rules(),
      { leverage: 1, riskPct: null },
      { tradesToday: 2, dayPnl: -200, consecutiveLosses: 0 },
      0,
    );
    const loss = checks.find((c) => c.rule === "daily_loss_limit");
    expect(loss?.breached).toBe(true);
    expect(loss?.severity).toBe("critical");
    expect(loss?.message).toContain("You reached your daily loss limit");
  });

  it("warns (does not block) when the daily trade limit is exceeded", () => {
    const checks = evaluateTradeRisk(
      rules(),
      { leverage: 1, riskPct: null },
      { tradesToday: 5, dayPnl: null, consecutiveLosses: 0 },
      0,
    );
    const limit = checks.find((c) => c.rule === "daily_trade_limit");
    expect(limit?.breached).toBe(true);
    expect(limit?.severity).toBe("warning");
    expect(limit?.message).toContain("You exceeded your planned daily trade limit");
    expect(hasCriticalBreach(checks)).toBe(false);
  });

  it("warns on risk per trade above the maximum", () => {
    const checks = evaluateTradeRisk(
      rules(),
      { leverage: 1, riskPct: 2.5 },
      emptyDay,
      0,
    );
    const risk = checks.find((c) => c.rule === "risk_per_trade");
    expect(risk?.breached).toBe(true);
    expect(risk?.severity).toBe("warning");
  });

  it("warns at the consecutive-loss limit", () => {
    const checks = evaluateTradeRisk(
      rules(),
      { leverage: 1, riskPct: null },
      { tradesToday: 3, dayPnl: -90, consecutiveLosses: 3 },
      0,
    );
    const losses = checks.find((c) => c.rule === "consecutive_losses");
    expect(losses?.breached).toBe(true);
    expect(losses?.message).toContain("3 consecutive losses");
  });

  it("reports the positive streak at milestones only", () => {
    const at3 = evaluateTradeRisk(rules(), { leverage: 1, riskPct: null }, emptyDay, 3);
    expect(at3.find((c) => c.rule === "positive_streak")?.breached).toBe(true);
    expect(at3.find((c) => c.rule === "positive_streak")?.message).toContain(
      "You followed your risk plan for 3 consecutive trades",
    );
    const at4 = evaluateTradeRisk(rules(), { leverage: 1, riskPct: null }, emptyDay, 4);
    expect(at4.find((c) => c.rule === "positive_streak")?.breached).toBe(false);
    const at10 = evaluateTradeRisk(rules(), { leverage: 1, riskPct: null }, emptyDay, 10);
    expect(at10.find((c) => c.rule === "positive_streak")?.breached).toBe(true);
  });
});

describe("evaluatePlanVsActual", () => {
  const plan: TradingPlan = {
    id: "plan-1",
    user_id: "user-1",
    name: "My Plan",
    markets: ["EUR/USD"],
    sessions: ["london"],
    risk_per_trade_pct: 1,
    max_daily_loss: 200,
    max_daily_trades: 2,
    preferred_setup_ids: [],
    no_trade_conditions: "No trading during news",
    psychology_rules: "Stop after FOMO",
    schedule: { notes: "Mon–Fri mornings" },
    is_active: true,
  };

  it("flags a day with more trades than planned", () => {
    const rows = evaluatePlanVsActual({
      plan,
      trades: [
        { id: "1", pair: "EUR/USD", direction: "long", session: "london", strategyName: "FVG", pnl: 10, rMultiple: 1, closedAt: "2026-10-20T10:00:00.000Z", openedAt: "2026-10-20T09:00:00.000Z", emotion: "calm", discipline: "good", confidence: 4, journaled: true, stopLossSet: true },
        { id: "2", pair: "EUR/USD", direction: "long", session: "london", strategyName: "FVG", pnl: -5, rMultiple: -0.5, closedAt: "2026-10-20T11:00:00.000Z", openedAt: "2026-10-20T10:30:00.000Z", emotion: "fear", discipline: "average", confidence: 3, journaled: true, stopLossSet: true },
        { id: "3", pair: "EUR/USD", direction: "short", session: "london", strategyName: "FVG", pnl: 20, rMultiple: 2, closedAt: "2026-10-20T12:00:00.000Z", openedAt: "2026-10-20T11:30:00.000Z", emotion: "calm", discipline: "good", confidence: 5, journaled: true, stopLossSet: true },
      ],
      goodDisciplinePct: 66.7,
      strategiesUsed: ["FVG"],
      preferredSetupNames: [],
    });
    expect(rows.find((r) => r.label === "Trades per day")?.onTrack).toBe(false);
    expect(rows.find((r) => r.label === "Sessions")?.onTrack).toBe(true);
    expect(rows.find((r) => r.label === "Markets")?.onTrack).toBe(true);
  });

  it("reports unmeasurable rows as null, never guesses", () => {
    const rows = evaluatePlanVsActual({
      plan,
      trades: [],
      goodDisciplinePct: null,
      strategiesUsed: [],
      preferredSetupNames: [],
    });
    expect(rows.find((r) => r.label === "Psychology rules")?.onTrack).toBeNull();
    expect(rows.find((r) => r.label === "No-trade conditions")?.onTrack).toBeNull();
    expect(rows.find((r) => r.label === "Trades per day")?.onTrack).toBeNull();
  });

  it("flags a session traded outside the plan", () => {
    const rows = evaluatePlanVsActual({
      plan,
      trades: [
        { id: "1", pair: "EUR/USD", direction: "long", session: "asia", strategyName: null, pnl: 10, rMultiple: 1, closedAt: "2026-10-20T10:00:00.000Z", openedAt: "2026-10-20T09:00:00.000Z", emotion: null, discipline: null, confidence: null, journaled: false, stopLossSet: true },
      ],
      goodDisciplinePct: null,
      strategiesUsed: [],
      preferredSetupNames: [],
    });
    expect(rows.find((r) => r.label === "Sessions")?.onTrack).toBe(false);
  });
});

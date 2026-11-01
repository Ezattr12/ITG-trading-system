import { describe, expect, it } from "vitest";
import {
  calcAvgLoss,
  calcAvgWin,
  calcCurrentStreak,
  calcDrawdownSeries,
  calcDurationSeconds,
  calcEquityCurve,
  calcExpectancy,
  calcGoalProgress,
  calcLevelForScore,
  calcMaxDrawdown,
  calcPnl,
  calcProfitFactor,
  calcRBucket,
  calcRDistribution,
  calcRMultiple,
  calcRiskAmount,
  calcRiskReward,
  calcRoi,
  calcWinRate,
  calcXpFor,
  isWin,
} from "./index";

describe("calcPnl", () => {
  it("long trade: (exit - entry) * size - fees", () => {
    expect(calcPnl({ direction: "long", entryPrice: 100, exitPrice: 110, positionSize: 2 })).toBeCloseTo(20);
    expect(
      calcPnl({ direction: "long", entryPrice: 100, exitPrice: 110, positionSize: 2, fees: 1.5 }),
    ).toBeCloseTo(18.5);
  });
  it("short trade: (entry - exit) * size", () => {
    expect(calcPnl({ direction: "short", entryPrice: 100, exitPrice: 90, positionSize: 2 })).toBeCloseTo(20);
    expect(calcPnl({ direction: "short", entryPrice: 100, exitPrice: 110, positionSize: 2 })).toBeCloseTo(-20);
  });
  it("losing long trade is negative", () => {
    expect(calcPnl({ direction: "long", entryPrice: 110, exitPrice: 100, positionSize: 1 })).toBeCloseTo(-10);
  });
  it("does not suffer float error: 0.1-scale prices", () => {
    // 0.3 - 0.1 in binary float is 0.19999999999999998; Decimal must give 0.2 * 10 = 2
    expect(calcPnl({ direction: "long", entryPrice: "0.1", exitPrice: "0.3", positionSize: "10" })).toBeCloseTo(2);
  });
});

describe("calcRiskAmount / calcRMultiple / calcRiskReward", () => {
  it("risk amount is |entry - SL| * size", () => {
    expect(calcRiskAmount({ entryPrice: 100, stopLoss: 95, positionSize: 2 })).toBeCloseTo(10);
    expect(calcRiskAmount({ entryPrice: 100, stopLoss: 105, positionSize: 2 })).toBeCloseTo(10);
  });
  it("risk amount is null without SL", () => {
    expect(calcRiskAmount({ entryPrice: 100, stopLoss: null, positionSize: 2 })).toBeNull();
  });
  it("R multiple is pnl / risk", () => {
    expect(calcRMultiple({ pnl: 20, riskAmount: 10 })).toBeCloseTo(2);
    expect(calcRMultiple({ pnl: -10, riskAmount: 10 })).toBeCloseTo(-1);
  });
  it("R multiple is null with no/zero risk", () => {
    expect(calcRMultiple({ pnl: 20, riskAmount: null })).toBeNull();
    expect(calcRMultiple({ pnl: 20, riskAmount: 0 })).toBeNull();
  });
  it("risk/reward is reward / risk", () => {
    expect(
      calcRiskReward({ direction: "long", entryPrice: 100, stopLoss: 95, takeProfit: 115 }),
    ).toBeCloseTo(3);
    expect(
      calcRiskReward({ direction: "short", entryPrice: 100, stopLoss: 105, takeProfit: 85 }),
    ).toBeCloseTo(3);
  });
  it("risk/reward is null without TP or SL, or with zero risk", () => {
    expect(calcRiskReward({ direction: "long", entryPrice: 100, stopLoss: null, takeProfit: 115 })).toBeNull();
    expect(calcRiskReward({ direction: "long", entryPrice: 100, stopLoss: 95, takeProfit: null })).toBeNull();
    expect(calcRiskReward({ direction: "long", entryPrice: 100, stopLoss: 100, takeProfit: 115 })).toBeNull();
  });
});

describe("calcRoi", () => {
  it("ROI is pnl / invested * 100, leverage reduces invested capital", () => {
    expect(calcRoi({ pnl: 20, entryPrice: 100, positionSize: 2 })).toBeCloseTo(10);
    expect(calcRoi({ pnl: 20, entryPrice: 100, positionSize: 2, leverage: 10 })).toBeCloseTo(100);
  });
  it("ROI is null when invested is zero", () => {
    expect(calcRoi({ pnl: 20, entryPrice: 0, positionSize: 2 })).toBeNull();
  });
});

describe("isWin / calcDurationSeconds", () => {
  it("isWin is pnl > 0 only", () => {
    expect(isWin(1)).toBe(true);
    expect(isWin(0)).toBe(false);
    expect(isWin(-1)).toBe(false);
  });
  it("duration is whole seconds between open and close", () => {
    expect(calcDurationSeconds("2026-10-27T10:00:00Z", "2026-10-27T10:30:00Z")).toBe(1800);
    expect(calcDurationSeconds("2026-10-27T10:00:00Z", null)).toBeNull();
    expect(calcDurationSeconds("2026-10-27T10:30:00Z", "2026-10-27T10:00:00Z")).toBeNull();
  });
});

describe("aggregate performance", () => {
  const pnls = [100, -50, 200, -50, 50];
  it("win rate", () => {
    expect(calcWinRate(pnls)).toBeCloseTo(60);
    expect(calcWinRate([])).toBeNull();
  });
  it("average win / average loss", () => {
    expect(calcAvgWin(pnls)).toBeCloseTo(350 / 3);
    expect(calcAvgLoss(pnls)).toBeCloseTo(-50);
    expect(calcAvgWin([-10])).toBeNull();
    expect(calcAvgLoss([10])).toBeNull();
  });
  it("profit factor is gross profit / gross loss", () => {
    expect(calcProfitFactor(pnls)).toBeCloseTo(3.5);
    expect(calcProfitFactor([100, 200])).toBeNull(); // no losing trades: unbounded, not infinity
    expect(calcProfitFactor([])).toBeNull();
  });
  it("expectancy is average pnl per trade", () => {
    expect(calcExpectancy(pnls)).toBeCloseTo(50);
    expect(calcExpectancy([])).toBeNull();
  });
  it("max drawdown is the largest peak-to-trough fall", () => {
    expect(calcMaxDrawdown([1000, 1200, 1100, 1300, 900])).toBeCloseTo(400);
    expect(calcMaxDrawdown([1000, 1100, 1200])).toBe(0);
    expect(calcMaxDrawdown([])).toBe(0);
  });
  it("current streak counts trailing wins/losses", () => {
    expect(calcCurrentStreak([100, -50, 200, 50])).toBe(2);
    expect(calcCurrentStreak([100, -50, -20])).toBe(-2);
    expect(calcCurrentStreak([])).toBe(0);
  });
});

describe("XP and levels", () => {
  it("XP table matches spec §24", () => {
    expect(calcXpFor("trade_journal")).toBe(10);
    expect(calcXpFor("daily_goal")).toBe(20);
    expect(calcXpFor("backtest_session")).toBe(15);
    expect(calcXpFor("weekly_review")).toBe(30);
    expect(calcXpFor("risk_discipline")).toBe(25);
  });
  it("levels are multi-dimensional thresholds, not profit", () => {
    expect(calcLevelForScore(0)).toBe("Bronze");
    expect(calcLevelForScore(39)).toBe("Bronze");
    expect(calcLevelForScore(40)).toBe("Silver");
    expect(calcLevelForScore(60)).toBe("Gold");
    expect(calcLevelForScore(80)).toBe("Platinum");
    expect(calcLevelForScore(150)).toBe("Platinum");
    expect(calcLevelForScore(-5)).toBe("Bronze");
  });
});

describe("calcGoalProgress", () => {
  it("12 / 15 = 80%", () => {
    expect(calcGoalProgress({ current: 12, target: 15 })).toEqual({ current: 12, target: 15, percent: 80 });
  });
  it("null target is invalid", () => {
    expect(calcGoalProgress({ current: 5, target: 0 })).toBeNull();
  });
});

describe("equity curve / drawdown series (Phase 4)", () => {
  it("equity curve is cumulative pnl starting at 0", () => {
    expect(calcEquityCurve([100, -50, 200])).toEqual([100, 50, 250]);
    expect(calcEquityCurve([])).toEqual([]);
  });
  it("drawdown series tracks peak and fall from peak", () => {
    const series = calcDrawdownSeries([100, 50, 250]);
    expect(series).toEqual([
      { equity: 100, peak: 100, drawdown: 0 },
      { equity: 50, peak: 100, drawdown: 50 },
      { equity: 250, peak: 250, drawdown: 0 },
    ]);
    expect(calcDrawdownSeries([])).toEqual([]);
    // starting below zero: first point is its own peak, no negative drawdown
    expect(calcDrawdownSeries([-50, -100])).toEqual([
      { equity: -50, peak: -50, drawdown: 0 },
      { equity: -100, peak: -50, drawdown: 50 },
    ]);
  });
  it("R buckets split at -2, -1, 0, 1, 2", () => {
    expect(calcRBucket(-3)).toBe("< -2R");
    expect(calcRBucket(-1.5)).toBe("-2 to -1R");
    expect(calcRBucket(-0.5)).toBe("-1 to 0R");
    expect(calcRBucket(0)).toBe("0 to 1R");
    expect(calcRBucket(1.5)).toBe("1 to 2R");
    expect(calcRBucket(2)).toBe("> 2R");
    expect(calcRBucket(null)).toBeNull();
  });
  it("R distribution counts buckets and nulls separately", () => {
    expect(calcRDistribution([2.5, 1.5, 0.5, -0.5, -1.5, -3, null])).toEqual({
      buckets: [
        { label: "< -2R", count: 1 },
        { label: "-2 to -1R", count: 1 },
        { label: "-1 to 0R", count: 1 },
        { label: "0 to 1R", count: 1 },
        { label: "1 to 2R", count: 1 },
        { label: "> 2R", count: 1 },
      ],
      noR: 1,
    });
    expect(calcRDistribution([])).toEqual({
      buckets: [
        { label: "< -2R", count: 0 },
        { label: "-2 to -1R", count: 0 },
        { label: "-1 to 0R", count: 0 },
        { label: "0 to 1R", count: 0 },
        { label: "1 to 2R", count: 0 },
        { label: "> 2R", count: 0 },
      ],
      noR: 0,
    });
  });
});

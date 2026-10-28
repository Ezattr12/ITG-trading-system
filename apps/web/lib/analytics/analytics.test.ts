import { describe, expect, it } from "vitest";
import {
  breakdownByDirection,
  breakdownBySession,
  breakdownByStrategy,
  buildEquityCurve,
  mondayOf,
  periodPnl,
  psychologySummary,
  rDistribution,
  summarizeTrades,
} from "./analytics";
import type { AnalyticTrade } from "./types";

function trade(partial: Partial<AnalyticTrade> & { pnl: number }): AnalyticTrade {
  return {
    id: partial.id ?? "t",
    pair: partial.pair ?? "EURUSD",
    direction: partial.direction ?? "long",
    session: partial.session ?? "london",
    strategyName: partial.strategyName ?? "FVG",
    pnl: partial.pnl,
    rMultiple: partial.rMultiple ?? null,
    closedAt: partial.closedAt ?? "2026-10-20T10:00:00Z",
    openedAt: partial.openedAt ?? "2026-10-20T09:00:00Z",
    emotion: partial.emotion ?? null,
    discipline: partial.discipline ?? null,
    confidence: partial.confidence ?? null,
    journaled: partial.journaled ?? false,
    stopLossSet: partial.stopLossSet ?? false,
  };
}

const trades = [
  trade({ id: "1", pnl: 100, rMultiple: 2, closedAt: "2026-10-20T10:00:00Z", session: "london", strategyName: "FVG", emotion: "calm", discipline: "good", confidence: 4, journaled: true, stopLossSet: true }),
  trade({ id: "2", pnl: -50, rMultiple: -1, closedAt: "2026-10-21T10:00:00Z", session: "new_york", strategyName: "FVG", emotion: "fear", discipline: "average", confidence: 2, journaled: true, stopLossSet: true }),
  trade({ id: "3", pnl: 200, rMultiple: 3, closedAt: "2026-10-22T10:00:00Z", session: "london", strategyName: "Order Block", emotion: "calm", discipline: "good", confidence: 5, journaled: false, stopLossSet: false }),
  trade({ id: "4", pnl: -50, rMultiple: -0.5, closedAt: "2026-10-27T10:00:00Z", session: "asia", strategyName: "FVG", emotion: "greed", discipline: "poor", confidence: 3, journaled: true, stopLossSet: true }),
  trade({ id: "5", pnl: 50, rMultiple: 1, closedAt: "2026-10-28T10:00:00Z", session: "london", strategyName: "FVG", emotion: "calm", discipline: "good", confidence: 4, journaled: true, stopLossSet: true }),
];

describe("summarizeTrades", () => {
  it("aggregates pnl, win rate, profit factor, expectancy, avg R, drawdown, streak", () => {
    const s = summarizeTrades(trades);
    expect(s.tradeCount).toBe(5);
    expect(s.totalPnl).toBe(250);
    expect(s.wins).toBe(3);
    expect(s.losses).toBe(2);
    expect(s.winRate).toBeCloseTo(60);
    expect(s.lossRate).toBeCloseTo(40);
    expect(s.avgWin).toBeCloseTo(350 / 3);
    expect(s.avgLoss).toBeCloseTo(-50);
    expect(s.profitFactor).toBeCloseTo(3.5);
    expect(s.expectancy).toBeCloseTo(50);
    expect(s.avgR).toBeCloseTo((2 - 1 + 3 - 0.5 + 1) / 5);
    expect(s.maxDrawdown).toBe(50);
    expect(s.currentStreak).toBe(1);
  });
  it("empty input returns nulls, never invented values", () => {
    const s = summarizeTrades([]);
    expect(s.tradeCount).toBe(0);
    expect(s.totalPnl).toBe(0);
    expect(s.winRate).toBeNull();
    expect(s.profitFactor).toBeNull();
    expect(s.expectancy).toBeNull();
    expect(s.avgR).toBeNull();
    expect(s.maxDrawdown).toBe(0);
    expect(s.currentStreak).toBe(0);
  });
  it("no losing trades leaves profit factor null (unbounded, not infinity)", () => {
    expect(summarizeTrades([trade({ pnl: 100 })]).profitFactor).toBeNull();
  });
});

describe("buildEquityCurve", () => {
  it("sorts by close time and accumulates pnl with drawdown", () => {
    const shuffled = [trades[4], trades[0], trades[2], trades[1], trades[3]];
    const curve = buildEquityCurve(shuffled);
    expect(curve.map((p) => p.equity)).toEqual([100, 50, 250, 200, 250]);
    expect(curve.map((p) => p.drawdown)).toEqual([0, 50, 0, 50, 0]);
    expect(curve[0].date).toBe("2026-10-20");
  });
  it("empty input gives an empty curve", () => {
    expect(buildEquityCurve([])).toEqual([]);
  });
});

describe("periodPnl", () => {
  it("buckets by day", () => {
    const days = periodPnl(trades, "day");
    expect(days).toHaveLength(5);
    expect(days[0]).toEqual({ label: "2026-10-20", pnl: 100, trades: 1, wins: 1 });
  });
  it("buckets by ISO week starting Monday", () => {
    expect(mondayOf(new Date("2026-10-20T10:00:00Z"))).toBe("2026-10-19");
    expect(mondayOf(new Date("2026-10-25T10:00:00Z"))).toBe("2026-10-19"); // Sunday belongs to the Monday week
    expect(mondayOf(new Date("2026-10-26T10:00:00Z"))).toBe("2026-10-26");
    const weeks = periodPnl(trades, "week");
    expect(weeks).toEqual([
      { label: "2026-10-19", pnl: 250, trades: 3, wins: 2 },
      { label: "2026-10-26", pnl: 0, trades: 2, wins: 1 },
    ]);
  });
  it("buckets by month", () => {
    expect(periodPnl(trades, "month")).toEqual([
      { label: "2026-10", pnl: 250, trades: 5, wins: 3 },
    ]);
  });
});

describe("breakdowns", () => {
  it("by strategy aggregates pnl and win rate per strategy", () => {
    const rows = breakdownByStrategy(trades);
    expect(rows[0].label).toBe("Order Block");
    expect(rows[0].pnl).toBe(200);
    const fvg = rows.find((r) => r.label === "FVG");
    expect(fvg?.trades).toBe(4);
    expect(fvg?.pnl).toBe(50);
    expect(fvg?.winRate).toBeCloseTo(50);
  });
  it("by session labels sessions, unknown as No session", () => {
    const rows = breakdownBySession(trades);
    expect(rows.map((r) => r.label).sort()).toEqual(["Asia", "London", "New York"]);
    expect(rows.find((r) => r.label === "London")?.trades).toBe(3);
  });
  it("by direction splits long/short", () => {
    const rows = breakdownByDirection([
      ...trades,
      trade({ id: "6", pnl: -20, direction: "short", closedAt: "2026-10-29T10:00:00Z" }),
    ]);
    expect(rows.find((r) => r.label === "Short")?.trades).toBe(1);
    expect(rows.find((r) => r.label === "Long")?.trades).toBe(5);
  });
  it("empty input gives empty breakdowns", () => {
    expect(breakdownByStrategy([])).toEqual([]);
  });
});

describe("rDistribution", () => {
  it("counts R buckets and no-R trades", () => {
    const dist = rDistribution(trades);
    expect(dist.noR).toBe(0);
    expect(dist.buckets.find((b) => b.label === "> 2R")?.count).toBe(2); // R 2 and R 3
    expect(dist.buckets.find((b) => b.label === "-1 to 0R")?.count).toBe(2); // R -1 and R -0.5
    const withNoR = rDistribution([trade({ pnl: 10, rMultiple: null })]);
    expect(withNoR.noR).toBe(1);
  });
});

describe("psychologySummary", () => {
  it("summarises emotion vs performance, confidence and discipline", () => {
    const p = psychologySummary(trades);
    const calm = p.byEmotion.find((r) => r.emotion === "calm");
    expect(calm?.trades).toBe(3);
    expect(calm?.pnl).toBe(350);
    expect(calm?.winRate).toBeCloseTo(100);
    expect(p.avgConfidence).toBeCloseTo(3.6);
    expect(p.goodDisciplinePct).toBeCloseTo(60);
    expect(p.stopLossPct).toBeCloseTo(80);
    expect(p.journalCompletionPct).toBeCloseTo(80);
  });
  it("empty input returns nulls and zeroes", () => {
    const p = psychologySummary([]);
    expect(p.byEmotion).toEqual([]);
    expect(p.avgConfidence).toBeNull();
    expect(p.goodDisciplinePct).toBeNull();
    expect(p.stopLossPct).toBe(0);
    expect(p.journalCompletionPct).toBe(0);
  });
});

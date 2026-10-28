import { describe, expect, it } from "vitest";
import { buildReportSummary, periodBounds } from "./reports";
import type { ReportLesson, ReportTrade } from "./types";

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

const trades = [
  trade({ pnl: 120, strategyName: "FVG", emotion: "calm" }),
  trade({ pnl: 80, strategyName: "FVG", emotion: "calm" }),
  trade({ pnl: -200, strategyName: "Order Block", emotion: "fomo", stopLossSet: false }),
  trade({ pnl: -50, strategyName: "Order Block", emotion: "fomo" }),
  trade({ pnl: 0, strategyName: "FVG", emotion: "neutral" }),
];

const lessons: ReportLesson[] = [
  { tradeId: "a", text: "Entered before confirmation", repeatedMistake: true },
  { tradeId: "b", text: "Entered before confirmation", repeatedMistake: true },
  { tradeId: "c", text: "Moved stop-loss", repeatedMistake: true },
];

describe("buildReportSummary", () => {
  it("aggregates trades, P&L, win rate and profit factor from real-shaped data", () => {
    const s = buildReportSummary({
      type: "monthly",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      trades,
      lessons,
      goalsCompleted: 2,
      goalsTotal: 3,
    });
    expect(s.tradesCount).toBe(5);
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(2);
    expect(s.breakeven).toBe(1);
    expect(s.totalPnl).toBe(-50);
    expect(s.winRate).toBe(40);
    expect(s.avgWin).toBe(100);
    expect(s.avgLoss).toBe(-125);
    expect(s.profitFactor).toBeCloseTo(200 / 250, 5);
    expect(s.expectancy).toBe(-10);
    expect(s.goalsCompleted).toBe(2);
    expect(s.goalsTotal).toBe(3);
  });

  it("breaks down by strategy, session and psychology", () => {
    const s = buildReportSummary({
      type: "weekly",
      periodStart: "2026-10-12",
      periodEnd: "2026-10-18",
      trades,
      lessons: [],
      goalsCompleted: 0,
      goalsTotal: 0,
    });
    const fvg = s.byStrategy.find((r) => r.name === "FVG");
    expect(fvg?.trades).toBe(3);
    expect(fvg?.totalPnl).toBe(200);
    const fomo = s.byEmotion.find((r) => r.name === "fomo");
    expect(fomo?.trades).toBe(2);
    expect(fomo?.totalPnl).toBe(-250);
  });

  it("names the most frequent losing setup and the most repeated mistake", () => {
    const s = buildReportSummary({
      type: "monthly",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      trades,
      lessons,
      goalsCompleted: 0,
      goalsTotal: 0,
    });
    expect(s.mostFrequentLosingSetup).toEqual({ name: "Order Block", losses: 2 });
    expect(s.mostRepeatedMistake).toEqual({
      text: "Entered before confirmation",
      count: 2,
    });
  });

  it("recommends only from the trader's own data — and says so when there is none", () => {
    const s = buildReportSummary({
      type: "monthly",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      trades,
      lessons,
      goalsCompleted: 0,
      goalsTotal: 0,
    });
    // Discipline is 80% (4 of 5 with SL) so no SL recommendation;
    // journal is 100% so no journal recommendation.
    expect(s.recommendations.join(" ")).toContain("Order Block");
    expect(s.recommendations.join(" ")).toContain("Entered before confirmation");
    expect(s.recommendations.join(" ")).toContain("fomo");

    const empty = buildReportSummary({
      type: "daily",
      periodStart: "2026-10-20",
      periodEnd: "2026-10-20",
      trades: [],
      lessons: [],
      goalsCompleted: 0,
      goalsTotal: 0,
    });
    expect(empty.tradesCount).toBe(0);
    expect(empty.winRate).toBeNull();
    expect(empty.profitFactor).toBeNull();
    expect(empty.mostFrequentLosingSetup).toBeNull();
    expect(empty.recommendations).toHaveLength(1);
    expect(empty.recommendations[0]).toContain("No closed trades");
  });

  it("flags low discipline and low journal completion from the data", () => {
    const sloppy = trades.map((t) => ({ ...t, stopLossSet: false, journaled: false }));
    const s = buildReportSummary({
      type: "weekly",
      periodStart: "2026-10-12",
      periodEnd: "2026-10-18",
      trades: sloppy,
      lessons: [],
      goalsCompleted: 0,
      goalsTotal: 0,
    });
    expect(s.disciplinePct).toBe(0);
    expect(s.journalCompletionPct).toBe(0);
    expect(s.recommendations.join(" ")).toContain("stop-loss");
    expect(s.recommendations.join(" ")).toContain("Journal completion");
  });
});

describe("periodBounds", () => {
  it("returns the day, Monday-first week, and calendar month", () => {
    expect(periodBounds("daily", "2026-10-15")).toEqual({
      start: "2026-10-15",
      end: "2026-10-15",
    });
    // 2026-10-15 is a Thursday: week Mon 12 – Sun 18 Oct.
    expect(periodBounds("weekly", "2026-10-15")).toEqual({
      start: "2026-10-12",
      end: "2026-10-18",
    });
    expect(periodBounds("monthly", "2026-10-15")).toEqual({
      start: "2026-10-01",
      end: "2026-10-31",
    });
  });

  it("returns null for an invalid anchor date", () => {
    expect(periodBounds("monthly", "not-a-date")).toBeNull();
  });
});

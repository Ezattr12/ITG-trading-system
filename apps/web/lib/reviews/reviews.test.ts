import { describe, expect, it } from "vitest";
import {
  computeWeeklyAggregates,
  mondayOfWeek,
  WEEKLY_REVIEW_XP,
  weekBounds,
} from "./reviews";
import { weeklyReviewSchema } from "./validation";

describe("weekly review XP", () => {
  it("awards +30 XP for a completed weekly review (spec §24)", () => {
    expect(WEEKLY_REVIEW_XP).toBe(30);
  });
});

describe("week bounds", () => {
  it("finds the Monday of a week and its Sunday end", () => {
    // 2026-10-15 is a Thursday.
    expect(mondayOfWeek("2026-10-15")).toBe("2026-10-12");
    expect(weekBounds("2026-10-15")).toEqual({
      start: "2026-10-12",
      end: "2026-10-18",
    });
    expect(mondayOfWeek("2026-10-12")).toBe("2026-10-12");
    expect(mondayOfWeek("not-a-date")).toBeNull();
  });
});

describe("computeWeeklyAggregates", () => {
  it("aggregates P&L, win rate, journal completion and best/worst strategy", () => {
    const agg = computeWeeklyAggregates([
      { pnl: 100, strategyName: "FVG", journaled: true },
      { pnl: 50, strategyName: "FVG", journaled: true },
      { pnl: -200, strategyName: "Order Block", journaled: false },
    ]);
    expect(agg.tradesCount).toBe(3);
    expect(agg.totalPnl).toBe(-50);
    expect(agg.winRatePct).toBeCloseTo(66.67, 1);
    expect(agg.journalCompletionPct).toBe(67);
    expect(agg.bestStrategy).toBe("FVG");
    expect(agg.worstStrategy).toBe("Order Block");
  });

  it("returns nulls, never fabricated numbers, for a week with no trades", () => {
    const agg = computeWeeklyAggregates([]);
    expect(agg.tradesCount).toBe(0);
    expect(agg.totalPnl).toBeNull();
    expect(agg.winRatePct).toBeNull();
    expect(agg.journalCompletionPct).toBeNull();
    expect(agg.bestStrategy).toBeNull();
    expect(agg.worstStrategy).toBeNull();
  });
});

describe("weeklyReviewSchema", () => {
  it("requires a real reflection and accepts optional mistake/focus", () => {
    expect(
      weeklyReviewSchema.safeParse({
        weekStartDate: "2026-10-12",
        reviewText: "Too short",
        mainMistake: null,
        focusNextWeek: null,
      }).success,
    ).toBe(false);
    const ok = weeklyReviewSchema.safeParse({
      weekStartDate: "2026-10-12",
      reviewText: "Good week overall, kept risk small.",
      mainMistake: "Chased one breakout",
      focusNextWeek: "Wait for confirmation",
    });
    expect(ok.success).toBe(true);
  });
});

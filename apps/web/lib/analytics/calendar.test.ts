import { describe, expect, it } from "vitest";
import {
  aggregateCalendarDays,
  buildMonthGrid,
  parseMonthParam,
  shiftMonth,
} from "./calendar";
import type { AnalyticTrade } from "./types";

function trade(partial: Partial<AnalyticTrade> & { pnl: number; closedAt: string }): AnalyticTrade {
  return {
    id: partial.id ?? "t",
    pair: "EURUSD",
    direction: "long",
    session: "london",
    strategyName: "FVG",
    pnl: partial.pnl,
    rMultiple: null,
    closedAt: partial.closedAt,
    openedAt: partial.closedAt,
    emotion: null,
    discipline: partial.discipline ?? null,
    confidence: null,
    journaled: partial.journaled ?? false,
    stopLossSet: false,
  };
}

describe("aggregateCalendarDays", () => {
  it("aggregates trades per day with pnl, wins and journal completion", () => {
    const days = aggregateCalendarDays(
      [
        trade({ pnl: 100, closedAt: "2026-10-20T10:00:00Z", journaled: true, discipline: "good" }),
        trade({ pnl: -50, closedAt: "2026-10-20T14:00:00Z", journaled: false, discipline: "poor" }),
        trade({ pnl: 200, closedAt: "2026-10-21T10:00:00Z", journaled: true, discipline: "good" }),
      ],
      [{ activity_date: "2026-10-20", journal_completed: true, study_hours: 2 }],
    );
    const day20 = days.get("2026-10-20");
    expect(day20?.trades).toBe(2);
    expect(day20?.pnl).toBe(50);
    expect(day20?.wins).toBe(1);
    expect(day20?.journalCompletionPct).toBe(50);
    expect(day20?.goodDisciplinePct).toBe(50);
    expect(day20?.journalCompleted).toBe(true);
    expect(day20?.studyHours).toBe(2);
    expect(days.get("2026-10-21")?.pnl).toBe(200);
  });
  it("activity-only days appear with zero trades, never as zero-P&L trading days", () => {
    const days = aggregateCalendarDays(
      [],
      [{ activity_date: "2026-10-22", journal_completed: false, study_hours: 0 }],
    );
    const day = days.get("2026-10-22");
    expect(day?.trades).toBe(0);
    expect(day?.journalCompleted).toBe(false);
  });
  it("empty input gives an empty map", () => {
    expect(aggregateCalendarDays([], []).size).toBe(0);
  });
});

describe("buildMonthGrid", () => {
  it("October 2026 starts on a Thursday: 3 blank cells, then the 1st", () => {
    const grid = buildMonthGrid(2026, 10, new Map());
    expect(grid[0][0].day).toBeNull();
    expect(grid[0][1].day).toBeNull();
    expect(grid[0][2].day).toBeNull();
    expect(grid[0][3].day).toBe(1);
    expect(grid.flat().filter((c) => c.day !== null)).toHaveLength(31);
    expect(grid.every((week) => week.length === 7)).toBe(true);
  });
  it("attaches day data to the right cell", () => {
    const days = aggregateCalendarDays(
      [trade({ pnl: 100, closedAt: "2026-10-20T10:00:00Z" })],
      [],
    );
    const grid = buildMonthGrid(2026, 10, days);
    const cell = grid.flat().find((c) => c.date === "2026-10-20");
    expect(cell?.data?.pnl).toBe(100);
    expect(grid.flat().find((c) => c.date === "2026-10-19")?.data).toBeNull();
  });
});

describe("parseMonthParam / shiftMonth", () => {
  it("parses valid months and falls back on bad input", () => {
    expect(parseMonthParam("2026-10")).toEqual({ year: 2026, month: 10 });
    expect(parseMonthParam("2026-13")).not.toEqual({ year: 2026, month: 13 });
    expect(parseMonthParam("junk")?.month).toBeGreaterThanOrEqual(1);
  });
  it("shifts across year boundaries", () => {
    expect(shiftMonth(2026, 1, -1)).toBe("2025-12");
    expect(shiftMonth(2026, 12, 1)).toBe("2027-01");
    expect(shiftMonth(2026, 10, 1)).toBe("2026-11");
  });
});

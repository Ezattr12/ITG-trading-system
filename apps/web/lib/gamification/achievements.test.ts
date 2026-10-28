import { describe, expect, it } from "vitest";
import type { AnalyticTrade } from "@/lib/analytics/types";
import type { AchievementRow, GamificationStats } from "./types";
import {
  achievementCriteriaMet,
  buildGamificationStats,
  countJournaledDayStreak,
  describeCriteria,
  newlyUnlockedAchievements,
} from "./achievements";

function achievement(partial: Partial<AchievementRow> = {}): AchievementRow {
  return {
    id: "ach-1",
    name: "Test",
    slug: "test",
    description: null,
    category: "trades",
    criteria: {},
    xp_reward: 10,
    ...partial,
  };
}

function stats(partial: Partial<GamificationStats> = {}): GamificationStats {
  return {
    tradesJournaled: 0,
    disciplineDays: 0,
    weeklyJournalPct: null,
    riskDisciplinedTrades: 0,
    backtestingSessions: 0,
    goalsCompleted: 0,
    monthlyJournalPct: null,
    ...partial,
  };
}

function trade(partial: Partial<AnalyticTrade> = {}): AnalyticTrade {
  return {
    id: "t1",
    pair: "EURUSD",
    direction: "long",
    session: "london",
    strategyName: "FVG",
    pnl: 10,
    rMultiple: 1,
    closedAt: "2026-10-27T10:00:00.000Z",
    openedAt: "2026-10-27T09:00:00.000Z",
    emotion: "calm",
    discipline: "good",
    confidence: 4,
    journaled: true,
    stopLossSet: true,
    ...partial,
  };
}

describe("achievementCriteriaMet", () => {
  it("meets each seeded criterion at its threshold", () => {
    expect(achievementCriteriaMet({ trades_journaled: 1 }, stats({ tradesJournaled: 1 }))).toBe(true);
    expect(achievementCriteriaMet({ trades_journaled: 10 }, stats({ tradesJournaled: 9 }))).toBe(false);
    expect(achievementCriteriaMet({ discipline_days: 7 }, stats({ disciplineDays: 7 }))).toBe(true);
    expect(achievementCriteriaMet({ risk_disciplined_trades: 30 }, stats({ riskDisciplinedTrades: 30 }))).toBe(true);
    expect(achievementCriteriaMet({ backtesting_sessions: 5 }, stats({ backtestingSessions: 5 }))).toBe(true);
    expect(achievementCriteriaMet({ goals_completed: 10 }, stats({ goalsCompleted: 10 }))).toBe(true);
  });

  it("does not award a percentage criterion with no trades in the window", () => {
    expect(achievementCriteriaMet({ weekly_journal_pct: 100 }, stats({ weeklyJournalPct: null }))).toBe(false);
    expect(achievementCriteriaMet({ weekly_journal_pct: 100 }, stats({ weeklyJournalPct: 100 }))).toBe(true);
    expect(achievementCriteriaMet({ weekly_journal_pct: 100 }, stats({ weeklyJournalPct: 99 }))).toBe(false);
    expect(achievementCriteriaMet({ monthly_journal_pct: 100 }, stats({ monthlyJournalPct: 100 }))).toBe(true);
  });

  it("never awards on empty, unknown or non-numeric criteria", () => {
    expect(achievementCriteriaMet({}, stats({ tradesJournaled: 100 }))).toBe(false);
    expect(achievementCriteriaMet({ something_new: 1 }, stats())).toBe(false);
    expect(achievementCriteriaMet({ trades_journaled: "10" }, stats({ tradesJournaled: 10 }))).toBe(false);
  });

  it("requires every criterion when several are set", () => {
    const criteria = { trades_journaled: 10, goals_completed: 1 };
    expect(achievementCriteriaMet(criteria, stats({ tradesJournaled: 10, goalsCompleted: 0 }))).toBe(false);
    expect(achievementCriteriaMet(criteria, stats({ tradesJournaled: 10, goalsCompleted: 1 }))).toBe(true);
  });
});

describe("newlyUnlockedAchievements", () => {
  it("returns only earned achievements not already unlocked", () => {
    const list = [
      achievement({ id: "a1", slug: "first-trade", criteria: { trades_journaled: 1 } }),
      achievement({ id: "a2", slug: "trades-10", criteria: { trades_journaled: 10 } }),
      achievement({ id: "a3", slug: "goal-master", criteria: { goals_completed: 10 } }),
    ];
    const unlocked = newlyUnlockedAchievements(list, new Set(["a1"]), stats({ tradesJournaled: 12 }));
    expect(unlocked.map((a) => a.id)).toEqual(["a2"]);
  });

  it("returns nothing when nothing is earned", () => {
    const list = [achievement({ criteria: { trades_journaled: 1 } })];
    expect(newlyUnlockedAchievements(list, new Set(), stats())).toEqual([]);
  });
});

describe("describeCriteria", () => {
  it("describes the seeded criteria in plain language", () => {
    expect(describeCriteria({ trades_journaled: 10 })).toBe("10 trades journaled");
    expect(describeCriteria({ weekly_journal_pct: 100 })).toBe("100% weekly journal completion");
    expect(describeCriteria({})).toContain("No automatic criteria");
    expect(describeCriteria({ unknown_key: 3 })).toContain("No automatic criteria");
  });
});

describe("countJournaledDayStreak", () => {
  it("counts consecutive journaled days ending today", () => {
    const trades = [
      trade({ id: "a", closedAt: "2026-10-25T10:00:00.000Z" }),
      trade({ id: "b", closedAt: "2026-10-26T10:00:00.000Z" }),
      trade({ id: "c", closedAt: "2026-10-27T10:00:00.000Z" }),
    ];
    expect(countJournaledDayStreak(trades, "2026-10-27")).toBe(3);
  });

  it("allows a one-day grace when today is not journaled yet", () => {
    const trades = [
      trade({ id: "a", closedAt: "2026-10-25T10:00:00.000Z" }),
      trade({ id: "b", closedAt: "2026-10-26T10:00:00.000Z" }),
    ];
    expect(countJournaledDayStreak(trades, "2026-10-27")).toBe(2);
  });

  it("is 0 when the run is broken or nothing is journaled", () => {
    const trades = [trade({ id: "a", closedAt: "2026-10-20T10:00:00.000Z" })];
    expect(countJournaledDayStreak(trades, "2026-10-27")).toBe(0);
    expect(countJournaledDayStreak([], "2026-10-27")).toBe(0);
    expect(countJournaledDayStreak([trade({ journaled: false })], "2026-10-27")).toBe(0);
  });
});

describe("buildGamificationStats", () => {
  it("builds stats from real trades", () => {
    const trades = [
      trade({ id: "a", closedAt: "2026-10-26T10:00:00.000Z" }),
      trade({ id: "b", closedAt: "2026-10-27T10:00:00.000Z", journaled: false }),
      trade({ id: "c", closedAt: "2026-10-27T11:00:00.000Z" }),
    ];
    const result = buildGamificationStats({
      trades,
      goalsCompleted: 2,
      backtestingSessions: 5,
      riskDisciplinedTrades: 3,
      today: "2026-10-27",
    });
    expect(result.tradesJournaled).toBe(2);
    expect(result.disciplineDays).toBe(2);
    expect(result.weeklyJournalPct).toBeCloseTo(200 / 3);
    expect(result.monthlyJournalPct).toBeCloseTo(200 / 3);
    expect(result.goalsCompleted).toBe(2);
    expect(result.backtestingSessions).toBe(5);
    expect(result.riskDisciplinedTrades).toBe(3);
  });

  it("reports null weekly/monthly percentages with no trades in the window", () => {
    const result = buildGamificationStats({
      trades: [],
      goalsCompleted: 0,
      backtestingSessions: 0,
      riskDisciplinedTrades: 0,
      today: "2026-10-27",
    });
    expect(result.weeklyJournalPct).toBeNull();
    expect(result.monthlyJournalPct).toBeNull();
    expect(result.tradesJournaled).toBe(0);
  });
});

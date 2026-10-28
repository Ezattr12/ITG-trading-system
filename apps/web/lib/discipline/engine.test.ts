import { describe, expect, it } from "vitest";
import {
  buildDisciplineReminder,
  countMissedDays,
  currentRunLoggedLevel,
  daysBetween,
  disciplineReminderLevel,
  escalationNeeded,
  goalReached,
  measureGoal,
  periodWindow,
  resolveGoalProgress,
  type GoalMeasurementContext,
} from "./engine";
import type { Goal } from "./types";

function goal(partial: Partial<Goal> = {}): Goal {
  return {
    id: "goal-1",
    user_id: "user-1",
    title: "Journal 15 trades",
    period: "monthly",
    goal_type: "max_trades",
    target_value: 15,
    target_unit: "trades",
    start_date: "2026-10-01",
    end_date: null,
    status: "active",
    ...partial,
  };
}

function context(partial: Partial<GoalMeasurementContext> = {}): GoalMeasurementContext {
  return {
    trades: [],
    activity: [],
    hasRiskRules: true,
    maxLeverage: 10,
    ...partial,
  };
}

describe("daysBetween / periodWindow", () => {
  it("counts whole days between UTC dates", () => {
    expect(daysBetween("2026-10-20", "2026-10-27")).toBe(7);
    expect(daysBetween("2026-10-27", "2026-10-27")).toBe(0);
  });

  it("weekly window starts on Monday", () => {
    // 2026-10-27 is a Tuesday; the Monday is 2026-10-26.
    expect(periodWindow("weekly", "2026-10-27", "2026-10-01", null)).toEqual({
      start: "2026-10-26",
      end: "2026-10-27",
    });
  });

  it("weekly window on a Sunday starts the previous Monday", () => {
    expect(periodWindow("weekly", "2026-10-25", "2026-10-01", null)).toEqual({
      start: "2026-10-19",
      end: "2026-10-25",
    });
  });

  it("monthly window starts on the 1st and clamps to the goal start", () => {
    expect(periodWindow("monthly", "2026-10-27", "2026-10-20", null)).toEqual({
      start: "2026-10-20",
      end: "2026-10-27",
    });
    expect(periodWindow("monthly", "2026-10-27", "2026-10-01", null)).toEqual({
      start: "2026-10-01",
      end: "2026-10-27",
    });
  });

  it("daily window is today only", () => {
    expect(periodWindow("daily", "2026-10-27", "2026-10-01", null)).toEqual({
      start: "2026-10-27",
      end: "2026-10-27",
    });
  });
});

describe("discipline reminder escalation (Day 1 / 2 / 3)", () => {
  it("no missed days when journaled today", () => {
    expect(countMissedDays("2026-10-27", "2026-10-27")).toBe(0);
    expect(disciplineReminderLevel(0)).toBe(0);
    expect(buildDisciplineReminder("2026-10-27", "2026-10-27").level).toBe(0);
  });

  it("one missed day is a Day 1 reminder", () => {
    const r = buildDisciplineReminder("2026-10-26", "2026-10-27");
    expect(r.level).toBe(1);
    expect(r.missedDays).toBe(1);
    expect(r.title).toMatch(/reminder/i);
  });

  it("two missed days is a Day 2 warning", () => {
    expect(buildDisciplineReminder("2026-10-25", "2026-10-27").level).toBe(2);
  });

  it("three or more missed days is the strongest reminder", () => {
    expect(buildDisciplineReminder("2026-10-24", "2026-10-27").level).toBe(3);
    expect(buildDisciplineReminder("2026-10-01", "2026-10-27").level).toBe(3);
  });

  it("never journaled means no invented missed-day count", () => {
    expect(countMissedDays(null, "2026-10-27")).toBeNull();
    expect(buildDisciplineReminder(null, "2026-10-27").level).toBe(0);
  });

  it("reminder copy is supportive, never shaming", () => {
    for (const days of [1, 2, 3, 10]) {
      const last = `2026-10-${String(27 - days).padStart(2, "0")}`;
      const body = buildDisciplineReminder(last, "2026-10-27").body.toLowerCase();
      expect(body).not.toMatch(/shame|lazy|failure|bad trader|disappoint/);
      expect(body.length).toBeGreaterThan(20);
    }
  });

  it("escalation only fires when the level rises", () => {
    expect(escalationNeeded(0, 1)).toBe(true);
    expect(escalationNeeded(1, 1)).toBe(false);
    expect(escalationNeeded(1, 2)).toBe(true);
    expect(escalationNeeded(3, 3)).toBe(false);
    expect(escalationNeeded(0, 0)).toBe(false);
  });

  it("an event from an earlier run does not block a fresh Day 1", () => {
    // Trader journaled again on 2026-10-26; the level-3 event from
    // 2026-10-20 belongs to the old run.
    expect(currentRunLoggedLevel({ event_date: "2026-10-20", level: 3 }, "2026-10-26")).toBe(0);
    // Same-run event does count.
    expect(currentRunLoggedLevel({ event_date: "2026-10-27", level: 1 }, "2026-10-26")).toBe(1);
    expect(currentRunLoggedLevel(null, "2026-10-26")).toBe(0);
  });
});

describe("measureGoal", () => {
  const trades = [
    { openedAt: "2026-10-05T10:00:00Z", closedAt: "2026-10-05T11:00:00Z", status: "closed", pnl: 120, journaled: true, stopLossSet: true, leverage: 5 },
    { openedAt: "2026-10-06T10:00:00Z", closedAt: "2026-10-06T11:00:00Z", status: "closed", pnl: -50, journaled: false, stopLossSet: false, leverage: 20 },
    { openedAt: "2026-10-27T10:00:00Z", closedAt: null, status: "open", pnl: null, journaled: false, stopLossSet: true, leverage: 2 },
  ];

  it("max_trades counts trades opened in the window", () => {
    const m = measureGoal(goal({ goal_type: "max_trades" }), context({ trades }), "2026-10-27");
    expect(m).toEqual({ current: 3, measurable: true, reason: null });
  });

  it("journal_completion counts journaled closed trades, and is unmeasurable with none", () => {
    const m = measureGoal(goal({ goal_type: "journal_completion" }), context({ trades }), "2026-10-27");
    expect(m.current).toBe(1);
    expect(m.measurable).toBe(true);
    const empty = measureGoal(goal({ goal_type: "journal_completion" }), context(), "2026-10-27");
    expect(empty.measurable).toBe(false);
    expect(empty.reason).toMatch(/No closed trades/);
  });

  it("study_hours and backtesting sum daily activity in the window", () => {
    const ctx = context({
      activity: [
        { activity_date: "2026-10-26", journal_completed: true, study_hours: 1.5, backtesting_sessions: 2, trading_sessions_count: 1 },
        { activity_date: "2026-09-01", journal_completed: false, study_hours: 9, backtesting_sessions: 9, trading_sessions_count: 9 },
      ],
    });
    expect(measureGoal(goal({ goal_type: "study_hours" }), ctx, "2026-10-27").current).toBe(1.5);
    expect(measureGoal(goal({ goal_type: "backtesting_sessions" }), ctx, "2026-10-27").current).toBe(2);
    expect(measureGoal(goal({ goal_type: "trading_sessions" }), ctx, "2026-10-27").current).toBe(1);
  });

  it("risk_discipline needs risk rules and closed trades", () => {
    const noRules = measureGoal(goal({ goal_type: "risk_discipline" }), context({ trades, hasRiskRules: false }), "2026-10-27");
    expect(noRules.measurable).toBe(false);
    expect(noRules.reason).toMatch(/risk rules/);
    // One of the two closed trades is disciplined (SL set, leverage within 10).
    const m = measureGoal(goal({ goal_type: "risk_discipline" }), context({ trades }), "2026-10-27");
    expect(m).toEqual({ current: 1, measurable: true, reason: null });
  });

  it("performance_target sums closed P&L in the window", () => {
    const m = measureGoal(goal({ goal_type: "performance_target", target_value: 500 }), context({ trades }), "2026-10-27");
    expect(m.current).toBe(70);
    expect(m.measurable).toBe(true);
  });

  it("other goals are manual-only", () => {
    const m = measureGoal(goal({ goal_type: "other" }), context({ trades }), "2026-10-27");
    expect(m.measurable).toBe(false);
    expect(m.reason).toMatch(/manually/);
  });

  it("trades outside the window do not count", () => {
    const m = measureGoal(
      goal({ goal_type: "max_trades", period: "daily" }),
      context({ trades }),
      "2026-10-27",
    );
    expect(m.current).toBe(1);
  });
});

describe("resolveGoalProgress", () => {
  it("measured progress is 12/15 = 80%", () => {
    const trades = Array.from({ length: 12 }, (_, i) => ({
      openedAt: `2026-10-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
      closedAt: null,
      status: "open",
      pnl: null,
      journaled: false,
      stopLossSet: false,
      leverage: null,
    }));
    const r = resolveGoalProgress(goal(), context({ trades }), null, "2026-10-27");
    expect(r.currentValue).toBe(12);
    expect(r.percent).toBe(80);
    expect(r.source).toBe("measured");
    expect(goalReached(r)).toBe(false);
  });

  it("a manual row is used when the goal cannot be measured", () => {
    const r = resolveGoalProgress(
      goal({ goal_type: "other" }),
      context(),
      { goal_id: "goal-1", current_value: 5, recorded_date: "2026-10-27", note: null },
      "2026-10-27",
    );
    expect(r.currentValue).toBe(5);
    expect(r.source).toBe("manual");
    expect(r.measurable).toBe(true);
  });

  it("an unmeasurable goal with no manual row says so honestly", () => {
    const r = resolveGoalProgress(goal({ goal_type: "other" }), context(), null, "2026-10-27");
    expect(r.measurable).toBe(false);
    expect(r.currentValue).toBeNull();
    expect(r.percent).toBeNull();
    expect(r.notMeasurableReason).toMatch(/manually/);
  });

  it("goalReached is true at 100% for an active goal", () => {
    const r = resolveGoalProgress(
      goal({ goal_type: "other", target_value: 5 }),
      context(),
      { goal_id: "goal-1", current_value: 5, recorded_date: "2026-10-27", note: null },
      "2026-10-27",
    );
    expect(goalReached(r)).toBe(true);
    expect(goalReached({ ...r, goal: { ...r.goal, status: "paused" } })).toBe(false);
  });
});

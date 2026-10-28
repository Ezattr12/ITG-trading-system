/**
 * Goals & discipline engine (Phase 6, spec §21–22, §30).
 *
 * Pure functions — no I/O, no Supabase. All measurements come from
 * the caller's real stored data; a goal that cannot be measured
 * from that data is reported as not measurable, never guessed.
 *
 * Discipline reminders are supportive and professional, never
 * shaming or insulting (spec §22). Escalation: Day 1 reminder,
 * Day 2 warning, Day 3+ stronger reminder. A missed day counts
 * from the last day the trader journaled: journaled today = 0
 * missed days, last journaled yesterday = 1 missed day.
 */

import { calcGoalProgress } from "@itg/calc";
import type {
  DailyActivityRow,
  DisciplineReminder,
  Goal,
  GoalProgressRow,
  GoalWithProgress,
} from "./types";

/* ------------------------------------------------------------------ dates */

/** Parse a YYYY-MM-DD date as UTC midnight. */
export function parseDay(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/** Format a Date as YYYY-MM-DD (UTC). */
export function toDayString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** Whole days from `from` (inclusive) to `to` (exclusive), UTC. */
export function daysBetween(from: string, to: string): number {
  const ms = parseDay(to).getTime() - parseDay(from).getTime();
  return Math.floor(ms / 86_400_000);
}

/**
 * The measurement window for a goal period, ending today.
 * Weekly windows start on Monday; monthly on the 1st; yearly on
 * 1 January. Clamped to the goal's own start/end dates.
 */
export function periodWindow(
  period: Goal["period"],
  today: string,
  startDate: string,
  endDate: string | null,
): { start: string; end: string } {
  const todayDate = parseDay(today);
  let start: Date;
  if (period === "daily") {
    start = todayDate;
  } else if (period === "weekly") {
    // Monday of the current week (getUTCDay: 0 = Sunday).
    const day = todayDate.getUTCDay();
    start = addDays(todayDate, day === 0 ? -6 : 1 - day);
  } else if (period === "monthly") {
    start = new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth(), 1));
  } else {
    start = new Date(Date.UTC(todayDate.getUTCFullYear(), 0, 1));
  }
  const goalStart = parseDay(startDate);
  if (goalStart.getTime() > start.getTime()) start = goalStart;
  let end = todayDate;
  if (endDate) {
    const goalEnd = parseDay(endDate);
    if (goalEnd.getTime() < end.getTime()) end = goalEnd;
  }
  return { start: toDayString(start), end: toDayString(end) };
}

/* ------------------------------------------------------- discipline engine */

/**
 * Whole days since the last journaled day. 0 when the trader
 * journaled today. Null when they have never journaled — we do
 * not invent a missed-day count for a trader with no history.
 */
export function countMissedDays(
  lastJournalDate: string | null,
  today: string,
): number | null {
  if (!lastJournalDate) return null;
  const missed = daysBetween(lastJournalDate, today);
  return missed < 0 ? 0 : missed;
}

/** Escalation level for a missed-day count: 0 = none, 1–3 = Day 1/2/3+. */
export function disciplineReminderLevel(missedDays: number | null): 0 | 1 | 2 | 3 {
  if (missedDays === null || missedDays <= 0) return 0;
  if (missedDays === 1) return 1;
  if (missedDays === 2) return 2;
  return 3;
}

const REMINDER_COPY: Record<
  1 | 2 | 3,
  { title: string; body: (missedDays: number, lastDate: string) => string }
> = {
  1: {
    title: "A gentle reminder to journal",
    body: (_missed, lastDate) =>
      `You haven't journaled since ${lastDate}. Taking a few minutes to record your trades keeps your edge sharp — your future self will thank you for the notes.`,
  },
  2: {
    title: "Your journal is waiting",
    body: (missed) =>
      `It's been ${missed} days since your last journal entry. A short note on your recent trades is enough to stay on track — there is no need to catch up on everything at once.`,
  },
  3: {
    title: "Let's get back on track, together",
    body: (missed) =>
      `It's been ${missed} days since your last journal entry. Small, steady steps rebuild the habit — even one trade reviewed today is a good restart. Your progress is still here when you're ready.`,
  },
};

/** The current discipline reminder for a trader, from their last journaled day. */
export function buildDisciplineReminder(
  lastJournalDate: string | null,
  today: string,
): DisciplineReminder {
  const missedDays = countMissedDays(lastJournalDate, today);
  const level = disciplineReminderLevel(missedDays);
  if (level === 0 || missedDays === null || !lastJournalDate) {
    return { level: 0, missedDays: missedDays ?? 0, title: "", body: "" };
  }
  const copy = REMINDER_COPY[level];
  return {
    level,
    missedDays,
    title: copy.title,
    body: copy.body(missedDays, lastJournalDate),
  };
}

/**
 * True when a new discipline event should be logged: the reminder
 * escalated past the highest level already logged for this streak.
 * The same level is never logged twice, so a repeated page visit
 * cannot spam the log (the table's unique key enforces this too).
 */
export function escalationNeeded(
  lastLoggedLevel: number,
  currentLevel: number,
): boolean {
  return currentLevel >= 1 && currentLevel > lastLoggedLevel;
}

/**
 * Highest reminder level already logged for the *current* missed
 * run — the run that started the day after `lastJournalDate`.
 * An event from an earlier run (before the trader journaled
 * again) does not count, so a fresh Day 1 reminder is logged when
 * a new run starts. 0 when nothing was logged in this run.
 */
export function currentRunLoggedLevel(
  latestEvent: { event_date: string; level: number } | null,
  lastJournalDate: string | null,
): number {
  if (!latestEvent) return 0;
  if (lastJournalDate && latestEvent.event_date <= lastJournalDate) return 0;
  return latestEvent.level;
}

/* ------------------------------------------------------------ goal measure */

export interface GoalMeasurementTrade {
  openedAt: string;
  closedAt: string | null;
  status: string;
  pnl: number | null;
  journaled: boolean;
  stopLossSet: boolean;
  leverage: number | null;
}

export interface GoalMeasurementContext {
  trades: GoalMeasurementTrade[];
  activity: DailyActivityRow[];
  /** False when the trader has no active risk rules — discipline cannot be measured. */
  hasRiskRules: boolean;
  maxLeverage: number | null;
}

function inWindow(date: string, window: { start: string; end: string }): boolean {
  return date >= window.start && date <= window.end;
}

function sumActivity(
  activity: DailyActivityRow[],
  window: { start: string; end: string },
  pick: (row: DailyActivityRow) => number,
): number {
  return activity
    .filter((row) => inWindow(row.activity_date, window))
    .reduce((sum, row) => sum + pick(row), 0);
}

/**
 * Measure a goal from real stored data.
 * Returns null when the goal cannot be measured from the data
 * available (with the reason why, for the UI to show honestly).
 */
export function measureGoal(
  goal: Goal,
  context: GoalMeasurementContext,
  today: string,
): { current: number; measurable: boolean; reason: string | null } {
  const window = periodWindow(goal.period, today, goal.start_date, goal.end_date);
  const closedInWindow = context.trades.filter(
    (t) => t.status === "closed" && t.closedAt !== null && inWindow(t.closedAt.slice(0, 10), window),
  );
  const openedInWindow = context.trades.filter((t) =>
    inWindow(t.openedAt.slice(0, 10), window),
  );

  switch (goal.goal_type) {
    case "max_trades":
      // A count of trades is always a real measurement, even when it is 0.
      return { current: openedInWindow.length, measurable: true, reason: null };
    case "journal_completion": {
      if (closedInWindow.length === 0) {
        return { current: 0, measurable: false, reason: "No closed trades in this period yet." };
      }
      const journaled = closedInWindow.filter((t) => t.journaled).length;
      return { current: journaled, measurable: true, reason: null };
    }
    case "study_hours":
      return {
        current: sumActivity(context.activity, window, (r) => r.study_hours),
        measurable: true,
        reason: null,
      };
    case "backtesting_sessions":
      return {
        current: sumActivity(context.activity, window, (r) => r.backtesting_sessions),
        measurable: true,
        reason: null,
      };
    case "trading_sessions":
      return {
        current: sumActivity(context.activity, window, (r) => r.trading_sessions_count),
        measurable: true,
        reason: null,
      };
    case "risk_discipline": {
      if (!context.hasRiskRules) {
        return {
          current: 0,
          measurable: false,
          reason: "Set your risk rules first — discipline is measured against them.",
        };
      }
      if (closedInWindow.length === 0) {
        return { current: 0, measurable: false, reason: "No closed trades in this period yet." };
      }
      const disciplined = closedInWindow.filter(
        (t) =>
          t.stopLossSet &&
          (context.maxLeverage === null ||
            t.leverage === null ||
            t.leverage <= context.maxLeverage),
      ).length;
      return { current: disciplined, measurable: true, reason: null };
    }
    case "performance_target": {
      // Cumulative P&L of closed trades in the window; 0 with no
      // trades is honest — no P&L has been made yet.
      const pnl = closedInWindow.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
      return { current: pnl, measurable: true, reason: null };
    }
    case "other":
    default:
      return {
        current: 0,
        measurable: false,
        reason: "This goal is tracked manually — record your progress below.",
      };
  }
}

/**
 * Resolve a goal's progress: measured from real data where the
 * goal type allows it, otherwise the latest manual progress row
 * the trader recorded, otherwise honestly not measurable.
 */
export function resolveGoalProgress(
  goal: Goal,
  context: GoalMeasurementContext,
  manual: GoalProgressRow | null,
  today: string,
): GoalWithProgress {
  const measured = measureGoal(goal, context, today);
  if (measured.measurable) {
    const progress = calcGoalProgress({ current: measured.current, target: goal.target_value });
    return {
      goal,
      currentValue: measured.current,
      percent: progress?.percent ?? null,
      measurable: true,
      notMeasurableReason: null,
      source: "measured",
    };
  }
  if (manual) {
    const progress = calcGoalProgress({ current: manual.current_value, target: goal.target_value });
    return {
      goal,
      currentValue: manual.current_value,
      percent: progress?.percent ?? null,
      measurable: true,
      notMeasurableReason: null,
      source: "manual",
    };
  }
  return {
    goal,
    currentValue: null,
    percent: null,
    measurable: false,
    notMeasurableReason: measured.reason,
    source: "none",
  };
}

/** True when an active goal has reached (or passed) its target. */
export function goalReached(resolved: GoalWithProgress): boolean {
  return (
    resolved.goal.status === "active" &&
    resolved.percent !== null &&
    resolved.percent >= 100
  );
}

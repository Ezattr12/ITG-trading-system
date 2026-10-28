import type { AnalyticTrade } from "@/lib/analytics/types";
import type { AchievementRow, GamificationStats } from "./types";

/**
 * Achievement evaluation (Phase 7, spec §25). Pure functions:
 * no I/O, no Supabase.
 *
 * Achievements are config rows, not code: each row's `criteria`
 * jsonb names the stat and the threshold, e.g.
 * `{ "trades_journaled": 10 }`. Adding a new achievement is a
 * seed/config row — no code change. A criterion key this file
 * does not know is never treated as met (never guess), and an
 * achievement with empty criteria never auto-awards.
 *
 * Known criteria (all from the Phase 1 seed):
 * - trades_journaled: closed trades with psychology or a lesson
 * - discipline_days: current run of consecutive journaled days
 * - weekly_journal_pct: this week's journaled share (needs ≥1 closed trade)
 * - risk_disciplined_trades: current run of risk-disciplined closed trades
 * - backtesting_sessions: sessions recorded in daily_activity
 * - goals_completed: goals with status "completed"
 * - monthly_journal_pct: this month's journaled share (needs ≥1 closed trade)
 */

export const ACHIEVEMENT_CRITERIA_LABELS: Record<string, string> = {
  trades_journaled: "trades journaled",
  discipline_days: "consecutive disciplined days",
  weekly_journal_pct: "weekly journal completion",
  risk_disciplined_trades: "risk-disciplined trades in a row",
  backtesting_sessions: "backtesting sessions",
  goals_completed: "goals completed",
  monthly_journal_pct: "monthly journal completion",
};

/** Human-readable description of a criteria object, e.g. "Journal 10 trades". */
export function describeCriteria(criteria: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(criteria)) {
    if (typeof value !== "number") continue;
    const label = ACHIEVEMENT_CRITERIA_LABELS[key];
    if (!label) continue;
    const suffix = key.endsWith("_pct") ? "%" : "";
    parts.push(`${value}${suffix} ${label}`);
  }
  return parts.length === 0 ? "No automatic criteria — awarded manually." : parts.join(" · ");
}

/** Stat value for one criterion key, or null when it cannot be measured. */
function statForKey(
  key: string,
  stats: GamificationStats,
): number | null {
  switch (key) {
    case "trades_journaled":
      return stats.tradesJournaled;
    case "discipline_days":
      return stats.disciplineDays;
    case "weekly_journal_pct":
      return stats.weeklyJournalPct;
    case "risk_disciplined_trades":
      return stats.riskDisciplinedTrades;
    case "backtesting_sessions":
      return stats.backtestingSessions;
    case "goals_completed":
      return stats.goalsCompleted;
    case "monthly_journal_pct":
      return stats.monthlyJournalPct;
    default:
      return null;
  }
}

/**
 * True when every criterion in `criteria` is met. All criteria
 * must be numbers; a non-number threshold, an unknown key, or a
 * stat that cannot be measured means the achievement is not met.
 */
export function achievementCriteriaMet(
  criteria: Record<string, unknown>,
  stats: GamificationStats,
): boolean {
  const entries = Object.entries(criteria);
  if (entries.length === 0) return false;
  for (const [key, threshold] of entries) {
    if (typeof threshold !== "number" || !Number.isFinite(threshold)) return false;
    const value = statForKey(key, stats);
    if (value === null || value < threshold) return false;
  }
  return true;
}

/** Achievements the trader has earned but not yet been awarded. */
export function newlyUnlockedAchievements(
  achievements: readonly AchievementRow[],
  unlockedIds: ReadonlySet<string>,
  stats: GamificationStats,
): AchievementRow[] {
  return achievements.filter(
    (a) => !unlockedIds.has(a.id) && achievementCriteriaMet(a.criteria, stats),
  );
}

/**
 * Consecutive days with at least one journaled closed trade,
 * ending today — or yesterday, since today may not be over yet.
 * 0 when the last journaled day was before yesterday (the run
 * is broken) or there is no journaled trade at all.
 */
export function countJournaledDayStreak(
  trades: readonly AnalyticTrade[],
  today: string,
): number {
  const dates = new Set(
    trades.filter((t) => t.journaled).map((t) => t.closedAt.slice(0, 10)),
  );
  if (dates.size === 0) return 0;
  const cursor = new Date(`${today}T00:00:00.000Z`);
  if (!dates.has(today)) cursor.setUTCDate(cursor.getUTCDate() - 1);
  let streak = 0;
  while (dates.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

/** Journaled share of closed trades in a window, or null when nothing closed. */
function journalPctInWindow(
  trades: readonly AnalyticTrade[],
  start: string,
  end: string,
): number | null {
  const inWindow = trades.filter(
    (t) => t.closedAt.slice(0, 10) >= start && t.closedAt.slice(0, 10) <= end,
  );
  if (inWindow.length === 0) return null;
  return (inWindow.filter((t) => t.journaled).length / inWindow.length) * 100;
}

/**
 * Build the achievement stats from real data. `riskDisciplinedTrades`
 * and `backtestingSessions` come from the risk engine and
 * daily_activity (callers fetch them); the rest is computed here
 * from the trader's closed trades and goals.
 */
export function buildGamificationStats(input: {
  trades: readonly AnalyticTrade[];
  goalsCompleted: number;
  backtestingSessions: number;
  riskDisciplinedTrades: number;
  today: string;
}): GamificationStats {
  const { trades, today } = input;
  const weekStart = new Date(`${today}T00:00:00.000Z`);
  const day = weekStart.getUTCDay();
  weekStart.setUTCDate(weekStart.getUTCDate() - (day === 0 ? 6 : day - 1));
  const monthStart = `${today.slice(0, 7)}-01`;
  return {
    tradesJournaled: trades.filter((t) => t.journaled).length,
    disciplineDays: countJournaledDayStreak(trades, today),
    weeklyJournalPct: journalPctInWindow(
      trades,
      weekStart.toISOString().slice(0, 10),
      today,
    ),
    riskDisciplinedTrades: input.riskDisciplinedTrades,
    backtestingSessions: input.backtestingSessions,
    goalsCompleted: input.goalsCompleted,
    monthlyJournalPct: journalPctInWindow(trades, monthStart, today),
  };
}

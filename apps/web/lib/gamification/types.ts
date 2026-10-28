import type { LevelName } from "@itg/calc";

/**
 * Gamification types (Phase 7, spec §8, §24–26).
 *
 * These mirror the Phase 1 gamification tables (`levels`,
 * `achievements`, `user_levels`, `user_achievements`,
 * `xp_transactions`, migration 0008) exactly. Levels are
 * multi-dimensional, NOT profit-only; XP rewards process,
 * discipline, learning and consistency, not only profit.
 */

export type XpReason =
  | "trade_journal"
  | "daily_goal"
  | "backtest_session"
  | "weekly_review"
  | "risk_discipline"
  | "achievement"
  | "penalty"
  | "other";

/** The eight level-score dimensions (spec §8). */
export type DimensionKey =
  | "discipline"
  | "risk"
  | "journal_consistency"
  | "goal_completion"
  | "psychology"
  | "strategy_execution"
  | "consistency"
  | "performance";

export const DIMENSION_KEYS: DimensionKey[] = [
  "discipline",
  "risk",
  "journal_consistency",
  "goal_completion",
  "psychology",
  "strategy_execution",
  "consistency",
  "performance",
];

export const DIMENSION_LABELS: Record<DimensionKey, string> = {
  discipline: "Discipline",
  risk: "Risk management",
  journal_consistency: "Journal consistency",
  goal_completion: "Goal completion",
  psychology: "Psychology",
  strategy_execution: "Strategy execution",
  consistency: "Consistency",
  performance: "Performance",
};

/** One dimension's score: 0–100, or null when there is no data to score it. */
export interface DimensionScore {
  key: DimensionKey;
  label: string;
  /** 0–100, or null when the dimension cannot be measured yet. */
  value: number | null;
  /** Weight used in the total (renormalised over measured dimensions). */
  weight: number;
}

/** A trader's level score, computed from real stored data. */
export interface LevelScoreResult {
  /** Weighted score, 0–100. Null when no dimension can be measured yet. */
  score: number | null;
  levelName: LevelName | null;
  dimensions: DimensionScore[];
  /** Dimensions with no data yet — shown honestly, never scored as 0. */
  missingDimensions: DimensionKey[];
}

export interface LevelRow {
  id: string;
  name: LevelName;
  slug: string;
  min_score: number;
  max_score: number | null;
  /** Dimension weights, e.g. { discipline: 0.20, ... }. Null/{} = defaults. */
  scoring_config: Record<string, unknown> | null;
  description: string | null;
}

export interface AchievementRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: string;
  /** e.g. { "trades_journaled": 10 } — see `achievements.ts`. */
  criteria: Record<string, unknown>;
  xp_reward: number;
}

export interface UserAchievementRow {
  id: string;
  user_id: string;
  achievement_id: string;
  unlocked_at: string;
}

export interface XpTransactionRow {
  id: string;
  user_id: string;
  amount: number;
  reason: XpReason;
  source_ref_id: string | null;
  note: string | null;
  created_at: string;
}

/** Raw inputs for the multi-dimensional level score. All 0–100 or null. */
export interface DimensionInputs {
  /** Share of rated trades with discipline "good". Null with no discipline data. */
  goodDisciplinePct: number | null;
  /** Share of closed trades with a stop-loss set. */
  stopLossPct: number | null;
  /** Share of closed trades that are journaled. */
  journalCompletionPct: number | null;
  /** Average goal progress, 0–100. Null with no goals. */
  goalCompletionPct: number | null;
  /** Average confidence, 1–5. Null with no confidence data. */
  avgConfidence: number | null;
  /** Share of closed trades with a strategy recorded. */
  strategySetPct: number | null;
  /** Share of weeks (since the first trade, max 12) with a journaled trade. */
  weeklyConsistencyPct: number | null;
  /** Win rate, 0–100. Null with no closed trades. */
  winRate: number | null;
}

/** The numbers the achievement criteria are checked against. */
export interface GamificationStats {
  /** Closed trades with a psychology record or a lesson. */
  tradesJournaled: number;
  /** Current run of consecutive days with a journaled trade (0 when the run is broken). */
  disciplineDays: number;
  /** Journaled share of this week's closed trades. Null when nothing closed this week. */
  weeklyJournalPct: number | null;
  /** Current run of consecutive risk-disciplined closed trades. */
  riskDisciplinedTrades: number;
  /** Backtesting sessions recorded in daily_activity. */
  backtestingSessions: number;
  /** Goals with status "completed". */
  goalsCompleted: number;
  /** Journaled share of this month's closed trades. Null when nothing closed this month. */
  monthlyJournalPct: number | null;
}

/**
 * AI Coach types (Phase 9, spec §28, §39).
 *
 * Every insight is computed from the trader's own stored data
 * and carries its evidence in `metricsSnapshot` — the real
 * numbers it was computed from. Nothing is invented: an insight
 * with no supporting data is never created, and the page says
 * so honestly instead.
 *
 * `insight_type` values are the `ai_insight_type` enum from
 * migration 0001. The `rule` inside the snapshot distinguishes
 * two insights of the same type in one week (for example two
 * `mistakes` insights: one for the losing setup, one for the
 * repeated mistake).
 */

export type CoachInsightType =
  | "weekly_performance"
  | "mistakes"
  | "best_strategy"
  | "worst_strategy"
  | "psychology"
  | "risk"
  | "goals"
  | "discipline"
  | "focus_next_week";

export type CoachSeverity = "high" | "medium" | "low" | "positive";

/**
 * Evidence for one insight. Every field is a real number from
 * the trader's stored trades / events / goals — never an
 * estimate. `recommendation` is the actionable advice tied to
 * that evidence. Optional fields are present only when the rule
 * that produced the insight measured them.
 */
export interface CoachMetricsSnapshot {
  rule: string;
  severity: CoachSeverity;
  recommendation: string;
  trades?: number;
  wins?: number;
  losses?: number;
  totalPnl?: number;
  winRate?: number | null;
  profitFactor?: number | null;
  avgR?: number | null;
  name?: string;
  strategy?: string;
  session?: string;
  emotion?: string;
  discipline?: string;
  mistake?: string;
  occurrences?: number;
  disciplinePct?: number | null;
  journalCompletionPct?: number | null;
  criticalRiskEvents?: number;
  warningRiskEvents?: number;
  positiveRiskEvents?: number;
  goalsCompleted?: number;
  goalsTotal?: number;
  currentStreak?: number;
}

/** One generated insight, ready to store as an `ai_insights` row. */
export interface CoachInsight {
  type: CoachInsightType;
  /** Short title — stored in `ai_insights.summary`. */
  title: string;
  metricsSnapshot: CoachMetricsSnapshot;
}

/** A stored `ai_insights` row (read shape). */
export interface AiInsightRow {
  id: string;
  user_id: string;
  insight_type: CoachInsightType;
  period_start: string | null;
  period_end: string | null;
  summary: string;
  metrics_snapshot: CoachMetricsSnapshot;
  generated_at: string;
  created_at: string;
}

/** Result of generating a week's coach analysis. */
export interface CoachAnalysis {
  periodStart: string;
  periodEnd: string;
  /** True when there were too few closed trades to analyse. */
  insufficientData: boolean;
  insights: CoachInsight[];
}

/** Minimum closed trades in a week before the coach analyses it. */
export const COACH_MIN_TRADES = 3;

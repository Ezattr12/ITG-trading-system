/**
 * Goals & discipline types (Phase 6, spec §21–23, §30).
 *
 * These mirror the Phase 1 tables (`goals`, `goal_progress`,
 * `daily_activity`, `motivation_messages`, `notifications`) and the
 * Phase 6 table (`discipline_events`, migration 0012) exactly.
 * A goal whose progress cannot be measured from stored data says
 * so honestly (`measurable: false`) instead of inventing a number.
 */

export type GoalPeriod = "daily" | "weekly" | "monthly" | "yearly";

export type GoalType =
  | "max_trades"
  | "journal_completion"
  | "study_hours"
  | "backtesting_sessions"
  | "trading_sessions"
  | "risk_discipline"
  | "performance_target"
  | "other";

export type GoalStatus = "active" | "completed" | "paused" | "failed";

export interface Goal {
  id: string;
  user_id: string;
  title: string;
  period: GoalPeriod;
  goal_type: GoalType;
  target_value: number;
  target_unit: string | null;
  start_date: string;
  end_date: string | null;
  status: GoalStatus;
}

/** Latest manually recorded progress row for a goal (may be absent). */
export interface GoalProgressRow {
  goal_id: string;
  current_value: number;
  recorded_date: string;
  note: string | null;
}

/** A goal with its progress resolved from real data (or honestly unmeasurable). */
export interface GoalWithProgress {
  goal: Goal;
  /** Measured current value. Null when the goal cannot be measured. */
  currentValue: number | null;
  /** 0–100+, uncapped. Null when the goal cannot be measured. */
  percent: number | null;
  /** False when no stored data can measure this goal yet. */
  measurable: boolean;
  /** Why the goal is not measurable, when it is not. */
  notMeasurableReason: string | null;
  /** Where the current value came from: real trades/activity, or a manual entry. */
  source: "measured" | "manual" | "none";
}

export type DisciplineEventKind = "missed_journal" | "rule_breach";

/** One logged discipline reminder (migration 0012, append-only). */
export interface DisciplineEvent {
  id: string;
  user_id: string;
  event_date: string;
  kind: DisciplineEventKind;
  /** Escalation level: 1 = reminder, 2 = warning, 3 = stronger reminder. */
  level: 1 | 2 | 3;
  message: string;
  created_at: string;
}

/** The current discipline reminder for a trader (computed, not stored). */
export interface DisciplineReminder {
  /** 0 = no reminder needed, 1 = Day 1, 2 = Day 2, 3 = Day 3+. */
  level: 0 | 1 | 2 | 3;
  /** Whole days since the last journaled day. 0 when journaled today. */
  missedDays: number;
  title: string;
  /** Supportive, professional copy — never shaming or insulting. */
  body: string;
}

export type MotivationContext =
  | "general"
  | "after_loss"
  | "missed_day"
  | "goal_near"
  | "streak"
  | "discipline";

export interface MotivationMessage {
  id: string;
  message: string;
  context: string | null;
  is_active: boolean;
}

export type NotificationType =
  | "goal_reminder"
  | "journal_reminder"
  | "risk_warning"
  | "discipline_warning"
  | "achievement"
  | "level_up"
  | "weekly_report"
  | "monthly_report"
  | "system";

export interface NotificationItem {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  is_read: boolean;
  related_entity_type: string | null;
  related_entity_id: string | null;
  created_at: string;
}

export interface DailyActivityRow {
  activity_date: string;
  journal_completed: boolean;
  study_hours: number;
  backtesting_sessions: number;
  trading_sessions_count: number;
}

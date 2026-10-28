/**
 * Weekly review types (Phase 8, spec §21, §27).
 *
 * These mirror the Phase 1 `weekly_reviews` table (migration
 * 0007) exactly. The aggregates (trades_count, total_pnl,
 * win_rate_pct, journal_completion_pct, best/worst strategy)
 * are computed server-side from the week's real trades when the
 * review is saved — the trader writes only the reflection
 * (review text, main mistake, focus for next week).
 */

export interface WeeklyReviewRow {
  id: string;
  user_id: string;
  week_start_date: string;
  week_end_date: string;
  trades_count: number;
  total_pnl: number | null;
  win_rate_pct: number | null;
  journal_completion_pct: number | null;
  best_strategy: string | null;
  worst_strategy: string | null;
  main_mistake: string | null;
  focus_next_week: string | null;
  review_text: string | null;
  status: "draft" | "completed";
  created_at: string;
  updated_at: string;
}

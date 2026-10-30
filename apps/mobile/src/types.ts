/**
 * Mobile data types — Phase 21 M2.
 *
 * These mirror the REAL production shapes exactly:
 * - Database rows mirror the web app's row types
 *   (apps/web/lib/trades/types.ts, lib/discipline/types.ts,
 *   lib/auth/session.ts, lib/coach/types.ts).
 * - `ReportSummary` mirrors apps/web/lib/reports/types.ts,
 *   which is what GET /api/mobile/summary returns.
 *
 * The mobile shell never invents fields and never calculates
 * financial values: every number shown is a stored value from
 * the database or an aggregate computed server-side by the web
 * app's report engine.
 */

export type Direction = "long" | "short";
export type TradeStatus = "open" | "closed" | "reversed" | string;

export interface TradeRow {
  id: string;
  user_id: string;
  asset_id: string | null;
  pair: string;
  direction: Direction;
  entry_price: number;
  exit_price: number | null;
  tp: number | null;
  sl: number | null;
  position_size: number;
  leverage: number;
  fees: number;
  opened_at: string;
  closed_at: string | null;
  status: TradeStatus;
  strategy_id: string | null;
  setup_id: string | null;
  market_condition: string | null;
  trade_reason: string | null;
  session: string | null;
  notes: string | null;
  pnl: number | null;
  roi_pct: number | null;
  r_multiple: number | null;
  risk_reward: number | null;
  is_win: boolean | null;
  duration_seconds: number | null;
  reversal_trade_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PsychologyRow {
  id: string;
  trade_id: string | null;
  user_id: string;
  confidence: number | null;
  emotion: string | null;
  discipline: string | null;
  recorded_at: string;
}

export interface LessonRow {
  id: string;
  trade_id: string | null;
  user_id: string;
  text: string;
  is_repeated_mistake: boolean;
  created_at: string;
}

export interface GoalRow {
  id: string;
  user_id: string;
  title: string;
  period: "daily" | "weekly" | "monthly" | "yearly";
  goal_type: string;
  target_value: number;
  target_unit: string | null;
  start_date: string;
  end_date: string | null;
  status: "active" | "completed" | "paused" | "failed";
  created_at?: string;
}

export interface GoalProgressRow {
  goal_id: string;
  current_value: number;
  recorded_date: string;
  note: string | null;
}

export interface ProfileRow {
  id: string;
  full_name: string | null;
  father_name: string | null;
  date_of_birth: string | null;
  country: string | null;
  avatar_url: string | null;
  trading_experience: string | null;
  trading_education: string | null;
  backtesting_experience: boolean;
  backtested_trades: number;
  real_trading_experience: boolean;
  real_trades_count: number;
  demo_trading: boolean;
  employment_status: string;
  monthly_income: number | null;
  trading_capital: number | null;
  trades_real_money: boolean;
  historical_profit: number | null;
  historical_loss: number | null;
  verification_status: string;
  role: string;
}

/** One row of `user_levels` joined with its level name. */
export interface UserLevelRow {
  score: number | null;
  score_breakdown: Record<string, number | null> | null;
  calculated_at: string | null;
  levels: { name: string } | { name: string }[] | null;
}

export interface AiInsightRow {
  id: string;
  user_id: string;
  insight_type: string;
  period_start: string | null;
  period_end: string | null;
  summary: string;
  generated_at: string;
  created_at: string;
}

/* ---------------- Report summary (API contract) ---------------- */

export interface BreakdownRow {
  name: string;
  trades: number;
  wins: number;
  totalPnl: number;
  winRate: number | null;
}

/** Mirrors apps/web/lib/reports/types.ts `ReportSummary`. */
export interface ReportSummary {
  type: "daily" | "weekly" | "monthly";
  periodStart: string;
  periodEnd: string;
  tradesCount: number;
  wins: number;
  losses: number;
  breakeven: number;
  totalPnl: number;
  winRate: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  avgR: number | null;
  journalCompletionPct: number | null;
  disciplinePct: number | null;
  goalsCompleted: number;
  goalsTotal: number;
  byStrategy: BreakdownRow[];
  bySession: BreakdownRow[];
  byEmotion: BreakdownRow[];
  mostFrequentLosingSetup: { name: string; losses: number } | null;
  mostRepeatedMistake: { text: string; count: number } | null;
  recommendations: string[];
}

export type SummaryRange = "week" | "month";

/** GET /api/mobile/summary?range=week|month */
export interface SummaryResponse {
  range: SummaryRange;
  period_start: string;
  period_end: string;
  summary: ReportSummary;
}

/** POST /api/mobile/session */
export interface SessionBootstrapResponse {
  profile_id: string;
  created: boolean;
  onboarding_complete: boolean;
}

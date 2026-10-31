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

/** One row of the `levels` table (thresholds for level bands). */
export interface LevelRowLite {
  name: string;
  min_score: number;
  max_score: number | null;
}

/** employmentStatusSchema (lib/auth/validation.ts). */
export type EmploymentStatus =
  | "full_time"
  | "part_time"
  | "employed_other_job"
  | "unemployed"
  | "studying"
  | "not_provided";

/**
 * profileEditSchema (lib/auth/validation.ts) — PATCH
 * /api/mobile/profile. FULL-FORM save: every key is sent on
 * every save (the booleans and fullName are required by the
 * schema; the rest are nullable). employed_other_job requires
 * monthlyIncome — the full form keeps that satisfiable.
 */
export interface ProfileUpdatePayload {
  fullName: string;
  fatherName: string | null;
  dateOfBirth: string | null;
  country: string | null;
  tradingExperience: string | null;
  tradingEducation: string | null;
  backtestingExperience: boolean;
  backtestedTrades: number | null;
  realTradingExperience: boolean;
  realTradesCount: number | null;
  demoTrading: boolean;
  employmentStatus: EmploymentStatus;
  monthlyIncome: number | null;
  tradingCapital: number | null;
  tradesRealMoney: boolean;
}

/** PATCH /api/mobile/profile → 200 `{ profile }` (the updated row, snake_case). */
export interface ProfileUpdateResponse {
  profile: {
    id: string;
    full_name: string;
    father_name: string | null;
    date_of_birth: string | null;
    country: string | null;
    trading_experience: string | null;
    trading_education: string | null;
    backtesting_experience: boolean;
    backtested_trades: number | null;
    real_trading_experience: boolean;
    real_trades_count: number | null;
    demo_trading: boolean;
    employment_status: string;
    monthly_income: number | null;
    trading_capital: number | null;
    trades_real_money: boolean;
  };
}

/** POST /api/mobile/profile/avatar → 200 `{ avatar_url }`. */
export interface AvatarUploadResponse {
  avatar_url: string;
}

/** One earned achievement: `user_achievements` joined with its catalogue name. */
export interface EarnedAchievementRow {
  unlocked_at: string;
  achievements: { name: string } | { name: string }[] | null;
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

/* ---------------- Phase 25 write contracts ----------------
 *
 * Payload types mirror the web Zod schemas the /api/mobile
 * handlers enforce (apps/web/lib/trades/validation.ts,
 * lib/discipline/validation.ts, lib/risk/validation.ts,
 * lib/reviews/validation.ts, lib/coach/validation.ts). Bodies
 * are camelCase schema field names; the API rejects unknown
 * keys and identity fields with a 400. Nullable schema fields
 * are sent explicitly as null — keys are never omitted, so the
 * payload shape is traceable to the handler key lists in
 * apps/web/lib/api/handlers/*.ts (see docs/phase-25.md).
 */

export interface StrategyRow {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
}

export interface SetupRow {
  id: string;
  strategy_id: string | null;
  name: string;
}

export interface ScreenshotRow {
  id: string;
  trade_id: string;
  user_id: string;
  storage_path: string;
  file_name: string | null;
  ocr_status: string;
  created_at: string;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  is_read: boolean;
  related_entity_type: string | null;
  related_entity_id: string | null;
  created_at: string;
}

export interface RiskRulesRow {
  id: string;
  user_id: string;
  plan_id: string | null;
  max_risk_per_trade_pct: number | null;
  max_daily_loss: number | null;
  max_trades_per_day: number | null;
  max_consecutive_losses: number | null;
  max_leverage: number | null;
  is_active: boolean;
}

export interface TradingPlanRow {
  id: string;
  user_id: string;
  name: string;
  markets: string[];
  sessions: string[];
  risk_per_trade_pct: number | null;
  max_daily_loss: number | null;
  max_daily_trades: number | null;
  preferred_setup_ids: string[];
  no_trade_conditions: string | null;
  psychology_rules: string | null;
  schedule: { notes?: string } | null;
  is_active: boolean;
}

export interface WeeklyReviewRow {
  id: string;
  user_id: string;
  week_start_date: string;
  review_text: string;
  main_mistake: string | null;
  focus_next_week: string | null;
}

/** quickTradeSchema (lib/trades/validation.ts) — POST /api/mobile/trades and POST .../trades/[id]/correct. */
export interface QuickTradePayload {
  pair: string;
  direction: Direction;
  entryPrice: number;
  exitPrice: number | null;
  tp: number | null;
  sl: number | null;
  positionSize: number;
  strategyId: string | null;
  leverage: number;
  fees: number | null;
  openedAt: string;
  closedAt: string | null;
}

/** POST /api/mobile/trades → 201 */
export interface CreateTradeResponse {
  trade: {
    id: string;
    pair: string;
    direction: string;
    status: string;
    pnl: number | null;
    roi_pct: number | null;
    r_multiple: number | null;
    opened_at: string;
    closed_at: string | null;
  };
}

/** POST /api/mobile/trades/[id]/correct → 201 */
export interface CorrectTradeResponse {
  trade_id: string;
  reversed_trade_id: string;
}

/** POST /api/mobile/trades/[id]/cancel → 200 */
export interface CancelTradeResponse {
  trade_id: string;
  status: string;
}

export type MarketCondition =
  | "trending"
  | "ranging"
  | "choppy"
  | "high_volatility"
  | "low_volatility"
  | "other";
export type TradeReason =
  | "strategy"
  | "technical_setup"
  | "liquidity"
  | "news"
  | "fomo"
  | "revenge"
  | "random"
  | "other";
export type TradingSessionName = "asia" | "london" | "new_york" | "other";
export type EmotionName = "calm" | "fear" | "greed" | "fomo" | "revenge" | "neutral";
export type DisciplineName = "good" | "average" | "poor";

/**
 * advancedReviewSchema minus tradeId (lib/trades/validation.ts)
 * — POST /api/mobile/trades/[id]/review. FULL-FORM save: every
 * field overwrites the trade, so strategyId and setupName must
 * round-trip the trade's current values (see docs/phase-25.md).
 */
export interface AdvancedReviewPayload {
  strategyId: string | null;
  setupName: string | null;
  marketCondition: MarketCondition | null;
  tradeReason: TradeReason | null;
  session: TradingSessionName | null;
  confidence: number | null;
  emotion: EmotionName | null;
  discipline: DisciplineName | null;
  lesson: string | null;
  notes: string | null;
}

/** goalSchema (lib/discipline/validation.ts) — POST /api/mobile/goals. */
export interface GoalCreatePayload {
  title: string;
  period: GoalRow["period"];
  goalType: string;
  targetValue: number;
  targetUnit: string | null;
  startDate: string;
  endDate: string | null;
}

/** POST /api/mobile/goals → 201 */
export interface CreateGoalResponse {
  goal: {
    id: string;
    title: string;
    period: string;
    goal_type: string;
    target_value: number;
    target_unit: string | null;
    start_date: string;
    end_date: string | null;
    status: string;
  };
}

/** goalProgressSchema minus goalId — POST /api/mobile/goals/[id]/progress. */
export interface GoalProgressPayload {
  currentValue: number;
  note: string | null;
}

/** riskRulesSchema (lib/risk/validation.ts) — PUT /api/mobile/risk-rules. */
export interface RiskRulesPayload {
  maxRiskPerTradePct: number | null;
  maxDailyLoss: number | null;
  maxTradesPerDay: number | null;
  maxConsecutiveLosses: number | null;
  maxLeverage: number | null;
}

/** tradingPlanSchema (lib/risk/validation.ts) — PUT /api/mobile/risk-plan. */
export interface TradingPlanPayload {
  name: string;
  markets: string[];
  sessions: TradingSessionName[];
  riskPerTradePct: number | null;
  maxDailyLoss: number | null;
  maxDailyTrades: number | null;
  preferredSetupIds: string[];
  noTradeConditions: string | null;
  psychologyRules: string | null;
  scheduleNotes: string | null;
}

/** weeklyReviewSchema (lib/reviews/validation.ts) — POST /api/mobile/reviews/weekly. */
export interface WeeklyReviewPayload {
  weekStartDate: string;
  reviewText: string;
  mainMistake: string | null;
  focusNextWeek: string | null;
}

/** POST /api/mobile/reviews/weekly → 200 */
export interface WeeklyReviewResponse {
  review_id: string;
  xp_awarded: number;
}

/** POST /api/mobile/backtesting → 200 */
export interface BacktestingResponse {
  sessions: number;
  sessions_awarded: number;
  xp_awarded: number;
}

/** POST /api/mobile/notifications/read → 200 */
export interface MarkReadResponse {
  updated: number;
}

/** POST /api/mobile/trades/[id]/screenshots → 201 */
export interface UploadScreenshotResponse {
  screenshot_id: string;
}

/* ---------------- Phase 26 coach chat contracts ----------------
 *
 * Mirror lib/coach/chat.ts (CoachChatAnswer) and the request
 * contract lib/coach/chat-handler.ts enforces: the body is
 * { message, history? } — message ≤ 1000 chars, history the
 * last 6 turns of { role, content }. POST
 * /api/mobile/coach/chat returns the web chat response shape
 * verbatim. The app renders the answer; it never computes
 * any part of it.
 */

/** One history turn (lib/coach/chat.ts CoachChatHistoryTurn). */
export interface CoachChatHistoryTurn {
  role: "user" | "assistant";
  content: string;
}

/** POST /api/mobile/coach/chat request body. */
export interface CoachChatPayload {
  message: string;
  history: CoachChatHistoryTurn[];
}

/** The numbers behind an answer (lib/coach/chat.ts CoachChatEvidence). */
export interface CoachChatEvidence {
  scope: string;
  periodStart: string | null;
  periodEnd: string | null;
  tradesCount: number | null;
  wins: number | null;
  losses: number | null;
  totalPnl: number | null;
  winRate: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  avgR: number | null;
}

/** POST /api/mobile/coach/chat → 200 (lib/coach/chat.ts CoachChatAnswer). */
export interface CoachChatAnswer {
  status: "ok" | "insufficient_data";
  intent: string;
  facts: string[];
  inferences: string[];
  recommendations: string[];
  evidence: CoachChatEvidence;
  /** Which rendering produced the sections — surfaced as the mode badge. */
  narration: "llm" | "deterministic";
  /** Provider name when narration is "llm" ("anthropic" / "openai"). */
  narrationProvider?: string;
}

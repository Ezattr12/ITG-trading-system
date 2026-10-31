import type {
  DisciplineName,
  EmotionName,
  EmploymentStatus,
  MarketCondition,
  TradeReason,
  TradingSessionName,
} from "./types";

/**
 * Picker options for the write forms — values and labels
 * mirror the web validation label maps exactly
 * (apps/web/lib/trades/validation.ts), so a value chosen on
 * mobile means the same thing as the same value on web.
 */

export interface Option<T extends string> {
  value: T;
  label: string;
}

export const MARKET_CONDITION_OPTIONS: Option<MarketCondition>[] = [
  { value: "trending", label: "Trending" },
  { value: "ranging", label: "Ranging" },
  { value: "choppy", label: "Choppy" },
  { value: "high_volatility", label: "High Volatility" },
  { value: "low_volatility", label: "Low Volatility" },
  { value: "other", label: "Other" },
];

export const TRADE_REASON_OPTIONS: Option<TradeReason>[] = [
  { value: "strategy", label: "Strategy" },
  { value: "technical_setup", label: "Technical Setup" },
  { value: "liquidity", label: "Liquidity" },
  { value: "news", label: "News" },
  { value: "fomo", label: "FOMO" },
  { value: "revenge", label: "Revenge" },
  { value: "random", label: "Random" },
  { value: "other", label: "Other" },
];

export const SESSION_OPTIONS: Option<TradingSessionName>[] = [
  { value: "asia", label: "Asia" },
  { value: "london", label: "London" },
  { value: "new_york", label: "New York" },
  { value: "other", label: "Other" },
];

export const EMOTION_OPTIONS: Option<EmotionName>[] = [
  { value: "calm", label: "Calm" },
  { value: "fear", label: "Fear" },
  { value: "greed", label: "Greed" },
  { value: "fomo", label: "FOMO" },
  { value: "revenge", label: "Revenge" },
  { value: "neutral", label: "Neutral" },
];

export const DISCIPLINE_OPTIONS: Option<DisciplineName>[] = [
  { value: "good", label: "Good" },
  { value: "average", label: "Average" },
  { value: "poor", label: "Poor" },
];

export const GOAL_PERIOD_OPTIONS: Option<"daily" | "weekly" | "monthly" | "yearly">[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

export const GOAL_TYPE_OPTIONS: Option<string>[] = [
  { value: "max_trades", label: "Max trades" },
  { value: "journal_completion", label: "Journal completion" },
  { value: "study_hours", label: "Study hours" },
  { value: "backtesting_sessions", label: "Backtesting sessions" },
  { value: "trading_sessions", label: "Trading sessions" },
  { value: "risk_discipline", label: "Risk discipline" },
  { value: "performance_target", label: "Performance target" },
  { value: "other", label: "Other" },
];

/** employmentStatusSchema labels — identical to the web profile form's select. */
export const EMPLOYMENT_STATUS_OPTIONS: Option<EmploymentStatus>[] = [
  { value: "full_time", label: "Full-time" },
  { value: "part_time", label: "Part-time" },
  { value: "employed_other_job", label: "Employed (other job)" },
  { value: "unemployed", label: "Unemployed" },
  { value: "studying", label: "Studying" },
  { value: "not_provided", label: "Prefer not to say" },
];

export const GOAL_STATUS_OPTIONS: Option<"active" | "completed" | "paused" | "failed">[] = [
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "paused", label: "Paused" },
  { value: "failed", label: "Failed" },
];

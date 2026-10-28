/**
 * Trade types (Phase 3, spec §9–16, §32–33).
 *
 * These mirror the Phase 1 tables (`trades`, `trade_screenshots`,
 * `psychology_records`, `lessons`, `strategies`, `setups`) exactly.
 * Calculated fields (pnl, roi_pct, r_multiple, risk_reward, is_win,
 * duration_seconds) are stored on the trade row but are computed
 * server-side by `lib/trades/calculations.ts` — never user-entered.
 */

export type Direction = "long" | "short";
export type TradeStatus = "open" | "closed" | "cancelled" | "reversed";
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
export type TradingSession = "asia" | "london" | "new_york" | "other";
export type Emotion = "calm" | "fear" | "greed" | "fomo" | "revenge" | "neutral";
export type DisciplineRating = "good" | "average" | "poor";
export type OcrStatus = "pending" | "extracted" | "verified" | "rejected" | "not_applicable";

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
  market_condition: MarketCondition | null;
  trade_reason: TradeReason | null;
  session: TradingSession | null;
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
  emotion: Emotion | null;
  discipline: DisciplineRating | null;
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

export interface ScreenshotRow {
  id: string;
  trade_id: string;
  user_id: string;
  storage_path: string;
  file_name: string | null;
  ocr_status: OcrStatus;
  ocr_extracted: Record<string, unknown> | null;
  verified_by_user: boolean;
  created_at: string;
}

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

/** One row of the trade list: trade + its joined display data. */
export interface TradeListItem {
  trade: TradeRow;
  strategyName: string | null;
  setupName: string | null;
  confidence: number | null;
  emotion: Emotion | null;
  discipline: DisciplineRating | null;
}

export interface TradeDetail {
  trade: TradeRow;
  strategyName: string | null;
  setupName: string | null;
  psychology: PsychologyRow | null;
  lessons: LessonRow[];
  screenshots: ScreenshotRow[];
  /** The trade this one corrected (when this trade is a reversal). */
  reversedTrade: TradeRow | null;
  /** The correcting trade, when this trade was reversed. */
  correctingTrade: TradeRow | null;
}

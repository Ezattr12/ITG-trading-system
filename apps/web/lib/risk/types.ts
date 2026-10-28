/**
 * Risk & trading-plan types (Phase 5, spec §19–20).
 *
 * These mirror the Phase 1 tables (`trading_plans`, `risk_rules`)
 * and the Phase 5 table (`risk_events`, migration 0011) exactly.
 * A risk rule field left null means "no limit set" — the engine
 * skips that check rather than inventing a limit.
 */

import type { TradingSession } from "@/lib/trades/types";

export interface RiskRules {
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

export interface TradingPlan {
  id: string;
  user_id: string;
  name: string;
  markets: string[];
  sessions: TradingSession[];
  risk_per_trade_pct: number | null;
  max_daily_loss: number | null;
  max_daily_trades: number | null;
  preferred_setup_ids: string[];
  no_trade_conditions: string | null;
  psychology_rules: string | null;
  schedule: { notes?: string } | null;
  is_active: boolean;
}

export type RiskEventType =
  | "daily_loss_limit"
  | "daily_trade_limit"
  | "consecutive_losses"
  | "leverage_limit"
  | "risk_per_trade"
  | "positive_streak";

export type RiskEventSeverity = "warning" | "critical" | "positive";

export interface RiskEvent {
  id: string;
  user_id: string;
  plan_id: string | null;
  risk_rule_id: string | null;
  trade_id: string | null;
  type: RiskEventType;
  severity: RiskEventSeverity;
  message: string;
  details: Record<string, unknown>;
  resolved_at: string | null;
  created_at: string;
}

/** One rule evaluation against a trade / day. */
export interface RiskCheck {
  rule: RiskEventType;
  severity: RiskEventSeverity;
  /** True when the rule is breached (warning / critical) or the positive milestone is hit. */
  breached: boolean;
  message: string;
  /** The observed value (e.g. leverage used, trades today). Null when not applicable. */
  value: number | null;
  /** The configured limit. Null when the rule is not set. */
  limit: number | null;
}

/** One row of the plan-vs-actual comparison (spec §20). */
export interface PlanVsActualRow {
  label: string;
  planned: string;
  actual: string;
  /** True = on plan, false = off plan, null = cannot be measured from trades. */
  onTrack: boolean | null;
}

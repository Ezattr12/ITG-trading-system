/**
 * Trading-plan enforcement types (Task 19).
 *
 * These mirror migration 0019 (`plan_events`) and the pure
 * engine in lib/plan/engine.ts. Enforcement is OBSERVATIONAL:
 * a verdict is computed for every term the plan and the trade
 * honestly support, breaches are logged + notified, and a
 * save is NEVER blocked by the plan (blocking belongs to the
 * risk rules and to the Task 20 pre-trade gate).
 */

import type { TradingSession } from "@/lib/trades/types";

/** The six plan terms the engine can evaluate (migration 0019 enum). */
export type PlanTerm =
  | "market"
  | "session"
  | "setup"
  | "risk_per_trade"
  | "daily_trade_limit"
  | "daily_loss_limit";

/** Trade-level terms dedupe per (user, trade, term). */
export const PLAN_TRADE_TERMS: readonly PlanTerm[] = [
  "market",
  "session",
  "setup",
  "risk_per_trade",
];

/** Day-level terms dedupe per (user, day, term). */
export const PLAN_DAY_TERMS: readonly PlanTerm[] = [
  "daily_trade_limit",
  "daily_loss_limit",
];

export type PlanVerdictStatus = "adhered" | "breached" | "not_evaluable";

/**
 * One plan term evaluated against one trade. `message` is
 * trader-facing and uses only real figures from the trade,
 * the plan and the day context. `value` / `limit` carry the
 * observed figure and the plan's figure where both are
 * numeric (null otherwise) — the same shape the risk engine
 * uses, so the Task 20 gate can render verdicts uniformly.
 */
export interface PlanVerdict {
  term: PlanTerm;
  status: PlanVerdictStatus;
  message: string;
  value: number | null;
  limit: number | null;
  /** Why a term is not_evaluable (unset plan field, unrecorded trade field, missing capital…). Null otherwise. */
  reason: string | null;
}

/**
 * The trade shape the engine evaluates. Prepared by
 * lib/plan/service.ts from a stored trade row:
 * `riskPct` is the trade's risk as % of trading capital,
 * derived exactly as createTradeCore derives it for the risk
 * engine (calcRiskAmount(entry, sl, size) / capital × 100);
 * null when the trade has no stop-loss or the trader has no
 * capital recorded — the risk term is then not_evaluable,
 * never guessed.
 */
export interface PlanTradeInput {
  id: string;
  pair: string;
  session: TradingSession | null;
  setupId: string | null;
  riskPct: number | null;
  pnl: number | null;
  status: string;
  openedAt: string;
  closedAt: string | null;
}

/**
 * The day aggregates the engine needs, built by the service
 * layer from stored trades (the engine stays pure):
 * - `openedDayTradeIds`: ids of trades opened on the trade's
 *   opened day (UTC), cancelled/reversed excluded, INCLUDING
 *   this trade, in deterministic order (opened_at, created_at,
 *   id) — the trade's position in this list is its ordinal.
 * - `closedDayTrades`: trades closed on the trade's closed
 *   day (UTC) with their P&L, in deterministic close order
 *   (closed_at, created_at, id) — cumulative sums over this
 *   list find the loss-line crossing.
 */
export interface PlanDayContext {
  openedDayTradeIds: string[];
  closedDayTrades: { id: string; pnl: number }[];
}

/** One stored plan_events row (migration 0019). */
export interface PlanEvent {
  id: string;
  user_id: string;
  plan_id: string | null;
  trade_id: string | null;
  term: PlanTerm;
  event_day: string | null;
  message: string;
  details: Record<string, unknown>;
  created_at: string;
}

export const PLAN_TERM_LABELS: Record<PlanTerm, string> = {
  market: "Market",
  session: "Session",
  setup: "Setup",
  risk_per_trade: "Risk per trade",
  daily_trade_limit: "Trades per day",
  daily_loss_limit: "Daily loss",
};

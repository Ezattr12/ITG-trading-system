import type { Row } from "./fake-supabase";

/**
 * Shared DB-row fixture for the Phase 23 intelligence
 * tests (queries + coach answers). See queries.test.ts
 * for the hand-computed expectations.
 */

export const INTEL_USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const INTEL_USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER_A = INTEL_USER_A;
const USER_B = INTEL_USER_B;

const ALPHA = "strat-alpha";
const BETA = "strat-beta";
const BREAKOUT = "setup-breakout";
const PULLBACK = "setup-pullback";

function dbTrade(overrides: Partial<Row> & { id: string; closedDate: string }): Row {
  const { closedDate, ...rest } = overrides;
  return {
    user_id: USER_A,
    pair: "XAUUSD",
    direction: "long",
    entry_price: 100,
    exit_price: 101,
    tp: null,
    sl: 90,
    position_size: 10,
    leverage: 2,
    fees: 0,
    status: "closed",
    strategy_id: ALPHA,
    setup_id: BREAKOUT,
    market_condition: "trending",
    trade_reason: "strategy",
    session: "london",
    notes: null,
    pnl: 10,
    roi_pct: 1,
    r_multiple: 1,
    risk_reward: null,
    is_win: true,
    duration_seconds: 3600,
    reversal_trade_id: null,
    opened_at: `${closedDate}T09:00:00Z`,
    closed_at: `${closedDate}T10:00:00Z`,
    created_at: `${closedDate}T10:00:00Z`,
    updated_at: `${closedDate}T10:00:00Z`,
    ...rest,
  };
}

export function intelligenceTables(): Record<string, Row[]> {
  return {
    trades: [
      dbTrade({ id: "d1", closedDate: "2026-09-08", pnl: 200, r_multiple: 2 }),
      dbTrade({ id: "d2", closedDate: "2026-09-09", pnl: -100, r_multiple: -1, direction: "short", session: "new_york", strategy_id: BETA, setup_id: PULLBACK, market_condition: "ranging", is_win: false }),
      dbTrade({ id: "d3", closedDate: "2026-09-10", pnl: -200, r_multiple: null, direction: "short", strategy_id: BETA, setup_id: PULLBACK, market_condition: "high_volatility", sl: null, leverage: 8, is_win: false }),
      dbTrade({ id: "d4", closedDate: "2026-09-11", pnl: 160, r_multiple: 2, session: "asia", sl: 92 }),
      dbTrade({ id: "d5", closedDate: "2026-09-12", pnl: -120, r_multiple: -1, direction: "short", session: "new_york", strategy_id: BETA, setup_id: PULLBACK, market_condition: "ranging", sl: 88, is_win: false }),
      dbTrade({ id: "d6", closedDate: "2026-09-15", pnl: 50, r_multiple: 0.5 }),
      dbTrade({ id: "d7", closedDate: "2026-09-16", pnl: -80, r_multiple: null, strategy_id: BETA, setup_id: PULLBACK, market_condition: "choppy", sl: null, is_win: false }),
      dbTrade({ id: "b1", closedDate: "2026-09-09", user_id: USER_B, pnl: 9999, r_multiple: 9 }),
    ],
    psychology_records: [
      { trade_id: "d1", user_id: USER_A, confidence: 4, emotion: "calm", discipline: "good" },
      { trade_id: "d2", user_id: USER_A, confidence: 2, emotion: "fear", discipline: "poor" },
      { trade_id: "d4", user_id: USER_A, confidence: 3, emotion: "calm", discipline: "good" },
      { trade_id: "d5", user_id: USER_A, confidence: 2, emotion: "fear", discipline: "average" },
      { trade_id: "d6", user_id: USER_A, confidence: 4, emotion: "calm", discipline: "good" },
      { trade_id: "b1", user_id: USER_B, confidence: 5, emotion: "calm", discipline: "good" },
    ],
    strategies: [
      { id: ALPHA, name: "Alpha Breakout" },
      { id: BETA, name: "Beta Reversion" },
    ],
    setups: [
      { id: BREAKOUT, name: "Breakout" },
      { id: PULLBACK, name: "Pullback" },
    ],
    lessons: [
      { trade_id: "d2", user_id: USER_A, text: "Entered before confirmation", is_repeated_mistake: true, deleted_at: null },
      { trade_id: "d5", user_id: USER_A, text: "Entered before confirmation", is_repeated_mistake: true, deleted_at: null },
      { trade_id: "d3", user_id: USER_A, text: "Revenge traded after a loss", is_repeated_mistake: true, deleted_at: null },
    ],
    profiles: [
      { id: USER_A, trading_capital: 10000 },
      { id: USER_B, trading_capital: 5000 },
    ],
    risk_rules: [
      {
        id: "rules-a",
        user_id: USER_A,
        plan_id: null,
        max_risk_per_trade_pct: 1,
        max_daily_loss: 150,
        max_trades_per_day: null,
        max_consecutive_losses: null,
        max_leverage: 5,
        is_active: true,
        deleted_at: null,
        updated_at: "2026-09-01T00:00:00Z",
      },
    ],
    trading_plans: [],
    risk_events: [
      { id: "e1", user_id: USER_A, severity: "warning", created_at: "2026-09-10T00:00:00Z" },
      { id: "e2", user_id: USER_A, severity: "critical", created_at: "2026-09-12T00:00:00Z" },
    ],
    goals: [],
    goal_progress: [],
    xp_transactions: [],
    levels: [],
    daily_activity: [],
    trade_screenshots: [],
    ai_insights: [
      {
        id: "ai-1",
        user_id: USER_A,
        insight_type: "focus_next_week",
        period_start: "2026-09-07",
        period_end: "2026-09-13",
        summary: "Stored September insight",
        metrics_snapshot: { rule: "test", severity: "high", recommendation: "Stored recommendation" },
        generated_at: "2026-09-14T00:00:00Z",
        created_at: "2026-09-14T00:00:00Z",
      },
    ],
  };
}


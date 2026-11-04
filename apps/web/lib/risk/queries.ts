import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/trades/queries";
import type { TradeRow } from "@/lib/trades/types";
import { buildDayContext, type DayContext } from "./engine";
import type { RiskEvent, RiskRules, TradingPlan } from "./types";

/**
 * Risk reads (Phase 5). Server Components / Actions call these
 * with the signed-in user's Supabase client, so RLS enforces
 * isolation: a trader can only ever read their own rules, plans
 * and events. No service-role client is used for reads.
 */

export async function getRiskRules(
  supabase: SupabaseClient,
  userId: string,
): Promise<RiskRules | null> {
  const { data } = await supabase
    .from("risk_rules")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data ?? null) as RiskRules | null;
}

export async function getTradingPlan(
  supabase: SupabaseClient,
  userId: string,
): Promise<TradingPlan | null> {
  const { data } = await supabase
    .from("trading_plans")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data ?? null) as TradingPlan | null;
}

export async function getRiskEvents(
  supabase: SupabaseClient,
  userId: string,
  limit = 20,
): Promise<RiskEvent[]> {
  const { data } = await supabase
    .from("risk_events")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as RiskEvent[];
}

/**
 * Day context for the risk engine: today's trades (opened today)
 * plus recent closed trades for the consecutive-loss count.
 * Task 21: this is computation (it decides save-time verdicts),
 * so it pages through every trade (fetchAllRows) — a streak or
 * a day figure can no longer silently end at 500 rows.
 */
export async function getRiskDayContext(
  supabase: SupabaseClient,
  userId: string,
  today: string,
): Promise<DayContext> {
  const data = await fetchAllRows((from, to) =>
    supabase
      .from("trades")
      .select("pnl, status, closed_at, opened_at, sl, leverage, session, pair, strategy_id")
      .eq("user_id", userId)
      .order("closed_at", { ascending: false })
      .range(from, to) as unknown as PromiseLike<{ data: unknown[] | null }>,
  );
  const rows = data as {
    pnl: number | null;
    status: string;
    closed_at: string | null;
    opened_at: string;
    sl: number | null;
    leverage: number;
    session: TradeRow["session"];
    pair: string;
    strategy_id: string | null;
  }[];
  return buildDayContext(
    rows.map((r) => ({ ...r, strategyName: null })),
    today,
  );
}

/** Recent closed trades (most recent first) for the disciplined-streak check. */
export async function getRecentClosedTrades(
  supabase: SupabaseClient,
  userId: string,
): Promise<
  {
    pnl: number | null;
    status: string;
    closed_at: string | null;
    opened_at: string;
    sl: number | null;
    leverage: number;
    session: TradeRow["session"];
    pair: string;
    strategyName: string | null;
  }[]
> {
  const data = await fetchAllRows<TradeRow>((from, to) =>
    supabase
      .from("trades")
      .select("pnl, status, closed_at, opened_at, sl, leverage, session, pair, strategy_id")
      .eq("user_id", userId)
      .eq("status", "closed")
      .not("pnl", "is", null)
      .order("closed_at", { ascending: false })
      .range(from, to) as unknown as PromiseLike<{ data: TradeRow[] | null }>,
  );
  return data.map((r) => ({
    ...r,
    strategyName: null,
  }));
}

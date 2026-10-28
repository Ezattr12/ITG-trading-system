import type { SupabaseClient } from "@supabase/supabase-js";
import { TRADE_LIST_FETCH_LIMIT } from "@/lib/trades/queries";
import type { TradeRow } from "@/lib/trades/types";
import { getRiskRules } from "@/lib/risk/queries";
import type {
  DailyActivityRow,
  DisciplineEvent,
  Goal,
  GoalProgressRow,
  MotivationMessage,
  NotificationItem,
} from "./types";
import type { GoalMeasurementContext } from "./engine";

/**
 * Goals & discipline reads (Phase 6). Server Components / Actions
 * call these with the signed-in user's Supabase client, so RLS
 * enforces isolation: a trader can only ever read their own goals,
 * activity, events and notifications. No service-role client is
 * used for reads.
 *
 * Known limit (carried from Phases 3–5): measurement runs over at
 * most the 500 most recent trades. Phase 12 pushes aggregation
 * into the database if a journal grows past it.
 */

export async function getGoals(
  supabase: SupabaseClient,
  userId: string,
): Promise<Goal[]> {
  const { data } = await supabase
    .from("goals")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  return (data ?? []) as Goal[];
}

export async function getGoalById(
  supabase: SupabaseClient,
  userId: string,
  goalId: string,
): Promise<Goal | null> {
  const { data } = await supabase
    .from("goals")
    .select("*")
    .eq("id", goalId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  return (data ?? null) as Goal | null;
}

/** Latest manually recorded progress row per goal. */
export async function getLatestGoalProgress(
  supabase: SupabaseClient,
  userId: string,
): Promise<Map<string, GoalProgressRow>> {
  const { data } = await supabase
    .from("goal_progress")
    .select("goal_id, current_value, recorded_date, note")
    .eq("user_id", userId)
    .order("recorded_date", { ascending: false });
  const map = new Map<string, GoalProgressRow>();
  for (const row of (data ?? []) as GoalProgressRow[]) {
    if (!map.has(row.goal_id)) map.set(row.goal_id, row);
  }
  return map;
}

export async function getDisciplineEvents(
  supabase: SupabaseClient,
  userId: string,
  limit = 20,
): Promise<DisciplineEvent[]> {
  const { data } = await supabase
    .from("discipline_events")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as DisciplineEvent[];
}

/** Most recent discipline event of a kind, for escalation checks. */
export async function getLatestDisciplineEvent(
  supabase: SupabaseClient,
  userId: string,
  kind: DisciplineEvent["kind"],
): Promise<DisciplineEvent | null> {
  const { data } = await supabase
    .from("discipline_events")
    .select("*")
    .eq("user_id", userId)
    .eq("kind", kind)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data ?? null) as DisciplineEvent | null;
}

export async function getMotivationMessages(
  supabase: SupabaseClient,
): Promise<MotivationMessage[]> {
  const { data } = await supabase
    .from("motivation_messages")
    .select("id, message, context, is_active")
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  return (data ?? []) as MotivationMessage[];
}

export async function getNotifications(
  supabase: SupabaseClient,
  userId: string,
  limit = 50,
): Promise<NotificationItem[]> {
  const { data } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as NotificationItem[];
}

export async function getUnreadNotificationCount(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_read", false);
  return count ?? 0;
}

/**
 * Last day the trader journaled a trade (psychology record or
 * lesson on a closed trade), from the 500 most recent trades.
 * Null when nothing has been journaled yet.
 */
export async function getLastJournalDate(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("trades")
    .select("id, closed_at, opened_at")
    .eq("user_id", userId)
    .eq("status", "closed")
    .order("closed_at", { ascending: false })
    .limit(TRADE_LIST_FETCH_LIMIT);
  const trades = (data ?? []) as { id: string; closed_at: string | null; opened_at: string }[];
  if (trades.length === 0) return null;
  const ids = trades.map((t) => t.id);
  const [psychRes, lessonsRes] = await Promise.all([
    supabase.from("psychology_records").select("trade_id").in("trade_id", ids),
    supabase.from("lessons").select("trade_id").in("trade_id", ids),
  ]);
  const journaled = new Set([
    ...(((psychRes.data ?? []) as { trade_id: string }[]).map((p) => p.trade_id)),
    ...(((lessonsRes.data ?? []) as { trade_id: string }[]).map((l) => l.trade_id)),
  ]);
  const journaledTrades = trades.filter((t) => journaled.has(t.id));
  if (journaledTrades.length === 0) return null;
  const dates = journaledTrades.map((t) => (t.closed_at ?? t.opened_at).slice(0, 10));
  return dates.sort().reverse()[0];
}

/**
 * Everything `measureGoal` needs: the trader's trades (with
 * journaled / stop-loss flags), daily activity for the past year,
 * and whether risk rules exist (for risk-discipline goals).
 */
export async function getGoalMeasurementContext(
  supabase: SupabaseClient,
  userId: string,
): Promise<GoalMeasurementContext> {
  const { data: tradeRows } = await supabase
    .from("trades")
    .select("id, opened_at, closed_at, status, pnl, sl, leverage")
    .eq("user_id", userId)
    .order("closed_at", { ascending: false })
    .limit(TRADE_LIST_FETCH_LIMIT);
  const trades = (tradeRows ?? []) as (TradeRow & { sl: number | null; leverage: number | null })[];
  const ids = trades.map((t) => t.id);
  let journaledIds = new Set<string>();
  if (ids.length > 0) {
    const [psychRes, lessonsRes] = await Promise.all([
      supabase.from("psychology_records").select("trade_id").in("trade_id", ids),
      supabase.from("lessons").select("trade_id").in("trade_id", ids),
    ]);
    journaledIds = new Set([
      ...(((psychRes.data ?? []) as { trade_id: string }[]).map((p) => p.trade_id)),
      ...(((lessonsRes.data ?? []) as { trade_id: string }[]).map((l) => l.trade_id)),
    ]);
  }

  const oneYearAgo = new Date();
  oneYearAgo.setUTCFullYear(oneYearAgo.getUTCFullYear() - 1);
  const { data: activityRows } = await supabase
    .from("daily_activity")
    .select("activity_date, journal_completed, study_hours, backtesting_sessions, trading_sessions_count")
    .eq("user_id", userId)
    .gte("activity_date", oneYearAgo.toISOString().slice(0, 10))
    .order("activity_date", { ascending: false });
  const activity = (activityRows ?? []) as DailyActivityRow[];

  const rules = await getRiskRules(supabase, userId);
  return {
    trades: trades.map((t) => ({
      openedAt: t.opened_at,
      closedAt: t.closed_at,
      status: t.status,
      pnl: t.pnl,
      journaled: journaledIds.has(t.id),
      stopLossSet: t.sl !== null,
      leverage: t.leverage,
    })),
    activity,
    hasRiskRules: rules !== null,
    maxLeverage: rules?.max_leverage ?? null,
  };
}

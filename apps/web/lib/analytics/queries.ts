import type { SupabaseClient } from "@supabase/supabase-js";
import { calcGoalProgress } from "@itg/calc";
import type { TradeRow } from "@/lib/trades/types";
import { TRADE_LIST_FETCH_LIMIT } from "@/lib/trades/queries";
import type { AnalyticTrade, GoalProgressView, XpHistoryPoint } from "./types";
import { aggregateXpHistory } from "../gamification/xp";
import {
  dimensionInputsFromBundle,
  scoreTrader,
} from "../gamification/scoring";
import type { LevelRow } from "../gamification/types";

/**
 * Analytics reads (Phase 4). Server Components call these with the
 * signed-in user's Supabase client, so RLS enforces isolation:
 * a trader can only ever read their own trades, goals, XP and
 * activity. No service-role client is used for reads.
 *
 * Known limit (carried from Phase 3): analytics run over at most
 * the 500 most recent closed trades. Phase 12 pushes aggregation
 * into the database if a journal grows past that.
 */

export interface AnalyticsBundle {
  trades: AnalyticTrade[];
  goals: GoalProgressView[];
  xpTotal: number;
  xpHistory: XpHistoryPoint[];
  levelName: string | null;
  levelScore: number | null;
  /** Configured levels (Bronze/Silver/Gold/Platinum) with scoring weights. */
  levels: LevelRow[];
  dailyActivity: { activity_date: string; journal_completed: boolean; study_hours: number }[];
}

function toAnalyticTrade(
  trade: TradeRow,
  psychByTrade: Map<string, { confidence: number | null; emotion: AnalyticTrade["emotion"]; discipline: AnalyticTrade["discipline"] }>,
  strategyName: Map<string, string>,
  lessonTradeIds: Set<string>,
  screenshotTradeIds: Set<string>,
): AnalyticTrade {
  const psych = psychByTrade.get(trade.id);
  return {
    id: trade.id,
    pair: trade.pair,
    direction: trade.direction,
    session: trade.session,
    strategyName: trade.strategy_id ? strategyName.get(trade.strategy_id) ?? null : null,
    pnl: trade.pnl ?? 0,
    rMultiple: trade.r_multiple,
    closedAt: trade.closed_at ?? trade.opened_at,
    openedAt: trade.opened_at,
    emotion: psych?.emotion ?? null,
    discipline: psych?.discipline ?? null,
    confidence: psych?.confidence ?? null,
    journaled: Boolean(psych) || lessonTradeIds.has(trade.id),
    stopLossSet: trade.sl !== null,
  };
}

export async function getAnalyticsBundle(
  supabase: SupabaseClient,
  userId: string,
): Promise<AnalyticsBundle> {
  const { data: tradeRows } = await supabase
    .from("trades")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "closed")
    .not("pnl", "is", null)
    .order("closed_at", { ascending: false })
    .limit(TRADE_LIST_FETCH_LIMIT);
  const trades = (tradeRows ?? []) as TradeRow[];

  let analytics: AnalyticTrade[] = [];
  if (trades.length > 0) {
    const tradeIds = trades.map((t) => t.id);
    const [psychRes, strategiesRes, lessonsRes, shotsRes] = await Promise.all([
      supabase.from("psychology_records").select("trade_id, confidence, emotion, discipline").in("trade_id", tradeIds),
      supabase
        .from("strategies")
        .select("id, name")
        .in("id", trades.map((t) => t.strategy_id).filter(Boolean) as string[]),
      supabase.from("lessons").select("trade_id").in("trade_id", tradeIds),
      supabase.from("trade_screenshots").select("trade_id").in("trade_id", tradeIds),
    ]);
    const psychByTrade = new Map(
      ((psychRes.data ?? []) as { trade_id: string; confidence: number | null; emotion: AnalyticTrade["emotion"]; discipline: AnalyticTrade["discipline"] }[]).map(
        (p) => [p.trade_id, p],
      ),
    );
    const strategyName = new Map(
      ((strategiesRes.data ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]),
    );
    const lessonTradeIds = new Set(
      ((lessonsRes.data ?? []) as { trade_id: string }[]).map((l) => l.trade_id),
    );
    const screenshotTradeIds = new Set(
      ((shotsRes.data ?? []) as { trade_id: string }[]).map((s) => s.trade_id),
    );
    analytics = trades.map((t) =>
      toAnalyticTrade(t, psychByTrade, strategyName, lessonTradeIds, screenshotTradeIds),
    );
  }

  const [goalsRes, xpRes, levelRowsRes, activityRes] = await Promise.all([
    supabase
      .from("goals")
      .select("id, title, period, target_value, status")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("xp_transactions")
      .select("amount, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
    // Configured levels (Phase 7): the trader's level is computed
    // from their real trades/goals below — never read from the
    // stored `user_levels` row, which only records the last
    // calculation and is stale until the next refresh.
    supabase
      .from("levels")
      .select("id, name, slug, min_score, max_score, scoring_config, description")
      .order("min_score", { ascending: true }),
    supabase
      .from("daily_activity")
      .select("activity_date, journal_completed, study_hours")
      .eq("user_id", userId)
      .order("activity_date", { ascending: false })
      .limit(90),
  ]);

  const goalRows = (goalsRes.data ?? []) as {
    id: string;
    title: string;
    period: string;
    target_value: number;
    status: string;
  }[];
  let goals: GoalProgressView[] = [];
  if (goalRows.length > 0) {
    const { data: progressRows } = await supabase
      .from("goal_progress")
      .select("goal_id, current_value, recorded_date")
      .in("goal_id", goalRows.map((g) => g.id))
      .order("recorded_date", { ascending: false });
    const latestByGoal = new Map<string, number>();
    for (const row of (progressRows ?? []) as {
      goal_id: string;
      current_value: number;
    }[]) {
      if (!latestByGoal.has(row.goal_id)) latestByGoal.set(row.goal_id, row.current_value);
    }
    goals = goalRows.map((g) => {
      const current = latestByGoal.get(g.id) ?? 0;
      const progress = calcGoalProgress({ current, target: g.target_value });
      return {
        id: g.id,
        title: g.title,
        period: g.period,
        targetValue: g.target_value,
        currentValue: current,
        percent: progress?.percent ?? 0,
        status: g.status,
      };
    });
  }

  const xpRows = (xpRes.data ?? []) as { amount: number; created_at: string }[];
  const xpHistory = aggregateXpHistory(xpRows);
  const xpTotal = xpHistory.length === 0 ? 0 : xpHistory[xpHistory.length - 1].cumulativeXp;

  // Level (Phase 7): multi-dimensional score from the trader's
  // real trades and goals — discipline, risk, journaling, goals,
  // psychology, strategy, consistency, performance — not profit
  // alone. Null with no measurable data.
  const levels = (levelRowsRes.data ?? []) as LevelRow[];
  const today = new Date().toISOString().slice(0, 10);
  const score = scoreTrader(
    dimensionInputsFromBundle(analytics, goals, today),
    levels,
  );

  return {
    trades: analytics,
    goals,
    xpTotal,
    xpHistory,
    levelName: score.levelName,
    levelScore: score.score,
    levels,
    dailyActivity: (activityRes.data ?? []) as AnalyticsBundle["dailyActivity"],
  };
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { TRADE_LIST_FETCH_LIMIT } from "@/lib/trades/queries";
import type { TradeRow } from "@/lib/trades/types";
import type { AnalyticTrade } from "@/lib/analytics/types";
import { buildReportSummary } from "./reports";
import type { ReportLesson, ReportSummary, ReportTrade, ReportType } from "./types";

/**
 * Report reads (Phase 8). Server Components / Route Handlers call
 * these with the signed-in user's Supabase client, so RLS
 * enforces isolation. No service-role client is used for reads.
 *
 * Known limit (carried from Phases 3–5): a report runs over at
 * most the 500 most recent closed trades in the period.
 */
export async function getReportSummary(
  supabase: SupabaseClient,
  userId: string,
  input: { type: ReportType; periodStart: string; periodEnd: string },
): Promise<ReportSummary> {
  const { data: tradeRows } = await supabase
    .from("trades")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "closed")
    .not("pnl", "is", null)
    .gte("closed_at", `${input.periodStart}T00:00:00Z`)
    .lte("closed_at", `${input.periodEnd}T23:59:59Z`)
    .order("closed_at", { ascending: false })
    .limit(TRADE_LIST_FETCH_LIMIT);
  const trades = (tradeRows ?? []) as TradeRow[];
  const tradeIds = trades.map((t) => t.id);

  let psychByTrade = new Map<
    string,
    { confidence: number | null; emotion: AnalyticTrade["emotion"]; discipline: AnalyticTrade["discipline"] }
  >();
  let strategyName = new Map<string, string>();
  let lessonTradeIds = new Set<string>();
  let lessons: ReportLesson[] = [];
  if (tradeIds.length > 0) {
    const [psychRes, strategiesRes, lessonsRes] = await Promise.all([
      supabase
        .from("psychology_records")
        .select("trade_id, confidence, emotion, discipline")
        .in("trade_id", tradeIds),
      supabase
        .from("strategies")
        .select("id, name")
        .in("id", trades.map((t) => t.strategy_id).filter(Boolean) as string[]),
      supabase
        .from("lessons")
        .select("trade_id, text, repeated_mistake")
        .in("trade_id", tradeIds),
    ]);
    psychByTrade = new Map(
      ((psychRes.data ?? []) as { trade_id: string; confidence: number | null; emotion: AnalyticTrade["emotion"]; discipline: AnalyticTrade["discipline"] }[]).map(
        (p) => [p.trade_id, p],
      ),
    );
    strategyName = new Map(
      ((strategiesRes.data ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]),
    );
    lessons = ((lessonsRes.data ?? []) as {
      trade_id: string;
      text: string;
      repeated_mistake: boolean;
    }[]).map((l) => ({
      tradeId: l.trade_id,
      text: l.text ?? "",
      repeatedMistake: Boolean(l.repeated_mistake),
    }));
    lessonTradeIds = new Set(lessons.map((l) => l.tradeId));
  }

  const { data: goalRows } = await supabase
    .from("goals")
    .select("status")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .gte("created_at", `${input.periodStart}T00:00:00Z`)
    .lte("created_at", `${input.periodEnd}T23:59:59Z`);
  const goals = (goalRows ?? []) as { status: string }[];

  const reportTrades: ReportTrade[] = trades.map((t) => {
    const psych = psychByTrade.get(t.id);
    return {
      id: t.id,
      pair: t.pair,
      direction: t.direction,
      session: t.session,
      strategyName: t.strategy_id ? strategyName.get(t.strategy_id) ?? null : null,
      pnl: t.pnl ?? 0,
      rMultiple: t.r_multiple,
      closedAt: t.closed_at ?? t.opened_at,
      emotion: psych?.emotion ?? null,
      discipline: psych?.discipline ?? null,
      journaled: Boolean(psych) || lessonTradeIds.has(t.id),
      stopLossSet: t.sl !== null,
    };
  });

  return buildReportSummary({
    type: input.type,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    trades: reportTrades,
    lessons,
    goalsCompleted: goals.filter((g) => g.status === "completed").length,
    goalsTotal: goals.length,
  });
}

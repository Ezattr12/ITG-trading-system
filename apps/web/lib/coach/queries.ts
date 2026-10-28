import type { SupabaseClient } from "@supabase/supabase-js";
import { calcCurrentStreak } from "@itg/calc";
import { TRADE_LIST_FETCH_LIMIT } from "@/lib/trades/queries";
import { getReportSummary } from "@/lib/reports/queries";
import type { ReportSummary } from "@/lib/reports/types";
import { weekBounds } from "@/lib/reviews/reviews";
import type { AiInsightRow, CoachInsightType } from "./types";

/**
 * AI Coach reads (Phase 9). Server Components / Actions call
 * these with the signed-in user's Supabase client, so RLS
 * enforces isolation. No service-role client is used for reads.
 *
 * Known limit (carried from Phases 3–5): a week's analysis runs
 * over at most the 500 most recent closed trades in the week.
 */

export interface CoachWeekData {
  summary: ReportSummary;
  riskEvents: { critical: number; warning: number; positive: number };
  currentStreak: number;
}

/**
 * Evidence for one week: the weekly report summary (real trades,
 * psychology, lessons, goals), the week's risk events by
 * severity, and the current win/loss streak from the most recent
 * closed trades.
 */
export async function getCoachWeekData(
  supabase: SupabaseClient,
  userId: string,
  weekStart: string,
): Promise<CoachWeekData | null> {
  const bounds = weekBounds(weekStart);
  if (!bounds) return null;
  const [summary, eventsRes, streakRes] = await Promise.all([
    getReportSummary(supabase, userId, {
      type: "weekly",
      periodStart: bounds.start,
      periodEnd: bounds.end,
    }),
    supabase
      .from("risk_events")
      .select("severity")
      .eq("user_id", userId)
      .gte("created_at", `${bounds.start}T00:00:00Z`)
      .lte("created_at", `${bounds.end}T23:59:59Z`),
    supabase
      .from("trades")
      .select("pnl")
      .eq("user_id", userId)
      .eq("status", "closed")
      .not("pnl", "is", null)
      .order("closed_at", { ascending: false })
      .limit(TRADE_LIST_FETCH_LIMIT),
  ]);
  const severities = ((eventsRes.data ?? []) as { severity: string }[]).map((e) => e.severity);
  const pnls = ((streakRes.data ?? []) as { pnl: number | null }[])
    .map((t) => t.pnl)
    .filter((p): p is number => p !== null);
  return {
    summary,
    riskEvents: {
      critical: severities.filter((s) => s === "critical").length,
      warning: severities.filter((s) => s === "warning").length,
      positive: severities.filter((s) => s === "positive").length,
    },
    currentStreak: calcCurrentStreak(pnls),
  };
}

/** Latest stored insights for the user, newest first. */
export async function getAiInsights(
  supabase: SupabaseClient,
  userId: string,
  limit = 50,
): Promise<AiInsightRow[]> {
  const { data } = await supabase
    .from("ai_insights")
    .select("*")
    .eq("user_id", userId)
    .order("generated_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as AiInsightRow[];
}

/** Latest insights for one week (one period), newest first. */
export async function getAiInsightsForWeek(
  supabase: SupabaseClient,
  userId: string,
  periodStart: string,
  periodEnd: string,
): Promise<AiInsightRow[]> {
  const { data } = await supabase
    .from("ai_insights")
    .select("*")
    .eq("user_id", userId)
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd)
    .order("generated_at", { ascending: false });
  return (data ?? []) as AiInsightRow[];
}

/** The most recent insights of each type, for the dashboard card. */
export async function getLatestCoachInsights(
  supabase: SupabaseClient,
  userId: string,
  limit = 3,
): Promise<AiInsightRow[]> {
  const rows = await getAiInsights(supabase, userId, 50);
  const seen = new Set<CoachInsightType>();
  const latest: AiInsightRow[] = [];
  for (const row of rows) {
    if (seen.has(row.insight_type)) continue;
    seen.add(row.insight_type);
    latest.push(row);
    if (latest.length >= limit) break;
  }
  return latest;
}

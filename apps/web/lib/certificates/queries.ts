import type { SupabaseClient } from "@supabase/supabase-js";
import { getRiskRules } from "@/lib/risk/queries";
import { TRADE_LIST_FETCH_LIMIT } from "@/lib/trades/queries";
import type { CertificateRow } from "./types";
import {
  evaluateMonthlyEligibility,
  monthStart,
  type MonthlyCertificateInputs,
} from "./eligibility";
import type { CertificateEligibility } from "./types";

/**
 * Certificate reads (Phase 8). Server Components / Actions call
 * these with the signed-in user's Supabase client, so RLS
 * enforces isolation: a trader can only ever read their own
 * certificates. No service-role client is used for reads.
 *
 * Known limit (carried from Phases 3–5): the month's inputs run
 * over at most the 500 most recent closed trades.
 */

export async function getCertificates(
  supabase: SupabaseClient,
  userId: string,
): Promise<CertificateRow[]> {
  const { data } = await supabase
    .from("certificates")
    .select("*")
    .eq("user_id", userId)
    .order("month", { ascending: false });
  return (data ?? []) as CertificateRow[];
}

export async function getCertificateById(
  supabase: SupabaseClient,
  userId: string,
  certificateId: string,
): Promise<CertificateRow | null> {
  const { data } = await supabase
    .from("certificates")
    .select("*")
    .eq("user_id", userId)
    .eq("certificate_id", certificateId)
    .maybeSingle();
  return (data ?? null) as CertificateRow | null;
}

function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * Assemble the month's real aggregates for the eligibility
 * check: closed trades in the month, journaled/disciplined
 * counts, critical risk events, active days/weeks, and completed
 * weekly reviews overlapping the month.
 */
export async function getMonthlyCertificateInputs(
  supabase: SupabaseClient,
  userId: string,
  month: string,
): Promise<MonthlyCertificateInputs> {
  const start = monthStart(month);
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(
    Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 1),
  );
  const end = endDate.toISOString().slice(0, 10);

  const { data: tradeRows } = await supabase
    .from("trades")
    .select("id, pnl, status, opened_at, closed_at, sl, leverage")
    .eq("user_id", userId)
    .eq("status", "closed")
    .not("pnl", "is", null)
    .gte("closed_at", `${start}T00:00:00Z`)
    .lt("closed_at", `${end}T00:00:00Z`)
    .order("closed_at", { ascending: false })
    .limit(TRADE_LIST_FETCH_LIMIT);
  const trades = (tradeRows ?? []) as {
    id: string;
    pnl: number | null;
    status: string;
    opened_at: string;
    closed_at: string | null;
    sl: number | null;
    leverage: number;
  }[];

  const tradeIds = trades.map((t) => t.id);
  const rules = await getRiskRules(supabase, userId);

  let journaledIds = new Set<string>();
  if (tradeIds.length > 0) {
    const [psychRes, lessonsRes] = await Promise.all([
      supabase
        .from("psychology_records")
        .select("trade_id")
        .in("trade_id", tradeIds),
      supabase.from("lessons").select("trade_id").in("trade_id", tradeIds),
    ]);
    for (const row of (psychRes.data ?? []) as { trade_id: string }[])
      journaledIds.add(row.trade_id);
    for (const row of (lessonsRes.data ?? []) as { trade_id: string }[])
      journaledIds.add(row.trade_id);
  }

  const { data: riskEvents } = await supabase
    .from("risk_events")
    .select("severity")
    .eq("user_id", userId)
    .eq("severity", "critical")
    .gte("created_at", `${start}T00:00:00Z`)
    .lt("created_at", `${end}T00:00:00Z`);
  const criticalBreaches = (riskEvents ?? []).length;

  const { data: reviews } = await supabase
    .from("weekly_reviews")
    .select("week_start_date, week_end_date")
    .eq("user_id", userId)
    .eq("status", "completed")
    .lte("week_start_date", end)
    .gte("week_end_date", start);
  const completedWeeklyReviews = (reviews ?? []).length;

  const activeDays = new Set<string>();
  const activeWeeks = new Set<string>();
  for (const t of trades) {
    for (const stamp of [t.closed_at, t.opened_at]) {
      if (!stamp) continue;
      const d = new Date(stamp);
      if (d >= startDate && d < endDate) {
        activeDays.add(d.toISOString().slice(0, 10));
        activeWeeks.add(isoWeek(d));
      }
    }
  }

  const disciplined = trades.filter((t) => {
    if (t.sl === null) return false;
    if (rules?.max_leverage !== null && rules?.max_leverage !== undefined) {
      return t.leverage <= (rules.max_leverage as number);
    }
    return true;
  }).length;

  return {
    month: start,
    tradesCount: trades.length,
    journaledTrades: trades.filter((t) => journaledIds.has(t.id)).length,
    disciplinedTrades: disciplined,
    criticalBreaches,
    activeDays: activeDays.size,
    activeWeeks: activeWeeks.size,
    completedWeeklyReviews,
  };
}

/** Eligibility for a month, from the trader's real stored data. */
export async function getMonthlyEligibility(
  supabase: SupabaseClient,
  userId: string,
  month: string,
): Promise<CertificateEligibility> {
  const inputs = await getMonthlyCertificateInputs(supabase, userId, month);
  return evaluateMonthlyEligibility(inputs);
}

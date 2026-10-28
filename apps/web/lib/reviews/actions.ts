"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/auth/actions";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured, supabaseNotConnectedMessage } from "@/lib/supabase/config";
import { getCurrentUser } from "@/lib/auth/session";
import { TRADE_LIST_FETCH_LIMIT } from "@/lib/trades/queries";
import type { TradeRow } from "@/lib/trades/types";
import { awardXp, refreshGamification } from "@/lib/gamification/actions";
import { createNotification } from "@/lib/discipline/actions";
import { computeWeeklyAggregates, weekBounds, WEEKLY_REVIEW_XP, type WeeklyReviewTrade } from "./reviews";
import { firstZodError, weeklyReviewSchema } from "./validation";

/**
 * Weekly review Server Actions (Phase 8, spec §21, §27).
 *
 * `weekly_reviews` has owner INSERT/UPDATE policies (migration
 * 0007), so the review is written with the signed-in client and
 * RLS enforces ownership. The aggregates are computed here from
 * the week's real closed trades — never typed in by the trader.
 *
 * Completing a review awards +30 XP through the existing
 * `awardXp` path, idempotent per review id: re-saving the same
 * week never awards the XP twice. A failed XP insert never
 * loses the review.
 */
export async function saveWeeklyReviewAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: supabaseNotConnectedMessage() };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please log in first." };

  const parsed = weeklyReviewSchema.safeParse({
    weekStartDate: formData.get("weekStartDate"),
    reviewText: formData.get("reviewText"),
    mainMistake: formData.get("mainMistake") || null,
    focusNextWeek: formData.get("focusNextWeek") || null,
  });
  if (!parsed.success) {
    return { ok: false, error: firstZodError(parsed.error) };
  }
  const bounds = weekBounds(parsed.data.weekStartDate);
  if (!bounds) {
    return { ok: false, error: "Choose a valid week (YYYY-MM-DD, Monday)." };
  }

  const supabase = await createServerSupabaseClient();

  // Week's real closed trades, for the stored aggregates.
  const { data: tradeRows } = await supabase
    .from("trades")
    .select("*")
    .eq("user_id", user.id)
    .eq("status", "closed")
    .not("pnl", "is", null)
    .gte("closed_at", `${bounds.start}T00:00:00Z`)
    .lte("closed_at", `${bounds.end}T23:59:59Z`)
    .order("closed_at", { ascending: false })
    .limit(TRADE_LIST_FETCH_LIMIT);
  const trades = (tradeRows ?? []) as TradeRow[];
  const tradeIds = trades.map((t) => t.id);
  let strategyName = new Map<string, string>();
  const journaledIds = new Set<string>();
  if (tradeIds.length > 0) {
    const [psychRes, lessonsRes, strategiesRes] = await Promise.all([
      supabase.from("psychology_records").select("trade_id").in("trade_id", tradeIds),
      supabase.from("lessons").select("trade_id").in("trade_id", tradeIds),
      supabase
        .from("strategies")
        .select("id, name")
        .in("id", trades.map((t) => t.strategy_id).filter(Boolean) as string[]),
    ]);
    for (const row of (psychRes.data ?? []) as { trade_id: string }[])
      journaledIds.add(row.trade_id);
    for (const row of (lessonsRes.data ?? []) as { trade_id: string }[])
      journaledIds.add(row.trade_id);
    strategyName = new Map(
      ((strategiesRes.data ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]),
    );
  }
  const reviewTrades: WeeklyReviewTrade[] = trades.map((t) => ({
    pnl: t.pnl ?? 0,
    strategyName: t.strategy_id ? strategyName.get(t.strategy_id) ?? null : null,
    journaled: journaledIds.has(t.id),
  }));
  const agg = computeWeeklyAggregates(reviewTrades);

  const row = {
    user_id: user.id,
    week_start_date: bounds.start,
    week_end_date: bounds.end,
    trades_count: agg.tradesCount,
    total_pnl: agg.totalPnl,
    win_rate_pct: agg.winRatePct,
    journal_completion_pct: agg.journalCompletionPct,
    best_strategy: agg.bestStrategy,
    worst_strategy: agg.worstStrategy,
    main_mistake: parsed.data.mainMistake,
    focus_next_week: parsed.data.focusNextWeek,
    review_text: parsed.data.reviewText,
    status: "completed",
  };

  const { data: saved, error } = await supabase
    .from("weekly_reviews")
    .upsert(row, { onConflict: "user_id,week_start_date" })
    .select("id")
    .single();
  if (error || !saved) {
    return { ok: false, error: "Could not save the weekly review. Please try again." };
  }

  const reviewId = (saved as { id: string }).id;
  const awarded = await awardXp({
    userId: user.id,
    reason: "weekly_review",
    sourceRefId: reviewId,
    note: `Weekly review completed for the week of ${bounds.start}`,
  });
  await refreshGamification(supabase, user.id);
  await createNotification({
    userId: user.id,
    type: "weekly_report",
    title: "Weekly review completed",
    body: awarded
      ? `You earned ${WEEKLY_REVIEW_XP} XP for reviewing the week of ${bounds.start}.`
      : `Weekly review for the week of ${bounds.start} saved.`,
    relatedEntityType: "weekly_review",
    relatedEntityId: reviewId,
  });

  revalidatePath("/reviews/weekly");
  revalidatePath("/certificates");
  return {
    ok: true,
    message: awarded
      ? `Weekly review saved. You earned ${WEEKLY_REVIEW_XP} XP.`
      : "Weekly review saved.",
  };
}

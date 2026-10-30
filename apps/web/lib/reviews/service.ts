import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAuditLog } from "@/lib/auth/audit";
import { awardXp, refreshGamification } from "@/lib/gamification/actions";
import { createNotification } from "@/lib/discipline/service";
import { TRADE_LIST_FETCH_LIMIT } from "@/lib/trades/queries";
import type { TradeRow } from "@/lib/trades/types";
import type { CoreFailure } from "@/lib/trades/service";
import {
  computeWeeklyAggregates,
  weekBounds,
  WEEKLY_REVIEW_XP,
  type WeeklyReviewTrade,
} from "./reviews";
import { firstZodError, weeklyReviewSchema } from "./validation";

/**
 * Weekly review service core (Phase 21, M2) — the single
 * source of truth for the weekly-review write, extracted
 * verbatim from saveWeeklyReviewAction (lib/reviews/
 * actions.ts). The web action is now an adapter (session
 * auth + FormData); the mobile API handler calls the same
 * core with the token-derived user id.
 *
 * `weekly_reviews` has owner INSERT/UPDATE policies
 * (migration 0007), so the review is written with the
 * caller's RLS client and RLS enforces ownership. The
 * aggregates are computed here from the week's real closed
 * trades — never typed in by the trader.
 *
 * Completing a review awards +30 XP through the existing
 * `awardXp` path, idempotent per review id: re-saving the
 * same week never awards the XP twice. A failed XP insert
 * never loses the review.
 *
 * CoreFailure codes are shared with lib/trades/service.ts.
 */

function fail(code: CoreFailure["code"], error: string): CoreFailure {
  return { ok: false, code, error };
}

export type SaveWeeklyReviewCoreResult =
  | {
      ok: true;
      reviewId: string;
      /** True when this save newly awarded the +30 XP. */
      awarded: boolean;
      xpAwarded: number;
      weekStart: string;
    }
  | CoreFailure;

export async function saveWeeklyReviewCore(
  supabase: SupabaseClient,
  userId: string,
  rawInput: unknown,
): Promise<SaveWeeklyReviewCoreResult> {
  const parsed = weeklyReviewSchema.safeParse(rawInput);
  if (!parsed.success) return fail("invalid_input", firstZodError(parsed.error));
  const bounds = weekBounds(parsed.data.weekStartDate);
  if (!bounds) {
    return fail("invalid_input", "Choose a valid week (YYYY-MM-DD, Monday).");
  }

  // Week's real closed trades, for the stored aggregates.
  const { data: tradeRows } = await supabase
    .from("trades")
    .select("*")
    .eq("user_id", userId)
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
    user_id: userId,
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
    return fail("save_failed", "Could not save the weekly review. Please try again.");
  }

  const reviewId = (saved as { id: string }).id;
  const awarded = await awardXp({
    userId,
    reason: "weekly_review",
    sourceRefId: reviewId,
    note: `Weekly review completed for the week of ${bounds.start}`,
  });
  await refreshGamification(supabase, userId);
  await createNotification({
    userId,
    type: "weekly_report",
    title: "Weekly review completed",
    body: awarded
      ? `You earned ${WEEKLY_REVIEW_XP} XP for reviewing the week of ${bounds.start}.`
      : `Weekly review for the week of ${bounds.start} saved.`,
    relatedEntityType: "weekly_review",
    relatedEntityId: reviewId,
  });

  // Phase 27: the save awards XP — it belongs in the audit log
  // (the mobile API layer's api.mobile.* row is a transport
  // record, not a substitute for the domain row the web path
  // previously lacked entirely).
  await writeAuditLog({
    userId,
    action: "review.weekly_saved",
    entityType: "weekly_reviews",
    entityId: reviewId,
    details: { weekStart: bounds.start, xpAwarded: awarded ? WEEKLY_REVIEW_XP : 0 },
  });

  return {
    ok: true,
    reviewId,
    awarded,
    xpAwarded: awarded ? WEEKLY_REVIEW_XP : 0,
    weekStart: bounds.start,
  };
}

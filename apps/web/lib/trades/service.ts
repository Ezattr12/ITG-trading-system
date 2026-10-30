import type { SupabaseClient } from "@supabase/supabase-js";
import { calcRiskAmount } from "@itg/calc";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/auth/audit";
import {
  checkPresetRateLimit,
  rateLimitMessage,
  TRADE_RATE_LIMIT,
} from "@/lib/auth/rate-limit";
import {
  countDisciplinedStreak,
  evaluateTradeRisk,
  hasCriticalBreach,
  utcDate,
} from "@/lib/risk/engine";
import { logRiskEvent } from "@/lib/risk/actions";
import {
  getRecentClosedTrades,
  getRiskDayContext,
  getRiskRules,
} from "@/lib/risk/queries";
import { awardXp, refreshGamification } from "@/lib/gamification/actions";
import { refreshCoachInsightsSafely } from "@/lib/coach/service";
import { createNotification } from "@/lib/discipline/service";
import { computeTradeMetrics } from "./calculations";
import { normalizeLesson } from "./lessons";
import {
  advancedReviewSchema,
  firstZodError,
  quickTradeSchema,
  type QuickTradeInput,
} from "./validation";

/**
 * Trade service cores (Phase 21, M1) — the single source of
 * truth for the trade write operations, extracted verbatim
 * from the Server Actions in lib/trades/actions.ts.
 *
 * Both adapters call these cores:
 * - the web Server Actions (session auth + FormData), and
 * - the mobile API handlers (Bearer token + JSON),
 * so validation, metrics, risk checks, XP, achievements,
 * notifications, audit rows and the Phase 20 coach trigger
 * exist exactly once. Behaviour is unchanged: same Zod
 * schemas, same message strings, same side-effect order.
 *
 * A core takes the caller's RLS-scoped Supabase client and
 * the authenticated user id (derived by the adapter from
 * the session or the validated token — never from input),
 * validates the typed input with the existing schema, and
 * returns a discriminated result. `error` always carries
 * the exact message the web form shows for that failure;
 * `code` lets the API adapter map it to an HTTP status:
 *
 * - `invalid_input` — Zod validation failed (form message).
 * - `rate_limited`  — the existing in-action rate limit.
 * - `not_found`     — no such row for this trader (the row
 *                     is scoped out by user_id, so another
 *                     trader's row is indistinguishable).
 * - `business`      — a business rule refused the write
 *                     (critical risk breach, already
 *                     corrected/reversed trade).
 * - `save_failed`   — the database write itself failed.
 */

export type CoreErrorCode =
  | "invalid_input"
  | "rate_limited"
  | "not_found"
  | "business"
  | "save_failed";

export interface CoreFailure {
  ok: false;
  code: CoreErrorCode;
  error: string;
}

function fail(code: CoreErrorCode, error: string): CoreFailure {
  return { ok: false, code, error };
}

/**
 * Phase 20 — automatic coach refresh on closed-trade change.
 *
 * After a closed trade is created, corrected or re-reviewed,
 * the week's deterministic coach insights are refreshed
 * through the shared coach service (the same idempotent
 * persist as the manual refresh). Failure isolation is
 * total: `refreshCoachInsightsSafely` never throws, and this
 * helper never changes the calling core's result, XP or
 * error behaviour. The refresh itself awards no XP and
 * creates no notifications.
 */
async function refreshCoachAfterClosedTradeChange(
  supabase: SupabaseClient,
  userId: string,
  closedAtIso: string | null,
  openedAtIso: string,
): Promise<void> {
  const admin = createServiceRoleSupabaseClient();
  if (!admin) return;
  const dateIso = closedAtIso ?? openedAtIso;
  await refreshCoachInsightsSafely({
    supabase,
    admin,
    userId,
    weekStartDate: dateIso.slice(0, 10),
  });
}

/* ------------------------------------------------------------ quick entry */

export interface CreatedTrade {
  id: string;
  pair: string;
  direction: string;
  status: string;
  pnl: number | null;
  roi_pct: number | null;
  r_multiple: number | null;
  opened_at: string;
  closed_at: string | null;
}

export type CreateTradeCoreResult =
  | { ok: true; trade: CreatedTrade }
  | CoreFailure;

export async function createTradeCore(
  supabase: SupabaseClient,
  userId: string,
  rawInput: unknown,
): Promise<CreateTradeCoreResult> {
  const parsed = quickTradeSchema.safeParse(rawInput);
  if (!parsed.success) return fail("invalid_input", firstZodError(parsed.error));
  const input: QuickTradeInput = parsed.data;

  // Rate limit (Phase 11): at most 30 trades per 10 minutes per trader.
  const tradeRate = checkPresetRateLimit(`trade:${userId}`, TRADE_RATE_LIMIT);
  if (!tradeRate.allowed) {
    return fail("rate_limited", rateLimitMessage("trade creation", tradeRate));
  }

  const metrics = computeTradeMetrics(input);

  // Risk check (Phase 5, spec §19): evaluate the trade against
  // the trader's active risk rules BEFORE saving. A breached
  // CRITICAL rule (daily loss limit, leverage above maximum)
  // blocks the save with a clear message. WARNING breaches are
  // logged to risk_events and the trade is still journaled — a
  // journal that refuses to record a breach would hide the very
  // behaviour it exists to show. Nothing here closes or executes
  // a real trade (spec §41).
  const rules = await getRiskRules(supabase, userId);
  if (rules) {
    const today = utcDate(new Date().toISOString());
    const [day, recentClosed] = await Promise.all([
      getRiskDayContext(supabase, userId, today),
      getRecentClosedTrades(supabase, userId),
    ]);
    let riskPct: number | null = null;
    if (input.sl !== null) {
      // Capture before the await below: `input` is a `let`, so
      // TypeScript drops the null narrowing across the await.
      const stopLoss = input.sl;
      const { data: profile } = await supabase
        .from("profiles")
        .select("trading_capital")
        .eq("id", userId)
        .maybeSingle();
      const capital = (profile as { trading_capital: number | null } | null)?.trading_capital;
      if (capital !== null && capital !== undefined && capital > 0) {
        const riskAmount = calcRiskAmount({
          entryPrice: input.entryPrice,
          stopLoss,
          positionSize: input.positionSize,
        });
        if (riskAmount !== null) riskPct = (riskAmount / capital) * 100;
      }
    }
    const checks = evaluateTradeRisk(
      rules,
      { leverage: input.leverage, riskPct },
      day,
      countDisciplinedStreak(recentClosed, rules),
    );
    if (hasCriticalBreach(checks)) {
      const critical = checks.filter((c) => c.breached && c.severity === "critical");
      for (const check of critical) {
        await logRiskEvent({
          userId,
          type: check.rule,
          severity: "critical",
          message: check.message,
          riskRuleId: rules.id,
          details: { value: check.value, limit: check.limit, pair: input.pair },
        });
      }
      return fail("business", critical.map((c) => c.message).join(" "));
    }
    for (const check of checks.filter((c) => c.breached && c.severity === "warning")) {
      await logRiskEvent({
        userId,
        type: check.rule,
        severity: "warning",
        message: check.message,
        riskRuleId: rules.id,
        details: { value: check.value, limit: check.limit, pair: input.pair },
      });
    }
  }

  const { data, error } = await supabase
    .from("trades")
    .insert({
      user_id: userId,
      pair: input.pair,
      direction: input.direction,
      entry_price: input.entryPrice,
      exit_price: input.exitPrice,
      tp: input.tp,
      sl: input.sl,
      position_size: input.positionSize,
      strategy_id: input.strategyId ?? null,
      leverage: input.leverage,
      fees: input.fees ?? 0,
      opened_at: input.openedAt,
      closed_at: input.closedAt,
      status: metrics.status,
      pnl: metrics.pnl,
      roi_pct: metrics.roiPct,
      r_multiple: metrics.rMultiple,
      risk_reward: metrics.riskReward,
      is_win: metrics.isWin,
      duration_seconds: metrics.durationSeconds,
    })
    .select("id")
    .single();
  if (error || !data) return fail("save_failed", "Could not save the trade. Please try again.");

  // +10 XP for a completed journal entry (spec §24, Phase 7).
  // Written via the service-role client — xp_transactions has no
  // client INSERT policy, so the Phase 3 signed-in-client insert
  // was silently rejected by RLS. Idempotent per trade, and a
  // failed XP insert never loses the trade.
  await awardXp({
    userId,
    reason: "trade_journal",
    sourceRefId: data.id,
    note: "Trade journal completed",
  });
  // Positive reinforcement (spec §19): log a milestone when the
  // trader's risk-disciplined streak reaches 3, then every 5 —
  // and award +25 XP for risk discipline (spec §24).
  if (rules && metrics.status === "closed" && input.sl !== null) {
    const recentClosed = await getRecentClosedTrades(supabase, userId);
    const streak = countDisciplinedStreak(recentClosed, rules);
    if (streak >= 3 && (streak === 3 || streak % 5 === 0)) {
      await logRiskEvent({
        userId,
        type: "positive_streak",
        severity: "positive",
        message: `You followed your risk plan for ${streak} consecutive trades.`,
        riskRuleId: rules.id,
        tradeId: data.id,
        details: { streak },
      });
      await awardXp({
        userId,
        reason: "risk_discipline",
        sourceRefId: data.id,
        note: `Followed the risk plan for ${streak} consecutive trades`,
      });
    }
  }
  // Achievements + stored level: best-effort, never blocks the save.
  const gamification = await refreshGamification(supabase, userId);
  for (const achievement of gamification.unlocked) {
    await createNotification({
      userId,
      type: "achievement",
      title: `Achievement unlocked: ${achievement.name}`,
      body: achievement.description ?? `You earned ${achievement.xp_reward} XP.`,
      relatedEntityType: "achievement",
      relatedEntityId: achievement.id,
    });
  }
  if (
    gamification.currentLevel !== null &&
    gamification.previousLevel !== null &&
    gamification.currentLevel !== gamification.previousLevel
  ) {
    await createNotification({
      userId,
      type: "level_up",
      title: `Level up: ${gamification.currentLevel}`,
      body: `Your multi-dimensional score reached the ${gamification.currentLevel} level.`,
    });
  }
  await writeAuditLog({
    userId,
    action: "trade.created",
    entityType: "trades",
    entityId: data.id,
    details: { pair: input.pair, direction: input.direction, status: metrics.status },
  });
  // Phase 20 hook: a newly closed trade changes its week's
  // coach evidence — refresh that week's insights. Never
  // throws; never changes this core's outcome.
  if (metrics.status === "closed") {
    await refreshCoachAfterClosedTradeChange(supabase, userId, input.closedAt, input.openedAt);
  }
  return {
    ok: true,
    trade: {
      id: data.id as string,
      pair: input.pair,
      direction: input.direction,
      status: metrics.status,
      pnl: metrics.pnl,
      roi_pct: metrics.roiPct,
      r_multiple: metrics.rMultiple,
      opened_at: input.openedAt,
      closed_at: input.closedAt,
    },
  };
}

/* --------------------------------------------------------- advanced review */

export type SaveAdvancedReviewCoreResult =
  | { ok: true; tradeId: string }
  | CoreFailure;

export async function saveAdvancedReviewCore(
  supabase: SupabaseClient,
  userId: string,
  rawInput: unknown,
): Promise<SaveAdvancedReviewCoreResult> {
  const parsed = advancedReviewSchema.safeParse(rawInput);
  if (!parsed.success) return fail("invalid_input", firstZodError(parsed.error));
  const v = parsed.data;

  const { data: trade } = await supabase
    .from("trades")
    .select("id, status, closed_at, opened_at")
    .eq("id", v.tradeId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!trade) return fail("not_found", "Trade not found.");
  if (trade.status === "reversed") {
    return fail(
      "business",
      "This trade was corrected by a reversal — review the correcting trade instead.",
    );
  }

  let setupId: string | null = null;
  if (v.setupName) {
    const { data: existing } = await supabase
      .from("setups")
      .select("id")
      .eq("user_id", userId)
      .eq("name", v.setupName)
      .maybeSingle();
    if (existing) {
      setupId = existing.id as string;
    } else {
      const { data: created, error: setupError } = await supabase
        .from("setups")
        .insert({ user_id: userId, strategy_id: v.strategyId, name: v.setupName })
        .select("id")
        .single();
      if (setupError || !created) {
        return fail("save_failed", "Could not save the setup. Please try again.");
      }
      setupId = created.id as string;
    }
  }

  const { error: tradeError } = await supabase
    .from("trades")
    .update({
      strategy_id: v.strategyId,
      setup_id: setupId,
      market_condition: v.marketCondition,
      trade_reason: v.tradeReason,
      session: v.session,
      notes: v.notes,
    })
    .eq("id", v.tradeId)
    .eq("user_id", userId);
  if (tradeError) return fail("save_failed", "Could not save the review. Please try again.");

  const { data: existingPsych } = await supabase
    .from("psychology_records")
    .select("id")
    .eq("trade_id", v.tradeId)
    .maybeSingle();
  const psychRow = {
    trade_id: v.tradeId,
    user_id: userId,
    confidence: v.confidence,
    emotion: v.emotion,
    discipline: v.discipline,
  };
  if (existingPsych) {
    await supabase.from("psychology_records").update(psychRow).eq("id", existingPsych.id);
  } else {
    await supabase.from("psychology_records").insert(psychRow);
  }

  if (v.lesson) {
    const { data: lessons } = await supabase
      .from("lessons")
      .select("text")
      .eq("trade_id", v.tradeId);
    const already = ((lessons ?? []) as { text: string }[]).some(
      (l) => normalizeLesson(l.text) === normalizeLesson(v.lesson as string),
    );
    if (!already) {
      await supabase.from("lessons").insert({ trade_id: v.tradeId, user_id: userId, text: v.lesson });
    }
  }

  await writeAuditLog({
    userId,
    action: "trade.review_saved",
    entityType: "trades",
    entityId: v.tradeId,
  });
  // Phase 20 hook: this core never changes status/closed_at/
  // pnl, but it does change review fields, psychology and
  // lessons — all coach evidence. When the trade is closed,
  // its week's data changed, so refresh that week's insights.
  if (trade.status === "closed") {
    await refreshCoachAfterClosedTradeChange(
      supabase,
      userId,
      (trade.closed_at as string | null) ?? null,
      trade.opened_at as string,
    );
  }
  return { ok: true, tradeId: v.tradeId };
}

/* -------------------------------------------------------------- correction */

export type CorrectTradeCoreResult =
  | { ok: true; tradeId: string; reversedTradeId: string }
  | CoreFailure;

export async function correctTradeCore(
  supabase: SupabaseClient,
  userId: string,
  tradeId: string,
  rawInput: unknown,
): Promise<CorrectTradeCoreResult> {
  if (!tradeId) return fail("invalid_input", "Trade is not valid.");
  const parsed = quickTradeSchema.safeParse(rawInput);
  if (!parsed.success) return fail("invalid_input", firstZodError(parsed.error));
  const input: QuickTradeInput = parsed.data;

  const { data: original } = await supabase
    .from("trades")
    .select("*")
    .eq("id", tradeId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!original) return fail("not_found", "Trade not found.");
  if (original.status === "reversed" || original.status === "cancelled") {
    return fail("business", "This trade has already been corrected or cancelled.");
  }

  const metrics = computeTradeMetrics(input);
  const { data: corrected, error: insertError } = await supabase
    .from("trades")
    .insert({
      user_id: userId,
      pair: input.pair,
      direction: input.direction,
      entry_price: input.entryPrice,
      exit_price: input.exitPrice,
      tp: input.tp,
      sl: input.sl,
      position_size: input.positionSize,
      leverage: input.leverage,
      fees: input.fees ?? 0,
      opened_at: input.openedAt,
      closed_at: input.closedAt,
      status: metrics.status,
      strategy_id: original.strategy_id,
      setup_id: original.setup_id,
      market_condition: original.market_condition,
      trade_reason: original.trade_reason,
      session: original.session,
      notes: original.notes,
      pnl: metrics.pnl,
      roi_pct: metrics.roiPct,
      r_multiple: metrics.rMultiple,
      risk_reward: metrics.riskReward,
      is_win: metrics.isWin,
      duration_seconds: metrics.durationSeconds,
    })
    .select("id")
    .single();
  if (insertError || !corrected) {
    return fail("save_failed", "Could not save the correction. Please try again.");
  }

  const { error: reverseError } = await supabase
    .from("trades")
    .update({ status: "reversed", reversal_trade_id: corrected.id })
    .eq("id", tradeId)
    .eq("user_id", userId);
  if (reverseError) {
    return fail(
      "save_failed",
      "The correction was saved as a new trade, but the original could not be marked as reversed. Please check the trade list.",
    );
  }
  await writeAuditLog({
    userId,
    action: "trade.corrected",
    entityType: "trades",
    entityId: tradeId,
    details: { correctingTradeId: corrected.id },
  });
  // Phase 20 hook: the correcting trade replaces the original
  // in its week's evidence — refresh when it is closed.
  if (metrics.status === "closed") {
    await refreshCoachAfterClosedTradeChange(supabase, userId, input.closedAt, input.openedAt);
  }
  return { ok: true, tradeId: corrected.id as string, reversedTradeId: tradeId };
}

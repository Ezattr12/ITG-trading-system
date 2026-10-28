"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured, supabaseNotConnectedMessage } from "@/lib/supabase/config";
import { writeAuditLog } from "@/lib/auth/audit";
import { checkPresetRateLimit, rateLimitMessage, TRADE_RATE_LIMIT, UPLOAD_RATE_LIMIT } from "@/lib/auth/rate-limit";
import { computeTradeMetrics } from "./calculations";
import { normalizeLesson } from "./lessons";
import { calcRiskAmount } from "@itg/calc";
import {
  countDisciplinedStreak,
  evaluateTradeRisk,
  hasCriticalBreach,
  utcDate,
} from "@/lib/risk/engine";
import { logRiskEvent } from "@/lib/risk/actions";
import { getRecentClosedTrades, getRiskDayContext, getRiskRules } from "@/lib/risk/queries";
import { awardXp, refreshGamification } from "@/lib/gamification/actions";
import { createNotification } from "@/lib/discipline/actions";
import {
  advancedReviewSchema,
  firstZodError,
  quickTradeSchema,
  type QuickTradeInput,
} from "./validation";

/**
 * Trade Server Actions (Phase 3, spec §9–16, §32–33).
 * Same pattern as Phase 2 auth actions: Zod first, Supabase
 * second, RLS enforces that a trader only touches their own
 * rows. Calculated values come from `computeTradeMetrics` —
 * the client never sends them.
 *
 * Financial facts are never silently overwritten and never
 * deleted (migration 0004): a closed trade is corrected by a
 * reversing trade, and only an open trade can be cancelled.
 * Screenshot rows may be deleted (their RLS allows it).
 */

export interface TradeActionResult {
  ok: boolean;
  error?: string;
  message?: string;
  redirectTo?: string;
}

function notConfigured(): TradeActionResult {
  return { ok: false, error: supabaseNotConnectedMessage() };
}

function toNumberOrNull(v: FormDataEntryValue | null): number | null {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toText(v: FormDataEntryValue | null): string | null {
  if (v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function toDateTime(v: FormDataEntryValue | null): string | null {
  const s = toText(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toISOString();
}

async function currentUserId(): Promise<string | null> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

function parseQuickForm(formData: FormData): QuickTradeInput {
  const parsed = quickTradeSchema.safeParse({
    pair: formData.get("pair"),
    direction: formData.get("direction"),
    entryPrice: toNumberOrNull(formData.get("entryPrice")),
    exitPrice: toNumberOrNull(formData.get("exitPrice")),
    tp: toNumberOrNull(formData.get("tp")),
    sl: toNumberOrNull(formData.get("sl")),
    positionSize: toNumberOrNull(formData.get("positionSize")),
    leverage: toNumberOrNull(formData.get("leverage")) ?? 1,
    fees: toNumberOrNull(formData.get("fees")),
    openedAt: toDateTime(formData.get("openedAt")),
    closedAt: toDateTime(formData.get("closedAt")),
  });
  if (!parsed.success) throw new Error(firstZodError(parsed.error));
  return parsed.data;
}

/* ------------------------------------------------------------ quick entry */

export async function createTradeAction(
  _prev: TradeActionResult,
  formData: FormData,
): Promise<TradeActionResult> {
  if (!isSupabaseConfigured()) return notConfigured();
  let input: QuickTradeInput;
  try {
    input = parseQuickForm(formData);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Please check the form and try again." };
  }
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: "You are not logged in. Please log in and try again." };
  // Rate limit (Phase 11): at most 30 trades per 10 minutes per trader.
  const tradeRate = checkPresetRateLimit(`trade:${userId}`, TRADE_RATE_LIMIT);
  if (!tradeRate.allowed) return { ok: false, error: rateLimitMessage("trade creation", tradeRate) };

  const metrics = computeTradeMetrics(input);
  const supabase = await createServerSupabaseClient();

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
      return {
        ok: false,
        error: critical.map((c) => c.message).join(" "),
      };
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
  if (error || !data) return { ok: false, error: "Could not save the trade. Please try again." };

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
  revalidatePath("/trades");
  revalidatePath("/dashboard");
  return { ok: true, redirectTo: `/trades/${data.id}` };
}

/* --------------------------------------------------------- advanced review */

export async function saveAdvancedReviewAction(
  _prev: TradeActionResult,
  formData: FormData,
): Promise<TradeActionResult> {
  if (!isSupabaseConfigured()) return notConfigured();
  const parsed = advancedReviewSchema.safeParse({
    tradeId: formData.get("tradeId"),
    strategyId: toText(formData.get("strategyId")),
    setupName: toText(formData.get("setupName")),
    marketCondition: toText(formData.get("marketCondition")),
    tradeReason: toText(formData.get("tradeReason")),
    session: toText(formData.get("session")),
    confidence: toNumberOrNull(formData.get("confidence")),
    emotion: toText(formData.get("emotion")),
    discipline: toText(formData.get("discipline")),
    lesson: toText(formData.get("lesson")),
    notes: toText(formData.get("notes")),
  });
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };
  const v = parsed.data;
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: "You are not logged in. Please log in and try again." };
  const supabase = await createServerSupabaseClient();

  const { data: trade } = await supabase
    .from("trades")
    .select("id, status")
    .eq("id", v.tradeId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!trade) return { ok: false, error: "Trade not found." };
  if (trade.status === "reversed") {
    return { ok: false, error: "This trade was corrected by a reversal — review the correcting trade instead." };
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
      if (setupError || !created) return { ok: false, error: "Could not save the setup. Please try again." };
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
  if (tradeError) return { ok: false, error: "Could not save the review. Please try again." };

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
  revalidatePath(`/trades/${v.tradeId}`);
  revalidatePath("/trades");
  return { ok: true, message: "Review saved.", redirectTo: `/trades/${v.tradeId}` };
}

/* -------------------------------------------------------------- correction */

export async function correctTradeAction(
  _prev: TradeActionResult,
  formData: FormData,
): Promise<TradeActionResult> {
  if (!isSupabaseConfigured()) return notConfigured();
  const tradeId = toText(formData.get("tradeId"));
  if (!tradeId) return { ok: false, error: "Trade is not valid." };
  let input: QuickTradeInput;
  try {
    input = parseQuickForm(formData);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Please check the form and try again." };
  }
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: "You are not logged in. Please log in and try again." };
  const supabase = await createServerSupabaseClient();

  const { data: original } = await supabase
    .from("trades")
    .select("*")
    .eq("id", tradeId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!original) return { ok: false, error: "Trade not found." };
  if (original.status === "reversed" || original.status === "cancelled") {
    return { ok: false, error: "This trade has already been corrected or cancelled." };
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
  if (insertError || !corrected) return { ok: false, error: "Could not save the correction. Please try again." };

  const { error: reverseError } = await supabase
    .from("trades")
    .update({ status: "reversed", reversal_trade_id: corrected.id })
    .eq("id", tradeId)
    .eq("user_id", userId);
  if (reverseError) {
    return {
      ok: false,
      error:
        "The correction was saved as a new trade, but the original could not be marked as reversed. Please check the trade list.",
    };
  }
  await writeAuditLog({
    userId,
    action: "trade.corrected",
    entityType: "trades",
    entityId: tradeId,
    details: { correctingTradeId: corrected.id },
  });
  revalidatePath("/trades");
  revalidatePath(`/trades/${tradeId}`);
  return { ok: true, redirectTo: `/trades/${corrected.id}` };
}

/* ------------------------------------------------------------------ cancel */

export async function cancelTradeAction(formData: FormData): Promise<void> {
  const tradeId = toText(formData.get("tradeId"));
  if (!tradeId) redirect("/trades");
  if (!isSupabaseConfigured()) redirect("/trades");
  const userId = await currentUserId();
  if (!userId) redirect("/login");
  const supabase = await createServerSupabaseClient();
  const { data: trade } = await supabase
    .from("trades")
    .select("id, status")
    .eq("id", tradeId)
    .eq("user_id", userId)
    .maybeSingle();
  // Only an open trade can be cancelled. A closed trade is a financial
  // fact: it is corrected by reversal, never deleted (migration 0004).
  if (trade && trade.status === "open") {
    await supabase.from("trades").update({ status: "cancelled" }).eq("id", tradeId).eq("user_id", userId);
    await writeAuditLog({ userId, action: "trade.cancelled", entityType: "trades", entityId: tradeId });
  }
  revalidatePath("/trades");
  redirect("/trades");
}

/* -------------------------------------------------------------- screenshots */

/**
 * Screenshot upload (spec §10). Real Supabase Storage when
 * configured, otherwise an honest error. Images only, 5 MB max,
 * per-user path in the `trade-screenshots` bucket. OCR status
 * stays `not_applicable` — no OCR service is connected, and no
 * extraction is faked (see lib/trades/ocr.ts).
 */
export async function uploadScreenshotAction(
  _prev: TradeActionResult,
  formData: FormData,
): Promise<TradeActionResult> {
  if (!isSupabaseConfigured()) return notConfigured();
  const tradeId = toText(formData.get("tradeId"));
  if (!tradeId) return { ok: false, error: "Trade is not valid." };
  const file = formData.get("screenshot");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose an image file first." };
  }
  if (!file.type.startsWith("image/")) {
    return { ok: false, error: "Only image files can be uploaded as screenshots." };
  }
  if (file.size > 5 * 1024 * 1024) {
    return { ok: false, error: "Screenshot must be 5 MB or smaller." };
  }
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: "You are not logged in. Please log in and try again." };
  // Rate limit (Phase 11): at most 10 uploads per 10 minutes per trader.
  const uploadRate = checkPresetRateLimit(`upload:${userId}`, UPLOAD_RATE_LIMIT);
  if (!uploadRate.allowed) return { ok: false, error: rateLimitMessage("screenshot upload", uploadRate) };
  const supabase = await createServerSupabaseClient();
  const { data: trade } = await supabase
    .from("trades")
    .select("id")
    .eq("id", tradeId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!trade) return { ok: false, error: "Trade not found." };

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "screenshot";
  const path = `${userId}/${tradeId}/${Date.now()}-${safeName}`;
  const { error: uploadError } = await supabase.storage
    .from("trade-screenshots")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) {
    return {
      ok: false,
      error:
        "Screenshot upload failed — the 'trade-screenshots' Storage bucket may not exist yet in this Supabase project. Ask an admin to create it, then try again.",
    };
  }
  const { error: rowError } = await supabase.from("trade_screenshots").insert({
    trade_id: tradeId,
    user_id: userId,
    storage_path: path,
    file_name: file.name,
    ocr_status: "not_applicable",
    verified_by_user: false,
  });
  if (rowError) {
    await supabase.storage.from("trade-screenshots").remove([path]);
    return { ok: false, error: "Screenshot uploaded but could not be linked to the trade. Please try again." };
  }
  await writeAuditLog({
    userId,
    action: "trade.screenshot_uploaded",
    entityType: "trade_screenshots",
    entityId: tradeId,
  });
  revalidatePath(`/trades/${tradeId}`);
  return { ok: true, message: "Screenshot uploaded." };
}

export async function deleteScreenshotAction(formData: FormData): Promise<void> {
  const screenshotId = toText(formData.get("screenshotId"));
  const tradeId = toText(formData.get("tradeId"));
  if (!screenshotId || !tradeId) redirect("/trades");
  if (isSupabaseConfigured()) {
    const userId = await currentUserId();
    if (userId) {
      const supabase = await createServerSupabaseClient();
      const { data: shot } = await supabase
        .from("trade_screenshots")
        .select("id, storage_path")
        .eq("id", screenshotId)
        .eq("user_id", userId)
        .maybeSingle();
      if (shot) {
        await supabase.storage.from("trade-screenshots").remove([shot.storage_path as string]);
        await supabase.from("trade_screenshots").delete().eq("id", screenshotId).eq("user_id", userId);
      }
    }
  }
  revalidatePath(`/trades/${tradeId}`);
  redirect(`/trades/${tradeId}`);
}

"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured, supabaseNotConnectedMessage } from "@/lib/supabase/config";
import { writeAuditLog } from "@/lib/auth/audit";
import { checkPresetRateLimit, rateLimitMessage, UPLOAD_RATE_LIMIT } from "@/lib/auth/rate-limit";
import {
  correctTradeCore,
  createTradeCore,
  saveAdvancedReviewCore,
} from "./service";
import {
  advancedReviewSchema,
  firstZodError,
  quickTradeSchema,
  type QuickTradeInput,
} from "./validation";

/**
 * Trade Server Actions (Phase 3, spec §9–16, §32–33).
 *
 * Phase 21 (M1): the write logic for create / advanced
 * review / correction lives in lib/trades/service.ts as
 * cores shared with the mobile API — these actions are now
 * thin adapters (session auth + FormData → core →
 * revalidate/redirect/message), with identical behaviour,
 * messages and ordering of outcomes. Cancel and screenshot
 * actions were not extracted in M1 (see
 * docs/phase-21-m1.md) and are unchanged.
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
    strategyId: toText(formData.get("strategyId")),
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
  const supabase = await createServerSupabaseClient();
  const result = await createTradeCore(supabase, userId, input);
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath("/trades");
  revalidatePath("/dashboard");
  // ?saved=1 shows the animated "Trade saved" confirmation on
  // the trade page (Phase 16). It is only a display flag — the
  // trade is already saved and the dashboard is revalidated.
  return { ok: true, redirectTo: `/trades/${result.trade.id}?saved=1` };
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
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: "You are not logged in. Please log in and try again." };
  const supabase = await createServerSupabaseClient();
  const result = await saveAdvancedReviewCore(supabase, userId, parsed.data);
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath(`/trades/${result.tradeId}`);
  revalidatePath("/trades");
  return { ok: true, message: "Review saved.", redirectTo: `/trades/${result.tradeId}` };
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
  const result = await correctTradeCore(supabase, userId, tradeId, input);
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath("/trades");
  revalidatePath(`/trades/${tradeId}`);
  // Same ?saved=1 confirmation as a new trade (Phase 16).
  return { ok: true, redirectTo: `/trades/${result.tradeId}?saved=1` };
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

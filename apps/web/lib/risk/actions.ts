"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/auth/actions";
import { writeAuditLog } from "@/lib/auth/audit";
import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured, supabaseNotConnectedMessage } from "@/lib/supabase/config";
import {
  firstZodError,
  riskRulesSchema,
  tradingPlanSchema,
} from "./validation";
import type { RiskEventType } from "./types";

/**
 * Risk & trading-plan Server Actions (Phase 5, spec §19–20).
 *
 * Same pattern as Phase 2/3: Zod first, Supabase second, RLS
 * enforces that a trader only touches their own rows. One active
 * rules row and one active plan per trader (upsert by user).
 *
 * Risk events are written server-side only, via the service-role
 * client, because `risk_events` has no client INSERT policy
 * (migration 0011, append-only like `audit_logs`). Logging is
 * best-effort and never blocks a trade or a save.
 */

function notConfigured(): ActionResult {
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

function toTextArray(v: FormDataEntryValue | null): string[] {
  const s = toText(v);
  if (!s) return [];
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

async function currentUserId(): Promise<string | null> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/** Log a risk event. Returns true only when a row was inserted. */
export async function logRiskEvent(input: {
  userId: string;
  type: RiskEventType;
  severity: "warning" | "critical" | "positive";
  message: string;
  planId?: string | null;
  riskRuleId?: string | null;
  tradeId?: string | null;
  details?: Record<string, unknown>;
}): Promise<boolean> {
  const admin = createServiceRoleSupabaseClient();
  if (!admin) return false;
  const { error } = await admin.from("risk_events").insert({
    user_id: input.userId,
    plan_id: input.planId ?? null,
    risk_rule_id: input.riskRuleId ?? null,
    trade_id: input.tradeId ?? null,
    type: input.type,
    severity: input.severity,
    message: input.message,
    details: input.details ?? {},
  });
  return !error;
}

/* ------------------------------------------------------------ risk rules */

export async function saveRiskRulesAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return notConfigured();
  const parsed = riskRulesSchema.safeParse({
    maxRiskPerTradePct: toNumberOrNull(formData.get("maxRiskPerTradePct")),
    maxDailyLoss: toNumberOrNull(formData.get("maxDailyLoss")),
    maxTradesPerDay: toNumberOrNull(formData.get("maxTradesPerDay")),
    maxConsecutiveLosses: toNumberOrNull(formData.get("maxConsecutiveLosses")),
    maxLeverage: toNumberOrNull(formData.get("maxLeverage")),
  });
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: "You are not logged in. Please log in and try again." };
  const supabase = await createServerSupabaseClient();
  const v = parsed.data;

  const { data: existing } = await supabase
    .from("risk_rules")
    .select("id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const row = {
    user_id: userId,
    max_risk_per_trade_pct: v.maxRiskPerTradePct,
    max_daily_loss: v.maxDailyLoss,
    max_trades_per_day: v.maxTradesPerDay,
    max_consecutive_losses: v.maxConsecutiveLosses,
    max_leverage: v.maxLeverage,
    is_active: true,
  };
  const { error } = existing
    ? await supabase.from("risk_rules").update(row).eq("id", existing.id)
    : await supabase.from("risk_rules").insert(row);
  if (error) return { ok: false, error: "Could not save your risk rules. Please try again." };
  await writeAuditLog({
    userId,
    action: "risk_rules.saved",
    entityType: "risk_rules",
    details: { maxRiskPerTradePct: v.maxRiskPerTradePct, maxDailyLoss: v.maxDailyLoss },
  });
  revalidatePath("/risk");
  return { ok: true, message: "Risk rules saved." };
}

/* ---------------------------------------------------------- trading plan */

export async function saveTradingPlanAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return notConfigured();
  const parsed = tradingPlanSchema.safeParse({
    name: toText(formData.get("name")) ?? "",
    markets: toTextArray(formData.get("markets")),
    sessions: formData.getAll("sessions").map(String),
    riskPerTradePct: toNumberOrNull(formData.get("riskPerTradePct")),
    maxDailyLoss: toNumberOrNull(formData.get("maxDailyLoss")),
    maxDailyTrades: toNumberOrNull(formData.get("maxDailyTrades")),
    preferredSetupIds: formData.getAll("preferredSetupIds").map(String),
    noTradeConditions: toText(formData.get("noTradeConditions")),
    psychologyRules: toText(formData.get("psychologyRules")),
    scheduleNotes: toText(formData.get("scheduleNotes")),
  });
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: "You are not logged in. Please log in and try again." };
  const supabase = await createServerSupabaseClient();
  const v = parsed.data;

  const { data: existing } = await supabase
    .from("trading_plans")
    .select("id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const row = {
    user_id: userId,
    name: v.name,
    markets: v.markets,
    sessions: v.sessions,
    risk_per_trade_pct: v.riskPerTradePct,
    max_daily_loss: v.maxDailyLoss,
    max_daily_trades: v.maxDailyTrades,
    preferred_setup_ids: v.preferredSetupIds,
    no_trade_conditions: v.noTradeConditions,
    psychology_rules: v.psychologyRules,
    schedule: v.scheduleNotes ? { notes: v.scheduleNotes } : {},
    is_active: true,
  };
  const { error } = existing
    ? await supabase.from("trading_plans").update(row).eq("id", existing.id)
    : await supabase.from("trading_plans").insert(row);
  if (error) return { ok: false, error: "Could not save your trading plan. Please try again." };
  await writeAuditLog({
    userId,
    action: "trading_plan.saved",
    entityType: "trading_plans",
    details: { name: v.name, markets: v.markets, sessions: v.sessions },
  });
  revalidatePath("/plan");
  return { ok: true, message: "Trading plan saved." };
}

/* ---------------------------------------------------------- resolve event */

export async function resolveRiskEventAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return notConfigured();
  const eventId = toText(formData.get("eventId"));
  if (!eventId) return { ok: false, error: "No event selected." };
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: "You are not logged in. Please log in and try again." };
  // Service-role client: risk_events has no client UPDATE policy.
  const admin = createServiceRoleSupabaseClient();
  if (!admin) return { ok: false, error: "Could not update the event. Please try again." };
  const { error } = await admin
    .from("risk_events")
    .update({ resolved_at: new Date().toISOString() })
    .eq("id", eventId)
    .eq("user_id", userId)
    .is("resolved_at", null);
  if (error) return { ok: false, error: "Could not update the event. Please try again." };
  revalidatePath("/risk");
  return { ok: true, message: "Event marked as resolved." };
}

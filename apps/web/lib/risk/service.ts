import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAuditLog } from "@/lib/auth/audit";
import type { CoreFailure } from "@/lib/trades/service";
import {
  firstZodError,
  riskRulesSchema,
  tradingPlanSchema,
} from "./validation";

/**
 * Risk service cores (Phase 21, M2) — the single source of
 * truth for the risk-rules and trading-plan writes,
 * extracted verbatim from the Server Actions in
 * lib/risk/actions.ts. The web actions are now adapters
 * (session auth + FormData); the mobile API handlers call
 * the same cores with the token-derived user id.
 *
 * One active rules row and one active plan per trader
 * (upsert by user: update the active row when one exists,
 * insert otherwise) — RLS enforces that a trader only
 * touches their own rows, and every query is additionally
 * scoped by user_id, exactly as the actions did.
 *
 * CoreFailure codes are shared with lib/trades/service.ts.
 */

function fail(code: CoreFailure["code"], error: string): CoreFailure {
  return { ok: false, code, error };
}

/* ------------------------------------------------------------ risk rules */

export type SaveRiskRulesCoreResult = { ok: true } | CoreFailure;

export async function saveRiskRulesCore(
  supabase: SupabaseClient,
  userId: string,
  rawInput: unknown,
): Promise<SaveRiskRulesCoreResult> {
  const parsed = riskRulesSchema.safeParse(rawInput);
  if (!parsed.success) return fail("invalid_input", firstZodError(parsed.error));
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
  if (error) return fail("save_failed", "Could not save your risk rules. Please try again.");
  await writeAuditLog({
    userId,
    action: "risk_rules.saved",
    entityType: "risk_rules",
    details: { maxRiskPerTradePct: v.maxRiskPerTradePct, maxDailyLoss: v.maxDailyLoss },
  });
  return { ok: true };
}

/* ---------------------------------------------------------- trading plan */

export type SaveTradingPlanCoreResult =
  | { ok: true; planId: string }
  | CoreFailure;

export async function saveTradingPlanCore(
  supabase: SupabaseClient,
  userId: string,
  rawInput: unknown,
): Promise<SaveTradingPlanCoreResult> {
  const parsed = tradingPlanSchema.safeParse(rawInput);
  if (!parsed.success) return fail("invalid_input", firstZodError(parsed.error));
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
  if (existing) {
    const { error } = await supabase
      .from("trading_plans")
      .update(row)
      .eq("id", existing.id);
    if (error) return fail("save_failed", "Could not save your trading plan. Please try again.");
    await writeAuditLog({
      userId,
      action: "trading_plan.saved",
      entityType: "trading_plans",
      details: { name: v.name, markets: v.markets, sessions: v.sessions },
    });
    return { ok: true, planId: existing.id as string };
  }
  const { data: created, error } = await supabase
    .from("trading_plans")
    .insert(row)
    .select("id")
    .single();
  if (error || !created) {
    return fail("save_failed", "Could not save your trading plan. Please try again.");
  }
  await writeAuditLog({
    userId,
    action: "trading_plan.saved",
    entityType: "trading_plans",
    details: { name: v.name, markets: v.markets, sessions: v.sessions },
  });
  return { ok: true, planId: created.id as string };
}

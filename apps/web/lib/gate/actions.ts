"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  isSupabaseConfigured,
  supabaseNotConnectedMessage,
} from "@/lib/supabase/config";
import { evaluatePreTradeGateCore } from "./service";
import type { GateResult } from "./types";

/**
 * Pre-trade gate Server Action (Task 20). Thin adapter over
 * evaluatePreTradeGateCore: session auth + FormData → core
 * → serialisable result. The gate is read-only — this
 * action writes nothing, so checking the gate twice (or
 * checking and then not saving) has no side effects.
 *
 * FormData parsing mirrors lib/trades/actions.ts's
 * parseQuickForm so the gate judges exactly the values the
 * save would judge; the optional `session` / `setupId`
 * fields are accepted when present (a future review-time
 * gate, or an API caller, can supply them) and are simply
 * absent — honestly not_evaluable — from quick entry.
 */

export type GateActionResult =
  | { ok: true; gate: GateResult }
  | { ok: false; error: string };

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

export async function evaluatePreTradeGateAction(
  formData: FormData,
): Promise<GateActionResult> {
  if (!isSupabaseConfigured())
    return { ok: false, error: supabaseNotConnectedMessage() };
  // The core validates (quick-trade schema + optional
  // session/setupId) and returns invalid_input on bad values.
  const rawInput = {
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
    session: toText(formData.get("session")),
    setupId: toText(formData.get("setupId")),
  };

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return { ok: false, error: "You are not logged in. Please log in and try again." };

  const result = await evaluatePreTradeGateCore(supabase, user.id, rawInput);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, gate: result.gate };
}

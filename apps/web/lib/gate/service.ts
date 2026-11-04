import type { SupabaseClient } from "@supabase/supabase-js";
import { calcRiskAmount } from "@itg/calc";
import { evaluateTradeAgainstPlan } from "@/lib/plan/engine";
import type { PlanTradeInput } from "@/lib/plan/types";
import {
  countDisciplinedStreak,
  evaluateTradeRisk,
  utcDate,
} from "@/lib/risk/engine";
import {
  getRecentClosedTrades,
  getRiskDayContext,
  getRiskRules,
  getTradingPlan,
} from "@/lib/risk/queries";
import { computeTradeMetrics } from "@/lib/trades/calculations";
import {
  firstZodError,
  quickTradeSchema,
  sessionSchema,
  type QuickTradeInput,
} from "@/lib/trades/validation";
import type { CoreFailure } from "@/lib/trades/service";
import { z } from "zod";
import { buildCandidatePlanDayContext, composePreTradeGate } from "./engine";
import type { GateResult } from "./types";

/**
 * Pre-trade gate service (Task 20) — the read-only side of
 * the gate. It judges a candidate trade BEFORE save and
 * returns READY / CAUTION / RULE VIOLATION, reusing:
 * - the Task 19 plan engine (`evaluateTradeAgainstPlan`)
 *   with the candidate appended to the day lists, and
 * - the risk engine (`evaluateTradeRisk`) with exactly
 *   the inputs createTradeCore uses at save time, so a
 *   RULE VIOLATION level predicts the save refusal.
 *
 * READ-ONLY BY CONSTRUCTION: this module performs no
 * insert, update or delete. A gate preview must never log
 * a plan_event or risk_event for a trade that was never
 * saved, and must never notify. Task 19's save hook and
 * background pass remain the only writers of plan events.
 *
 * Asymmetries, both deliberate and documented:
 * - Plan day terms judge the CANDIDATE's own opened /
 *   closed day (the day the trade belongs to).
 * - Risk checks judge TODAY (the save-time day, as
 *   createTradeCore does: `utcDate(now)`), not the
 *   candidate's opened day — so a backdated journal entry
 *   is risk-checked against today's loss limit, exactly as
 *   its save will be. The panel labels the risk section
 *   accordingly ("today").
 * - The candidate's P&L, status and risk % are DERIVED
 *   server-side from the raw form values (computeTradeMetrics
 *   / calcRiskAmount over the profile's capital) — never
 *   accepted from the client, per the trade-lifecycle rule.
 * - Session / setup come from the optional candidate fields
 *   only. Quick entry has no session/setup fields, so at
 *   quick entry those terms are honestly not_evaluable
 *   (a journaling gap, not a breach) — the panel says so.
 */

/**
 * quickTradeSchema carries .refine() calls, so it is a
 * ZodEffects and cannot be .extend()ed. The gate candidate
 * is therefore the quick-trade input PLUS separately
 * validated optional fields — parsed together below, so a
 * bad session/setupId is still invalid_input, not ignored.
 */
const gateExtrasSchema = z.object({
  session: sessionSchema.nullable().optional(),
  setupId: z.string().uuid().nullable().optional(),
});

export type GateCandidateInput = QuickTradeInput &
  z.infer<typeof gateExtrasSchema>;

function parseGateCandidate(
  rawInput: unknown,
): { ok: true; input: GateCandidateInput } | { ok: false; error: string } {
  const base = quickTradeSchema.safeParse(rawInput);
  if (!base.success)
    return { ok: false, error: firstZodError(base.error) };
  const extras = gateExtrasSchema.safeParse(rawInput);
  if (!extras.success)
    return { ok: false, error: firstZodError(extras.error) };
  return { ok: true, input: { ...base.data, ...extras.data } };
}

export type EvaluatePreTradeGateResult =
  | { ok: true; gate: GateResult }
  | CoreFailure;

function fail(code: CoreFailure["code"], error: string): CoreFailure {
  return { ok: false, code, error };
}

const DAY_COLUMNS =
  "id, status, pnl, opened_at, closed_at, created_at";

interface DayRowShape {
  id: string;
  status: string;
  pnl: number | null;
  opened_at: string;
  closed_at: string | null;
  created_at: string | null;
}

async function getTradingCapital(
  client: SupabaseClient,
  userId: string,
): Promise<number | null> {
  const { data } = await client
    .from("profiles")
    .select("trading_capital")
    .eq("id", userId)
    .maybeSingle();
  const capital = (data as { trading_capital: number | null } | null)
    ?.trading_capital;
  return capital !== null && capital !== undefined && Number(capital) > 0
    ? Number(capital)
    : null;
}

/**
 * Judge a candidate trade. `now` is injectable for tests;
 * production callers pass the default (the real evaluation
 * time, which is also the risk checks' "today").
 */
export async function evaluatePreTradeGateCore(
  supabase: SupabaseClient,
  userId: string,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<EvaluatePreTradeGateResult> {
  const parsed = parseGateCandidate(rawInput);
  if (!parsed.ok) return fail("invalid_input", parsed.error);
  const input = parsed.input;

  // Derived, never accepted: P&L/status from the raw prices,
  // risk % from entry/SL/size over the profile's capital —
  // the same derivations createTradeCore performs.
  const metrics = computeTradeMetrics(input);
  const [capital, plan, rules] = await Promise.all([
    getTradingCapital(supabase, userId),
    getTradingPlan(supabase, userId),
    getRiskRules(supabase, userId),
  ]);
  let riskPct: number | null = null;
  if (capital !== null && input.sl !== null) {
    const riskAmount = calcRiskAmount({
      entryPrice: input.entryPrice,
      stopLoss: input.sl,
      positionSize: input.positionSize,
    });
    if (riskAmount !== null) riskPct = (riskAmount / capital) * 100;
  }

  const candidate: PlanTradeInput = {
    id: "__candidate__",
    pair: input.pair,
    session: input.session ?? null,
    setupId: input.setupId ?? null,
    riskPct,
    pnl: metrics.pnl,
    status: metrics.status,
    openedAt: input.openedAt,
    closedAt: input.closedAt,
  };
  const nowIso = now.toISOString();

  /* ---- plan verdicts: candidate appended to its day lists */
  let planVerdicts: GateResult["planVerdicts"] = [];
  if (plan) {
    const openedDay = utcDate(candidate.openedAt);
    const { data: openedRows } = await supabase
      .from("trades")
      .select(DAY_COLUMNS)
      .eq("user_id", userId)
      .gte("opened_at", `${openedDay}T00:00:00Z`)
      .lte("opened_at", `${openedDay}T23:59:59.999Z`);
    const opened = ((openedRows ?? []) as DayRowShape[])
      .filter((r) => r.status !== "cancelled" && r.status !== "reversed")
      .map((r) => ({
        id: r.id,
        openedAt: r.opened_at,
        createdAt: r.created_at ?? r.opened_at,
      }));

    let closed: {
      id: string;
      pnl: number;
      closedAt: string;
      createdAt: string;
    }[] = [];
    if (candidate.closedAt) {
      const closedDay = utcDate(candidate.closedAt);
      const { data: closedRows } = await supabase
        .from("trades")
        .select(DAY_COLUMNS)
        .eq("user_id", userId)
        .eq("status", "closed")
        .gte("closed_at", `${closedDay}T00:00:00Z`)
        .lte("closed_at", `${closedDay}T23:59:59.999Z`);
      closed = ((closedRows ?? []) as DayRowShape[])
        .filter((r) => r.pnl !== null && r.closed_at !== null)
        .map((r) => ({
          id: r.id,
          pnl: Number(r.pnl),
          closedAt: r.closed_at as string,
          createdAt: r.created_at ?? (r.closed_at as string),
        }));
    }

    const context = buildCandidatePlanDayContext({
      storedOpened: opened,
      storedClosed: closed,
      candidate,
      candidateCreatedAt: nowIso,
    });
    planVerdicts = evaluateTradeAgainstPlan(candidate, plan, context);
  }

  /* ---- risk checks: exactly createTradeCore's save-time inputs */
  let riskChecks: GateResult["riskChecks"] = [];
  const hasRules = rules !== null && rules.is_active;
  if (rules) {
    const today = utcDate(nowIso);
    const [day, recentClosed] = await Promise.all([
      getRiskDayContext(supabase, userId, today),
      getRecentClosedTrades(supabase, userId),
    ]);
    riskChecks = evaluateTradeRisk(
      rules,
      { leverage: input.leverage, riskPct },
      day,
      countDisciplinedStreak(recentClosed, rules),
    );
  }

  return {
    ok: true,
    gate: composePreTradeGate({
      planVerdicts,
      riskChecks,
      hasPlan: plan !== null,
      hasRules,
    }),
  };
}

import {
  apiError,
  apiOk,
  type ApiDeps,
  type ApiHandlerResult,
} from "@/lib/api/auth";
import { saveRiskRulesCore, saveTradingPlanCore } from "@/lib/risk/service";
import {
  checkApiRateLimit,
  coreFailureResponse,
  finish,
  requireApiAuth,
  validateBody,
  type HandlerContext,
} from "./shared";
import type { JsonHandlerInput } from "./trades";

/**
 * Mobile risk write handlers (Phase 21, M2): risk rules and
 * trading plan, on the M1 pipeline. All logic lives in
 * lib/risk/service.ts — the same cores the web Server
 * Actions call. Allowed body keys mirror the Zod schema
 * fields exactly.
 */

/** riskRulesSchema fields (lib/risk/validation.ts). */
const RISK_RULES_KEYS = [
  "maxRiskPerTradePct",
  "maxDailyLoss",
  "maxTradesPerDay",
  "maxConsecutiveLosses",
  "maxLeverage",
] as const;

/** tradingPlanSchema fields (lib/risk/validation.ts). */
const TRADING_PLAN_KEYS = [
  "name",
  "markets",
  "sessions",
  "riskPerTradePct",
  "maxDailyLoss",
  "maxDailyTrades",
  "preferredSetupIds",
  "noTradeConditions",
  "psychologyRules",
  "scheduleNotes",
] as const;

async function begin(
  input: JsonHandlerInput,
  deps: ApiDeps,
  ctx: HandlerContext,
  allowedKeys: readonly string[],
) {
  const gate = await requireApiAuth(input.token, deps, ctx);
  if (!gate.ok) return { ok: false as const, response: gate.response };
  const { userId, supabase } = gate.auth;
  if (input.bodyError) {
    return {
      ok: false as const,
      response: await finish(deps, ctx, userId, "invalid_argument", null,
        apiError(400, "invalid_argument", input.bodyError)),
    };
  }
  const validated = validateBody(input.body, allowedKeys);
  if (!validated.ok) {
    return {
      ok: false as const,
      response: await finish(deps, ctx, userId, "invalid_argument", null, validated.response),
    };
  }
  const limited = checkApiRateLimit(deps, ctx, userId);
  if (limited) {
    return {
      ok: false as const,
      response: await finish(deps, ctx, userId, "rate_limited", null, limited),
    };
  }
  return { ok: true as const, userId, supabase, body: validated.body };
}

/* ---------------------------------------------------------- risk rules */

const RISK_RULES_CTX: HandlerContext = { operation: "risk_rules_saved", entityType: "risk_rules" };

export async function handleSaveRiskRules(
  input: JsonHandlerInput,
  deps: ApiDeps,
): Promise<ApiHandlerResult> {
  const begun = await begin(input, deps, RISK_RULES_CTX, RISK_RULES_KEYS);
  if (!begun.ok) return begun.response;
  let result: Awaited<ReturnType<typeof saveRiskRulesCore>>;
  try {
    result = await saveRiskRulesCore(begun.supabase, begun.userId, begun.body);
  } catch {
    return finish(deps, RISK_RULES_CTX, begun.userId, "error", null, apiError(500, "internal"));
  }
  if (!result.ok) {
    const { response, outcome } = coreFailureResponse(result);
    return finish(deps, RISK_RULES_CTX, begun.userId, outcome, null, response);
  }
  return finish(deps, RISK_RULES_CTX, begun.userId, "ok", null, apiOk({ ok: true }));
}

/* ---------------------------------------------------------- trading plan */

const TRADING_PLAN_CTX: HandlerContext = { operation: "trading_plan_saved", entityType: "trading_plans" };

export async function handleSaveTradingPlan(
  input: JsonHandlerInput,
  deps: ApiDeps,
): Promise<ApiHandlerResult> {
  const begun = await begin(input, deps, TRADING_PLAN_CTX, TRADING_PLAN_KEYS);
  if (!begun.ok) return begun.response;
  let result: Awaited<ReturnType<typeof saveTradingPlanCore>>;
  try {
    result = await saveTradingPlanCore(begun.supabase, begun.userId, begun.body);
  } catch {
    return finish(deps, TRADING_PLAN_CTX, begun.userId, "error", null, apiError(500, "internal"));
  }
  if (!result.ok) {
    const { response, outcome } = coreFailureResponse(result);
    return finish(deps, TRADING_PLAN_CTX, begun.userId, outcome, null, response);
  }
  return finish(deps, TRADING_PLAN_CTX, begun.userId, "ok", result.planId,
    apiOk({ plan_id: result.planId }));
}

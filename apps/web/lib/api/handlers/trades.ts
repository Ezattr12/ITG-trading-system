import type { SupabaseClient } from "@supabase/supabase-js";
import {
  apiError,
  apiOk,
  isUuid,
  type ApiDeps,
  type ApiHandlerResult,
} from "@/lib/api/auth";
import {
  correctTradeCore,
  createTradeCore,
  saveAdvancedReviewCore,
} from "@/lib/trades/service";
import {
  checkApiRateLimit,
  coreFailureResponse,
  finish,
  requireApiAuth,
  validateBody,
  type HandlerContext,
} from "./shared";

/**
 * Mobile trade write handlers (Phase 21, M1):
 * create / advanced review / correct-by-reversal.
 *
 * All business logic lives in lib/trades/service.ts — the
 * same cores the web Server Actions call. These handlers
 * only authenticate, shape-check the JSON, map the core
 * result to HTTP, and write the one API-layer audit row.
 *
 * Allowed body keys mirror the Zod schema fields exactly
 * (the schemas are the validation source of truth inside
 * the cores; the key lists here enforce the strict
 * no-unknown-fields rule before the core runs).
 */

/** quickTradeSchema fields (lib/trades/validation.ts). */
const QUICK_TRADE_KEYS = [
  "pair",
  "direction",
  "entryPrice",
  "exitPrice",
  "tp",
  "sl",
  "positionSize",
  "strategyId",
  "leverage",
  "fees",
  "openedAt",
  "closedAt",
] as const;

/** advancedReviewSchema fields, minus tradeId (path-carried here). */
const REVIEW_KEYS = [
  "strategyId",
  "setupName",
  "marketCondition",
  "tradeReason",
  "session",
  "confidence",
  "emotion",
  "discipline",
  "lesson",
  "notes",
] as const;

export interface JsonHandlerInput {
  token: string | null;
  body: unknown;
  /** Message from the route's JSON parse step, when it failed. */
  bodyError?: string | null;
}

async function beginJsonHandler(
  input: JsonHandlerInput,
  deps: ApiDeps,
  ctx: HandlerContext,
  allowedKeys: readonly string[],
): Promise<
  | { ok: true; userId: string; supabase: SupabaseClient; body: Record<string, unknown> }
  | { ok: false; response: ApiHandlerResult }
> {
  const gate = await requireApiAuth(input.token, deps, ctx);
  if (!gate.ok) return { ok: false, response: gate.response };
  const { userId, supabase } = gate.auth;

  if (input.bodyError) {
    return {
      ok: false,
      response: await finish(deps, ctx, userId, "invalid_argument", null,
        apiError(400, "invalid_argument", input.bodyError)),
    };
  }
  const validated = validateBody(input.body, allowedKeys);
  if (!validated.ok) {
    return {
      ok: false,
      response: await finish(deps, ctx, userId, "invalid_argument", null, validated.response),
    };
  }
  const limited = checkApiRateLimit(deps, ctx, userId);
  if (limited) {
    return {
      ok: false,
      response: await finish(deps, ctx, userId, "rate_limited", null, limited),
    };
  }
  return { ok: true, userId, supabase, body: validated.body };
}

/* ------------------------------------------------------------- create */

const CREATE_CTX: HandlerContext = { operation: "trade_created", entityType: "trades" };

export async function handleCreateTrade(
  input: JsonHandlerInput,
  deps: ApiDeps,
): Promise<ApiHandlerResult> {
  const begun = await beginJsonHandler(input, deps, CREATE_CTX, QUICK_TRADE_KEYS);
  if (!begun.ok) return begun.response;
  let result: Awaited<ReturnType<typeof createTradeCore>>;
  try {
    result = await createTradeCore(begun.supabase, begun.userId, begun.body);
  } catch {
    return finish(deps, CREATE_CTX, begun.userId, "error", null, apiError(500, "internal"));
  }
  if (!result.ok) {
    const { response, outcome } = coreFailureResponse(result);
    return finish(deps, CREATE_CTX, begun.userId, outcome, null, response);
  }
  return finish(deps, CREATE_CTX, begun.userId, "ok", result.trade.id,
    apiOk({ trade: result.trade }, 201));
}

/* ------------------------------------------------------------- review */

const REVIEW_CTX: HandlerContext = { operation: "trade_review_saved", entityType: "trades" };

export async function handleSaveTradeReview(
  input: JsonHandlerInput & { tradeId: string },
  deps: ApiDeps,
): Promise<ApiHandlerResult> {
  const begun = await beginJsonHandler(input, deps, REVIEW_CTX, REVIEW_KEYS);
  if (!begun.ok) return begun.response;
  if (!isUuid(input.tradeId)) {
    return finish(deps, REVIEW_CTX, begun.userId, "invalid_argument", null,
      apiError(400, "invalid_argument", "trade id must be a valid UUID"));
  }
  let result: Awaited<ReturnType<typeof saveAdvancedReviewCore>>;
  try {
    result = await saveAdvancedReviewCore(begun.supabase, begun.userId, {
      ...begun.body,
      tradeId: input.tradeId,
    });
  } catch {
    return finish(deps, REVIEW_CTX, begun.userId, "error", null, apiError(500, "internal"));
  }
  if (!result.ok) {
    const { response, outcome } = coreFailureResponse(result);
    return finish(deps, REVIEW_CTX, begun.userId, outcome, input.tradeId, response);
  }
  return finish(deps, REVIEW_CTX, begun.userId, "ok", result.tradeId,
    apiOk({ trade_id: result.tradeId }));
}

/* ------------------------------------------------------------ correct */

const CORRECT_CTX: HandlerContext = { operation: "trade_corrected", entityType: "trades" };

export async function handleCorrectTrade(
  input: JsonHandlerInput & { tradeId: string },
  deps: ApiDeps,
): Promise<ApiHandlerResult> {
  const begun = await beginJsonHandler(input, deps, CORRECT_CTX, QUICK_TRADE_KEYS);
  if (!begun.ok) return begun.response;
  if (!isUuid(input.tradeId)) {
    return finish(deps, CORRECT_CTX, begun.userId, "invalid_argument", null,
      apiError(400, "invalid_argument", "trade id must be a valid UUID"));
  }
  let result: Awaited<ReturnType<typeof correctTradeCore>>;
  try {
    result = await correctTradeCore(begun.supabase, begun.userId, input.tradeId, begun.body);
  } catch {
    return finish(deps, CORRECT_CTX, begun.userId, "error", null, apiError(500, "internal"));
  }
  if (!result.ok) {
    const { response, outcome } = coreFailureResponse(result);
    return finish(deps, CORRECT_CTX, begun.userId, outcome, input.tradeId, response);
  }
  return finish(deps, CORRECT_CTX, begun.userId, "ok", result.tradeId,
    apiOk({ trade_id: result.tradeId, reversed_trade_id: result.reversedTradeId }, 201));
}

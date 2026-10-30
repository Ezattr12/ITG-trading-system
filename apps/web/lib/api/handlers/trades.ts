import type { SupabaseClient } from "@supabase/supabase-js";
import {
  apiError,
  apiOk,
  isUuid,
  type ApiDeps,
  type ApiHandlerResult,
} from "@/lib/api/auth";
import {
  cancelTradeCore,
  correctTradeCore,
  createTradeCore,
  deleteScreenshotCore,
  saveAdvancedReviewCore,
  uploadScreenshotCore,
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

/* ------------------------------------------- cancel (Phase 21, M2) */

const CANCEL_CTX: HandlerContext = { operation: "trade_cancelled", entityType: "trades" };

/**
 * POST /api/mobile/trades/[id]/cancel — cancel an OPEN
 * trade via cancelTradeCore. The body is optional (the
 * route's lenient parse turns a bodiless POST into {}), but
 * when sent it must be empty: any key is a smuggled identity
 * field or unknown.
 */
export async function handleCancelTrade(
  input: JsonHandlerInput & { tradeId: string },
  deps: ApiDeps,
): Promise<ApiHandlerResult> {
  const gate = await requireApiAuth(input.token, deps, CANCEL_CTX);
  if (!gate.ok) return gate.response;
  const { userId, supabase } = gate.auth;

  if (input.bodyError) {
    return finish(deps, CANCEL_CTX, userId, "invalid_argument", null,
      apiError(400, "invalid_argument", input.bodyError));
  }
  const validated = validateBody(input.body ?? {}, []);
  if (!validated.ok) {
    return finish(deps, CANCEL_CTX, userId, "invalid_argument", null, validated.response);
  }
  if (!isUuid(input.tradeId)) {
    return finish(deps, CANCEL_CTX, userId, "invalid_argument", null,
      apiError(400, "invalid_argument", "trade id must be a valid UUID"));
  }
  const limited = checkApiRateLimit(deps, CANCEL_CTX, userId);
  if (limited) {
    return finish(deps, CANCEL_CTX, userId, "rate_limited", null, limited);
  }
  let result: Awaited<ReturnType<typeof cancelTradeCore>>;
  try {
    result = await cancelTradeCore(supabase, userId, input.tradeId);
  } catch {
    return finish(deps, CANCEL_CTX, userId, "error", null, apiError(500, "internal"));
  }
  if (!result.ok) {
    const { response, outcome } = coreFailureResponse(result);
    return finish(deps, CANCEL_CTX, userId, outcome, input.tradeId, response);
  }
  return finish(deps, CANCEL_CTX, userId, "ok", result.tradeId,
    apiOk({ trade_id: result.tradeId, status: result.status }));
}

/* --------------------------------------- screenshots (Phase 21, M2) */

const SCREENSHOT_UPLOAD_CTX: HandlerContext = {
  operation: "trade_screenshot_uploaded",
  entityType: "trade_screenshots",
};

export interface ScreenshotUploadInput {
  token: string | null;
  tradeId: string;
  /** The multipart `file` part, or null when absent/not a file. */
  file: File | null;
  /** Set by the route when the multipart body itself is unreadable. */
  formError?: string | null;
}

/**
 * POST /api/mobile/trades/[id]/screenshots (multipart) —
 * upload via uploadScreenshotCore: same private bucket,
 * path, validation and upload rate limit as the web. The
 * API-layer rate limit is deliberately NOT applied here —
 * the core's upload limiter is the operation's one limiter
 * (the M1 split: exactly one limiter per operation).
 */
export async function handleUploadScreenshot(
  input: ScreenshotUploadInput,
  deps: ApiDeps,
): Promise<ApiHandlerResult> {
  const gate = await requireApiAuth(input.token, deps, SCREENSHOT_UPLOAD_CTX);
  if (!gate.ok) return gate.response;
  const { userId, supabase } = gate.auth;

  if (input.formError) {
    return finish(deps, SCREENSHOT_UPLOAD_CTX, userId, "invalid_argument", null,
      apiError(400, "invalid_argument", input.formError));
  }
  if (!isUuid(input.tradeId)) {
    return finish(deps, SCREENSHOT_UPLOAD_CTX, userId, "invalid_argument", null,
      apiError(400, "invalid_argument", "trade id must be a valid UUID"));
  }
  let result: Awaited<ReturnType<typeof uploadScreenshotCore>>;
  try {
    result = await uploadScreenshotCore(supabase, userId, input.tradeId, input.file);
  } catch {
    return finish(deps, SCREENSHOT_UPLOAD_CTX, userId, "error", null, apiError(500, "internal"));
  }
  if (!result.ok) {
    const { response, outcome } = coreFailureResponse(result);
    return finish(deps, SCREENSHOT_UPLOAD_CTX, userId, outcome, input.tradeId, response);
  }
  return finish(deps, SCREENSHOT_UPLOAD_CTX, userId, "ok", result.screenshotId,
    apiOk({ screenshot_id: result.screenshotId }, 201));
}

const SCREENSHOT_DELETE_CTX: HandlerContext = {
  operation: "trade_screenshot_deleted",
  entityType: "trade_screenshots",
};

/**
 * DELETE /api/mobile/trades/[id]/screenshots/[screenshotId]
 * — delete via deleteScreenshotCore. A screenshot id that
 * is another trader's (or belongs to a different trade) is
 * the identical 404 as a nonexistent one.
 */
export async function handleDeleteScreenshot(
  input: { token: string | null; tradeId: string; screenshotId: string },
  deps: ApiDeps,
): Promise<ApiHandlerResult> {
  const gate = await requireApiAuth(input.token, deps, SCREENSHOT_DELETE_CTX);
  if (!gate.ok) return gate.response;
  const { userId, supabase } = gate.auth;

  if (!isUuid(input.tradeId) || !isUuid(input.screenshotId)) {
    return finish(deps, SCREENSHOT_DELETE_CTX, userId, "invalid_argument", null,
      apiError(400, "invalid_argument", "trade and screenshot ids must be valid UUIDs"));
  }
  const limited = checkApiRateLimit(deps, SCREENSHOT_DELETE_CTX, userId);
  if (limited) {
    return finish(deps, SCREENSHOT_DELETE_CTX, userId, "rate_limited", null, limited);
  }
  let result: Awaited<ReturnType<typeof deleteScreenshotCore>>;
  try {
    result = await deleteScreenshotCore(supabase, userId, input.screenshotId, input.tradeId);
  } catch {
    return finish(deps, SCREENSHOT_DELETE_CTX, userId, "error", null, apiError(500, "internal"));
  }
  if (!result.ok) {
    const { response, outcome } = coreFailureResponse(result);
    return finish(deps, SCREENSHOT_DELETE_CTX, userId, outcome, input.screenshotId, response);
  }
  return finish(deps, SCREENSHOT_DELETE_CTX, userId, "ok", result.screenshotId,
    apiOk({ ok: true }));
}

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
  deleteTradeCore,
  editTradeCore,
  saveAdvancedReviewCore,
  uploadScreenshotCore,
  type EditTradeInput,
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

/* -------------------------------------------------------------- edit */

/** Edit body sections: { correction, review } — the same two field sets as the parts. */
const EDIT_KEYS = ["correction", "review"] as const;

const EDIT_CTX: HandlerContext = { operation: "trade_edited", entityType: "trades" };

/**
 * POST /api/mobile/trades/[id]/edit — Edit Trade: one
 * full-form save carrying both field sets, orchestrated by
 * editTradeCore (the same core the web edit action calls).
 * The envelope keys are exactly `correction` and `review`;
 * each section is then held to the strict body rules on its
 * own (identity fields and unknown keys are 400s naming the
 * field, exactly as on the flat endpoints). Both sections
 * are required — an edit is a full-form save, like the
 * review endpoint's round-trip rule.
 *
 * Status mapping follows the two endpoints it composes: a
 * financial edit creates a correcting trade, so it answers
 * 201 like handleCorrectTrade; a journal-only edit updates
 * in place and a no-change edit writes nothing — both answer
 * 200 like handleSaveTradeReview.
 */
export async function handleEditTrade(
  input: JsonHandlerInput & { tradeId: string },
  deps: ApiDeps,
): Promise<ApiHandlerResult> {
  const gate = await requireApiAuth(input.token, deps, EDIT_CTX);
  if (!gate.ok) return gate.response;
  const { userId, supabase } = gate.auth;

  if (input.bodyError) {
    return finish(deps, EDIT_CTX, userId, "invalid_argument", null,
      apiError(400, "invalid_argument", input.bodyError));
  }
  const envelope = validateBody(input.body, EDIT_KEYS);
  if (!envelope.ok) {
    return finish(deps, EDIT_CTX, userId, "invalid_argument", null, envelope.response);
  }
  const correctionRaw = envelope.body.correction;
  const reviewRaw = envelope.body.review;
  if (correctionRaw === undefined || reviewRaw === undefined) {
    return finish(deps, EDIT_CTX, userId, "invalid_argument", null,
      apiError(400, "invalid_argument", "correction and review are both required"));
  }
  const correctionCheck = validateBody(correctionRaw, QUICK_TRADE_KEYS);
  if (!correctionCheck.ok) {
    return finish(deps, EDIT_CTX, userId, "invalid_argument", null, correctionCheck.response);
  }
  const reviewCheck = validateBody(reviewRaw, REVIEW_KEYS);
  if (!reviewCheck.ok) {
    return finish(deps, EDIT_CTX, userId, "invalid_argument", null, reviewCheck.response);
  }
  if (!isUuid(input.tradeId)) {
    return finish(deps, EDIT_CTX, userId, "invalid_argument", null,
      apiError(400, "invalid_argument", "trade id must be a valid UUID"));
  }
  const limited = checkApiRateLimit(deps, EDIT_CTX, userId);
  if (limited) {
    return finish(deps, EDIT_CTX, userId, "rate_limited", null, limited);
  }
  let result: Awaited<ReturnType<typeof editTradeCore>>;
  try {
    // The sections were shape-checked above; editTradeCore
    // re-validates both with the Zod schemas (the validation
    // source of truth) before diffing or writing anything.
    result = await editTradeCore(supabase, userId, input.tradeId, {
      correction: correctionCheck.body,
      review: reviewCheck.body,
    } as EditTradeInput);
  } catch {
    return finish(deps, EDIT_CTX, userId, "error", null, apiError(500, "internal"));
  }
  if (!result.ok) {
    const { response, outcome } = coreFailureResponse(result);
    return finish(deps, EDIT_CTX, userId, outcome, input.tradeId, response);
  }
  return finish(deps, EDIT_CTX, userId, "ok", result.tradeId,
    apiOk(
      {
        trade_id: result.tradeId,
        reversed_trade_id: result.reversedTradeId,
        changed_fields: result.changedFields,
        financial_changed: result.financialChanged,
        journal_changed: result.journalChanged,
      },
      result.financialChanged ? 201 : 200,
    ));
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

/* ------------------------------------------- delete (Delete Trade) */

const DELETE_CTX: HandlerContext = { operation: "trade_deleted", entityType: "trades" };

/** The only body key a delete may carry: the optional reason. */
const DELETE_KEYS = ["reason"] as const;

/**
 * POST /api/mobile/trades/[id]/delete — remove a trade via
 * deleteTradeCore (the same core the web delete action
 * calls): an open trade is cancelled, a closed trade is
 * annulled by reversal, nothing is hard-deleted. The body
 * is optional (the route's lenient parse turns a bodiless
 * POST into {}); when sent it may carry only `reason`, held
 * to the strict pipeline like every other key — and the
 * core validates the reason against its enum, so an invalid
 * value is a 400 with the core's message. A repeat delete
 * answers 200 with already_removed: true (idempotent, no
 * duplicate audit rows in the core).
 */
export async function handleDeleteTrade(
  input: JsonHandlerInput & { tradeId: string },
  deps: ApiDeps,
): Promise<ApiHandlerResult> {
  const gate = await requireApiAuth(input.token, deps, DELETE_CTX);
  if (!gate.ok) return gate.response;
  const { userId, supabase } = gate.auth;

  if (input.bodyError) {
    return finish(deps, DELETE_CTX, userId, "invalid_argument", null,
      apiError(400, "invalid_argument", input.bodyError));
  }
  const validated = validateBody(input.body ?? {}, DELETE_KEYS);
  if (!validated.ok) {
    return finish(deps, DELETE_CTX, userId, "invalid_argument", null, validated.response);
  }
  if (!isUuid(input.tradeId)) {
    return finish(deps, DELETE_CTX, userId, "invalid_argument", null,
      apiError(400, "invalid_argument", "trade id must be a valid UUID"));
  }
  const limited = checkApiRateLimit(deps, DELETE_CTX, userId);
  if (limited) {
    return finish(deps, DELETE_CTX, userId, "rate_limited", null, limited);
  }
  let result: Awaited<ReturnType<typeof deleteTradeCore>>;
  try {
    result = await deleteTradeCore(supabase, userId, input.tradeId, {
      // Passed through verbatim: the core refuses any
      // non-null value outside its reason enum (including a
      // non-string) as invalid_input.
      reason: (validated.body.reason ?? null) as string | null,
    });
  } catch {
    return finish(deps, DELETE_CTX, userId, "error", null, apiError(500, "internal"));
  }
  if (!result.ok) {
    const { response, outcome } = coreFailureResponse(result);
    return finish(deps, DELETE_CTX, userId, outcome, input.tradeId, response);
  }
  return finish(deps, DELETE_CTX, userId, "ok", result.tradeId,
    apiOk({
      trade_id: result.tradeId,
      previous_status: result.previousStatus,
      already_removed: result.alreadyRemoved,
    }));
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

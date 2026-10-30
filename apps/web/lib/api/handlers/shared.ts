import {
  apiError,
  authenticateApiToken,
  rejectIdentityFields,
  rejectUnknownKeys,
  API_WRITE_RATE_LIMIT,
  type ApiAuth,
  type ApiDeps,
  type ApiHandlerResult,
} from "@/lib/api/auth";
import type { CoreFailure } from "@/lib/trades/service";

/**
 * Shared plumbing for the mobile write handlers (Phase 21,
 * M1). Each handler is a pure function of
 * `{ token, body, … } + deps` so the full contract is
 * unit-testable without a Next.js request (Phase 20 style).
 *
 * Every handler follows the same pipeline, and every exit
 * writes exactly one API-layer audit row
 * (`api.mobile.<operation>`, outcome in details) via
 * deps.auditApi — mirroring the Phase 20 endpoint's
 * one-row-per-call rule. The cores additionally write the
 * operation's own audit rows (trade.created, …), exactly
 * as they did for the web actions.
 *
 * Pipeline: authenticate (401) → body well-formed (400) →
 * no smuggled identity fields (400, naming the field) →
 * no unknown keys (400, naming the key) → path ids are
 * UUIDs (400) → per-user API rate limit (429) → service
 * core (400 Zod / 404 / 422 / 429 by core code) → success.
 */

export interface HandlerContext {
  /** Stored as `api.mobile.<operation>`. */
  operation: string;
  entityType: string;
}

export type AuthGate =
  | { ok: true; auth: Extract<ApiAuth, { ok: true }> }
  | { ok: false; response: ApiHandlerResult };

/** Authenticate, auditing the 401 exit. Returns the gate. */
export async function requireApiAuth(
  token: string | null,
  deps: ApiDeps,
  ctx: HandlerContext,
): Promise<AuthGate> {
  const auth = await authenticateApiToken(token, deps).catch(
    (): ApiAuth => ({ ok: false, status: 401, error: "unauthenticated" }),
  );
  if (!auth.ok) {
    await deps.auditApi({
      userId: null,
      operation: ctx.operation,
      entityType: ctx.entityType,
      entityId: null,
      outcome: "unauthenticated",
    });
    return { ok: false, response: apiError(401, "unauthenticated") };
  }
  return { ok: true, auth };
}

/** Audit one call outcome, then return the prepared response. */
export async function finish(
  deps: ApiDeps,
  ctx: HandlerContext,
  userId: string | null,
  outcome: string,
  entityId: string | null,
  response: ApiHandlerResult,
): Promise<ApiHandlerResult> {
  await deps.auditApi({
    userId,
    operation: ctx.operation,
    entityType: ctx.entityType,
    entityId,
    outcome,
  });
  return response;
}

/**
 * Validate the parsed JSON body: must be an object (the
 * route's parse step guarantees this for real requests;
 * handlers re-check for direct callers), must not carry
 * identity fields, must not carry unknown keys. Returns an
 * error response (not yet audited) or the body as a record.
 */
export function validateBody(
  body: unknown,
  allowedKeys: readonly string[],
): { ok: true; body: Record<string, unknown> } | { ok: false; response: ApiHandlerResult } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      response: apiError(400, "invalid_argument", "request body must be a JSON object"),
    };
  }
  const record = body as Record<string, unknown>;
  const identityKey = rejectIdentityFields(record);
  if (identityKey) {
    return {
      ok: false,
      response: apiError(
        400,
        "invalid_argument",
        `identity field not allowed: ${identityKey} — the trader is identified by the access token`,
      ),
    };
  }
  const unknownKey = rejectUnknownKeys(record, allowedKeys);
  if (unknownKey) {
    return {
      ok: false,
      response: apiError(400, "invalid_argument", `unknown field: ${unknownKey}`),
    };
  }
  return { ok: true, body: record };
}

/** API-layer per-user write rate limit for one operation. */
export function checkApiRateLimit(
  deps: ApiDeps,
  ctx: HandlerContext,
  userId: string,
): ApiHandlerResult | null {
  const rate = deps.rateLimit(`api-mobile:${ctx.operation}:${userId}`, API_WRITE_RATE_LIMIT);
  if (rate.allowed) return null;
  return apiError(
    429,
    "rate_limited",
    `Too many requests. Try again in ${rate.retryAfterSeconds} seconds.`,
  );
}

/** Map a core failure to the API response (see docs/phase-21-m1.md §3). */
export function coreFailureResponse(failure: CoreFailure): {
  response: ApiHandlerResult;
  outcome: string;
} {
  switch (failure.code) {
    case "invalid_input":
      return {
        response: apiError(400, "invalid_argument", failure.error),
        outcome: "invalid_argument",
      };
    case "rate_limited":
      return {
        response: apiError(429, "rate_limited", failure.error),
        outcome: "rate_limited",
      };
    case "not_found":
      // Identical for missing and for another trader's row —
      // no existence oracle, and the core's message is not leaked.
      return { response: apiError(404, "not_found"), outcome: "not_found" };
    case "business":
    case "save_failed":
      return {
        response: apiError(422, "validation_failed", failure.error),
        outcome: "validation_failed",
      };
  }
}

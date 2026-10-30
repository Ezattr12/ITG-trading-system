import {
  apiError,
  apiOk,
  type ApiDeps,
  type ApiHandlerResult,
} from "@/lib/api/auth";
import { saveWeeklyReviewCore } from "@/lib/reviews/service";
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
 * Mobile weekly-review handler (Phase 21, M2), on the M1
 * pipeline. All logic lives in saveWeeklyReviewCore
 * (lib/reviews/service.ts) — the aggregates, the +30 XP and
 * its per-review idempotency are the web action's existing
 * behaviour, reached unchanged through the core.
 */

/** weeklyReviewSchema fields (lib/reviews/validation.ts). */
const WEEKLY_REVIEW_KEYS = [
  "weekStartDate",
  "reviewText",
  "mainMistake",
  "focusNextWeek",
] as const;

const WEEKLY_REVIEW_CTX: HandlerContext = {
  operation: "weekly_review_saved",
  entityType: "weekly_reviews",
};

export async function handleSaveWeeklyReview(
  input: JsonHandlerInput,
  deps: ApiDeps,
): Promise<ApiHandlerResult> {
  const gate = await requireApiAuth(input.token, deps, WEEKLY_REVIEW_CTX);
  if (!gate.ok) return gate.response;
  const { userId, supabase } = gate.auth;

  if (input.bodyError) {
    return finish(deps, WEEKLY_REVIEW_CTX, userId, "invalid_argument", null,
      apiError(400, "invalid_argument", input.bodyError));
  }
  const validated = validateBody(input.body, WEEKLY_REVIEW_KEYS);
  if (!validated.ok) {
    return finish(deps, WEEKLY_REVIEW_CTX, userId, "invalid_argument", null, validated.response);
  }
  const limited = checkApiRateLimit(deps, WEEKLY_REVIEW_CTX, userId);
  if (limited) {
    return finish(deps, WEEKLY_REVIEW_CTX, userId, "rate_limited", null, limited);
  }
  let result: Awaited<ReturnType<typeof saveWeeklyReviewCore>>;
  try {
    result = await saveWeeklyReviewCore(supabase, userId, validated.body);
  } catch {
    return finish(deps, WEEKLY_REVIEW_CTX, userId, "error", null, apiError(500, "internal"));
  }
  if (!result.ok) {
    const { response, outcome } = coreFailureResponse(result);
    return finish(deps, WEEKLY_REVIEW_CTX, userId, outcome, null, response);
  }
  return finish(deps, WEEKLY_REVIEW_CTX, userId, "ok", result.reviewId,
    apiOk({ review_id: result.reviewId, xp_awarded: result.xpAwarded }));
}

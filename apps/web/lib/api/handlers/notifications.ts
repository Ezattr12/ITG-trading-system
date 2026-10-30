import {
  apiError,
  apiOk,
  type ApiDeps,
  type ApiHandlerResult,
} from "@/lib/api/auth";
import {
  markAllNotificationsReadCore,
  markNotificationReadCore,
} from "@/lib/discipline/service";
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
 * Mobile notification read handler (Phase 21, M2), on the
 * M1 pipeline. Exactly one target per call: `{ notification_id }`
 * marks one of the caller's notifications read (another
 * trader's id is the identical 404 as a nonexistent one),
 * `{ all: true }` marks all of the caller's. Both keys or
 * neither is a 400 — the request must say what it means.
 */

const NOTIFICATION_KEYS = ["notification_id", "all"] as const;

const NOTIFICATIONS_CTX: HandlerContext = {
  operation: "notifications_read",
  entityType: "notifications",
};

export async function handleMarkNotificationsRead(
  input: JsonHandlerInput,
  deps: ApiDeps,
): Promise<ApiHandlerResult> {
  const gate = await requireApiAuth(input.token, deps, NOTIFICATIONS_CTX);
  if (!gate.ok) return gate.response;
  const { userId, supabase } = gate.auth;

  if (input.bodyError) {
    return finish(deps, NOTIFICATIONS_CTX, userId, "invalid_argument", null,
      apiError(400, "invalid_argument", input.bodyError));
  }
  const validated = validateBody(input.body, NOTIFICATION_KEYS);
  if (!validated.ok) {
    return finish(deps, NOTIFICATIONS_CTX, userId, "invalid_argument", null, validated.response);
  }
  const hasOne = "notification_id" in validated.body;
  const hasAll = "all" in validated.body;
  if (hasOne === hasAll) {
    return finish(deps, NOTIFICATIONS_CTX, userId, "invalid_argument", null,
      apiError(
        400,
        "invalid_argument",
        "send exactly one of 'notification_id' or 'all: true'",
      ));
  }
  if (hasAll && validated.body.all !== true) {
    return finish(deps, NOTIFICATIONS_CTX, userId, "invalid_argument", null,
      apiError(400, "invalid_argument", "'all' must be true when present"));
  }
  if (hasOne && typeof validated.body.notification_id !== "string") {
    return finish(deps, NOTIFICATIONS_CTX, userId, "invalid_argument", null,
      apiError(400, "invalid_argument", "'notification_id' must be a string"));
  }
  const limited = checkApiRateLimit(deps, NOTIFICATIONS_CTX, userId);
  if (limited) {
    return finish(deps, NOTIFICATIONS_CTX, userId, "rate_limited", null, limited);
  }

  let result: Awaited<ReturnType<typeof markNotificationReadCore>>;
  try {
    result = hasOne
      ? await markNotificationReadCore(
          supabase,
          userId,
          validated.body.notification_id as string,
        )
      : await markAllNotificationsReadCore(supabase, userId);
  } catch {
    return finish(deps, NOTIFICATIONS_CTX, userId, "error", null, apiError(500, "internal"));
  }
  if (!result.ok) {
    const { response, outcome } = coreFailureResponse(result);
    return finish(deps, NOTIFICATIONS_CTX, userId, outcome, null, response);
  }
  return finish(deps, NOTIFICATIONS_CTX, userId, "ok", null,
    apiOk({ updated: result.updated }));
}

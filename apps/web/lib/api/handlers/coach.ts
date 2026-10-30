import {
  apiError,
  apiOk,
  type ApiDeps,
  type ApiHandlerResult,
} from "@/lib/api/auth";
import { logBacktestingCore } from "@/lib/coach/service";
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
 * Mobile backtesting handler (Phase 21, M2), on the M1
 * pipeline. All logic lives in logBacktestingCore
 * (lib/coach/service.ts): the day's total sessions are
 * upserted and +15 XP per session is awarded through the
 * existing deterministic-UUID idempotency path — a repeat
 * submission awards nothing new.
 */

/** backtestingSchema fields (lib/coach/validation.ts). */
const BACKTESTING_KEYS = ["activityDate", "sessions"] as const;

const BACKTESTING_CTX: HandlerContext = {
  operation: "backtesting_logged",
  entityType: "daily_activity",
};

export async function handleLogBacktesting(
  input: JsonHandlerInput,
  deps: ApiDeps,
): Promise<ApiHandlerResult> {
  const gate = await requireApiAuth(input.token, deps, BACKTESTING_CTX);
  if (!gate.ok) return gate.response;
  const { userId, supabase } = gate.auth;

  if (input.bodyError) {
    return finish(deps, BACKTESTING_CTX, userId, "invalid_argument", null,
      apiError(400, "invalid_argument", input.bodyError));
  }
  const validated = validateBody(input.body, BACKTESTING_KEYS);
  if (!validated.ok) {
    return finish(deps, BACKTESTING_CTX, userId, "invalid_argument", null, validated.response);
  }
  const limited = checkApiRateLimit(deps, BACKTESTING_CTX, userId);
  if (limited) {
    return finish(deps, BACKTESTING_CTX, userId, "rate_limited", null, limited);
  }
  let result: Awaited<ReturnType<typeof logBacktestingCore>>;
  try {
    result = await logBacktestingCore(supabase, userId, validated.body);
  } catch {
    return finish(deps, BACKTESTING_CTX, userId, "error", null, apiError(500, "internal"));
  }
  if (!result.ok) {
    const { response, outcome } = coreFailureResponse(result);
    return finish(deps, BACKTESTING_CTX, userId, outcome, null, response);
  }
  return finish(deps, BACKTESTING_CTX, userId, "ok", null,
    apiOk({
      sessions: result.sessions,
      sessions_awarded: result.sessionsAwarded,
      xp_awarded: result.xpAwarded,
    }));
}

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  apiError,
  apiOk,
  isUuid,
  type ApiDeps,
  type ApiHandlerResult,
} from "@/lib/api/auth";
import {
  createGoalCore,
  recordGoalProgressCore,
  updateGoalStatusCore,
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
 * Mobile goal handlers (Phase 21, M1): create / record
 * progress / update status. All logic lives in
 * lib/discipline/service.ts — the same cores the web goal
 * actions call (including the completion XP + notification
 * side effects).
 */

/** goalSchema fields (lib/discipline/validation.ts). */
const GOAL_KEYS = [
  "title",
  "period",
  "goalType",
  "targetValue",
  "targetUnit",
  "startDate",
  "endDate",
] as const;

/** goalProgressSchema fields, minus goalId (path-carried here). */
const PROGRESS_KEYS = ["currentValue", "note"] as const;

/** goalStatusSchema fields, minus goalId (path-carried here). */
const STATUS_KEYS = ["status"] as const;

async function begin(
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

const CREATE_CTX: HandlerContext = { operation: "goal_created", entityType: "goals" };

export async function handleCreateGoal(
  input: JsonHandlerInput,
  deps: ApiDeps,
): Promise<ApiHandlerResult> {
  const begun = await begin(input, deps, CREATE_CTX, GOAL_KEYS);
  if (!begun.ok) return begun.response;
  let result: Awaited<ReturnType<typeof createGoalCore>>;
  try {
    result = await createGoalCore(begun.supabase, begun.userId, begun.body);
  } catch {
    return finish(deps, CREATE_CTX, begun.userId, "error", null, apiError(500, "internal"));
  }
  if (!result.ok) {
    const { response, outcome } = coreFailureResponse(result);
    return finish(deps, CREATE_CTX, begun.userId, outcome, null, response);
  }
  return finish(deps, CREATE_CTX, begun.userId, "ok", result.goal.id,
    apiOk({ goal: result.goal }, 201));
}

/* ----------------------------------------------------------- progress */

const PROGRESS_CTX: HandlerContext = { operation: "goal_progress_recorded", entityType: "goals" };

export async function handleRecordGoalProgress(
  input: JsonHandlerInput & { goalId: string },
  deps: ApiDeps,
): Promise<ApiHandlerResult> {
  const begun = await begin(input, deps, PROGRESS_CTX, PROGRESS_KEYS);
  if (!begun.ok) return begun.response;
  if (!isUuid(input.goalId)) {
    return finish(deps, PROGRESS_CTX, begun.userId, "invalid_argument", null,
      apiError(400, "invalid_argument", "goal id must be a valid UUID"));
  }
  let result: Awaited<ReturnType<typeof recordGoalProgressCore>>;
  try {
    result = await recordGoalProgressCore(begun.supabase, begun.userId, {
      ...begun.body,
      goalId: input.goalId,
    });
  } catch {
    return finish(deps, PROGRESS_CTX, begun.userId, "error", null, apiError(500, "internal"));
  }
  if (!result.ok) {
    const { response, outcome } = coreFailureResponse(result);
    return finish(deps, PROGRESS_CTX, begun.userId, outcome, input.goalId, response);
  }
  return finish(deps, PROGRESS_CTX, begun.userId, "ok", result.goalId,
    apiOk({ goal_id: result.goalId, current_value: result.currentValue }));
}

/* ------------------------------------------------------------- status */

const STATUS_CTX: HandlerContext = { operation: "goal_status_updated", entityType: "goals" };

export async function handleUpdateGoalStatus(
  input: JsonHandlerInput & { goalId: string },
  deps: ApiDeps,
): Promise<ApiHandlerResult> {
  const begun = await begin(input, deps, STATUS_CTX, STATUS_KEYS);
  if (!begun.ok) return begun.response;
  if (!isUuid(input.goalId)) {
    return finish(deps, STATUS_CTX, begun.userId, "invalid_argument", null,
      apiError(400, "invalid_argument", "goal id must be a valid UUID"));
  }
  let result: Awaited<ReturnType<typeof updateGoalStatusCore>>;
  try {
    result = await updateGoalStatusCore(begun.supabase, begun.userId, {
      ...begun.body,
      goalId: input.goalId,
    });
  } catch {
    return finish(deps, STATUS_CTX, begun.userId, "error", null, apiError(500, "internal"));
  }
  if (!result.ok) {
    const { response, outcome } = coreFailureResponse(result);
    return finish(deps, STATUS_CTX, begun.userId, outcome, input.goalId, response);
  }
  return finish(deps, STATUS_CTX, begun.userId, "ok", result.goalId,
    apiOk({ goal_id: result.goalId, status: result.status }));
}

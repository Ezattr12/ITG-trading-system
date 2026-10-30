import {
  createDefaultApiDeps,
  extractBearerToken,
  parseJsonBody,
  toJsonResponse,
} from "@/lib/api/auth";
import { handleUpdateGoalStatus } from "@/lib/api/handlers/goals";

/**
 * PATCH /api/mobile/goals/[id] (Phase 21, M1)
 *
 * Mobile goal status update. Thin adapter over
 * handleUpdateGoalStatus → updateGoalStatusCore (the
 * same core the web status action uses, including the
 * completion XP + notification side effects).
 */
export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = await parseJsonBody(request);
  const result = await handleUpdateGoalStatus(
    {
      token: extractBearerToken(request),
      body: parsed.ok ? parsed.value : null,
      bodyError: parsed.ok
        ? null
        : String(parsed.result.body.message ?? "invalid request body"),
      goalId: id,
    },
    createDefaultApiDeps(),
  );
  return toJsonResponse(result);
}

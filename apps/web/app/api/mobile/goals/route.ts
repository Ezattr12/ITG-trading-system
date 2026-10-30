import {
  createDefaultApiDeps,
  extractBearerToken,
  parseJsonBody,
  toJsonResponse,
} from "@/lib/api/auth";
import { handleCreateGoal } from "@/lib/api/handlers/goals";

/**
 * POST /api/mobile/goals (Phase 21, M1)
 *
 * Mobile goal creation. Thin adapter over
 * handleCreateGoal → createGoalCore (the same core the
 * web goal action uses).
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request);
  const result = await handleCreateGoal(
    {
      token: extractBearerToken(request),
      body: parsed.ok ? parsed.value : null,
      bodyError: parsed.ok
        ? null
        : String(parsed.result.body.message ?? "invalid request body"),
    },
    createDefaultApiDeps(),
  );
  return toJsonResponse(result);
}

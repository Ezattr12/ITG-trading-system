import {
  createDefaultApiDeps,
  extractBearerToken,
  parseJsonBody,
  toJsonResponse,
} from "@/lib/api/auth";
import { handleRecordGoalProgress } from "@/lib/api/handlers/goals";

/**
 * POST /api/mobile/goals/[id]/progress (Phase 21, M1)
 *
 * Mobile goal progress recording. Thin adapter over
 * handleRecordGoalProgress → recordGoalProgressCore (the
 * same core the web progress action uses).
 */
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = await parseJsonBody(request);
  const result = await handleRecordGoalProgress(
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

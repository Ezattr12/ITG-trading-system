import {
  createDefaultApiDeps,
  extractBearerToken,
  parseJsonBody,
  toJsonResponse,
} from "@/lib/api/auth";
import { handleSaveWeeklyReview } from "@/lib/api/handlers/reviews";

/**
 * POST /api/mobile/reviews/weekly (Phase 21, M2)
 *
 * Thin adapter over handleSaveWeeklyReview — the write runs
 * saveWeeklyReviewCore, the same core as the web weekly
 * review action (aggregates + idempotent +30 XP included).
 * See docs/phase-21-m2.md.
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request);
  const result = await handleSaveWeeklyReview(
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

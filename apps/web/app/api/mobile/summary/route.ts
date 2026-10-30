import {
  createDefaultApiDeps,
  extractBearerToken,
  toJsonResponse,
} from "@/lib/api/auth";
import { handleSummaryRead } from "@/lib/api/handlers/summary";

/**
 * GET /api/mobile/summary?range=week|month (Phase 21, M2)
 *
 * The mobile API's one read endpoint: the current week's
 * or month's report summary, computed server-side by
 * getReportSummary with the caller's token client. Thin
 * adapter over handleSummaryRead. See docs/phase-21-m2.md.
 */
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const result = await handleSummaryRead(
    {
      token: extractBearerToken(request),
      rangeParam: url.searchParams.get("range"),
      queryKeys: [...url.searchParams.keys()],
    },
    createDefaultApiDeps(),
  );
  return toJsonResponse(result);
}

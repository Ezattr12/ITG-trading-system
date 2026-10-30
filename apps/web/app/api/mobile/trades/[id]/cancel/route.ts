import {
  createDefaultApiDeps,
  extractBearerToken,
  parseOptionalJsonBody,
  toJsonResponse,
} from "@/lib/api/auth";
import { handleCancelTrade } from "@/lib/api/handlers/trades";

/**
 * POST /api/mobile/trades/[id]/cancel (Phase 21, M2)
 *
 * Cancel an OPEN trade. Thin adapter over
 * handleCancelTrade → cancelTradeCore (the same core the
 * web cancel action uses). The body is optional, so the
 * lenient parse is used; a body that IS sent still goes
 * through the handler's identity/unknown-key rejection.
 */
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = await parseOptionalJsonBody(request);
  const result = await handleCancelTrade(
    {
      token: extractBearerToken(request),
      body: parsed.ok ? parsed.value : null,
      bodyError: parsed.ok
        ? null
        : String(parsed.result.body.message ?? "invalid request body"),
      tradeId: id,
    },
    createDefaultApiDeps(),
  );
  return toJsonResponse(result);
}

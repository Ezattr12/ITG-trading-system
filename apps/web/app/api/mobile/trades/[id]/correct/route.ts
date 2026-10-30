import {
  createDefaultApiDeps,
  extractBearerToken,
  parseJsonBody,
  toJsonResponse,
} from "@/lib/api/auth";
import { handleCorrectTrade } from "@/lib/api/handlers/trades";

/**
 * POST /api/mobile/trades/[id]/correct (Phase 21, M1)
 *
 * Mobile trade correction by reversal. Thin adapter over
 * handleCorrectTrade → correctTradeCore (the same core
 * the web correction action uses).
 */
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = await parseJsonBody(request);
  const result = await handleCorrectTrade(
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

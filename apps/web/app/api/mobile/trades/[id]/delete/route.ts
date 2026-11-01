import {
  createDefaultApiDeps,
  extractBearerToken,
  parseOptionalJsonBody,
  toJsonResponse,
} from "@/lib/api/auth";
import { handleDeleteTrade } from "@/lib/api/handlers/trades";

/**
 * POST /api/mobile/trades/[id]/delete — Delete Trade.
 *
 * Thin adapter over handleDeleteTrade → deleteTradeCore
 * (the same core the web delete action uses): an open
 * trade is cancelled, a closed trade is annulled by
 * reversal; nothing is hard-deleted. The body is optional
 * ({ reason?: enum }), so the lenient parse is used; a
 * body that IS sent still goes through the handler's
 * identity/unknown-key rejection.
 */
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = await parseOptionalJsonBody(request);
  const result = await handleDeleteTrade(
    {
      token: extractBearerToken(
        request,
      ),
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

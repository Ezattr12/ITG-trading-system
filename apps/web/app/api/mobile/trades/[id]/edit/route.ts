import {
  createDefaultApiDeps,
  extractBearerToken,
  parseJsonBody,
  toJsonResponse,
} from "@/lib/api/auth";
import { handleEditTrade } from "@/lib/api/handlers/trades";

/**
 * POST /api/mobile/trades/[id]/edit — Edit Trade.
 *
 * Thin adapter over handleEditTrade → editTradeCore (the
 * same core the web Edit Trade action uses): a financial
 * change corrects by reversal (201), a journal-only or
 * no-change edit saves in place / writes nothing (200).
 */
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = await parseJsonBody(request);
  const result = await handleEditTrade(
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

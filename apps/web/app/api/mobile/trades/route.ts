import {
  createDefaultApiDeps,
  extractBearerToken,
  parseJsonBody,
  toJsonResponse,
} from "@/lib/api/auth";
import { handleCreateTrade } from "@/lib/api/handlers/trades";

/**
 * POST /api/mobile/trades (Phase 21, M1)
 *
 * Mobile trade creation. Thin adapter: the handler in
 * lib/api/handlers/trades.ts authenticates the Bearer
 * token and calls the same createTradeCore the web
 * Server Action uses.
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request);
  const result = await handleCreateTrade(
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

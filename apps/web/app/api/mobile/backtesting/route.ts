import {
  createDefaultApiDeps,
  extractBearerToken,
  parseJsonBody,
  toJsonResponse,
} from "@/lib/api/auth";
import { handleLogBacktesting } from "@/lib/api/handlers/coach";

/**
 * POST /api/mobile/backtesting (Phase 21, M2)
 *
 * Thin adapter over handleLogBacktesting — the write runs
 * logBacktestingCore, the same core as the web backtesting
 * action (+15 XP per session, idempotent per date+index).
 * See docs/phase-21-m2.md.
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request);
  const result = await handleLogBacktesting(
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

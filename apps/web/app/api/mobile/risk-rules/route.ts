import {
  createDefaultApiDeps,
  extractBearerToken,
  parseJsonBody,
  toJsonResponse,
} from "@/lib/api/auth";
import { handleSaveRiskRules } from "@/lib/api/handlers/risk";

/**
 * PUT /api/mobile/risk-rules (Phase 21, M2)
 *
 * Thin adapter over handleSaveRiskRules — the write runs
 * saveRiskRulesCore, the same core as the web risk-rules
 * action. See docs/phase-21-m2.md.
 */
export const runtime = "nodejs";

export async function PUT(request: Request) {
  const parsed = await parseJsonBody(request);
  const result = await handleSaveRiskRules(
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

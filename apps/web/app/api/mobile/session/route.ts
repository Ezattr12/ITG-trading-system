import {
  createDefaultApiDeps,
  extractBearerToken,
  parseOptionalJsonBody,
  toJsonResponse,
} from "@/lib/api/auth";
import { handleSessionBootstrap } from "@/lib/api/handlers/session";

/**
 * POST /api/mobile/session (Phase 21, M2)
 *
 * Mobile session bootstrap: ensures the authenticated
 * trader's `profiles` row exists (the web's first-login
 * creation, via ensureProfileCore) and reports onboarding
 * state. Thin adapter over handleSessionBootstrap; the
 * body is optional, so the lenient parse is used — a body
 * that IS sent still goes through the identity/unknown-key
 * rejection in the handler.
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  const parsed = await parseOptionalJsonBody(request);
  const result = await handleSessionBootstrap(
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

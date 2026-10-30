import {
  createDefaultApiDeps,
  extractBearerToken,
  parseJsonBody,
  toJsonResponse,
} from "@/lib/api/auth";
import { handleUpdateProfile } from "@/lib/api/handlers/profile";

/**
 * PATCH /api/mobile/profile (Phase 21, M1)
 *
 * Mobile profile update. Thin adapter over
 * handleUpdateProfile → updateProfileCore (the same core
 * the web profile action uses).
 */
export const runtime = "nodejs";

export async function PATCH(request: Request) {
  const parsed = await parseJsonBody(request);
  const result = await handleUpdateProfile(
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

import {
  createDefaultApiDeps,
  extractBearerToken,
  parseJsonBody,
  toJsonResponse,
} from "@/lib/api/auth";
import { handleMarkNotificationsRead } from "@/lib/api/handlers/notifications";

/**
 * POST /api/mobile/notifications/read (Phase 21, M2)
 *
 * Thin adapter over handleMarkNotificationsRead — body
 * `{ notification_id }` marks one of the caller's
 * notifications, `{ all: true }` marks all of them. See
 * docs/phase-21-m2.md.
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request);
  const result = await handleMarkNotificationsRead(
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

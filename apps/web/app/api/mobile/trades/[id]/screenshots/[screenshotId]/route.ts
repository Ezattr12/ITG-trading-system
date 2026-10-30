import {
  createDefaultApiDeps,
  extractBearerToken,
  toJsonResponse,
} from "@/lib/api/auth";
import { handleDeleteScreenshot } from "@/lib/api/handlers/trades";

/**
 * DELETE /api/mobile/trades/[id]/screenshots/[screenshotId]
 * (Phase 21, M2)
 *
 * Thin adapter over handleDeleteScreenshot →
 * deleteScreenshotCore (the same core the web delete
 * action uses). Another trader's screenshot id — or one
 * belonging to a different trade — is the identical 404.
 */
export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; screenshotId: string }> },
) {
  const { id, screenshotId } = await params;
  const result = await handleDeleteScreenshot(
    { token: extractBearerToken(request), tradeId: id, screenshotId },
    createDefaultApiDeps(),
  );
  return toJsonResponse(result);
}

import {
  createDefaultApiDeps,
  extractBearerToken,
  toJsonResponse,
} from "@/lib/api/auth";
import { handleUploadScreenshot } from "@/lib/api/handlers/trades";

/**
 * POST /api/mobile/trades/[id]/screenshots (Phase 21, M2)
 *
 * Multipart screenshot upload (field name `file`). Thin
 * adapter over handleUploadScreenshot →
 * uploadScreenshotCore — the same core, bucket, path and
 * validation as the web upload action.
 */
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let file: File | null = null;
  let formError: string | null = null;
  try {
    const form = await request.formData();
    const part = form.get("file");
    file = part instanceof File ? part : null;
  } catch {
    formError = "request body must be multipart form data with a 'file' field";
  }
  const result = await handleUploadScreenshot(
    { token: extractBearerToken(request), tradeId: id, file, formError },
    createDefaultApiDeps(),
  );
  return toJsonResponse(result);
}

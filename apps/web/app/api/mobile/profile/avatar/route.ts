import {
  createDefaultApiDeps,
  extractBearerToken,
  toJsonResponse,
} from "@/lib/api/auth";
import { handleUploadAvatar } from "@/lib/api/handlers/profile";

/**
 * POST /api/mobile/profile/avatar (Phase 21, M1)
 *
 * Mobile avatar upload (multipart form-data, field
 * `file`). Thin adapter over handleUploadAvatar →
 * uploadAvatarCore (the same core the web avatar action
 * uses, with the shared avatar validation rules).
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  let file: File | null = null;
  try {
    const formData = await request.formData();
    const candidate = formData.get("file");
    file = candidate instanceof File ? candidate : null;
  } catch {
    file = null;
  }
  const result = await handleUploadAvatar(
    { token: extractBearerToken(request), file },
    createDefaultApiDeps(),
  );
  return toJsonResponse(result);
}

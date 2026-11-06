import {
  createDefaultApiDeps,
  extractBearerToken,
  parseJsonBody,
  toJsonResponse,
} from "@/lib/api/auth";
import { handleDeleteAccount } from "@/lib/api/handlers/account";

/**
 * POST /api/mobile/account/delete — self-service account
 * deletion (Google Play release preparation).
 *
 * Thin adapter over handleDeleteAccount → deleteAccountCore:
 * the trader re-verifies their account password in the body
 * ({ password }), then their storage objects are removed
 * and the auth user is deleted (all user rows cascade;
 * audit rows are retained with the user link severed, as
 * disclosed in the Privacy Policy). The body is REQUIRED
 * here — unlike the trade lifecycle endpoints there is no
 * meaningful bodiless form of this call.
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request);
  const result = await handleDeleteAccount(
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

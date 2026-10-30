import {
  createDefaultApiDeps,
  extractBearerToken,
  MAX_JSON_BODY_BYTES,
  toJsonResponse,
} from "@/lib/api/auth";
import {
  createMobileCoachChatDeps,
  handleMobileCoachChat,
} from "@/lib/api/handlers/coach-chat";

/**
 * POST /api/mobile/coach/chat (Phase 26)
 *
 * The Interactive AI Coach for the mobile app — the Bearer
 * surface of the Phase 22 web chat (POST /api/coach/chat).
 * Thin adapter over handleMobileCoachChat: the trader
 * identity comes from the access token only, and all logic
 * (validation, rate limit, the one `coach.chat` audit row,
 * the chat core) lives in lib/coach/chat-handler.ts +
 * lib/coach/chat.ts, shared with web. The coach is
 * read-only: it analyses the trader's own data and never
 * writes, modifies or executes anything.
 *
 * The route owns exactly one transport concern: the M1
 * 64 KB body cap, enforced here (before parsing) and
 * reported to the handler as a body error so the refusal
 * still writes its one audit row.
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  const deps = createDefaultApiDeps();
  const text = await request.text();

  let body: unknown = null;
  let bodyError: string | null = null;
  let jsonMalformed = false;
  if (new TextEncoder().encode(text).length > MAX_JSON_BODY_BYTES) {
    bodyError = "request body is too large";
  } else if (text.trim() !== "") {
    try {
      body = JSON.parse(text);
    } catch {
      jsonMalformed = true;
    }
  }

  const result = await handleMobileCoachChat(
    { body, bodyError, jsonMalformed },
    createMobileCoachChatDeps(extractBearerToken(request), deps),
  );
  return toJsonResponse(result);
}

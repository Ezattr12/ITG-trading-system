import {
  authenticateApiToken,
  type ApiDeps,
  type ApiHandlerResult,
} from "@/lib/api/auth";
import {
  createCoachChatDeps,
  handleCoachChat,
  COACH_CHAT_RATE_LIMIT,
  type CoachChatHandlerDeps,
  type CoachChatInput,
} from "@/lib/coach/chat-handler";

/**
 * Mobile Interactive Coach handler (Phase 26), the Bearer
 * surface of the Phase 22 web chat.
 *
 * There is exactly ONE chat pipeline: handleCoachChat
 * (lib/coach/chat-handler.ts) + answerCoachQuestion
 * (lib/coach/chat.ts). This module contributes only the
 * auth adapter — session resolution from the caller's
 * Supabase access token (authenticateApiToken, the M1
 * pipeline) — and routes the shared rate limit through
 * the API deps. Body contract, validation order and
 * messages, response shape, and the 20/minute limit are
 * the web endpoint's, inherited unchanged.
 *
 * Audit: exactly ONE row per call, written by the shared
 * handler as `coach.chat` with details
 * { outcome, intent, narration } — never the message text.
 * Unlike the M1/M2 write handlers this endpoint writes NO
 * `api.mobile.*` row: those rows are the transport ledger
 * for endpoints whose cores write their own domain rows
 * (trade.created, …) — the chat core is read-only and
 * writes nothing, and the handler's `coach.chat` row is
 * the feature's one domain audit on both surfaces. A
 * second row here would double-count every mobile
 * question in coach reporting. See docs/phase-26.md §3.
 */

export interface MobileCoachChatInput {
  /** Parsed JSON body (null when the request had no body). */
  body: unknown;
  /** Transport body failure from the route (the 64 KB cap). */
  bodyError?: string | null;
  /** True when a body was present but was not valid JSON. */
  jsonMalformed?: boolean;
}

/**
 * Production chat deps for the mobile surface: the shared
 * tail from createCoachChatDeps, with session resolution
 * swapped for Bearer-token resolution and the rate limit
 * routed through the API deps (the same limiter and the
 * same `coach-chat:<userId>` bucket the web surface uses —
 * one 20/minute allowance per trader across both).
 */
export function createMobileCoachChatDeps(
  token: string | null,
  deps: ApiDeps,
): CoachChatHandlerDeps {
  return createCoachChatDeps(
    async () => {
      const auth = await authenticateApiToken(token, deps).catch(() => null);
      if (!auth || !auth.ok) return null;
      return { userId: auth.userId, client: auth.supabase };
    },
    {
      rateLimit: (userId) =>
        deps.rateLimit(`coach-chat:${userId}`, COACH_CHAT_RATE_LIMIT),
    },
  );
}

/** Run one mobile coach question through the shared chat handler. */
export async function handleMobileCoachChat(
  input: MobileCoachChatInput,
  deps: CoachChatHandlerDeps,
): Promise<ApiHandlerResult> {
  const chatInput: CoachChatInput = {
    body: input.body,
    bodyError: input.bodyError ?? null,
    jsonMalformed: input.jsonMalformed,
  };
  const result = await handleCoachChat(chatInput, deps);
  return { status: result.status, body: result.body };
}

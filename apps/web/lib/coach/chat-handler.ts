import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAuditLog } from "@/lib/auth/audit";
import {
  checkPresetRateLimit,
  type RateLimitPreset,
  type RateLimitResult,
} from "@/lib/auth/rate-limit";
import { IDENTITY_FIELDS } from "@/lib/api/auth";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  answerCoachQuestion,
  type CoachChatAnswer,
  type CoachChatHistoryTurn,
} from "./chat";

/**
 * Interactive Coach chat endpoint core (Phase 22).
 *
 * `POST /app/api/coach/chat` is a thin adapter over
 * `handleCoachChat` here, so the whole contract is
 * unit-testable without a Next.js request (the Phase 20
 * endpoint pattern).
 *
 * Security model:
 * - WEB session auth: the trader is whoever the cookie
 *   session says they are (`auth.getUser()` on the server
 *   Supabase client). The request body may not carry
 *   identity fields (`user_id`, `tenant_id`, `profile_id`,
 *   `userId`, `tenantId`) — their presence is a 400 naming
 *   the field, even with a valid session. The chat message
 *   itself is data, never identity.
 * - All coach reads run on the session's RLS client, so a
 *   trader can only ever be answered about their own data.
 * - The chat is READ-ONLY: the core writes nothing except
 *   this endpoint's one audit row per call
 *   (`coach.chat`, details carry outcome / intent /
 *   narration mode — never the message text, never any
 *   figure).
 * - Per-user rate limit: 20 questions per minute.
 * - The handler is transport-shaped, not transport-bound:
 *   the session resolution is one injected dependency, so
 *   the Phase 26 mobile variant can supply a Bearer-token
 *   resolution and reuse this exact pipeline + core.
 */

export const COACH_CHAT_RATE_LIMIT: RateLimitPreset = {
  limit: 20,
  windowMs: 60 * 1000,
};

export const COACH_CHAT_MAX_MESSAGE_CHARS = 1000;
export const COACH_CHAT_MAX_HISTORY_TURNS = 6;
export const COACH_CHAT_MAX_HISTORY_CHARS = 2000;

const ALLOWED_KEYS = ["message", "history"] as const;

export interface CoachChatAuditEntry {
  userId: string | null;
  outcome: string;
  intent: string | null;
  narration: string | null;
}

export interface CoachChatSession {
  userId: string;
  client: SupabaseClient;
}

export interface CoachChatHandlerDeps {
  /** Resolve the web session; null when signed out / not configured. */
  getSession: () => Promise<CoachChatSession | null>;
  /** Best-effort audit write; must never throw. */
  audit: (entry: CoachChatAuditEntry) => Promise<void>;
  /** Per-user rate-limit check. */
  rateLimit: (userId: string) => RateLimitResult;
  /** The chat core (injectable so tests can count calls / force failures). */
  answer: (args: {
    supabase: SupabaseClient;
    userId: string;
    message: string;
    history: CoachChatHistoryTurn[];
    now: Date;
  }) => Promise<CoachChatAnswer>;
  /** Clock, injectable for tests. */
  now: () => Date;
}

export interface CoachChatInput {
  /** Parsed JSON body (null when the request had no body). */
  body: unknown;
  /** True when a body was present but was not valid JSON. */
  jsonMalformed?: boolean;
}

export interface CoachChatResponse {
  status: number;
  body: Record<string, unknown>;
}

function isValidHistory(value: unknown): value is CoachChatHistoryTurn[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (turn) =>
      turn !== null &&
      typeof turn === "object" &&
      !Array.isArray(turn) &&
      ((turn as { role?: unknown }).role === "user" ||
        (turn as { role?: unknown }).role === "assistant") &&
      typeof (turn as { content?: unknown }).content === "string" &&
      ((turn as { content: string }).content.length <= COACH_CHAT_MAX_HISTORY_CHARS),
  );
}

export async function handleCoachChat(
  input: CoachChatInput,
  deps: CoachChatHandlerDeps,
): Promise<CoachChatResponse> {
  const fail = (status: number, error: string, message?: string) => ({
    status,
    body: message ? { error, message } : { error },
  });

  if (input.jsonMalformed) {
    await deps.audit({ userId: null, outcome: "invalid_argument", intent: null, narration: null });
    return fail(400, "invalid_argument", "request body must be valid JSON");
  }

  const session = await deps.getSession().catch(() => null);
  if (!session) {
    await deps.audit({ userId: null, outcome: "unauthenticated", intent: null, narration: null });
    return fail(401, "unauthenticated");
  }
  const { userId, client } = session;

  const auditAndFail = async (status: number, error: string, outcome: string, message?: string) => {
    await deps.audit({ userId, outcome, intent: null, narration: null });
    return fail(status, error, message);
  };

  if (input.body === null || typeof input.body !== "object" || Array.isArray(input.body)) {
    return auditAndFail(400, "invalid_argument", "invalid_argument", "request body must be a JSON object");
  }
  const body = input.body as Record<string, unknown>;

  // Smuggled identity is refused even with a valid session:
  // the trader is whoever the session says they are.
  for (const key of IDENTITY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      return auditAndFail(
        400,
        "invalid_argument",
        "invalid_argument",
        `identity field not allowed: ${key} — the trader is identified by the session`,
      );
    }
  }
  for (const key of Object.keys(body)) {
    if (!(ALLOWED_KEYS as readonly string[]).includes(key)) {
      return auditAndFail(400, "invalid_argument", "invalid_argument", `unknown field: ${key}`);
    }
  }

  const rawMessage = body.message;
  if (typeof rawMessage !== "string" || rawMessage.trim() === "") {
    return auditAndFail(400, "invalid_argument", "invalid_argument", "message must be a non-empty string");
  }
  const message = rawMessage.trim();
  if (message.length > COACH_CHAT_MAX_MESSAGE_CHARS) {
    return auditAndFail(
      400,
      "invalid_argument",
      "invalid_argument",
      `message must be at most ${COACH_CHAT_MAX_MESSAGE_CHARS} characters`,
    );
  }

  let history: CoachChatHistoryTurn[] = [];
  if (body.history !== undefined) {
    if (!isValidHistory(body.history)) {
      return auditAndFail(
        400,
        "invalid_argument",
        "invalid_argument",
        "history must be an array of { role, content } turns",
      );
    }
    // Bounded: only the last few turns are accepted, and the
    // core never lets them widen the data scope.
    history = body.history.slice(-COACH_CHAT_MAX_HISTORY_TURNS);
  }

  const rate = deps.rateLimit(userId);
  if (!rate.allowed) {
    return auditAndFail(429, "rate_limited", "rate_limited");
  }

  let answer: CoachChatAnswer;
  try {
    answer = await deps.answer({
      supabase: client,
      userId,
      message,
      history,
      now: deps.now(),
    });
  } catch {
    await deps.audit({ userId, outcome: "error", intent: null, narration: null });
    return fail(500, "internal");
  }

  await deps.audit({
    userId,
    outcome: answer.status === "ok" ? "ok" : "insufficient_data",
    intent: answer.intent,
    narration: answer.narration,
  });
  return { status: 200, body: { ...answer } };
}

/**
 * Production dependencies: the web cookie session via the
 * server Supabase client, audit through the existing
 * service-role helper, the shared rate limiter, and the
 * real chat core.
 */
export function createDefaultCoachChatDeps(): CoachChatHandlerDeps {
  return {
    async getSession() {
      if (!isSupabaseConfigured()) return null;
      const supabase = await createServerSupabaseClient();
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) return null;
      return { userId: data.user.id, client: supabase };
    },
    async audit(entry) {
      try {
        await writeAuditLog({
          userId: entry.userId,
          action: "coach.chat",
          entityType: "coach_chat",
          entityId: null,
          details: {
            outcome: entry.outcome,
            intent: entry.intent,
            narration: entry.narration,
          },
        });
      } catch {
        // Audit is best-effort and must never break the answer.
      }
    },
    rateLimit(userId) {
      return checkPresetRateLimit(`coach-chat:${userId}`, COACH_CHAT_RATE_LIMIT);
    },
    answer: (args) => answerCoachQuestion(args),
    now: () => new Date(),
  };
}

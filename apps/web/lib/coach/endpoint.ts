import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { writeAuditLog } from "@/lib/auth/audit";
import {
  checkPresetRateLimit,
  type RateLimitPreset,
  type RateLimitResult,
} from "@/lib/auth/rate-limit";
import { mondayOfWeek, weekBounds } from "@/lib/reviews/reviews";
import { computeCoachInsights } from "./service";
import type { CoachAnalysis } from "./types";

/**
 * Internal coach-insights endpoint core (Phase 20).
 *
 * `POST /app/api/internal/coach-insights` is a thin adapter
 * over `handleCoachInsightsCompute` here, so the whole
 * contract is unit-testable without a Next.js request.
 *
 * Security model:
 * - The caller presents a trader's Supabase access token
 *   (`Authorization: Bearer …`). It is validated with
 *   Supabase Auth and the trader identity is derived from
 *   the validated token ONLY — the request body may not
 *   carry identity fields (`user_id`, `tenant_id`,
 *   `profile_id`, `userId`); their presence is a 400, even
 *   with a valid token.
 * - All reads run on a token-scoped client (anon key + the
 *   caller's JWT), so RLS applies exactly as in the app.
 * - The endpoint COMPUTES ONLY. It never writes
 *   `ai_insights` — persistence stays with the app action /
 *   trade-close trigger via the coach service.
 * - Every authenticated compute writes exactly one
 *   `audit_logs` row (`internal.coach_insights_compute`);
 *   unauthenticated attempts are audited with a null actor.
 *   Token material is never logged.
 * - Per-user rate limit: 30 computes per minute.
 */

export const COACH_INSIGHTS_RATE_LIMIT: RateLimitPreset = {
  limit: 30,
  windowMs: 60 * 1000,
};

const FORBIDDEN_IDENTITY_KEYS = ["user_id", "tenant_id", "profile_id", "userId"] as const;
const TEXT_CAP = 2000;

export interface CoachEndpointAuditEntry {
  userId: string | null;
  outcome: string;
  weekStart: string | null;
  insightsCount: number | null;
}

export interface CoachInsightsEndpointDeps {
  /** Validate a bearer token; returns the trader + their RLS client, or null. */
  validateToken: (
    token: string,
  ) => Promise<{ userId: string; client: SupabaseClient } | null>;
  /** Best-effort audit write; must never throw. */
  audit: (entry: CoachEndpointAuditEntry) => Promise<void>;
  /** Per-user rate-limit check. */
  rateLimit: (userId: string) => RateLimitResult;
  /** Clock, injectable for tests. */
  now: () => Date;
}

export interface CoachInsightsComputeInput {
  /** Bearer token from the Authorization header, or null when absent. */
  token: string | null;
  /** Parsed JSON body (null when the request had no body). */
  body: unknown;
  /** True when a body was present but was not valid JSON. */
  jsonMalformed?: boolean;
}

export interface CoachInsightsComputeResponse {
  status: number;
  body: Record<string, unknown>;
}

/** Strict YYYY-MM-DD that is a real calendar date (no roll-overs like Feb 30). */
function isRealDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function capText(value: string): string {
  return value.length > TEXT_CAP ? value.slice(0, TEXT_CAP) : value;
}

/** Defensively cap every free-text string inside a metrics snapshot. */
function capSnapshot(value: unknown): unknown {
  if (typeof value === "string") return capText(value);
  if (Array.isArray(value)) return value.map(capSnapshot);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, capSnapshot(v)]),
    );
  }
  return value;
}

function successBody(
  monday: string,
  analysis: CoachAnalysis | null,
  generatedAt: string,
): Record<string, unknown> {
  if (!analysis) {
    // No evidence could be assembled for the week — report it
    // with the same honest shape as insufficient data.
    const bounds = weekBounds(monday);
    return {
      week_start: monday,
      period_start: bounds?.start ?? monday,
      period_end: bounds?.end ?? monday,
      insufficient_data: true,
      insights: [],
      generated_at: generatedAt,
    };
  }
  return {
    week_start: monday,
    period_start: analysis.periodStart,
    period_end: analysis.periodEnd,
    insufficient_data: analysis.insufficientData,
    insights: analysis.insights.map((insight) => ({
      type: insight.type,
      title: capText(insight.title),
      metrics_snapshot: capSnapshot(insight.metricsSnapshot),
    })),
    generated_at: generatedAt,
  };
}

export async function handleCoachInsightsCompute(
  input: CoachInsightsComputeInput,
  deps: CoachInsightsEndpointDeps,
): Promise<CoachInsightsComputeResponse> {
  const fail = (status: number, error: string, message?: string) => ({
    status,
    body: message ? { error, message } : { error },
  });

  if (input.jsonMalformed) {
    await deps.audit({ userId: null, outcome: "invalid_argument", weekStart: null, insightsCount: null });
    return fail(400, "invalid_argument", "request body must be valid JSON");
  }

  if (!input.token) {
    await deps.audit({ userId: null, outcome: "unauthenticated", weekStart: null, insightsCount: null });
    return fail(401, "unauthenticated");
  }
  const auth = await deps.validateToken(input.token).catch(() => null);
  if (!auth) {
    await deps.audit({ userId: null, outcome: "unauthenticated", weekStart: null, insightsCount: null });
    return fail(401, "unauthenticated");
  }
  const { userId, client } = auth;

  const auditAndFail = async (
    status: number,
    error: string,
    outcome: string,
    weekStart: string | null,
    message?: string,
  ) => {
    await deps.audit({ userId, outcome, weekStart, insightsCount: null });
    return fail(status, error, message);
  };

  // Body must be a JSON object when present.
  let body: Record<string, unknown> = {};
  if (input.body !== null && input.body !== undefined) {
    if (typeof input.body !== "object" || Array.isArray(input.body)) {
      return auditAndFail(400, "invalid_argument", "invalid_argument", null, "request body must be a JSON object");
    }
    body = input.body as Record<string, unknown>;
  }

  // Smuggled identity is refused even with a valid token: the
  // trader is whoever the token says they are, nobody else.
  for (const key of FORBIDDEN_IDENTITY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      return auditAndFail(
        400,
        "invalid_argument",
        "invalid_argument",
        null,
        `identity field not allowed: ${key} — the trader is identified by the access token`,
      );
    }
  }

  // Week: explicit (any date in the week, normalised to its
  // Monday) or the current week's Monday (UTC).
  let monday: string | null;
  if (body.week_start !== undefined) {
    if (typeof body.week_start !== "string" || !isRealDateString(body.week_start)) {
      return auditAndFail(
        400,
        "invalid_argument",
        "invalid_argument",
        null,
        "week_start must be a valid date (YYYY-MM-DD)",
      );
    }
    monday = mondayOfWeek(body.week_start);
  } else {
    monday = mondayOfWeek(deps.now().toISOString().slice(0, 10));
  }
  if (!monday) {
    return auditAndFail(400, "invalid_argument", "invalid_argument", null, "week_start must be a valid date (YYYY-MM-DD)");
  }

  const rate = deps.rateLimit(userId);
  if (!rate.allowed) {
    return auditAndFail(429, "rate_limited", "rate_limited", monday);
  }

  let computed: Awaited<ReturnType<typeof computeCoachInsights>>;
  try {
    computed = await computeCoachInsights(client, userId, monday);
  } catch {
    await deps.audit({ userId, outcome: "error", weekStart: monday, insightsCount: null });
    return fail(500, "upstream_error");
  }
  if (computed.status === "invalid_week") {
    // Unreachable after the validation above; mapped defensively.
    return auditAndFail(400, "invalid_argument", "invalid_argument", monday, "week_start must be a valid date (YYYY-MM-DD)");
  }

  const analysis = computed.status === "no_data" ? null : computed.analysis;
  const insufficient = computed.status !== "ok";
  await deps.audit({
    userId,
    outcome: insufficient ? "insufficient_data" : "ok",
    weekStart: monday,
    insightsCount: analysis?.insights.length ?? 0,
  });
  return {
    status: 200,
    body: successBody(monday, analysis, deps.now().toISOString()),
  };
}

/**
 * Production dependencies: token validation against Supabase
 * Auth with an anon-key client carrying the caller's JWT (the
 * same construction the MCP server uses), audit through the
 * existing service-role helper, the shared rate limiter.
 */
export function createDefaultCoachEndpointDeps(): CoachInsightsEndpointDeps {
  return {
    async validateToken(token) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
      if (!url || !anonKey) return null;
      const client = createClient(url, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data, error } = await client.auth.getUser(token);
      if (error || !data.user) return null;
      return { userId: data.user.id, client };
    },
    async audit(entry) {
      try {
        await writeAuditLog({
          userId: entry.userId,
          action: "internal.coach_insights_compute",
          entityType: "ai_insights",
          entityId: null,
          details: {
            week_start: entry.weekStart,
            outcome: entry.outcome,
            insights_count: entry.insightsCount,
          },
        });
      } catch {
        // Audit is best-effort and must never break the compute.
      }
    },
    rateLimit(userId) {
      return checkPresetRateLimit(`coach-insights:${userId}`, COACH_INSIGHTS_RATE_LIMIT);
    },
    now: () => new Date(),
  };
}

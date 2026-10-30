import { capText, isValidIsoDate } from "./common.js";
import type { AuditOutcome } from "./audit.js";
import type { IntelParseResult, IntelRunResult } from "./intelligence.js";

/**
 * `compute_coach_insights` (Phase 20) — the MCP face of the
 * deterministic Coach Engine.
 *
 * This module contains NO coach logic. The engine lives in
 * exactly one place — the web app (lib/coach/insights.ts) —
 * and is exposed to this server through the authenticated
 * internal endpoint `POST /api/internal/coach-insights`. The
 * tool below is only an HTTP client for that endpoint:
 *
 * - The request carries the SAME Supabase access token the
 *   dispatcher already validated (env ITG_SUPABASE_ACCESS_TOKEN)
 *   as a Bearer header. The endpoint derives the trader from
 *   that token; the body carries `week_start` only — no
 *   identity fields, no service-role key (design §2.1).
 * - Argument validation mirrors the other tools: unknown
 *   arguments (above all `user_id`/`tenant_id`) are rejected
 *   before any network call happens.
 * - Upstream statuses map onto the server's error taxonomy:
 *   401 → unauthenticated, 400 → invalid_argument,
 *   429 → rate_limited, anything else → upstream_error.
 *   Upstream bodies are never echoed beyond a short message.
 * - The response is bounded: total payload sanity cap plus
 *   the shared 2,000-char free-text cap (the endpoint already
 *   caps its fields; this is defence in depth).
 */

export const COACH_FETCH_TIMEOUT_MS = 10_000;
export const MAX_COACH_PAYLOAD_CHARS = 64 * 1024;

export class CoachHttpError extends Error {
  readonly code: AuditOutcome;

  constructor(code: AuditOutcome, message: string) {
    super(message);
    this.name = "CoachHttpError";
    this.code = code;
  }
}

export interface CoachHttpDeps {
  fetchImpl: typeof fetch;
  baseUrl: string;
  accessToken: string;
}

export interface CoachToolSpec {
  entityType: string;
  parse(args: unknown): IntelParseResult;
  run(http: CoachHttpDeps, value: unknown): Promise<IntelRunResult>;
}

export const COACH_TOOL_DEFINITIONS = [
  {
    name: "compute_coach_insights",
    description:
      "Compute the authenticated trader's deterministic weekly coach insights (the same engine the app uses, served by the app's authenticated internal endpoint — this server holds no copy of the coach logic). Compute-only: stores nothing, changes nothing. The trader is identified by the session token, never by an argument.",
    inputSchema: {
      type: "object",
      properties: {
        week_start: {
          type: "string",
          format: "date",
          description:
            "Any date in the week to analyse (YYYY-MM-DD). Defaults to the current week.",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
] as const;

function parseCoachArgs(args: unknown): IntelParseResult {
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return { invalidMessage: "arguments must be an object", value: null, auditArgs: {} };
  }
  const record = args as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "week_start") {
      return { invalidMessage: `unknown argument: ${key}`, value: null, auditArgs: {} };
    }
  }
  const weekStart = record.week_start;
  if (weekStart === undefined) {
    return {
      invalidMessage: null,
      value: { weekStart: null },
      auditArgs: { week_start: null },
    };
  }
  if (typeof weekStart !== "string" || !isValidIsoDate(weekStart)) {
    return {
      invalidMessage: "week_start must be a valid date (YYYY-MM-DD)",
      value: null,
      auditArgs: {},
    };
  }
  return {
    invalidMessage: null,
    value: { weekStart },
    auditArgs: { week_start: weekStart },
  };
}

/** Defensively cap every free-text string in the endpoint payload. */
function capCoachPayload(value: unknown): unknown {
  if (typeof value === "string") return capText(value).text;
  if (Array.isArray(value)) return value.map(capCoachPayload);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        capCoachPayload(v),
      ]),
    );
  }
  return value;
}

/** Extract a short, safe message from an upstream 400 body — never a raw echo. */
async function shortUpstreamMessage(res: Response): Promise<string | null> {
  try {
    const text = await res.text();
    if (text.length > 4096) return null;
    const parsed = JSON.parse(text) as { message?: unknown };
    if (typeof parsed.message === "string" && parsed.message.length > 0) {
      return parsed.message.slice(0, 200);
    }
  } catch {
    // Not JSON / unreadable — fall through to the generic message.
  }
  return null;
}

async function runComputeCoachInsights(
  http: CoachHttpDeps,
  value: unknown,
): Promise<IntelRunResult> {
  const { weekStart } = value as { weekStart: string | null };
  const url = `${http.baseUrl.replace(/\/+$/, "")}/api/internal/coach-insights`;
  let res: Response;
  try {
    res = await http.fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${http.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(weekStart ? { week_start: weekStart } : {}),
      signal: AbortSignal.timeout(COACH_FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new CoachHttpError(
      "upstream_error",
      "the internal coach endpoint could not be reached",
    );
  }

  if (res.status === 200) {
    const text = await res.text();
    if (text.length > MAX_COACH_PAYLOAD_CHARS) {
      throw new CoachHttpError(
        "upstream_error",
        "the internal coach endpoint returned an oversized response",
      );
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new CoachHttpError(
        "upstream_error",
        "the internal coach endpoint returned an invalid response",
      );
    }
    return { payload: capCoachPayload(json), entityId: null };
  }
  if (res.status === 401) {
    throw new CoachHttpError(
      "unauthenticated",
      "the internal coach endpoint rejected the access token",
    );
  }
  if (res.status === 429) {
    throw new CoachHttpError(
      "rate_limited",
      "the internal coach endpoint rate limit was reached",
    );
  }
  if (res.status === 400) {
    const message = await shortUpstreamMessage(res);
    throw new CoachHttpError(
      "invalid_argument",
      message ?? "the internal coach endpoint rejected the request",
    );
  }
  throw new CoachHttpError(
    "upstream_error",
    `the internal coach endpoint returned ${res.status}`,
  );
}

export const COACH_TOOLS: Record<string, CoachToolSpec> = {
  compute_coach_insights: {
    entityType: "ai_insights",
    parse: parseCoachArgs,
    run: runComputeCoachInsights,
  },
};

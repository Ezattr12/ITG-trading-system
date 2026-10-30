import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { writeAuditLog } from "@/lib/auth/audit";
import {
  checkPresetRateLimit,
  type RateLimitPreset,
  type RateLimitResult,
} from "@/lib/auth/rate-limit";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";

/**
 * Shared authentication + plumbing for the mobile API
 * (Phase 21, M1). Every /api/mobile/* handler runs through
 * here, and the security model mirrors the Phase 20
 * internal coach endpoint:
 *
 * - The caller presents a trader's Supabase access token
 *   (`Authorization: Bearer …`). It is validated with
 *   Supabase Auth (`auth.getUser`) and the trader identity
 *   is derived from the validated token ONLY.
 * - The token client is an anon-key client carrying the
 *   caller's JWT, so every query the service cores run is
 *   RLS-scoped to that trader — the same construction the
 *   Phase 20 endpoint and the MCP server use.
 * - Request bodies may not carry identity fields
 *   (`user_id`, `tenant_id`, `profile_id`, `userId`,
 *   `tenantId`); their presence is a 400, even with a
 *   valid token, and no write is performed.
 * - The service-role client, when present, is constructed
 *   only by the existing server module and used only by
 *   the existing server-side engines (XP, risk events,
 *   notifications, audit) — never for the caller's reads
 *   or writes, and never exposed to any client.
 */

/** Default per-user API write limit (per operation): 60/min. */
export const API_WRITE_RATE_LIMIT: RateLimitPreset = {
  limit: 60,
  windowMs: 60 * 1000,
};

/** Bodies larger than this are refused before parsing. */
export const MAX_JSON_BODY_BYTES = 64 * 1024;

export const IDENTITY_FIELDS = [
  "user_id",
  "tenant_id",
  "profile_id",
  "userId",
  "tenantId",
] as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Bearer token from the Authorization header, or null. */
export function extractBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (authorization === null || !authorization.startsWith("Bearer ")) {
    return null;
  }
  return authorization.slice("Bearer ".length).trim() || null;
}

/**
 * First identity key present in a parsed body, or null.
 * Identity comes from the validated token only — a body
 * that tries to name a trader is refused outright.
 */
export function rejectIdentityFields(body: unknown): string | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  for (const key of IDENTITY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) return key;
  }
  return null;
}

/** First top-level key not in the allowed set, or null. */
export function rejectUnknownKeys(
  body: Record<string, unknown>,
  allowed: readonly string[],
): string | null {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) return key;
  }
  return null;
}

/* ---------------------------------------------------------- responses */

export interface ApiHandlerResult {
  status: number;
  body: Record<string, unknown>;
}

export function apiOk(data: Record<string, unknown>, status = 200): ApiHandlerResult {
  return { status, body: data };
}

export function apiError(
  status: number,
  code: string,
  message?: string,
): ApiHandlerResult {
  return { status, body: message ? { error: code, message } : { error: code } };
}

/** JSON response for a route adapter (kept tiny on purpose). */
export function toJsonResponse(result: ApiHandlerResult): Response {
  return Response.json(result.body, { status: result.status });
}

/* ------------------------------------------------------------- bodies */

export type ParsedJsonBody =
  | { ok: true; value: unknown }
  | { ok: false; result: ApiHandlerResult };

/**
 * Read + parse a JSON request body with a size cap. The
 * body must be a JSON object — arrays/scalars are refused
 * here so handlers can rely on record access.
 */
export async function parseJsonBody(
  request: Request,
  maxBytes: number = MAX_JSON_BODY_BYTES,
): Promise<ParsedJsonBody> {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) {
    return {
      ok: false,
      result: apiError(400, "invalid_argument", "request body is too large"),
    };
  }
  if (text.trim() === "") {
    return {
      ok: false,
      result: apiError(400, "invalid_argument", "request body must be a JSON object"),
    };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return {
      ok: false,
      result: apiError(400, "invalid_argument", "request body must be valid JSON"),
    };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      result: apiError(400, "invalid_argument", "request body must be a JSON object"),
    };
  }
  return { ok: true, value };
}

/* --------------------------------------------------------------- deps */

export interface ApiAuditEntry {
  userId: string | null;
  /** e.g. "trade_created" → stored as `api.mobile.trade_created`. */
  operation: string;
  entityType: string;
  entityId: string | null;
  outcome: string;
  details?: Record<string, unknown>;
}

/**
 * Injectable dependencies for the mobile handlers, so the
 * whole contract is unit-testable with the fake Supabase
 * client (same style as lib/coach/endpoint.ts).
 */
export interface ApiDeps {
  /** Build the anon-key token client for one bearer token. */
  makeTokenClient: (token: string) => SupabaseClient;
  /** Service-role client, or null when not configured. */
  makeAdminClient: () => SupabaseClient | null;
  /** Best-effort API-layer audit write; must never throw. */
  auditApi: (entry: ApiAuditEntry) => Promise<void>;
  /** Per-user rate-limit check. */
  rateLimit: (key: string, preset: RateLimitPreset) => RateLimitResult;
  /** Clock, injectable for tests. */
  now: () => Date;
}

export function createDefaultApiDeps(): ApiDeps {
  return {
    makeTokenClient(token) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
      return createClient(url, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { autoRefreshToken: false, persistSession: false },
      });
    },
    makeAdminClient() {
      return createServiceRoleSupabaseClient();
    },
    async auditApi(entry) {
      try {
        await writeAuditLog({
          userId: entry.userId,
          action: `api.mobile.${entry.operation}`,
          entityType: entry.entityType,
          entityId: entry.entityId,
          details: { outcome: entry.outcome, ...(entry.details ?? {}) },
        });
      } catch {
        // Audit is best-effort and must never break the call.
      }
    },
    rateLimit(key, preset) {
      return checkPresetRateLimit(key, preset);
    },
    now: () => new Date(),
  };
}

/* --------------------------------------------------------------- auth */

export type ApiAuth =
  | {
      ok: true;
      userId: string;
      /** Token-scoped RLS client — the only client cores write through. */
      supabase: SupabaseClient;
      /** Service-role client (server-side engines only), or null. */
      admin: SupabaseClient | null;
    }
  | { ok: false; status: 401; error: "unauthenticated" };

/**
 * Validate a bearer token and derive the trader identity
 * from it. Used by `authenticateApiRequest` and directly by
 * handlers (which receive the token from their route
 * adapter, coach-endpoint style).
 */
export async function authenticateApiToken(
  token: string | null,
  deps: ApiDeps,
): Promise<ApiAuth> {
  if (!token) return { ok: false, status: 401, error: "unauthenticated" };
  const supabase = deps.makeTokenClient(token);
  const { data, error } = await supabase.auth
    .getUser(token)
    .catch(() => ({ data: { user: null }, error: new Error("auth failed") }));
  if (error || !data.user) {
    return { ok: false, status: 401, error: "unauthenticated" };
  }
  return {
    ok: true,
    userId: data.user.id,
    supabase,
    admin: deps.makeAdminClient(),
  };
}

/** Authenticate a fetch Request (header extraction + validation). */
export async function authenticateApiRequest(
  request: Request,
  deps: ApiDeps = createDefaultApiDeps(),
): Promise<ApiAuth> {
  return authenticateApiToken(extractBearerToken(request), deps);
}

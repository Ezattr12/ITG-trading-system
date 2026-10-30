import { describe, expect, it } from "vitest";
import { fakeSupabase } from "../../web/lib/test-helpers/fake-supabase";
import { createToolCaller, TOOL_DEFINITIONS } from "./tools";
import { RateLimiter } from "./ratelimit";
import type { Authenticator } from "./auth";
import type { McpConfig } from "./config";
import type { DbClient } from "./db";

/**
 * compute_coach_insights (Phase 20): the tool is an HTTP
 * client for the web app's internal coach endpoint — the
 * coach engine itself never runs in this process. These tests
 * stub fetch and assert the wire contract: URL, Bearer header
 * (the dispatcher's validated token), a body with week_start
 * ONLY, strict argument validation before any fetch, upstream
 * status mapping, and exactly one audit row per call.
 */

const USER_A = "11111111-1111-4111-8111-111111111111";

interface AuditRow {
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: {
    tool: string;
    outcome: string;
    arguments: Record<string, unknown>;
  };
}

interface FetchCall {
  url: string;
  init: RequestInit;
}

const ENDPOINT_PAYLOAD = {
  week_start: "2026-10-12",
  period_start: "2026-10-12",
  period_end: "2026-10-18",
  insufficient_data: false,
  insights: [
    {
      type: "performance",
      title: "Net positive week: +$100.00 across 3 trades",
      metrics_snapshot: { rule: "performance_summary", trades: 3, totalPnl: 100 },
    },
  ],
  generated_at: "2026-10-30T07:00:00.000Z",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeCaller(fetchImpl: typeof fetch) {
  const { client } = fakeSupabase({});
  const auditRows: AuditRow[] = [];
  const recordingServiceClient: DbClient = {
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        auditRows.push(row as unknown as AuditRow);
        return { error: null };
      },
    }),
  };
  const authenticator: Authenticator = {
    async authenticate(token) {
      if (token !== "token-a") return null;
      return { userId: USER_A, client: client as unknown as DbClient };
    },
  };
  const config: McpConfig = {
    supabaseUrl: "https://example.supabase.co",
    supabaseAnonKey: "anon",
    supabaseServiceRoleKey: "service",
    accessToken: "token-a",
    apiBaseUrl: "https://itg-traderos.vercel.app",
    configured: true,
  };
  const callTool = createToolCaller({
    config,
    authenticator,
    serviceClient: recordingServiceClient,
    rateLimiter: new RateLimiter(60, 1),
    fetchImpl,
  });
  return { callTool, auditRows };
}

function stubFetch(handler: (call: FetchCall) => Response) {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return handler(call);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("compute_coach_insights", () => {
  it("is registered: tools/list now exposes exactly 13 tools", () => {
    expect(TOOL_DEFINITIONS).toHaveLength(13);
    expect(TOOL_DEFINITIONS.map((t) => t.name)).toContain("compute_coach_insights");
  });

  it("POSTs week_start only, with the validated token as Bearer, and returns the endpoint payload", async () => {
    const { fetchImpl, calls } = stubFetch(() => jsonResponse(200, ENDPOINT_PAYLOAD));
    const { callTool, auditRows } = makeCaller(fetchImpl);
    const result = await callTool("compute_coach_insights", { week_start: "2026-10-14" });
    expect(result.isError).toBe(false);
    expect(result.payload).toEqual(ENDPOINT_PAYLOAD);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://itg-traderos.vercel.app/api/internal/coach-insights");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer token-a");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ week_start: "2026-10-14" });

    // Exactly one audit row, with the Phase 20 contract fields.
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].action).toBe("mcp.compute_coach_insights");
    expect(auditRows[0].entity_type).toBe("ai_insights");
    expect(auditRows[0].entity_id).toBeNull();
    expect(auditRows[0].user_id).toBe(USER_A);
    expect(auditRows[0].details.outcome).toBe("ok");
    expect(auditRows[0].details.arguments).toEqual({ week_start: "2026-10-14" });
  });

  it("omitted week_start sends an empty body (endpoint defaults to the current week)", async () => {
    const { fetchImpl, calls } = stubFetch(() => jsonResponse(200, ENDPOINT_PAYLOAD));
    const { callTool, auditRows } = makeCaller(fetchImpl);
    const result = await callTool("compute_coach_insights", {});
    expect(result.isError).toBe(false);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({});
    expect(auditRows[0].details.arguments).toEqual({ week_start: null });
  });

  it.each([
    [{ user_id: USER_A }, "user_id"],
    [{ tenant_id: "x" }, "tenant_id"],
    [{ week_start: "2026-10-12", user_id: USER_A }, "user_id"],
  ])("rejects smuggled/unknown args %o BEFORE any fetch", async (args, key) => {
    const { fetchImpl, calls } = stubFetch(() => jsonResponse(200, ENDPOINT_PAYLOAD));
    const { callTool, auditRows } = makeCaller(fetchImpl);
    const result = await callTool("compute_coach_insights", args);
    expect(result.isError).toBe(true);
    const payload = result.payload as { error: { code: string; message: string } };
    expect(payload.error.code).toBe("invalid_argument");
    expect(payload.error.message).toContain(`unknown argument: ${key}`);
    expect(calls).toHaveLength(0); // no fetch performed
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].details.outcome).toBe("invalid_argument");
    expect(auditRows[0].entity_type).toBe("ai_insights");
  });

  it("rejects an impossible week_start before any fetch", async () => {
    const { fetchImpl, calls } = stubFetch(() => jsonResponse(200, ENDPOINT_PAYLOAD));
    const { callTool } = makeCaller(fetchImpl);
    const result = await callTool("compute_coach_insights", { week_start: "2026-02-30" });
    expect(result.isError).toBe(true);
    expect((result.payload as { error: { code: string } }).error.code).toBe("invalid_argument");
    expect(calls).toHaveLength(0);
  });

  it.each([
    [400, { error: "invalid_argument", message: "week_start must be a valid date (YYYY-MM-DD)" }, "invalid_argument"],
    [401, { error: "unauthenticated" }, "unauthenticated"],
    [429, { error: "rate_limited" }, "rate_limited"],
    [500, { error: "upstream_error" }, "upstream_error"],
    [503, "<html>Service Unavailable</html>", "upstream_error"],
  ])("maps upstream %i to %s", async (status, body, code) => {
    const upstream =
      typeof body === "string"
        ? new Response(body, { status })
        : jsonResponse(status as number, body);
    const { fetchImpl } = stubFetch(() => upstream);
    const { callTool, auditRows } = makeCaller(fetchImpl);
    const result = await callTool("compute_coach_insights", { week_start: "2026-10-12" });
    expect(result.isError).toBe(true);
    const payload = result.payload as { error: { code: string; message: string } };
    expect(payload.error.code).toBe(code);
    // Sanitized: the upstream HTML body is never echoed.
    expect(payload.error.message).not.toContain("<html>");
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].details.outcome).toBe(code);
    expect(auditRows[0].action).toBe("mcp.compute_coach_insights");
  });

  it("a network failure maps to upstream_error", async () => {
    const fetchImpl = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as unknown as typeof fetch;
    const { callTool, auditRows } = makeCaller(fetchImpl);
    const result = await callTool("compute_coach_insights", {});
    expect(result.isError).toBe(true);
    expect((result.payload as { error: { code: string } }).error.code).toBe("upstream_error");
    expect(auditRows).toHaveLength(1);
  });

  it("an oversized upstream payload maps to upstream_error", async () => {
    const big = { insights: "x".repeat(70 * 1024) };
    const { fetchImpl } = stubFetch(() => jsonResponse(200, big));
    const { callTool } = makeCaller(fetchImpl);
    const result = await callTool("compute_coach_insights", {});
    expect(result.isError).toBe(true);
    expect((result.payload as { error: { code: string } }).error.code).toBe("upstream_error");
  });
});

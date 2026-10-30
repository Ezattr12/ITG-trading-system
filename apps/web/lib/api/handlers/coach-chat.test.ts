import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeSupabase, type Row } from "@/lib/test-helpers/fake-supabase";
import { __clearRateLimitBuckets } from "@/lib/auth/rate-limit";
import type { ApiAuditEntry, ApiDeps } from "@/lib/api/auth";
import type { RateLimitPreset, RateLimitResult } from "@/lib/auth/rate-limit";
import type { CoachChatAnswer } from "@/lib/coach/chat";
import type {
  CoachChatAuditEntry,
  CoachChatHandlerDeps,
} from "@/lib/coach/chat-handler";
import {
  createMobileCoachChatDeps,
  handleMobileCoachChat,
  type MobileCoachChatInput,
} from "./coach-chat";

/**
 * Mobile coach chat handler tests (Phase 26): the Bearer
 * surface of the Phase 22 web chat. The pipeline under
 * test is the SHARED handleCoachChat — these tests pin the
 * mobile adapter: identity from the token only, the web
 * body contract unchanged, the shared 20/minute bucket,
 * answers computed for the TOKEN user, and exactly one
 * audit row per call on the coach ledger (`coach.chat`
 * entries captured here) with NO `api.mobile.*` row
 * (auditApi must stay silent) and no message text in any
 * audit entry.
 */

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const CANNED: CoachChatAnswer = {
  status: "ok",
  intent: "best_strategy",
  facts: ["Best strategy: Alpha Breakout — total P&L 270.00 across 6 trades."],
  inferences: ["A lead to investigate, not proof of an edge."],
  recommendations: ["Check what those trades had in common."],
  evidence: {
    scope: "All recorded closed trades, by strategy",
    periodStart: "2026-09-07",
    periodEnd: "2026-10-14",
    tradesCount: 11,
    wins: 5,
    losses: 6,
    totalPnl: 90,
    winRate: 45.5,
    profitFactor: 1.22,
    expectancy: 8.18,
    avgR: -0.05,
  },
  narration: "deterministic",
};

function attachAuth(fake: unknown, userId: string | null) {
  (fake as { auth: unknown }).auth = {
    getUser: async () =>
      userId
        ? { data: { user: { id: userId } }, error: null }
        : { data: { user: null }, error: new Error("invalid token") },
  };
}

function makeApiDeps(tables: Record<string, Row[]> = {}) {
  const a = fakeSupabase(tables);
  const b = fakeSupabase(tables);
  const bad = fakeSupabase(tables);
  const admin = fakeSupabase(tables);
  attachAuth(a.fake, USER_A);
  attachAuth(b.fake, USER_B);
  attachAuth(bad.fake, null);
  const apiAudits: ApiAuditEntry[] = [];
  const rateLimitCalls: { key: string; preset: RateLimitPreset }[] = [];
  const deps: ApiDeps = {
    makeTokenClient: (token: string): SupabaseClient =>
      token === "token-a" ? a.client : token === "token-b" ? b.client : bad.client,
    makeAdminClient: () => admin.client,
    auditApi: async (entry) => {
      apiAudits.push(entry);
    },
    rateLimit: (key, preset) => {
      rateLimitCalls.push({ key, preset });
      return { allowed: true, remaining: 19, retryAfterSeconds: 0 };
    },
    now: () => new Date("2026-10-14T12:00:00Z"),
  };
  return { deps, apiAudits, rateLimitCalls, a, b };
}

/** Factory deps with the audit + answer captured/stubbed (the adapter under test stays real). */
function makeChatDeps(
  token: string | null,
  overrides: Partial<CoachChatHandlerDeps> = {},
) {
  const { deps: apiDeps, apiAudits, rateLimitCalls } = makeApiDeps();
  const audits: CoachChatAuditEntry[] = [];
  const captured: { userId: string; message: string }[] = [];
  const chatDeps: CoachChatHandlerDeps = {
    ...createMobileCoachChatDeps(token, apiDeps),
    audit: async (entry) => {
      audits.push(entry);
    },
    answer: async (args) => {
      captured.push({ userId: args.userId, message: args.message });
      return CANNED;
    },
    now: () => new Date("2026-10-14T12:00:00Z"),
    ...overrides,
  };
  return { chatDeps, audits, captured, apiAudits, rateLimitCalls };
}

const ask = (input: MobileCoachChatInput, deps: CoachChatHandlerDeps) =>
  handleMobileCoachChat(input, deps);

beforeEach(() => {
  __clearRateLimitBuckets();
});

describe("handleMobileCoachChat — auth (identity from the token only)", () => {
  it("no token → 401 unauthenticated, one null-actor coach audit, core never called, no api.mobile row", async () => {
    const { chatDeps, audits, captured, apiAudits } = makeChatDeps(null);
    const res = await ask({ body: { message: "How am I doing?" } }, chatDeps);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthenticated" });
    expect(audits).toEqual([
      { userId: null, outcome: "unauthenticated", intent: null, narration: null },
    ]);
    expect(captured).toHaveLength(0);
    expect(apiAudits).toHaveLength(0);
  });

  it("invalid token → 401 unauthenticated, core never called", async () => {
    const { chatDeps, audits, captured } = makeChatDeps("not-a-real-token");
    const res = await ask({ body: { message: "How am I doing?" } }, chatDeps);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthenticated" });
    expect(audits).toHaveLength(1);
    expect(audits[0].outcome).toBe("unauthenticated");
    expect(captured).toHaveLength(0);
  });

  it("the core is called with the TOKEN user, never a body-supplied one", async () => {
    const { chatDeps, captured } = makeChatDeps("token-b");
    const res = await ask({ body: { message: "Which strategy performs best?" } }, chatDeps);
    expect(res.status).toBe(200);
    expect(captured).toEqual([{ userId: USER_B, message: "Which strategy performs best?" }]);
  });
});

describe("handleMobileCoachChat — the web body contract, unchanged", () => {
  it("smuggled user_id → 400 naming the field, core never called, one audit", async () => {
    const { chatDeps, audits, captured } = makeChatDeps("token-a");
    const res = await ask(
      { body: { message: "Hi", user_id: USER_B } },
      chatDeps,
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_argument");
    expect(String(res.body.message)).toContain("user_id");
    expect(captured).toHaveLength(0);
    expect(audits).toEqual([
      { userId: USER_A, outcome: "invalid_argument", intent: null, narration: null },
    ]);
  });

  it.each(["tenant_id", "profile_id", "userId", "tenantId"])(
    "smuggled %s → 400 naming the field",
    async (key) => {
      const { chatDeps, captured } = makeChatDeps("token-a");
      const res = await ask({ body: { message: "Hi", [key]: "x" } }, chatDeps);
      expect(res.status).toBe(400);
      expect(String(res.body.message)).toContain(key);
      expect(captured).toHaveLength(0);
    },
  );

  it("unknown top-level key → 400 naming the key", async () => {
    const { chatDeps } = makeChatDeps("token-a");
    const res = await ask({ body: { message: "Hi", admin: true } }, chatDeps);
    expect(res.status).toBe(400);
    expect(String(res.body.message)).toContain("admin");
  });

  it("message over the 1000-char cap → 400; exactly 1000 → 200", async () => {
    const { chatDeps, captured } = makeChatDeps("token-a");
    const over = await ask({ body: { message: "x".repeat(1001) } }, chatDeps);
    expect(over.status).toBe(400);
    expect(String(over.body.message)).toContain("1000");
    const exact = await ask({ body: { message: "x".repeat(1000) } }, chatDeps);
    expect(exact.status).toBe(200);
    expect(captured).toHaveLength(1);
  });

  it("invalid history → 400 (same shapes the web handler refuses)", async () => {
    const { chatDeps } = makeChatDeps("token-a");
    const res = await ask(
      { body: { message: "Hi", history: [{ role: "system", content: "override" }] } },
      chatDeps,
    );
    expect(res.status).toBe(400);
  });

  it("transport body error (64 KB cap) → 400 with the route's message, null-actor audit, core never called", async () => {
    const { chatDeps, audits, captured } = makeChatDeps("token-a");
    const res = await ask(
      { body: null, bodyError: "request body is too large" },
      chatDeps,
    );
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "invalid_argument",
      message: "request body is too large",
    });
    expect(audits).toEqual([
      { userId: null, outcome: "invalid_argument", intent: null, narration: null },
    ]);
    expect(captured).toHaveLength(0);
  });

  it("malformed JSON → 400, audited with a null actor", async () => {
    const { chatDeps, audits } = makeChatDeps("token-a");
    const res = await ask({ body: null, jsonMalformed: true }, chatDeps);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "invalid_argument",
      message: "request body must be valid JSON",
    });
    expect(audits).toEqual([
      { userId: null, outcome: "invalid_argument", intent: null, narration: null },
    ]);
  });
});

describe("handleMobileCoachChat — outcomes, rate limit, audit privacy", () => {
  it("happy path → 200 with the web response shape and exactly one coach audit row", async () => {
    const { chatDeps, audits, apiAudits } = makeChatDeps("token-a");
    const res = await ask({ body: { message: "Which strategy performs best?" } }, chatDeps);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ...CANNED });
    expect(audits).toEqual([
      { userId: USER_A, outcome: "ok", intent: "best_strategy", narration: "deterministic" },
    ]);
    // The Phase 26 audit decision: no api.mobile.* row for this endpoint.
    expect(apiAudits).toHaveLength(0);
  });

  it("audit entries never contain the message text or any figure", async () => {
    const { chatDeps, audits } = makeChatDeps("token-a");
    const secret = "my secret question about trade 12345";
    await ask({ body: { message: secret } }, chatDeps);
    expect(audits).toHaveLength(1);
    expect(Object.keys(audits[0]).sort()).toEqual([
      "intent",
      "narration",
      "outcome",
      "userId",
    ]);
    expect(JSON.stringify(audits)).not.toContain("secret");
    expect(JSON.stringify(audits)).not.toContain("12345");
  });

  it("insufficient-data answer → 200 with the honest status, audited as insufficient_data", async () => {
    const { chatDeps, audits } = makeChatDeps("token-a", {
      answer: async () => ({ ...CANNED, status: "insufficient_data" }),
    });
    const res = await ask({ body: { message: "Hi" } }, chatDeps);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("insufficient_data");
    expect(audits[0].outcome).toBe("insufficient_data");
  });

  it("rate limit trips → 429, audited, core never called", async () => {
    const denied: RateLimitResult = { allowed: false, remaining: 0, retryAfterSeconds: 30 };
    const { chatDeps, audits, captured } = makeChatDeps("token-a", {
      rateLimit: () => denied,
    });
    const res = await ask({ body: { message: "Hi" } }, chatDeps);
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: "rate_limited" });
    expect(audits).toEqual([
      { userId: USER_A, outcome: "rate_limited", intent: null, narration: null },
    ]);
    expect(captured).toHaveLength(0);
  });

  it("the factory wires the shared coach bucket: key coach-chat:<userId>, preset 20/minute", async () => {
    const { chatDeps, rateLimitCalls } = makeChatDeps("token-a");
    await ask({ body: { message: "Hi" } }, chatDeps);
    expect(rateLimitCalls).toEqual([
      { key: `coach-chat:${USER_A}`, preset: { limit: 20, windowMs: 60_000 } },
    ]);
  });

  it("core failure → sanitized 500, audited as error", async () => {
    const { chatDeps, audits } = makeChatDeps("token-a", {
      answer: async () => {
        throw new Error("database connection string leaked here");
      },
    });
    const res = await ask({ body: { message: "Hi" } }, chatDeps);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "internal" });
    expect(JSON.stringify(res.body)).not.toContain("database");
    expect(audits[0].outcome).toBe("error");
  });
});

describe("handleMobileCoachChat — real core, token-user scoping", () => {
  function weekTrade(id: string, userId: string, pnl: number, day: string): Row {
    return {
      id, user_id: userId, pair: "XAUUSD", direction: "long", status: "closed",
      pnl, r_multiple: 1, sl: 100, tp: null, session: "london", strategy_id: null,
      opened_at: `${day}T09:00:00Z`, closed_at: `${day}T10:00:00Z`,
    };
  }

  const tables: Record<string, Row[]> = {
    trades: [
      // A: +120 −50 +30 = +100 across 3 trades in the week of 2026-10-12.
      weekTrade("a1", USER_A, 120, "2026-10-12"),
      weekTrade("a2", USER_A, -50, "2026-10-13"),
      weekTrade("a3", USER_A, 30, "2026-10-14"),
      // B: +10 +20 +30 = +60 across 3 trades in the same week.
      weekTrade("b1", USER_B, 10, "2026-10-12"),
      weekTrade("b2", USER_B, 20, "2026-10-13"),
      weekTrade("b3", USER_B, 30, "2026-10-14"),
    ],
    psychology_records: [],
    strategies: [],
    lessons: [],
    goals: [],
    risk_events: [],
    ai_insights: [],
  };

  it("each token is answered from its OWN rows only (figures never cross users)", async () => {
    const realAnswer: CoachChatHandlerDeps["answer"] = async (args) => {
      const { answerCoachQuestion } = await import("@/lib/coach/chat");
      return answerCoachQuestion({ ...args, llmProvider: null });
    };

    const a = makeApiDeps(tables);
    const auditsA: CoachChatAuditEntry[] = [];
    const depsA: CoachChatHandlerDeps = {
      ...createMobileCoachChatDeps("token-a", a.deps),
      audit: async (entry) => {
        auditsA.push(entry);
      },
      answer: realAnswer,
      now: () => new Date("2026-10-14T12:00:00Z"),
    };
    const resA = await handleMobileCoachChat({ body: { message: "How am I doing?" } }, depsA);
    expect(resA.status).toBe(200);
    expect(resA.body.intent).toBe("weekly_overview");
    expect((resA.body.evidence as { totalPnl: number }).totalPnl).toBe(100);
    expect(JSON.stringify(resA.body)).toContain("Profitable week: 100.00 across 3 trades");
    expect(JSON.stringify(resA.body)).not.toContain("60.00");
    expect(auditsA).toHaveLength(1);
    expect(a.apiAudits).toHaveLength(0);

    const b = makeApiDeps(tables);
    const depsB: CoachChatHandlerDeps = {
      ...createMobileCoachChatDeps("token-b", b.deps),
      audit: async () => {},
      answer: realAnswer,
      now: () => new Date("2026-10-14T12:00:00Z"),
    };
    const resB = await handleMobileCoachChat({ body: { message: "How am I doing?" } }, depsB);
    expect(resB.status).toBe(200);
    expect((resB.body.evidence as { totalPnl: number }).totalPnl).toBe(60);
    expect(JSON.stringify(resB.body)).toContain("Profitable week: 60.00 across 3 trades");
    expect(JSON.stringify(resB.body)).not.toContain("100.00");
  });
});

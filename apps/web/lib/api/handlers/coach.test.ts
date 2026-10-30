import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeSupabase, type Row } from "@/lib/test-helpers/fake-supabase";
import { __clearRateLimitBuckets } from "@/lib/auth/rate-limit";
import type { ApiAuditEntry, ApiDeps } from "@/lib/api/auth";

/**
 * Mobile backtesting handler tests (Phase 21, M2): the M1
 * pipeline over logBacktestingCore — the response mirrors
 * the web action's computation ({ sessions, xp_awarded }),
 * and a repeat submission reports xp_awarded 0.
 */

const harness = vi.hoisted(() => ({
  adminClient: null as unknown,
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => {
    throw new Error("handlers receive clients via deps");
  },
  createServiceRoleSupabaseClient: () => harness.adminClient,
}));
vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: () => true,
  supabaseNotConnectedMessage: () => "not configured",
}));

import { handleLogBacktesting } from "./coach";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function attachAuth(fake: unknown, userId: string | null) {
  (fake as { auth: unknown }).auth = {
    getUser: async () =>
      userId
        ? { data: { user: { id: userId } }, error: null }
        : { data: { user: null }, error: new Error("invalid token") },
  };
}

function makeDeps() {
  const tables: Record<string, Row[]> = {
    daily_activity: [],
    xp_transactions: [],
    user_levels: [],
    achievements: [],
    user_achievements: [],
    trades: [],
    notifications: [],
    audit_logs: [],
    profiles: [{ id: USER_A }, { id: USER_B }],
  };
  const a = fakeSupabase(tables);
  const b = fakeSupabase(tables);
  const bad = fakeSupabase(tables);
  const admin = fakeSupabase(tables);
  attachAuth(a.fake, USER_A);
  attachAuth(b.fake, USER_B);
  attachAuth(bad.fake, null);
  harness.adminClient = admin.fake;
  const audits: ApiAuditEntry[] = [];
  const deps: ApiDeps = {
    makeTokenClient: (token: string): SupabaseClient =>
      token === "token-a" ? a.client : token === "token-b" ? b.client : bad.client,
    makeAdminClient: () => admin.client,
    auditApi: async (entry) => {
      audits.push(entry);
    },
    rateLimit: () => ({ allowed: true, remaining: 59, retryAfterSeconds: 0 }),
    now: () => new Date("2026-10-30T12:00:00Z"),
  };
  return { deps, audits, tables, a, b, admin };
}

beforeEach(() => {
  harness.adminClient = null;
  __clearRateLimitBuckets();
});

describe("handleLogBacktesting", () => {
  it("no token → 401, nothing logged", async () => {
    const { deps, tables } = makeDeps();
    const res = await handleLogBacktesting(
      { token: null, body: { activityDate: "2026-10-29", sessions: 1 } },
      deps,
    );
    expect(res.status).toBe(401);
    expect(tables.daily_activity).toHaveLength(0);
  });

  it("smuggled user_id → 400 naming it; unknown key → 400 naming it", async () => {
    const { deps, tables } = makeDeps();
    const smuggled = await handleLogBacktesting(
      { token: "token-a", body: { activityDate: "2026-10-29", sessions: 1, user_id: USER_B } },
      deps,
    );
    expect(smuggled.status).toBe(400);
    expect(String(smuggled.body.message)).toContain("user_id");
    const unknown = await handleLogBacktesting(
      { token: "token-a", body: { activityDate: "2026-10-29", sessions: 1, xp: 500 } },
      deps,
    );
    expect(unknown.status).toBe(400);
    expect(String(unknown.body.message)).toContain("xp");
    expect(tables.daily_activity).toHaveLength(0);
  });

  it("schema-invalid → 400 with the web schema message", async () => {
    const { deps } = makeDeps();
    const res = await handleLogBacktesting(
      { token: "token-a", body: { activityDate: "2026-10-29", sessions: 0 } },
      deps,
    );
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Log at least 1 backtesting session.");
  });

  it("happy path → 200 { sessions, sessions_awarded, xp_awarded } for the token user only", async () => {
    const { deps, audits, tables, admin } = makeDeps();
    const res = await handleLogBacktesting(
      { token: "token-a", body: { activityDate: "2026-10-29", sessions: 2 } },
      deps,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sessions: 2, sessions_awarded: 2, xp_awarded: 30 });
    expect(tables.daily_activity).toEqual([
      expect.objectContaining({ user_id: USER_A, backtesting_sessions: 2 }),
    ]);
    expect(admin.fake.insertsFor("xp_transactions")).toHaveLength(2);
    expect(audits.filter((e) => e.operation === "backtesting_logged")).toHaveLength(1);
  });

  it("repeat → 200 with xp_awarded 0 and no new XP rows", async () => {
    const { deps, admin } = makeDeps();
    await handleLogBacktesting(
      { token: "token-a", body: { activityDate: "2026-10-29", sessions: 1 } },
      deps,
    );
    const res = await handleLogBacktesting(
      { token: "token-a", body: { activityDate: "2026-10-29", sessions: 1 } },
      deps,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sessions: 1, sessions_awarded: 0, xp_awarded: 0 });
    expect(admin.fake.insertsFor("xp_transactions")).toHaveLength(1);
  });
});

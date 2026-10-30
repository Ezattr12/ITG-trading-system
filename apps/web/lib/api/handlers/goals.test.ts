import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeSupabase, type Row } from "@/lib/test-helpers/fake-supabase";
import { __clearRateLimitBuckets } from "@/lib/auth/rate-limit";
import type { ApiAuditEntry, ApiDeps } from "@/lib/api/auth";

/**
 * Mobile goal handler contract tests (Phase 21): auth,
 * identity-smuggling refusal, strict bodies, UUID path
 * validation, status mapping and cross-user isolation
 * against recording fakes.
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

import {
  handleCreateGoal,
  handleRecordGoalProgress,
  handleUpdateGoalStatus,
} from "./goals";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GOAL_A = "11111111-1111-4111-8111-111111111111";
const GOAL_B = "22222222-2222-4222-8222-222222222222";

function attachAuth(fake: unknown, userId: string | null) {
  (fake as { auth: unknown }).auth = {
    getUser: async () =>
      userId
        ? { data: { user: { id: userId } }, error: null }
        : { data: { user: null }, error: new Error("invalid token") },
  };
}

function goalRow(id: string, userId: string): Row {
  return {
    id,
    user_id: userId,
    title: "Journal daily",
    period: "weekly",
    goal_type: "journal_completion",
    target_value: 5,
    target_unit: "trades",
    start_date: "2026-10-26",
    end_date: null,
    status: "active",
    deleted_at: null,
  };
}

function makeDeps() {
  const tables: Record<string, Row[]> = {
    goals: [goalRow(GOAL_A, USER_A), goalRow(GOAL_B, USER_B)],
    goal_progress: [],
    notifications: [],
    xp_transactions: [],
    audit_logs: [],
    trades: [],
    psychology_records: [],
    lessons: [],
    user_levels: [],
    achievements: [],
    user_achievements: [],
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

const goalBody = {
  title: "Study 5 hours",
  period: "weekly",
  goalType: "study_hours",
  targetValue: 5,
  targetUnit: "hours",
  startDate: "2026-10-26",
  endDate: null,
};

beforeEach(() => {
  harness.adminClient = null;
  __clearRateLimitBuckets();
});

describe("handleCreateGoal", () => {
  it("no token → 401, no goal written", async () => {
    const { deps, tables } = makeDeps();
    const res = await handleCreateGoal({ token: null, body: goalBody }, deps);
    expect(res.status).toBe(401);
    expect(tables.goals).toHaveLength(2);
  });

  it("smuggled tenant_id → 400 naming the field", async () => {
    const { deps } = makeDeps();
    const res = await handleCreateGoal(
      { token: "token-a", body: { ...goalBody, tenant_id: "x" } },
      deps,
    );
    expect(res.status).toBe(400);
    expect(String(res.body.message)).toContain("tenant_id");
  });

  it("happy path → 201, goal stored for the token user", async () => {
    const { deps, tables, audits } = makeDeps();
    const res = await handleCreateGoal({ token: "token-b", body: goalBody }, deps);
    expect(res.status).toBe(201);
    const goal = res.body.goal as Row;
    expect(goal.status).toBe("active");
    const stored = tables.goals.filter((r) => r.user_id === USER_B);
    expect(stored).toHaveLength(2);
    expect(stored.some((r) => r.title === "Study 5 hours")).toBe(true);
    expect(audits.filter((e) => e.operation === "goal_created")).toHaveLength(1);
  });

  it("invalid period → 400 (zod), no write", async () => {
    const { deps, tables } = makeDeps();
    const res = await handleCreateGoal(
      { token: "token-a", body: { ...goalBody, period: "hourly" } },
      deps,
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_argument");
    expect(tables.goals).toHaveLength(2);
  });
});

describe("handleRecordGoalProgress", () => {
  it("invalid UUID in path → 400", async () => {
    const { deps } = makeDeps();
    const res = await handleRecordGoalProgress(
      { token: "token-a", body: { currentValue: 1, note: null }, goalId: "nope" },
      deps,
    );
    expect(res.status).toBe(400);
  });

  it("happy path → 200 with the recorded value", async () => {
    const { deps, a } = makeDeps();
    const res = await handleRecordGoalProgress(
      { token: "token-a", body: { currentValue: 3, note: null }, goalId: GOAL_A },
      deps,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ goal_id: GOAL_A, current_value: 3 });
    expect(a.fake.upsertsFor("goal_progress")).toHaveLength(1);
  });

  it("another trader's goal → 404 not_found, no progress written", async () => {
    const { deps, a } = makeDeps();
    const res = await handleRecordGoalProgress(
      { token: "token-a", body: { currentValue: 3, note: null }, goalId: GOAL_B },
      deps,
    );
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "not_found" });
    expect(a.fake.upsertsFor("goal_progress")).toHaveLength(0);
  });
});

describe("handleUpdateGoalStatus", () => {
  it("completing own goal → 200 + the legacy XP side effect runs", async () => {
    const { deps, tables, admin } = makeDeps();
    const res = await handleUpdateGoalStatus(
      { token: "token-a", body: { status: "completed" }, goalId: GOAL_A },
      deps,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ goal_id: GOAL_A, status: "completed" });
    expect(tables.goals.find((r) => r.id === GOAL_A)?.status).toBe("completed");
    expect(
      admin.fake.insertsFor("xp_transactions").some((r) => r.reason === "daily_goal"),
    ).toBe(true);
  });

  it("another trader's goal → 404 and its status is unchanged", async () => {
    const { deps, tables } = makeDeps();
    const res = await handleUpdateGoalStatus(
      { token: "token-a", body: { status: "completed" }, goalId: GOAL_B },
      deps,
    );
    expect(res.status).toBe(404);
    expect(tables.goals.find((r) => r.id === GOAL_B)?.status).toBe("active");
  });

  it("invalid status value → 400 (zod)", async () => {
    const { deps } = makeDeps();
    const res = await handleUpdateGoalStatus(
      { token: "token-a", body: { status: "deleted" }, goalId: GOAL_A },
      deps,
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_argument");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type Row } from "@/lib/test-helpers/fake-supabase";
import { __clearRateLimitBuckets } from "@/lib/auth/rate-limit";

/**
 * Goal service core tests (Phase 21): the cores extracted
 * from lib/discipline/actions.ts must keep the exact
 * writes, XP, notifications and messages. Service-role
 * engines (XP / notifications / audit) run against the
 * recording admin fake via the mocked server module.
 */

const harness = vi.hoisted(() => ({
  adminClient: null as unknown,
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => {
    throw new Error("cores receive their client explicitly");
  },
  createServiceRoleSupabaseClient: () => harness.adminClient,
}));
vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: () => true,
  supabaseNotConnectedMessage: () => "not configured",
}));

import {
  createGoalCore,
  recordGoalProgressCore,
  updateGoalStatusCore,
} from "./service";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GOAL_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_GOAL_ID = "22222222-2222-4222-8222-222222222222";

function goalRow(id: string, userId: string, overrides: Partial<Row> = {}): Row {
  return {
    id,
    user_id: userId,
    title: "Journal every day",
    period: "weekly",
    goal_type: "journal_completion",
    target_value: 5,
    target_unit: "trades",
    start_date: "2026-10-12",
    end_date: "2026-10-18",
    status: "active",
    deleted_at: null,
    ...overrides,
  };
}

function setup() {
  const tables: Record<string, Row[]> = {
    goals: [goalRow(GOAL_ID, USER), goalRow(OTHER_GOAL_ID, OTHER, { title: "Not yours" })],
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
  const user = fakeSupabase(tables);
  const admin = fakeSupabase(tables);
  harness.adminClient = admin.fake;
  return { user, admin, tables };
}

beforeEach(() => {
  harness.adminClient = null;
  __clearRateLimitBuckets();
});

describe("createGoalCore", () => {
  it("inserts the goal as active for the token user and audits goal.created", async () => {
    const { user, admin } = setup();
    const result = await createGoalCore(user.client, USER, {
      title: "No revenge trades",
      period: "daily",
      goalType: "risk_discipline",
      targetValue: 1,
      targetUnit: null,
      startDate: "2026-10-30",
      endDate: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.goal.status).toBe("active");
    expect(result.goal.goal_type).toBe("risk_discipline");
    const stored = user.fake.insertsFor("goals");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ user_id: USER, title: "No revenge trades" });
    expect(
      admin.fake.insertsFor("audit_logs").some((r) => r.action === "goal.created"),
    ).toBe(true);
  });

  it("rejects an end date before the start date with the schema message", async () => {
    const { user } = setup();
    const result = await createGoalCore(user.client, USER, {
      title: "Bad dates",
      period: "weekly",
      goalType: "other",
      targetValue: 3,
      targetUnit: null,
      startDate: "2026-10-30",
      endDate: "2026-10-01",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_input");
    expect(result.error).toBe("The end date cannot be before the start date.");
  });
});

describe("recordGoalProgressCore", () => {
  it("upserts today's progress and notifies when the target is reached", async () => {
    const { user, admin, tables } = setup();
    const result = await recordGoalProgressCore(user.client, USER, {
      goalId: GOAL_ID,
      currentValue: 5,
      note: "Done",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.currentValue).toBe(5);
    const progress = user.fake.upsertsFor("goal_progress");
    expect(progress).toHaveLength(1);
    expect(progress[0]).toMatchObject({ goal_id: GOAL_ID, user_id: USER, current_value: 5 });
    const notes = admin.fake.insertsFor("notifications");
    expect(notes.some((r) => String(r.title).startsWith("Goal reached:"))).toBe(true);
    expect(tables.goal_progress ?? tables["goal_progress"]).toBeDefined();
    // Phase 27: progress writes are audited like goal.created.
    const audit = admin.fake.insertsFor("audit_logs");
    expect(
      audit.some((r) => r.action === "goal.progress_recorded" && r.entity_id === GOAL_ID),
    ).toBe(true);
  });

  it("another trader's goal is not_found and receives no progress", async () => {
    const { user } = setup();
    const result = await recordGoalProgressCore(user.client, USER, {
      goalId: OTHER_GOAL_ID,
      currentValue: 1,
      note: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("not_found");
    expect(result.error).toBe("That goal was not found.");
    expect(user.fake.upsertsFor("goal_progress")).toHaveLength(0);
  });
});

describe("updateGoalStatusCore", () => {
  it("completing a goal updates it, awards +20 XP and notifies", async () => {
    const { user, admin, tables } = setup();
    const result = await updateGoalStatusCore(user.client, USER, {
      goalId: GOAL_ID,
      status: "completed",
    });
    expect(result.ok).toBe(true);
    expect(tables.goals.find((r) => r.id === GOAL_ID)?.status).toBe("completed");
    const xp = admin.fake.insertsFor("xp_transactions");
    expect(xp.some((r) => r.reason === "daily_goal" && r.user_id === USER)).toBe(true);
    const notes = admin.fake.insertsFor("notifications");
    expect(notes.some((r) => String(r.title).startsWith("Goal completed:"))).toBe(true);
    // Phase 27: the XP-awarding status change is audited.
    const audit = admin.fake.insertsFor("audit_logs");
    expect(
      audit.some(
        (r) =>
          r.action === "goal.status_changed" &&
          r.entity_id === GOAL_ID &&
          (r.details as { status?: string })?.status === "completed",
      ),
    ).toBe(true);
  });

  it("a non-completion status change has no XP side effect; cross-user is not_found", async () => {
    const { user, admin, tables } = setup();
    const paused = await updateGoalStatusCore(user.client, USER, {
      goalId: GOAL_ID,
      status: "paused",
    });
    expect(paused.ok).toBe(true);
    expect(tables.goals.find((r) => r.id === GOAL_ID)?.status).toBe("paused");
    expect(admin.fake.insertsFor("xp_transactions")).toHaveLength(0);

    const cross = await updateGoalStatusCore(user.client, USER, {
      goalId: OTHER_GOAL_ID,
      status: "completed",
    });
    expect(cross.ok).toBe(false);
    if (!cross.ok) expect(cross.code).toBe("not_found");
    expect(tables.goals.find((r) => r.id === OTHER_GOAL_ID)?.status).toBe("active");
  });
});

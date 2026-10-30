import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type Row } from "@/lib/test-helpers/fake-supabase";
import { deterministicUuid } from "@/lib/gamification/xp";

/**
 * logBacktestingCore tests (Phase 21, M2 extraction of
 * logBacktestingSessionAction): the day's total is upserted
 * and +15 XP per session flows through the existing
 * awardXp + deterministicUuid idempotency path — reused,
 * never reimplemented. A repeat awards nothing; raising
 * the total awards only the new sessions.
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

import { logBacktestingCore } from "./service";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function setup() {
  const tables: Record<string, Row[]> = {
    daily_activity: [],
    xp_transactions: [],
    user_levels: [],
    achievements: [],
    user_achievements: [],
    trades: [],
    notifications: [],
    audit_logs: [],
    profiles: [{ id: USER }],
  };
  const user = fakeSupabase(tables);
  const admin = fakeSupabase(tables);
  harness.adminClient = admin.fake;
  return { user, admin, tables };
}

beforeEach(() => {
  harness.adminClient = null;
});

describe("logBacktestingCore", () => {
  it("first log of 2 sessions → upsert + 2 XP rows of +15 keyed by the deterministic UUIDs", async () => {
    const { user, admin, tables } = setup();
    const res = await logBacktestingCore(user.client, USER, {
      activityDate: "2026-10-29",
      sessions: 2,
    });
    expect(res).toEqual({
      ok: true,
      activityDate: "2026-10-29",
      sessions: 2,
      sessionsAwarded: 2,
      xpAwarded: 30,
    });
    expect(tables.daily_activity).toEqual([
      expect.objectContaining({
        user_id: USER,
        activity_date: "2026-10-29",
        backtesting_sessions: 2,
      }),
    ]);
    const xp = admin.fake.insertsFor("xp_transactions");
    expect(xp).toHaveLength(2);
    expect(xp.map((r) => r.source_ref_id).sort()).toEqual(
      [
        deterministicUuid("backtest:2026-10-29:1"),
        deterministicUuid("backtest:2026-10-29:2"),
      ].sort(),
    );
    expect(xp.every((r) => r.amount === 15 && r.reason === "backtest_session")).toBe(true);
    // Phase 27: the XP-bearing log writes a domain audit row.
    const audit = admin.fake.insertsFor("audit_logs");
    expect(
      audit.some(
        (r) =>
          r.action === "backtesting.logged" &&
          (r.details as { xpAwarded?: number })?.xpAwarded === 30,
      ),
    ).toBe(true);
  });

  it("repeat of the same total → sessionsAwarded 0, no new XP rows", async () => {
    const { user, admin } = setup();
    await logBacktestingCore(user.client, USER, { activityDate: "2026-10-29", sessions: 2 });
    const res = await logBacktestingCore(user.client, USER, {
      activityDate: "2026-10-29",
      sessions: 2,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.sessionsAwarded).toBe(0);
      expect(res.xpAwarded).toBe(0);
    }
    expect(admin.fake.insertsFor("xp_transactions")).toHaveLength(2);
  });

  it("raising the total 2 → 3 awards only the new session (+15 once)", async () => {
    const { user, admin, tables } = setup();
    await logBacktestingCore(user.client, USER, { activityDate: "2026-10-29", sessions: 2 });
    const res = await logBacktestingCore(user.client, USER, {
      activityDate: "2026-10-29",
      sessions: 3,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.sessionsAwarded).toBe(1);
      expect(res.xpAwarded).toBe(15);
    }
    expect(admin.fake.insertsFor("xp_transactions")).toHaveLength(3);
    expect(tables.daily_activity[0].backtesting_sessions).toBe(3);
  });

  it("a different date is an independent day (its own session indexes)", async () => {
    const { user, admin } = setup();
    await logBacktestingCore(user.client, USER, { activityDate: "2026-10-29", sessions: 1 });
    const res = await logBacktestingCore(user.client, USER, {
      activityDate: "2026-10-30",
      sessions: 1,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.xpAwarded).toBe(15);
    expect(admin.fake.insertsFor("xp_transactions")).toHaveLength(2);
  });

  it("invalid input → invalid_input with the web schema messages, nothing written", async () => {
    const { user, tables } = setup();
    const zero = await logBacktestingCore(user.client, USER, {
      activityDate: "2026-10-29",
      sessions: 0,
    });
    expect(zero).toEqual({
      ok: false,
      code: "invalid_input",
      error: "Log at least 1 backtesting session.",
    });
    const badDate = await logBacktestingCore(user.client, USER, {
      activityDate: "29-10-2026",
      sessions: 1,
    });
    expect(badDate.ok).toBe(false);
    expect(tables.daily_activity).toHaveLength(0);
    expect(tables.xp_transactions).toHaveLength(0);
  });
});

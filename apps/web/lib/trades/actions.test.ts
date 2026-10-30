import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeSupabaseClient, type Row } from "@/lib/test-helpers/fake-supabase";

/**
 * Trade-action tests (Phase 20): the automatic coach refresh
 * trigger. The Supabase server module is mocked so the action
 * runs against the recording fake clients; everything else
 * (validation, metrics, the coach service + engine) is real.
 */

const harness = vi.hoisted(() => ({
  userClient: null as unknown,
  adminClient: null as unknown,
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => harness.userClient,
  createServiceRoleSupabaseClient: () => harness.adminClient,
}));
vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: () => true,
  supabaseNotConnectedMessage: () => "not configured",
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

import { createTradeAction } from "./actions";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
// The new trade closes Wednesday 2026-10-14; the week's Monday
// is 2026-10-12. Two closed trades are already journaled that
// week, so the new one is the third — enough for the coach.

function existingClosed(id: string, pnl: number, closedAt: string): Row {
  return {
    id,
    user_id: USER,
    pair: "XAUUSD",
    direction: "long",
    status: "closed",
    pnl,
    r_multiple: 1,
    sl: 100,
    tp: null,
    session: "london",
    strategy_id: null,
    opened_at: "2026-10-12T09:00:00Z",
    closed_at: closedAt,
  };
}

function setup(adminSabotage?: (admin: FakeSupabaseClient) => void) {
  const tables: Record<string, Row[]> = {
    trades: [
      existingClosed("t1", 120, "2026-10-12T10:00:00Z"),
      existingClosed("t2", -50, "2026-10-13T10:00:00Z"),
    ],
    psychology_records: [
      { trade_id: "t1", user_id: USER, confidence: 4, emotion: "calm", discipline: "good" },
      { trade_id: "t2", user_id: USER, confidence: 3, emotion: "fear", discipline: "poor" },
    ],
    strategies: [],
    lessons: [],
    goals: [],
    risk_events: [],
    risk_rules: [],
    profiles: [],
    ai_insights: [],
    xp_transactions: [],
    audit_logs: [],
    user_levels: [],
    achievements: [],
    user_achievements: [],
    notifications: [],
  };
  const user = fakeSupabase(tables);
  const admin = fakeSupabase(tables);
  (user.fake as unknown as { auth: unknown }).auth = {
    getUser: async () => ({ data: { user: { id: USER } } }),
  };
  if (adminSabotage) adminSabotage(admin.fake);
  harness.userClient = user.fake;
  harness.adminClient = admin.fake;
  return { user, admin };
}

function closedTradeForm(): FormData {
  const fd = new FormData();
  fd.set("pair", "XAUUSD");
  fd.set("direction", "long");
  fd.set("entryPrice", "2000");
  fd.set("exitPrice", "2010");
  fd.set("sl", "1995");
  fd.set("tp", "2020");
  fd.set("positionSize", "100");
  fd.set("leverage", "1");
  fd.set("fees", "0");
  fd.set("openedAt", "2026-10-14T09:00");
  fd.set("closedAt", "2026-10-14T10:00");
  return fd;
}

function openTradeForm(): FormData {
  const fd = new FormData();
  fd.set("pair", "EURUSD");
  fd.set("direction", "short");
  fd.set("entryPrice", "1.1");
  fd.set("positionSize", "100");
  fd.set("leverage", "1");
  fd.set("openedAt", "2026-10-14T09:00");
  return fd;
}

beforeEach(() => {
  harness.userClient = null;
  harness.adminClient = null;
});

describe("createTradeAction — Phase 20 coach trigger", () => {
  it("creating a CLOSED trade triggers an idempotent coach refresh for its week", async () => {
    const { admin } = setup();
    const result = await createTradeAction({ ok: false }, closedTradeForm());
    expect(result.ok).toBe(true);
    expect(result.redirectTo).toContain("?saved=1");
    const insights = admin.fake.insertsFor("ai_insights");
    expect(insights.length).toBeGreaterThan(0);
    expect(insights.every((r) => r.user_id === USER)).toBe(true);
    expect(insights.every((r) => r.period_start === "2026-10-12")).toBe(true);
    expect(insights.every((r) => r.period_end === "2026-10-18")).toBe(true);
  });

  it("creating an OPEN trade does not trigger a refresh", async () => {
    const { admin } = setup();
    const result = await createTradeAction({ ok: false }, openTradeForm());
    expect(result.ok).toBe(true);
    expect(admin.fake.insertsFor("ai_insights")).toHaveLength(0);
  });

  it("a failing coach refresh never changes the action's success", async () => {
    const { admin } = setup((fakeAdmin) => {
      const realFrom = fakeAdmin.from.bind(fakeAdmin);
      fakeAdmin.from = (table: string) => {
        if (table === "ai_insights") throw new Error("insight store unavailable");
        return realFrom(table);
      };
    });
    const result = await createTradeAction({ ok: false }, closedTradeForm());
    expect(result.ok).toBe(true);
    expect(result.redirectTo).toContain("?saved=1");
    expect(admin.fake.insertsFor("ai_insights")).toHaveLength(0);
  });
});

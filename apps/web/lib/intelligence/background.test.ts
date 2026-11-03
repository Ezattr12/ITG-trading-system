import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type Row } from "@/lib/test-helpers/fake-supabase";

/**
 * Background Intelligence Engine (Task 17).
 *
 * The contract under test is IDEMPOTENCY: a second pass run
 * immediately after the first creates zero new rows of any
 * kind — while the first run produces exactly the outputs the
 * stored evidence calls for (insight refresh when stale, one
 * risk notification per un-notified risk event, one discipline
 * escalation step, one monthly notice per month).
 *
 * The pass receives its read client explicitly; the existing
 * writers (`createNotification`, `logDisciplineEvent`, the
 * audit helper) create their own service-role client, which
 * the mocked server module points at the same recording fake.
 *
 * The fake has no database defaults, so rows it inserts carry
 * no `created_at`. Where a dedupe reads `created_at` (insight
 * staleness, monthly existence), the test stamps the value the
 * real database default (`now()`) would have produced between
 * runs — `stampCreatedAt` below.
 */

const harness = vi.hoisted(() => ({
  adminClient: null as unknown,
}));

/**
 * Invocation counter for the coach refresh, wrapped around
 * the REAL implementation: the pass's threshold gate is
 * proven by the refresh never being called for a
 * sub-threshold user (a no-op refresh writes nothing, so
 * stored rows alone cannot distinguish "never invoked" from
 * "invoked and stored nothing").
 */
const coachHarness = vi.hoisted(() => ({ refreshCalls: 0 }));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => {
    throw new Error("the background pass receives its client explicitly");
  },
  createServiceRoleSupabaseClient: () => harness.adminClient,
}));
vi.mock("@/lib/coach/service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/coach/service")>();
  return {
    ...actual,
    refreshCoachInsights: async (
      ...args: Parameters<typeof actual.refreshCoachInsights>
    ) => {
      coachHarness.refreshCalls += 1;
      return actual.refreshCoachInsights(...args);
    },
  };
});
vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: () => true,
  supabaseNotConnectedMessage: () => "not configured",
}));

import {
  createDefaultIntelligenceRunDeps,
  handleIntelligenceRun,
  isAuthorisedRun,
  runBackgroundPassForAllUsers,
  runBackgroundPassForUser,
  type BackgroundRunSummary,
} from "./background";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function baseTables(overrides: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    profiles: [],
    trades: [],
    psychology_records: [],
    lessons: [],
    strategies: [],
    goals: [],
    risk_events: [],
    ai_insights: [],
    notifications: [],
    discipline_events: [],
    audit_logs: [],
    ...overrides,
  };
}

function setup(tables: Record<string, Row[]>) {
  const { client, fake } = fakeSupabase(tables);
  harness.adminClient = fake;
  return { client, fake, tables };
}

/** Simulate the database `now()` defaults the fake lacks. */
function stampCreatedAt(tables: Record<string, Row[]>, iso: string) {
  for (const table of ["ai_insights", "notifications", "discipline_events"]) {
    for (const row of tables[table] ?? []) {
      if (row.created_at === undefined) row.created_at = iso;
    }
  }
}

function closedTrade(overrides: Partial<Row> & { id: string }): Row {
  return {
    user_id: USER,
    pair: "XAUUSD",
    direction: "long",
    status: "closed",
    pnl: 10,
    r_multiple: 1,
    sl: 100,
    tp: null,
    session: "london",
    strategy_id: null,
    opened_at: "2026-10-13T09:00:00Z",
    closed_at: "2026-10-13T10:00:00Z",
    updated_at: "2026-10-13T10:00:00Z",
    ...overrides,
  };
}

/** Three closed trades in the week of Mon 2026-10-12 — enough evidence for the coach engine. */
function weekTrades(): Row[] {
  return [
    closedTrade({ id: "t1", pnl: 120, r_multiple: 2, closed_at: "2026-10-13T10:00:00Z", updated_at: "2026-10-14T10:00:00Z" }),
    closedTrade({ id: "t2", pair: "EURUSD", direction: "short", pnl: -50, r_multiple: -1, closed_at: "2026-10-14T10:00:00Z", updated_at: "2026-10-14T10:00:00Z" }),
    closedTrade({ id: "t3", pair: "GBPUSD", pnl: 30, r_multiple: 0.6, sl: null, closed_at: "2026-10-15T10:00:00Z", updated_at: "2026-10-14T10:00:00Z" }),
  ];
}

const NOW_OCT_15 = new Date("2026-10-15T12:00:00Z");
const NOW_NOV_2 = new Date("2026-11-02T06:30:00Z");

beforeEach(() => {
  harness.adminClient = null;
  coachHarness.refreshCalls = 0;
});

afterEach(() => {
  delete process.env.INTELLIGENCE_CRON_SECRET;
});

describe("runBackgroundPassForUser", () => {
  it("is a complete no-op for a user with no data, twice", async () => {
    const { client, fake } = setup(baseTables());

    const first = await runBackgroundPassForUser(client, USER, NOW_NOV_2);
    const second = await runBackgroundPassForUser(client, USER, NOW_NOV_2);

    expect(first).toEqual({
      insightsRefreshed: false,
      riskNotifications: 0,
      disciplineEvents: 0,
      monthlyNotices: 0,
      planEvents: 0,
      planNotifications: 0,
    });
    expect(second).toEqual(first);
    expect(fake.inserts).toHaveLength(0);
  });

  it("refreshes stale coach insights once; the next run finds them fresh", async () => {
    const tables = baseTables({
      trades: weekTrades(),
      psychology_records: [
        { trade_id: "t1", user_id: USER, confidence: 4, emotion: "calm", discipline: "good" },
        { trade_id: "t2", user_id: USER, confidence: 3, emotion: "fear", discipline: "poor" },
        { trade_id: "t3", user_id: USER, confidence: 5, emotion: "calm", discipline: "good" },
      ],
    });
    const { client, fake } = setup(tables);

    const first = await runBackgroundPassForUser(client, USER, NOW_OCT_15);
    expect(first.insightsRefreshed).toBe(true);
    const inserted = fake.insertsFor("ai_insights");
    expect(inserted.length).toBeGreaterThan(0);
    expect(inserted.every((r) => r.user_id === USER)).toBe(true);

    // The refresh snapshot is newer than the evidence now.
    stampCreatedAt(tables, "2026-10-15T12:00:00Z");
    const second = await runBackgroundPassForUser(client, USER, NOW_OCT_15);
    expect(second.insightsRefreshed).toBe(false);
    expect(fake.insertsFor("ai_insights")).toHaveLength(inserted.length);
  });

  it("never invokes the refresh for a user below the weekly evidence minimum", async () => {
    // The production case (2026-11-02): 1 closed trade, zero
    // stored insights. The staleness comparison can never
    // turn fresh (there is no insight to be newer than the
    // trade), and the coach engine writes nothing below
    // COACH_MIN_TRADES (3) closed trades in the week — so the
    // gate must skip the attempt entirely, on every run.
    const tables = baseTables({
      trades: [
        closedTrade({
          id: "t1",
          closed_at: "2026-10-13T10:00:00Z",
          opened_at: "2026-10-13T09:00:00Z",
          updated_at: "2026-10-13T10:00:00Z",
        }),
      ],
    });
    const { client, fake } = setup(tables);

    const first = await runBackgroundPassForUser(client, USER, NOW_OCT_15);
    const second = await runBackgroundPassForUser(client, USER, NOW_OCT_15);

    expect(first.insightsRefreshed).toBe(false);
    expect(second.insightsRefreshed).toBe(false);
    expect(coachHarness.refreshCalls).toBe(0);
    expect(fake.insertsFor("ai_insights")).toHaveLength(0);
  });

  it("counts a refresh only when a newer snapshot was actually stored", async () => {
    const tables = baseTables({
      trades: weekTrades(),
      psychology_records: [
        { trade_id: "t1", user_id: USER, confidence: 4, emotion: "calm", discipline: "good" },
        { trade_id: "t2", user_id: USER, confidence: 3, emotion: "fear", discipline: "poor" },
        { trade_id: "t3", user_id: USER, confidence: 5, emotion: "calm", discipline: "good" },
      ],
    });
    const { client, fake } = setup(tables);

    // Run 1 stores the week's snapshot: counted.
    const first = await runBackgroundPassForUser(client, USER, NOW_OCT_15);
    expect(first.insightsRefreshed).toBe(true);
    expect(coachHarness.refreshCalls).toBe(1);
    const inserted = fake.insertsFor("ai_insights");
    expect(inserted.length).toBeGreaterThan(0);

    // The stored snapshot is now OLDER than the newest trade
    // evidence (stamp it before the trades' 2026-10-14
    // updated_at), so the staleness signal fires again and
    // the refresh IS invoked — but the week's snapshot is
    // already stored, so it writes nothing new. The count
    // must stay 0, on this run and the next.
    stampCreatedAt(tables, "2026-10-13T00:00:00Z");
    const second = await runBackgroundPassForUser(client, USER, NOW_OCT_15);
    expect(second.insightsRefreshed).toBe(false);
    expect(coachHarness.refreshCalls).toBe(2);
    expect(fake.insertsFor("ai_insights")).toHaveLength(inserted.length);

    const third = await runBackgroundPassForUser(client, USER, NOW_OCT_15);
    expect(third.insightsRefreshed).toBe(false);
    expect(coachHarness.refreshCalls).toBe(3);
    expect(fake.insertsFor("ai_insights")).toHaveLength(inserted.length);
  });

  it("does not refresh when the latest insight is newer than the evidence", async () => {
    const tables = baseTables({
      trades: weekTrades(),
      ai_insights: [
        {
          id: "ai1",
          user_id: USER,
          insight_type: "performance_summary",
          period_start: "2026-10-12",
          period_end: "2026-10-18",
          summary: "Stored",
          metrics_snapshot: {},
          created_at: "2026-10-20T00:00:00Z",
        },
      ],
    });
    const { client, fake } = setup(tables);

    const result = await runBackgroundPassForUser(client, USER, NOW_OCT_15);
    expect(result.insightsRefreshed).toBe(false);
    expect(fake.insertsFor("ai_insights")).toHaveLength(0);
  });

  it("creates one risk_warning per un-notified risk event, then never again", async () => {
    const tables = baseTables({
      risk_events: [
        { id: "ev1", user_id: USER, type: "leverage_limit", severity: "warning", message: "Leverage above plan", created_at: "2026-10-20T00:00:00Z" },
        { id: "ev2", user_id: USER, type: "daily_loss_limit", severity: "critical", message: "Daily loss limit reached", created_at: "2026-10-21T00:00:00Z" },
        { id: "ev3", user_id: USER, type: "positive_streak", severity: "positive", message: "Followed the plan for 5 trades", created_at: "2026-10-22T00:00:00Z" },
        { id: "ev-other", user_id: OTHER, type: "leverage_limit", severity: "warning", message: "Not yours", created_at: "2026-10-20T00:00:00Z" },
      ],
      notifications: [
        {
          id: "n1",
          user_id: USER,
          type: "risk_warning",
          title: "Risk warning",
          body: "Leverage above plan",
          related_entity_type: "risk_event",
          related_entity_id: "ev1",
          is_read: false,
          created_at: "2026-10-20T00:05:00Z",
        },
      ],
    });
    const { client, fake } = setup(tables);

    const first = await runBackgroundPassForUser(client, USER, NOW_NOV_2);
    expect(first.riskNotifications).toBe(2);
    const created = fake.insertsFor("notifications");
    expect(created).toHaveLength(2);
    const byEntity = new Map(created.map((r) => [r.related_entity_id, r]));
    expect(byEntity.get("ev2")).toMatchObject({
      user_id: USER,
      type: "risk_warning",
      title: "Critical risk event",
      body: "Daily loss limit reached",
      related_entity_type: "risk_event",
    });
    expect(byEntity.get("ev3")).toMatchObject({
      title: "Positive risk streak",
      body: "Followed the plan for 5 trades",
    });
    // The other trader's event was not notified to this user.
    expect(byEntity.has("ev-other")).toBe(false);

    const second = await runBackgroundPassForUser(client, USER, NOW_NOV_2);
    expect(second.riskNotifications).toBe(0);
    expect(fake.insertsFor("notifications")).toHaveLength(2);
  });

  it("logs one discipline escalation for a missed-journal run, then never repeats the level", async () => {
    const tables = baseTables({
      trades: [
        closedTrade({
          id: "tj",
          closed_at: "2026-10-30T10:00:00Z",
          opened_at: "2026-10-30T09:00:00Z",
          updated_at: "2026-10-30T10:00:00Z",
        }),
      ],
      psychology_records: [{ trade_id: "tj", user_id: USER }],
    });
    const { client, fake } = setup(tables);

    // Last journaled 2026-10-30, today 2026-11-02 → 3 missed
    // days by the engine's count (days between) → level 3… the
    // engine counts whole days from the last journal day:
    // 2026-10-30 → 2026-11-02 is 3 days → strongest reminder.
    const first = await runBackgroundPassForUser(client, USER, NOW_NOV_2);
    expect(first.disciplineEvents).toBe(1);
    const events = fake.insertsFor("discipline_events");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ user_id: USER, kind: "missed_journal" });
    const notes = fake
      .insertsFor("notifications")
      .filter((n) => n.type === "discipline_warning");
    expect(notes).toHaveLength(1);

    const second = await runBackgroundPassForUser(client, USER, NOW_NOV_2);
    expect(second.disciplineEvents).toBe(0);
    expect(fake.insertsFor("discipline_events")).toHaveLength(1);
  });

  it("issues the monthly notice once for a completed month with closed trades", async () => {
    const tables = baseTables({
      trades: [
        closedTrade({
          id: "tm",
          closed_at: "2026-10-10T10:00:00Z",
          opened_at: "2026-10-10T09:00:00Z",
          updated_at: "2026-10-10T10:00:00Z",
        }),
      ],
      // A fresh insight keeps the coach section a no-op here.
      ai_insights: [
        {
          id: "ai1",
          user_id: USER,
          insight_type: "performance_summary",
          period_start: "2026-10-05",
          period_end: "2026-10-11",
          summary: "Stored",
          metrics_snapshot: {},
          created_at: "2026-10-20T00:00:00Z",
        },
      ],
    });
    const { client, fake } = setup(tables);

    const first = await runBackgroundPassForUser(client, USER, NOW_NOV_2);
    expect(first.monthlyNotices).toBe(1);
    const notes = fake
      .insertsFor("notifications")
      .filter((n) => n.type === "monthly_report");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      user_id: USER,
      title: "Your October report is ready",
      related_entity_type: "report",
      related_entity_id: null,
    });
    expect(String(notes[0].body)).toContain("October 2026");

    stampCreatedAt(tables, "2026-11-02T06:30:00Z");
    const second = await runBackgroundPassForUser(client, USER, NOW_NOV_2);
    expect(second.monthlyNotices).toBe(0);
    expect(
      fake.insertsFor("notifications").filter((n) => n.type === "monthly_report"),
    ).toHaveLength(1);
  });

  it("issues no monthly notice when the previous month had no closed trades", async () => {
    const tables = baseTables({
      trades: [
        closedTrade({
          id: "tn",
          closed_at: "2026-11-01T10:00:00Z",
          opened_at: "2026-11-01T09:00:00Z",
          updated_at: "2026-11-01T10:00:00Z",
        }),
      ],
    });
    const { client } = setup(tables);

    const result = await runBackgroundPassForUser(client, USER, NOW_NOV_2);
    expect(result.monthlyNotices).toBe(0);
  });
});

describe("runBackgroundPassForAllUsers", () => {
  it("aggregates per-user results and is idempotent as a whole", async () => {
    const tables = baseTables({
      profiles: [{ id: USER }, { id: OTHER }],
      risk_events: [
        { id: "ev1", user_id: USER, type: "leverage_limit", severity: "warning", message: "Leverage above plan", created_at: "2026-10-20T00:00:00Z" },
      ],
    });
    const { client } = setup(tables);

    const first = await runBackgroundPassForAllUsers(client, NOW_NOV_2);
    expect(first).toMatchObject({ usersProcessed: 2, riskNotifications: 1, errors: 0 });

    const second = await runBackgroundPassForAllUsers(client, NOW_NOV_2);
    expect(second).toMatchObject({
      usersProcessed: 2,
      insightsRefreshed: 0,
      riskNotifications: 0,
      disciplineEvents: 0,
      monthlyNotices: 0,
      errors: 0,
    });
  });
});

describe("isAuthorisedRun", () => {
  it("accepts only the exact bearer secret", () => {
    expect(isAuthorisedRun("Bearer s3cret", "s3cret")).toBe(true);
    expect(isAuthorisedRun("Bearer wrong", "s3cret")).toBe(false);
    expect(isAuthorisedRun("Bearer s3cret-but-longer", "s3cret")).toBe(false);
    expect(isAuthorisedRun("s3cret", "s3cret")).toBe(false);
    expect(isAuthorisedRun(null, "s3cret")).toBe(false);
    expect(isAuthorisedRun("Bearer ", "s3cret")).toBe(false);
    expect(isAuthorisedRun("Bearer s3cret", "")).toBe(false);
  });
});

describe("handleIntelligenceRun", () => {
  const summary: BackgroundRunSummary = {
    usersProcessed: 4,
    insightsRefreshed: 1,
    riskNotifications: 3,
    disciplineEvents: 1,
    monthlyNotices: 2,
    planEvents: 5,
    planNotifications: 5,
    errors: 0,
  };

  function deps(overrides: Partial<Parameters<typeof handleIntelligenceRun>[1]> = {}) {
    return {
      getSecret: () => "s3cret",
      createAdminClient: () => ({}) as never,
      runAll: async () => summary,
      writeRunAudit: async () => true,
      ...overrides,
    };
  }

  it("returns the same detail-free 401 for missing env, missing header and wrong secret", async () => {
    const noEnv = await handleIntelligenceRun(
      { authorization: "Bearer s3cret" },
      deps({ getSecret: () => undefined }),
    );
    const noHeader = await handleIntelligenceRun({ authorization: null }, deps());
    const wrong = await handleIntelligenceRun(
      { authorization: "Bearer nope" },
      deps(),
    );
    for (const result of [noEnv, noHeader, wrong]) {
      expect(result.status).toBe(401);
      expect(result.body).toEqual({ error: "unauthorised" });
    }
  });

  it("runs the pass, writes exactly one audit row and returns counts only", async () => {
    let audits = 0;
    const result = await handleIntelligenceRun(
      { authorization: "Bearer s3cret" },
      deps({
        writeRunAudit: async (s) => {
          audits += 1;
          expect(s).toEqual(summary);
          return true;
        },
      }),
    );
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, ...summary });
    expect(audits).toBe(1);
  });

  it("runs end to end through the default deps against the recording fake", async () => {
    process.env.INTELLIGENCE_CRON_SECRET = "s3cret";
    const tables = baseTables({ profiles: [{ id: USER }] });
    const { fake } = setup(tables);

    const result = await handleIntelligenceRun(
      { authorization: "Bearer s3cret" },
      createDefaultIntelligenceRunDeps(),
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, usersProcessed: 1 });
    const auditRows = fake.insertsFor("audit_logs");
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      action: "intelligence.background_run",
      entity_type: "intelligence",
    });
    expect(auditRows[0].details).toMatchObject({ usersProcessed: 1 });
  });
});

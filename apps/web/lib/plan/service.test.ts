import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type Row } from "@/lib/test-helpers/fake-supabase";

/**
 * Plan enforcement wiring (Task 19).
 *
 * The contract under test: breaches are logged to
 * plan_events EXACTLY ONCE (structural dedupe per
 * (trade, term) / (day, term)) and each new event produces
 * exactly one `system` notification — across the save hook
 * (evaluatePlanForTrade) and repeated background-pass runs
 * (runPlanEnforcementForUser) alike.
 *
 * The service receives its read client explicitly; the
 * writers (`logPlanEvent`, `createNotification`) create
 * their own service-role client, which the mocked server
 * module points at the same recording fake.
 */

const harness = vi.hoisted(() => ({ adminClient: null as unknown }));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => {
    throw new Error("the plan service receives its client explicitly");
  },
  createServiceRoleSupabaseClient: () => harness.adminClient,
}));
vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: () => true,
  supabaseNotConnectedMessage: () => "not configured",
}));

import {
  evaluatePlanForTrade,
  runPlanEnforcementForUser,
} from "./service";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function planRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "plan-1",
    user_id: USER,
    name: "Test plan",
    markets: ["XAUUSD"],
    sessions: ["asia"],
    risk_per_trade_pct: 1,
    max_daily_loss: 200,
    max_daily_trades: 5,
    preferred_setup_ids: [],
    no_trade_conditions: null,
    psychology_rules: null,
    schedule: {},
    is_active: true,
    deleted_at: null,
    updated_at: "2026-11-01T00:00:00Z",
    ...overrides,
  };
}

function tradeRow(overrides: Partial<Row> & { id: string }): Row {
  return {
    user_id: USER,
    pair: "XAUUSD",
    session: "asia",
    setup_id: null,
    sl: null,
    entry_price: 2000,
    position_size: 1,
    pnl: 10,
    status: "closed",
    opened_at: "2026-10-05T09:00:00Z",
    closed_at: "2026-10-05T10:00:00Z",
    created_at: "2026-10-05T10:00:00Z",
    ...overrides,
  };
}

function setup(tables: Record<string, Row[]>) {
  const full: Record<string, Row[]> = {
    profiles: [{ id: USER, trading_capital: null }],
    trading_plans: [],
    trades: [],
    plan_events: [],
    notifications: [],
    ...tables,
  };
  const { client, fake } = fakeSupabase(full);
  harness.adminClient = fake;
  return { client, fake };
}

beforeEach(() => {
  harness.adminClient = null;
});

describe("evaluatePlanForTrade (the createTradeCore hook)", () => {
  it("logs a market breach once and notifies once; a second call is a no-op", async () => {
    const { client, fake } = setup({
      trading_plans: [planRow()],
      trades: [tradeRow({ id: "t1", pair: "GBPUSD" })],
    });

    const first = await evaluatePlanForTrade(client, USER, "t1");
    expect(first).toEqual({ events: 1, notifications: 1 });

    const events = fake.insertsFor("plan_events");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      user_id: USER,
      plan_id: "plan-1",
      trade_id: "t1",
      term: "market",
      event_day: "2026-10-05",
    });

    const notes = fake.insertsFor("notifications");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      type: "system",
      title: "Trading plan breach",
      related_entity_type: "plan_event",
      related_entity_id: events[0].id,
    });

    const second = await evaluatePlanForTrade(client, USER, "t1");
    expect(second).toEqual({ events: 0, notifications: 0 });
    expect(fake.insertsFor("plan_events")).toHaveLength(1);
    expect(fake.insertsFor("notifications")).toHaveLength(1);
  });

  it("an on-plan trade logs nothing", async () => {
    const { client, fake } = setup({
      trading_plans: [planRow()],
      trades: [tradeRow({ id: "t1" })],
    });
    expect(await evaluatePlanForTrade(client, USER, "t1")).toEqual({
      events: 0,
      notifications: 0,
    });
    expect(fake.inserts).toHaveLength(0);
  });

  it("without an active plan nothing is judged", async () => {
    const { client, fake } = setup({
      trades: [tradeRow({ id: "t1", pair: "GBPUSD" })],
    });
    expect(await evaluatePlanForTrade(client, USER, "t1")).toEqual({
      events: 0,
      notifications: 0,
    });
    expect(fake.inserts).toHaveLength(0);
  });

  it("cancelled and reversed trades are never judged", async () => {
    const { client, fake } = setup({
      trading_plans: [planRow()],
      trades: [
        tradeRow({ id: "t1", pair: "GBPUSD", status: "reversed" }),
        tradeRow({ id: "t2", pair: "GBPUSD", status: "cancelled" }),
      ],
    });
    expect(await evaluatePlanForTrade(client, USER, "t1")).toEqual({
      events: 0,
      notifications: 0,
    });
    expect(await evaluatePlanForTrade(client, USER, "t2")).toEqual({
      events: 0,
      notifications: 0,
    });
    expect(fake.inserts).toHaveLength(0);
  });

  it("a risk breach is judged when capital + stop-loss make the figure derivable", async () => {
    // entry 2000, SL 1997.5, size 100 → risk amount 250;
    // capital 1,000 → 25% > plan's 1%. (Figures chosen to be
    // exact in binary floating point.)
    const { client, fake } = setup({
      profiles: [{ id: USER, trading_capital: 1000 }],
      trading_plans: [planRow()],
      trades: [
        tradeRow({ id: "t1", sl: 1997.5, entry_price: 2000, position_size: 100 }),
      ],
    });
    const result = await evaluatePlanForTrade(client, USER, "t1");
    expect(result).toEqual({ events: 1, notifications: 1 });
    expect(fake.insertsFor("plan_events")[0]).toMatchObject({
      term: "risk_per_trade",
      details: { value: 25, limit: 1 },
    });
  });
});

describe("runPlanEnforcementForUser (the background-pass section)", () => {
  it("logs today's daily-trade-limit crossing once, attributed to the crossing trade", async () => {
    const now = new Date("2026-11-03T12:00:00Z");
    const { client, fake } = setup({
      trading_plans: [
        planRow({ max_daily_trades: 2, risk_per_trade_pct: null, max_daily_loss: null }),
      ],
      trades: [
        tradeRow({ id: "d1", opened_at: "2026-11-03T08:00:00Z", closed_at: "2026-11-03T08:30:00Z", created_at: "2026-11-03T08:30:00Z" }),
        tradeRow({ id: "d2", opened_at: "2026-11-03T09:00:00Z", closed_at: "2026-11-03T09:30:00Z", created_at: "2026-11-03T09:30:00Z" }),
        tradeRow({ id: "d3", opened_at: "2026-11-03T10:00:00Z", closed_at: "2026-11-03T10:30:00Z", created_at: "2026-11-03T10:30:00Z" }),
        tradeRow({ id: "d4", opened_at: "2026-11-03T11:00:00Z", closed_at: "2026-11-03T11:30:00Z", created_at: "2026-11-03T11:30:00Z" }),
      ],
    });

    const first = await runPlanEnforcementForUser(client, USER, now);
    expect(first).toEqual({ events: 1, notifications: 1 });
    const events = fake.insertsFor("plan_events");
    expect(events).toHaveLength(1);
    // d3 is the crossing trade (3rd of a 2-trade day); d4 is
    // also over the limit but the (day, term) dedupe keeps
    // exactly one event, attributed to d3.
    expect(events[0]).toMatchObject({
      term: "daily_trade_limit",
      trade_id: "d3",
      event_day: "2026-11-03",
    });

    const second = await runPlanEnforcementForUser(client, USER, now);
    expect(second).toEqual({ events: 0, notifications: 0 });
    expect(fake.insertsFor("plan_events")).toHaveLength(1);
  });

  it("logs today's daily-loss crossing once, attributed to the crossing trade", async () => {
    const now = new Date("2026-11-03T12:00:00Z");
    const { client, fake } = setup({
      trading_plans: [
        planRow({ max_daily_loss: 100, max_daily_trades: null, risk_per_trade_pct: null }),
      ],
      trades: [
        tradeRow({ id: "l1", pnl: -80, opened_at: "2026-11-03T08:00:00Z", closed_at: "2026-11-03T09:00:00Z", created_at: "2026-11-03T09:00:00Z" }),
        tradeRow({ id: "l2", pnl: -50, opened_at: "2026-11-03T09:30:00Z", closed_at: "2026-11-03T10:00:00Z", created_at: "2026-11-03T10:00:00Z" }),
      ],
    });

    const first = await runPlanEnforcementForUser(client, USER, now);
    expect(first).toEqual({ events: 1, notifications: 1 });
    expect(fake.insertsFor("plan_events")[0]).toMatchObject({
      term: "daily_loss_limit",
      trade_id: "l2",
      event_day: "2026-11-03",
      details: { value: -130, limit: 100 },
    });

    const second = await runPlanEnforcementForUser(client, USER, now);
    expect(second).toEqual({ events: 0, notifications: 0 });
  });

  it("does not judge historical day terms — only today's", async () => {
    // Three trades on a PAST day against a 2-trade limit:
    // trade-level terms still judge (all on-plan here), but
    // no daily_trade_limit event is backfilled for the old
    // day — day enforcement is a going-forward monitor.
    const now = new Date("2026-11-03T12:00:00Z");
    const { client, fake } = setup({
      trading_plans: [
        planRow({ max_daily_trades: 2, risk_per_trade_pct: null, max_daily_loss: null }),
      ],
      trades: [
        tradeRow({ id: "h1", opened_at: "2026-10-05T08:00:00Z", closed_at: "2026-10-05T08:30:00Z", created_at: "2026-10-05T08:30:00Z" }),
        tradeRow({ id: "h2", opened_at: "2026-10-05T09:00:00Z", closed_at: "2026-10-05T09:30:00Z", created_at: "2026-10-05T09:30:00Z" }),
        tradeRow({ id: "h3", opened_at: "2026-10-05T10:00:00Z", closed_at: "2026-10-05T10:30:00Z", created_at: "2026-10-05T10:30:00Z" }),
      ],
    });
    const result = await runPlanEnforcementForUser(client, USER, now);
    expect(result).toEqual({ events: 0, notifications: 0 });
    expect(fake.insertsFor("plan_events")).toHaveLength(0);
  });
});

/**
 * Account A fixture — A's REAL plan + all 10 stored trades
 * (production read, 2026-11-03; see the engine test for the
 * per-trade verdict derivation). The pass at a November
 * "now" judges trade-level terms only: exactly 4 events
 * (2 market, 2 session) and 4 notifications on the first
 * run, zero on the second. The reversed and cancelled
 * trades are never judged. A stays 10 trades / 390 XP —
 * this test writes only to the fake.
 */
describe("account A fixture (real plan, real trades, background pass)", () => {
  const A = "c4838c9d-babd-4d8c-9008-e0b1991aaa00";
  const aPlan: Row = {
    id: "178f13c3-583a-4174-b0b1-1b66e4957cb4",
    user_id: A,
    name: "Audit Trading Plan",
    markets: ["XAUUSD"],
    sessions: ["asia"],
    risk_per_trade_pct: 1,
    max_daily_loss: 200,
    max_daily_trades: 5,
    preferred_setup_ids: [],
    no_trade_conditions: "No trading during high-impact news releases",
    psychology_rules: "Stop after two consecutive losses",
    schedule: {},
    is_active: true,
    deleted_at: null,
    updated_at: "2026-10-30T00:00:00Z",
  };

  function aTrade(overrides: Partial<Row> & { id: string }): Row {
    return {
      user_id: A,
      pair: "XAUUSD",
      session: null,
      setup_id: null,
      sl: null,
      entry_price: 4030,
      position_size: 0.1,
      pnl: 0.5,
      status: "closed",
      opened_at: "2026-10-30T03:00:00Z",
      closed_at: "2026-10-30T03:30:00Z",
      created_at: "2026-10-30T03:30:00Z",
      ...overrides,
    };
  }

  it("first run logs exactly A's 4 breaches; second run logs nothing", async () => {
    const { client, fake } = setup({
      profiles: [{ id: A, trading_capital: null }],
      trading_plans: [aPlan],
      trades: [
        aTrade({ id: "06426040-a727-45bc-99d7-176a9c8ca3a5", sl: 1995, entry_price: 2000, position_size: 100, pnl: 1000, opened_at: "2026-10-28T09:00:00Z", closed_at: "2026-10-28T10:00:00Z", created_at: "2026-10-28T10:00:00Z" }),
        aTrade({ id: "28a9f6eb-4744-45eb-b52b-973c836d0749", session: "london", entry_price: 2000, position_size: 100, pnl: 1200, opened_at: "2026-10-28T10:00:00Z", closed_at: "2026-10-28T11:00:00Z", created_at: "2026-10-28T11:00:00Z" }),
        aTrade({ id: "c2508a07-c484-45dc-83d6-74c37c1c6cd1", session: "london", entry_price: 2000, position_size: 100, pnl: 1000, status: "reversed", opened_at: "2026-10-28T10:00:00Z", closed_at: "2026-10-28T11:00:00Z", created_at: "2026-10-28T11:00:00Z" }),
        aTrade({ id: "a227846a-c32b-46f2-9722-c2857843d741", session: "london", setup_id: "876bbdb9-f43f-4362-9c8b-69817278be97", sl: 4022, pnl: 1.2, opened_at: "2026-10-29T09:00:00Z", closed_at: "2026-10-29T10:00:00Z", created_at: "2026-10-29T10:00:00Z" }),
        aTrade({ id: "afcc3db3-70e5-4c60-8737-3eb46c7aa358", pnl: 0.5 }),
        aTrade({ id: "6bc633ea-d1be-4098-9a0d-aac9b98a31f4", pnl: 0.5 }),
        aTrade({ id: "0f6b4ead-c42e-4171-8a54-1007e20b2789", pair: "EURUSD", sl: 1.095, entry_price: 1.1, position_size: 100, pnl: 0.5, opened_at: "2026-10-30T08:00:00Z", closed_at: "2026-10-30T09:00:00Z", created_at: "2026-10-30T09:00:00Z" }),
        aTrade({ id: "d99354d9-54cf-4efd-a7eb-efdaeb3540f4", pair: "GBPUSD", sl: 1.275, entry_price: 1.27, position_size: 100, pnl: -0.2, opened_at: "2026-10-30T09:30:00Z", closed_at: "2026-10-30T10:15:00Z", created_at: "2026-10-30T10:15:00Z" }),
        aTrade({ id: "61ef4f13-3642-4b51-99ab-06ef0e8bc052", sl: 4020, entry_price: 4030, position_size: 100, pnl: 1500, opened_at: "2026-10-30T10:30:00Z", closed_at: "2026-10-30T11:00:00Z", created_at: "2026-10-30T11:00:00Z" }),
        aTrade({ id: "f097b80b-7afc-41bd-b917-29e316f2b165", entry_price: 4000, position_size: 1, pnl: null, status: "cancelled", opened_at: "2026-10-30T13:00:00Z", closed_at: null, created_at: "2026-10-30T13:00:00Z" }),
      ],
    });

    const now = new Date("2026-11-03T06:30:00Z");
    const first = await runPlanEnforcementForUser(client, A, now);
    expect(first).toEqual({ events: 4, notifications: 4 });

    const events = fake.insertsFor("plan_events");
    expect(events.map((e) => `${e.term}:${e.trade_id}`)).toEqual([
      "session:28a9f6eb-4744-45eb-b52b-973c836d0749",
      "session:a227846a-c32b-46f2-9722-c2857843d741",
      "market:0f6b4ead-c42e-4171-8a54-1007e20b2789",
      "market:d99354d9-54cf-4efd-a7eb-efdaeb3540f4",
    ]);
    const notes = fake.insertsFor("notifications");
    expect(notes).toHaveLength(4);
    expect(notes.every((n) => n.type === "system")).toBe(true);

    const second = await runPlanEnforcementForUser(client, A, now);
    expect(second).toEqual({ events: 0, notifications: 0 });
    expect(fake.insertsFor("plan_events")).toHaveLength(4);
    expect(fake.insertsFor("notifications")).toHaveLength(4);
  });
});

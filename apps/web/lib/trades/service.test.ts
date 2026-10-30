import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type Row } from "@/lib/test-helpers/fake-supabase";
import { __clearRateLimitBuckets } from "@/lib/auth/rate-limit";

/**
 * Trade service core tests (Phase 21): the cores extracted
 * from the Server Actions must produce byte-identical side
 * effects — trade row with server-computed metrics, XP,
 * risk events, gamification, audit rows and the Phase 20
 * coach trigger. The Supabase server module is mocked so
 * the service-role engines (XP / audit / notifications /
 * risk events) write to the recording admin fake; the user
 * client is a recording fake too. Everything else
 * (validation, metrics, risk engine, coach engine) is real.
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

import {
  correctTradeCore,
  createTradeCore,
  saveAdvancedReviewCore,
} from "./service";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function existingClosed(id: string, pnl: number, closedAt: string, userId = USER): Row {
  return {
    id,
    user_id: userId,
    pair: "XAUUSD",
    direction: "long",
    status: "closed",
    pnl,
    r_multiple: 1,
    sl: 100,
    tp: null,
    session: "london",
    strategy_id: null,
    setup_id: null,
    market_condition: null,
    trade_reason: null,
    notes: null,
    opened_at: "2026-10-12T09:00:00Z",
    closed_at: closedAt,
  };
}

function baseTables(): Record<string, Row[]> {
  return {
    trades: [
      existingClosed("t1", 120, "2026-10-12T10:00:00Z"),
      existingClosed("t2", -50, "2026-10-13T10:00:00Z"),
    ],
    psychology_records: [
      { id: "p1", trade_id: "t1", user_id: USER, confidence: 4, emotion: "calm", discipline: "good" },
      { id: "p2", trade_id: "t2", user_id: USER, confidence: 3, emotion: "fear", discipline: "poor" },
    ],
    strategies: [],
    setups: [],
    lessons: [],
    goals: [],
    risk_events: [],
    risk_rules: [],
    profiles: [{ id: USER, trading_capital: null }],
    ai_insights: [],
    xp_transactions: [],
    audit_logs: [],
    user_levels: [],
    achievements: [],
    user_achievements: [],
    notifications: [],
  };
}

function setup(tables: Record<string, Row[]> = baseTables()) {
  const user = fakeSupabase(tables);
  const admin = fakeSupabase(tables);
  harness.userClient = user.fake;
  harness.adminClient = admin.fake;
  return { user, admin, tables };
}

const closedInput = {
  pair: "XAUUSD",
  direction: "long",
  entryPrice: 2000,
  exitPrice: 2010,
  tp: 2020,
  sl: 1995,
  positionSize: 100,
  leverage: 1,
  fees: 0,
  openedAt: "2026-10-14T09:00:00Z",
  closedAt: "2026-10-14T10:00:00Z",
};

beforeEach(() => {
  harness.userClient = null;
  harness.adminClient = null;
  __clearRateLimitBuckets();
});

describe("createTradeCore", () => {
  it("stores the trade with server-computed metrics and every legacy side effect", async () => {
    const { user, admin } = setup();
    const result = await createTradeCore(user.client, USER, closedInput);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // (2010 − 2000) × 100 = 1000 P&L, computed server-side.
    expect(result.trade.pnl).toBe(1000);
    expect(result.trade.status).toBe("closed");

    const stored = user.fake.insertsFor("trades");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      user_id: USER,
      pair: "XAUUSD",
      pnl: 1000,
      status: "closed",
    });
    expect(stored[0].roi_pct).toBeCloseTo(0.5, 6);
    expect(stored[0].r_multiple).toBeCloseTo(2, 6);

    // +10 XP trade_journal via the service-role engine.
    const xp = admin.fake.insertsFor("xp_transactions");
    expect(xp.some((r) => r.reason === "trade_journal" && r.user_id === USER)).toBe(true);
    // The operation's own audit row, unchanged.
    const audit = admin.fake.insertsFor("audit_logs");
    expect(audit.some((r) => r.action === "trade.created" && r.entity_id === result.trade.id)).toBe(true);
    // Phase 20 coach trigger fired for the closed trade's week.
    const insights = admin.fake.insertsFor("ai_insights");
    expect(insights.length).toBeGreaterThan(0);
    expect(insights.every((r) => r.period_start === "2026-10-12")).toBe(true);
  });

  it("an open trade stores null metrics and does not trigger the coach", async () => {
    const { user, admin } = setup();
    const result = await createTradeCore(user.client, USER, {
      ...closedInput,
      exitPrice: null,
      closedAt: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trade.status).toBe("open");
    expect(result.trade.pnl).toBeNull();
    expect(admin.fake.insertsFor("ai_insights")).toHaveLength(0);
  });

  it("rejects invalid input with the schema's message and writes nothing", async () => {
    const { user, tables } = setup();
    const before = tables.trades.length;
    const result = await createTradeCore(user.client, USER, { ...closedInput, pair: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_input");
    expect(result.error).toBe("Asset / pair is required");
    expect(tables.trades).toHaveLength(before);
  });

  it("a critical risk breach blocks the save, logs the event, and returns the rule message", async () => {
    const tables = baseTables();
    tables.risk_rules = [
      {
        id: "rules-1",
        user_id: USER,
        plan_id: null,
        max_risk_per_trade_pct: null,
        max_daily_loss: null,
        max_trades_per_day: null,
        max_consecutive_losses: null,
        max_leverage: 10,
        is_active: true,
        deleted_at: null,
        updated_at: "2026-10-01T00:00:00Z",
      },
    ];
    const { user, admin, tables: t } = setup(tables);
    const before = t.trades.length;
    const result = await createTradeCore(user.client, USER, { ...closedInput, leverage: 20 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("business");
    expect(result.error).toContain("Leverage 20× exceeds your maximum of 10×");
    expect(t.trades).toHaveLength(before);
    const events = admin.fake.insertsFor("risk_events");
    expect(events.some((r) => r.severity === "critical")).toBe(true);
  });
});

const REVIEW_TRADE = "11111111-1111-4111-8111-111111111111";
const REVERSED_TRADE = "99999999-9999-4999-8999-999999999999";

describe("saveAdvancedReviewCore", () => {
  it("updates the trade, upserts psychology, saves the lesson and audits", async () => {
    const tables = baseTables();
    tables.trades.push(existingClosed(REVIEW_TRADE, 40, "2026-10-13T12:00:00Z"));
    tables.psychology_records.push({
      id: "p3", trade_id: REVIEW_TRADE, user_id: USER, confidence: 2, emotion: "fear", discipline: "poor",
    });
    const { user, admin, tables: t } = setup(tables);
    const result = await saveAdvancedReviewCore(user.client, USER, {
      tradeId: REVIEW_TRADE,
      strategyId: null,
      setupName: null,
      marketCondition: "trending",
      tradeReason: "strategy",
      session: "london",
      confidence: 5,
      emotion: "calm",
      discipline: "good",
      lesson: "Wait for the retest.",
      notes: "Clean break.",
    });
    expect(result.ok).toBe(true);
    const tradeUpdates = user.fake.updatesFor("trades");
    expect(tradeUpdates).toHaveLength(1);
    expect(tradeUpdates[0].values).toMatchObject({ market_condition: "trending", notes: "Clean break." });
    // Existing psychology row for the trade is updated, not duplicated.
    expect(t.psychology_records.filter((r) => r.trade_id === REVIEW_TRADE)).toHaveLength(1);
    expect(t.psychology_records.find((r) => r.trade_id === REVIEW_TRADE)?.confidence).toBe(5);
    expect(user.fake.insertsFor("lessons")).toHaveLength(1);
    expect(
      admin.fake.insertsFor("audit_logs").some((r) => r.action === "trade.review_saved"),
    ).toBe(true);
  });

  it("flags every matching lesson once its text recurs on a second trade (Phase 23 flag writer)", async () => {
    const tables = baseTables();
    tables.trades.push(existingClosed(REVIEW_TRADE, 40, "2026-10-13T12:00:00Z"));
    // The same lesson already sits on t1, unflagged; a
    // different lesson on t2 must stay unflagged.
    tables.lessons.push(
      { id: "l1", trade_id: "t1", user_id: USER, text: "Wait for the retest.", is_repeated_mistake: false, deleted_at: null },
      { id: "l2", trade_id: "t2", user_id: USER, text: "Chased the move.", is_repeated_mistake: false, deleted_at: null },
    );
    const { user, tables: t } = setup(tables);
    const result = await saveAdvancedReviewCore(user.client, USER, {
      tradeId: REVIEW_TRADE,
      strategyId: null,
      setupName: null,
      marketCondition: null,
      tradeReason: null,
      session: null,
      confidence: null,
      emotion: null,
      discipline: null,
      lesson: "Wait for the retest.",
      notes: null,
    });
    expect(result.ok).toBe(true);
    const retest = t.lessons.filter((r) => r.text === "Wait for the retest.");
    expect(retest).toHaveLength(2);
    expect(retest.every((r) => r.is_repeated_mistake === true)).toBe(true);
    expect(t.lessons.find((r) => r.id === "l2")?.is_repeated_mistake).toBe(false);
  });

  it("another trader's trade is not_found and untouched", async () => {
    const { user, tables } = setup();
    const result = await saveAdvancedReviewCore(user.client, OTHER, {
      tradeId: REVIEW_TRADE,
      strategyId: null,
      setupName: null,
      marketCondition: null,
      tradeReason: null,
      session: null,
      confidence: null,
      emotion: null,
      discipline: null,
      lesson: null,
      notes: "hostile",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("not_found");
    expect(user.fake.updatesFor("trades")).toHaveLength(0);
    expect(tables.trades.find((r) => r.id === REVIEW_TRADE)?.notes ?? null).toBeNull();
  });

  it("a reversed trade refuses review with the legacy message", async () => {
    const tables = baseTables();
    tables.trades.push({ ...existingClosed(REVERSED_TRADE, 10, "2026-10-13T10:00:00Z"), status: "reversed" });
    const { user } = setup(tables);
    const result = await saveAdvancedReviewCore(user.client, USER, {
      tradeId: REVERSED_TRADE,
      strategyId: null,
      setupName: null,
      marketCondition: null,
      tradeReason: null,
      session: null,
      confidence: null,
      emotion: null,
      discipline: null,
      lesson: null,
      notes: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("business");
    expect(result.error).toContain("corrected by a reversal");
  });
});

describe("correctTradeCore", () => {
  it("creates the correcting trade, reverses the original and audits", async () => {
    const { user, admin, tables } = setup();
    const result = await correctTradeCore(user.client, USER, "t1", {
      ...closedInput,
      entryPrice: 2000,
      exitPrice: 1990,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reversedTradeId).toBe("t1");
    const original = tables.trades.find((r) => r.id === "t1");
    expect(original?.status).toBe("reversed");
    expect(original?.reversal_trade_id).toBe(result.tradeId);
    const correcting = tables.trades.find((r) => r.id === result.tradeId);
    expect(correcting?.pnl).toBe(-1000);
    expect(
      admin.fake
        .insertsFor("audit_logs")
        .some((r) => r.action === "trade.corrected" && r.entity_id === "t1"),
    ).toBe(true);
  });

  it("another trader's trade is not_found; an already-reversed trade is a business refusal", async () => {
    const tables = baseTables();
    tables.trades.push({ ...existingClosed("t9", 10, "2026-10-13T10:00:00Z"), status: "reversed" });
    const { user } = setup(tables);
    const cross = await correctTradeCore(user.client, OTHER, "t1", closedInput);
    expect(cross.ok).toBe(false);
    if (!cross.ok) expect(cross.code).toBe("not_found");
    const again = await correctTradeCore(user.client, USER, "t9", closedInput);
    expect(again.ok).toBe(false);
    if (!again.ok) {
      expect(again.code).toBe("business");
      expect(again.error).toBe("This trade has already been corrected or cancelled.");
    }
  });
});


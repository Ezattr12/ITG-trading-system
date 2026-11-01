import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fakeSupabase,
  type FakeSupabaseClient,
  type Row,
} from "@/lib/test-helpers/fake-supabase";
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
  editTradeCore,
  saveAdvancedReviewCore,
  type EditTradeInput,
} from "./service";
import { calcPnl } from "@itg/calc";

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

const EDIT_TRADE = "44444444-4444-4444-8444-444444444444";
const CANCELLED_TRADE = "55555555-5555-4555-8555-555555555555";

function editableClosed(id: string, userId = USER): Row {
  return {
    id,
    user_id: userId,
    pair: "XAUUSD",
    direction: "long",
    status: "closed",
    entry_price: 2000,
    exit_price: 2010,
    tp: 2020,
    sl: 1995,
    position_size: 100,
    leverage: 1,
    fees: 0,
    pnl: 1000,
    roi_pct: 0.5,
    r_multiple: 2,
    risk_reward: 4,
    is_win: true,
    duration_seconds: 3600,
    strategy_id: null,
    setup_id: null,
    session: "london",
    market_condition: null,
    trade_reason: null,
    notes: null,
    opened_at: "2026-10-14T09:00:00Z",
    closed_at: "2026-10-14T10:00:00Z",
  };
}

/** The full-form edit submission that exactly matches editableClosed(). */
const matchingEdit: EditTradeInput = {
  correction: {
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
  },
  review: {
    strategyId: null,
    setupName: null,
    marketCondition: null,
    tradeReason: null,
    session: "london",
    confidence: null,
    emotion: null,
    discipline: null,
    lesson: null,
    notes: null,
  },
};

/**
 * The fake assigns `fake-trades-N` ids to inserts, but the
 * review schema (correctly) requires UUID trade ids — and
 * editTradeCore feeds the corrected trade's id into the
 * review core. Give trades inserted through this fake UUID
 * ids, exactly what Postgres generates in production.
 */
function withUuidTradeIds(fake: FakeSupabaseClient): void {
  const realFrom = fake.from.bind(fake);
  let seq = 0;
  fake.from = (table: string) => {
    const query = realFrom(table);
    if (table === "trades") {
      const realInsert = query.insert.bind(query);
      query.insert = (row: Row | Row[]) => {
        const rows = Array.isArray(row) ? row : [row];
        for (const r of rows) {
          if (r.id === undefined) {
            seq += 1;
            r.id = `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
          }
        }
        return realInsert(rows);
      };
    }
    return query;
  };
}

function setupWithEditTrade(extra?: (tables: Record<string, Row[]>) => void) {
  const tables = baseTables();
  tables.trades.push(editableClosed(EDIT_TRADE));
  extra?.(tables);
  const ctx = setup(tables);
  withUuidTradeIds(ctx.user.fake);
  return ctx;
}

describe("editTradeCore", () => {
  it("financial-only edit: corrects by reversal with recomputed metrics, carries the journal, audits trade.edited, awards NO XP", async () => {
    const { user, admin, tables } = setupWithEditTrade();
    const result = await editTradeCore(user.client, USER, EDIT_TRADE, {
      correction: { ...matchingEdit.correction, exitPrice: 1990 },
      review: matchingEdit.review,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.financialChanged).toBe(true);
    expect(result.journalChanged).toBe(false);
    expect(result.changedFields).toEqual(["exitPrice"]);
    expect(result.reversedTradeId).toBe(EDIT_TRADE);
    expect(result.tradeId).not.toBe(EDIT_TRADE);

    const original = tables.trades.find((r) => r.id === EDIT_TRADE);
    expect(original?.status).toBe("reversed");
    expect(original?.reversal_trade_id).toBe(result.tradeId);
    const corrected = tables.trades.find((r) => r.id === result.tradeId);
    // (1990 − 2000) × 100 = −1000, recomputed by the correction core.
    expect(corrected?.pnl).toBe(-1000);
    expect(corrected?.user_id).toBe(USER);
    expect(corrected?.is_win).toBe(false);

    // The journal state was applied to the CORRECTED trade:
    // the review save updated its row and created its
    // psychology record there (not on the reversed original).
    expect(
      tables.psychology_records.some((r) => r.trade_id === result.tradeId),
    ).toBe(true);
    expect(
      user.fake
        .updatesFor("trades")
        .some((u) => u.matched.some((m) => m.id === result.tradeId)),
    ).toBe(true);

    const audits = admin.fake.insertsFor("audit_logs");
    const edited = audits.find((r) => r.action === "trade.edited");
    expect(edited?.entity_id).toBe(EDIT_TRADE);
    expect(edited?.details).toMatchObject({
      changedFields: ["exitPrice"],
      financialChanged: true,
      journalChanged: false,
      previousPnl: 1000,
      newPnl: -1000,
      resultingTradeId: result.tradeId,
    });
    // The cores' established trail still fires.
    expect(audits.some((r) => r.action === "trade.corrected")).toBe(true);
    // An edit NEVER awards XP.
    expect(admin.fake.insertsFor("xp_transactions")).toHaveLength(0);
  });

  it("journal-only edit: saves in place on the same trade, no correction is created", async () => {
    const { user, admin, tables } = setupWithEditTrade();
    const result = await editTradeCore(user.client, USER, EDIT_TRADE, {
      correction: matchingEdit.correction,
      review: {
        ...matchingEdit.review,
        confidence: 4,
        emotion: "calm",
        notes: "Updated note.",
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tradeId).toBe(EDIT_TRADE);
    expect(result.reversedTradeId).toBeNull();
    expect(result.financialChanged).toBe(false);
    expect(result.journalChanged).toBe(true);
    expect(result.changedFields).toEqual(["confidence", "emotion", "notes"]);
    // No new trade rows anywhere; the original is untouched in status.
    expect(user.fake.insertsFor("trades")).toHaveLength(0);
    expect(tables.trades.find((r) => r.id === EDIT_TRADE)?.status).toBe("closed");
    expect(tables.trades.find((r) => r.id === EDIT_TRADE)?.notes).toBe("Updated note.");
    const psych = tables.psychology_records.find((r) => r.trade_id === EDIT_TRADE);
    expect(psych?.confidence).toBe(4);
    expect(psych?.emotion).toBe("calm");
    const audits = admin.fake.insertsFor("audit_logs");
    expect(audits.some((r) => r.action === "trade.edited")).toBe(true);
    expect(audits.some((r) => r.action === "trade.corrected")).toBe(false);
    expect(admin.fake.insertsFor("xp_transactions")).toHaveLength(0);
  });

  it("financial + journal edit: the corrected trade carries the NEW journal values", async () => {
    const { user, tables } = setupWithEditTrade();
    const result = await editTradeCore(user.client, USER, EDIT_TRADE, {
      correction: { ...matchingEdit.correction, entryPrice: 2005 },
      review: { ...matchingEdit.review, notes: "Both changed.", confidence: 5 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.financialChanged).toBe(true);
    expect(result.journalChanged).toBe(true);
    expect(result.changedFields).toEqual(["entryPrice", "confidence", "notes"]);
    const corrected = tables.trades.find((r) => r.id === result.tradeId);
    // (2010 − 2005) × 100 = 500; journal written onto the corrected trade.
    expect(corrected?.pnl).toBe(500);
    expect(corrected?.notes).toBe("Both changed.");
    expect(
      tables.psychology_records.find((r) => r.trade_id === result.tradeId)?.confidence,
    ).toBe(5);
  });

  it("no change: ok with empty changedFields and ZERO writes of any kind", async () => {
    const { user, admin, tables } = setupWithEditTrade();
    const result = await editTradeCore(user.client, USER, EDIT_TRADE, matchingEdit);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tradeId).toBe(EDIT_TRADE);
    expect(result.changedFields).toEqual([]);
    expect(result.financialChanged).toBe(false);
    expect(result.journalChanged).toBe(false);
    expect(user.fake.inserts).toHaveLength(0);
    expect(user.fake.updates).toHaveLength(0);
    expect(admin.fake.insertsFor("audit_logs")).toHaveLength(0);
    expect(tables.trades.find((r) => r.id === EDIT_TRADE)?.status).toBe("closed");
  });

  it("another trader's trade is not_found and nothing is written", async () => {
    const { user, admin, tables } = setupWithEditTrade();
    const result = await editTradeCore(user.client, OTHER, EDIT_TRADE, {
      correction: { ...matchingEdit.correction, exitPrice: 1990 },
      review: { ...matchingEdit.review, notes: "hostile" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("not_found");
    expect(user.fake.inserts).toHaveLength(0);
    expect(user.fake.updates).toHaveLength(0);
    expect(admin.fake.insertsFor("audit_logs")).toHaveLength(0);
    expect(tables.trades.find((r) => r.id === EDIT_TRADE)?.status).toBe("closed");
  });

  it("a reversed trade and a cancelled trade refuse with business errors", async () => {
    const { user, tables } = setupWithEditTrade((t) => {
      t.trades.push({ ...editableClosed(REVERSED_TRADE), status: "reversed" });
      t.trades.push({ ...editableClosed(CANCELLED_TRADE), status: "cancelled" });
    });
    const reversed = await editTradeCore(user.client, USER, REVERSED_TRADE, matchingEdit);
    expect(reversed.ok).toBe(false);
    if (!reversed.ok) {
      expect(reversed.code).toBe("business");
      expect(reversed.error).toBe(
        "This trade was corrected by a reversal — edit the correcting trade instead.",
      );
    }
    const cancelled = await editTradeCore(user.client, USER, CANCELLED_TRADE, matchingEdit);
    expect(cancelled.ok).toBe(false);
    if (!cancelled.ok) {
      expect(cancelled.code).toBe("business");
      expect(cancelled.error).toBe("A cancelled trade can no longer be edited.");
    }
    expect(tables.trades.find((r) => r.id === REVERSED_TRADE)?.status).toBe("reversed");
  });

  it("a forged user_id inside the payloads cannot steer ownership — the schemas strip it", async () => {
    const { user, tables } = setupWithEditTrade();
    const forgedCorrection = {
      ...matchingEdit.correction,
      exitPrice: 1990,
      user_id: OTHER,
    } as unknown as EditTradeInput["correction"];
    const forgedReview = {
      ...matchingEdit.review,
      user_id: OTHER,
    } as unknown as EditTradeInput["review"];
    const result = await editTradeCore(user.client, USER, EDIT_TRADE, {
      correction: forgedCorrection,
      review: forgedReview,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const corrected = tables.trades.find((r) => r.id === result.tradeId);
    expect(corrected?.user_id).toBe(USER);
  });

  it("direction flip long → short recalculates the P&L sign via @itg/calc", async () => {
    const { user, tables } = setupWithEditTrade();
    const expected = calcPnl({
      direction: "short",
      entryPrice: 2000,
      exitPrice: 1990,
      positionSize: 100,
      fees: 0,
    });
    expect(expected).toBe(1000);
    const result = await editTradeCore(user.client, USER, EDIT_TRADE, {
      correction: { ...matchingEdit.correction, direction: "short", exitPrice: 1990 },
      review: matchingEdit.review,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changedFields).toEqual(["direction", "exitPrice"]);
    const corrected = tables.trades.find((r) => r.id === result.tradeId);
    expect(corrected?.pnl).toBe(expected);
    expect(corrected?.is_win).toBe(true);
  });

  it("a fees-only change counts as financial and nets off the P&L", async () => {
    const { user, tables } = setupWithEditTrade();
    const result = await editTradeCore(user.client, USER, EDIT_TRADE, {
      correction: { ...matchingEdit.correction, fees: 5 },
      review: matchingEdit.review,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.financialChanged).toBe(true);
    expect(result.changedFields).toEqual(["fees"]);
    expect(tables.trades.find((r) => r.id === result.tradeId)?.pnl).toBe(995);
  });

  it("a lesson-only change is journal-only, and re-saving the same lesson is a no-change (dedupe)", async () => {
    const { user, tables } = setupWithEditTrade();
    const withLesson: EditTradeInput = {
      correction: matchingEdit.correction,
      review: { ...matchingEdit.review, lesson: "Wait for the retest." },
    };
    const first = await editTradeCore(user.client, USER, EDIT_TRADE, withLesson);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.financialChanged).toBe(false);
    expect(first.journalChanged).toBe(true);
    expect(first.changedFields).toEqual(["lesson"]);
    expect(user.fake.insertsFor("lessons")).toHaveLength(1);
    expect(tables.trades.find((r) => r.id === EDIT_TRADE)?.status).toBe("closed");

    const again = await editTradeCore(user.client, USER, EDIT_TRADE, withLesson);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.changedFields).toEqual([]);
    // Still exactly one lesson row — the repeat save deduped.
    expect(user.fake.insertsFor("lessons")).toHaveLength(1);
  });

  it("setup round-trips by name: the same name is no change, a new name is a journal change", async () => {
    const SETUP_ID = "66666666-6666-4666-8666-666666666666";
    const { user, tables } = setupWithEditTrade((t) => {
      const row = t.trades.find((r) => r.id === EDIT_TRADE);
      if (row) row.setup_id = SETUP_ID;
      t.setups.push({ id: SETUP_ID, user_id: USER, strategy_id: null, name: "London open" });
    });
    const same = await editTradeCore(user.client, USER, EDIT_TRADE, {
      correction: matchingEdit.correction,
      review: { ...matchingEdit.review, setupName: "London open" },
    });
    expect(same.ok).toBe(true);
    if (!same.ok) return;
    expect(same.changedFields).toEqual([]);

    const renamed = await editTradeCore(user.client, USER, EDIT_TRADE, {
      correction: matchingEdit.correction,
      review: { ...matchingEdit.review, setupName: "Breakout retest" },
    });
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(renamed.changedFields).toEqual(["setup"]);
    expect(renamed.financialChanged).toBe(false);
    const stored = tables.trades.find((r) => r.id === EDIT_TRADE);
    expect(stored?.setup_id).not.toBe(SETUP_ID);
    expect(
      tables.setups.some((s) => s.id === stored?.setup_id && s.name === "Breakout retest"),
    ).toBe(true);
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


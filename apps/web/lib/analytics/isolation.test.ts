import { describe, expect, it } from "vitest";
import { assertScoped, fakeSupabase } from "../test-helpers/fake-supabase";
import { TRADE_LIST_FETCH_LIMIT } from "../trades/queries";
import { getAnalyticsBundle } from "./queries";

/**
 * Analytics isolation + the 500-trade cap (Phase 12, spec §18/§43).
 *
 * Proves the analytics bundle scopes trades, goals, XP and daily
 * activity to the signed-in trader, and that it never aggregates
 * more than the 500 most recent closed trades — a journal past
 * that size is silently truncated today, so the cap itself is a
 * tested behaviour (pushing aggregation into the database is a
 * documented Phase 13 follow-up, see docs/phase-12.md).
 */

const LEVELS = [
  { id: "l1", name: "Bronze", slug: "bronze", min_score: 0, max_score: 39, scoring_config: null, description: null },
  { id: "l2", name: "Silver", slug: "silver", min_score: 40, max_score: 59, scoring_config: null, description: null },
  { id: "l3", name: "Gold", slug: "gold", min_score: 60, max_score: 79, scoring_config: null, description: null },
  { id: "l4", name: "Platinum", slug: "platinum", min_score: 80, max_score: null, scoring_config: null, description: null },
];

function closedTrade(i: number, userId: string) {
  return {
    id: `t-${userId}-${i}`,
    user_id: userId,
    pair: "EURUSD",
    direction: "long",
    session: "london",
    strategy_id: null,
    setup_id: null,
    status: "closed",
    opened_at: `2026-10-${String((i % 28) + 1).padStart(2, "0")}T09:00:00Z`,
    closed_at: `2026-10-${String((i % 28) + 1).padStart(2, "0")}T11:00:00Z`,
    pnl: i % 2 === 0 ? 10 : -5,
    r_multiple: 1,
    sl: 1.08,
  };
}

describe("analytics bundle isolation", () => {
  it("scopes every source table to the requesting trader", async () => {
    const { client, fake } = fakeSupabase({
      trades: [closedTrade(1, "user-a"), closedTrade(2, "user-b")],
      psychology_records: [],
      strategies: [],
      lessons: [],
      trade_screenshots: [],
      goals: [
        { id: "g-a", user_id: "user-a", title: "Journal", period: "weekly", target_value: 5, status: "active", created_at: "2026-10-01T00:00:00Z" },
        { id: "g-b", user_id: "user-b", title: "Other", period: "weekly", target_value: 5, status: "active", created_at: "2026-10-01T00:00:00Z" },
      ],
      goal_progress: [],
      xp_transactions: [
        { user_id: "user-a", amount: 10, created_at: "2026-10-20T00:00:00Z" },
        { user_id: "user-b", amount: 999, created_at: "2026-10-20T00:00:00Z" },
      ],
      levels: LEVELS,
      daily_activity: [
        { user_id: "user-a", activity_date: "2026-10-20", journal_completed: true, study_hours: 1 },
        { user_id: "user-b", activity_date: "2026-10-20", journal_completed: true, study_hours: 9 },
      ],
    });

    const bundle = await getAnalyticsBundle(client, "user-a");

    expect(bundle.trades.map((t) => t.id)).toEqual(["t-user-a-1"]);
    expect(bundle.goals.map((g) => g.id)).toEqual(["g-a"]);
    expect(bundle.xpTotal).toBe(10);
    expect(bundle.dailyActivity).toEqual([
      { user_id: "user-a", activity_date: "2026-10-20", journal_completed: true, study_hours: 1 },
    ]);

    for (const table of ["trades", "goals", "xp_transactions", "daily_activity"]) {
      for (const q of fake.queriesFor(table)) {
        assertScoped(q, "user_id", "user-a");
      }
    }
  });

  it("caps analytics at the 500 most recent closed trades", async () => {
    const many = Array.from({ length: 600 }, (_, i) => closedTrade(i, "user-a"));
    const { client, fake } = fakeSupabase({
      trades: many,
      psychology_records: [],
      strategies: [],
      lessons: [],
      trade_screenshots: [],
      goals: [],
      goal_progress: [],
      xp_transactions: [],
      levels: LEVELS,
      daily_activity: [],
    });

    const bundle = await getAnalyticsBundle(client, "user-a");

    expect(bundle.trades).toHaveLength(500);
    const tradeQuery = fake.queriesFor("trades")[0]!;
    expect(
      tradeQuery.ops.some((op) => op.kind === "limit" && op.n === TRADE_LIST_FETCH_LIMIT),
    ).toBe(true);
    // Only closed trades with a P&L enter analytics.
    expect(bundle.trades.every((t) => t.pnl !== null)).toBe(true);
  });

  it("returns honest empty state for a trader with no data", async () => {
    const { client } = fakeSupabase({
      trades: [],
      psychology_records: [],
      strategies: [],
      lessons: [],
      trade_screenshots: [],
      goals: [],
      goal_progress: [],
      xp_transactions: [],
      levels: LEVELS,
      daily_activity: [],
    });

    const bundle = await getAnalyticsBundle(client, "user-a");
    expect(bundle.trades).toEqual([]);
    expect(bundle.goals).toEqual([]);
    expect(bundle.xpTotal).toBe(0);
    expect(bundle.levelName).toBeNull();
    expect(bundle.levelScore).toBeNull();
  });
});

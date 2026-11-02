import { describe, expect, it } from "vitest";
import { fakeSupabase, type Row } from "../test-helpers/fake-supabase";
import { getAnalyticsBundle } from "../analytics/queries";
import { getGamificationBundle } from "./queries";

/**
 * XP total completeness (Task 14 regression).
 *
 * The defect (found in Task 5): getGamificationBundle re-summed
 * the total from getXpTransactions' default 100-row display
 * page, while the analytics bundle (dashboard) totals every
 * xp_transactions row. Past 100 transactions, /levels and
 * /achievements under-reported Total XP versus the dashboard.
 * The fix inherits the analytics bundle's all-rows total, so
 * the two surfaces agree by construction. These tests pin that:
 * with 150 transactions the gamification total must be the
 * all-time sum — including an old penalty row that falls
 * outside the newest-100 page entirely — and the displayed
 * transaction page must stay capped at 100.
 */

const LEVELS = [
  { id: "l1", name: "Bronze", slug: "bronze", min_score: 0, max_score: 39, scoring_config: null, description: null },
  { id: "l2", name: "Silver", slug: "silver", min_score: 40, max_score: 59, scoring_config: null, description: null },
  { id: "l3", name: "Gold", slug: "gold", min_score: 60, max_score: 79, scoring_config: null, description: null },
  { id: "l4", name: "Platinum", slug: "platinum", min_score: 80, max_score: null, scoring_config: null, description: null },
];

function xpRow(userId: string, amount: number, i: number) {
  return {
    id: `xp-${userId}-${i}`,
    user_id: userId,
    amount,
    reason: amount < 0 ? "penalty" : "trade_journal",
    source_ref_id: null,
    note: null,
    // Strictly increasing timestamps: index order = age order,
    // so the newest-100 page is exactly indices 50..149.
    created_at: new Date(Date.UTC(2026, 0, 1) + i * 3_600_000).toISOString(),
  };
}

function seed(xpTransactions: Row[]) {
  return fakeSupabase({
    trades: [],
    psychology_records: [],
    strategies: [],
    lessons: [],
    trade_screenshots: [],
    goals: [],
    goal_progress: [],
    xp_transactions: xpTransactions,
    levels: LEVELS,
    daily_activity: [],
    achievements: [],
    user_achievements: [],
    risk_rules: [],
  });
}

describe("gamification bundle XP total", () => {
  it("totals every transaction past the 100-row display page", async () => {
    // 150 rows for user-a: the OLDEST is a -50 penalty, the
    // other 149 are +10. All-time total = 1440. The newest-100
    // page sums to 1000 — the old bundle reported exactly that.
    const rows = [
      xpRow("user-a", -50, 0),
      ...Array.from({ length: 149 }, (_, k) => xpRow("user-a", 10, k + 1)),
      // Another trader's rows must never leak into the total.
      ...Array.from({ length: 30 }, (_, k) => xpRow("user-b", 999, k)),
    ];
    const { client } = seed(rows);

    const bundle = await getGamificationBundle(client, "user-a");
    const analytics = await getAnalyticsBundle(client, "user-a");

    expect(bundle.xpTotal).toBe(1440);
    // The two surfaces agree — the consistency the fix restores.
    expect(bundle.xpTotal).toBe(analytics.xpTotal);
    // The display page itself is unchanged: newest 100 only.
    expect(bundle.xpTransactions).toHaveLength(100);
    expect(
      bundle.xpTransactions.every((t) => t.user_id === "user-a"),
    ).toBe(true);
  });

  it("matches the analytics total for a short history (current-user behaviour unchanged)", async () => {
    // Mirrors the shape of a real current account (22 rows,
    // mixed reasons, summing to 390): under the old code both
    // paths already agreed, and they must still agree now.
    const amounts = [
      ...Array(9).fill(10), // trade_journal
      ...Array(5).fill(15), // backtest_session
      ...Array(2).fill(30), // weekly_review
      ...Array(2).fill(25), // risk_discipline
      10, 25, 30, 50, // achievement rewards
    ];
    const rows = amounts.map((amount, i) => xpRow("user-a", amount, i));
    const { client } = seed(rows);

    const bundle = await getGamificationBundle(client, "user-a");
    const analytics = await getAnalyticsBundle(client, "user-a");

    expect(bundle.xpTotal).toBe(390);
    expect(analytics.xpTotal).toBe(390);
    expect(bundle.xpTransactions).toHaveLength(22);
  });

  it("returns a zero total for a trader with no XP history", async () => {
    const { client } = seed([]);
    const bundle = await getGamificationBundle(client, "user-a");
    expect(bundle.xpTotal).toBe(0);
    expect(bundle.xpTransactions).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { assertScoped, fakeSupabase } from "../test-helpers/fake-supabase";
import { TRADE_LIST_FETCH_LIMIT, getTradeDetail, getTradeListItems } from "./queries";

/**
 * User isolation at the query layer (Phase 12, spec §43).
 *
 * These tests prove the read functions scope every trade query to
 * the signed-in trader. RLS is the second line of defence on the
 * live database — these tests catch a missing `user_id` filter
 * in the app code itself, which RLS alone would have hidden
 * behind a different layer. Live RLS isolation is a Phase 13/14
 * test against the real project.
 */

const tradeA = {
  id: "t-a1",
  user_id: "user-a",
  pair: "EURUSD",
  direction: "long",
  session: "london",
  strategy_id: null,
  setup_id: null,
  status: "closed",
  reversal_trade_id: null,
  opened_at: "2026-10-20T09:00:00Z",
  closed_at: "2026-10-20T11:00:00Z",
  pnl: 120,
  r_multiple: 2,
  sl: 1.08,
};

const tradeB = {
  ...tradeA,
  id: "t-b1",
  user_id: "user-b",
  pair: "GBPUSD",
  pnl: -50,
};

const psychA = {
  trade_id: "t-a1",
  confidence: 4,
  emotion: "calm",
  discipline: "good",
};

function seed() {
  return fakeSupabase({
    trades: [tradeA, tradeB],
    psychology_records: [psychA],
    strategies: [],
    setups: [],
    lessons: [],
    trade_screenshots: [],
  });
}

describe("trade list isolation", () => {
  it("returns only the requesting trader's trades, scoped and capped at 500", async () => {
    const { client, fake } = seed();
    const items = await getTradeListItems(client, "user-a", {});

    expect(items.map((i) => i.trade.id)).toEqual(["t-a1"]);
    expect(items[0]?.confidence).toBe(4);

    const tradeQueries = fake.queriesFor("trades");
    expect(tradeQueries.length).toBeGreaterThanOrEqual(1);
    assertScoped(tradeQueries[0]!, "user_id", "user-a");
    expect(
      tradeQueries[0]!.ops.some((op) => op.kind === "limit" && op.n === TRADE_LIST_FETCH_LIMIT),
    ).toBe(true);
    expect(TRADE_LIST_FETCH_LIMIT).toBe(500);
  });

  it("a pair filter never widens the scope to another trader", async () => {
    const { client, fake } = seed();
    const items = await getTradeListItems(client, "user-a", { pair: "GBPUSD" });

    // GBPUSD belongs to user-b; user-a sees nothing for that pair.
    expect(items).toEqual([]);
    assertScoped(fake.queriesFor("trades")[0]!, "user_id", "user-a");
  });

  it("a direction filter is applied on top of the user scope", async () => {
    const { client, fake } = seed();
    const items = await getTradeListItems(client, "user-a", { direction: "long" });
    expect(items.map((i) => i.trade.id)).toEqual(["t-a1"]);
    const ops = fake.queriesFor("trades")[0]!.ops;
    expect(ops.some((op) => op.kind === "eq" && op.col === "direction" && op.value === "long")).toBe(true);
  });
});

describe("trade detail isolation", () => {
  it("returns null for another trader's trade id", async () => {
    const { client, fake } = seed();
    const detail = await getTradeDetail(client, "user-a", "t-b1");
    expect(detail).toBeNull();
    assertScoped(fake.queriesFor("trades")[0]!, "user_id", "user-a");
    assertScoped(fake.queriesFor("trades")[0]!, "id", "t-b1");
  });

  it("returns the trade, psychology and journal state for the owner", async () => {
    const { client } = seed();
    const detail = await getTradeDetail(client, "user-a", "t-a1");
    expect(detail?.trade.id).toBe("t-a1");
    expect(detail?.psychology?.confidence).toBe(4);
    expect(detail?.lessons).toEqual([]);
    expect(detail?.screenshots).toEqual([]);
  });

  it("returns null for a trade id that does not exist at all", async () => {
    const { client } = seed();
    expect(await getTradeDetail(client, "user-a", "t-missing")).toBeNull();
  });
});

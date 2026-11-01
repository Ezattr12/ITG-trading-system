import { describe, expect, it } from "vitest";
import { fakeSupabase } from "../test-helpers/fake-supabase";
import { getTradeListItems } from "./queries";

/**
 * Active-journal list visibility (Delete Trade mandate):
 * getTradeListItems excludes removed trades — cancelled
 * trades and VOIDED trades (reversed with no correcting
 * trade, reversal_trade_id null) — while a corrected
 * original (reversed WITH a reversal_trade_id) stays
 * visible, exactly as it did before Delete Trade existed.
 * The exclusion lives in getTradeListItems itself, so the
 * trades list page and the detail page's related trades
 * share it (see queries.ts).
 */

const USER = "user-a";
const CORRECTING = "t-correcting";

function trade(id: string, status: string, reversalTradeId: string | null = null) {
  return {
    id,
    user_id: USER,
    pair: "XAUUSD",
    direction: "long",
    session: "london",
    strategy_id: null,
    setup_id: null,
    status,
    reversal_trade_id: reversalTradeId,
    opened_at: "2026-10-20T09:00:00Z",
    closed_at: "2026-10-20T11:00:00Z",
    pnl: 100,
    r_multiple: 1,
    sl: 100,
  };
}

function seed() {
  return fakeSupabase({
    trades: [
      trade("t-open", "open"),
      trade("t-closed", "closed"),
      trade("t-cancelled", "cancelled"),
      trade("t-voided", "reversed", null),
      trade("t-corrected", "reversed", CORRECTING),
      { ...trade("t-foreign", "closed"), user_id: "user-b" },
      { ...trade("t-foreign-cancelled", "cancelled"), user_id: "user-b" },
    ],
    psychology_records: [],
    strategies: [],
    setups: [],
  });
}

describe("trade list exclusion of removed trades", () => {
  it("excludes cancelled and voided trades; open, closed and corrected-reversed trades remain", async () => {
    const { client } = seed();
    const items = await getTradeListItems(client, USER, {});
    const ids = items.map((i) => i.trade.id).sort();
    expect(ids).toEqual(["t-closed", "t-corrected", "t-open"]);
  });

  it("the exclusion composes with the database filters (pair)", async () => {
    const { client } = seed();
    const items = await getTradeListItems(client, USER, { pair: "XAUUSD" });
    const ids = items.map((i) => i.trade.id).sort();
    expect(ids).toEqual(["t-closed", "t-corrected", "t-open"]);
    const none = await getTradeListItems(client, USER, { pair: "GBPUSD" });
    expect(none).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { applyTradeFilters, paginate } from "./filters";
import type { TradeListItem } from "./types";
import type { TradeFilters } from "./validation";

function item(overrides: Partial<TradeListItem["trade"]> & {
  strategyName?: string | null;
  setupName?: string | null;
  confidence?: number | null;
  emotion?: TradeListItem["emotion"];
  discipline?: TradeListItem["discipline"];
} = {}): TradeListItem {
  const { strategyName, setupName, confidence, emotion, discipline, ...trade } = overrides;
  return {
    trade: {
      id: "t1",
      user_id: "u1",
      asset_id: null,
      pair: "EUR/USD",
      direction: "long",
      entry_price: 1.1,
      exit_price: 1.12,
      tp: null,
      sl: null,
      position_size: 1000,
      leverage: 1,
      fees: 0,
      opened_at: "2026-10-20T08:00:00.000Z",
      closed_at: "2026-10-20T10:00:00.000Z",
      status: "closed",
      strategy_id: null,
      setup_id: null,
      market_condition: "trending",
      trade_reason: "strategy",
      session: "london",
      notes: null,
      pnl: 20,
      roi_pct: null,
      r_multiple: null,
      risk_reward: null,
      is_win: true,
      duration_seconds: 7200,
      reversal_trade_id: null,
      created_at: "2026-10-20T10:00:00.000Z",
      updated_at: "2026-10-20T10:00:00.000Z",
      ...trade,
    },
    strategyName: strategyName ?? null,
    setupName: setupName ?? null,
    confidence: confidence ?? null,
    emotion: emotion ?? null,
    discipline: discipline ?? null,
  };
}

const items = [
  item({ id: "1", pair: "EUR/USD", direction: "long", session: "london", is_win: true, confidence: 5, emotion: "calm" }),
  item({ id: "2", pair: "BTCUSDT", direction: "short", session: "asia", is_win: false, confidence: 2, emotion: "fomo", market_condition: "choppy" }),
  item({ id: "3", pair: "XAUUSD", direction: "long", session: "new_york", is_win: null, status: "open", exit_price: null, closed_at: null, pnl: null, strategyName: "FVG" }),
];

function filters(partial: Partial<TradeFilters> = {}): TradeFilters {
  return { page: 1, perPage: 20, ...partial };
}

describe("applyTradeFilters (spec §32)", () => {
  it("returns everything with no filters", () => {
    expect(applyTradeFilters(items, filters())).toHaveLength(3);
  });
  it("searches pair, strategy and setup text", () => {
    expect(applyTradeFilters(items, filters({ q: "btc" }))).toHaveLength(1);
    expect(applyTradeFilters(items, filters({ q: "fvg" }))).toHaveLength(1);
  });
  it("filters by direction and session", () => {
    expect(applyTradeFilters(items, filters({ direction: "short" }))).toHaveLength(1);
    expect(applyTradeFilters(items, filters({ session: "london" }))).toHaveLength(1);
  });
  it("filters by outcome and excludes open trades from win/loss", () => {
    expect(applyTradeFilters(items, filters({ outcome: "win" }))).toHaveLength(1);
    expect(applyTradeFilters(items, filters({ outcome: "loss" }))).toHaveLength(1);
  });
  it("filters by psychology: confidence and emotion", () => {
    expect(applyTradeFilters(items, filters({ confidence: 5 }))).toHaveLength(1);
    expect(applyTradeFilters(items, filters({ emotion: "fomo" }))).toHaveLength(1);
  });
  it("filters by market condition and date range", () => {
    expect(applyTradeFilters(items, filters({ marketCondition: "choppy" }))).toHaveLength(1);
    expect(applyTradeFilters(items, filters({ from: "2026-10-21T00:00:00.000Z" }))).toHaveLength(0);
  });
});

describe("paginate", () => {
  it("pages correctly and clamps out-of-range pages", () => {
    const r = paginate([1, 2, 3, 4, 5], 2, 2);
    expect(r.items).toEqual([3, 4]);
    expect(r.total).toBe(5);
    expect(r.totalPages).toBe(3);
    expect(paginate([1, 2], 99, 2).page).toBe(1);
  });
});

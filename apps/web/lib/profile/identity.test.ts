import { describe, expect, it } from "vitest";
import type { AnalyticTrade } from "@/lib/analytics/types";
import {
  bestStrategy,
  identityMarkets,
  identitySessions,
  mostTradedSession,
  mostUsedStrategy,
  sessionLabel,
  topPairs,
} from "./identity";

function trade(overrides: Partial<AnalyticTrade>): AnalyticTrade {
  return {
    id: "t",
    pair: "XAUUSD",
    direction: "long",
    session: "london",
    strategyName: "FVG",
    pnl: 10,
    rMultiple: 1,
    closedAt: "2026-10-20T10:00:00.000Z",
    openedAt: "2026-10-20T09:00:00.000Z",
    emotion: null,
    discipline: null,
    confidence: null,
    journaled: true,
    stopLossSet: true,
    ...overrides,
  };
}

describe("topPairs", () => {
  it("returns the most frequent pairs first and nothing invented with no trades", () => {
    expect(topPairs([])).toEqual([]);
    const trades = [
      trade({ pair: "EURUSD" }),
      trade({ pair: "XAUUSD" }),
      trade({ pair: "XAUUSD" }),
      trade({ pair: "BTCUSD" }),
      trade({ pair: "XAUUSD" }),
    ];
    expect(topPairs(trades)).toEqual(["XAUUSD", "BTCUSD", "EURUSD"]);
    expect(topPairs(trades, 2)).toEqual(["XAUUSD", "BTCUSD"]);
  });
});

describe("mostUsedStrategy / mostTradedSession", () => {
  it("returns null with no data and the most frequent value otherwise", () => {
    expect(mostUsedStrategy([])).toBeNull();
    expect(mostTradedSession([])).toBeNull();
    const trades = [
      trade({ strategyName: "FVG", session: "new_york" }),
      trade({ strategyName: "Order Block", session: "london" }),
      trade({ strategyName: "FVG", session: "london" }),
    ];
    expect(mostUsedStrategy(trades)).toBe("FVG");
    expect(mostTradedSession(trades)).toBe("london");
  });

  it("ignores trades with no strategy recorded", () => {
    const trades = [trade({ strategyName: null }), trade({ strategyName: "BOS" })];
    expect(mostUsedStrategy(trades)).toBe("BOS");
  });
});

describe("sessionLabel", () => {
  it("labels sessions for display", () => {
    expect(sessionLabel("new_york")).toBe("New York");
    expect(sessionLabel("asia")).toBe("Asia");
    expect(sessionLabel("london")).toBe("London");
  });
});

describe("bestStrategy", () => {
  it("returns null when no strategy has 3 trades yet", () => {
    const trades = [
      trade({ strategyName: "FVG", pnl: 10 }),
      trade({ strategyName: "FVG", pnl: 10 }),
    ];
    expect(bestStrategy(trades)).toBeNull();
  });

  it("picks the highest win rate among strategies with 3+ trades", () => {
    const trades = [
      trade({ strategyName: "FVG", pnl: 10 }),
      trade({ strategyName: "FVG", pnl: -5 }),
      trade({ strategyName: "FVG", pnl: 10 }),
      trade({ strategyName: "BOS", pnl: 10 }),
      trade({ strategyName: "BOS", pnl: 10 }),
      trade({ strategyName: "BOS", pnl: 10 }),
    ];
    expect(bestStrategy(trades)).toEqual({ name: "BOS", winRate: 100, trades: 3 });
  });
});

describe("identityMarkets / identitySessions", () => {
  it("prefers the active plan and falls back to trade history", () => {
    const trades = [trade({ pair: "XAUUSD", session: "new_york" })];
    expect(identityMarkets(["BTC", "ETH"], trades)).toEqual(["BTC", "ETH"]);
    expect(identityMarkets([], trades)).toEqual(["XAUUSD"]);
    expect(identityMarkets(null, [])).toEqual([]);
    expect(identitySessions(["london", "asia"], trades)).toEqual(["london", "asia"]);
    expect(identitySessions([], trades)).toEqual(["new_york"]);
    expect(identitySessions(null, [])).toEqual([]);
  });
});

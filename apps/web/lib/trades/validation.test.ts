import { describe, expect, it } from "vitest";
import {
  advancedReviewSchema,
  quickTradeSchema,
  tradeFiltersSchema,
} from "./validation";

const closedTrade = {
  pair: "eur/usd",
  direction: "long",
  entryPrice: 1.1,
  exitPrice: 1.12,
  tp: 1.13,
  sl: 1.09,
  positionSize: 10000,
  leverage: 10,
  fees: 2,
  openedAt: "2026-10-20T08:00:00.000Z",
  closedAt: "2026-10-20T10:00:00.000Z",
};

describe("quickTradeSchema — minimal entry (spec §9, §16)", () => {
  it("accepts a closed trade and normalises the pair to upper case", () => {
    const parsed = quickTradeSchema.safeParse(closedTrade);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.pair).toBe("EUR/USD");
  });
  it("accepts an open trade with no exit and no closing time", () => {
    expect(
      quickTradeSchema.safeParse({ ...closedTrade, exitPrice: null, closedAt: null, tp: null, sl: null }).success,
    ).toBe(true);
  });
  it("accepts an optional strategy id (Phase 15 quick entry)", () => {
    const withStrategy = quickTradeSchema.safeParse({
      ...closedTrade,
      strategyId: "123e4567-e89b-12d3-a456-426614174000",
    });
    expect(withStrategy.success).toBe(true);
    if (withStrategy.success) {
      expect(withStrategy.data.strategyId).toBe("123e4567-e89b-12d3-a456-426614174000");
    }
    expect(quickTradeSchema.safeParse({ ...closedTrade, strategyId: null }).success).toBe(true);
    expect(quickTradeSchema.safeParse(closedTrade).success).toBe(true);
  });
  it("rejects a non-UUID strategy id", () => {
    expect(quickTradeSchema.safeParse({ ...closedTrade, strategyId: "fvg" }).success).toBe(false);
  });
  it("accepts a trade with no TP/SL/fees — they are optional", () => {
    expect(
      quickTradeSchema.safeParse({ ...closedTrade, tp: null, sl: null, fees: null }).success,
    ).toBe(true);
  });
  it("rejects an exit price without a closing time", () => {
    expect(quickTradeSchema.safeParse({ ...closedTrade, closedAt: null }).success).toBe(false);
  });
  it("rejects a closing time before the opening time", () => {
    expect(
      quickTradeSchema.safeParse({ ...closedTrade, closedAt: "2026-10-20T07:00:00.000Z" }).success,
    ).toBe(false);
  });
  it("rejects a zero or negative entry price", () => {
    expect(quickTradeSchema.safeParse({ ...closedTrade, entryPrice: 0 }).success).toBe(false);
    expect(quickTradeSchema.safeParse({ ...closedTrade, entryPrice: -1 }).success).toBe(false);
  });
  it("rejects leverage below 1 or above 500", () => {
    expect(quickTradeSchema.safeParse({ ...closedTrade, leverage: 0 }).success).toBe(false);
    expect(quickTradeSchema.safeParse({ ...closedTrade, leverage: 501 }).success).toBe(false);
  });
  it("rejects a pair with spaces inside or illegal characters", () => {
    expect(quickTradeSchema.safeParse({ ...closedTrade, pair: "EUR USD!" }).success).toBe(false);
    expect(quickTradeSchema.safeParse({ ...closedTrade, pair: "" }).success).toBe(false);
  });
  it("rejects a negative position size", () => {
    expect(quickTradeSchema.safeParse({ ...closedTrade, positionSize: -5 }).success).toBe(false);
  });
});

describe("advancedReviewSchema — everything optional (spec §16)", () => {
  it("accepts an empty review (quick entry alone is a valid trade)", () => {
    expect(
      advancedReviewSchema.safeParse({
        tradeId: "00000000-0000-0000-0000-000000000001",
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
      }).success,
    ).toBe(true);
  });
  it("accepts a full review", () => {
    expect(
      advancedReviewSchema.safeParse({
        tradeId: "00000000-0000-0000-0000-000000000001",
        strategyId: null,
        setupName: "London open",
        marketCondition: "trending",
        tradeReason: "fomo",
        session: "london",
        confidence: 2,
        emotion: "fomo",
        discipline: "poor",
        lesson: "Waited for confirmation next time.",
        notes: "Entered before confirmation.",
      }).success,
    ).toBe(true);
  });
  it("rejects confidence outside 1–5", () => {
    expect(
      advancedReviewSchema.safeParse({
        tradeId: "00000000-0000-0000-0000-000000000001",
        strategyId: null,
        setupName: null,
        marketCondition: null,
        tradeReason: null,
        session: null,
        confidence: 6,
        emotion: null,
        discipline: null,
        lesson: null,
        notes: null,
      }).success,
    ).toBe(false);
  });
});

describe("tradeFiltersSchema (spec §32)", () => {
  it("defaults to page 1 and 20 per page", () => {
    const parsed = tradeFiltersSchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.page).toBe(1);
      expect(parsed.data.perPage).toBe(20);
    }
  });
  it("rejects a page below 1", () => {
    expect(tradeFiltersSchema.safeParse({ page: 0 }).success).toBe(false);
  });
});

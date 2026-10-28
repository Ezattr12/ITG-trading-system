import { describe, expect, it } from "vitest";
import { riskRulesSchema, tradingPlanSchema } from "./validation";

/** Risk rules & trading-plan validation tests (Phase 5, spec §19–20). */

describe("riskRulesSchema", () => {
  it("accepts a full set of limits", () => {
    expect(
      riskRulesSchema.safeParse({
        maxRiskPerTradePct: 1,
        maxDailyLoss: 200,
        maxTradesPerDay: 5,
        maxConsecutiveLosses: 3,
        maxLeverage: 10,
      }).success,
    ).toBe(true);
  });

  it("accepts all-null (no limits set)", () => {
    expect(
      riskRulesSchema.safeParse({
        maxRiskPerTradePct: null,
        maxDailyLoss: null,
        maxTradesPerDay: null,
        maxConsecutiveLosses: null,
        maxLeverage: null,
      }).success,
    ).toBe(true);
  });

  it("rejects a zero risk per trade and leverage below 1", () => {
    expect(
      riskRulesSchema.safeParse({
        maxRiskPerTradePct: 0,
        maxDailyLoss: null,
        maxTradesPerDay: null,
        maxConsecutiveLosses: null,
        maxLeverage: 0.5,
      }).success,
    ).toBe(false);
  });

  it("rejects a negative daily loss and a fractional trade limit", () => {
    expect(
      riskRulesSchema.safeParse({
        maxRiskPerTradePct: null,
        maxDailyLoss: -10,
        maxTradesPerDay: 2.5,
        maxConsecutiveLosses: null,
        maxLeverage: null,
      }).success,
    ).toBe(false);
  });
});

describe("tradingPlanSchema", () => {
  const base = {
    name: "My Plan",
    markets: ["EUR/USD"],
    sessions: ["london"],
    riskPerTradePct: 1,
    maxDailyLoss: 200,
    maxDailyTrades: 5,
    preferredSetupIds: [],
    noTradeConditions: null,
    psychologyRules: null,
    scheduleNotes: null,
  };

  it("accepts a complete plan", () => {
    expect(tradingPlanSchema.safeParse(base).success).toBe(true);
  });

  it("requires a name", () => {
    expect(tradingPlanSchema.safeParse({ ...base, name: "  " }).success).toBe(false);
  });

  it("rejects an invalid session and a non-UUID setup id", () => {
    expect(
      tradingPlanSchema.safeParse({
        ...base,
        sessions: ["tokyo"],
        preferredSetupIds: ["not-a-uuid"],
      }).success,
    ).toBe(false);
  });
});

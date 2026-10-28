import { describe, expect, it } from "vitest";
import { goalProgressSchema, goalSchema, goalStatusSchema } from "./validation";

describe("goalSchema", () => {
  const valid = {
    title: "Journal 15 trades",
    period: "monthly",
    goalType: "max_trades",
    targetValue: 15,
    targetUnit: "trades",
    startDate: "2026-10-01",
    endDate: null,
  };

  it("accepts a valid goal", () => {
    expect(goalSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a zero or negative target", () => {
    expect(goalSchema.safeParse({ ...valid, targetValue: 0 }).success).toBe(false);
    expect(goalSchema.safeParse({ ...valid, targetValue: -5 }).success).toBe(false);
  });

  it("rejects an end date before the start date", () => {
    expect(
      goalSchema.safeParse({ ...valid, endDate: "2026-09-30" }).success,
    ).toBe(false);
  });

  it("rejects an unknown period or type", () => {
    expect(goalSchema.safeParse({ ...valid, period: "decade" }).success).toBe(false);
    expect(goalSchema.safeParse({ ...valid, goalType: "win_every_trade" }).success).toBe(false);
  });

  it("rejects an empty title", () => {
    expect(goalSchema.safeParse({ ...valid, title: "  " }).success).toBe(false);
  });
});

describe("goalProgressSchema", () => {
  it("accepts a valid progress record", () => {
    expect(
      goalProgressSchema.safeParse({
        goalId: "00000000-0000-4000-8000-000000000001",
        currentValue: 12,
        note: null,
      }).success,
    ).toBe(true);
  });

  it("rejects negative progress and a bad goal id", () => {
    expect(
      goalProgressSchema.safeParse({ goalId: "not-a-uuid", currentValue: 1, note: null }).success,
    ).toBe(false);
    expect(
      goalProgressSchema.safeParse({
        goalId: "00000000-0000-4000-8000-000000000001",
        currentValue: -1,
        note: null,
      }).success,
    ).toBe(false);
  });
});

describe("goalStatusSchema", () => {
  it("accepts the four statuses and rejects anything else", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    for (const status of ["active", "completed", "paused", "failed"]) {
      expect(goalStatusSchema.safeParse({ goalId: id, status }).success).toBe(true);
    }
    expect(goalStatusSchema.safeParse({ goalId: id, status: "abandoned" }).success).toBe(false);
  });
});

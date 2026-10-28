import { describe, expect, it } from "vitest";
import {
  evaluateMonthlyEligibility,
  type MonthlyCertificateInputs,
} from "./eligibility";

/**
 * Certificate eligibility boundaries (Phase 12, spec §26).
 *
 * The thresholds are exact: "at least 80%" means 79.6% fails.
 * Before Phase 12 the percentage was rounded before comparison,
 * so 39 of 49 trades (79.59%) wrongly passed an 80% rule — the
 * two rounding cases below pin the fix.
 */

const MEETS_ALL: MonthlyCertificateInputs = {
  month: "2026-10-01",
  tradesCount: 10,
  journaledTrades: 10,
  disciplinedTrades: 10,
  criticalBreaches: 0,
  activeDays: 10,
  activeWeeks: 3,
  completedWeeklyReviews: 2,
};

function criterion(input: MonthlyCertificateInputs, key: string) {
  const found = evaluateMonthlyEligibility(input).criteria.find((c) => c.key === key);
  if (!found) throw new Error(`missing criterion ${key}`);
  return found;
}

describe("journaling boundary", () => {
  it("passes at exactly 80% (4 of 5)", () => {
    expect(
      criterion({ ...MEETS_ALL, tradesCount: 5, journaledTrades: 4 }, "journaling").met,
    ).toBe(true);
  });

  it("fails at 79.59% (39 of 49) — rounding must not rescue it", () => {
    expect(
      criterion({ ...MEETS_ALL, tradesCount: 49, journaledTrades: 39 }, "journaling").met,
    ).toBe(false);
  });

  it("passes at exactly 80% of a larger month (40 of 50)", () => {
    expect(
      criterion({ ...MEETS_ALL, tradesCount: 50, journaledTrades: 40 }, "journaling").met,
    ).toBe(true);
  });

  it("fails below 5 trades even at 100% journaling", () => {
    expect(
      criterion({ ...MEETS_ALL, tradesCount: 4, journaledTrades: 4 }, "journaling").met,
    ).toBe(false);
  });
});

describe("risk discipline boundary", () => {
  it("passes at exactly 90% (9 of 10) with no critical breach", () => {
    expect(
      criterion({ ...MEETS_ALL, tradesCount: 10, disciplinedTrades: 9 }, "risk_discipline").met,
    ).toBe(true);
  });

  it("fails at 89.8% (44 of 49) — rounding must not rescue it", () => {
    expect(
      criterion({ ...MEETS_ALL, tradesCount: 49, disciplinedTrades: 44 }, "risk_discipline").met,
    ).toBe(false);
  });

  it("fails on a single critical breach even at 100% discipline", () => {
    expect(
      criterion({ ...MEETS_ALL, criticalBreaches: 1 }, "risk_discipline").met,
    ).toBe(false);
  });
});

describe("routine boundary", () => {
  it("passes at exactly 8 days across exactly 2 weeks", () => {
    expect(
      criterion({ ...MEETS_ALL, activeDays: 8, activeWeeks: 2 }, "routine").met,
    ).toBe(true);
  });

  it("fails at 7 active days", () => {
    expect(
      criterion({ ...MEETS_ALL, activeDays: 7, activeWeeks: 3 }, "routine").met,
    ).toBe(false);
  });

  it("fails at 8 days squeezed into a single week", () => {
    expect(
      criterion({ ...MEETS_ALL, activeDays: 8, activeWeeks: 1 }, "routine").met,
    ).toBe(false);
  });
});

describe("whole-month eligibility", () => {
  it("is eligible only when every criterion is met at its boundary", () => {
    const eligible = evaluateMonthlyEligibility({
      ...MEETS_ALL,
      tradesCount: 5,
      journaledTrades: 4,
      disciplinedTrades: 5,
      activeDays: 8,
      activeWeeks: 2,
      completedWeeklyReviews: 1,
    });
    expect(eligible.eligible).toBe(true);
  });

  it("is not eligible when exactly one criterion misses", () => {
    const eligible = evaluateMonthlyEligibility({ ...MEETS_ALL, completedWeeklyReviews: 0 });
    expect(eligible.eligible).toBe(false);
    expect(eligible.criteria.find((c) => c.key === "review")?.met).toBe(false);
  });
});

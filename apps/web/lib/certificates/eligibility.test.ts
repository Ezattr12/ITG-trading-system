import { describe, expect, it } from "vitest";
import {
  evaluateMonthlyEligibility,
  eligibilityToCriteriaMet,
  generateCertificateId,
  monthLabel,
  monthStart,
  type MonthlyCertificateInputs,
} from "./eligibility";

const base: MonthlyCertificateInputs = {
  month: "2026-10-01",
  tradesCount: 20,
  journaledTrades: 18,
  disciplinedTrades: 19,
  criticalBreaches: 0,
  activeDays: 12,
  activeWeeks: 4,
  completedWeeklyReviews: 2,
};

describe("evaluateMonthlyEligibility", () => {
  it("is eligible when every criterion is met", () => {
    const result = evaluateMonthlyEligibility(base);
    expect(result.eligible).toBe(true);
    expect(result.criteria.every((c) => c.met)).toBe(true);
  });

  it("blocks on journaling below 80%", () => {
    const result = evaluateMonthlyEligibility({
      ...base,
      journaledTrades: 10,
    });
    expect(result.eligible).toBe(false);
    expect(result.criteria.find((c) => c.key === "journaling")?.met).toBe(
      false,
    );
    expect(result.criteria.find((c) => c.key === "risk_discipline")?.met).toBe(
      true,
    );
  });

  it("blocks when fewer than 5 trades in the month", () => {
    const result = evaluateMonthlyEligibility({
      ...base,
      tradesCount: 4,
      journaledTrades: 4,
      disciplinedTrades: 4,
    });
    expect(result.eligible).toBe(false);
    expect(result.criteria.find((c) => c.key === "journaling")?.met).toBe(
      false,
    );
  });

  it("blocks on risk discipline below 90%", () => {
    const result = evaluateMonthlyEligibility({
      ...base,
      disciplinedTrades: 15,
    });
    expect(result.eligible).toBe(false);
    expect(result.criteria.find((c) => c.key === "risk_discipline")?.met).toBe(
      false,
    );
  });

  it("blocks on any critical breach, even at 100% discipline", () => {
    const result = evaluateMonthlyEligibility({
      ...base,
      disciplinedTrades: 20,
      criticalBreaches: 1,
    });
    expect(result.eligible).toBe(false);
    expect(result.criteria.find((c) => c.key === "risk_discipline")?.met).toBe(
      false,
    );
  });

  it("blocks on routine below 8 active days or 2 weeks", () => {
    expect(
      evaluateMonthlyEligibility({ ...base, activeDays: 7 }).criteria.find(
        (c) => c.key === "routine",
      )?.met,
    ).toBe(false);
    expect(
      evaluateMonthlyEligibility({ ...base, activeWeeks: 1 }).criteria.find(
        (c) => c.key === "routine",
      )?.met,
    ).toBe(false);
  });

  it("blocks when no weekly review was completed", () => {
    const result = evaluateMonthlyEligibility({
      ...base,
      completedWeeklyReviews: 0,
    });
    expect(result.eligible).toBe(false);
    expect(result.criteria.find((c) => c.key === "review")?.met).toBe(false);
  });

  it("meets no criterion in a month with no trades", () => {
    const result = evaluateMonthlyEligibility({
      ...base,
      tradesCount: 0,
      journaledTrades: 0,
      disciplinedTrades: 0,
      activeDays: 0,
      activeWeeks: 0,
      completedWeeklyReviews: 0,
    });
    expect(result.eligible).toBe(false);
    expect(result.criteria.every((c) => !c.met)).toBe(true);
    // 0 trades is not 100% of anything: details must say so.
    expect(result.criteria[0].detail).toContain("No closed trades");
  });

  it("stores the evidence in criteria_met", () => {
    const eligibility = evaluateMonthlyEligibility(base);
    const met = eligibilityToCriteriaMet(eligibility, base);
    expect(met.trades_count).toBe(20);
    expect(met.journal_completion_pct).toBe(90);
    expect(met.discipline_pct).toBe(95);
    expect(met.critical_breaches).toBe(0);
    expect(met.criteria).toEqual({
      journaling: true,
      risk_discipline: true,
      routine: true,
      review: true,
    });
  });
});

describe("generateCertificateId", () => {
  it("formats as ITG-YYYYMM-XXXXXX and is unique per call", () => {
    const a = generateCertificateId("2026-10-01");
    const b = generateCertificateId("2026-10-01");
    expect(a).toMatch(/^ITG-202610-[0-9A-F]{6}$/);
    expect(a).not.toBe(b);
  });

  it("accepts a fixed suffix for deterministic tests", () => {
    expect(generateCertificateId("2026-10-01", "ABC123")).toBe(
      "ITG-202610-ABC123",
    );
  });
});

describe("month helpers", () => {
  it("normalises YYYY-MM to the first of the month", () => {
    expect(monthStart("2026-10")).toBe("2026-10-01");
    expect(monthStart("2026-10-15")).toBe("2026-10-01");
    expect(monthStart("not-a-date")).toBe("");
  });

  it("labels a month for display", () => {
    expect(monthLabel("2026-10-01")).toBe("October 2026");
  });
});

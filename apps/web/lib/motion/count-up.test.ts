import { describe, expect, it } from "vitest";
import { countUpValue, easeOutCubic } from "./count-up";

describe("easeOutCubic", () => {
  it("starts at 0 and ends at 1", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });

  it("clamps outside 0..1", () => {
    expect(easeOutCubic(-2)).toBe(0);
    expect(easeOutCubic(5)).toBe(1);
  });

  it("is ease-out: past halfway early", () => {
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });
});

describe("countUpValue", () => {
  it("returns from at 0ms and exactly to at the end", () => {
    expect(countUpValue(0, 100, 0, 700)).toBe(0);
    expect(countUpValue(0, 100, 700, 700)).toBe(100);
    expect(countUpValue(0, 100, 9999, 700)).toBe(100);
  });

  it("handles negative targets (a losing P&L counts down)", () => {
    expect(countUpValue(0, -250, 700, 700)).toBe(-250);
    const mid = countUpValue(0, -250, 350, 700);
    expect(mid).toBeLessThan(0);
    expect(mid).toBeGreaterThan(-250);
  });

  it("is monotonic between the endpoints", () => {
    const values = [0, 100, 200, 350, 500, 700].map((ms) =>
      countUpValue(10, 90, ms, 700),
    );
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    }
    expect(values[values.length - 1]).toBe(90);
  });

  it("returns to immediately for a zero or negative duration", () => {
    expect(countUpValue(0, 42, 0, 0)).toBe(42);
    expect(countUpValue(0, 42, 0, -5)).toBe(42);
  });

  it("clamps negative elapsed time to from", () => {
    expect(countUpValue(5, 50, -100, 700)).toBe(5);
  });
});

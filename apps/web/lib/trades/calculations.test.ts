import { describe, expect, it } from "vitest";
import { computeTradeMetrics, formatDuration, formatMoney } from "./calculations";
import type { QuickTradeInput } from "./validation";

const base: QuickTradeInput = {
  pair: "EUR/USD",
  direction: "long",
  entryPrice: 1.1,
  exitPrice: 1.12,
  tp: 1.13,
  sl: 1.09,
  positionSize: 10000,
  leverage: 10,
  fees: 0,
  openedAt: "2026-10-20T08:00:00.000Z",
  closedAt: "2026-10-20T10:00:00.000Z",
};

describe("computeTradeMetrics — server-calculated, never user-entered (spec §9)", () => {
  it("computes P&L, ROI, R and risk/reward for a winning long", () => {
    const m = computeTradeMetrics(base);
    expect(m.status).toBe("closed");
    // (1.12 - 1.10) * 10000 = 200
    expect(m.pnl).toBeCloseTo(200, 6);
    // invested = 1.10 * 10000 / 10 = 1100; ROI = 200/1100*100
    expect(m.roiPct).toBeCloseTo(18.1818, 3);
    // risk = |1.10-1.09|*10000 = 100; R = 200/100 = 2
    expect(m.rMultiple).toBeCloseTo(2, 6);
    // reward |1.13-1.10|=0.03, risk 0.01 -> 3
    expect(m.riskReward).toBeCloseTo(3, 6);
    expect(m.isWin).toBe(true);
    expect(m.durationSeconds).toBe(7200);
  });
  it("computes a winning short the other way round", () => {
    const m = computeTradeMetrics({ ...base, direction: "short", entryPrice: 1.12, exitPrice: 1.1 });
    expect(m.pnl).toBeCloseTo(200, 6);
    expect(m.isWin).toBe(true);
  });
  it("subtracts fees from P&L", () => {
    const m = computeTradeMetrics({ ...base, fees: 50 });
    expect(m.pnl).toBeCloseTo(150, 6);
  });
  it("returns nulls for an open trade — no P&L is invented", () => {
    const m = computeTradeMetrics({ ...base, exitPrice: null, closedAt: null });
    expect(m.status).toBe("open");
    expect(m.pnl).toBeNull();
    expect(m.roiPct).toBeNull();
    expect(m.rMultiple).toBeNull();
    expect(m.riskReward).toBeNull();
    expect(m.isWin).toBeNull();
    expect(m.durationSeconds).toBeNull();
  });
  it("returns null R when there is no stop loss", () => {
    const m = computeTradeMetrics({ ...base, sl: null });
    expect(m.rMultiple).toBeNull();
    expect(m.riskReward).toBeNull();
    expect(m.pnl).toBeCloseTo(200, 6);
  });
  it("marks a losing trade as not a win", () => {
    const m = computeTradeMetrics({ ...base, exitPrice: 1.08 });
    expect(m.pnl).toBeCloseTo(-200, 6);
    expect(m.isWin).toBe(false);
  });
});

describe("formatDuration", () => {
  it("formats seconds, minutes, hours and days", () => {
    expect(formatDuration(30)).toBe("30s");
    expect(formatDuration(90)).toBe("1m");
    expect(formatDuration(7200)).toBe("2h");
    expect(formatDuration(8100)).toBe("2h 15m");
    expect(formatDuration(90000)).toBe("1d 1h");
    expect(formatDuration(null)).toBe("—");
  });
});

describe("formatMoney", () => {
  it("formats with two decimals and leaves null as —", () => {
    expect(formatMoney(200)).toBe("200.00");
    expect(formatMoney(-12.5)).toBe("-12.50");
    expect(formatMoney(null)).toBe("—");
  });
});

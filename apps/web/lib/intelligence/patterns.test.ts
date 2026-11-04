import { describe, expect, it } from "vitest";
import { analyzePatterns } from "./patterns";
import type { IntelLesson, IntelTrade } from "./types";

/**
 * Personal Trading Pattern Engine (Task 18).
 *
 * Uniform standard under test: ≥5 closed trades overall,
 * ≥3 in a group, and significance = a ≥20-point win-rate
 * gap versus the trader's own baseline OR ≥50% of the
 * gross P&L movement. All fixtures are hand-computed.
 */

let seq = 0;
function trade(overrides: Partial<IntelTrade>): IntelTrade {
  seq += 1;
  return {
    id: `t${seq}`,
    pair: "XAUUSD",
    direction: "long",
    session: "london",
    strategyName: "Alpha",
    pnl: 0,
    rMultiple: null,
    closedAt: "2026-09-02T10:00:00Z",
    openedAt: "2026-09-02T09:00:00Z",
    emotion: null,
    discipline: null,
    confidence: null,
    journaled: true,
    stopLossSet: true,
    setupName: "Breakout",
    marketCondition: "trending",
    tradeReason: "strategy",
    leverage: 2,
    riskAmount: 100,
    ...overrides,
  };
}

function lesson(text: string, tradeId: string | null, repeated = false): IntelLesson {
  return { tradeId, text, repeatedMistake: repeated };
}

const find = (
  patterns: ReturnType<typeof analyzePatterns>["patterns"],
  kind: string,
  key: string,
) => patterns.find((p) => p.kind === kind && p.key === key);

describe("analyzePatterns — gates", () => {
  it("reports insufficient_data below 5 closed trades, with the baseline still shown", () => {
    const r = analyzePatterns(
      [trade({ pnl: 100 }), trade({ pnl: 100 }), trade({ pnl: -50 }), trade({ pnl: 100 })],
      [],
    );
    expect(r.status).toBe("insufficient_data");
    expect(r.tradesCount).toBe(4);
    expect(r.patterns).toEqual([]);
    expect(r.baseline).toEqual({ trades: 4, wins: 3, winRate: 75, totalPnl: 250 });
  });

  it("never surfaces a group of 2, even at 100% win rate and dominant P&L", () => {
    // Solo: 2 trades +500/+500. Base: 3 trades −100 ×3.
    // Baseline: 5 trades, 2 wins, 40% win rate, total +700.
    const trades = [
      trade({ strategyName: "Solo", pnl: 500 }),
      trade({ strategyName: "Solo", pnl: 500 }),
      trade({ strategyName: "Base", pnl: -100 }),
      trade({ strategyName: "Base", pnl: -100 }),
      trade({ strategyName: "Base", pnl: -100 }),
    ];
    const r = analyzePatterns(trades, []);
    expect(r.status).toBe("ok");
    expect(find(r.patterns, "strategy", "Solo")).toBeUndefined();
    expect(find(r.patterns, "strategy", "Base")).toMatchObject({
      direction: "drag",
      basis: "win_rate_gap",
      trades: 3,
      winRate: 0,
      winRateGap: -40,
    });
  });

  it("returns ok with zero patterns when no group stands out", () => {
    // 3 long / 3 short with identical outcomes per side.
    const side = [100, -100, 50];
    const trades = [
      ...side.map((pnl) => trade({ direction: "long", strategyName: null, session: "asia", pnl })),
      ...side.map((pnl) => trade({ direction: "short", strategyName: null, session: "asia", pnl })),
    ];
    const r = analyzePatterns(trades, []);
    expect(r.status).toBe("ok");
    expect(r.baseline.winRate).toBeCloseTo(66.67, 1);
    expect(r.patterns).toEqual([]);
  });
});

describe("analyzePatterns — win-rate gap", () => {
  // Alpha: 4 trades +100/+100/+100/−50 → 75% WR, +250.
  // Beta: 4 trades −100/−100/+50/−50 → 25% WR, −200.
  // Unrecorded: 2 trades +10/−10. Baseline: 10 trades,
  // 5 wins, 50% WR, total +50, gross 670.
  const trades = [
    trade({ strategyName: "Alpha", session: "london", pnl: 100 }),
    trade({ strategyName: "Alpha", session: "london", pnl: 100 }),
    trade({ strategyName: "Alpha", session: "asia", pnl: 100 }),
    trade({ strategyName: "Alpha", session: "asia", pnl: -50 }),
    trade({ strategyName: "Beta", session: "new_york", pnl: -100 }),
    trade({ strategyName: "Beta", session: "new_york", pnl: -100 }),
    trade({ strategyName: "Beta", session: "london", pnl: 50 }),
    trade({ strategyName: "Beta", session: "asia", pnl: -50 }),
    trade({ strategyName: null, session: null, pnl: 10 }),
    trade({ strategyName: null, session: null, pnl: -10 }),
  ];

  it("computes the baseline from all closed trades", () => {
    const r = analyzePatterns(trades, []);
    expect(r.baseline).toEqual({ trades: 10, wins: 5, winRate: 50, totalPnl: 50 });
  });

  it("surfaces an edge and a drag with exact evidence", () => {
    const r = analyzePatterns(trades, []);
    expect(find(r.patterns, "strategy", "Alpha")).toEqual({
      kind: "strategy",
      key: "Alpha",
      label: "Alpha",
      direction: "edge",
      basis: "win_rate_gap",
      trades: 4,
      wins: 3,
      losses: 1,
      winRate: 75,
      baselineWinRate: 50,
      winRateGap: 25,
      totalPnl: 250,
      avgPnl: 62.5,
      pnlShare: 250 / 670,
      occurrences: null,
    });
    expect(find(r.patterns, "strategy", "Beta")).toMatchObject({
      direction: "drag",
      basis: "win_rate_gap",
      trades: 4,
      wins: 1,
      winRate: 25,
      winRateGap: -25,
      totalPnl: -200,
    });
  });

  it("never calls the whole population a pattern (pair/direction cover all 10)", () => {
    const r = analyzePatterns(trades, []);
    expect(r.patterns.some((p) => p.kind === "pair")).toBe(false);
    expect(r.patterns.some((p) => p.kind === "direction")).toBe(false);
  });

  it("forms no group over unrecorded values (2 null-strategy trades join nothing)", () => {
    const r = analyzePatterns(trades, []);
    expect(r.patterns.some((p) => p.label.includes("No strategy"))).toBe(false);
    expect(r.patterns.some((p) => p.label.includes("recorded"))).toBe(false);
  });
});

describe("analyzePatterns — P&L dominance", () => {
  it("surfaces a dominant group whose win-rate gap is small", () => {
    // XAUUSD: 3 trades +600/+600/−100 → WR 66.7, +1100.
    // EURUSD: 5 trades +50/−40/+30/−20/+10 → WR 60, +30.
    // Baseline: 8 trades, 5 wins, 62.5% WR, gross 1450.
    // XAUUSD gap is only +4.2 points, but its share is 75.9%.
    const trades = [
      trade({ pair: "XAUUSD", strategyName: null, session: null, setupName: null, marketCondition: null, stopLossSet: false, pnl: 600 }),
      trade({ pair: "XAUUSD", strategyName: null, session: null, setupName: null, marketCondition: null, stopLossSet: false, pnl: 600 }),
      trade({ pair: "XAUUSD", strategyName: null, session: null, setupName: null, marketCondition: null, stopLossSet: false, pnl: -100 }),
      trade({ pair: "EURUSD", strategyName: null, session: null, setupName: null, marketCondition: null, stopLossSet: false, pnl: 50 }),
      trade({ pair: "EURUSD", strategyName: null, session: null, setupName: null, marketCondition: null, stopLossSet: false, pnl: -40 }),
      trade({ pair: "EURUSD", strategyName: null, session: null, setupName: null, marketCondition: null, stopLossSet: false, pnl: 30 }),
      trade({ pair: "EURUSD", strategyName: null, session: null, setupName: null, marketCondition: null, stopLossSet: false, pnl: -20 }),
      trade({ pair: "EURUSD", strategyName: null, session: null, setupName: null, marketCondition: null, stopLossSet: false, pnl: 10 }),
    ];
    const r = analyzePatterns(trades, []);
    const p = find(r.patterns, "pair", "XAUUSD");
    expect(p).toMatchObject({
      direction: "edge",
      basis: "pnl_dominance",
      trades: 3,
      wins: 2,
      totalPnl: 1100,
      winRateGap: null,
    });
    expect(p?.pnlShare).toBeCloseTo(1100 / 1450, 6);
    expect(find(r.patterns, "pair", "EURUSD")).toBeUndefined();
  });

  it("surfaces a dominant losing group as a drag", () => {
    const trades = [
      trade({ pair: "XAUUSD", strategyName: null, session: null, setupName: null, marketCondition: null, stopLossSet: false, pnl: -600 }),
      trade({ pair: "XAUUSD", strategyName: null, session: null, setupName: null, marketCondition: null, stopLossSet: false, pnl: -600 }),
      trade({ pair: "XAUUSD", strategyName: null, session: null, setupName: null, marketCondition: null, stopLossSet: false, pnl: 100 }),
      trade({ pair: "EURUSD", strategyName: null, session: null, setupName: null, marketCondition: null, stopLossSet: false, pnl: 50 }),
      trade({ pair: "EURUSD", strategyName: null, session: null, setupName: null, marketCondition: null, stopLossSet: false, pnl: -40 }),
      trade({ pair: "EURUSD", strategyName: null, session: null, setupName: null, marketCondition: null, stopLossSet: false, pnl: 30 }),
      trade({ pair: "EURUSD", strategyName: null, session: null, setupName: null, marketCondition: null, stopLossSet: false, pnl: -20 }),
      trade({ pair: "EURUSD", strategyName: null, session: null, setupName: null, marketCondition: null, stopLossSet: false, pnl: 10 }),
    ];
    const r = analyzePatterns(trades, []);
    expect(find(r.patterns, "pair", "XAUUSD")).toMatchObject({
      direction: "drag",
      basis: "pnl_dominance",
      totalPnl: -1100,
    });
  });
});

describe("analyzePatterns — stop-loss split is gap-only", () => {
  it("does not fire on P&L share alone in a two-way split", () => {
    // With SL: 4 trades +500/+100/−50/−50 → WR 50, +500 (56.8% of gross 880).
    // Without SL: 4 trades +60/−40/+30/−50 → WR 50, 0. Baseline WR 50.
    // The share would qualify on any other dimension; the gap is 0.
    const mk = (stopLossSet: boolean, pnl: number) =>
      trade({ strategyName: null, session: null, setupName: null, marketCondition: null, stopLossSet, pnl });
    const trades = [
      mk(true, 500), mk(true, 100), mk(true, -50), mk(true, -50),
      mk(false, 60), mk(false, -40), mk(false, 30), mk(false, -50),
    ];
    const r = analyzePatterns(trades, []);
    expect(r.patterns.some((p) => p.kind === "stop_loss")).toBe(false);
  });

  it("fires on a real win-rate gap between the split sides", () => {
    const mk = (stopLossSet: boolean, pnl: number) =>
      trade({ strategyName: null, session: null, setupName: null, marketCondition: null, stopLossSet, pnl });
    const trades = [
      mk(true, 100), mk(true, 100), mk(true, 100), mk(true, -100),
      mk(false, -100), mk(false, -100), mk(false, -100), mk(false, 100),
    ];
    const r = analyzePatterns(trades, []);
    expect(find(r.patterns, "stop_loss", "with_sl")).toMatchObject({
      direction: "edge",
      basis: "win_rate_gap",
      winRate: 75,
      winRateGap: 25,
    });
    expect(find(r.patterns, "stop_loss", "without_sl")).toMatchObject({
      direction: "drag",
      winRateGap: -25,
    });
  });
});

describe("analyzePatterns — market condition dimension (Task 25)", () => {
  // Other dimensions are neutralised in these fixtures
  // (strategy/session/setup unrecorded; pair and direction
  // cover the whole population), so any pattern found is
  // the condition dimension speaking.
  const neutral = { strategyName: null, session: null, setupName: null };

  it("surfaces recorded condition groups on the win-rate gap, with condition labels", () => {
    // Trending: +100/+100/+100/−50 → 75% win rate, +250.
    // Ranging: +50/−100/−100/−50 → 25% win rate, −200.
    // Baseline: 8 trades, 50% win rate, total +50, gross 650.
    const trades = [
      ...[100, 100, 100, -50].map((pnl) =>
        trade({ ...neutral, marketCondition: "trending", pnl }),
      ),
      ...[50, -100, -100, -50].map((pnl) =>
        trade({ ...neutral, marketCondition: "ranging", pnl }),
      ),
    ];
    const r = analyzePatterns(trades, []);
    expect(find(r.patterns, "market_condition", "trending")).toMatchObject({
      label: "Trending",
      direction: "edge",
      basis: "win_rate_gap",
      trades: 4,
      winRate: 75,
      winRateGap: 25,
      totalPnl: 250,
    });
    expect(find(r.patterns, "market_condition", "ranging")).toMatchObject({
      label: "Ranging",
      direction: "drag",
      basis: "win_rate_gap",
      trades: 4,
      winRate: 25,
      winRateGap: -25,
      totalPnl: -200,
    });
  });

  it("surfaces a recorded condition on P&L dominance when the gap is silent", () => {
    // Trending: 3 trades +600 ×3. Five unrecorded-condition
    // trades are all small wins, so the baseline win rate is
    // 100% and the gap is 0 — only dominance can speak.
    // Gross 1950; trending share 1800/1950 ≈ 92.3%.
    const trades = [
      ...[600, 600, 600].map((pnl) =>
        trade({ ...neutral, marketCondition: "trending", pnl }),
      ),
      ...[50, 40, 30, 20, 10].map((pnl) =>
        trade({ ...neutral, marketCondition: null, pnl }),
      ),
    ];
    const r = analyzePatterns(trades, []);
    const p = find(r.patterns, "market_condition", "trending");
    expect(p).toMatchObject({
      direction: "edge",
      basis: "pnl_dominance",
      trades: 3,
      totalPnl: 1800,
    });
    expect(p?.pnlShare).toBeCloseTo(1800 / 1950, 4);
  });

  it("never surfaces a condition group of 2, even at 100% win rate", () => {
    const trades = [
      trade({ ...neutral, marketCondition: "choppy", pnl: 500 }),
      trade({ ...neutral, marketCondition: "choppy", pnl: 500 }),
      ...[-100, -100, -100, 50].map((pnl) =>
        trade({ ...neutral, marketCondition: null, pnl }),
      ),
    ];
    const r = analyzePatterns(trades, []);
    expect(r.status).toBe("ok");
    expect(r.patterns.filter((p) => p.kind === "market_condition")).toEqual([]);
  });

  it("never treats unrecorded conditions as a regime, however the profit concentrates", () => {
    // Five unrecorded-condition trades hold +2,000 of profit;
    // three recorded trending trades are small and also win,
    // so the baseline win rate is 100% (gap 0) and the
    // trending share is ~1.5% — nothing may be claimed, and
    // above all the unrecorded concentration is not a
    // "condition" pattern.
    const trades = [
      ...[400, 400, 400, 400, 400].map((pnl) =>
        trade({ ...neutral, marketCondition: null, pnl }),
      ),
      ...[10, 10, 10].map((pnl) =>
        trade({ ...neutral, marketCondition: "trending", pnl }),
      ),
    ];
    const r = analyzePatterns(trades, []);
    expect(r.patterns.filter((p) => p.kind === "market_condition")).toEqual([]);
    expect(r.patterns).toEqual([]);
  });
});

describe("analyzePatterns — repeated mistakes", () => {
  const trades = [
    trade({ id: "m1", pnl: -100 }),
    trade({ id: "m2", pnl: -50 }),
    trade({ id: "m3", pnl: 100 }),
    trade({ id: "m4", pnl: 100 }),
    trade({ id: "m5", pnl: -20 }),
    trade({ id: "m6", pnl: 30 }),
  ];

  it("surfaces a lesson recorded twice, with its linked-trade impact", () => {
    const r = analyzePatterns(trades, [
      lesson("Chased entry", "m1", true),
      lesson("Chased entry", "m2", true),
      lesson("One-off note", "m3"),
    ]);
    const p = find(r.patterns, "repeated_mistake", "Chased entry");
    expect(p).toMatchObject({
      direction: "recurring",
      basis: "recurrence",
      occurrences: 2,
      trades: 2,
      wins: 0,
      losses: 2,
      winRate: 0,
      totalPnl: -150,
      winRateGap: null,
    });
    expect(find(r.patterns, "repeated_mistake", "One-off note")).toBeUndefined();
  });

  it("surfaces a repeated lesson with no linked closed trades, honestly zeroed", () => {
    const r = analyzePatterns(trades, [
      lesson("Forgot the plan", null),
      lesson("Forgot the plan", null),
      lesson("Forgot the plan", null),
    ]);
    expect(find(r.patterns, "repeated_mistake", "Forgot the plan")).toMatchObject({
      occurrences: 3,
      trades: 0,
      winRate: null,
      totalPnl: 0,
    });
  });
});

describe("analyzePatterns — verification account A fixture (real rows, 2026-11-02)", () => {
  // A's 8 closed trades exactly as stored (see docs/task-18):
  // 7W / 1L, total +3702.50, gross 3702.90, baseline WR 87.5%.
  const aTrades: IntelTrade[] = [
    trade({ id: "a1", pair: "XAUUSD", session: null, strategyName: null, setupName: null, marketCondition: null, stopLossSet: true, pnl: 1000 }),
    trade({ id: "a2", pair: "XAUUSD", session: "london", strategyName: null, setupName: null, marketCondition: "trending", stopLossSet: false, pnl: 1200 }),
    trade({ id: "a3", pair: "XAUUSD", session: "london", strategyName: "BOS", setupName: "London open breakout", marketCondition: null, emotion: "calm", confidence: 4, stopLossSet: true, pnl: 1.2 }),
    trade({ id: "a4", pair: "XAUUSD", session: null, strategyName: "BOS", setupName: null, marketCondition: null, stopLossSet: false, pnl: 0.5 }),
    trade({ id: "a5", pair: "XAUUSD", session: null, strategyName: "BOS", setupName: null, marketCondition: null, stopLossSet: false, pnl: 0.5 }),
    trade({ id: "a6", pair: "EURUSD", session: null, strategyName: null, setupName: null, marketCondition: null, stopLossSet: true, pnl: 0.5 }),
    trade({ id: "a7", pair: "GBPUSD", session: null, strategyName: null, setupName: null, marketCondition: null, stopLossSet: true, pnl: -0.2 }),
    trade({ id: "a8", pair: "XAUUSD", session: null, strategyName: null, setupName: null, marketCondition: null, stopLossSet: true, pnl: 1500 }),
  ];
  const aLessons: IntelLesson[] = [
    lesson("M2P23 verification: entered before confirmation", "a3", true),
    lesson("M2P23 verification: entered before confirmation", "a1", true),
    lesson("M2P23 verification: entered before confirmation", "a4", true),
    lesson("Wait for confirmation before entering.", "a2"),
    lesson("Waited for confirmation.", "a2"),
  ];

  it("yields exactly the two patterns A's evidence supports", () => {
    const r = analyzePatterns(aTrades, aLessons);
    expect(r.status).toBe("ok");
    expect(r.baseline.trades).toBe(8);
    expect(r.baseline.wins).toBe(7);
    expect(r.baseline.winRate).toBe(87.5);
    expect(r.baseline.totalPnl).toBeCloseTo(3702.5, 6);
    expect(r.patterns).toHaveLength(2);

    const xau = find(r.patterns, "pair", "XAUUSD");
    expect(xau).toMatchObject({
      direction: "edge",
      basis: "pnl_dominance",
      trades: 6,
      wins: 6,
      winRate: 100,
      winRateGap: null,
    });
    expect(xau?.totalPnl).toBeCloseTo(3702.2, 6);
    expect(xau?.pnlShare).toBeCloseTo(3702.2 / 3702.9, 4);

    expect(find(r.patterns, "repeated_mistake", "M2P23 verification: entered before confirmation")).toMatchObject({
      direction: "recurring",
      basis: "recurrence",
      occurrences: 3,
      trades: 3,
      wins: 3,
      losses: 0,
    });
  });

  it("does not manufacture patterns A does not qualify for", () => {
    const r = analyzePatterns(aTrades, aLessons);
    // BOS: 3 trades at 100% vs 87.5% baseline is a +12.5 gap — below the standard.
    expect(find(r.patterns, "strategy", "BOS")).toBeUndefined();
    // Long covers all 8 trades — the baseline itself, never a pattern.
    expect(r.patterns.some((p) => p.kind === "direction")).toBe(false);
    // London has only 2 trades; calm only 1 — below the group minimum.
    expect(r.patterns.some((p) => p.kind === "session")).toBe(false);
    expect(r.patterns.some((p) => p.kind === "emotion")).toBe(false);
  });
});

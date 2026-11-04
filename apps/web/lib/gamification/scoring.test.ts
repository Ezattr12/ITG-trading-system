import { describe, expect, it } from "vitest";
import type { AnalyticTrade } from "@/lib/analytics/types";
import type { DimensionInputs, LevelRow } from "./types";
import {
  calcLevelScore,
  DEFAULT_DIMENSION_WEIGHTS,
  dimensionInputsFromBundle,
  levelForScore,
  parseScoringConfig,
  progressToNextLevel,
  scoreTrader,
  weeklyConsistencyPct,
} from "./scoring";

function levelRow(partial: Partial<LevelRow> = {}): LevelRow {
  return {
    id: "level-1",
    name: "Foundation",
    slug: "foundation",
    min_score: 0,
    max_score: 19,
    scoring_config: null,
    description: null,
    ...partial,
  };
}

/** The ten competency bands (Task 22), mirroring migration 0020. */
function levels(): LevelRow[] {
  return [
    levelRow({ id: "l1", name: "Foundation", slug: "foundation", min_score: 0, max_score: 19 }),
    levelRow({ id: "l2", name: "Technical Trader", slug: "technical-trader", min_score: 20, max_score: 39 }),
    levelRow({ id: "l3", name: "Risk Manager", slug: "risk-manager", min_score: 40, max_score: 49 }),
    levelRow({ id: "l4", name: "Strategy Operator", slug: "strategy-operator", min_score: 50, max_score: 59 }),
    levelRow({ id: "l5", name: "Psychological Discipline", slug: "psychological-discipline", min_score: 60, max_score: 69 }),
    levelRow({ id: "l6", name: "Consistency", slug: "consistency", min_score: 70, max_score: 79 }),
    levelRow({ id: "l7", name: "Professional Trader", slug: "professional-trader", min_score: 80, max_score: 86 }),
    levelRow({ id: "l8", name: "Institutional Trader", slug: "institutional-trader", min_score: 87, max_score: 92 }),
    levelRow({ id: "l9", name: "Trading Researcher", slug: "trading-researcher", min_score: 93, max_score: 96 }),
    levelRow({ id: "l10", name: "ITG Master Trader", slug: "itg-master-trader", min_score: 97, max_score: null }),
  ];
}

function inputs(partial: Partial<DimensionInputs> = {}): DimensionInputs {
  return {
    goodDisciplinePct: null,
    stopLossPct: null,
    journalCompletionPct: null,
    goalCompletionPct: null,
    avgConfidence: null,
    strategySetPct: null,
    weeklyConsistencyPct: null,
    winRate: null,
    ...partial,
  };
}

function trade(partial: Partial<AnalyticTrade> = {}): AnalyticTrade {
  return {
    id: "t1",
    pair: "EURUSD",
    direction: "long",
    session: "london",
    strategyName: "FVG",
    pnl: 10,
    rMultiple: 1,
    closedAt: "2026-10-26T10:00:00.000Z",
    openedAt: "2026-10-26T09:00:00.000Z",
    emotion: "calm",
    discipline: "good",
    confidence: 4,
    journaled: true,
    stopLossSet: true,
    ...partial,
  };
}

describe("parseScoringConfig", () => {
  it("returns the defaults for null, empty or invalid config", () => {
    expect(parseScoringConfig(null)).toEqual(DEFAULT_DIMENSION_WEIGHTS);
    expect(parseScoringConfig({})).toEqual(DEFAULT_DIMENSION_WEIGHTS);
    expect(parseScoringConfig("nope")).toEqual(DEFAULT_DIMENSION_WEIGHTS);
    expect(parseScoringConfig({ discipline: -1, risk: "high" })).toEqual(
      DEFAULT_DIMENSION_WEIGHTS,
    );
  });

  it("overrides valid weights and normalises them to sum to 1", () => {
    const weights = parseScoringConfig({ discipline: 1, risk: 1 });
    expect(weights.discipline).toBeCloseTo(weights.risk);
    const total = Object.values(weights).reduce((s, w) => s + w, 0);
    expect(total).toBeCloseTo(1);
    // discipline was raised from 0.20, so it now outweighs performance
    expect(weights.discipline).toBeGreaterThan(weights.performance);
  });

  it("ignores the Task 23 assessment block — weights are unchanged by it", () => {
    const withAssessment = parseScoringConfig({
      ...DEFAULT_DIMENSION_WEIGHTS,
      assessment: {
        bands: {
          foundation: { floor: null, min_measured: 3, confirm_after_days: 7 },
          "itg-master-trader": { floor: 60, min_measured: 8, confirm_after_days: 28 },
        },
      },
    });
    expect(withAssessment).toEqual(DEFAULT_DIMENSION_WEIGHTS);
  });
});

describe("calcLevelScore", () => {
  it("returns null with no measurable dimension", () => {
    const result = calcLevelScore(inputs());
    expect(result.score).toBeNull();
    expect(result.missingDimensions).toHaveLength(8);
  });

  it("does not score a missing dimension as 0 — weights renormalise", () => {
    // Only discipline measured, at 80: the score is 80, not 80 * 0.20.
    const result = calcLevelScore(inputs({ goodDisciplinePct: 80 }));
    expect(result.score).toBe(80);
    expect(result.missingDimensions).toHaveLength(7);
  });

  it("weights all eight dimensions when all are measured", () => {
    const all80 = inputs({
      goodDisciplinePct: 80,
      stopLossPct: 80,
      journalCompletionPct: 80,
      goalCompletionPct: 80,
      avgConfidence: 4, // 4/5 = 80
      strategySetPct: 80,
      weeklyConsistencyPct: 80,
      winRate: 80,
    });
    expect(calcLevelScore(all80).score).toBe(80);
  });

  it("is NOT profit-only: perfect performance alone stays at Foundation", () => {
    // Win rate 100, everything else unmeasured would be null, so
    // give the other dimensions a real (poor) measurement instead.
    const result = scoreTrader(
      inputs({
        goodDisciplinePct: 0,
        stopLossPct: 0,
        journalCompletionPct: 0,
        goalCompletionPct: 0,
        avgConfidence: 1, // 20
        strategySetPct: 0,
        weeklyConsistencyPct: 0,
        winRate: 100,
      }),
      levels(),
    );
    // Performance is 5% of the score: 100 * 0.05 + 20 * 0.10 = 7.
    expect(result.score).toBeCloseTo(7);
    expect(result.levelName).toBe("Foundation");
  });

  it("resolves the ten bands at the configured thresholds", () => {
    const at = (v: number) =>
      scoreTrader(
        inputs({
          goodDisciplinePct: v,
          stopLossPct: v,
          journalCompletionPct: v,
          goalCompletionPct: v,
          avgConfidence: (v / 100) * 5,
          strategySetPct: v,
          weeklyConsistencyPct: v,
          winRate: v,
        }),
        levels(),
      ).levelName;
    expect(at(0)).toBe("Foundation");
    expect(at(50)).toBe("Strategy Operator");
    expect(at(70)).toBe("Consistency");
    expect(at(90)).toBe("Institutional Trader");
    expect(at(97)).toBe("ITG Master Trader");
  });

  it("Account A continuity: the stored breakdown scores 59.2 → Strategy Operator", () => {
    // The verification account's production score_breakdown
    // (user_levels, calculated 2026-11-02): discipline 100,
    // risk 62.5, journal 37.5, goals 16, psychology 80,
    // strategy 37.5, consistency 50, performance 87.5 — a stored
    // score of 59.2. The score computation is unchanged by
    // Task 22, so the same inputs must reproduce 59.2 exactly;
    // 59.2 sits in the old Silver range (40–59), whose anchor-
    // preserving subdivision at 50–59 is Strategy Operator.
    // (Under the pre-Task-22 max-edge resolution, 59.2 matched
    // no band and fell through to the top level — the stored
    // row's level says Platinum. That was the defect, not the
    // trader's standing.)
    const result = scoreTrader(
      inputs({
        goodDisciplinePct: 100,
        stopLossPct: 62.5,
        journalCompletionPct: 37.5,
        goalCompletionPct: 16,
        avgConfidence: 4, // psychology dimension value 80
        strategySetPct: 37.5,
        weeklyConsistencyPct: 50,
        winRate: 87.5,
      }),
      levels(),
    );
    expect(result.score).toBe(59.2);
    expect(result.levelName).toBe("Strategy Operator");
  });
});

describe("levelForScore / progressToNextLevel", () => {
  it("returns null with no score, and uses defaults with no level rows", () => {
    expect(levelForScore(null, levels())).toBeNull();
    expect(levelForScore(55, [])).toBe("Strategy Operator");
    // Fractional scores resolve by min threshold — no gap fall-through.
    expect(levelForScore(59.2, levels())).toBe("Strategy Operator");
  });

  it("reports points to the next level and band progress", () => {
    const progress = progressToNextLevel(55, levels());
    expect(progress?.currentLevel).toBe("Strategy Operator");
    expect(progress?.nextLevel).toBe("Psychological Discipline");
    expect(progress?.pointsToNext).toBe(5);
    expect(progress?.progressPct).toBe(50);
  });

  it("is complete at ITG Master Trader, and null with no score", () => {
    const top = progressToNextLevel(98, levels());
    expect(top?.nextLevel).toBeNull();
    expect(top?.pointsToNext).toBeNull();
    expect(top?.progressPct).toBe(100);
    expect(progressToNextLevel(null, levels())).toBeNull();
  });
});

describe("weeklyConsistencyPct", () => {
  it("returns null with no trades and 0 with no journaled trades", () => {
    expect(weeklyConsistencyPct([], "2026-10-27")).toBeNull();
    expect(
      weeklyConsistencyPct([trade({ journaled: false })], "2026-10-27"),
    ).toBe(0);
  });

  it("scores only weeks since the first trade, most recent 12", () => {
    // One journaled trade in each of the last 2 weeks: 100%.
    const trades = [
      trade({ id: "a", closedAt: "2026-10-20T10:00:00.000Z" }),
      trade({ id: "b", closedAt: "2026-10-26T10:00:00.000Z" }),
    ];
    expect(weeklyConsistencyPct(trades, "2026-10-27")).toBe(100);
    // Only the current week journaled, first trade 3 weeks ago: 1/3.
    const sparse = [
      trade({ id: "a", closedAt: "2026-10-12T10:00:00.000Z", journaled: false }),
      trade({ id: "b", closedAt: "2026-10-26T10:00:00.000Z" }),
    ];
    expect(weeklyConsistencyPct(sparse, "2026-10-27")).toBeCloseTo(100 / 3);
  });
});

describe("dimensionInputsFromBundle", () => {
  it("returns nulls with no trades and no goals", () => {
    const result = dimensionInputsFromBundle([], [], "2026-10-27");
    expect(result.goodDisciplinePct).toBeNull();
    expect(result.winRate).toBeNull();
    expect(result.goalCompletionPct).toBeNull();
    expect(result.weeklyConsistencyPct).toBeNull();
  });

  it("builds real inputs from trades and goals", () => {
    const trades = [
      trade({ pnl: 10, discipline: "good", confidence: 5 }),
      trade({
        id: "t2",
        pnl: -5,
        discipline: "poor",
        confidence: 3,
        strategyName: null,
        stopLossSet: false,
      }),
    ];
    const result = dimensionInputsFromBundle(
      trades,
      [{ id: "g1", title: "G", period: "monthly", targetValue: 10, currentValue: 5, percent: 50, status: "active" }],
      "2026-10-27",
    );
    expect(result.goodDisciplinePct).toBe(50);
    expect(result.stopLossPct).toBe(50);
    expect(result.journalCompletionPct).toBe(100);
    expect(result.goalCompletionPct).toBe(50);
    expect(result.avgConfidence).toBe(4);
    expect(result.strategySetPct).toBe(50);
    expect(result.winRate).toBe(50);
  });
});

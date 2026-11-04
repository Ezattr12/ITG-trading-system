import { describe, expect, it } from "vitest";
import type { LevelName } from "@itg/calc";
import {
  ASSESSMENT_RULE_VERSION,
  defaultGateForBand,
  evaluateAssessment,
  parseAssessmentGate,
  type PreviousAssessment,
} from "./assessment";
import { DEFAULT_DIMENSION_WEIGHTS } from "./scoring";
import {
  DIMENSION_KEYS,
  DIMENSION_LABELS,
  type DimensionKey,
  type LevelRow,
  type LevelScoreResult,
} from "./types";

/**
 * Level assessment engine (Task 23). The contract under test:
 * the DISPLAYED band follows the score alone, but an
 * assessment additionally requires breadth (enough measured
 * dimensions), floors (no measured dimension below the band
 * floor) and sustained confirmation (a later qualifying
 * assessment after the confirmation period). Anything else
 * is a "hold" whose conditions name exactly what is unmet.
 */

function bandRow(
  name: LevelName,
  slug: string,
  min: number,
  max: number | null,
  scoring_config: Record<string, unknown> | null = null,
): LevelRow {
  return {
    id: `lvl-${slug}`,
    name,
    slug,
    min_score: min,
    max_score: max,
    scoring_config,
    description: null,
  };
}

const STRATEGY_OPERATOR = bandRow("Strategy Operator", "strategy-operator", 50, 59);
const MASTER = bandRow("ITG Master Trader", "itg-master-trader", 97, null);
const FOUNDATION = bandRow("Foundation", "foundation", 0, 19);

function scoreResult(
  values: Partial<Record<DimensionKey, number | null>>,
  score: number,
  levelName: LevelName,
): LevelScoreResult {
  return {
    score,
    levelName,
    dimensions: DIMENSION_KEYS.map((key) => ({
      key,
      label: DIMENSION_LABELS[key],
      value: values[key] ?? null,
      weight: 0,
    })),
    missingDimensions: DIMENSION_KEYS.filter((k) => (values[k] ?? null) === null),
  };
}

function evaluate(
  score: LevelScoreResult,
  band: LevelRow,
  previous: PreviousAssessment | null = null,
  now = new Date("2026-11-04T12:00:00Z"),
) {
  return evaluateAssessment({
    score,
    band,
    gates: parseAssessmentGate(band.scoring_config, band),
    weights: DEFAULT_DIMENSION_WEIGHTS,
    previous,
    now,
  });
}

/** Account A's real snapshot (Task 22 continuity fixture). */
const A_VALUES: Record<DimensionKey, number> = {
  discipline: 100,
  risk: 62.5,
  journal_consistency: 37.5,
  goal_completion: 16,
  psychology: 80,
  strategy_execution: 37.5,
  consistency: 50,
  performance: 87.5,
};

describe("defaultGateForBand — the seeded standard for all ten bands", () => {
  it("pins the full ladder of defaults", () => {
    expect(defaultGateForBand(0)).toEqual({ floor: null, minMeasured: 3, confirmAfterDays: 7 });
    expect(defaultGateForBand(20)).toEqual({ floor: null, minMeasured: 3, confirmAfterDays: 7 });
    expect(defaultGateForBand(40)).toEqual({ floor: 20, minMeasured: 4, confirmAfterDays: 7 });
    expect(defaultGateForBand(50)).toEqual({ floor: 20, minMeasured: 4, confirmAfterDays: 7 });
    expect(defaultGateForBand(60)).toEqual({ floor: 30, minMeasured: 5, confirmAfterDays: 7 });
    expect(defaultGateForBand(70)).toEqual({ floor: 30, minMeasured: 5, confirmAfterDays: 7 });
    expect(defaultGateForBand(80)).toEqual({ floor: 40, minMeasured: 6, confirmAfterDays: 28 });
    expect(defaultGateForBand(87)).toEqual({ floor: 50, minMeasured: 7, confirmAfterDays: 28 });
    expect(defaultGateForBand(93)).toEqual({ floor: 55, minMeasured: 8, confirmAfterDays: 28 });
    expect(defaultGateForBand(97)).toEqual({ floor: 60, minMeasured: 8, confirmAfterDays: 28 });
  });
});

describe("parseAssessmentGate", () => {
  it("returns the band defaults with no config", () => {
    expect(parseAssessmentGate(null, STRATEGY_OPERATOR)).toEqual({
      floor: 20,
      minMeasured: 4,
      confirmAfterDays: 7,
    });
  });

  it("applies a valid per-band override field by field", () => {
    const config = {
      assessment: {
        bands: {
          "strategy-operator": { floor: 25, min_measured: 6, confirm_after_days: 14 },
        },
      },
    };
    expect(parseAssessmentGate(config, STRATEGY_OPERATOR)).toEqual({
      floor: 25,
      minMeasured: 6,
      confirmAfterDays: 14,
    });
  });

  it("keeps the default for each invalid field (a typo never weakens a standard)", () => {
    const config = {
      assessment: {
        bands: {
          "strategy-operator": { floor: 150, min_measured: 9, confirm_after_days: 0 },
        },
      },
    };
    expect(parseAssessmentGate(config, STRATEGY_OPERATOR)).toEqual({
      floor: 20,
      minMeasured: 4,
      confirmAfterDays: 7,
    });
  });

  it("ignores entries for other bands and malformed shapes", () => {
    const config = { assessment: { bands: { foundation: { floor: 90 } } } };
    expect(parseAssessmentGate(config, STRATEGY_OPERATOR).floor).toBe(20);
    expect(parseAssessmentGate({ assessment: "nope" }, STRATEGY_OPERATOR).floor).toBe(20);
    expect(parseAssessmentGate([], STRATEGY_OPERATOR).floor).toBe(20);
  });

  it("an explicit null floor in config means no floor, by design", () => {
    const config = { assessment: { bands: { "strategy-operator": { floor: null } } } };
    expect(parseAssessmentGate(config, STRATEGY_OPERATOR).floor).toBeNull();
  });
});

describe("Account A fixture — score 59.2, Strategy Operator", () => {
  it("holds: goal completion 16 is below the band floor of 20, everything else met", () => {
    const result = evaluate(scoreResult(A_VALUES, 59.2, "Strategy Operator"), STRATEGY_OPERATOR);
    expect(result.verdict).toBe("hold");
    expect(result.standardMet).toBe(false);

    const breadth = result.conditions.find((c) => c.key === "breadth");
    expect(breadth?.passed).toBe(true);

    const failed = result.conditions.filter((c) => !c.passed);
    const floorFails = failed.filter((c) => c.key.startsWith("floor:"));
    expect(floorFails).toHaveLength(1);
    expect(floorFails[0].key).toBe("floor:goal_completion");
    expect(floorFails[0].detail).toContain("16");
    expect(floorFails[0].detail).toContain("20");

    const confirmation = result.conditions.find((c) => c.key === "confirmation");
    expect(confirmation?.passed).toBe(false);
    expect(confirmation?.detail).toContain("begins once");
  });

  it("with goals at 25 the standard is met, but a first assessment still holds for confirmation", () => {
    const values = { ...A_VALUES, goal_completion: 25 };
    const result = evaluate(scoreResult(values, 59.2, "Strategy Operator"), STRATEGY_OPERATOR);
    expect(result.standardMet).toBe(true);
    expect(result.verdict).toBe("hold");
    const confirmation = result.conditions.find((c) => c.key === "confirmation");
    expect(confirmation?.passed).toBe(false);
    expect(confirmation?.detail).toContain("First assessment meeting the standard");
    expect(confirmation?.detail).toContain("2026-11-11");
  });

  it("passes when a qualifying assessment from 8 days ago is confirmed by this one", () => {
    const values = { ...A_VALUES, goal_completion: 25 };
    const previous: PreviousAssessment = {
      verdict: "hold",
      levelSlug: "strategy-operator",
      standardMet: true,
      createdAt: "2026-10-27T12:00:00Z",
    };
    const result = evaluate(scoreResult(values, 59.2, "Strategy Operator"), STRATEGY_OPERATOR, previous);
    expect(result.verdict).toBe("pass");
    expect(result.conditions.every((c) => c.passed)).toBe(true);
  });

  it("still holds when the qualifying assessment is only 3 days old", () => {
    const values = { ...A_VALUES, goal_completion: 25 };
    const previous: PreviousAssessment = {
      verdict: "hold",
      levelSlug: "strategy-operator",
      standardMet: true,
      createdAt: "2026-11-01T12:00:00Z",
    };
    const result = evaluate(scoreResult(values, 59.2, "Strategy Operator"), STRATEGY_OPERATOR, previous);
    expect(result.verdict).toBe("hold");
    const confirmation = result.conditions.find((c) => c.key === "confirmation");
    expect(confirmation?.detail).toContain("2026-11-08");
  });

  it("a previous non-qualifying assessment resets the confirmation chain", () => {
    const values = { ...A_VALUES, goal_completion: 25 };
    const previous: PreviousAssessment = {
      verdict: "hold",
      levelSlug: "strategy-operator",
      standardMet: false,
      createdAt: "2026-09-01T12:00:00Z",
    };
    const result = evaluate(scoreResult(values, 59.2, "Strategy Operator"), STRATEGY_OPERATOR, previous);
    expect(result.verdict).toBe("hold");
    expect(
      result.conditions.find((c) => c.key === "confirmation")?.detail,
    ).toContain("First assessment meeting the standard");
  });

  it("a previous qualifying assessment for a DIFFERENT band does not confirm this one", () => {
    const values = { ...A_VALUES, goal_completion: 25 };
    const previous: PreviousAssessment = {
      verdict: "pass",
      levelSlug: "risk-manager",
      standardMet: true,
      createdAt: "2026-09-01T12:00:00Z",
    };
    const result = evaluate(scoreResult(values, 59.2, "Strategy Operator"), STRATEGY_OPERATOR, previous);
    expect(result.verdict).toBe("hold");
  });

  it("an existing pass at the same band stays passed while the standard is met", () => {
    const values = { ...A_VALUES, goal_completion: 25 };
    const previous: PreviousAssessment = {
      verdict: "pass",
      levelSlug: "strategy-operator",
      standardMet: true,
      createdAt: "2026-11-03T12:00:00Z",
    };
    const result = evaluate(scoreResult(values, 59.2, "Strategy Operator"), STRATEGY_OPERATOR, previous);
    expect(result.verdict).toBe("pass");
  });
});

describe("breadth gate — the single-dimension edge (Task 5 §2.5)", () => {
  it("a trader measured on one dimension at 100 displays the top band but cannot be assessed into it", () => {
    const score = scoreResult({ performance: 100 }, 100, "ITG Master Trader");
    const result = evaluate(score, MASTER);
    expect(result.verdict).toBe("hold");
    expect(result.standardMet).toBe(false);
    const breadth = result.conditions.find((c) => c.key === "breadth");
    expect(breadth?.passed).toBe(false);
    expect(breadth?.detail).toContain("Only 1 of 8");
    // The one measured dimension clears its floor — breadth, not
    // a floor, is what stops this assessment.
    const floor = result.conditions.find((c) => c.key === "floor:performance");
    expect(floor?.passed).toBe(true);
  });

  it("unmeasured dimensions produce no floor conditions — breadth governs them", () => {
    const score = scoreResult({ performance: 100 }, 100, "ITG Master Trader");
    const result = evaluate(score, MASTER);
    const floorConditions = result.conditions.filter((c) => c.key.startsWith("floor:"));
    expect(floorConditions).toHaveLength(1);
  });

  it("bands with no floor report a single passed floors condition", () => {
    const score = scoreResult(
      { discipline: 50, risk: 40, journal_consistency: 30 },
      12,
      "Foundation",
    );
    const result = evaluate(score, FOUNDATION);
    const floors = result.conditions.find((c) => c.key === "floors");
    expect(floors?.passed).toBe(true);
    expect(floors?.detail).toContain("No dimension floor applies");
    expect(result.standardMet).toBe(true);
  });
});

describe("state signature — material change only", () => {
  it("is stable when values drift but no outcome changes", () => {
    const drifted = { ...A_VALUES, risk: 70, discipline: 95 };
    const first = evaluate(scoreResult(A_VALUES, 59.2, "Strategy Operator"), STRATEGY_OPERATOR);
    const second = evaluate(scoreResult(drifted, 59.4, "Strategy Operator"), STRATEGY_OPERATOR);
    expect(second.signature).toBe(first.signature);
  });

  it("changes when an outcome flips (goals crosses the floor)", () => {
    const fixed = { ...A_VALUES, goal_completion: 25 };
    const first = evaluate(scoreResult(A_VALUES, 59.2, "Strategy Operator"), STRATEGY_OPERATOR);
    const second = evaluate(scoreResult(fixed, 59.2, "Strategy Operator"), STRATEGY_OPERATOR);
    expect(second.signature).not.toBe(first.signature);
  });

  it("carries the rule version", () => {
    const result = evaluate(scoreResult(A_VALUES, 59.2, "Strategy Operator"), STRATEGY_OPERATOR);
    expect(JSON.parse(result.signature).v).toBe(ASSESSMENT_RULE_VERSION);
  });
});

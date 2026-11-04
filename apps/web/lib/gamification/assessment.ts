import type { DimensionKey, LevelRow, LevelScoreResult } from "./types";
import { DIMENSION_KEYS, DIMENSION_LABELS } from "./types";

/**
 * Level assessment engine (Task 23) — the strict, durable
 * judgement built on top of Task 22's score bands.
 *
 * The DISPLAYED level follows the score alone: a weighted
 * scalar over the measured dimensions, renormalised when some
 * dimensions have no data. That scalar lets dimensions
 * compensate for each other, so the band a trader displays is
 * not, by itself, evidence they met a standard (Task 5 §2.4–
 * 2.5): a trader measurable on ONE dimension at 100 would
 * display the top band. An ASSESSMENT is the stricter
 * judgement, recorded append-only in `level_assessments`
 * (migration 0021) with everything needed to reproduce it:
 *
 * - BREADTH — at least `minMeasured` of the eight dimensions
 *   must actually be measured. An unmeasured dimension is
 *   never a failed floor; breadth is what governs it.
 * - FLOORS — every MEASURED dimension must reach the band's
 *   floor. No dimension may sit in the bottom range while the
 *   others carry the average.
 * - CONFIRMATION — meeting the standard once is a first
 *   crossing, not a sustained level. A band is assessed
 *   (verdict "pass") only when a LATER assessment, at least
 *   `confirmAfterDays` after a previous qualifying one for
 *   the same band, still meets the standard. The stored
 *   assessment history is the only duration evidence that
 *   exists, so duration is measured in assessments and days
 *   between them — never inferred from data that isn't there.
 *   7 days is one weekly cycle (the product's own rhythm:
 *   weekly reviews, weekly consistency); the prestige bands
 *   (score 80+) require 28 days, one monthly cycle.
 *
 * Anything else is verdict "hold", with the stored conditions
 * naming exactly which requirements are unmet and why.
 *
 * Gates live in the levels' canonical `scoring_config`
 * (the same global config the weights live in — read from
 * the first level row, stamped identically on every row by
 * migration 0021), under `assessment.bands[<slug>]`, and fall
 * back per-field to the band-derived defaults below when a
 * band has no valid entry. The defaults ARE the seeded
 * values; config overrides them, never the other way round.
 *
 * This module is pure: no IO, no clock of its own (`now` is
 * an input), so re-running an evaluation on the same snapshot
 * always reproduces the same verdict and signature.
 */

export const ASSESSMENT_RULE_VERSION = 1;

export type AssessmentVerdict = "pass" | "hold";

/** The gate standard one band is assessed against. */
export interface AssessmentGateConfig {
  /** Minimum value every measured dimension must reach.
   *  Null = no floor applies to this band. */
  floor: number | null;
  /** Minimum number of measured dimensions (breadth). */
  minMeasured: number;
  /** Days a qualifying standard must be sustained before a
   *  confirming assessment can pass the band. */
  confirmAfterDays: number;
}

/**
 * The default gates for a band, derived from its minimum
 * score. These are the values migration 0021 seeds into
 * `scoring_config`; they are derived from the band's position
 * so a band created later still has a defensible standard.
 *
 * Floors: none below Risk Manager (40) — the first two bands
 * are habit-forming titles and make no dimension claim, so a
 * floor there would only punish beginners for the dimensions
 * they have not built yet. From 40 up, the floor rises with
 * the ladder: no measured dimension in the bottom fifth at
 * mid-ladder, and the top bands demand every measured
 * dimension at 55–60.
 *
 * Breadth: at least 3 measured dimensions for any assessment
 * at all (a score can exist on 1), rising to all eight for
 * the two research/mastery titles, whose claim is the full
 * process.
 */
export function defaultGateForBand(minScore: number): AssessmentGateConfig {
  if (minScore >= 97) return { floor: 60, minMeasured: 8, confirmAfterDays: 28 };
  if (minScore >= 93) return { floor: 55, minMeasured: 8, confirmAfterDays: 28 };
  if (minScore >= 87) return { floor: 50, minMeasured: 7, confirmAfterDays: 28 };
  if (minScore >= 80) return { floor: 40, minMeasured: 6, confirmAfterDays: 28 };
  if (minScore >= 60) return { floor: 30, minMeasured: 5, confirmAfterDays: 7 };
  if (minScore >= 40) return { floor: 20, minMeasured: 4, confirmAfterDays: 7 };
  return { floor: null, minMeasured: 3, confirmAfterDays: 7 };
}

function isValidFloor(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100)
  );
}

function isValidMinMeasured(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= DIMENSION_KEYS.length
  );
}

function isValidConfirmDays(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 365
  );
}

/**
 * Parse the gate standard for one band out of the canonical
 * scoring_config. Mirrors `parseScoringConfig`'s philosophy:
 * each valid field overrides the band default, each missing
 * or invalid field keeps it, and a wholly malformed config
 * yields the defaults — a config typo can never silently
 * weaken (or invent) a standard.
 */
export function parseAssessmentGate(
  config: unknown,
  band: { slug: string; min_score: number },
): AssessmentGateConfig {
  const gates = defaultGateForBand(band.min_score);
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    return gates;
  }
  const assessment = (config as Record<string, unknown>).assessment;
  if (assessment === null || typeof assessment !== "object" || Array.isArray(assessment)) {
    return gates;
  }
  const bands = (assessment as Record<string, unknown>).bands;
  if (bands === null || typeof bands !== "object" || Array.isArray(bands)) {
    return gates;
  }
  const entry = (bands as Record<string, unknown>)[band.slug];
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    return gates;
  }
  const fields = entry as Record<string, unknown>;
  if ("floor" in fields && isValidFloor(fields.floor)) gates.floor = fields.floor;
  if ("min_measured" in fields && isValidMinMeasured(fields.min_measured)) {
    gates.minMeasured = fields.min_measured;
  }
  if ("confirm_after_days" in fields && isValidConfirmDays(fields.confirm_after_days)) {
    gates.confirmAfterDays = fields.confirm_after_days;
  }
  return gates;
}

/** One checked requirement of an assessment, with the reason. */
export interface AssessmentCondition {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
}

/** The projection of the latest stored assessment the engine
 *  needs to judge confirmation. */
export interface PreviousAssessment {
  verdict: AssessmentVerdict;
  levelSlug: string;
  /** Breadth + floors all passed at that assessment. */
  standardMet: boolean;
  createdAt: string;
}

export interface AssessmentEvaluation {
  verdict: AssessmentVerdict;
  /** Breadth + floors passed (confirmation aside). */
  standardMet: boolean;
  conditions: AssessmentCondition[];
  /**
   * Canonical signature of the evaluated STATE: band,
   * measured set, per-condition outcomes, gates, weights,
   * thresholds and rule version. Raw dimension values and
   * the score itself are deliberately NOT in the signature —
   * drift that changes no outcome is not a material change,
   * and the writer stores a new row only when the signature
   * changes (see assessment-service).
   */
  signature: string;
}

/** Display formatting for a dimension value: 16, 62.5 — never
 *  fake precision beyond the one decimal the score carries. */
function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Evaluate one snapshot against one band's standard. Pure
 * and deterministic: the same inputs always produce the same
 * verdict, conditions and signature.
 */
export function evaluateAssessment(input: {
  score: LevelScoreResult;
  band: LevelRow;
  gates: AssessmentGateConfig;
  weights: Record<DimensionKey, number>;
  previous: PreviousAssessment | null;
  now: Date;
}): AssessmentEvaluation {
  const { score, band, gates, previous, now } = input;
  const valueOf = (key: DimensionKey): number | null =>
    score.dimensions.find((d) => d.key === key)?.value ?? null;
  const measured = DIMENSION_KEYS.filter((k) => valueOf(k) !== null);

  const conditions: AssessmentCondition[] = [];

  /* ------------------------------------------------ breadth */
  const breadthPassed = measured.length >= gates.minMeasured;
  conditions.push({
    key: "breadth",
    label: "Measured breadth",
    passed: breadthPassed,
    detail: breadthPassed
      ? `${measured.length} of ${DIMENSION_KEYS.length} dimensions measured — at least ${gates.minMeasured} required for this band.`
      : `Only ${measured.length} of ${DIMENSION_KEYS.length} dimensions measured — at least ${gates.minMeasured} required for this band. Unmeasured dimensions are not scored as zero; they narrow what can be assessed.`,
  });

  /* ------------------------------------------------- floors */
  const floorOutcomes: Record<string, boolean> = {};
  if (gates.floor === null) {
    conditions.push({
      key: "floors",
      label: "Dimension floors",
      passed: true,
      detail: "No dimension floor applies to this band.",
    });
  } else {
    for (const key of measured) {
      const value = valueOf(key) as number;
      const passed = value >= gates.floor;
      floorOutcomes[key] = passed;
      conditions.push({
        key: `floor:${key}`,
        label: `${DIMENSION_LABELS[key]} floor`,
        passed,
        detail: passed
          ? `${DIMENSION_LABELS[key]} is ${fmt(value)} — at or above the floor of ${fmt(gates.floor)}.`
          : `${DIMENSION_LABELS[key]} is ${fmt(value)} — below the floor of ${fmt(gates.floor)} for this band.`,
      });
    }
  }

  const standardMet =
    breadthPassed && Object.values(floorOutcomes).every(Boolean);

  /* -------------------------------------------- confirmation */
  const prevQualifying =
    previous !== null &&
    previous.levelSlug === band.slug &&
    previous.standardMet;
  let confirmationPassed = false;
  let confirmationDetail: string;
  if (!standardMet) {
    confirmationDetail =
      "Confirmation begins once every standard above is met.";
  } else if (prevQualifying && previous.verdict === "pass") {
    confirmationPassed = true;
    confirmationDetail =
      "Already assessed at this band, and the standard is still met.";
  } else if (prevQualifying) {
    const elapsedMs = now.getTime() - new Date(previous.createdAt).getTime();
    if (elapsedMs >= gates.confirmAfterDays * DAY_MS) {
      confirmationPassed = true;
      confirmationDetail =
        "The standard was met at an earlier assessment and is still met after the confirmation period — this band is sustained.";
    } else {
      const eligible = new Date(
        new Date(previous.createdAt).getTime() + gates.confirmAfterDays * DAY_MS,
      );
      confirmationDetail = `The standard is met. It counts as sustained once it is still met on or after ${isoDate(eligible)}.`;
    }
  } else {
    const eligible = new Date(now.getTime() + gates.confirmAfterDays * DAY_MS);
    confirmationDetail = `First assessment meeting the standard for this band. It counts as sustained once it is still met on or after ${isoDate(eligible)}.`;
  }
  conditions.push({
    key: "confirmation",
    label: "Sustained confirmation",
    passed: confirmationPassed,
    detail: confirmationDetail,
  });

  const verdict: AssessmentVerdict =
    standardMet && confirmationPassed ? "pass" : "hold";

  /* ----------------------------------------------- signature */
  const weightsSignature = Object.fromEntries(
    DIMENSION_KEYS.map((k) => [k, Math.round(input.weights[k] * 1e6) / 1e6]),
  );
  const signature = JSON.stringify({
    v: ASSESSMENT_RULE_VERSION,
    band: band.slug,
    bandMin: band.min_score,
    bandMax: band.max_score,
    measured,
    breadth: breadthPassed,
    floors: floorOutcomes,
    standardMet,
    confirmation: confirmationPassed,
    verdict,
    gates: {
      floor: gates.floor,
      minMeasured: gates.minMeasured,
      confirmAfterDays: gates.confirmAfterDays,
    },
    weights: weightsSignature,
  });

  return { verdict, standardMet, conditions, signature };
}

/** A stored assessment row (migration 0021), as read back. */
export interface LevelAssessmentRow {
  id: string;
  user_id: string;
  level_id: string | null;
  level_slug: string;
  level_name: string;
  score: number;
  band_min_score: number;
  band_max_score: number | null;
  dimension_values: Record<string, number | null>;
  measured_dimensions: string[];
  missing_dimensions: string[];
  weights: Record<string, number>;
  gates: { floor: number | null; min_measured: number; confirm_after_days: number };
  conditions: AssessmentCondition[];
  evidence: Record<string, unknown>;
  standard_met: boolean;
  verdict: AssessmentVerdict;
  rule_version: number;
  state_signature: string;
  created_at: string;
}

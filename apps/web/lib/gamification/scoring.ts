import {
  calcLevelForScore,
  DEFAULT_LEVELS,
  type LevelName,
  type LevelThreshold,
} from "@itg/calc";
import type { AnalyticTrade, GoalProgressView } from "../analytics/types";
import {
  mondayOf,
  psychologySummary,
  summarizeTrades,
} from "../analytics/analytics";
import type {
  DimensionInputs,
  DimensionKey,
  DimensionScore,
  LevelRow,
  LevelScoreResult,
} from "./types";
import { DIMENSION_KEYS, DIMENSION_LABELS } from "./types";

/**
 * Multi-dimensional level scoring (Phase 7, spec §8).
 *
 * Levels are NOT profit-only. Eight dimensions are scored 0–100
 * from the trader's real stored data and combined with weights
 * from the `levels` table's `scoring_config` (admin-configurable;
 * the seed's defaults are below). Performance is only 5% of the
 * score: a trader who wins every trade but journals nothing and
 * follows no risk plan stays Bronze.
 *
 * A dimension with no data is NOT scored as 0 — it is excluded
 * and the remaining weights are renormalised, so a new trader is
 * scored only on what they have actually done. A trader with no
 * measurable dimension has no score at all (null), never a fake 0.
 */

export const DEFAULT_DIMENSION_WEIGHTS: Record<DimensionKey, number> = {
  discipline: 0.2,
  risk: 0.2,
  journal_consistency: 0.15,
  goal_completion: 0.15,
  psychology: 0.1,
  strategy_execution: 0.1,
  consistency: 0.05,
  performance: 0.05,
};

/**
 * Parse a level's `scoring_config` (jsonb) into weights. Valid
 * entries override the defaults; missing or invalid entries keep
 * their default; a wholly invalid config returns the defaults.
 * Weights are normalised to sum to 1.
 */
export function parseScoringConfig(
  config: unknown,
): Record<DimensionKey, number> {
  const weights: Record<DimensionKey, number> = {
    ...DEFAULT_DIMENSION_WEIGHTS,
  };
  if (config !== null && typeof config === "object" && !Array.isArray(config)) {
    for (const key of DIMENSION_KEYS) {
      const value = (config as Record<string, unknown>)[key];
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        weights[key] = value;
      }
    }
  }
  const total = DIMENSION_KEYS.reduce((sum, k) => sum + weights[k], 0);
  const normalised = {} as Record<DimensionKey, number>;
  for (const key of DIMENSION_KEYS) normalised[key] = weights[key] / total;
  return normalised;
}

/** Clamp a 0–100 measurement; null stays null. */
function clampPct(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
}

/**
 * Score each dimension 0–100 from the raw inputs. Psychology is
 * average confidence (1–5) scaled to 0–100; the rest are already
 * percentages.
 */
export function calcDimensionScores(
  input: DimensionInputs,
): Record<DimensionKey, number | null> {
  return {
    discipline: clampPct(input.goodDisciplinePct),
    risk: clampPct(input.stopLossPct),
    journal_consistency: clampPct(input.journalCompletionPct),
    goal_completion: clampPct(input.goalCompletionPct),
    psychology:
      input.avgConfidence === null || !Number.isFinite(input.avgConfidence)
        ? null
        : clampPct((input.avgConfidence / 5) * 100),
    strategy_execution: clampPct(input.strategySetPct),
    consistency: clampPct(input.weeklyConsistencyPct),
    performance: clampPct(input.winRate),
  };
}

/**
 * Combine dimension scores into one 0–100 score, weighting only
 * the dimensions that could be measured (weights renormalised).
 * Returns null when nothing could be measured.
 */
export function calcLevelScore(
  input: DimensionInputs,
  weights: Record<DimensionKey, number> = DEFAULT_DIMENSION_WEIGHTS,
): LevelScoreResult {
  const scores = calcDimensionScores(input);
  const measured = DIMENSION_KEYS.filter((k) => scores[k] !== null);
  if (measured.length === 0) {
    return {
      score: null,
      levelName: null,
      dimensions: DIMENSION_KEYS.map((key) => ({
        key,
        label: DIMENSION_LABELS[key],
        value: null,
        weight: weights[key],
      })),
      missingDimensions: [...DIMENSION_KEYS],
    };
  }
  const totalWeight = measured.reduce((sum, k) => sum + weights[k], 0);
  const score =
    measured.reduce((sum, k) => sum + (scores[k] as number) * weights[k], 0) /
    totalWeight;
  const rounded = Math.round(score * 10) / 10;
  return {
    score: rounded,
    levelName: null, // set by levelForScore once thresholds are known
    dimensions: DIMENSION_KEYS.map((key) => ({
      key,
      label: DIMENSION_LABELS[key],
      value: scores[key],
      weight: weights[key] / totalWeight,
    })),
    missingDimensions: DIMENSION_KEYS.filter((k) => scores[k] === null),
  };
}

function thresholdsFromLevels(levels: readonly LevelRow[]): LevelThreshold[] {
  if (levels.length === 0) return DEFAULT_LEVELS;
  return levels.map((l) => ({
    name: l.name,
    minScore: l.min_score,
    maxScore: l.max_score,
  }));
}

/** Level name for a score, using the given level rows (or the defaults). */
export function levelForScore(
  score: number | null,
  levels: readonly LevelRow[],
): LevelName | null {
  if (score === null) return null;
  return calcLevelForScore(score, thresholdsFromLevels(levels));
}

/** Score the trader and resolve the level in one step. */
export function scoreTrader(
  input: DimensionInputs,
  levels: readonly LevelRow[],
): LevelScoreResult {
  const weights =
    levels.length > 0
      ? parseScoringConfig(levels[0].scoring_config)
      : DEFAULT_DIMENSION_WEIGHTS;
  const result = calcLevelScore(input, weights);
  return { ...result, levelName: levelForScore(result.score, levels) };
}

export interface NextLevelProgress {
  currentLevel: LevelName;
  nextLevel: LevelName | null;
  /** Points of score needed to reach the next level. Null at the top level. */
  pointsToNext: number | null;
  /** 0–100 progress through the current level's band. */
  progressPct: number;
}

/**
 * Progress towards the next level. Null when there is no score
 * yet. At the top level (Platinum) the next level is null and
 * progress is 100.
 */
export function progressToNextLevel(
  score: number | null,
  levels: readonly LevelRow[],
): NextLevelProgress | null {
  if (score === null) return null;
  const thresholds = thresholdsFromLevels(levels);
  const current = calcLevelForScore(score, thresholds);
  const currentRow = thresholds.find((t) => t.name === current);
  const next = thresholds.find(
    (t) => currentRow !== undefined && t.minScore > currentRow.minScore,
  );
  if (!currentRow || !next) {
    return { currentLevel: current, nextLevel: null, pointsToNext: null, progressPct: 100 };
  }
  const bandTop = next.minScore;
  const bandBottom = currentRow.minScore;
  const progressPct =
    bandTop === bandBottom
      ? 100
      : Math.max(0, Math.min(100, ((score - bandBottom) / (bandTop - bandBottom)) * 100));
  return {
    currentLevel: current,
    nextLevel: next.name,
    pointsToNext: Math.round((next.minScore - score) * 10) / 10,
    progressPct: Math.round(progressPct * 10) / 10,
  };
}

/* ------------------------------------------------- inputs from real data */

/**
 * Share of weeks with at least one journaled closed trade, over
 * the last 12 weeks back from `today` — but only weeks on or
 * after the week of the trader's first closed trade. A trader
 * who started last week is not scored against 11 weeks before
 * they existed. Null with no closed trades.
 */
export function weeklyConsistencyPct(
  trades: readonly AnalyticTrade[],
  today: string,
): number | null {
  if (trades.length === 0) return null;
  const journaledDates = trades
    .filter((t) => t.journaled)
    .map((t) => t.closedAt.slice(0, 10));
  if (journaledDates.length === 0) return 0;
  // Anchor on the first closed trade of any kind: a trader who
  // traded three weeks ago but only journaled this week scores
  // 1/3, not 1/1.
  const firstClosed = trades.map((t) => t.closedAt.slice(0, 10)).sort()[0];
  const firstWeek = mondayOf(new Date(firstClosed));
  const thisWeek = mondayOf(new Date(`${today}T00:00:00.000Z`));
  const allWeeks: string[] = [];
  const cursor = new Date(`${firstWeek}T00:00:00.000Z`);
  const end = new Date(`${thisWeek}T00:00:00.000Z`);
  while (cursor.getTime() <= end.getTime()) {
    allWeeks.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  // The most recent 12 weeks (a trader with a year of history is
  // scored on the recent run, not on their first 12 weeks).
  const weeks = allWeeks.slice(-12);
  const journaledWeeks = new Set(journaledDates.map((d) => mondayOf(new Date(d))));
  const hit = weeks.filter((w) => journaledWeeks.has(w)).length;
  return (hit / weeks.length) * 100;
}

/**
 * Build the dimension inputs from the trader's real trades and
 * goals (the same `AnalyticsBundle` shapes the dashboard uses).
 * Every input is null when its source data does not exist yet.
 */
export function dimensionInputsFromBundle(
  trades: readonly AnalyticTrade[],
  goals: readonly GoalProgressView[],
  today: string,
): DimensionInputs {
  const summary = summarizeTrades(trades);
  const psych = psychologySummary(trades);
  return {
    goodDisciplinePct: psych.goodDisciplinePct,
    stopLossPct: trades.length === 0 ? null : psych.stopLossPct,
    journalCompletionPct:
      trades.length === 0 ? null : psych.journalCompletionPct,
    goalCompletionPct:
      goals.length === 0
        ? null
        : goals.reduce((sum, g) => sum + Math.min(100, g.percent), 0) / goals.length,
    avgConfidence: psych.avgConfidence,
    strategySetPct:
      trades.length === 0
        ? null
        : (trades.filter((t) => t.strategyName !== null).length / trades.length) * 100,
    weeklyConsistencyPct: weeklyConsistencyPct(trades, today),
    winRate: summary.winRate,
  };
}

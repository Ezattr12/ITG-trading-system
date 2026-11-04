import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type Row } from "@/lib/test-helpers/fake-supabase";

/**
 * Level assessment service (Task 23). The contract under
 * test: a refresh stores an assessment ONLY when the
 * evaluated state materially changes (the engine signature);
 * the stored row is a complete reproducibility snapshot; the
 * confirmation chain turns a sustained standard into a pass;
 * and a null score stores nothing. The bundle is injected
 * (the ensureLevelStored pattern) and the writer's
 * service-role client is pointed at the same recording fake.
 */

const harness = vi.hoisted(() => ({ adminClient: null as unknown }));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => {
    throw new Error("the assessment service receives its read client explicitly");
  },
  createServiceRoleSupabaseClient: () => harness.adminClient,
}));
vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: () => true,
  supabaseNotConnectedMessage: () => "not configured",
}));

import { runLevelAssessment } from "./assessment-service";
import type { GamificationBundle } from "./queries";
import {
  DIMENSION_KEYS,
  DIMENSION_LABELS,
  type DimensionKey,
  type LevelRow,
  type LevelScoreResult,
} from "./types";
import type { LevelName } from "@itg/calc";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const WEIGHTS_CONFIG = {
  discipline: 0.2,
  risk: 0.2,
  journal_consistency: 0.15,
  goal_completion: 0.15,
  psychology: 0.1,
  strategy_execution: 0.1,
  consistency: 0.05,
  performance: 0.05,
};

const TEN_LEVELS: LevelRow[] = (
  [
    ["Foundation", "foundation", 0, 19],
    ["Technical Trader", "technical-trader", 20, 39],
    ["Risk Manager", "risk-manager", 40, 49],
    ["Strategy Operator", "strategy-operator", 50, 59],
    ["Psychological Discipline", "psychological-discipline", 60, 69],
    ["Consistency", "consistency", 70, 79],
    ["Professional Trader", "professional-trader", 80, 86],
    ["Institutional Trader", "institutional-trader", 87, 92],
    ["Trading Researcher", "trading-researcher", 93, 96],
    ["ITG Master Trader", "itg-master-trader", 97, null],
  ] as [LevelName, string, number, number | null][]
).map(([name, slug, min, max]) => ({
  id: `lvl-${slug}`,
  name,
  slug,
  min_score: min,
  max_score: max,
  scoring_config: WEIGHTS_CONFIG,
  description: null,
}));

function scoreResult(
  values: Partial<Record<DimensionKey, number | null>>,
  score: number | null,
  levelName: LevelName | null,
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

function bundleFor(
  values: Partial<Record<DimensionKey, number | null>>,
  score: number | null,
  levelName: LevelName | null,
  levels: LevelRow[] = TEN_LEVELS,
): GamificationBundle {
  return {
    score: scoreResult(values, score, levelName),
    levels,
    trades: [
      { closedAt: "2026-10-28T10:00:00Z" },
      { closedAt: "2026-10-30T10:00:00Z" },
    ],
    goals: [{ status: "completed" }, { status: "active" }],
  } as unknown as GamificationBundle;
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

function setup() {
  const tables: Record<string, Row[]> = { level_assessments: [] };
  const { client, fake } = fakeSupabase(tables);
  harness.adminClient = fake;
  return { client, fake, tables };
}

/** Simulate the database `now()` default the fake lacks. */
function stampLatest(tables: Record<string, Row[]>, iso: string) {
  const rows = tables.level_assessments;
  rows[rows.length - 1].created_at = iso;
}

beforeEach(() => {
  harness.adminClient = null;
});

describe("runLevelAssessment", () => {
  it("stores a complete snapshot for Account A's fixture — a hold on the goals floor", async () => {
    const { client, fake } = setup();
    const outcome = await runLevelAssessment(
      client,
      USER,
      () => Promise.resolve(bundleFor(A_VALUES, 59.2, "Strategy Operator")),
      new Date("2026-11-04T12:00:00Z"),
    );
    expect(outcome).toEqual({ written: true, verdict: "hold" });

    const rows = fake.insertsFor("level_assessments");
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.level_slug).toBe("strategy-operator");
    expect(row.level_name).toBe("Strategy Operator");
    expect(row.score).toBe(59.2);
    expect(row.band_min_score).toBe(50);
    expect(row.band_max_score).toBe(59);
    expect(row.dimension_values).toEqual(A_VALUES);
    expect(row.measured_dimensions).toHaveLength(8);
    expect(row.missing_dimensions).toEqual([]);
    expect(row.standard_met).toBe(false);
    expect(row.verdict).toBe("hold");
    expect(row.rule_version).toBe(1);
    expect(row.gates).toEqual({ floor: 20, min_measured: 4, confirm_after_days: 7 });
    expect(row.evidence).toEqual({
      closed_trades: 2,
      latest_closed_at: "2026-10-30T10:00:00Z",
      goals: 2,
      goals_completed: 1,
    });
    const failed = (row.conditions as { key: string; passed: boolean }[]).filter(
      (c) => !c.passed,
    );
    expect(failed.map((c) => c.key)).toEqual(["floor:goal_completion", "confirmation"]);
  });

  it("writes nothing when the evaluated state has not materially changed", async () => {
    const { client, fake } = setup();
    const bundle = () => Promise.resolve(bundleFor(A_VALUES, 59.2, "Strategy Operator"));
    await runLevelAssessment(client, USER, bundle, new Date("2026-11-04T12:00:00Z"));
    const again = await runLevelAssessment(client, USER, bundle, new Date("2026-11-04T13:00:00Z"));
    expect(again).toEqual({ written: false, verdict: "hold" });
    expect(fake.insertsFor("level_assessments")).toHaveLength(1);
  });

  it("writes nothing when dimension values drift but no outcome changes", async () => {
    const { client, fake } = setup();
    await runLevelAssessment(
      client,
      USER,
      () => Promise.resolve(bundleFor(A_VALUES, 59.2, "Strategy Operator")),
      new Date("2026-11-04T12:00:00Z"),
    );
    const drifted = { ...A_VALUES, risk: 71, discipline: 92 };
    const outcome = await runLevelAssessment(
      client,
      USER,
      () => Promise.resolve(bundleFor(drifted, 59.4, "Strategy Operator")),
      new Date("2026-11-05T12:00:00Z"),
    );
    expect(outcome.written).toBe(false);
    expect(fake.insertsFor("level_assessments")).toHaveLength(1);
  });

  it("confirmation chain: qualifying hold, then a pass once the period elapses", async () => {
    const { client, fake, tables } = setup();
    const t0 = new Date("2026-11-04T12:00:00Z");

    // 1. A's real state: hold on the goals floor.
    await runLevelAssessment(
      client,
      USER,
      () => Promise.resolve(bundleFor(A_VALUES, 59.2, "Strategy Operator")),
      t0,
    );
    stampLatest(tables, "2026-11-04T12:00:00Z");

    // 2. Goals cross the floor a day later: standard met, but
    //    the earlier row was not qualifying, so the chain
    //    starts now — a new row (outcome changed).
    const fixed = { ...A_VALUES, goal_completion: 25 };
    const second = await runLevelAssessment(
      client,
      USER,
      () => Promise.resolve(bundleFor(fixed, 59.2, "Strategy Operator")),
      new Date("2026-11-05T12:00:00Z"),
    );
    expect(second).toEqual({ written: true, verdict: "hold" });
    stampLatest(tables, "2026-11-05T12:00:00Z");

    // 3. Eight days on, unchanged state: the confirmation
    //    outcome flips purely by time, and that IS a material
    //    change — the pass is recorded.
    const third = await runLevelAssessment(
      client,
      USER,
      () => Promise.resolve(bundleFor(fixed, 59.2, "Strategy Operator")),
      new Date("2026-11-13T12:00:00Z"),
    );
    expect(third).toEqual({ written: true, verdict: "pass" });
    const rows = fake.insertsFor("level_assessments");
    expect(rows).toHaveLength(3);
    expect(rows[2].verdict).toBe("pass");
    expect(rows[2].standard_met).toBe(true);
  });

  it("stores nothing when there is no score yet", async () => {
    const { client, fake } = setup();
    const outcome = await runLevelAssessment(
      client,
      USER,
      () => Promise.resolve(bundleFor({}, null, null)),
      new Date("2026-11-04T12:00:00Z"),
    );
    expect(outcome).toEqual({ written: false, verdict: null });
    expect(fake.insertsFor("level_assessments")).toHaveLength(0);
  });

  it("stores nothing when the configured levels table has no row for the band", async () => {
    const { client, fake } = setup();
    const outcome = await runLevelAssessment(
      client,
      USER,
      () => Promise.resolve(bundleFor(A_VALUES, 59.2, "Strategy Operator", [])),
      new Date("2026-11-04T12:00:00Z"),
    );
    expect(outcome).toEqual({ written: false, verdict: null });
    expect(fake.insertsFor("level_assessments")).toHaveLength(0);
  });
});

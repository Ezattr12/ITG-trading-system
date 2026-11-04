import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleSupabaseClient } from "../supabase/server";
import { isSupabaseConfigured } from "../supabase/config";
import { getGamificationBundle, type GamificationBundle } from "./queries";
import { parseScoringConfig } from "./scoring";
import {
  ASSESSMENT_RULE_VERSION,
  evaluateAssessment,
  parseAssessmentGate,
  type AssessmentVerdict,
  type LevelAssessmentRow,
  type PreviousAssessment,
} from "./assessment";

/**
 * Level assessment service (Task 23) — the write side of the
 * pure engine in `./assessment.ts`.
 *
 * Mirrors the writers it sits beside: `ensureLevelStored`
 * (same bundle-injection shape, same best-effort contract)
 * and `logPlanEvent` (service-role insert into an append-only
 * table with no client INSERT policy — migration 0021 gives
 * `level_assessments` a SELECT-own policy only). A failure
 * here never blocks, fails or changes the refresh that
 * triggered it, and never throws.
 *
 * DEDUPE: an assessment is a state record, not an event log.
 * A new row is written ONLY when the evaluated state
 * materially changes — the engine's signature covers the
 * band, the measured-dimension set, every condition outcome
 * (breadth, per-dimension floors, confirmation), the gates,
 * the weights, the band thresholds and the rule version. Raw
 * value drift that flips no outcome writes nothing. The one
 * time-driven transition — a qualifying hold becoming a pass
 * when the confirmation period elapses — flips the
 * confirmation outcome, so it is captured by the same rule.
 *
 * Callers: `refreshGamification` (every level refresh path)
 * and the Task 17 background pass (the confirmation cadence
 * for traders who do nothing else that week). Both share this
 * one entry point, so the dedupe rule cannot diverge.
 */

export interface AssessmentOutcome {
  /** True only when a new assessment row was stored. */
  written: boolean;
  /** The current verdict after this call (the stored latest
   *  when nothing was written), or null when there was
   *  nothing to assess. */
  verdict: AssessmentVerdict | null;
}

const NONE: AssessmentOutcome = { written: false, verdict: null };

export async function runLevelAssessment(
  supabase: SupabaseClient,
  userId: string,
  getBundle: () => Promise<GamificationBundle> = () =>
    getGamificationBundle(supabase, userId),
  now: Date = new Date(),
): Promise<AssessmentOutcome> {
  if (!isSupabaseConfigured()) return NONE;
  const admin = createServiceRoleSupabaseClient();
  if (!admin) return NONE;
  try {
    const bundle = await getBundle();
    const { score, levels } = bundle;
    if (score.score === null || score.levelName === null) return NONE;
    // The assessment snapshots the configured band row (id,
    // slug, thresholds). With no configured levels the score
    // falls back to DEFAULT_LEVELS for display, but there is
    // no durable band to assess against — nothing is stored.
    const band = levels.find((l) => l.name === score.levelName);
    if (!band) return NONE;

    // The canonical config is the first (lowest) level row's,
    // exactly as scoreTrader reads the weights.
    const canonicalConfig = levels[0]?.scoring_config ?? null;
    const weights = parseScoringConfig(canonicalConfig);
    const gates = parseAssessmentGate(canonicalConfig, band);

    const { data: latestData } = await admin
      .from("level_assessments")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const latest = (latestData ?? null) as LevelAssessmentRow | null;
    const previous: PreviousAssessment | null = latest
      ? {
          verdict: latest.verdict,
          levelSlug: latest.level_slug,
          standardMet: latest.standard_met,
          createdAt: latest.created_at,
        }
      : null;

    const evaluation = evaluateAssessment({
      score,
      band,
      gates,
      weights,
      previous,
      now,
    });

    // No material change — the stored latest row already
    // records this exact state.
    if (latest && latest.state_signature === evaluation.signature) {
      return { written: false, verdict: evaluation.verdict };
    }

    const closedAt = bundle.trades.map((t) => t.closedAt).sort();
    const { error } = await admin.from("level_assessments").insert({
      user_id: userId,
      level_id: band.id,
      level_slug: band.slug,
      level_name: band.name,
      score: score.score,
      band_min_score: band.min_score,
      band_max_score: band.max_score,
      dimension_values: Object.fromEntries(
        score.dimensions.map((d) => [d.key, d.value]),
      ),
      measured_dimensions: score.dimensions
        .filter((d) => d.value !== null)
        .map((d) => d.key),
      missing_dimensions: score.missingDimensions,
      weights,
      gates: {
        floor: gates.floor,
        min_measured: gates.minMeasured,
        confirm_after_days: gates.confirmAfterDays,
      },
      conditions: evaluation.conditions,
      evidence: {
        closed_trades: bundle.trades.length,
        latest_closed_at: closedAt[closedAt.length - 1] ?? null,
        goals: bundle.goals.length,
        goals_completed: bundle.goals.filter((g) => g.status === "completed")
          .length,
      },
      standard_met: evaluation.standardMet,
      verdict: evaluation.verdict,
      rule_version: ASSESSMENT_RULE_VERSION,
      state_signature: evaluation.signature,
    });
    if (error) return NONE;
    return { written: true, verdict: evaluation.verdict };
  } catch {
    return NONE;
  }
}

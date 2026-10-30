import type { SupabaseClient } from "@supabase/supabase-js";
import { mondayOfWeek } from "@/lib/reviews/reviews";
import { generateCoachInsights } from "./insights";
import { getAiInsightsForWeek, getCoachWeekData } from "./queries";
import type { CoachAnalysis } from "./types";

/**
 * Coach service (Phase 20) — the single callable home of the
 * deterministic Coach Engine.
 *
 * The engine itself has not moved and has not changed:
 * `generateCoachInsights(evidence)` (lib/coach/insights.ts) is
 * still the only place coach insights are computed, and
 * `getCoachWeekData` (lib/coach/queries.ts) is still the only
 * evidence assembly. This module only standardises HOW callers
 * reach them:
 *
 * - `computeCoachInsights` — read-only compute. Used by the
 *   internal endpoint (and therefore, through it, by the MCP
 *   `compute_coach_insights` tool). Writes nothing, ever.
 * - `refreshCoachInsights` — compute + the idempotent persist
 *   that used to live inline in `refreshCoachAnalysisAction`.
 *   Used by that action (unchanged behaviour/messages) and by
 *   the automatic trade-close trigger.
 * - `refreshCoachInsightsSafely` — a never-throwing wrapper
 *   for fire-and-forget callers (the trade-close trigger): a
 *   coach failure must never break a trade save.
 *
 * Idempotency (unchanged from Phase 9): an insight is stored
 * only when no stored row for the same week, type and exact
 * metrics snapshot exists — checked here and enforced by the
 * unique index in migration 0013. Refreshing never awards XP
 * and never creates notifications.
 */

/** Stable JSON stringify (sorted keys) for snapshot comparison. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/** Thrown when a refresh has insights to store but no service-role client. */
export class CoachStoreUnavailableError extends Error {
  constructor() {
    super("Coach insight store unavailable: no service-role client.");
    this.name = "CoachStoreUnavailableError";
  }
}

export type ComputeCoachInsightsResult =
  | { status: "ok"; analysis: CoachAnalysis }
  | { status: "insufficient_data"; analysis: CoachAnalysis }
  | { status: "invalid_week" }
  | { status: "no_data" };

/**
 * Compute one week's coach analysis for one trader. Pure read:
 * runs the evidence assembly and the engine, writes nothing.
 * `weekStartDate` may be any date in the week — it is
 * normalised to the week's Monday, exactly as the app does.
 */
export async function computeCoachInsights(
  supabase: SupabaseClient,
  userId: string,
  weekStartDate: string,
): Promise<ComputeCoachInsightsResult> {
  const monday = mondayOfWeek(weekStartDate);
  if (!monday) return { status: "invalid_week" };
  const evidence = await getCoachWeekData(supabase, userId, monday);
  if (!evidence) return { status: "no_data" };
  const analysis = generateCoachInsights(evidence);
  return analysis.insufficientData
    ? { status: "insufficient_data", analysis }
    : { status: "ok", analysis };
}

export interface RefreshCoachInsightsArgs {
  supabase: SupabaseClient;
  /** Service-role client used for the ai_insights inserts; null = cannot store. */
  admin: SupabaseClient | null;
  userId: string;
  weekStartDate: string;
}

export interface RefreshCoachInsightsResult {
  inserted: number;
  skipped: number;
  /** Null only when the week's evidence could not be loaded at all. */
  analysis: CoachAnalysis | null;
  insufficientData: boolean;
}

/**
 * Compute + idempotently persist one week's insights (the
 * exact logic that powered the manual refresh action since
 * Phase 9). Insufficient data inserts nothing. A unique-index
 * race (a parallel refresh stored the same insight first)
 * counts as skipped, not as a failure.
 */
export async function refreshCoachInsights(
  args: RefreshCoachInsightsArgs,
): Promise<RefreshCoachInsightsResult> {
  const computed = await computeCoachInsights(args.supabase, args.userId, args.weekStartDate);
  if (computed.status === "invalid_week") {
    throw new Error(`Invalid week start date: ${args.weekStartDate}`);
  }
  if (computed.status === "no_data") {
    return { inserted: 0, skipped: 0, analysis: null, insufficientData: false };
  }
  const { analysis } = computed;
  if (analysis.insufficientData) {
    return { inserted: 0, skipped: 0, analysis, insufficientData: true };
  }
  if (!args.admin) throw new CoachStoreUnavailableError();
  const admin = args.admin;

  const existing = await getAiInsightsForWeek(
    args.supabase,
    args.userId,
    analysis.periodStart,
    analysis.periodEnd,
  );
  const existingKeys = new Set(
    existing.map((r) => `${r.insight_type}:${stableStringify(r.metrics_snapshot)}`),
  );

  let inserted = 0;
  let skipped = 0;
  for (const insight of analysis.insights) {
    const key = `${insight.type}:${stableStringify(insight.metricsSnapshot)}`;
    if (existingKeys.has(key)) {
      skipped += 1;
      continue;
    }
    const { error } = await admin.from("ai_insights").insert({
      user_id: args.userId,
      insight_type: insight.type,
      period_start: analysis.periodStart,
      period_end: analysis.periodEnd,
      summary: insight.title,
      metrics_snapshot: insight.metricsSnapshot,
    });
    if (error) {
      // Unique-index race (a parallel refresh stored the same
      // insight first) — count as skipped, not as a failure.
      skipped += 1;
    } else {
      inserted += 1;
      existingKeys.add(key);
    }
  }
  return { inserted, skipped, analysis, insufficientData: false };
}

/**
 * Never-throwing refresh for the trade-close trigger: any
 * failure (DB hiccup, store unavailable, bad date) is
 * swallowed and reported as null, so a coach problem can
 * never break or delay the trade save that triggered it.
 * The manual refresh action remains the visible retry path.
 */
export async function refreshCoachInsightsSafely(
  args: RefreshCoachInsightsArgs,
): Promise<RefreshCoachInsightsResult | null> {
  try {
    return await refreshCoachInsights(args);
  } catch {
    return null;
  }
}

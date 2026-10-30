import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAuditLog } from "@/lib/auth/audit";
import { mondayOfWeek } from "@/lib/reviews/reviews";
import { awardXp, refreshGamification } from "@/lib/gamification/actions";
import { deterministicUuid, XP_TABLE } from "@/lib/gamification/xp";
import type { CoreFailure } from "@/lib/trades/service";
import { generateCoachInsights } from "./insights";
import { getAiInsightsForWeek, getCoachWeekData } from "./queries";
import { backtestingSchema, firstZodError } from "./validation";
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

/* ------------------------------------------------------- backtesting log */

function fail(code: CoreFailure["code"], error: string): CoreFailure {
  return { ok: false, code, error };
}

export type LogBacktestingCoreResult =
  | {
      ok: true;
      activityDate: string;
      /** Total sessions recorded for the day (the caller's value). */
      sessions: number;
      /** Sessions newly awarded XP by this call (0 on a repeat). */
      sessionsAwarded: number;
      xpAwarded: number;
    }
  | CoreFailure;

/**
 * Backtesting session log (Phase 21, M2 extraction of
 * logBacktestingSessionAction, spec §24). The caller
 * records the TOTAL sessions for a day; XP (+15 per
 * session) is awarded once per session index through the
 * existing `awardXp` path with the existing deterministic
 * UUID mapping (`backtest:<date>:<n>`) — reused, never
 * reimplemented — so re-submitting the same total awards
 * nothing new and raising the total awards only the new
 * sessions. A failed XP insert never loses the logged day.
 */
export async function logBacktestingCore(
  supabase: SupabaseClient,
  userId: string,
  rawInput: unknown,
): Promise<LogBacktestingCoreResult> {
  const parsed = backtestingSchema.safeParse(rawInput);
  if (!parsed.success) return fail("invalid_input", firstZodError(parsed.error));
  const { activityDate, sessions } = parsed.data;

  const { error } = await supabase.from("daily_activity").upsert(
    {
      user_id: userId,
      activity_date: activityDate,
      backtesting_sessions: sessions,
    },
    { onConflict: "user_id,activity_date" },
  );
  if (error) {
    return fail("save_failed", "Could not log the backtesting session. Please try again.");
  }

  let awarded = 0;
  for (let i = 1; i <= sessions; i += 1) {
    const ok = await awardXp({
      userId,
      reason: "backtest_session",
      // source_ref_id is a uuid column: the per-session key
      // must be mapped into a stable UUID, or the insert is
      // rejected and the XP silently never lands (Stage 2
      // audit bug, 2026-10-29 — see deterministicUuid).
      sourceRefId: deterministicUuid(`backtest:${activityDate}:${i}`),
      note: `Backtesting session ${i} of ${sessions} on ${activityDate}`,
    });
    if (ok) awarded += 1;
  }
  await refreshGamification(supabase, userId);
  // Phase 27: XP-bearing write — audit it like the other
  // XP-bearing cores (trade.created, goal completion). The
  // xp_transactions rows are the amount ledger; this row is
  // the who/when record in the shared audit trail.
  await writeAuditLog({
    userId,
    action: "backtesting.logged",
    entityType: "daily_activity",
    details: {
      activityDate,
      sessions,
      xpAwarded: awarded * XP_TABLE.backtest_session,
    },
  });
  return {
    ok: true,
    activityDate,
    sessions,
    sessionsAwarded: awarded,
    xpAwarded: awarded * XP_TABLE.backtest_session,
  };
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

"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/auth/actions";
import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured, supabaseNotConnectedMessage } from "@/lib/supabase/config";
import { getCurrentUser } from "@/lib/auth/session";
import { mondayOfWeek } from "@/lib/reviews/reviews";
import { COACH_MIN_TRADES } from "./types";
import { CoachStoreUnavailableError, logBacktestingCore, refreshCoachInsights } from "./service";
import { backtestingSchema, firstZodError, refreshCoachSchema } from "./validation";

/**
 * AI Coach Server Actions (Phase 9, spec §28, §39).
 *
 * The coach is deterministic and data-grounded — no external
 * LLM is called, no API key exists. `ai_insights` has no client
 * INSERT policy (migration 0009: server-written), so refreshes
 * insert through the service-role client, like certificates and
 * risk events.
 *
 * Idempotency: a refresh stores an insight only when no stored
 * row for the same week, type and exact metrics snapshot exists
 * (checked here, and enforced by the unique index in migration
 * 0013). Re-running a refresh with unchanged data therefore
 * inserts nothing; when the data changes, the snapshot changes
 * and a new row is stored.
 *
 * Backtesting XP (+15 per session, spec §24): the form records
 * the TOTAL sessions for a day, and XP is awarded once per
 * session index (`backtest:<date>:<n>`). Re-submitting the same
 * total awards nothing new; raising the total awards only the
 * new sessions. A failed XP insert never loses the logged day.
 */

export async function refreshCoachAnalysisAction(
  _prev: ActionResult & { inserted?: number; skipped?: number },
  formData: FormData,
): Promise<ActionResult & { inserted?: number; skipped?: number }> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: supabaseNotConnectedMessage() };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please log in first." };

  const parsed = refreshCoachSchema.safeParse({
    weekStartDate: formData.get("weekStartDate"),
  });
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };
  const monday = mondayOfWeek(parsed.data.weekStartDate);
  if (!monday) return { ok: false, error: "Choose a valid week (YYYY-MM-DD, Monday)." };

  const supabase = await createServerSupabaseClient();
  const admin = createServiceRoleSupabaseClient();
  // Phase 20: the compute + idempotent persist lives in the
  // shared coach service (lib/coach/service.ts) so the manual
  // action, the automatic trade-close trigger and the internal
  // endpoint all run the same engine the same way. The result
  // is mapped back onto this action's original outcomes and
  // messages, unchanged.
  let refreshed: Awaited<ReturnType<typeof refreshCoachInsights>>;
  try {
    refreshed = await refreshCoachInsights({
      supabase,
      admin,
      userId: user.id,
      weekStartDate: monday,
    });
  } catch (e) {
    if (e instanceof CoachStoreUnavailableError) {
      return { ok: false, error: "Supabase is not configured — the analysis was not stored." };
    }
    throw e;
  }
  if (!refreshed.analysis) {
    return { ok: false, error: "Could not load this week's data. Please try again." };
  }
  if (refreshed.insufficientData) {
    return {
      ok: false,
      error: `Not enough trades yet to analyse this week — the coach needs at least ${COACH_MIN_TRADES} closed trades. Journal a few more trades and refresh again.`,
    };
  }
  const { inserted, skipped } = refreshed;

  revalidatePath("/coach");
  revalidatePath("/dashboard");
  return {
    ok: true,
    inserted,
    skipped,
    message:
      inserted === 0
        ? "Analysis is up to date — nothing changed since the last refresh, so no new insights were stored."
        : `Coach analysis refreshed: ${inserted} new insight${inserted === 1 ? "" : "s"} stored${skipped > 0 ? `, ${skipped} unchanged insight${skipped === 1 ? "" : "s"} skipped` : ""}.`,
  };
}

export async function logBacktestingSessionAction(
  _prev: ActionResult & { sessionsAwarded?: number },
  formData: FormData,
): Promise<ActionResult & { sessionsAwarded?: number }> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: supabaseNotConnectedMessage() };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please log in first." };

  const parsed = backtestingSchema.safeParse({
    activityDate: formData.get("activityDate"),
    sessions: formData.get("sessions"),
  });
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };
  const { activityDate, sessions } = parsed.data;

  const supabase = await createServerSupabaseClient();
  // Phase 21 (M2): the upsert + per-session XP loop lives in
  // logBacktestingCore (lib/coach/service.ts), shared with the
  // mobile API — this action keeps its exact outcomes and
  // messages, including the idempotent re-submit wording.
  // Inside the core, each session's idempotency key is still
  // mapped through deterministicUuid(`backtest:${activityDate}:${i}`)
  // before it reaches the uuid source_ref_id column (the
  // Stage 2 regression guard in lib/gamification/xp.test.ts
  // pins this mapping).
  const result = await logBacktestingCore(supabase, user.id, parsed.data);
  if (!result.ok) return { ok: false, error: result.error };
  const awarded = result.sessionsAwarded;
  revalidatePath("/coach");
  revalidatePath("/progress");
  return {
    ok: true,
    sessionsAwarded: awarded,
    message:
      awarded === 0
        ? `${sessions} backtesting session${sessions === 1 ? "" : "s"} already logged for ${activityDate} — no new XP.`
        : `Logged ${sessions} backtesting session${sessions === 1 ? "" : "s"} for ${activityDate} (+${awarded * 15} XP).`,
  };
}

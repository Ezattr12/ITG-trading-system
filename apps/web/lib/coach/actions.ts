"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/auth/actions";
import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured, supabaseNotConnectedMessage } from "@/lib/supabase/config";
import { getCurrentUser } from "@/lib/auth/session";
import { mondayOfWeek } from "@/lib/reviews/reviews";
import { awardXp, refreshGamification } from "@/lib/gamification/actions";
import { deterministicUuid } from "@/lib/gamification/xp";
import { COACH_MIN_TRADES } from "./types";
import { CoachStoreUnavailableError, refreshCoachInsights } from "./service";
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
  const { error } = await supabase.from("daily_activity").upsert(
    {
      user_id: user.id,
      activity_date: activityDate,
      backtesting_sessions: sessions,
    },
    { onConflict: "user_id,activity_date" },
  );
  if (error) {
    return { ok: false, error: "Could not log the backtesting session. Please try again." };
  }

  let awarded = 0;
  for (let i = 1; i <= sessions; i += 1) {
    const ok = await awardXp({
      userId: user.id,
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
  await refreshGamification(supabase, user.id);
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

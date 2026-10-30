"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/auth/actions";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured, supabaseNotConnectedMessage } from "@/lib/supabase/config";
import { getCurrentUser } from "@/lib/auth/session";
import { WEEKLY_REVIEW_XP } from "./reviews";
import { firstZodError, weeklyReviewSchema } from "./validation";
import { saveWeeklyReviewCore } from "./service";

/**
 * Weekly review Server Actions (Phase 8, spec §21, §27).
 *
 * Phase 21 (M2): the write logic lives in
 * lib/reviews/service.ts as a core shared with the mobile
 * API — this action is now a thin adapter (session auth +
 * FormData → core → revalidate/message), with identical
 * behaviour, messages and ordering of outcomes.
 */
export async function saveWeeklyReviewAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: supabaseNotConnectedMessage() };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please log in first." };

  const parsed = weeklyReviewSchema.safeParse({
    weekStartDate: formData.get("weekStartDate"),
    reviewText: formData.get("reviewText"),
    mainMistake: formData.get("mainMistake") || null,
    focusNextWeek: formData.get("focusNextWeek") || null,
  });
  if (!parsed.success) {
    return { ok: false, error: firstZodError(parsed.error) };
  }

  const supabase = await createServerSupabaseClient();
  const result = await saveWeeklyReviewCore(supabase, user.id, parsed.data);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath("/reviews/weekly");
  revalidatePath("/certificates");
  return {
    ok: true,
    message: result.awarded
      ? `Weekly review saved. You earned ${WEEKLY_REVIEW_XP} XP.`
      : "Weekly review saved.",
  };
}

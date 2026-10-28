"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { calcXpFor, type XpAction } from "@itg/calc";
import { createServiceRoleSupabaseClient } from "../supabase/server";
import { isSupabaseConfigured } from "../supabase/config";
import { getGamificationBundle } from "./queries";
import { validatePenalty } from "./xp";
import type { AchievementRow, LevelRow, XpReason } from "./types";

/**
 * Gamification Server Actions (Phase 7, spec §24–26).
 *
 * XP, achievement unlocks and the stored level are written
 * server-side via the service-role client, because
 * `xp_transactions`, `user_achievements` and `user_levels` have
 * no client INSERT/UPDATE policy (migration 0008, append-only
 * like `audit_logs`). This fixes the Phase 3 bug where
 * `awardJournalXp` inserted with the signed-in client and the
 * row was silently rejected by RLS.
 *
 * Every write is best-effort and never blocks the action that
 * earned the XP: a failed XP insert must never lose a trade, a
 * goal or a review. Awards are idempotent — the same
 * (user, reason, source) is never awarded twice — so a retry or
 * a double submit cannot double the XP.
 *
 * Reads use the caller's signed-in client (RLS enforced); the
 * service-role client is only used for the writes RLS blocks.
 */

export interface XpAward {
  userId: string;
  reason: XpReason;
  /** What earned it: a trade id, goal id, achievement id, ... */
  sourceRefId?: string | null;
  /** For reason "achievement": the achievement's xp_reward. */
  amount?: number;
  note?: string | null;
}

function xpAmountFor(award: XpAward): number | null {
  if (award.reason === "achievement") {
    return award.amount !== undefined && award.amount > 0 ? award.amount : null;
  }
  if (award.reason === "penalty" || award.reason === "other") return null;
  return calcXpFor(award.reason as XpAction);
}

/**
 * Award XP for one action. Returns true only when a row was
 * inserted. With a sourceRefId, an existing award for the same
 * (user, reason, source) is not awarded again.
 */
export async function awardXp(award: XpAward): Promise<boolean> {
  const amount = xpAmountFor(award);
  if (amount === null || amount <= 0) return false;
  const admin = createServiceRoleSupabaseClient();
  if (!admin) return false;
  try {
    if (award.sourceRefId) {
      const { data: existing } = await admin
        .from("xp_transactions")
        .select("id")
        .eq("user_id", award.userId)
        .eq("reason", award.reason)
        .eq("source_ref_id", award.sourceRefId)
        .limit(1)
        .maybeSingle();
      if (existing) return false;
    }
    const { error } = await admin.from("xp_transactions").insert({
      user_id: award.userId,
      amount,
      reason: award.reason,
      source_ref_id: award.sourceRefId ?? null,
      note: award.note ?? null,
    });
    return !error;
  } catch {
    return false;
  }
}

/**
 * Log an explicit XP penalty (spec §24). The amount must be a
 * negative whole number and a written reason is required — XP
 * is never removed silently. Returns an error message, or null
 * when the penalty was logged.
 */
export async function logXpPenalty(input: {
  userId: string;
  amount: number;
  note: string;
  sourceRefId?: string | null;
}): Promise<string | null> {
  const problem = validatePenalty(input.amount, input.note);
  if (problem) return problem;
  const admin = createServiceRoleSupabaseClient();
  if (!admin) return "Supabase is not configured — the penalty was not logged.";
  try {
    const { error } = await admin.from("xp_transactions").insert({
      user_id: input.userId,
      amount: input.amount,
      reason: "penalty",
      source_ref_id: input.sourceRefId ?? null,
      note: input.note.trim(),
    });
    return error ? "Could not log the penalty. Please try again." : null;
  } catch {
    return "Could not log the penalty. Please try again.";
  }
}

/**
 * Award every achievement the trader has earned but not yet
 * been awarded, with its XP reward. Returns the newly unlocked
 * achievements (empty when none). Callers create the
 * "achievement" notification themselves — this file does not
 * import the discipline actions, so no import cycle is possible.
 */
export async function checkAndAwardAchievements(
  supabase: SupabaseClient,
  userId: string,
): Promise<AchievementRow[]> {
  if (!isSupabaseConfigured()) return [];
  const admin = createServiceRoleSupabaseClient();
  if (!admin) return [];
  try {
    const bundle = await getGamificationBundle(supabase, userId);
    if (bundle.pendingUnlocks.length === 0) return [];
    const unlocked: AchievementRow[] = [];
    for (const achievement of bundle.pendingUnlocks) {
      const { error } = await admin.from("user_achievements").insert({
        user_id: userId,
        achievement_id: achievement.id,
      });
      if (error) continue;
      unlocked.push(achievement);
      await awardXp({
        userId,
        reason: "achievement",
        sourceRefId: achievement.id,
        amount: achievement.xp_reward,
        note: `Achievement unlocked: ${achievement.name}`,
      });
    }
    return unlocked;
  } catch {
    return [];
  }
}

/**
 * Store the trader's current level score (upsert by user) and
 * return the previous and current level names, so the caller
 * can notify on a level-up. Best-effort: returns nulls when
 * there is no score yet or nothing could be stored.
 */
export async function ensureLevelStored(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ previousLevel: string | null; currentLevel: string | null }> {
  const none = { previousLevel: null, currentLevel: null };
  if (!isSupabaseConfigured()) return none;
  const admin = createServiceRoleSupabaseClient();
  if (!admin) return none;
  try {
    const bundle = await getGamificationBundle(supabase, userId);
    if (bundle.score.score === null || bundle.score.levelName === null) return none;
    const levelRow: LevelRow | undefined = bundle.levels.find(
      (l) => l.name === bundle.score.levelName,
    );
    const { data: previous } = await admin
      .from("user_levels")
      .select("score, levels(name)")
      .eq("user_id", userId)
      .maybeSingle();
    const prevLevels = (previous as { levels?: { name?: string } | { name?: string }[] | null } | null)?.levels;
    const previousLevel = Array.isArray(prevLevels)
      ? prevLevels[0]?.name ?? null
      : prevLevels?.name ?? null;
    const { error } = await admin.from("user_levels").upsert(
      {
        user_id: userId,
        level_id: levelRow?.id ?? null,
        score: bundle.score.score,
        score_breakdown: Object.fromEntries(
          bundle.score.dimensions.map((d) => [d.key, d.value]),
        ),
        calculated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) return none;
    return { previousLevel, currentLevel: bundle.score.levelName };
  } catch {
    return none;
  }
}

/**
 * Recompute the trader's gamification state after something
 * that can earn XP or unlock an achievement (trade journaled,
 * goal completed): award pending achievements and store the
 * current level. Returns what changed, so the caller can notify
 * (achievement / level-up) and revalidate. Never throws and
 * never blocks the caller's save.
 */
export async function refreshGamification(
  supabase: SupabaseClient,
  userId: string,
): Promise<{
  unlocked: AchievementRow[];
  previousLevel: string | null;
  currentLevel: string | null;
}> {
  try {
    const [unlocked, level] = await Promise.all([
      checkAndAwardAchievements(supabase, userId),
      ensureLevelStored(supabase, userId),
    ]);
    return { unlocked, ...level };
  } catch {
    return { unlocked: [], previousLevel: null, currentLevel: null };
  }
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAnalyticsBundle, type AnalyticsBundle } from "../analytics/queries";
import { getRecentClosedTrades, getRiskRules } from "../risk/queries";
import { countDisciplinedStreak } from "../risk/engine";
import { buildGamificationStats } from "./achievements";
import { dimensionInputsFromBundle, scoreTrader } from "./scoring";
import { newlyUnlockedAchievements } from "./achievements";
import { totalXp } from "./xp";
import type {
  AchievementRow,
  GamificationStats,
  LevelRow,
  LevelScoreResult,
  UserAchievementRow,
  XpTransactionRow,
} from "./types";

/**
 * Gamification reads (Phase 7). Server Components / Actions call
 * these with the signed-in user's Supabase client, so RLS
 * enforces isolation: a trader can only ever read their own XP,
 * achievements and level. No service-role client is used for
 * reads. Writes (XP, unlocks, stored level) live in `actions.ts`
 * and go through the service-role client, because those tables
 * have no client INSERT policy (migration 0008, append-only).
 *
 * Known limit (carried from Phases 3–5): scoring runs over at
 * most the 500 most recent closed trades.
 */

export async function getLevels(
  supabase: SupabaseClient,
): Promise<LevelRow[]> {
  const { data } = await supabase
    .from("levels")
    .select("id, name, slug, min_score, max_score, scoring_config, description")
    .order("min_score", { ascending: true });
  return (data ?? []) as LevelRow[];
}

export async function getAchievements(
  supabase: SupabaseClient,
): Promise<AchievementRow[]> {
  const { data } = await supabase
    .from("achievements")
    .select("id, name, slug, description, category, criteria, xp_reward")
    .order("created_at", { ascending: true });
  return (data ?? []) as AchievementRow[];
}

export async function getUserAchievements(
  supabase: SupabaseClient,
  userId: string,
): Promise<UserAchievementRow[]> {
  const { data } = await supabase
    .from("user_achievements")
    .select("id, user_id, achievement_id, unlocked_at")
    .eq("user_id", userId)
    .order("unlocked_at", { ascending: false });
  return (data ?? []) as UserAchievementRow[];
}

export async function getXpTransactions(
  supabase: SupabaseClient,
  userId: string,
  limit = 100,
): Promise<XpTransactionRow[]> {
  const { data } = await supabase
    .from("xp_transactions")
    .select("id, user_id, amount, reason, source_ref_id, note, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as XpTransactionRow[];
}

/** Sum of `backtesting_sessions` in daily_activity (all time). */
export async function getBacktestingSessionCount(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { data } = await supabase
    .from("daily_activity")
    .select("backtesting_sessions")
    .eq("user_id", userId);
  return ((data ?? []) as { backtesting_sessions: number }[]).reduce(
    (sum, r) => sum + (r.backtesting_sessions ?? 0),
    0,
  );
}

export interface GamificationBundle extends AnalyticsBundle {
  score: LevelScoreResult;
  achievements: AchievementRow[];
  userAchievements: UserAchievementRow[];
  /** Achievements earned from current data but not yet stored. */
  pendingUnlocks: AchievementRow[];
  stats: GamificationStats;
  xpTransactions: XpTransactionRow[];
}

/**
 * Everything the Levels / Achievements pages and the dashboard
 * need: the analytics bundle (real trades, goals, XP history),
 * the configured levels, the trader's multi-dimensional score,
 * the achievement catalogue with earned/locked state, and the
 * achievement stats. Nothing here is invented: with no data the
 * score is null and every achievement is locked.
 */
export async function getGamificationBundle(
  supabase: SupabaseClient,
  userId: string,
): Promise<GamificationBundle> {
  const today = new Date().toISOString().slice(0, 10);
  const bundle = await getAnalyticsBundle(supabase, userId);
  const [levels, achievements, userAchievements, xpTransactions, rules, recentClosed, backtestingSessions] =
    await Promise.all([
      getLevels(supabase),
      getAchievements(supabase),
      getUserAchievements(supabase, userId),
      getXpTransactions(supabase, userId),
      getRiskRules(supabase, userId),
      getRecentClosedTrades(supabase, userId),
      getBacktestingSessionCount(supabase, userId),
    ]);

  const inputs = dimensionInputsFromBundle(bundle.trades, bundle.goals, today);
  const score = scoreTrader(inputs, levels);
  const stats = buildGamificationStats({
    trades: bundle.trades,
    goalsCompleted: bundle.goals.filter((g) => g.status === "completed").length,
    backtestingSessions,
    riskDisciplinedTrades: countDisciplinedStreak(recentClosed, rules),
    today,
  });
  const unlockedIds = new Set(userAchievements.map((u) => u.achievement_id));
  const pendingUnlocks = newlyUnlockedAchievements(achievements, unlockedIds, stats);

  return {
    ...bundle,
    levels,
    score,
    achievements,
    userAchievements,
    pendingUnlocks,
    stats,
    xpTransactions,
    xpTotal: totalXp(xpTransactions),
  };
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { WeeklyReviewRow } from "./types";

/**
 * Weekly review reads (Phase 8). Server Components call these
 * with the signed-in user's Supabase client, so RLS enforces
 * isolation. No service-role client is used for reads.
 */
export async function getWeeklyReviews(
  supabase: SupabaseClient,
  userId: string,
  limit = 12,
): Promise<WeeklyReviewRow[]> {
  const { data } = await supabase
    .from("weekly_reviews")
    .select("*")
    .eq("user_id", userId)
    .order("week_start_date", { ascending: false })
    .limit(limit);
  return (data ?? []) as WeeklyReviewRow[];
}

export async function getWeeklyReviewByWeek(
  supabase: SupabaseClient,
  userId: string,
  weekStart: string,
): Promise<WeeklyReviewRow | null> {
  const { data } = await supabase
    .from("weekly_reviews")
    .select("*")
    .eq("user_id", userId)
    .eq("week_start_date", weekStart)
    .maybeSingle();
  return (data ?? null) as WeeklyReviewRow | null;
}

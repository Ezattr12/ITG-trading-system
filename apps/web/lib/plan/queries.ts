import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanEvent, PlanTerm } from "./types";

/**
 * Plan enforcement reads (Task 19). Called with the signed-in
 * trader's Supabase client, so RLS enforces isolation on top
 * of the explicit user_id scoping (the codebase's read
 * convention — see lib/risk/queries.ts).
 */

/** Most recent plan breach events for the trader. */
export async function getPlanEvents(
  supabase: SupabaseClient,
  userId: string,
  limit = 10,
): Promise<PlanEvent[]> {
  const { data } = await supabase
    .from("plan_events")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as PlanEvent[];
}

export interface PlanEventSummary {
  /** Breaches recorded in the window. */
  total: number;
  byTerm: Partial<Record<PlanTerm, number>>;
  /** Window length in days (the summary is labelled with it). */
  days: number;
}

/**
 * Breach counts over a trailing window, from STORED events
 * only — the summary describes what monitoring recorded,
 * never a recomputation over trades (the Plan-vs-actual
 * table above it does the recomputation, and the two are
 * labelled differently on the page for exactly that reason).
 */
export async function getPlanEventSummary(
  supabase: SupabaseClient,
  userId: string,
  days = 30,
): Promise<PlanEventSummary> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data } = await supabase
    .from("plan_events")
    .select("term")
    .eq("user_id", userId)
    .gte("created_at", since)
    .limit(500);
  const rows = (data ?? []) as { term: PlanTerm }[];
  const byTerm: Partial<Record<PlanTerm, number>> = {};
  for (const row of rows) {
    byTerm[row.term] = (byTerm[row.term] ?? 0) + 1;
  }
  return { total: rows.length, byTerm, days };
}

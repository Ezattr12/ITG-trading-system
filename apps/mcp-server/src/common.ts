import type { DbClient } from "./db.js";

/**
 * Shared helpers for the MCP tool layer (Stage 3 + Stage 4).
 *
 * Everything here is either a pure coercion/formatting helper,
 * a pure date helper mirroring a web-app date rule
 * (lib/analytics mondayOf, lib/discipline periodWindow,
 * lib/reviews mondayOfWeek), or a stored-state fetcher used by
 * more than one tool. Financial formulas are NEVER defined
 * here — they live in @itg/calc and only there.
 */

export const TEXT_CAP = 2000;

/** Thrown when the data source fails; surfaced as upstream_error. */
export class UpstreamError extends Error {}
/** Thrown when a call exceeds its time budget; surfaced as upstream_error: timeout. */
export class TimeoutError extends Error {}

/** Sentinel a tool runner returns for the uniform not_found shape. */
export const NOT_FOUND = Symbol("not_found");

export function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function numOr(value: unknown, fallback: number): number {
  return num(value) ?? fallback;
}

/** Cap free text at TEXT_CAP chars, reporting whether it was cut (§2.6). */
export function capText(text: string | null): { text: string | null; truncated: boolean } {
  if (text === null) return { text: null, truncated: false };
  if (text.length <= TEXT_CAP) return { text, truncated: false };
  return { text: text.slice(0, TEXT_CAP), truncated: true };
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError("call timed out")), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// ---------------------------------------------------------------- dates

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True for a real calendar date in YYYY-MM-DD form. Rejects
 * shape-valid impossibilities (2026-13-40, 2026-02-30) by
 * round-tripping through Date.
 */
export function isValidIsoDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Add whole days to a YYYY-MM-DD date (UTC), returning YYYY-MM-DD. */
export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (to - from), UTC. */
export function daysBetween(from: string, to: string): number {
  const ms =
    new Date(`${to}T00:00:00.000Z`).getTime() -
    new Date(`${from}T00:00:00.000Z`).getTime();
  return Math.floor(ms / 86_400_000);
}

/**
 * Monday (YYYY-MM-DD) of the week containing the date —
 * mirrors lib/reviews/reviews.ts mondayOfWeek and
 * lib/analytics mondayOf. Weeks start on Monday.
 */
export function mondayOfWeek(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  const day = d.getUTCDay() || 7; // Sunday = 7
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d.toISOString().slice(0, 10);
}

/**
 * The measurement window for a goal period, ending today —
 * mirrors lib/discipline/engine.ts periodWindow exactly:
 * daily = today; weekly starts Monday; monthly the 1st;
 * yearly 1 January; clamped to the goal's own start/end dates.
 */
export function periodWindow(
  period: string,
  today: string,
  startDate: string,
  endDate: string | null,
): { start: string; end: string } {
  const todayDate = new Date(`${today}T00:00:00.000Z`);
  let start: Date;
  if (period === "daily") {
    start = todayDate;
  } else if (period === "weekly") {
    const day = todayDate.getUTCDay();
    start = new Date(todayDate.getTime());
    start.setUTCDate(start.getUTCDate() + (day === 0 ? -6 : 1 - day));
  } else if (period === "monthly") {
    start = new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth(), 1));
  } else {
    start = new Date(Date.UTC(todayDate.getUTCFullYear(), 0, 1));
  }
  const goalStart = new Date(`${startDate}T00:00:00.000Z`);
  if (goalStart.getTime() > start.getTime()) start = goalStart;
  let end = todayDate;
  if (endDate) {
    const goalEnd = new Date(`${endDate}T00:00:00.000Z`);
    if (goalEnd.getTime() < end.getTime()) end = goalEnd;
  }
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

// ------------------------------------------------------- stored-state fetchers

export interface PlanRow {
  id: string;
  name: string;
  risk_per_trade_pct: number | null;
  max_daily_loss: number | null;
  max_daily_trades: number | null;
}

export interface RulesRow {
  max_risk_per_trade_pct: number | null;
  max_daily_loss: number | null;
  max_leverage: number | null;
}

/**
 * The trader's active trading plan (newest first) — mirrors
 * lib/risk/queries.ts getTradingPlan's filters (is_active,
 * not soft-deleted, latest updated_at).
 */
export async function fetchActivePlan(
  client: DbClient,
  userId: string,
): Promise<PlanRow | null> {
  const { data, error } = await client
    .from("trading_plans")
    .select("id, name, risk_per_trade_pct, max_daily_loss, max_daily_trades")
    .eq("user_id", userId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new UpstreamError("trading plan query failed");
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    id: String(row.id),
    name: String(row.name),
    risk_per_trade_pct: num(row.risk_per_trade_pct),
    max_daily_loss: num(row.max_daily_loss),
    max_daily_trades: num(row.max_daily_trades),
  };
}

/**
 * The trader's active risk rules (the three fields the Stage 3
 * plan-adherence check needs) — mirrors getRiskRules' filters.
 */
export async function fetchActiveRules(
  client: DbClient,
  userId: string,
): Promise<RulesRow | null> {
  const { data, error } = await client
    .from("risk_rules")
    .select("max_risk_per_trade_pct, max_daily_loss, max_leverage")
    .eq("user_id", userId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new UpstreamError("risk rules query failed");
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    max_risk_per_trade_pct: num(row.max_risk_per_trade_pct),
    max_daily_loss: num(row.max_daily_loss),
    max_leverage: num(row.max_leverage),
  };
}

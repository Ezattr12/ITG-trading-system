/**
 * Trading Identity derivations (Phase 19). Pure functions, tested
 * in Vitest. No I/O, no Supabase.
 *
 * The profile row stores no trading style, markets or preferred
 * sessions, so the Trading Identity section is derived from data
 * that actually exists:
 * - Markets: the active trading plan's `markets`, falling back to
 *   the pairs the trader has actually traded (most frequent first).
 * - Preferred sessions: the active plan's `sessions`, falling back
 *   to the most-traded session in the trade history.
 * - Primary strategy / best strategy: counted from closed trades.
 * Nothing is invented: every helper returns null / [] when its
 * source data does not exist yet, and the page omits those rows.
 */

import type { AnalyticTrade } from "@/lib/analytics/types";
import type { TradingSession } from "@/lib/trades/types";
import { breakdownByStrategy } from "@/lib/analytics/analytics";

export const SESSION_LABELS: Record<TradingSession, string> = {
  asia: "Asia",
  london: "London",
  new_york: "New York",
  other: "Other",
};

export function sessionLabel(session: TradingSession): string {
  return SESSION_LABELS[session] ?? session;
}

/** Most frequent values first, ties broken alphabetically (deterministic). */
function topValues(
  values: readonly (string | null)[],
  limit: number,
): string[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (value === null || value.trim() === "") continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value]) => value);
}

/** Pairs the trader has actually traded, most frequent first. */
export function topPairs(
  trades: readonly AnalyticTrade[],
  limit = 3,
): string[] {
  return topValues(
    trades.map((t) => t.pair),
    limit,
  );
}

/** The strategy used on the most closed trades, or null. */
export function mostUsedStrategy(
  trades: readonly AnalyticTrade[],
): string | null {
  const top = topValues(
    trades.map((t) => t.strategyName),
    1,
  );
  return top.length > 0 ? top[0] : null;
}

/** The session of the most closed trades, or null. */
export function mostTradedSession(
  trades: readonly AnalyticTrade[],
): TradingSession | null {
  const top = topValues(
    trades.map((t) => t.session),
    1,
  );
  return top.length > 0 ? (top[0] as TradingSession) : null;
}

/**
 * Best strategy by win rate, among strategies with at least 3
 * closed trades (a 1-trade 100% is not a "best strategy"). Ties
 * break towards the strategy with more trades. Null when no
 * strategy has 3+ trades.
 */
export function bestStrategy(
  trades: readonly AnalyticTrade[],
): { name: string; winRate: number; trades: number } | null {
  const rows = breakdownByStrategy(trades).filter(
    (r) => r.trades >= 3 && r.winRate !== null,
  );
  if (rows.length === 0) return null;
  const sorted = [...rows].sort(
    (a, b) =>
      (b.winRate as number) - (a.winRate as number) || b.trades - a.trades,
  );
  const best = sorted[0];
  return {
    name: best.label,
    winRate: best.winRate as number,
    trades: best.trades,
  };
}

/**
 * Markets for the Trading Identity section: the active plan's
 * markets first, otherwise the pairs actually traded.
 */
export function identityMarkets(
  planMarkets: readonly string[] | null | undefined,
  trades: readonly AnalyticTrade[],
): string[] {
  const planned = (planMarkets ?? []).filter((m) => m.trim() !== "");
  return planned.length > 0 ? [...planned] : topPairs(trades);
}

/** Sessions for the Trading Identity section: plan first, then history. */
export function identitySessions(
  planSessions: readonly TradingSession[] | null | undefined,
  trades: readonly AnalyticTrade[],
): TradingSession[] {
  const planned = (planSessions ?? []).filter(Boolean);
  if (planned.length > 0) return [...planned];
  const most = mostTradedSession(trades);
  return most === null ? [] : [most];
}

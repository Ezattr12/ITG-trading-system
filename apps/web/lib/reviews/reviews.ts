import { calcXpFor, calcWinRate } from "@itg/calc";

/**
 * Weekly review helpers (Phase 8, spec §21, §27). Pure functions
 * only: no I/O, no Supabase — callers pass the week's real
 * closed trades.
 *
 * Completing a weekly review awards +30 XP (spec §24, XP table
 * in `@itg/calc` — one source of truth). The award is made by
 * `actions.ts` via the existing `awardXp` path, idempotent per
 * review id, so re-saving a review never awards the XP twice.
 */

/** Monday (YYYY-MM-DD) of the week containing a date. */
export function mondayOfWeek(date: string): string | null {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d.toISOString().slice(0, 10);
}

/** Monday–Sunday bounds (YYYY-MM-DD) for a week starting Monday. */
export function weekBounds(weekStart: string): { start: string; end: string } | null {
  const monday = mondayOfWeek(weekStart);
  if (!monday) return null;
  const d = new Date(`${monday}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return { start: monday, end: d.toISOString().slice(0, 10) };
}

/** Minimal closed-trade shape the weekly aggregates need. */
export interface WeeklyReviewTrade {
  pnl: number;
  strategyName: string | null;
  journaled: boolean;
}

export interface WeeklyAggregates {
  tradesCount: number;
  totalPnl: number | null;
  winRatePct: number | null;
  journalCompletionPct: number | null;
  bestStrategy: string | null;
  worstStrategy: string | null;
}

/** XP awarded for completing one weekly review (spec §24). */
export const WEEKLY_REVIEW_XP = calcXpFor("weekly_review");

/**
 * Aggregates for a week, from the week's real closed trades.
 * With no trades every aggregate is null/0 — never a fabricated
 * win rate or P&L. Best/worst strategy need at least one trade
 * each way; a single strategy is both best and worst only when
 * it is the only one traded.
 */
export function computeWeeklyAggregates(
  trades: readonly WeeklyReviewTrade[],
): WeeklyAggregates {
  if (trades.length === 0) {
    return {
      tradesCount: 0,
      totalPnl: null,
      winRatePct: null,
      journalCompletionPct: null,
      bestStrategy: null,
      worstStrategy: null,
    };
  }
  const pnls = trades.map((t) => t.pnl);
  const byStrategy = new Map<string, number>();
  for (const t of trades) {
    const name = t.strategyName ?? "No strategy recorded";
    byStrategy.set(name, (byStrategy.get(name) ?? 0) + t.pnl);
  }
  const ranked = [...byStrategy.entries()].sort((a, b) => b[1] - a[1]);
  return {
    tradesCount: trades.length,
    totalPnl: pnls.reduce((a, b) => a + b, 0),
    winRatePct: calcWinRate(pnls),
    journalCompletionPct: Math.round(
      (trades.filter((t) => t.journaled).length / trades.length) * 100,
    ),
    bestStrategy: ranked[0]?.[0] ?? null,
    worstStrategy: ranked[ranked.length - 1]?.[0] ?? null,
  };
}

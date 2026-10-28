import {
  calcAvgLoss,
  calcAvgWin,
  calcExpectancy,
  calcProfitFactor,
  calcWinRate,
} from "@itg/calc";
import type {
  BreakdownRow,
  ReportLesson,
  ReportSummary,
  ReportTrade,
  ReportType,
} from "./types";

/**
 * Report aggregation (Phase 8, spec §27). Pure functions only:
 * no I/O, no Supabase — callers pass the period's real trades,
 * lessons and goal counts.
 *
 * Recommendations are rule-based and reference only this
 * trader's own data (most frequent losing setup, discipline
 * rate, psychology vs P&L, repeated mistakes). No generic
 * trading advice is invented, and no statistic is shown for
 * data that does not exist.
 */

export interface ReportInputs {
  type: ReportType;
  periodStart: string;
  periodEnd: string;
  trades: readonly ReportTrade[];
  lessons: readonly ReportLesson[];
  goalsCompleted: number;
  goalsTotal: number;
}

function breakdown(
  trades: readonly ReportTrade[],
  keyOf: (t: ReportTrade) => string | null,
): BreakdownRow[] {
  const map = new Map<string, ReportTrade[]>();
  for (const t of trades) {
    const key = keyOf(t) ?? "Not recorded";
    const list = map.get(key) ?? [];
    list.push(t);
    map.set(key, list);
  }
  return [...map.entries()]
    .map(([name, list]) => {
      const pnls = list.map((t) => t.pnl);
      return {
        name,
        trades: list.length,
        wins: pnls.filter((p) => p > 0).length,
        totalPnl: pnls.reduce((a, b) => a + b, 0),
        winRate: calcWinRate(pnls),
      };
    })
    .sort((a, b) => b.trades - a.trades);
}

function mostFrequent<T>(items: readonly T[]): { value: T; count: number } | null {
  if (items.length === 0) return null;
  const counts = new Map<T, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  let best: { value: T; count: number } | null = null;
  for (const [value, count] of counts) {
    if (!best || count > best.count) best = { value, count };
  }
  return best;
}

function buildRecommendations(summary: Omit<ReportSummary, "recommendations">): string[] {
  const recs: string[] = [];
  if (summary.tradesCount === 0) {
    recs.push("No closed trades in this period — there is nothing to analyse yet. Journal your next trades and this report will fill in.");
    return recs;
  }
  if (summary.mostFrequentLosingSetup) {
    const s = summary.mostFrequentLosingSetup;
    recs.push(
      `Your most frequent losing setup was ${s.name} (${s.losses} losing trade${s.losses === 1 ? "" : "s"}). Review those trades before repeating the setup.`,
    );
  }
  if (summary.disciplinePct !== null && summary.disciplinePct < 80) {
    recs.push(
      `Only ${summary.disciplinePct}% of trades had a stop-loss set. Setting a stop-loss on every trade is the fastest discipline win in your own data.`,
    );
  }
  if (summary.journalCompletionPct !== null && summary.journalCompletionPct < 80) {
    recs.push(
      `Journal completion was ${summary.journalCompletionPct}%. Trades without a psychology record or lesson cannot be reviewed later — journal them the same day.`,
    );
  }
  const worstEmotion = [...summary.byEmotion]
    .filter((r) => r.name !== "Not recorded" && r.trades >= 2)
    .sort((a, b) => a.totalPnl - b.totalPnl)[0];
  if (worstEmotion && worstEmotion.totalPnl < 0) {
    recs.push(
      `Trades logged as ${worstEmotion.name} lost ${worstEmotion.totalPnl.toFixed(2)} in total across ${worstEmotion.trades} trades. Consider your no-trade conditions for that state.`,
    );
  }
  if (summary.mostRepeatedMistake) {
    recs.push(
      `Most repeated mistake: "${summary.mostRepeatedMistake.text}" (${summary.mostRepeatedMistake.count} times). Pick one concrete fix for it next period.`,
    );
  }
  if (summary.winRate !== null && summary.winRate >= 50 && summary.profitFactor !== null && summary.profitFactor < 1) {
    recs.push(
      `You won ${summary.winRate}% of trades but the profit factor is below 1 — average losses are outweighing average wins. Review your losing trades' size and exits.`,
    );
  }
  if (recs.length === 0) {
    recs.push("No clear problem pattern in this period. Keep the routine that produced it and review the next period the same way.");
  }
  return recs;
}

/** Build a report summary from the period's real data. */
export function buildReportSummary(input: ReportInputs): ReportSummary {
  const trades = input.trades;
  const pnls = trades.map((t) => t.pnl);
  const rs = trades
    .map((t) => t.rMultiple)
    .filter((r): r is number => r !== null);

  const losingByStrategy = trades
    .filter((t) => t.pnl < 0)
    .map((t) => t.strategyName ?? "No strategy recorded");
  const mostLosing = mostFrequent(losingByStrategy);

  const repeatedLessons = input.lessons.filter((l) => l.repeatedMistake);
  const mistakeTexts = repeatedLessons.map((l) => l.text.trim()).filter(Boolean);
  const mostMistake = mostFrequent(mistakeTexts);

  const base: Omit<ReportSummary, "recommendations"> = {
    type: input.type,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    tradesCount: trades.length,
    wins: pnls.filter((p) => p > 0).length,
    losses: pnls.filter((p) => p < 0).length,
    breakeven: pnls.filter((p) => p === 0).length,
    totalPnl: pnls.reduce((a, b) => a + b, 0),
    winRate: calcWinRate(pnls),
    avgWin: calcAvgWin(pnls),
    avgLoss: calcAvgLoss(pnls),
    profitFactor: calcProfitFactor(pnls),
    expectancy: calcExpectancy(pnls),
    avgR:
      rs.length > 0
        ? rs.reduce((a, b) => a + b, 0) / rs.length
        : null,
    journalCompletionPct:
      trades.length > 0
        ? Math.round(
            (trades.filter((t) => t.journaled).length / trades.length) * 100,
          )
        : null,
    disciplinePct:
      trades.length > 0
        ? Math.round(
            (trades.filter((t) => t.stopLossSet).length / trades.length) * 100,
          )
        : null,
    goalsCompleted: input.goalsCompleted,
    goalsTotal: input.goalsTotal,
    byStrategy: breakdown(trades, (t) => t.strategyName),
    bySession: breakdown(trades, (t) => t.session),
    byEmotion: breakdown(trades, (t) => t.emotion),
    mostFrequentLosingSetup: mostLosing
      ? { name: mostLosing.value, losses: mostLosing.count }
      : null,
    mostRepeatedMistake: mostMistake
      ? { text: mostMistake.value, count: mostMistake.count }
      : null,
  };
  return { ...base, recommendations: buildRecommendations(base) };
}

/** Period bounds for a report type, from an anchor date (YYYY-MM-DD). */
export function periodBounds(
  type: ReportType,
  anchor: string,
): { start: string; end: string } | null {
  const d = new Date(`${anchor}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  if (type === "daily") return { start: anchor, end: anchor };
  if (type === "weekly") {
    // Monday-first week containing the anchor.
    const day = d.getUTCDay() || 7;
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - (day - 1));
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    return { start: iso(monday), end: iso(sunday) };
  }
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return { start: iso(start), end: iso(end) };
}

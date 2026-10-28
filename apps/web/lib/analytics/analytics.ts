import {
  calcAvgLoss,
  calcAvgWin,
  calcCurrentStreak,
  calcDrawdownSeries,
  calcEquityCurve,
  calcExpectancy,
  calcMaxDrawdown,
  calcProfitFactor,
  calcRDistribution,
  calcWinRate,
} from "@itg/calc";
import type {
  AnalyticTrade,
  BreakdownRow,
  EquityPoint,
  PeriodPnl,
  PsychologySummary,
  TradeSummary,
} from "./types";

/**
 * Pure analytics over real closed trades (Phase 4, spec §17–18).
 *
 * No I/O, no Supabase — every function takes trades and returns
 * numbers. All money goes through @itg/calc (decimal.js). Empty
 * input returns nulls / zeroes, never invented values: callers
 * render honest empty states from those.
 *
 * Known limit (carried from Phase 3): analytics run over at most
 * the 500 most recent closed trades, because that is what
 * `queries.ts` fetches. Phase 12 pushes aggregation into the
 * database if a journal grows past it.
 */

function pnls(trades: readonly AnalyticTrade[]): number[] {
  return trades.map((t) => t.pnl);
}

function rValues(trades: readonly AnalyticTrade[]): number[] {
  return trades.map((t) => t.rMultiple).filter((r): r is number => r !== null);
}

export function summarizeTrades(trades: readonly AnalyticTrade[]): TradeSummary {
  const values = pnls(trades);
  const wins = values.filter((p) => p > 0).length;
  const losses = values.filter((p) => p < 0).length;
  const rs = rValues(trades);
  return {
    tradeCount: trades.length,
    totalPnl: values.reduce((sum, p) => sum + p, 0),
    wins,
    losses,
    breakeven: values.filter((p) => p === 0).length,
    winRate: calcWinRate(values),
    lossRate: trades.length === 0 ? null : (losses / trades.length) * 100,
    avgWin: calcAvgWin(values),
    avgLoss: calcAvgLoss(values),
    profitFactor: calcProfitFactor(values),
    expectancy: calcExpectancy(values),
    avgR: rs.length === 0 ? null : rs.reduce((sum, r) => sum + r, 0) / rs.length,
    maxDrawdown: calcMaxDrawdown(calcEquityCurve(values)),
    currentStreak: calcCurrentStreak(values),
  };
}

/** Equity curve points, one per closed trade, chronological by close time. */
export function buildEquityCurve(trades: readonly AnalyticTrade[]): EquityPoint[] {
  const sorted = [...trades].sort(
    (a, b) => new Date(a.closedAt).getTime() - new Date(b.closedAt).getTime(),
  );
  const equity = calcEquityCurve(pnls(sorted));
  const dd = calcDrawdownSeries(equity);
  return sorted.map((t, i) => ({
    date: t.closedAt.slice(0, 10),
    equity: equity[i],
    drawdown: dd[i]?.drawdown ?? 0,
    trades: i + 1,
  }));
}

/** Monday (YYYY-MM-DD) of the week containing `date`. Weeks start Monday. */
export function mondayOf(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

export function periodPnl(
  trades: readonly AnalyticTrade[],
  period: "day" | "week" | "month",
): PeriodPnl[] {
  const buckets = new Map<string, { pnl: number; trades: number; wins: number }>();
  for (const t of trades) {
    const d = new Date(t.closedAt);
    const label =
      period === "day"
        ? t.closedAt.slice(0, 10)
        : period === "week"
          ? mondayOf(d)
          : t.closedAt.slice(0, 7);
    const bucket = buckets.get(label) ?? { pnl: 0, trades: 0, wins: 0 };
    bucket.pnl += t.pnl;
    bucket.trades += 1;
    if (t.pnl > 0) bucket.wins += 1;
    buckets.set(label, bucket);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([label, b]) => ({ label, ...b }));
}

/** Generic breakdown: group trades by a key and aggregate each group. */
export function breakdownBy(
  trades: readonly AnalyticTrade[],
  keyOf: (t: AnalyticTrade) => string | null,
  labelOf: (key: string) => string = (key) => key,
): BreakdownRow[] {
  const groups = new Map<string, AnalyticTrade[]>();
  for (const t of trades) {
    const key = keyOf(t) ?? "unknown";
    const group = groups.get(key) ?? [];
    group.push(t);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, group]) => {
      const values = pnls(group);
      const rs = rValues(group);
      return {
        key,
        label: labelOf(key),
        trades: group.length,
        pnl: values.reduce((sum, p) => sum + p, 0),
        winRate: calcWinRate(values),
        avgR: rs.length === 0 ? null : rs.reduce((sum, r) => sum + r, 0) / rs.length,
        avgWin: calcAvgWin(values),
        avgLoss: calcAvgLoss(values),
      };
    })
    .sort((a, b) => b.pnl - a.pnl);
}

export function breakdownByStrategy(trades: readonly AnalyticTrade[]): BreakdownRow[] {
  return breakdownBy(trades, (t) => t.strategyName, (key) =>
    key === "unknown" ? "No strategy" : key,
  );
}

export function breakdownBySession(trades: readonly AnalyticTrade[]): BreakdownRow[] {
  const labels: Record<string, string> = {
    asia: "Asia",
    london: "London",
    new_york: "New York",
    other: "Other",
    unknown: "No session",
  };
  return breakdownBy(trades, (t) => t.session, (key) => labels[key] ?? key);
}

export function breakdownByDirection(trades: readonly AnalyticTrade[]): BreakdownRow[] {
  return breakdownBy(trades, (t) => t.direction, (key) =>
    key === "long" ? "Long" : key === "short" ? "Short" : key,
  );
}

/** R distribution over closed trades (spec §18). */
export function rDistribution(trades: readonly AnalyticTrade[]) {
  return calcRDistribution(trades.map((t) => t.rMultiple));
}

/** Psychology vs performance (spec §18): emotion, confidence, discipline. */
export function psychologySummary(trades: readonly AnalyticTrade[]): PsychologySummary {
  const byEmotion = breakdownBy(
    trades,
    (t) => t.emotion,
    (key) => key,
  )
    .filter((row) => row.key !== "unknown")
    .map((row) => ({
      emotion: row.key as PsychologySummary["byEmotion"][number]["emotion"],
      trades: row.trades,
      pnl: row.pnl,
      winRate: row.winRate,
    }));
  const confidences = trades
    .map((t) => t.confidence)
    .filter((c): c is number => c !== null);
  const avgConfidence =
    confidences.length === 0
      ? null
      : confidences.reduce((sum, c) => sum + c, 0) / confidences.length;
  const withDiscipline = trades.filter((t) => t.discipline !== null);
  const goodDisciplinePct =
    withDiscipline.length === 0
      ? null
      : (withDiscipline.filter((t) => t.discipline === "good").length / withDiscipline.length) * 100;
  return {
    byEmotion,
    avgConfidence,
    goodDisciplinePct,
    stopLossPct:
      trades.length === 0
        ? 0
        : (trades.filter((t) => t.stopLossSet).length / trades.length) * 100,
    journalCompletionPct:
      trades.length === 0
        ? 0
        : (trades.filter((t) => t.journaled).length / trades.length) * 100,
  };
}

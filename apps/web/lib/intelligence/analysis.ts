import {
  calcCurrentStreak,
  calcDrawdownSeries,
  calcMaxDrawdown,
} from "@itg/calc";
import {
  buildEquityCurve,
  psychologySummary,
  summarizeTrades,
} from "@/lib/analytics/analytics";
import type { RiskEvent, RiskRules, TradingPlan } from "@/lib/risk/types";
import type {
  ConditionsAnalysis,
  ConditionRow,
  DisciplineAnalysis,
  DisciplineSplit,
  DrawdownAnalysis,
  GroupStat,
  ImprovementAction,
  ImprovementPlan,
  IntelLesson,
  IntelTrade,
  PsychologyAnalysis,
  RecurringAnalysis,
  RiskBehaviorAnalysis,
} from "./types";

/**
 * Advanced Trading Intelligence — pure analysis (Phase 23).
 *
 * No I/O, no Supabase: callers pass the trader's real stored
 * rows (see `queries.ts`). Every aggregate is produced by
 * the existing machinery — `summarizeTrades` /
 * `buildEquityCurve` from lib/analytics and the `@itg/calc`
 * primitives beneath them. This module only selects, groups
 * and compares; it re-implements no P&L, win-rate or
 * drawdown formula.
 *
 * Honesty rules, applied uniformly:
 * - A comparison statement needs ≥3 trades on BOTH sides and
 *   a win-rate gap of ≥20 points; below that the groups are
 *   reported with no conclusion.
 * - A figure that cannot be measured from stored fields is
 *   null and labelled as such — never estimated.
 */

/** Minimum closed trades before drawdown / plan conclusions. */
export const INTEL_MIN_TRADES = 5;
/** Minimum trades in a group before it can be compared. */
export const GROUP_MIN_TRADES = 3;
/** Minimum win-rate gap (points) for a relationship statement. */
export const MATERIAL_WIN_RATE_GAP = 20;

/* -------------------------------------------------------------- helpers */

function chrono(trades: readonly IntelTrade[]): IntelTrade[] {
  return [...trades].sort(
    (a, b) =>
      new Date(a.closedAt).getTime() - new Date(b.closedAt).getTime() ||
      new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime(),
  );
}

function money(n: number): string {
  return n.toFixed(2);
}

function pct(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function daysBetween(a: string, b: string): number {
  const ms = new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000);
}

function groupStat(key: string, label: string, trades: readonly IntelTrade[]): GroupStat {
  const s = summarizeTrades(trades);
  return {
    key,
    label,
    trades: s.tradeCount,
    wins: s.wins,
    losses: s.losses,
    totalPnl: s.totalPnl,
    winRate: s.winRate,
    expectancy: s.expectancy,
    avgR: s.avgR,
    profitFactor: s.profitFactor,
  };
}

function groupBy(
  trades: readonly IntelTrade[],
  keyOf: (t: IntelTrade) => string | null,
  labelOf: (key: string) => string,
): GroupStat[] {
  const groups = new Map<string, IntelTrade[]>();
  for (const t of trades) {
    const key = keyOf(t);
    if (key === null) continue;
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .map(([key, list]) => groupStat(key, labelOf(key), list))
    .sort((a, b) => b.totalPnl - a.totalPnl);
}

/**
 * The one comparison rule used by the psychology and
 * discipline analyses: with ≥3 trades on both sides and a
 * ≥20-point win-rate gap, state the association (never a
 * cause). Otherwise return null — the groups speak for
 * themselves.
 */
function comparisonStatement(
  better: GroupStat,
  worse: GroupStat,
  describe: (g: GroupStat) => string,
): string | null {
  if (better.trades < GROUP_MIN_TRADES || worse.trades < GROUP_MIN_TRADES) return null;
  if (better.winRate === null || worse.winRate === null) return null;
  if (better.winRate - worse.winRate < MATERIAL_WIN_RATE_GAP) return null;
  return (
    `${describe(worse)} won ${pct(worse.winRate)}% of ${worse.trades} trades ` +
    `(total P&L ${money(worse.totalPnl)}), versus ${pct(better.winRate)}% across ` +
    `${better.trades} trades for ${describe(better)} (total P&L ${money(better.totalPnl)}). ` +
    `In your journal the weaker side has accompanied weaker results — that is an ` +
    `association in your recorded data, not proof of what caused it.`
  );
}

function splitStatement(a: GroupStat, b: GroupStat, describeA: string, describeB: string): string | null {
  if (a.winRate === null || b.winRate === null) return null;
  const [better, worse] = a.winRate >= b.winRate ? [a, b] : [b, a];
  const describe = (g: GroupStat) => (g.key === a.key ? describeA : describeB);
  return comparisonStatement(better, worse, describe);
}

/* -------------------------------------------------------------- drawdown */

export function analyzeDrawdown(trades: readonly IntelTrade[]): DrawdownAnalysis {
  const sorted = chrono(trades);
  const points = buildEquityCurve(sorted);
  const series = points.map((p) => ({ date: p.date, equity: p.equity, drawdown: p.drawdown }));
  const totalPnl = summarizeTrades(sorted).totalPnl;
  const base: DrawdownAnalysis = {
    status: trades.length >= INTEL_MIN_TRADES ? "ok" : "insufficient_data",
    tradesCount: trades.length,
    totalPnl,
    series,
    maxDrawdown: 0,
    maxDrawdownPctOfPeak: null,
    episode: null,
    longestUnderwater: null,
    currentDrawdown: 0,
    currentDrawdownPctOfPeak: null,
    atPeak: points.length > 0 && (points[points.length - 1]?.drawdown ?? 0) === 0,
  };
  if (points.length === 0) return base;

  const equityValues = points.map((p) => p.equity);
  const ddSeries = calcDrawdownSeries(equityValues);
  const maxDrawdown = calcMaxDrawdown(equityValues);
  base.maxDrawdown = maxDrawdown;
  const last = ddSeries[ddSeries.length - 1];
  base.currentDrawdown = last?.drawdown ?? 0;
  base.currentDrawdownPctOfPeak =
    last && last.peak > 0 ? (last.drawdown / last.peak) * 100 : null;
  base.atPeak = base.currentDrawdown === 0;
  if (maxDrawdown <= 0) return base;

  // Worst episode: trough = first point reaching the max
  // drawdown; its peak = the last at-peak point at or before
  // the trough; recovery = the first at-peak point after it.
  const troughIdx = ddSeries.findIndex((p) => p.drawdown === maxDrawdown);
  const peakValue = ddSeries[troughIdx]?.peak ?? 0;
  let peakIdx = troughIdx;
  for (let i = troughIdx; i >= 0; i -= 1) {
    if (ddSeries[i].drawdown === 0) {
      peakIdx = i;
      break;
    }
  }
  let recoveryIdx = -1;
  for (let i = troughIdx + 1; i < ddSeries.length; i += 1) {
    if (ddSeries[i].drawdown === 0) {
      recoveryIdx = i;
      break;
    }
  }
  const peakDate = points[peakIdx]?.date ?? points[0].date;
  const troughDate = points[troughIdx]?.date ?? points[points.length - 1].date;
  base.maxDrawdownPctOfPeak = peakValue > 0 ? (maxDrawdown / peakValue) * 100 : null;
  base.episode = {
    peakEquity: peakValue,
    peakDate,
    troughDate,
    daysToTrough: daysBetween(peakDate, troughDate),
    recovered: recoveryIdx >= 0,
    recoveryDate: recoveryIdx >= 0 ? points[recoveryIdx].date : null,
  };

  // Longest underwater run: an at-peak point followed by
  // below-peak points, ending at the next at-peak point (the
  // recovery) or at the end of the curve.
  let best: DrawdownAnalysis["longestUnderwater"] = null;
  let i = 0;
  while (i < ddSeries.length) {
    if (ddSeries[i].drawdown !== 0) {
      i += 1;
      continue;
    }
    const runPeakDate = points[i].date;
    let j = i + 1;
    while (j < ddSeries.length && ddSeries[j].drawdown > 0) j += 1;
    const underwaterTrades = j - (i + 1);
    if (underwaterTrades > 0) {
      const recovered = j < ddSeries.length;
      const endDate = recovered ? points[j].date : points[points.length - 1].date;
      const run = {
        startDate: runPeakDate,
        endDate,
        trades: underwaterTrades,
        days: daysBetween(runPeakDate, endDate),
        recovered,
      };
      if (!best || run.trades > best.trades || (run.trades === best.trades && run.days > best.days)) {
        best = run;
      }
    }
    i = Math.max(j, i + 1);
  }
  base.longestUnderwater = best;
  return base;
}

/* -------------------------------------------------------- risk behaviour */

export interface RiskContext {
  rules: RiskRules | null;
  plan: TradingPlan | null;
  capital: number | null;
  riskEvents: readonly RiskEvent[];
  /** Reference date (YYYY-MM-DD) for the last-30-days event count. */
  today: string;
}

export function analyzeRiskBehavior(
  trades: readonly IntelTrade[],
  ctx: RiskContext,
): RiskBehaviorAnalysis {
  const sorted = chrono(trades);
  const pnls = sorted.map((t) => t.pnl);
  const withRisk = sorted.filter((t) => t.riskAmount !== null);
  const risks = withRisk.map((t) => t.riskAmount as number);
  const capital = ctx.capital !== null && ctx.capital > 0 ? ctx.capital : null;

  let distribution: RiskBehaviorAnalysis["distribution"] = null;
  if (risks.length > 0) {
    const ordered = [...risks].sort((a, b) => a - b);
    const mid = Math.floor(ordered.length / 2);
    distribution = {
      count: risks.length,
      avg: risks.reduce((s, r) => s + r, 0) / risks.length,
      median: ordered.length % 2 === 1 ? ordered[mid] : (ordered[mid - 1] + ordered[mid]) / 2,
      min: ordered[0],
      max: ordered[ordered.length - 1],
    };
  }

  const riskLimitPct = ctx.rules?.max_risk_per_trade_pct ?? ctx.plan?.risk_per_trade_pct ?? null;
  const riskLimitSource: RiskBehaviorAnalysis["riskLimitSource"] =
    ctx.rules?.max_risk_per_trade_pct != null
      ? "rules"
      : ctx.plan?.risk_per_trade_pct != null
        ? "plan"
        : null;
  let overLimitCount: number | null = null;
  let withinLimitPct: number | null = null;
  let riskLimitNote: RiskBehaviorAnalysis["riskLimitNote"] = null;
  if (riskLimitPct === null) {
    riskLimitNote = "no_limit_configured";
  } else if (capital === null) {
    riskLimitNote = "capital_missing";
  } else if (risks.length > 0) {
    const limitAmount = (capital * riskLimitPct) / 100;
    overLimitCount = risks.filter((r) => r > limitAmount + 1e-9).length;
    withinLimitPct = ((risks.length - overLimitCount) / risks.length) * 100;
  }

  // Daily loss on the risk engine's basis: closed trades
  // grouped by close date, summed stored P&L per day.
  const dayPnl = new Map<string, number>();
  for (const t of sorted) {
    const day = t.closedAt.slice(0, 10);
    dayPnl.set(day, (dayPnl.get(day) ?? 0) + t.pnl);
  }
  let worstDay: RiskBehaviorAnalysis["worstDay"] = null;
  for (const [date, pnl] of dayPnl) {
    if (!worstDay || pnl < worstDay.pnl) worstDay = { date, pnl };
  }
  const dailyLossLimit = ctx.rules?.max_daily_loss ?? ctx.plan?.max_daily_loss ?? null;
  const dailyLossBreachDays =
    dailyLossLimit === null
      ? null
      : [...dayPnl.values()].filter((p) => p < -dailyLossLimit).length;

  const leverages = sorted.map((t) => t.leverage);
  const leverageLimit = ctx.rules?.max_leverage ?? null;
  let maxConsecutiveLosses = 0;
  let run = 0;
  for (const p of pnls) {
    run = p < 0 ? run + 1 : 0;
    if (run > maxConsecutiveLosses) maxConsecutiveLosses = run;
  }

  let trend: RiskBehaviorAnalysis["trend"] = null;
  if (risks.length >= 10) {
    const recent = risks.slice(-20);
    const prior = risks.slice(0, risks.length - recent.length).slice(-20);
    if (prior.length >= 5 && recent.length >= 5) {
      const recentAvg = recent.reduce((s, r) => s + r, 0) / recent.length;
      const priorAvg = prior.reduce((s, r) => s + r, 0) / prior.length;
      trend = {
        recentAvg,
        priorAvg,
        recentCount: recent.length,
        priorCount: prior.length,
        deltaPct: priorAvg !== 0 ? ((recentAvg - priorAvg) / Math.abs(priorAvg)) * 100 : null,
      };
    }
  }

  const thirtyDaysAgo = new Date(`${ctx.today}T00:00:00Z`);
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);
  const cutoff = thirtyDaysAgo.toISOString().slice(0, 10);
  const events = ctx.riskEvents;

  return {
    status: trades.length > 0 ? "ok" : "insufficient_data",
    tradesCount: trades.length,
    withRiskCount: risks.length,
    withoutStopLossCount: trades.length - risks.length,
    distribution,
    capital,
    avgRiskPctOfCapital:
      capital !== null && distribution ? (distribution.avg / capital) * 100 : null,
    maxRiskPctOfCapital:
      capital !== null && distribution ? (distribution.max / capital) * 100 : null,
    riskLimitPct,
    riskLimitSource,
    riskLimitNote,
    overLimitCount,
    withinLimitPct,
    dailyLossLimit,
    daysTraded: dayPnl.size,
    worstDay,
    dailyLossBreachDays,
    maxLeverageUsed: leverages.length > 0 ? Math.max(...leverages) : null,
    leverageLimit,
    leverageOverCount:
      leverageLimit === null ? null : leverages.filter((l) => l > leverageLimit).length,
    maxConsecutiveLosses,
    currentStreak: calcCurrentStreak(pnls),
    trend,
    riskEvents: {
      total: events.length,
      critical: events.filter((e) => e.severity === "critical").length,
      warning: events.filter((e) => e.severity === "warning").length,
      positive: events.filter((e) => e.severity === "positive").length,
      last30Days: events.filter((e) => e.created_at.slice(0, 10) >= cutoff).length,
    },
  };
}

/* ------------------------------------------------------------ psychology */

const CONFIDENCE_BANDS: { key: string; label: string; test: (c: number) => boolean }[] = [
  { key: "low", label: "Confidence 1–2", test: (c) => c <= 2 },
  { key: "mid", label: "Confidence 3", test: (c) => c === 3 },
  { key: "high", label: "Confidence 4–5", test: (c) => c >= 4 },
];

export function analyzePsychology(trades: readonly IntelTrade[]): PsychologyAnalysis {
  const recorded = trades.filter((t) => t.emotion !== null || t.confidence !== null);
  const byEmotion = groupBy(
    trades,
    (t) => t.emotion,
    (key) => key,
  );
  const byConfidence = CONFIDENCE_BANDS.map((band) =>
    groupStat(
      band.key,
      band.label,
      trades.filter((t) => t.confidence !== null && band.test(t.confidence)),
    ),
  ).filter((g) => g.trades > 0);
  const summary = psychologySummary(trades);

  const eligibleEmotions = byEmotion.filter(
    (g) => g.trades >= GROUP_MIN_TRADES && g.winRate !== null,
  );
  let emotionStatement: string | null = null;
  if (eligibleEmotions.length >= 2) {
    const sorted = [...eligibleEmotions].sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0));
    emotionStatement = comparisonStatement(
      sorted[0],
      sorted[sorted.length - 1],
      (g) => `trades recorded as ${g.label}`,
    );
  }
  const eligibleBands = byConfidence.filter(
    (g) => g.trades >= GROUP_MIN_TRADES && g.winRate !== null,
  );
  let confidenceStatement: string | null = null;
  if (eligibleBands.length >= 2) {
    const sorted = [...eligibleBands].sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0));
    confidenceStatement = comparisonStatement(
      sorted[0],
      sorted[sorted.length - 1],
      (g) => `trades taken at ${g.label.toLowerCase()}`,
    );
  }

  return {
    status: recorded.length > 0 ? "ok" : "insufficient_data",
    recordedTrades: recorded.length,
    byEmotion,
    byConfidence,
    avgConfidence: summary.avgConfidence,
    emotionStatement,
    confidenceStatement,
  };
}

/* ------------------------------------------------------------ discipline */

export function analyzeDiscipline(trades: readonly IntelTrade[]): DisciplineAnalysis {
  const summary = psychologySummary(trades);
  const mkSplit = (
    keyA: string,
    labelA: string,
    sideA: IntelTrade[],
    keyB: string,
    labelB: string,
    sideB: IntelTrade[],
  ): DisciplineSplit => {
    const a = groupStat(keyA, labelA, sideA);
    const b = groupStat(keyB, labelB, sideB);
    return { a, b, statement: splitStatement(a, b, labelA.toLowerCase(), labelB.toLowerCase()) };
  };

  const rated = trades.filter((t) => t.discipline !== null);
  return {
    status: trades.length > 0 ? "ok" : "insufficient_data",
    tradesCount: trades.length,
    stopLossPct: summary.stopLossPct,
    journalCompletionPct: summary.journalCompletionPct,
    stopLoss: mkSplit(
      "with_sl",
      "Stop-loss set",
      trades.filter((t) => t.stopLossSet),
      "without_sl",
      "No stop-loss",
      trades.filter((t) => !t.stopLossSet),
    ),
    rating:
      rated.length === 0
        ? null
        : mkSplit(
            "good",
            "Rated good",
            trades.filter((t) => t.discipline === "good"),
            "below_good",
            "Rated average or poor",
            trades.filter((t) => t.discipline === "average" || t.discipline === "poor"),
          ),
    journaled: mkSplit(
      "journaled",
      "Journaled",
      trades.filter((t) => t.journaled),
      "not_journaled",
      "Not journaled",
      trades.filter((t) => !t.journaled),
    ),
  };
}

/* ------------------------------------------------------------- recurring */

export function analyzeRecurring(
  trades: readonly IntelTrade[],
  lessons: readonly IntelLesson[],
): RecurringAnalysis {
  const pnlByTrade = new Map(trades.map((t) => [t.id, t.pnl]));
  const byText = new Map<
    string,
    { count: number; flagged: boolean; tradeIds: Set<string> }
  >();
  for (const lesson of lessons) {
    const text = lesson.text.trim();
    if (!text) continue;
    const entry = byText.get(text) ?? { count: 0, flagged: false, tradeIds: new Set<string>() };
    entry.count += 1;
    entry.flagged = entry.flagged || lesson.repeatedMistake;
    if (lesson.tradeId) entry.tradeIds.add(lesson.tradeId);
    byText.set(text, entry);
  }
  const mistakes = [...byText.entries()]
    .filter(([, e]) => e.count >= 2)
    .map(([text, e]) => {
      const pnls = [...e.tradeIds]
        .map((id) => pnlByTrade.get(id))
        .filter((p): p is number => p !== undefined);
      return {
        text,
        count: e.count,
        flaggedRepeated: e.flagged,
        tradesAffected: pnls.length,
        losingTrades: pnls.filter((p) => p < 0).length,
        totalPnlImpact: pnls.reduce((s, p) => s + p, 0),
      };
    })
    .sort(
      (a, b) => b.count - a.count || a.totalPnlImpact - b.totalPnlImpact,
    );

  const losingSetups = groupBy(
    trades,
    (t) => t.setupName,
    (key) => key,
  )
    .filter((g) => g.losses >= 2)
    .map((g) => ({
      name: g.label,
      trades: g.trades,
      losses: g.losses,
      totalPnl: g.totalPnl,
      winRate: g.winRate,
    }))
    .sort((a, b) => b.losses - a.losses || a.totalPnl - b.totalPnl);

  return {
    status: trades.length > 0 ? "ok" : "insufficient_data",
    totalLessons: lessons.length,
    mistakes,
    losingSetups,
    unrecordedSetupTrades: trades.filter((t) => t.setupName === null).length,
  };
}

/* ------------------------------------------------------------ conditions */

const SESSION_LABELS: Record<string, string> = {
  asia: "Asia",
  london: "London",
  new_york: "New York",
  other: "Other",
};

const CONDITION_LABELS: Record<string, string> = {
  trending: "Trending",
  ranging: "Ranging",
  choppy: "Choppy",
  high_volatility: "High volatility",
  low_volatility: "Low volatility",
  other: "Other condition",
};

export function analyzeConditions(trades: readonly IntelTrade[]): ConditionsAnalysis {
  const rows: ConditionRow[] = [];
  const push = (
    dimension: ConditionRow["dimension"],
    groups: GroupStat[],
  ) => {
    for (const g of groups) {
      if (g.trades >= GROUP_MIN_TRADES) rows.push({ ...g, dimension });
    }
  };
  push(
    "session_direction",
    groupBy(
      trades,
      (t) => (t.session ? `${t.session}|${t.direction}` : null),
      (key) => {
        const [session, direction] = key.split("|");
        return `${SESSION_LABELS[session] ?? session} · ${direction === "long" ? "Long" : "Short"}`;
      },
    ),
  );
  push(
    "strategy_session",
    groupBy(
      trades,
      (t) => (t.strategyName && t.session ? `${t.strategyName}|${t.session}` : null),
      (key) => {
        const [strategy, session] = key.split("|");
        return `${strategy} · ${SESSION_LABELS[session] ?? session}`;
      },
    ),
  );
  push(
    "market_condition",
    groupBy(
      trades,
      (t) => t.marketCondition,
      (key) => CONDITION_LABELS[key] ?? key,
    ),
  );
  rows.sort((a, b) => b.totalPnl - a.totalPnl);
  return {
    status: rows.length > 0 ? "ok" : "insufficient_data",
    rows,
    best: rows[0] ?? null,
    /** With a single qualifying row there is no separate worst. */
    worst: rows.length > 1 ? rows[rows.length - 1] : null,
  };
}

/* -------------------------------------------------------- improvement plan */

export interface ImprovementInputs {
  tradesCount: number;
  drawdown: DrawdownAnalysis;
  risk: RiskBehaviorAnalysis;
  recurring: RecurringAnalysis;
  discipline: DisciplineAnalysis;
  psychology: PsychologyAnalysis;
  conditions: ConditionsAnalysis;
}

/**
 * The personalized improvement plan: deterministic candidate
 * actions in a fixed priority order (risk first, then
 * drawdown, repetition, discipline, psychology, conditions,
 * journaling), each citing the measured figure it rests on,
 * capped at 5. Wording is supportive and process-focused —
 * never shaming, never an instruction to place a trade.
 */
export function buildImprovementPlan(input: ImprovementInputs): ImprovementPlan {
  const { tradesCount } = input;
  if (tradesCount < INTEL_MIN_TRADES) {
    return { status: "insufficient_data", tradesCount, actions: [] };
  }
  const actions: ImprovementAction[] = [];
  const { risk, drawdown, recurring, discipline, psychology, conditions } = input;

  if (risk.overLimitCount !== null && risk.overLimitCount > 0 && risk.riskLimitPct !== null) {
    actions.push({
      priority: 1,
      title: `Bring every trade back inside your ${pct(risk.riskLimitPct)}% per-trade risk limit`,
      detail:
        "Oversized risk is the fastest way a normal losing streak becomes a damaging one. " +
        "Size each position from the stop-loss distance so the planned risk stays at or under the limit.",
      evidence: `${risk.overLimitCount} of ${risk.withRiskCount} trades with a stop-loss planned more than the limit` +
        (risk.maxRiskPctOfCapital !== null
          ? `; the largest planned ${pct(risk.maxRiskPctOfCapital)}% of capital.`
          : "."),
    });
  }
  if (risk.dailyLossBreachDays !== null && risk.dailyLossBreachDays > 0 && risk.dailyLossLimit !== null) {
    actions.push({
      priority: 2,
      title: "Add a hard stop for the day when your daily loss limit is reached",
      detail:
        "A daily limit only protects you if trading actually stops when it is hit. " +
        "Write the stop rule into your plan's no-trade conditions and treat it as part of the strategy.",
      evidence: `${risk.dailyLossBreachDays} day${risk.dailyLossBreachDays === 1 ? "" : "s"} closed beyond your ${money(risk.dailyLossLimit)} daily loss limit` +
        (risk.worstDay ? `; the worst day was ${money(risk.worstDay.pnl)} on ${risk.worstDay.date}.` : "."),
    });
  }
  if (drawdown.status === "ok" && drawdown.currentDrawdown > 0 && drawdown.episode) {
    actions.push({
      priority: 3,
      title: "Work through the current drawdown with process, not size",
      detail:
        "Drawdowns are when revenge trades and size increases do the most damage. " +
        "Keep risk at or below your normal level and let the recovery come from your usual setups.",
      evidence: `Equity is ${money(drawdown.currentDrawdown)} below its peak` +
        (drawdown.episode.recovered
          ? `; the worst episode fell ${money(drawdown.maxDrawdown)} from ${drawdown.episode.peakDate} to ${drawdown.episode.troughDate} before recovering.`
          : `; the worst episode fell ${money(drawdown.maxDrawdown)} from ${drawdown.episode.peakDate} to ${drawdown.episode.troughDate} and has not fully recovered yet.`),
    });
  }
  const topMistake = recurring.mistakes[0];
  if (topMistake) {
    actions.push({
      priority: 4,
      title: `Fix one repeated mistake: "${topMistake.text}"`,
      detail:
        "Pick one concrete countermeasure for this mistake — a checklist line, an entry " +
        "condition, a pause rule — and write it into your trading plan before your next trade.",
      evidence: `Recorded ${topMistake.count} times across ${topMistake.tradesAffected} trades` +
        (topMistake.totalPnlImpact < 0
          ? `, which together lost ${money(Math.abs(topMistake.totalPnlImpact))}.`
          : "."),
    });
  }
  if (discipline.stopLoss.b.trades > 0) {
    actions.push({
      priority: 5,
      title: "Set a stop-loss on every trade",
      detail:
        "A trade without a stop-loss has no planned risk, so it cannot be sized or reviewed " +
        "in R. Making the stop part of the entry keeps every loss a known, planned size.",
      evidence: `${discipline.stopLoss.b.trades} of ${discipline.tradesCount} closed trades had no stop-loss` +
        ` (stop-loss set on ${pct(discipline.stopLossPct)}%); those trades totalled ${money(discipline.stopLoss.b.totalPnl)}.`,
    });
  }
  const worstEmotion = [...psychology.byEmotion]
    .filter((g) => g.trades >= GROUP_MIN_TRADES && g.totalPnl < 0)
    .sort((a, b) => a.totalPnl - b.totalPnl)[0];
  if (worstEmotion) {
    actions.push({
      priority: 6,
      title: `Add a no-trade condition for the "${worstEmotion.label}" state`,
      detail:
        "Your own journal links this state to your weakest results. A written pause rule — " +
        "step away, review the plan, return only when settled — turns that pattern into a checkpoint.",
      evidence: `${worstEmotion.trades} trades recorded as ${worstEmotion.label} totalled ${money(worstEmotion.totalPnl)}` +
        (worstEmotion.winRate !== null ? ` with a win rate of ${pct(worstEmotion.winRate)}%.` : "."),
    });
  }
  if (conditions.worst && conditions.worst.totalPnl < 0 && conditions.worst !== conditions.best) {
    actions.push({
      priority: 7,
      title: `Review your ${conditions.worst.label} trades before repeating them`,
      detail:
        "This is your weakest measured condition. Look at what those entries shared — " +
        "trigger, timing, exit — and decide whether the condition belongs in your plan at all.",
      evidence: `${conditions.worst.trades} trades totalled ${money(conditions.worst.totalPnl)}` +
        (conditions.worst.expectancy !== null
          ? ` (expectancy ${money(conditions.worst.expectancy)} per trade).`
          : "."),
    });
  }
  if (discipline.journalCompletionPct < 80 && discipline.tradesCount > 0) {
    actions.push({
      priority: 8,
      title: "Journal every trade the same day",
      detail:
        "Unjournaled trades are invisible to every analysis here, including this plan. " +
        "A two-minute same-day record — emotion, discipline, one lesson — is what makes the patterns visible.",
      evidence: `Journal completion is ${pct(discipline.journalCompletionPct)}% across ${discipline.tradesCount} closed trades.`,
    });
  }

  if (actions.length === 0) {
    return {
      status: "ok",
      tradesCount,
      actions: [
        {
          priority: 99,
          title: "Keep the routine that produced these results",
          detail:
            "No measured pattern in your data currently qualifies as a problem: risk stayed " +
            "inside its limits, no mistake repeats, and no group is dragging. Consistency is the plan.",
          evidence: `Based on ${tradesCount} closed trades with no qualifying risk, repetition or discipline signal.`,
        },
      ],
    };
  }
  return {
    status: "ok",
    tradesCount,
    actions: actions.sort((a, b) => a.priority - b.priority).slice(0, 5),
  };
}

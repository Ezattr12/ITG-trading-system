import type { SupabaseClient } from "@supabase/supabase-js";
import { getReportSummary } from "./queries";
import { periodBounds } from "./reports";
import type { BreakdownRow, ReportSummary } from "./types";
import {
  GROUP_MIN_TRADES,
  analyzeConditions,
  analyzeDiscipline,
  analyzeDrawdown,
  analyzePsychology,
  analyzeRecurring,
  analyzeRiskBehavior,
  type RiskContext,
} from "@/lib/intelligence/analysis";
import {
  getIntelligenceData,
  getMonthlyDigest,
  getWeeklyDigest,
  type IntelligenceData,
} from "@/lib/intelligence/queries";
import type {
  ConditionsAnalysis,
  DisciplineAnalysis,
  DrawdownAnalysis,
  PeriodDigest,
  PsychologyAnalysis,
  RecurringAnalysis,
  RiskBehaviorAnalysis,
} from "@/lib/intelligence/types";
import type { AiInsightRow } from "@/lib/coach/types";
import type { RiskEvent, RiskRules, TradingPlan } from "@/lib/risk/types";

/**
 * Report catalog (Phase 24) — a thin composition layer over
 * the existing engines. Each core takes the caller's RLS
 * client + userId (the house pattern) and assembles one
 * period report from:
 *
 * - the period `ReportSummary` (`getReportSummary` — the
 *   Phase 8 report engine, unchanged),
 * - the Phase 23 intelligence bundle sliced to the period,
 *   run through the existing pure analyzers unchanged,
 * - for the Coach report, the Phase 23 period digest and the
 *   stored `ai_insights` in range.
 *
 * Nothing here computes a P&L, risk or drawdown figure: this
 * layer only selects, slices and picks rows under the
 * engines' own sample minimums. A report with no closed
 * trades says so (`hasData: false`); a composed analysis
 * keeps its own `insufficient_data` status when its sample
 * is too small. No LLM is called and nothing is persisted.
 */

export type CatalogPeriod = "week" | "month";

export type CatalogReportKind =
  | "performance"
  | "psychology"
  | "risk"
  | "strategy"
  | "coach";

export const CATALOG_REPORT_KINDS: CatalogReportKind[] = [
  "performance",
  "psychology",
  "risk",
  "strategy",
  "coach",
];

export const CATALOG_REPORT_LABELS: Record<CatalogReportKind, string> = {
  performance: "Performance",
  psychology: "Psychology",
  risk: "Risk",
  strategy: "Strategy",
  coach: "Coach",
};

interface CatalogBase {
  period: CatalogPeriod;
  periodStart: string;
  periodEnd: string;
  /** False when the period has no closed trades at all. */
  hasData: boolean;
  summary: ReportSummary;
}

export interface PerformanceReport extends CatalogBase {
  kind: "performance";
  /** Drawdown over the period slice (curve restarts at the period start). */
  drawdown: DrawdownAnalysis;
}

export interface PsychologyReport extends CatalogBase {
  kind: "psychology";
  psychology: PsychologyAnalysis;
  discipline: DisciplineAnalysis;
}

export interface RiskReport extends CatalogBase {
  kind: "risk";
  risk: RiskBehaviorAnalysis;
  drawdown: DrawdownAnalysis;
  /** Active risk rules / plan values, verbatim (null when none configured). */
  rules: RiskRules | null;
  plan: TradingPlan | null;
  /** Stored risk events whose creation date falls in the period. */
  periodRiskEvents: RiskEvent[];
}

export interface StrategyReport extends CatalogBase {
  kind: "strategy";
  /** Strategy × session condition rows (≥3 trades each). */
  strategySessionRows: ConditionsAnalysis["rows"];
  conditions: ConditionsAnalysis;
  recurring: RecurringAnalysis;
  /**
   * Most / least profitable strategy among `summary.byStrategy`
   * rows with at least `GROUP_MIN_TRADES` trades — the
   * intelligence layer's group minimum. Null when no strategy
   * qualifies; the count is stated, never worked around.
   */
  bestStrategy: BreakdownRow | null;
  worstStrategy: BreakdownRow | null;
}

export interface CoachReport extends CatalogBase {
  kind: "coach";
  /** The Phase 23 digest for the same period (computed on read). */
  digest: PeriodDigest | null;
  /** Stored `ai_insights` whose period falls inside the range. */
  storedInsights: AiInsightRow[];
  /** Deterministic recommendations from the report engine. */
  recommendations: string[];
}

export type CatalogReport =
  | PerformanceReport
  | PsychologyReport
  | RiskReport
  | StrategyReport
  | CoachReport;

/* ------------------------------------------------------------- loading */

interface PeriodLoad {
  periodStart: string;
  periodEnd: string;
  summary: ReportSummary;
  data: IntelligenceData;
  /** The intelligence bundle sliced to the period. */
  slice: IntelligenceData;
}

function inPeriod(dateIso: string, start: string, end: string): boolean {
  const day = dateIso.slice(0, 10);
  return day >= start && day <= end;
}

function sliceData(
  data: IntelligenceData,
  periodStart: string,
  periodEnd: string,
): IntelligenceData {
  const trades = data.trades.filter((t) =>
    inPeriod(t.closedAt, periodStart, periodEnd),
  );
  const sliceIds = new Set(trades.map((t) => t.id));
  return {
    trades,
    lessons: data.lessons.filter(
      (l) => l.tradeId !== null && sliceIds.has(l.tradeId),
    ),
    rules: data.rules,
    plan: data.plan,
    capital: data.capital,
    riskEvents: data.riskEvents.filter((e) =>
      inPeriod(e.created_at, periodStart, periodEnd),
    ),
  };
}

function riskContext(slice: IntelligenceData, periodEnd: string): RiskContext {
  return {
    rules: slice.rules,
    plan: slice.plan,
    capital: slice.capital,
    riskEvents: slice.riskEvents,
    // The analyser's "last 30 days" event count is anchored
    // to the period end so a historical report describes its
    // own period (docs/phase-24.md).
    today: periodEnd,
  };
}

async function loadPeriod(
  supabase: SupabaseClient,
  userId: string,
  period: CatalogPeriod,
  anchor: string,
): Promise<PeriodLoad | null> {
  const bounds = periodBounds(period === "week" ? "weekly" : "monthly", anchor);
  if (!bounds) return null;
  const [summary, data] = await Promise.all([
    getReportSummary(supabase, userId, {
      type: period === "week" ? "weekly" : "monthly",
      periodStart: bounds.start,
      periodEnd: bounds.end,
    }),
    getIntelligenceData(supabase, userId),
  ]);
  return {
    periodStart: bounds.start,
    periodEnd: bounds.end,
    summary,
    data,
    slice: sliceData(data, bounds.start, bounds.end),
  };
}

function base(period: CatalogPeriod, load: PeriodLoad): CatalogBase {
  return {
    period,
    periodStart: load.periodStart,
    periodEnd: load.periodEnd,
    hasData: load.summary.tradesCount > 0,
    summary: load.summary,
  };
}

/* --------------------------------------------------------- report cores */

export async function getPerformanceReport(
  supabase: SupabaseClient,
  userId: string,
  period: CatalogPeriod,
  anchor: string,
): Promise<PerformanceReport | null> {
  const load = await loadPeriod(supabase, userId, period, anchor);
  if (!load) return null;
  return {
    ...base(period, load),
    kind: "performance",
    drawdown: analyzeDrawdown(load.slice.trades),
  };
}

export async function getPsychologyReport(
  supabase: SupabaseClient,
  userId: string,
  period: CatalogPeriod,
  anchor: string,
): Promise<PsychologyReport | null> {
  const load = await loadPeriod(supabase, userId, period, anchor);
  if (!load) return null;
  return {
    ...base(period, load),
    kind: "psychology",
    psychology: analyzePsychology(load.slice.trades),
    discipline: analyzeDiscipline(load.slice.trades),
  };
}

export async function getRiskReport(
  supabase: SupabaseClient,
  userId: string,
  period: CatalogPeriod,
  anchor: string,
): Promise<RiskReport | null> {
  const load = await loadPeriod(supabase, userId, period, anchor);
  if (!load) return null;
  return {
    ...base(period, load),
    kind: "risk",
    risk: analyzeRiskBehavior(
      load.slice.trades,
      riskContext(load.slice, load.periodEnd),
    ),
    drawdown: analyzeDrawdown(load.slice.trades),
    rules: load.data.rules,
    plan: load.data.plan,
    periodRiskEvents: load.slice.riskEvents,
  };
}

export async function getStrategyReport(
  supabase: SupabaseClient,
  userId: string,
  period: CatalogPeriod,
  anchor: string,
): Promise<StrategyReport | null> {
  const load = await loadPeriod(supabase, userId, period, anchor);
  if (!load) return null;
  const conditions = analyzeConditions(load.slice.trades);
  const qualifying = load.summary.byStrategy.filter(
    (r) => r.trades >= GROUP_MIN_TRADES,
  );
  const byPnl = [...qualifying].sort((a, b) => b.totalPnl - a.totalPnl);
  return {
    ...base(period, load),
    kind: "strategy",
    strategySessionRows: conditions.rows.filter(
      (r) => r.dimension === "strategy_session",
    ),
    conditions,
    recurring: analyzeRecurring(load.slice.trades, load.slice.lessons),
    bestStrategy: byPnl[0] ?? null,
    worstStrategy:
      byPnl.length > 1 ? byPnl[byPnl.length - 1] : null,
  };
}

export async function getCoachReport(
  supabase: SupabaseClient,
  userId: string,
  period: CatalogPeriod,
  anchor: string,
): Promise<CoachReport | null> {
  const load = await loadPeriod(supabase, userId, period, anchor);
  if (!load) return null;
  const [digest, insightRes] = await Promise.all([
    period === "week"
      ? getWeeklyDigest(supabase, userId, load.periodStart)
      : getMonthlyDigest(supabase, userId, load.periodStart),
    // The monthly digest's stored-insight range read, applied
    // to both grains so "in range" means one thing.
    supabase
      .from("ai_insights")
      .select("*")
      .eq("user_id", userId)
      .gte("period_start", load.periodStart)
      .lte("period_end", load.periodEnd)
      .order("generated_at", { ascending: false })
      .limit(10),
  ]);
  return {
    ...base(period, load),
    kind: "coach",
    digest,
    storedInsights: (insightRes.data ?? []) as AiInsightRow[],
    recommendations: load.summary.recommendations,
  };
}

/** Dispatch to the per-kind core. Null only for an invalid anchor date. */
export async function getCatalogReport(
  supabase: SupabaseClient,
  userId: string,
  kind: CatalogReportKind,
  period: CatalogPeriod,
  anchor: string,
): Promise<CatalogReport | null> {
  switch (kind) {
    case "performance":
      return getPerformanceReport(supabase, userId, period, anchor);
    case "psychology":
      return getPsychologyReport(supabase, userId, period, anchor);
    case "risk":
      return getRiskReport(supabase, userId, period, anchor);
    case "strategy":
      return getStrategyReport(supabase, userId, period, anchor);
    case "coach":
      return getCoachReport(supabase, userId, period, anchor);
  }
}

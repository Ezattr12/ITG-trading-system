import type { AnalyticTrade } from "@/lib/analytics/types";
import type { MarketCondition, TradeReason } from "@/lib/trades/types";

/**
 * Advanced Trading Intelligence types (Phase 23).
 *
 * Every analysis is computed from the trader's own stored
 * rows — trades, psychology records, lessons, risk rules,
 * risk events — by the pure functions in `analysis.ts`, over
 * aggregates produced by the existing engines
 * (`summarizeTrades`, `buildReportSummary`, `@itg/calc`).
 * Nothing here is an estimate: a figure that cannot be
 * measured from stored data is null, and an analysis whose
 * sample is too small says `insufficient_data` instead of
 * concluding.
 */

/**
 * One closed trade, enriched for intelligence work: the
 * analytics bundle's shape plus the stored fields the bundle
 * drops (setup, market condition, reason, leverage) and the
 * trade's planned risk in money — `calcRiskAmount` over the
 * stored entry / stop-loss / size, the same primitive the
 * trade engine used to compute the stored R multiple. Null
 * when the trade had no stop-loss: the risk is then unknown,
 * never estimated.
 */
export interface IntelTrade extends AnalyticTrade {
  setupName: string | null;
  marketCondition: MarketCondition | null;
  tradeReason: TradeReason | null;
  leverage: number;
  riskAmount: number | null;
}

/** One lesson row, reduced to what recurrence analysis needs. */
export interface IntelLesson {
  tradeId: string | null;
  text: string;
  repeatedMistake: boolean;
}

export type AnalysisStatus = "ok" | "insufficient_data";

/** Aggregates for one group of trades (from `summarizeTrades`). */
export interface GroupStat {
  key: string;
  label: string;
  trades: number;
  wins: number;
  losses: number;
  totalPnl: number;
  winRate: number | null;
  expectancy: number | null;
  avgR: number | null;
  profitFactor: number | null;
}

/* ------------------------------------------------------------- drawdown */

export interface DrawdownEpisode {
  /** Peak cumulative P&L at the start of the worst episode. */
  peakEquity: number;
  peakDate: string;
  troughDate: string;
  /** Calendar days from peak to trough. */
  daysToTrough: number;
  recovered: boolean;
  /** First date the curve returned to the peak, when recovered. */
  recoveryDate: string | null;
}

export interface UnderwaterRun {
  startDate: string;
  /** Recovery date, or the last trade's date while still underwater. */
  endDate: string;
  /** Closed trades spent below the running peak. */
  trades: number;
  days: number;
  recovered: boolean;
}

export interface DrawdownAnalysis {
  status: AnalysisStatus;
  tradesCount: number;
  totalPnl: number;
  /** Real equity/drawdown series (close-time order) for charting. */
  series: { date: string; equity: number; drawdown: number }[];
  /** Max drawdown in money (positive number), from `calcMaxDrawdown`. */
  maxDrawdown: number;
  /**
   * Max drawdown as a % of the peak cumulative profit it fell
   * from. The equity curve is cumulative P&L starting at 0
   * (starting capital is not stored), so this is honestly a
   * % of peak profit — never a % of account. Null when the
   * peak was not positive.
   */
  maxDrawdownPctOfPeak: number | null;
  episode: DrawdownEpisode | null;
  longestUnderwater: UnderwaterRun | null;
  currentDrawdown: number;
  currentDrawdownPctOfPeak: number | null;
  /** True when the latest point sits at the running peak. */
  atPeak: boolean;
}

/* -------------------------------------------------------- risk behaviour */

export interface RiskDistribution {
  count: number;
  avg: number;
  median: number;
  min: number;
  max: number;
}

export interface RiskBehaviorAnalysis {
  status: AnalysisStatus;
  tradesCount: number;
  /** Trades whose planned risk is measurable (stop-loss set). */
  withRiskCount: number;
  withoutStopLossCount: number;
  distribution: RiskDistribution | null;
  /** `profiles.trading_capital` when on file (> 0), else null. */
  capital: number | null;
  /** Average / max planned risk as % of capital. Null without capital. */
  avgRiskPctOfCapital: number | null;
  maxRiskPctOfCapital: number | null;
  /** The configured per-trade limit (rules first, plan fallback). */
  riskLimitPct: number | null;
  riskLimitSource: "rules" | "plan" | null;
  /** Why the limit check cannot run, when it cannot. */
  riskLimitNote: "no_limit_configured" | "capital_missing" | null;
  /** Trades whose planned risk exceeded the limit. Null when unmeasurable. */
  overLimitCount: number | null;
  withinLimitPct: number | null;
  /** Configured daily loss limit (rules first, plan fallback). */
  dailyLossLimit: number | null;
  daysTraded: number;
  worstDay: { date: string; pnl: number } | null;
  /** Days whose closed P&L fell below −limit. Null when no limit set. */
  dailyLossBreachDays: number | null;
  maxLeverageUsed: number | null;
  leverageLimit: number | null;
  leverageOverCount: number | null;
  maxConsecutiveLosses: number;
  currentStreak: number;
  /** Recent vs prior average planned risk (up to 20 trades a side). */
  trend: {
    recentAvg: number;
    priorAvg: number;
    recentCount: number;
    priorCount: number;
    /** % change of recent vs prior average (null when prior avg is 0). */
    deltaPct: number | null;
  } | null;
  riskEvents: {
    total: number;
    critical: number;
    warning: number;
    positive: number;
    last30Days: number;
  };
}

/* ------------------------------------------------------------ psychology */

export interface PsychologyAnalysis {
  status: AnalysisStatus;
  /** Closed trades carrying a psychology record. */
  recordedTrades: number;
  byEmotion: GroupStat[];
  byConfidence: GroupStat[];
  avgConfidence: number | null;
  /**
   * Plain-language relationship statement. Present ONLY when
   * both compared groups have ≥3 trades and their win rates
   * differ by ≥20 points — and phrased as association.
   */
  emotionStatement: string | null;
  confidenceStatement: string | null;
}

/* ------------------------------------------------------------ discipline */

export interface DisciplineSplit {
  a: GroupStat;
  b: GroupStat;
  /** Same honesty gate as psychology: ≥3 a side, ≥20-point win-rate gap. */
  statement: string | null;
}

export interface DisciplineAnalysis {
  status: AnalysisStatus;
  tradesCount: number;
  stopLossPct: number;
  journalCompletionPct: number;
  stopLoss: DisciplineSplit;
  /** Good vs average/poor ratings; null when no trade is rated. */
  rating: DisciplineSplit | null;
  journaled: DisciplineSplit;
}

/* ------------------------------------------------------------- recurring */

export interface RecurringMistake {
  text: string;
  count: number;
  /** Any occurrence carries the stored repeated-mistake flag. */
  flaggedRepeated: boolean;
  tradesAffected: number;
  losingTrades: number;
  /** Summed stored P&L of the distinct linked closed trades. */
  totalPnlImpact: number;
}

export interface LosingSetup {
  name: string;
  trades: number;
  losses: number;
  totalPnl: number;
  winRate: number | null;
}

export interface RecurringAnalysis {
  status: AnalysisStatus;
  totalLessons: number;
  mistakes: RecurringMistake[];
  losingSetups: LosingSetup[];
  /** Closed trades with no setup recorded (cannot be named). */
  unrecordedSetupTrades: number;
}

/* ------------------------------------------------------------ conditions */

export interface ConditionRow extends GroupStat {
  dimension: "session_direction" | "strategy_session" | "market_condition";
}

export interface ConditionsAnalysis {
  status: AnalysisStatus;
  /** Qualifying rows (≥3 trades), best P&L first. */
  rows: ConditionRow[];
  best: ConditionRow | null;
  worst: ConditionRow | null;
}

/* -------------------------------------------------------- improvement plan */

export interface ImprovementAction {
  /** Lower = addressed first. Follows the documented priority order. */
  priority: number;
  title: string;
  detail: string;
  /** The measured figure(s) the action rests on. */
  evidence: string;
}

export interface ImprovementPlan {
  status: AnalysisStatus;
  tradesCount: number;
  actions: ImprovementAction[];
}

/* ---------------------------------------------------------------- digests */

export interface DigestCoachFinding {
  title: string;
  recommendation: string;
}

export interface PeriodDigest {
  kind: "weekly" | "monthly";
  periodStart: string;
  periodEnd: string;
  status: AnalysisStatus;
  tradesCount: number;
  totalPnl: number;
  winRate: number | null;
  /** Rule-based recommendations from the period's report summary. */
  recommendations: string[];
  /** Within-period drawdown analysis (curve restarts at the period start). */
  drawdown: DrawdownAnalysis;
  psychology: PsychologyAnalysis;
  discipline: DisciplineAnalysis;
  recurring: RecurringAnalysis;
  /** Top improvement actions computed from the period slice (≤3). */
  focus: ImprovementAction[];
  /** Coach findings: engine insights (week) or stored insights (month). */
  coachFindings: DigestCoachFinding[];
}

/* --------------------------------------------------------------- overview */

export interface IntelligenceOverview {
  tradesCount: number;
  drawdown: DrawdownAnalysis;
  risk: RiskBehaviorAnalysis;
  psychology: PsychologyAnalysis;
  discipline: DisciplineAnalysis;
  recurring: RecurringAnalysis;
  conditions: ConditionsAnalysis;
  plan: ImprovementPlan;
  weeklyDigest: PeriodDigest;
  monthlyDigest: PeriodDigest;
}

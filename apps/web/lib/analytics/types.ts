import type { DisciplineRating, Emotion, TradingSession } from "@/lib/trades/types";

/**
 * Analytics input types (Phase 4, spec §17–18, §28, §31).
 *
 * An AnalyticTrade is one closed trade with the display data the
 * breakdowns need. It is built from real rows in the `trades`
 * table (plus psychology / strategy / lesson / screenshot joins)
 * by `lib/analytics/queries.ts` — never from demo or invented data.
 * Open trades are excluded: they have no P&L yet.
 */
export interface AnalyticTrade {
  id: string;
  pair: string;
  direction: "long" | "short";
  session: TradingSession | null;
  strategyName: string | null;
  pnl: number;
  rMultiple: number | null;
  closedAt: string;
  openedAt: string;
  emotion: Emotion | null;
  discipline: DisciplineRating | null;
  confidence: number | null;
  /** Journaled = has a psychology record or a lesson. */
  journaled: boolean;
  /** A stop-loss was set on the trade (risk discipline proxy, Phase 5 adds rule checks). */
  stopLossSet: boolean;
}

export interface TradeSummary {
  tradeCount: number;
  totalPnl: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number | null;
  lossRate: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  avgR: number | null;
  maxDrawdown: number;
  currentStreak: number;
}

export interface EquityPoint {
  /** ISO date of the trade's close. */
  date: string;
  /** Cumulative P&L after this trade. Starts at 0 before the first trade. */
  equity: number;
  /** Drawdown from the running peak at this point. */
  drawdown: number;
  trades: number;
}

export interface PeriodPnl {
  /** Bucket label: YYYY-MM-DD (day), YYYY-MM-DD of the Monday (week), YYYY-MM (month). */
  label: string;
  pnl: number;
  trades: number;
  wins: number;
}

export interface BreakdownRow {
  key: string;
  label: string;
  trades: number;
  pnl: number;
  winRate: number | null;
  avgR: number | null;
  avgWin: number | null;
  avgLoss: number | null;
}

export interface PsychologyRow {
  emotion: Emotion;
  trades: number;
  pnl: number;
  winRate: number | null;
}

export interface PsychologySummary {
  byEmotion: PsychologyRow[];
  avgConfidence: number | null;
  /** Share of closed trades rated discipline "good". Null with no discipline data. */
  goodDisciplinePct: number | null;
  /** Share of closed trades with a stop-loss set. */
  stopLossPct: number;
  /** Share of closed trades that are journaled. */
  journalCompletionPct: number;
}

export interface GoalProgressView {
  id: string;
  title: string;
  period: string;
  targetValue: number;
  currentValue: number;
  percent: number;
  status: string;
}

export interface XpHistoryPoint {
  date: string;
  xp: number;
  cumulativeXp: number;
}

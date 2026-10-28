import type { DisciplineRating, Emotion, TradingSession } from "@/lib/trades/types";

/**
 * Report types (Phase 8, spec §27).
 *
 * A report is a summary computed from the trader's real stored
 * trades, psychology, lessons and goals for a period — never
 * from invented data. Every aggregate is null (shown as "—")
 * when there is nothing to measure, never a fabricated zero.
 */

export type ReportType = "daily" | "weekly" | "monthly";

export const REPORT_TYPES: ReportType[] = ["daily", "weekly", "monthly"];

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

/** One closed trade, reduced to what a report needs. */
export interface ReportTrade {
  id: string;
  pair: string;
  direction: "long" | "short";
  session: TradingSession | null;
  strategyName: string | null;
  pnl: number;
  rMultiple: number | null;
  closedAt: string;
  emotion: Emotion | null;
  discipline: DisciplineRating | null;
  journaled: boolean;
  stopLossSet: boolean;
}

export interface ReportLesson {
  tradeId: string;
  text: string;
  repeatedMistake: boolean;
}

export interface BreakdownRow {
  name: string;
  trades: number;
  wins: number;
  totalPnl: number;
  winRate: number | null;
}

export interface ReportSummary {
  type: ReportType;
  periodStart: string;
  periodEnd: string;
  tradesCount: number;
  wins: number;
  losses: number;
  breakeven: number;
  totalPnl: number;
  winRate: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  avgR: number | null;
  journalCompletionPct: number | null;
  disciplinePct: number | null;
  goalsCompleted: number;
  goalsTotal: number;
  byStrategy: BreakdownRow[];
  bySession: BreakdownRow[];
  byEmotion: BreakdownRow[];
  /** Most frequent losing setup, or null when none can be named. */
  mostFrequentLosingSetup: { name: string; losses: number } | null;
  /** Most repeated lesson text, or null when no lesson repeats. */
  mostRepeatedMistake: { text: string; count: number } | null;
  /** Rule-based recommendations from this trader's own data only. */
  recommendations: string[];
}

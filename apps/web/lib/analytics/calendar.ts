import type { AnalyticTrade } from "./types";

/**
 * Trading calendar aggregation (Phase 4, spec §31).
 *
 * Pure functions over real trades + daily_activity rows. A day is a
 * "trading day" only if the trader actually closed a trade that day
 * — days with no trades are shown blank, never as zero-P&L days.
 */

export interface CalendarDay {
  /** YYYY-MM-DD */
  date: string;
  trades: number;
  pnl: number;
  wins: number;
  /** Share of the day's trades that are journaled (psychology or lesson). */
  journalCompletionPct: number;
  /** Share of the day's trades rated discipline "good" (null = no data). */
  goodDisciplinePct: number | null;
  /** Journal was marked complete in daily_activity (null = no row that day). */
  journalCompleted: boolean | null;
  /** Study hours recorded that day (null = no row that day). */
  studyHours: number | null;
}

export interface DailyActivityRow {
  activity_date: string;
  journal_completed: boolean;
  study_hours: number;
}

export function aggregateCalendarDays(
  trades: readonly AnalyticTrade[],
  activity: readonly DailyActivityRow[],
): Map<string, CalendarDay> {
  const days = new Map<string, CalendarDay>();
  for (const t of trades) {
    const date = t.closedAt.slice(0, 10);
    const day = days.get(date) ?? {
      date,
      trades: 0,
      pnl: 0,
      wins: 0,
      journalCompletionPct: 0,
      goodDisciplinePct: null,
      journalCompleted: null,
      studyHours: null,
    };
    day.trades += 1;
    day.pnl += t.pnl;
    if (t.pnl > 0) day.wins += 1;
    days.set(date, day);
  }
  // Journal completion + discipline per day, from the trades themselves.
  for (const day of days.values()) {
    const dayTrades = trades.filter((t) => t.closedAt.slice(0, 10) === day.date);
    day.journalCompletionPct =
      dayTrades.length === 0
        ? 0
        : (dayTrades.filter((t) => t.journaled).length / dayTrades.length) * 100;
    const withDiscipline = dayTrades.filter((t) => t.discipline !== null);
    day.goodDisciplinePct =
      withDiscipline.length === 0
        ? null
        : (withDiscipline.filter((t) => t.discipline === "good").length / withDiscipline.length) * 100;
  }
  for (const row of activity) {
    const day = days.get(row.activity_date) ?? {
      date: row.activity_date,
      trades: 0,
      pnl: 0,
      wins: 0,
      journalCompletionPct: 0,
      goodDisciplinePct: null,
      journalCompleted: null,
      studyHours: null,
    };
    day.journalCompleted = row.journal_completed;
    day.studyHours = row.study_hours;
    days.set(row.activity_date, day);
  }
  return days;
}

export interface CalendarCell {
  /** Day of month, or null for a blank cell before the 1st. */
  day: number | null;
  date: string | null;
  data: CalendarDay | null;
}

/** Month grid: rows of 7 cells starting Monday, for `year`/`month` (1–12). */
export function buildMonthGrid(
  year: number,
  month: number,
  days: ReadonlyMap<string, CalendarDay>,
): CalendarCell[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // Monday-first: JS getUTCDay 0=Sunday → offset (day+6)%7
  const offset = (first.getUTCDay() + 6) % 7;
  const cells: CalendarCell[] = [];
  for (let i = 0; i < offset; i += 1) cells.push({ day: null, date: null, data: null });
  for (let d = 1; d <= daysInMonth; d += 1) {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ day: d, date, data: days.get(date) ?? null });
  }
  while (cells.length % 7 !== 0) cells.push({ day: null, date: null, data: null });
  const weeks: CalendarCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Clamp a YYYY-MM month string to a valid year/month, defaulting to the current month. */
export function parseMonthParam(value: string | undefined | null): { year: number; month: number } {
  const now = new Date();
  const fallback = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
  if (!value) return fallback;
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return fallback;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return fallback;
  return { year, month };
}

/** YYYY-MM of the previous / next month. */
export function shiftMonth(year: number, month: number, delta: -1 | 1): string {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

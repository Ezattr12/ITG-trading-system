import { randomBytes } from "node:crypto";
import type {
  CertificateCriterionKey,
  CertificateEligibility,
  CriterionResult,
} from "./types";
import {
  CERTIFICATE_CRITERIA,
  CERTIFICATE_CRITERION_LABELS,
} from "./types";

/**
 * Monthly certificate eligibility (Phase 8, spec §26).
 *
 * Pure functions only: no I/O, no Supabase, no "now" hidden
 * inside — callers pass the month's real aggregates. A
 * certificate is issued only when EVERY criterion is met; a
 * single missing criterion blocks issuance, and the page shows
 * exactly which criteria are missing — never a certificate for
 * unmet criteria, never a fabricated one.
 *
 * Thresholds (documented here and in docs/phase-8.md; they are
 * the product rule, not a guess at the trader's data):
 * - journaling: at least 5 closed trades in the month, and at
 *   least 80% of them journaled (psychology record or lesson).
 * - risk_discipline: at least 90% of closed trades disciplined
 *   (stop-loss set, leverage within the configured maximum when
 *   one exists) AND zero CRITICAL risk events in the month.
 * - routine: active on at least 8 distinct days in the month,
 *   spread over at least 2 distinct weeks.
 * - review: at least one completed weekly review whose week
 *   overlaps the month.
 *
 * A month with no closed trades meets none of the criteria —
 * 0 trades is not 100% of anything.
 */

/** Real aggregates for one month, assembled by `queries.ts`. */
export interface MonthlyCertificateInputs {
  /** First day of the month, YYYY-MM-DD. */
  month: string;
  tradesCount: number;
  journaledTrades: number;
  disciplinedTrades: number;
  criticalBreaches: number;
  /** Distinct days with trading/journal activity in the month. */
  activeDays: number;
  /** Distinct ISO weeks with activity in the month. */
  activeWeeks: number;
  /** Completed weekly reviews overlapping the month. */
  completedWeeklyReviews: number;
}

export const MIN_MONTH_TRADES = 5;
export const MIN_JOURNAL_PCT = 80;
export const MIN_DISCIPLINE_PCT = 90;
export const MIN_ACTIVE_DAYS = 8;
export const MIN_ACTIVE_WEEKS = 2;
export const MIN_WEEKLY_REVIEWS = 1;

/**
 * Exact percentage — deliberately NOT rounded. A threshold of
 * "at least 80%" means 79.6% fails: rounding first (as this
 * function did before Phase 12) let 39 of 49 trades (79.59%)
 * pass an 80% rule. Display strings round for readability;
 * the pass/fail comparison always uses the exact value.
 */
function pct(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return (part / whole) * 100;
}

/** Whole-number percentage for display only — never for comparison. */
function displayPct(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}`;
}

function criterion(
  key: CertificateCriterionKey,
  met: boolean,
  detail: string,
): CriterionResult {
  return { key, label: CERTIFICATE_CRITERION_LABELS[key], met, detail };
}

/** Evaluate every criterion for a month. Never throws on empty input. */
export function evaluateMonthlyEligibility(
  input: MonthlyCertificateInputs,
): CertificateEligibility {
  const journalPct = pct(input.journaledTrades, input.tradesCount);
  const disciplinePct = pct(input.disciplinedTrades, input.tradesCount);

  const journaling = criterion(
    "journaling",
    input.tradesCount >= MIN_MONTH_TRADES &&
      journalPct !== null &&
      journalPct >= MIN_JOURNAL_PCT,
    input.tradesCount === 0
      ? "No closed trades this month yet."
      : `${input.journaledTrades} of ${input.tradesCount} trades journaled (${displayPct(journalPct)}%) — need at least ${MIN_JOURNAL_PCT}% of at least ${MIN_MONTH_TRADES} trades.`,
  );

  const riskDiscipline = criterion(
    "risk_discipline",
    input.tradesCount >= MIN_MONTH_TRADES &&
      disciplinePct !== null &&
      disciplinePct >= MIN_DISCIPLINE_PCT &&
      input.criticalBreaches === 0,
    input.tradesCount === 0
      ? "No closed trades this month yet."
      : input.criticalBreaches > 0
        ? `${input.criticalBreaches} critical risk breach${input.criticalBreaches === 1 ? "" : "es"} this month — a clean month is required.`
        : `${input.disciplinedTrades} of ${input.tradesCount} trades disciplined (${displayPct(disciplinePct)}%) — need at least ${MIN_DISCIPLINE_PCT}% with a stop-loss set and leverage within limits.`,
  );

  const routine = criterion(
    "routine",
    input.activeDays >= MIN_ACTIVE_DAYS &&
      input.activeWeeks >= MIN_ACTIVE_WEEKS,
    `${input.activeDays} active day${input.activeDays === 1 ? "" : "s"} across ${input.activeWeeks} week${input.activeWeeks === 1 ? "" : "s"} — need at least ${MIN_ACTIVE_DAYS} days in at least ${MIN_ACTIVE_WEEKS} weeks.`,
  );

  const review = criterion(
    "review",
    input.completedWeeklyReviews >= MIN_WEEKLY_REVIEWS,
    input.completedWeeklyReviews === 0
      ? "No completed weekly review this month yet — write one from the Weekly Review page."
      : `${input.completedWeeklyReviews} completed weekly review${input.completedWeeklyReviews === 1 ? "" : "s"} this month.`,
  );

  const criteria = [journaling, riskDiscipline, routine, review];
  return {
    month: input.month,
    eligible: criteria.every((c) => c.met),
    criteria,
  };
}

/** Evidence stored on the certificate row (`criteria_met` jsonb). */
export function eligibilityToCriteriaMet(
  eligibility: CertificateEligibility,
  input: MonthlyCertificateInputs,
): Record<string, unknown> {
  return {
    month: eligibility.month,
    trades_count: input.tradesCount,
    journaled_trades: input.journaledTrades,
    journal_completion_pct:
      input.tradesCount > 0
        ? Math.round((input.journaledTrades / input.tradesCount) * 100)
        : null,
    disciplined_trades: input.disciplinedTrades,
    discipline_pct:
      input.tradesCount > 0
        ? Math.round((input.disciplinedTrades / input.tradesCount) * 100)
        : null,
    critical_breaches: input.criticalBreaches,
    active_days: input.activeDays,
    active_weeks: input.activeWeeks,
    completed_weekly_reviews: input.completedWeeklyReviews,
    criteria: Object.fromEntries(
      eligibility.criteria.map((c) => [c.key, c.met]),
    ),
  };
}

/**
 * Unique certificate ID: `ITG-YYYYMM-XXXXXX` (6 chars A–F/0–9).
 * The caller may pass a fixed suffix in tests; production uses
 * `crypto.randomBytes`. Uniqueness is also enforced by the
 * database (`certificate_id` unique, `user_id + month` unique),
 * so a collision is retried by the issuing action, never
 * silently issued twice for the same month.
 */
export function generateCertificateId(
  month: string,
  randomSuffix?: string,
): string {
  const compact = month.replace(/-/g, "").slice(0, 6);
  const suffix =
    randomSuffix ??
    randomBytes(3).toString("hex").toUpperCase().slice(0, 6);
  return `ITG-${compact}-${suffix}`;
}

/** First day of a month (YYYY-MM-01) from a YYYY-MM value. */
export function monthStart(month: string): string {
  const m = month.trim();
  if (/^\d{4}-\d{2}$/.test(m)) return `${m}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(m)) return m.slice(0, 8) + "01";
  return "";
}

/** Month label for display, e.g. "October 2026". */
export function monthLabel(month: string): string {
  const start = monthStart(month);
  if (!start) return month;
  const d = new Date(`${start}T00:00:00Z`);
  return d.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export { CERTIFICATE_CRITERIA };

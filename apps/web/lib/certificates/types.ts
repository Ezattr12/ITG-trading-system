/**
 * Certificate types (Phase 8, spec §26).
 *
 * These mirror the Phase 1 `certificates` table (migration 0009)
 * exactly. A certificate is issued only when the month's
 * requirements are met — see `eligibility.ts` for the checks.
 * `criteria_met` is the evidence (percentages and counts from
 * the trader's real stored data), never a hand-waved claim.
 */

export type CertificateCriterionKey =
  | "journaling"
  | "risk_discipline"
  | "routine"
  | "review";

export const CERTIFICATE_CRITERIA: CertificateCriterionKey[] = [
  "journaling",
  "risk_discipline",
  "routine",
  "review",
];

export const CERTIFICATE_CRITERION_LABELS: Record<
  CertificateCriterionKey,
  string
> = {
  journaling: "Consistent journaling",
  risk_discipline: "Risk discipline",
  routine: "Trading routine",
  review: "Performance review",
};

export interface CertificateRow {
  id: string;
  user_id: string;
  certificate_id: string;
  /** First day of the month, YYYY-MM-DD. */
  month: string;
  criteria_met: Record<string, unknown>;
  pdf_path: string | null;
  status: "pending" | "issued" | "revoked";
  issued_at: string | null;
  created_at: string;
  updated_at: string;
}

/** One criterion's check result, with the evidence shown to the trader. */
export interface CriterionResult {
  key: CertificateCriterionKey;
  label: string;
  met: boolean;
  /** Human-readable evidence, e.g. "17 of 20 trades journaled (85%)". */
  detail: string;
}

export interface CertificateEligibility {
  /** First day of the month, YYYY-MM-DD. */
  month: string;
  eligible: boolean;
  criteria: CriterionResult[];
}

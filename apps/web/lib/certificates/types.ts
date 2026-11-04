/**
 * Certificate types (Phase 8, spec §26; Task 24).
 *
 * These mirror the `certificates` table (migration 0009,
 * extended by 0022). Two kinds share the table:
 *
 * - "monthly" — the Performance Certificate, issued only when
 *   the month's requirements are met (see `eligibility.ts`).
 *   `criteria_met` is the evidence (percentages and counts from
 *   the trader's real stored data), never a hand-waved claim.
 * - "level" (Task 24) — issued for one PASSED level assessment
 *   (Task 23's `level_assessments`, verdict = 'pass'). It
 *   certifies the historical fact that the trader WAS assessed
 *   at the band on the assessment date — never a claim about
 *   their current standing. The evidence ref (assessment id)
 *   and the snapshot (slug, name, assessed date, score) live on
 *   the row itself, so the certificate and its verification
 *   never depend on mutable state.
 */

export type CertificateKind = "monthly" | "level";

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
  /**
   * Which kind of certificate this row is. Rows written before
   * migration 0022 (or read from an unmigrated database) have no
   * `kind` — readers treat a missing kind as "monthly".
   */
  kind: CertificateKind;
  /**
   * First day of the month, YYYY-MM-DD. Monthly certificates
   * only — null for level certificates, which have no month.
   */
  month: string | null;
  criteria_met: Record<string, unknown>;
  pdf_path: string | null;
  status: "pending" | "issued" | "revoked";
  issued_at: string | null;
  created_at: string;
  updated_at: string;
  /** Level certificates: the pass assessment row this certifies. */
  assessment_id: string | null;
  /** Level certificates: band identity snapshots at issuance. */
  level_slug: string | null;
  level_name: string | null;
  /** Level certificates: when the assessment was recorded. */
  assessed_at: string | null;
  /** Level certificates: the score in the pass snapshot. */
  assessment_score: number | null;
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

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CertificateKind } from "./types";

/**
 * Public certificate verification (Task 24).
 *
 * A certificate is only worth anything if a third party can
 * check it. This read backs the signed-out /verify/<id> page:
 * it runs through the SERVICE-ROLE client (certificates are
 * RLS select-own-or-admin — there is deliberately no anonymous
 * read policy, so nothing about the table is enumerable through
 * PostgREST) and returns a WHITELISTED shape built field by
 * field from the stored row:
 *
 * - the certificate id itself, its kind and its status;
 * - the holder's display name as stored on their profile (the
 *   name the certificate itself carries);
 * - what it certifies — the month (monthly) or the band and
 *   assessed date (level) — and the issue date.
 *
 * It never returns the user id, an email, the criteria
 * evidence, trade data or P&L: the page can only ever show what
 * the certificate itself states. An unknown id returns
 * `found: false` with every other field null, so the page's
 * "not verified" answer is identical for a mistyped id and a
 * fabricated one.
 */
export interface CertificateVerification {
  found: boolean;
  certificateId: string;
  status: "pending" | "issued" | "revoked" | null;
  kind: CertificateKind | null;
  /** Holder's display name as stored (null if not provided). */
  traderName: string | null;
  /** Monthly certificates: the certified month, YYYY-MM-DD. */
  month: string | null;
  /** Level certificates: band display-name snapshot. */
  levelName: string | null;
  /** Level certificates: when the pass was assessed (ISO). */
  assessedAt: string | null;
  issuedAt: string | null;
}

const NOT_FOUND: Omit<CertificateVerification, "certificateId"> = {
  found: false,
  status: null,
  kind: null,
  traderName: null,
  month: null,
  levelName: null,
  assessedAt: null,
  issuedAt: null,
};

export async function getCertificateVerification(
  admin: SupabaseClient,
  certificateId: string,
): Promise<CertificateVerification> {
  const id = certificateId.trim();
  if (!id) return { certificateId: id, ...NOT_FOUND };

  const { data: cert } = await admin
    .from("certificates")
    .select(
      "certificate_id, user_id, kind, month, status, issued_at, level_name, assessed_at",
    )
    .eq("certificate_id", id)
    .maybeSingle();
  if (!cert) return { certificateId: id, ...NOT_FOUND };

  const row = cert as {
    user_id: string;
    kind: CertificateKind | null;
    month: string | null;
    status: "pending" | "issued" | "revoked";
    issued_at: string | null;
    level_name: string | null;
    assessed_at: string | null;
  };

  const { data: profile } = await admin
    .from("profiles")
    .select("full_name")
    .eq("id", row.user_id)
    .maybeSingle();
  const fullName = (profile as { full_name: string | null } | null)?.full_name;

  return {
    found: true,
    certificateId: id,
    status: row.status,
    // Rows predating migration 0022 carry no kind — monthly.
    kind: row.kind ?? "monthly",
    traderName: fullName?.trim() ? fullName : null,
    month: row.month,
    levelName: row.level_name,
    assessedAt: row.assessed_at,
    issuedAt: row.issued_at,
  };
}

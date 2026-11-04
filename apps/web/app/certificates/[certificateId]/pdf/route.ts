import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getCertificateById } from "@/lib/certificates/queries";
import { buildCertificatePdf, buildLevelCertificatePdf } from "@/lib/certificates/pdf";
import { monthLabel } from "@/lib/certificates/eligibility";
import type { CriterionResult } from "@/lib/certificates/types";
import { CERTIFICATE_CRITERION_LABELS } from "@/lib/certificates/types";

/**
 * Certificate PDF download (Phase 8, spec §26).
 *
 * The PDF is generated on demand from the stored certificate
 * record — it is NOT stored in Supabase Storage in this phase
 * (that is the Phase 13 step). Only an issued certificate
 * belonging to the signed-in trader can be downloaded; anything
 * else is a 404. Every value on the PDF comes from the stored
 * certificate row: the monthly `criteria_met` evidence, or the
 * level certificate's issuance snapshot (Task 24).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ certificateId: string }> },
) {
  const { certificateId } = await params;
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase is not connected yet." },
      { status: 503 },
    );
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please log in first." }, { status: 401 });

  const supabase = await createServerSupabaseClient();
  const certificate = await getCertificateById(
    supabase,
    user.id,
    decodeURIComponent(certificateId),
  );
  if (!certificate || certificate.status !== "issued") {
    return NextResponse.json(
      { error: "Certificate not found." },
      { status: 404 },
    );
  }

  const traderName =
    user.profile?.full_name?.trim() || user.email || "ITG Trader";
  const pdfResponse = (pdf: Buffer) =>
    new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${certificate.certificate_id}.pdf"`,
        "Content-Length": String(pdf.length),
      },
    });

  // Level certificates (Task 24) render from the row's issuance
  // snapshot — band, assessed date and score were copied onto
  // the certificate at issuance, so the document can never be
  // rewritten by a later band rename or threshold edit.
  if (certificate.kind === "level") {
    const pdf = await buildLevelCertificatePdf({
      traderName,
      certificateId: certificate.certificate_id,
      levelName: certificate.level_name ?? "Level",
      assessedAt: certificate.assessed_at ?? certificate.issued_at ?? "",
      score: Number(certificate.assessment_score ?? 0),
      issuedAt: certificate.issued_at,
    });
    return pdfResponse(pdf);
  }

  const met = (certificate.criteria_met ?? {}) as Record<string, unknown>;
  const num = (key: string): number | null => {
    const v = met[key];
    return typeof v === "number" ? v : null;
  };
  const criteria: CriterionResult[] = (
    Object.keys(CERTIFICATE_CRITERION_LABELS) as (keyof typeof CERTIFICATE_CRITERION_LABELS)[]
  ).map((key) => {
    const detail =
      key === "journaling"
        ? `${num("journaled_trades") ?? 0} of ${num("trades_count") ?? 0} trades journaled (${num("journal_completion_pct") ?? "—"}%)`
        : key === "risk_discipline"
          ? `${num("discipline_pct") ?? "—"}% of trades disciplined, ${num("critical_breaches") ?? 0} critical breaches`
          : key === "routine"
            ? `${num("active_days") ?? 0} active days across ${num("active_weeks") ?? 0} weeks`
            : `${num("completed_weekly_reviews") ?? 0} completed weekly reviews`;
    const criteriaMap = (met.criteria ?? {}) as Record<string, unknown>;
    return {
      key,
      label: CERTIFICATE_CRITERION_LABELS[key],
      met: criteriaMap[key] === true,
      detail,
    };
  });

  const pdf = await buildCertificatePdf({
    traderName,
    certificateId: certificate.certificate_id,
    monthLabel: monthLabel(certificate.month ?? ""),
    criteria,
    issuedAt: certificate.issued_at,
  });

  return pdfResponse(pdf);
}

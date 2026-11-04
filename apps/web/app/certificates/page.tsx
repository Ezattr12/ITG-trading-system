import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AppShell } from "@/components/app-shell";
import { IssueCertificateForm } from "@/components/certificates/issue-certificate-form";
import { IssueLevelCertificateForm } from "@/components/certificates/issue-level-certificate-form";
import { getCertificates, getMonthlyEligibility, getPassAssessments } from "@/lib/certificates/queries";
import { monthLabel } from "@/lib/certificates/eligibility";

export const metadata = { title: "Certificates — ITG TraderOS" };

/**
 * Certificates page (Phase 8, spec §26; Task 24).
 *
 * A monthly ITG Performance Certificate is issued only when the
 * month's requirements are met — consistent journaling, risk
 * discipline, trading routine, performance review — checked
 * against the trader's real stored data. When requirements are
 * not met, the page shows exactly which criteria are missing.
 * Issued certificates download as a PDF generated on demand
 * from the stored certificate record.
 *
 * Task 24 adds level certificates: one per PASSED level
 * assessment (Task 23), certifying the historical fact of the
 * pass — band and assessed date snapshotted at issuance. The
 * section below the monthly panel lists uncertified passes
 * with their issue buttons, or the honest state when no
 * assessment has passed yet.
 *
 * Master Web UI Redesign (Task 4 sweep) — PRESENTATION ONLY:
 * the page moved onto the v2 system (flat header band with
 * eyebrow + .itg2-page-title, the eligibility panel as the
 * .itg2-hero, criteria markers in the semantic text colours
 * over a v2 hairline divider, issued rows as .itg2-card with
 * .itg2-chip status variants and the PDF download as
 * .itg2-link). The v1 per-state hero glows (emerald / amber /
 * blue) were retired with the rest of the glow props: the
 * hero keeps the one v2 treatment and the state stays
 * carried by the criteria list and the status copy, exactly
 * as before. All data, eligibility logic, copy and empty
 * states are exactly as before.
 */
export default async function CertificatesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.onboarding?.is_complete) redirect("/onboarding");

  const configured = isSupabaseConfigured();
  const now = new Date();
  const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;

  let certificates = [] as Awaited<ReturnType<typeof getCertificates>>;
  let eligibility = null as Awaited<
    ReturnType<typeof getMonthlyEligibility>
  > | null;
  let passes = [] as Awaited<ReturnType<typeof getPassAssessments>>;
  if (configured) {
    const supabase = await createServerSupabaseClient();
    certificates = await getCertificates(supabase, user.id);
    eligibility = await getMonthlyEligibility(supabase, user.id, currentMonth);
    passes = await getPassAssessments(supabase, user.id);
  }

  const alreadyIssued = certificates.some(
    (c) => c.month === currentMonth && c.status === "issued",
  );

  // Level certificates (Task 24): one per PASSED assessment.
  // A pass that already has a certificate appears in the issued
  // list below; only uncertified passes offer issuance here.
  const certifiedAssessmentIds = new Set(
    certificates
      .map((c) => c.assessment_id)
      .filter((id): id is string => typeof id === "string"),
  );
  const uncertifiedPasses = passes.filter(
    (p) => !certifiedAssessmentIds.has(p.id),
  );

  return (
    <AppShell email={user.email}>
        <header className="itg2-card itg2-card-flat p-5 sm:p-6">
          <p className="itg2-eyebrow">Certificates</p>
          <h1 className="itg2-page-title mt-1">Certificates</h1>
          <p className="mt-2 text-muted-foreground">
            A monthly ITG Performance Certificate is earned, not bought — it is
            issued only when the month&apos;s journaling, risk discipline,
            routine and review requirements are all met.
          </p>
        </header>

        <section className="itg2-hero mt-6 sm:mt-8">
          <div className="itg2-hero-inner p-4 sm:p-6">
          <h2 className="itg2-section-title">
            {monthLabel(currentMonth)} — eligibility
          </h2>
          {!configured || !eligibility ? (
            <p className="mt-2 text-muted-foreground">
              Supabase is not connected yet — eligibility will be checked
              against your real trades once the database is connected. Nothing
              here is estimated.
            </p>
          ) : (
            <>
              <ul className="mt-4 divide-y divide-[rgba(120,175,255,0.08)]">
                {eligibility.criteria.map((c) => (
                  <li key={c.key} className="flex items-start gap-2 py-2 text-sm">
                    <span aria-hidden className={c.met ? "itg2-text-profit" : "text-muted-foreground"}>{c.met ? "✓" : "○"}</span>
                    <span>
                      <span className="font-medium">{c.label}</span>
                      <span className="text-muted-foreground"> — {c.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-4">
                {alreadyIssued ? (
                  <p className="text-sm itg2-text-profit">
                    Certificate already issued for this month — see below to
                    download it.
                  </p>
                ) : eligibility.eligible ? (
                  <IssueCertificateForm month={currentMonth} />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Complete the missing criteria above and the certificate
                    will be available to issue.
                  </p>
                )}
              </div>
            </>
          )}
          </div>
        </section>

        <section className="itg2-card mt-6 sm:mt-8 p-4 sm:p-6" aria-label="Level certificates">
          <h2 className="itg2-section-title">Level certificates</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            A level certificate is issued for a passed level assessment — the
            stricter judgement on the Levels page that also requires enough
            measured dimensions, dimension floors and a confirmation period.
            It records that you were assessed at that band on that date; it
            does not claim your current level, and it is an ITG-internal
            credential, not an external qualification.
          </p>
          {!configured ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Supabase is not connected yet — passed assessments will be
              checked against your real record once the database is
              connected. Nothing here is estimated.
            </p>
          ) : passes.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              No passed assessments yet — level certificates become available
              when an assessment passes. See the Levels page for your current
              assessment and what it still requires.
            </p>
          ) : uncertifiedPasses.length === 0 ? (
            <p className="mt-3 text-sm itg2-text-profit">
              Every passed assessment already has its certificate — see the
              issued certificates below.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {uncertifiedPasses.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-t border-[rgba(120,175,255,0.08)] pt-3"
                >
                  <div>
                    <p className="font-medium">
                      <span className="itg2-text-gold">{p.level_name}</span>
                      <span className="text-muted-foreground">
                        {" "}— assessed {p.created_at.slice(0, 10)} · score{" "}
                      </span>
                      <span className="tnum">{Number(p.score).toFixed(1)}</span>
                    </p>
                  </div>
                  <IssueLevelCertificateForm assessmentId={p.id} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-6 sm:mt-8">
          <h2 className="itg2-section-title">Issued certificates</h2>
          {certificates.length === 0 ? (
            <p className="mt-2 text-muted-foreground">
              No certificates issued yet. Meet a month&apos;s requirements or
              pass a level assessment and one will appear here.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {certificates.map((c) => (
                <li
                  key={c.id}
                  className="itg2-card flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5"
                >
                  <div>
                    <p className="font-medium tnum">
                      {c.kind === "level"
                        ? `${c.level_name ?? "Level"} — ${c.certificate_id}`
                        : `${monthLabel(c.month ?? "")} — ${c.certificate_id}`}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                      <span
                        className={`itg2-chip capitalize ${
                          c.status === "issued"
                            ? "itg2-chip-profit"
                            : c.status === "revoked"
                              ? "itg2-chip-loss"
                              : "itg2-chip-muted"
                        }`}
                      >
                        {c.status}
                      </span>
                      {c.kind === "level" && c.assessed_at ? (
                        <span>Assessed {c.assessed_at.slice(0, 10)}</span>
                      ) : null}
                      {c.issued_at ? <span>Issued {c.issued_at.slice(0, 10)}</span> : null}
                    </p>
                  </div>
                  {c.status === "issued" ? (
                    <span className="flex flex-wrap items-center gap-4">
                      <Link
                        href={`/certificates/${encodeURIComponent(c.certificate_id)}/pdf`}
                        className="itg2-link"
                      >
                        Download PDF
                      </Link>
                      <Link
                        href={`/verify/${encodeURIComponent(c.certificate_id)}`}
                        className="itg2-link"
                      >
                        Verify
                      </Link>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
    </AppShell>
  );
}

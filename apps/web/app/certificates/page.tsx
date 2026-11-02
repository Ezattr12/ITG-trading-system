import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AppShell } from "@/components/app-shell";
import { IssueCertificateForm } from "@/components/certificates/issue-certificate-form";
import { getCertificates, getMonthlyEligibility } from "@/lib/certificates/queries";
import { monthLabel } from "@/lib/certificates/eligibility";

export const metadata = { title: "Certificates — ITG TraderOS" };

/**
 * Certificates page (Phase 8, spec §26).
 *
 * A monthly ITG Performance Certificate is issued only when the
 * month's requirements are met — consistent journaling, risk
 * discipline, trading routine, performance review — checked
 * against the trader's real stored data. When requirements are
 * not met, the page shows exactly which criteria are missing.
 * Issued certificates download as a PDF generated on demand
 * from the stored certificate record.
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
  if (configured) {
    const supabase = await createServerSupabaseClient();
    certificates = await getCertificates(supabase, user.id);
    eligibility = await getMonthlyEligibility(supabase, user.id, currentMonth);
  }

  const alreadyIssued = certificates.some(
    (c) => c.month === currentMonth && c.status === "issued",
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

        <section className="mt-6 sm:mt-8">
          <h2 className="itg2-section-title">Issued certificates</h2>
          {certificates.length === 0 ? (
            <p className="mt-2 text-muted-foreground">
              No certificates issued yet. Meet a month&apos;s requirements and
              one will appear here.
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
                      {monthLabel(c.month)} — {c.certificate_id}
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
                      {c.issued_at ? <span>Issued {c.issued_at.slice(0, 10)}</span> : null}
                    </p>
                  </div>
                  {c.status === "issued" ? (
                    <Link
                      href={`/certificates/${encodeURIComponent(c.certificate_id)}/pdf`}
                      className="itg2-link"
                    >
                      Download PDF
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
    </AppShell>
  );
}

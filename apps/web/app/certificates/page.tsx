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
        <h1 className="page-title">Certificates</h1>
        <p className="page-lede">
          A monthly ITG Performance Certificate is earned, not bought — it is
          issued only when the month&apos;s journaling, risk discipline,
          routine and review requirements are all met.
        </p>

        <section
          className={`hero-card mt-6 sm:mt-8 card-surface-raised p-4 sm:p-6 ${
            !configured || !eligibility
              ? ""
              : alreadyIssued
                ? "card-glow-emerald"
                : eligibility.eligible
                  ? "card-glow-amber"
                  : "card-glow-blue"
          }`}
        >
          <h2 className="section-title">
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
              <ul className="mt-4 list-divider">
                {eligibility.criteria.map((c) => (
                  <li key={c.key} className="flex items-start gap-2 py-2 text-sm">
                    <span aria-hidden className={c.met ? "text-emerald-400" : "text-muted-foreground"}>{c.met ? "✓" : "○"}</span>
                    <span>
                      <span className="font-medium">{c.label}</span>
                      <span className="text-muted-foreground"> — {c.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-4">
                {alreadyIssued ? (
                  <p className="text-sm text-emerald-300">
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
        </section>

        <section className="mt-6 sm:mt-8">
          <h2 className="section-title">Issued certificates</h2>
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
                  className="list-row-premium flex flex-wrap items-center justify-between gap-3 card-surface p-4 sm:p-5"
                >
                  <div>
                    <p className="font-medium tnum">
                      {monthLabel(c.month)} — {c.certificate_id}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${
                          c.status === "issued"
                            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                            : c.status === "revoked"
                              ? "border-red-500/40 bg-red-500/10 text-red-300"
                              : "border-border bg-muted/60 text-muted-foreground"
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
                      className="text-sm font-medium text-emerald-300 underline"
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

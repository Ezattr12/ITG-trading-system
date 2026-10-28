import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AppHeader } from "@/components/app-header";
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
    <div className="min-h-screen">
      <AppHeader email={user.email} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-bold">Certificates</h1>
        <p className="mt-1 text-muted-foreground">
          A monthly ITG Performance Certificate is earned, not bought — it is
          issued only when the month&apos;s journaling, risk discipline,
          routine and review requirements are all met.
        </p>

        <section className="mt-8 rounded-lg border bg-card p-4">
          <h2 className="text-lg font-semibold">
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
              <ul className="mt-4 space-y-2">
                {eligibility.criteria.map((c) => (
                  <li key={c.key} className="flex items-start gap-2 text-sm">
                    <span aria-hidden>{c.met ? "✓" : "○"}</span>
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

        <section className="mt-8">
          <h2 className="text-lg font-semibold">Issued certificates</h2>
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
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4"
                >
                  <div>
                    <p className="font-medium">
                      {monthLabel(c.month)} — {c.certificate_id}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Status: {c.status}
                      {c.issued_at ? ` · Issued ${c.issued_at.slice(0, 10)}` : ""}
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
      </main>
    </div>
  );
}

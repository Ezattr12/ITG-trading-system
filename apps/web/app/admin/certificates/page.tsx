import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

import { listAdminCertificates } from "@/lib/admin/queries";
import { RevokeCertificateForm } from "@/components/admin/admin-forms";

export const metadata = { title: "Admin — Certificates — ITG TraderOS" };

/**
 * Admin certificate management (Phase 10). Lists every issued
 * certificate; revoking needs a reason and is audit-logged.
 * Revoking never deletes the record — the status changes to
 * 'revoked' and the row stays visible here.
 */
export default async function AdminCertificatesPage() {
  const user = await getCurrentUser();
  const configured = isSupabaseConfigured();
  const certificates = configured
    ? await listAdminCertificates(await createServerSupabaseClient())
    : [];

  return (
    <>
        <h1 className="page-title">Certificates</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {certificates.length} certificate{certificates.length === 1 ? "" : "s"}. Only issued
          certificates can be revoked, and every revocation needs a reason.
        </p>
        {certificates.length === 0 ? (
          <p className="mt-6 text-sm text-muted-foreground">
            {configured ? "No certificates issued yet." : "Supabase is not connected yet, so no certificates are listed."}
          </p>
        ) : (
          <ul className="mt-6 space-y-4">
            {certificates.map((c) => (
              <li key={c.id} className="list-row-premium card-surface p-4 sm:p-5">
                <p className="flex flex-wrap items-center gap-1.5 font-medium">
                  <span className="tnum">{c.certificate_id}</span>
                  <span>·</span>
                  <span>{c.trader_name ?? "Name not provided"}</span>
                  <span>·</span>
                  <span className="tnum">{c.month.slice(0, 7)}</span>
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
                </p>
                {c.status === "issued" ? (
                  <div className="mt-4 max-w-md">
                    <RevokeCertificateForm certificateId={c.id} />
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Status: {c.status} — cannot be revoked again.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
    </>
  );
}

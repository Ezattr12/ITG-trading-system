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
              <li key={c.id} className="card-surface p-4">
                <p className="font-medium">
                  {c.certificate_id} · {c.trader_name ?? "Name not provided"} ·{" "}
                  {c.month.slice(0, 7)} · {c.status}
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

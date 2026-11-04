import { requireAdmin } from "@/lib/admin/require-admin";
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
 *
 * Master Web UI Redesign (Task 4 sweep) — PRESENTATION ONLY:
 * flat header band, certificate rows as .itg2-card, and the
 * status pill as an .itg2-chip variant by meaning (issued →
 * profit, revoked → loss, anything else muted; the capitalised
 * rendering is kept). The query, revocation flow and copy are
 * exactly as before.
 */
export default async function AdminCertificatesPage() {
  const user = await requireAdmin();
  const configured = isSupabaseConfigured();
  const certificates = configured
    ? await listAdminCertificates(await createServerSupabaseClient())
    : [];

  return (
    <>
        <header className="itg2-card itg2-card-flat p-5 sm:p-6">
          <p className="itg2-eyebrow">Admin</p>
          <h1 className="itg2-page-title mt-1">Certificates</h1>
          <p className="mt-2 text-muted-foreground">
            {certificates.length} certificate{certificates.length === 1 ? "" : "s"}. Only issued
            certificates can be revoked, and every revocation needs a reason.
          </p>
        </header>
        {certificates.length === 0 ? (
          <p className="mt-6 text-sm text-muted-foreground">
            {configured ? "No certificates issued yet." : "Supabase is not connected yet, so no certificates are listed."}
          </p>
        ) : (
          <ul className="mt-6 space-y-4">
            {certificates.map((c) => (
              <li key={c.id} className="itg2-card p-4 sm:p-5">
                <p className="flex flex-wrap items-center gap-1.5 font-medium">
                  <span className="tnum">{c.certificate_id}</span>
                  <span>·</span>
                  <span>{c.trader_name ?? "Name not provided"}</span>
                  <span>·</span>
                  <span className="tnum">
                    {c.kind === "level"
                      ? (c.level_name ?? "Level certificate")
                      : (c.month ?? "").slice(0, 7)}
                  </span>
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

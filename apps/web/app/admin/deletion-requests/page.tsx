import { requireAdmin } from "@/lib/admin/require-admin";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { DeletionRequestControls } from "@/components/admin/deletion-request-forms";

export const metadata = { title: "Admin — Deletion requests — ITG TraderOS" };

/**
 * Admin deletion-request queue (Google Play release
 * preparation).
 *
 * Requests arrive from the public /delete-account form (and
 * the mobile app's signed-out path) into
 * account_deletion_requests — a service-role-only table with
 * zero RLS policies, so this page reads it through the
 * service-role client, and only after requireAdmin() has
 * gated the render (the layout's notFound gate is the outer
 * wall; this in-page gate is the Task 4 pattern: deny and
 * check BEFORE any data is read).
 *
 * Processing and dismissing go through
 * processDeletionRequestAction, which re-checks admin,
 * deletes through the ONE deletion core, and stamps the
 * request row with who acted, when, and what was found.
 */

type DeletionRequestRow = {
  id: string;
  email: string;
  source: string;
  status: string;
  created_at: string;
  processed_at: string | null;
  note: string | null;
};

function stamp(iso: string): string {
  return (
    new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
    }) + " UTC"
  );
}

export default async function AdminDeletionRequestsPage() {
  const user = await requireAdmin();
  const configured = isSupabaseConfigured();
  const admin = configured ? createServiceRoleSupabaseClient() : null;

  let requests: DeletionRequestRow[] = [];
  if (admin) {
    const { data } = await admin
      .from("account_deletion_requests")
      .select("id, email, source, status, created_at, processed_at, note")
      .order("created_at", { ascending: false })
      .limit(100);
    // Pending first, newest first within each group — the
    // queue is worked from the top.
    requests = ((data ?? []) as DeletionRequestRow[]).sort((a, b) => {
      const rank = (r: DeletionRequestRow) => (r.status === "pending" ? 0 : 1);
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      return b.created_at.localeCompare(a.created_at);
    });
  }

  const pendingCount = requests.filter((r) => r.status === "pending").length;

  return (
    <>
      <header className="itg2-card itg2-card-flat p-5 sm:p-6">
        <p className="itg2-eyebrow">Admin</p>
        <h1 className="itg2-page-title mt-1">Deletion requests</h1>
        <p className="mt-2 text-muted-foreground">
          {requests.length} request{requests.length === 1 ? "" : "s"}
          {requests.length > 0 ? `, ${pendingCount} pending` : ""}. Processing a request
          deletes the account registered with its email address permanently; requests are
          verified and processed within 30 days of submission.
        </p>
      </header>
      {requests.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          {configured
            ? "No deletion requests yet."
            : "Supabase is not connected yet, so no deletion requests are listed."}
        </p>
      ) : (
        <ul className="mt-6 space-y-4">
          {requests.map((r) => (
            <li key={r.id} className="itg2-card p-4 sm:p-5">
              <p className="flex flex-wrap items-center gap-1.5 font-medium">
                <span>{r.email}</span>
                <span>·</span>
                <span className="text-sm text-muted-foreground">via {r.source}</span>
                <span
                  className={`itg2-chip capitalize ${
                    r.status === "pending" ? "itg2-chip-warning" : "itg2-chip-muted"
                  }`}
                >
                  {r.status}
                </span>
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Requested {stamp(r.created_at)}
                {r.processed_at ? ` · Handled ${stamp(r.processed_at)}` : ""}
                {r.note ? ` · ${r.note}` : ""}
              </p>
              {r.status === "pending" && <DeletionRequestControls requestId={r.id} />}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

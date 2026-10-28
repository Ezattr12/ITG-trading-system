import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

import { listAuditLogs } from "@/lib/admin/queries";

export const metadata = { title: "Admin — Audit log — ITG TraderOS" };

/**
 * Admin audit log (Phase 10, spec §5). Every admin action writes
 * a row with the admin (actor), the affected trader, the action,
 * the entity and the reason. The log is append-only — no update
 * or delete policies exist (migration 0010).
 */
export default async function AdminAuditPage() {
  const user = await getCurrentUser();
  const configured = isSupabaseConfigured();
  const logs = configured ? await listAuditLogs(await createServerSupabaseClient()) : [];

  return (
    <>
        <h1 className="page-title">Audit log</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {logs.length} entr{logs.length === 1 ? "y" : "ies"}. Append-only: admin actions are
          recorded here and cannot be edited or deleted from the app.
        </p>
        {logs.length === 0 ? (
          <p className="mt-6 text-sm text-muted-foreground">
            {configured ? "No admin actions recorded yet." : "Supabase is not connected yet, so no audit entries are listed."}
          </p>
        ) : (
          <ul className="mt-6 space-y-2">
            {logs.map((row) => (
              <li key={row.id} className="card-surface p-3 text-sm">
                <p className="font-medium">{row.action}</p>
                <p className="text-muted-foreground">
                  {row.entity_type}
                  {row.entity_id ? ` ${row.entity_id.slice(0, 8)}…` : ""} · actor{" "}
                  {row.actor_id ? row.actor_id.slice(0, 8) + "…" : "—"} · target{" "}
                  {row.user_id ? row.user_id.slice(0, 8) + "…" : "—"} ·{" "}
                  {new Date(row.created_at).toLocaleString()}
                </p>
                {row.details?.reason ? (
                  <p className="mt-1">Reason: {String(row.details.reason)}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
    </>
  );
}

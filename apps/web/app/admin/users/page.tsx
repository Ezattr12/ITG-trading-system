import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

import { listAdminUsers } from "@/lib/admin/queries";

export const metadata = { title: "Admin — Users — ITG TraderOS" };

/**
 * Admin user list (Phase 10). Shows ONLY non-financial summary
 * fields — name, country, experience, verification, role, joined
 * date. Trading capital, income and historical P&L are never in
 * this list; they need an explicit, audit-logged request on the
 * trader's detail page.
 */
export default async function AdminUsersPage() {
  const user = await getCurrentUser();
  const configured = isSupabaseConfigured();
  const users = configured ? await listAdminUsers(await createServerSupabaseClient()) : [];

  return (
    <>
        <h1 className="page-title">Users</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {users.length} trader{users.length === 1 ? "" : "s"}. Financial data is not shown
          here — open a trader to request it with a reason.
        </p>
        {users.length === 0 ? (
          <p className="mt-6 text-sm text-muted-foreground">
            {configured ? "No users yet." : "Supabase is not connected yet, so no users are listed."}
          </p>
        ) : (
          <ul className="mt-6 space-y-2">
            {users.map((u) => (
              <li key={u.id} className="list-row-premium card-surface p-4 sm:p-5">
                <Link href={`/admin/users/${u.id}`} className="font-medium underline">
                  {u.full_name ?? "Name not provided"}
                </Link>
                <p className="mt-2 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                  <span>{u.country ?? "Country not provided"}</span>
                  <span>·</span>
                  <span>{u.trading_experience ?? "Experience not provided"}</span>
                  <span>·</span>
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                      u.verification_status === "verified"
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                        : u.verification_status === "partial"
                          ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                          : "border-border bg-muted/60 text-muted-foreground"
                    }`}
                  >
                    {u.verification_status}
                  </span>
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                      u.role === "admin"
                        ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                        : u.role === "auditor"
                          ? "border-sky-500/40 bg-sky-500/10 text-sky-300"
                          : "border-border bg-muted/60 text-muted-foreground"
                    }`}
                  >
                    {u.role}
                  </span>
                  <span>· joined {u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
    </>
  );
}

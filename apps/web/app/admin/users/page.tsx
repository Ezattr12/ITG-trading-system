import Link from "next/link";
import { requireAdmin } from "@/lib/admin/require-admin";
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
 *
 * Master Web UI Redesign (Task 4 sweep) — PRESENTATION ONLY:
 * flat header band, trader rows as .itg2-card, and the
 * verification / role pills as .itg2-chip variants by meaning
 * (verified → profit, partial → warning, admin → gold, auditor
 * → the base blue chip, everything else muted). The query,
 * fields shown and copy are exactly as before.
 */
export default async function AdminUsersPage() {
  const user = await requireAdmin();
  const configured = isSupabaseConfigured();
  const users = configured ? await listAdminUsers(await createServerSupabaseClient()) : [];

  return (
    <>
        <header className="itg2-card itg2-card-flat p-5 sm:p-6">
          <p className="itg2-eyebrow">Admin</p>
          <h1 className="itg2-page-title mt-1">Users</h1>
          <p className="mt-2 text-muted-foreground">
            {users.length} trader{users.length === 1 ? "" : "s"}. Financial data is not shown
            here — open a trader to request it with a reason.
          </p>
        </header>
        {users.length === 0 ? (
          <p className="mt-6 text-sm text-muted-foreground">
            {configured ? "No users yet." : "Supabase is not connected yet, so no users are listed."}
          </p>
        ) : (
          <ul className="mt-6 space-y-2">
            {users.map((u) => (
              <li key={u.id} className="itg2-card p-4 sm:p-5">
                <Link href={`/admin/users/${u.id}`} className="itg2-link font-medium">
                  {u.full_name ?? "Name not provided"}
                </Link>
                <p className="mt-2 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                  <span>{u.country ?? "Country not provided"}</span>
                  <span>·</span>
                  <span>{u.trading_experience ?? "Experience not provided"}</span>
                  <span>·</span>
                  <span
                    className={`itg2-chip ${
                      u.verification_status === "verified"
                        ? "itg2-chip-profit"
                        : u.verification_status === "partial"
                          ? "itg2-chip-warning"
                          : "itg2-chip-muted"
                    }`}
                  >
                    {u.verification_status}
                  </span>
                  <span
                    className={`itg2-chip ${
                      u.role === "admin"
                        ? "itg2-chip-gold"
                        : u.role === "auditor"
                          ? ""
                          : "itg2-chip-muted"
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

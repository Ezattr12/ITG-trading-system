import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

import { getAdminStats, listAuditLogs } from "@/lib/admin/queries";

export const metadata = { title: "Admin — ITG TraderOS" };

/**
 * Admin dashboard (Phase 10, spec §10).
 *
 * Real counts from stored data only — users, trades, certificates
 * issued/revoked, active goals, open risk events, notifications,
 * discipline and AI-coach activity in the last 7 days. No
 * financial totals are shown here: P&L and capital are private
 * and never aggregated on an admin screen.
 */

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="card-surface p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 page-title">{value}</p>
    </div>
  );
}

export default async function AdminDashboardPage() {
  const user = await getCurrentUser();
  const configured = isSupabaseConfigured();
  const supabase = await createServerSupabaseClient();
  const stats = configured
    ? await getAdminStats(supabase)
    : {
        user_count: 0,
        admin_count: 0,
        trade_count: 0,
        certificates_issued: 0,
        certificates_revoked: 0,
        active_goals: 0,
        open_risk_events: 0,
        unread_notifications: 0,
        discipline_events_7d: 0,
        ai_insights_7d: 0,
      };
  const recentAudit = configured ? await listAuditLogs(supabase, 10) : [];

  return (
    <>
        <h1 className="page-title">Admin dashboard</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {configured
            ? "Real counts from stored data. Financial data (capital, P&L) is never shown here — it needs an explicit, audit-logged request on a trader's page."
            : "Supabase is not connected yet, so no counts are available. Nothing here is demo data."}
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Stat label="Traders" value={stats.user_count} />
          <Stat label="Admins" value={stats.admin_count} />
          <Stat label="Trades journaled" value={stats.trade_count} />
          <Stat label="Certificates issued" value={stats.certificates_issued} />
          <Stat label="Certificates revoked" value={stats.certificates_revoked} />
          <Stat label="Active goals" value={stats.active_goals} />
          <Stat label="Open risk events" value={stats.open_risk_events} />
          <Stat label="Unread notifications" value={stats.unread_notifications} />
          <Stat label="Discipline events (7 days)" value={stats.discipline_events_7d} />
          <Stat label="AI Coach insights (7 days)" value={stats.ai_insights_7d} />
        </div>

        <section className="mt-6 sm:mt-8">
          <h2 className="section-title">Recent admin activity</h2>
          {recentAudit.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No admin actions recorded yet.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {recentAudit.map((row) => (
                <li key={row.id} className="card-surface p-3 text-sm">
                  <span className="font-medium">{row.action}</span>{" "}
                  <span className="text-muted-foreground">
                    on {row.entity_type}
                    {row.details?.reason ? ` — ${String(row.details.reason)}` : ""} ·{" "}
                    {new Date(row.created_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
    </>
  );
}

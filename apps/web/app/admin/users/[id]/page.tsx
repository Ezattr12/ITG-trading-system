import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin/require-admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

import { getAdminUserDetail } from "@/lib/admin/queries";
import { getAuthorisedFinancials } from "@/lib/admin/actions";
import {
  FinancialViewForm,
  RoleForm,
  VerificationForm,
} from "@/components/admin/admin-forms";

export const metadata = { title: "Admin — User — ITG TraderOS" };

function display(v: string | number | null | undefined): string {
  return v === null || v === undefined || v === "" ? "Not provided" : String(v);
}

/**
 * Admin user detail (Phase 10). Level, verification, trade /
 * certificate / goal counts — all non-financial. Financial fields
 * appear ONLY after the admin submitted the financial-view form
 * with a reason (audit-logged, valid 15 minutes); otherwise the
 * page states plainly that they are hidden.
 *
 * Master Web UI Redesign (Task 4 sweep) — PRESENTATION ONLY:
 * flat header band, the three summary tiles as .itg2-kpi
 * cards, and the financial / role / verification sections as
 * flat v2 cards (they contain forms) with .itg2-section-title
 * headings. All data, the financial-view gating and copy are
 * exactly as before.
 */
export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAdmin();
  const configured = isSupabaseConfigured();
  const detail = configured
    ? await getAdminUserDetail(await createServerSupabaseClient(), id)
    : null;
  if (!detail) notFound();

  const financials = configured ? await getAuthorisedFinancials(id) : null;

  return (
    <>
        <header className="itg2-card itg2-card-flat p-5 sm:p-6">
          <p className="itg2-eyebrow">Admin · User</p>
          <h1 className="itg2-page-title mt-1">{display(detail.full_name)}</h1>
          <p className="mt-2 text-muted-foreground">
            {display(detail.country)} · {display(detail.trading_experience)} · Verification:{" "}
            {detail.verification_status} · Role: {detail.role} · Joined{" "}
            {detail.created_at ? new Date(detail.created_at).toLocaleDateString() : "—"}
          </p>
        </header>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="itg2-card itg2-kpi">
            <p className="itg2-kpi-label">Level</p>
            <p className="itg2-kpi-value">
              {detail.level_name ?? "Not calculated yet"}
              {detail.level_score !== null ? <span className="tnum"> ({detail.level_score})</span> : ""}
            </p>
          </div>
          <div className="itg2-card itg2-kpi">
            <p className="itg2-kpi-label">Trades / Certificates</p>
            <p className="itg2-kpi-value tnum">
              {detail.trade_count} / {detail.certificate_count}
            </p>
          </div>
          <div className="itg2-card itg2-kpi">
            <p className="itg2-kpi-label">Active goals</p>
            <p className="itg2-kpi-value tnum">{detail.active_goal_count}</p>
          </div>
        </div>

        <section className="mt-6 sm:mt-8 itg2-card itg2-card-flat p-4 sm:p-6">
          <h2 className="itg2-section-title">Financial data — private by default</h2>
          {financials ? (
            <dl className="mt-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Trading capital</dt>
                <dd>{financials.trading_capital === null ? "Not provided" : financials.trading_capital}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Monthly income</dt>
                <dd>{financials.monthly_income === null ? "Not provided" : financials.monthly_income}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Historical profit / loss</dt>
                <dd>
                  {financials.historical_profit ?? "—"} / {financials.historical_loss ?? "—"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Trades real money</dt>
                <dd>{financials.trades_real_money ? "Yes" : "No"}</dd>
              </div>
            </dl>
          ) : (
            <>
              <p className="mt-2 text-sm text-muted-foreground">
                Hidden. Admins do not automatically access a trader&apos;s financial data.
                Request a view with a reason — the request is audit-logged and the view
                expires after 15 minutes.
              </p>
              <div className="mt-4 max-w-md">
                <FinancialViewForm userId={id} />
              </div>
            </>
          )}
        </section>

        <section className="mt-6 sm:mt-8 grid gap-6 md:grid-cols-2">
          <div className="itg2-card itg2-card-flat p-4 sm:p-6">
            <h2 className="itg2-section-title">Change role</h2>
            <div className="mt-4">
              <RoleForm userId={id} currentRole={detail.role} />
            </div>
          </div>
          <div className="itg2-card itg2-card-flat p-4 sm:p-6">
            <h2 className="itg2-section-title">Change verification</h2>
            <div className="mt-4">
              <VerificationForm userId={id} currentStatus={detail.verification_status} />
            </div>
          </div>
        </section>
    </>
  );
}

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AppShell } from "@/components/app-shell";
import { TradingPlanForm } from "@/components/risk/plan-form";
import { getAnalyticsBundle } from "@/lib/analytics/queries";
import { psychologySummary } from "@/lib/analytics/analytics";
import { evaluatePlanVsActual } from "@/lib/risk/engine";
import { getTradingPlan } from "@/lib/risk/queries";
import { getPlanEventSummary, getPlanEvents } from "@/lib/plan/queries";
import { PLAN_TERM_LABELS, type PlanEvent } from "@/lib/plan/types";

export const metadata = { title: "Trading plan — ITG TraderOS" };

/**
 * Trading plan page (Phase 5, spec §20).
 *
 * The trader defines their plan; below it, actual behaviour is
 * compared against the plan using only real closed trades. Rows
 * that cannot be measured from trades say so honestly instead of
 * guessing.
 *
 * Master Web UI Redesign (Task 4 sweep) — PRESENTATION ONLY:
 * the page moved onto the v2 system (flat header band with
 * eyebrow + .itg2-page-title, the plan form in an
 * .itg2-card.itg2-card-flat panel, the comparison as an
 * .itg2-table in a glass card with .itg2-chip on-track pills).
 * All data, copy, empty states and the comparison rows are
 * exactly as before.
 */

export default async function PlanPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.onboarding?.is_complete) redirect("/onboarding");

  const configured = isSupabaseConfigured();
  const supabase = await createServerSupabaseClient();
  // Performance (2026-11-02): the plan read was awaited on its
  // own before the parallel block; it is independent of the
  // other three reads and now joins them.
  let plan: Awaited<ReturnType<typeof getTradingPlan>> = null;

  let setups: { id: string; name: string; strategyName: string | null }[] = [];
  let rows: ReturnType<typeof evaluatePlanVsActual> = [];
  let planEvents: PlanEvent[] = [];
  let planSummary: Awaited<ReturnType<typeof getPlanEventSummary>> | null = null;
  if (configured) {
    const [
      { data: setupRows },
      { data: strategyRows },
      bundle,
      planRow,
      events,
      summary,
    ] = await Promise.all([
      supabase.from("setups").select("id, name, strategy_id").order("name"),
      supabase.from("strategies").select("id, name"),
      getAnalyticsBundle(supabase, user.id),
      getTradingPlan(supabase, user.id),
      getPlanEvents(supabase, user.id),
      getPlanEventSummary(supabase, user.id),
    ]);
    plan = planRow;
    planEvents = events;
    planSummary = summary;
    const strategyName = new Map(
      ((strategyRows ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]),
    );
    setups = ((setupRows ?? []) as { id: string; name: string; strategy_id: string | null }[]).map(
      (s) => ({
        id: s.id,
        name: s.name,
        strategyName: s.strategy_id ? strategyName.get(s.strategy_id) ?? null : null,
      }),
    );
    const setupNameById = new Map(setups.map((s) => [s.id, s.name]));
    const psych = psychologySummary(bundle.trades);
    rows = plan
      ? evaluatePlanVsActual({
          plan,
          trades: bundle.trades,
          goodDisciplinePct: psych.goodDisciplinePct,
          strategiesUsed: [...new Set(bundle.trades.map((t) => t.strategyName).filter(Boolean) as string[])],
          preferredSetupNames: (plan.preferred_setup_ids ?? []).map(
            (id) => setupNameById.get(id) ?? id,
          ),
        })
      : [];
  }

  return (
    <AppShell email={user.email}>
        <header className="itg2-card itg2-card-flat p-5 sm:p-6">
          <p className="itg2-eyebrow">Trading plan</p>
          <h1 className="itg2-page-title mt-1">Trading plan</h1>
          <p className="mt-2 text-muted-foreground">
            Define how you intend to trade. The comparison below shows
            what you actually did — from your real trades only.
          </p>
        </header>

        {!configured && (
          <p role="status" className="itg2-notice itg2-notice-warning mt-4">
            Supabase is not connected yet. Your trading plan will be
            saved once a Supabase project is created and connected.
          </p>
        )}

        <section className="itg2-card itg2-card-flat mt-6 sm:mt-8 p-4 sm:p-6" aria-label="Your plan">
          <h2 className="itg2-section-title">Your plan</h2>
          <div className="mt-4">
            <TradingPlanForm plan={plan} setups={setups} />
          </div>
        </section>

        <section className="mt-6 sm:mt-8" aria-label="Plan versus actual">
          <h2 className="itg2-section-title">Plan vs actual</h2>
          {plan === null ? (
            <p className="itg2-notice itg2-notice-neutral mt-4">
              Save a plan first — the comparison appears here.
            </p>
          ) : rows.length === 0 ? (
            <p className="itg2-notice itg2-notice-neutral mt-4">
              No closed trades yet — the comparison appears once you
              have journaled trades.
            </p>
          ) : (
            <div className="itg2-card mt-4 overflow-x-auto">
              <table className="itg2-table">
                <thead>
                  <tr>
                    <th>Area</th>
                    <th>Planned</th>
                    <th>Actual</th>
                    <th>On plan?</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.label}>
                      <td className="font-medium">{row.label}</td>
                      <td>{row.planned}</td>
                      <td>{row.actual}</td>
                      <td>
                        {row.onTrack === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : row.onTrack ? (
                          <span className="itg2-chip itg2-chip-profit">
                            Yes
                          </span>
                        ) : (
                          <span className="itg2-chip itg2-chip-loss">
                            No
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="mt-6 sm:mt-8" aria-label="Plan adherence">
          <h2 className="itg2-section-title">Plan adherence</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Automatic monitoring checks every saved trade against
            your plan and records each breach here — it never
            blocks a trade. Day-limit breaches are recorded once
            per day, for the trade that crossed the line.
          </p>
          {plan === null ? (
            <p className="itg2-notice itg2-notice-neutral mt-4">
              Save a plan first — monitoring starts once a plan exists.
            </p>
          ) : planEvents.length === 0 ? (
            <p className="itg2-notice itg2-notice-neutral mt-4">
              No plan breaches recorded yet. When a saved trade
              breaks your plan, it will appear here and in your
              notifications.
            </p>
          ) : (
            <>
              {planSummary !== null && planSummary.total > 0 ? (
                <p className="mt-4 flex flex-wrap items-center gap-1.5 text-sm">
                  <span className="font-medium">
                    {planSummary.total}{" "}
                    {planSummary.total === 1 ? "breach" : "breaches"} in the
                    last {planSummary.days} days:
                  </span>
                  {Object.entries(planSummary.byTerm).map(([term, count]) => (
                    <span key={term} className="itg2-chip itg2-chip-loss">
                      {PLAN_TERM_LABELS[term as keyof typeof PLAN_TERM_LABELS] ??
                        term}{" "}
                      × {count}
                    </span>
                  ))}
                </p>
              ) : null}
              <ul className="mt-4 space-y-3">
                {planEvents.map((event) => (
                  <li key={event.id} className="itg2-card p-4 sm:p-5">
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="itg2-chip itg2-chip-loss">
                        {PLAN_TERM_LABELS[event.term] ?? event.term}
                      </span>
                      <span>
                        {new Date(event.created_at).toLocaleString()}
                      </span>
                    </p>
                    <p className="mt-1 text-sm">{event.message}</p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
    </AppShell>
  );
}

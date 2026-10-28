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

export const metadata = { title: "Trading plan — ITG TraderOS" };

/**
 * Trading plan page (Phase 5, spec §20).
 *
 * The trader defines their plan; below it, actual behaviour is
 * compared against the plan using only real closed trades. Rows
 * that cannot be measured from trades say so honestly instead of
 * guessing.
 */

export default async function PlanPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.onboarding?.is_complete) redirect("/onboarding");

  const configured = isSupabaseConfigured();
  const supabase = await createServerSupabaseClient();
  const plan = configured ? await getTradingPlan(supabase, user.id) : null;

  let setups: { id: string; name: string; strategyName: string | null }[] = [];
  let rows: ReturnType<typeof evaluatePlanVsActual> = [];
  if (configured) {
    const [{ data: setupRows }, { data: strategyRows }, bundle] = await Promise.all([
      supabase.from("setups").select("id, name, strategy_id").order("name"),
      supabase.from("strategies").select("id, name"),
      getAnalyticsBundle(supabase, user.id),
    ]);
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
        <h1 className="page-title">Trading plan</h1>
        <p className="page-lede">
          Define how you intend to trade. The comparison below shows
          what you actually did — from your real trades only.
        </p>

        {!configured && (
          <p role="status" className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            Supabase is not connected yet. Your trading plan will be
            saved once a Supabase project is created and connected.
          </p>
        )}

        <section className="hero-card mt-6 sm:mt-8 card-surface-raised card-glow-blue p-4 sm:p-6" aria-label="Your plan">
          <h2 className="section-title">Your plan</h2>
          <div className="mt-4">
            <TradingPlanForm plan={plan} setups={setups} />
          </div>
        </section>

        <section className="mt-6 sm:mt-8" aria-label="Plan versus actual">
          <h2 className="section-title">Plan vs actual</h2>
          {plan === null ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Save a plan first — the comparison appears here.
            </p>
          ) : rows.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No closed trades yet — the comparison appears once you
              have journaled trades.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto card-surface">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Area</th>
                    <th className="px-3 py-2 font-medium">Planned</th>
                    <th className="px-3 py-2 font-medium">Actual</th>
                    <th className="px-3 py-2 font-medium">On plan?</th>
                  </tr>
                </thead>
                <tbody className="list-divider">
                  {rows.map((row) => (
                    <tr key={row.label} className="list-row-premium">
                      <td className="px-3 py-2 font-medium">{row.label}</td>
                      <td className="px-3 py-2">{row.planned}</td>
                      <td className="px-3 py-2">{row.actual}</td>
                      <td className="px-3 py-2">
                        {row.onTrack === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : row.onTrack ? (
                          <span className="inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-300">
                            Yes
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-300">
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
    </AppShell>
  );
}

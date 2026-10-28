import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AppShell } from "@/components/app-shell";
import { RiskRulesForm } from "@/components/risk/risk-rules-form";
import { ResolveEventForm } from "@/components/risk/resolve-event-form";
import {
  countDisciplinedStreak,
  evaluateTradeRisk,
  utcDate,
} from "@/lib/risk/engine";
import {
  getRecentClosedTrades,
  getRiskDayContext,
  getRiskEvents,
  getRiskRules,
} from "@/lib/risk/queries";

export const metadata = { title: "Risk — ITG TraderOS" };

/**
 * Risk page (Phase 5, spec §19).
 *
 * Configurable risk rules, today's status against those rules,
 * and the breach log. The engine warns — it never auto-executes
 * or closes a real trade (spec §41). Only two breaches stop a
 * trade from being saved: the daily loss limit and leverage
 * above the maximum; everything else is a warning and the trade
 * is still journaled.
 */

const SEVERITY_STYLE: Record<string, string> = {
  critical: "border-red-500/40 bg-red-500/10 text-red-200",
  warning: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  positive: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
};

export default async function RiskPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.onboarding?.is_complete) redirect("/onboarding");

  const configured = isSupabaseConfigured();
  const supabase = await createServerSupabaseClient();
  const rules = configured ? await getRiskRules(supabase, user.id) : null;
  const events = configured ? await getRiskEvents(supabase, user.id) : [];
  const today = utcDate(new Date().toISOString());
  const day = configured
    ? await getRiskDayContext(supabase, user.id, today)
    : { tradesToday: 0, dayPnl: null, consecutiveLosses: 0 };
  const recentClosed = configured
    ? await getRecentClosedTrades(supabase, user.id)
    : [];
  const streak = countDisciplinedStreak(recentClosed, rules);
  const checks = rules
    ? evaluateTradeRisk(rules, { leverage: 1, riskPct: null }, day, streak)
    : [];
  const activeChecks = checks.filter((c) => c.breached);

  return (
    <AppShell email={user.email}>
        <h1 className="page-title">Risk management</h1>
        <p className="page-lede">
          Set your limits once — the engine checks every trade against
          them and logs every breach. It never closes or executes a
          real trade for you.
        </p>

        {!configured && (
          <p role="status" className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            Supabase is not connected yet. Your risk rules will be
            saved once a Supabase project is created and connected.
          </p>
        )}

        {/* Today's status is the hero of this page (Phase 18).
            The glow follows the real risk state: red while a
            breach is active, amber for warnings only, emerald
            when every rule is within limits, calm blue when no
            rules are set yet. */}
        <section
          className={`hero-card mt-6 sm:mt-8 card-surface-raised p-4 sm:p-6 ${
            rules === null
              ? "card-glow-blue"
              : activeChecks.length === 0
                ? "card-glow-emerald"
                : activeChecks.some((c) => c.severity === "critical")
                  ? "card-glow-danger"
                  : "card-glow-amber"
          }`}
          aria-label="Today's status"
        >
          <h2 className="eyebrow">Today&apos;s status</h2>
          {rules === null ? (
            <p className="mt-2 text-sm">
              No risk rules set yet — set limits below and the engine
              will start checking your trades.
            </p>
          ) : activeChecks.length === 0 ? (
            <p className="mt-2 text-sm text-emerald-300">
              All rules are within limits today. {streak > 0 ? `You have followed your risk plan for ${streak} consecutive trades.` : ""}
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {activeChecks.map((c) => (
                <li
                  key={c.rule}
                  role="alert"
                  className={`rounded-md border px-3 py-2 text-sm ${SEVERITY_STYLE[c.severity] ?? ""}`}
                >
                  <span className="font-medium uppercase">{c.severity}: </span>
                  {c.message}
                </li>
              ))}
            </ul>
          )}
          <dl className="mt-4 grid grid-cols-3 gap-4 text-sm">
            <div>
              <dt className="text-muted-foreground">Trades today</dt>
              <dd className="section-title tnum">{day.tradesToday}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Today&apos;s P&amp;L</dt>
              <dd
                className={`section-title tnum ${day.dayPnl === null ? "" : day.dayPnl > 0 ? "text-emerald-400" : day.dayPnl < 0 ? "text-red-400" : ""}`}
              >
                {day.dayPnl === null ? "—" : day.dayPnl.toFixed(2)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Consecutive losses</dt>
              <dd className={`section-title tnum ${day.consecutiveLosses > 0 ? "text-red-400" : ""}`}>{day.consecutiveLosses}</dd>
            </div>
          </dl>
        </section>

        <section className="mt-6 sm:mt-8 card-surface p-4 sm:p-6" aria-label="Risk rules">
          <h2 className="section-title">Your risk rules</h2>
          <div className="mt-4">
            <RiskRulesForm rules={rules} />
          </div>
        </section>

        <section className="mt-6 sm:mt-8" aria-label="Risk events">
          <h2 className="section-title">Risk events</h2>
          {events.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No risk events yet. Breaches and positive streaks will
              appear here.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {events.map((e) => (
                <li
                  key={e.id}
                  className={`list-row-premium flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm shadow-elevation-1 ${SEVERITY_STYLE[e.severity] ?? ""}`}
                >
                  <div>
                    <p>
                      <span className="font-medium uppercase">{e.severity}: </span>
                      {e.message}
                    </p>
                    <p className="text-xs opacity-80">
                      {new Date(e.created_at).toLocaleString()}
                      {e.resolved_at ? " · Resolved" : ""}
                    </p>
                  </div>
                  {!e.resolved_at && <ResolveEventForm eventId={e.id} />}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-sm">
            <Link href="/plan" className="underline">
              Edit your trading plan
            </Link>
            {" · "}
            <Link href="/psychology" className="underline">
              View your psychology
            </Link>
          </p>
        </section>
    </AppShell>
  );
}

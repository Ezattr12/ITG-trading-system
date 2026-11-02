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
 *
 * Master Web UI Redesign (Task 7) — PRESENTATION ONLY: the
 * page moved onto the v2 system (flat header band with
 * eyebrow + .itg2-page-title, today's status as an elevated
 * card whose state is carried by .itg2-chip severity pills
 * and the semantic text tones instead of the retired v1
 * state glow, the day's figures as .itg2-kpi cards, the
 * rules form in a flat glass panel on the v2 form system,
 * and the event log as .itg2-row entries in a glass card).
 * All data, copy, empty states and evaluations are exactly
 * as before.
 */

const SEVERITY_CHIP: Record<string, string> = {
  critical: "itg2-chip-loss",
  warning: "itg2-chip-warning",
  positive: "itg2-chip-profit",
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
        <header className="itg2-card itg2-card-flat p-5 sm:p-6">
          <p className="itg2-eyebrow">Risk</p>
          <h1 className="itg2-page-title mt-1">Risk management</h1>
          <p className="mt-2 text-muted-foreground">
            Set your limits once — the engine checks every trade against
            them and logs every breach. It never closes or executes a
            real trade for you.
          </p>
        </header>

        {!configured && (
          <p role="status" className="itg2-notice itg2-notice-warning mt-4">
            Supabase is not connected yet. Your risk rules will be
            saved once a Supabase project is created and connected.
          </p>
        )}

        {/* Today's status is the hero of this page. In v2 the
            state is carried by the severity chips and semantic
            tones of the messages themselves — critical loss,
            warning amber, within-limits profit — on an elevated
            glass card, instead of the retired v1 state glow. */}
        <section
          className="itg2-card itg2-card-elevated mt-6 sm:mt-8 p-4 sm:p-6"
          aria-label="Today's status"
        >
          <h2 className="itg2-section-title">Today&apos;s status</h2>
          {rules === null ? (
            <p className="mt-2 text-sm">
              No risk rules set yet — set limits below and the engine
              will start checking your trades.
            </p>
          ) : activeChecks.length === 0 ? (
            <p className="mt-2 text-sm itg2-text-profit">
              All rules are within limits today. {streak > 0 ? `You have followed your risk plan for ${streak} consecutive trades.` : ""}
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {activeChecks.map((c) => (
                <li
                  key={c.rule}
                  role="alert"
                  className="itg2-inset px-3 py-2 text-sm"
                >
                  <span className={`itg2-chip uppercase ${SEVERITY_CHIP[c.severity] ?? ""}`}>{c.severity}: </span>{c.message}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-4 grid gap-4 sm:grid-cols-3" aria-label="Today in numbers">
          <article className="itg2-card itg2-kpi">
            <h2 className="itg2-kpi-label">Trades today</h2>
            <p className="itg2-kpi-value">{day.tradesToday}</p>
          </article>
          <article className="itg2-card itg2-kpi">
            <h2 className="itg2-kpi-label">Today&apos;s P&amp;L</h2>
            <p
              className={`itg2-kpi-value ${day.dayPnl === null ? "" : day.dayPnl > 0 ? "itg2-text-profit" : day.dayPnl < 0 ? "itg2-text-loss" : ""}`}
            >
              {day.dayPnl === null ? "—" : day.dayPnl.toFixed(2)}
            </p>
          </article>
          <article className="itg2-card itg2-kpi">
            <h2 className="itg2-kpi-label">Consecutive losses</h2>
            <p className={`itg2-kpi-value ${day.consecutiveLosses > 0 ? "itg2-text-loss" : ""}`}>{day.consecutiveLosses}</p>
          </article>
        </section>

        <section className="itg2-card itg2-card-flat mt-6 sm:mt-8 p-4 sm:p-6" aria-label="Risk rules">
          <h2 className="itg2-section-title">Your risk rules</h2>
          <div className="mt-4">
            <RiskRulesForm rules={rules} />
          </div>
        </section>

        <section className="itg2-card mt-6 sm:mt-8 p-4 sm:p-6" aria-label="Risk events">
          <h2 className="itg2-section-title">Risk events</h2>
          {events.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No risk events yet. Breaches and positive streaks will
              appear here.
            </p>
          ) : (
            <ul className="mt-2">
              {events.map((e) => (
                <li
                  key={e.id}
                  className="itg2-row flex-wrap gap-2"
                >
                  <div>
                    <p className="text-sm">
                      <span className={`itg2-chip uppercase ${SEVERITY_CHIP[e.severity] ?? ""}`}>{e.severity}: </span>{e.message}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
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
            <Link href="/plan" className="itg2-link">
              Edit your trading plan
            </Link>
            {" · "}
            <Link href="/psychology" className="itg2-link">
              View your psychology
            </Link>
          </p>
        </section>
    </AppShell>
  );
}

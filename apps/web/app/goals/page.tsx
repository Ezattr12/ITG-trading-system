import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AppShell } from "@/components/app-shell";
import { ProgressBar } from "@/components/analytics/stat-card";
import { GoalForm } from "@/components/discipline/goal-form";
import { GoalProgressForm } from "@/components/discipline/goal-progress-form";
import { GoalStatusForm } from "@/components/discipline/goal-status-form";
import { resolveGoalProgress } from "@/lib/discipline/engine";
import { motivationContextFor, selectMotivationMessage } from "@/lib/discipline/motivation";
import {
  getDisciplineEvents,
  getGoalMeasurementContext,
  getGoals,
  getLastJournalDate,
  getLatestGoalProgress,
  getMotivationMessages,
} from "@/lib/discipline/queries";

export const metadata = { title: "Goals — ITG TraderOS" };

/**
 * Goals & discipline page (Phase 6, spec §21–23).
 *
 * Goals are measured from real trades and activity where the goal
 * type allows it; a goal that cannot be measured says so honestly
 * instead of showing invented progress. Manual goals are tracked
 * by the progress the trader records. Discipline reminders are
 * supportive, never shaming.
 */

const PERIOD_LABEL: Record<string, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  completed: "Completed",
  paused: "Paused",
  failed: "Failed",
};

export default async function GoalsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.onboarding?.is_complete) redirect("/onboarding");

  const configured = isSupabaseConfigured();
  const supabase = await createServerSupabaseClient();
  const today = new Date().toISOString().slice(0, 10);

  const goals = configured ? await getGoals(supabase, user.id) : [];
  const manual = configured ? await getLatestGoalProgress(supabase, user.id) : new Map();
  const measurement = configured
    ? await getGoalMeasurementContext(supabase, user.id)
    : { trades: [], activity: [], hasRiskRules: false, maxLeverage: null };
  const events = configured ? await getDisciplineEvents(supabase, user.id, 10) : [];
  const lastJournalDate = configured ? await getLastJournalDate(supabase, user.id) : null;
  const messages = configured ? await getMotivationMessages(supabase) : [];

  const resolved = goals.map((g) =>
    resolveGoalProgress(g, measurement, manual.get(g.id) ?? null, today),
  );

  // Motivation context from the trader's real situation.
  const closedNewest = [...measurement.trades]
    .filter((t) => t.status === "closed" && t.closedAt)
    .sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""));
  let disciplinedStreak = 0;
  for (const t of closedNewest) {
    const ok =
      t.stopLossSet &&
      (measurement.maxLeverage === null || t.leverage === null || t.leverage <= measurement.maxLeverage);
    if (!ok) break;
    disciplinedStreak += 1;
  }
  const hadLossToday = closedNewest.some(
    (t) => (t.closedAt ?? "").slice(0, 10) === today && (t.pnl ?? 0) < 0,
  );
  const goalNearCompletion = resolved.some(
    (r) => r.goal.status === "active" && r.percent !== null && r.percent >= 80 && r.percent < 100,
  );
  const missedDays =
    lastJournalDate === null
      ? null
      : Math.max(0, Math.floor((new Date(`${today}T00:00:00Z`).getTime() - new Date(`${lastJournalDate}T00:00:00Z`).getTime()) / 86_400_000));
  const motivation = selectMotivationMessage(
    messages,
    motivationContextFor({ missedDays, goalNearCompletion, disciplinedStreak, hadLossToday }),
    null,
    today,
  );

  return (
    <AppShell email={user.email}>
        <h1 className="page-title">Goals &amp; discipline</h1>
        <p className="page-lede">
          Daily, weekly, monthly and yearly goals, measured from your
          real trades and activity where possible — never guessed.
        </p>

        {motivation ? (
          <blockquote className="mt-6 card-surface p-4 text-sm italic text-muted-foreground">
            “{motivation.message}”
          </blockquote>
        ) : null}

        <section className="mt-6 sm:mt-8 card-surface p-4 sm:p-6" aria-label="Create a goal">
          <h2 className="section-title">New goal</h2>
          <div className="mt-4">
            <GoalForm />
          </div>
        </section>

        <section className="mt-6 sm:mt-8" aria-label="Your goals">
          <h2 className="section-title">Your goals</h2>
          {resolved.length === 0 ? (
            <p className="mt-2 text-muted-foreground">
              No goals yet. Create your first goal above — for example,
              journaling a set number of trades this month.
            </p>
          ) : (
            <ul className="mt-4 space-y-4">
              {resolved.map((r) => (
                <li key={r.goal.id} className="card-surface p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-semibold">{r.goal.title}</h3>
                    <span className="text-sm text-muted-foreground">
                      {PERIOD_LABEL[r.goal.period] ?? r.goal.period} ·{" "}
                      {STATUS_LABEL[r.goal.status] ?? r.goal.status}
                    </span>
                  </div>
                  {r.measurable && r.percent !== null && r.currentValue !== null ? (
                    <div className="mt-3">
                      <ProgressBar
                        percent={r.percent}
                        label={`${r.goal.title}: ${r.currentValue} / ${r.goal.target_value} (${r.percent.toFixed(0)}%)`}
                      />
                      <p className="mt-2 text-sm text-muted-foreground">
                        {r.currentValue} / {r.goal.target_value}
                        {r.goal.target_unit ? ` ${r.goal.target_unit}` : ""} (
                        {r.percent.toFixed(0)}%)
                        {r.source === "manual" ? " — recorded by you" : " — measured from your data"}
                        {r.percent >= 100 && r.goal.status === "active"
                          ? " — target reached, mark it complete when you're ready."
                          : ""}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">
                      Progress not measurable yet —{" "}
                      {r.notMeasurableReason ?? "no data for this goal yet."}
                    </p>
                  )}
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    {r.source !== "measured" ? (
                      <div>
                        <h4 className="mb-2 text-sm font-medium">Record progress</h4>
                        <GoalProgressForm goalId={r.goal.id} currentValue={r.currentValue} />
                      </div>
                    ) : null}
                    <div>
                      <h4 className="mb-2 text-sm font-medium">Status</h4>
                      <GoalStatusForm goalId={r.goal.id} status={r.goal.status} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-6 sm:mt-8 card-surface p-4 sm:p-6" aria-label="Recent discipline reminders">
          <h2 className="section-title">Recent discipline reminders</h2>
          {events.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No reminders yet. If you miss a day of journaling, a
              supportive reminder appears here and on your dashboard —
              Day 1 is a gentle nudge, Day 2 a warning, Day 3 a stronger
              reminder. Nothing here is ever shaming.
            </p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {events.map((e) => (
                <li key={e.id} className="flex justify-between gap-4">
                  <span>
                    Day {e.level} reminder · {e.message}
                  </span>
                  <span className="shrink-0 text-muted-foreground">{e.event_date}</span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/notifications" className="mt-4 inline-block text-sm font-medium underline">
            View all notifications
          </Link>
        </section>
    </AppShell>
  );
}

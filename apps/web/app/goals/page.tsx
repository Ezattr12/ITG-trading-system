import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Activity,
  BookOpenText,
  Flag,
  Hash,
  History,
  NotebookPen,
  ShieldCheck,
  Target,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
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
 *
 * Master Web UI Redesign Page 6 — PRESENTATION ONLY: the page
 * moved onto the v2 system (header band, .itg2-hero for the
 * closest-to-completion goal, glass goal cards with a per-type
 * icon tile and .itg2-chip status, .itg2-row reminder rows).
 * The shared ProgressBar keeps its markup, animation and aria
 * contract; inside this page's .itg2-goalbar-scope wrappers its
 * fill renders blue -> cyan (profit -> cyan for a completed
 * goal) via the scoped overrides in itg2.css — the Progress
 * and Levels pages are untouched. All data, copy, forms and
 * actions are exactly as before; the only newly surfaced value
 * is the goal's own end date, already stored on the record,
 * shown on the card's period line when one is set.
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

/** Status chip: active is the neutral blue chip, completed is
 * profit, failed is loss, paused is muted — the same semantics
 * the legacy Tailwind chip colours carried. */
const STATUS_CHIP: Record<string, string> = {
  active: "itg2-chip",
  completed: "itg2-chip itg2-chip-profit",
  failed: "itg2-chip itg2-chip-loss",
  paused: "itg2-chip itg2-chip-muted",
};

/** One icon per goal type (lucide, already used across the
 * app) for the card's icon tile. Presentation only — the type
 * itself comes from the goal record. */
const GOAL_TYPE_ICON: Record<string, LucideIcon> = {
  max_trades: Hash,
  journal_completion: NotebookPen,
  study_hours: BookOpenText,
  backtesting_sessions: History,
  trading_sessions: Activity,
  risk_discipline: ShieldCheck,
  performance_target: TrendingUp,
  other: Flag,
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

  // Header band figures, counted from the same resolved goals
  // the page already lists — no new data is fetched.
  const activeCount = resolved.filter((r) => r.goal.status === "active").length;
  const completedCount = resolved.filter((r) => r.goal.status === "completed").length;

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

  // Hero goal (Phase 18): the active, measurable goal closest
  // to completion leads the page as a raised hero card — the
  // most important goal is also the most prominent. It is
  // picked from the already-resolved goals, so no new data
  // is computed and the goal still appears exactly once.
  const heroGoal = resolved
    .filter((r) => r.goal.status === "active" && r.measurable && r.percent !== null)
    .sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0))[0];
  const listedGoals = heroGoal ? resolved.filter((r) => r !== heroGoal) : resolved;

  return (
    <AppShell email={user.email}>
        <header className="itg2-card itg2-card-flat p-5 sm:p-6">
          <p className="itg2-eyebrow">Goals</p>
          <h1 className="itg2-page-title mt-1.5">Goals &amp; discipline</h1>
          <p className="mt-2 text-muted-foreground">
            Daily, weekly, monthly and yearly goals, measured from your
            real trades and activity where possible — never guessed.
          </p>
          {resolved.length > 0 ? (
            <div className="mt-5 flex flex-wrap gap-x-10 gap-y-3">
              <div>
                <p className="itg2-band-label">Active goals</p>
                <p className="itg2-band-value mt-0.5">{activeCount}</p>
              </div>
              <div>
                <p className="itg2-band-label">Completed</p>
                <p className="itg2-band-value mt-0.5">{completedCount}</p>
              </div>
            </div>
          ) : null}
        </header>

        {motivation ? (
          <blockquote className="itg2-notice mt-6 italic">
            “{motivation.message}”
          </blockquote>
        ) : null}

        {heroGoal && heroGoal.percent !== null && heroGoal.currentValue !== null ? (
          <section className="itg2-hero mt-6 sm:mt-8 p-4 sm:p-6" aria-label="Goal closest to completion">
            <div className="itg2-hero-rings" aria-hidden="true" />
            <div className="itg2-hero-inner">
              <p className="itg2-eyebrow">Closest to completion</p>
              <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="itg2-section-title">{heroGoal.goal.title}</h2>
                <span className="text-sm text-muted-foreground">
                  {PERIOD_LABEL[heroGoal.goal.period] ?? heroGoal.goal.period} ·{" "}
                  {STATUS_LABEL[heroGoal.goal.status] ?? heroGoal.goal.status}
                </span>
              </div>
              <p className="itg2-hero-value mt-3">
                {heroGoal.percent.toFixed(0)}%
              </p>
              <div className="itg2-goalbar-scope mt-4">
                <ProgressBar
                  percent={heroGoal.percent}
                  label={`${heroGoal.goal.title}: ${heroGoal.currentValue} / ${heroGoal.goal.target_value} (${heroGoal.percent.toFixed(0)}%)`}
                />
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {heroGoal.currentValue} / {heroGoal.goal.target_value}
                {heroGoal.goal.target_unit ? ` ${heroGoal.goal.target_unit}` : ""}
                {heroGoal.source === "manual" ? " — recorded by you" : " — measured from your data"}
                {heroGoal.percent >= 100
                  ? " — target reached, mark it complete when you're ready."
                  : ""}
              </p>
            </div>
          </section>
        ) : null}

        <section className="itg2-card itg2-card-flat mt-6 sm:mt-8 p-4 sm:p-6" aria-label="Create a goal">
          <p className="itg2-eyebrow">Create</p>
          <h2 className="itg2-section-title mt-1">New goal</h2>
          <div className="mt-4">
            <GoalForm />
          </div>
        </section>

        <section className="mt-6 sm:mt-8" aria-label="Your goals">
          <p className="itg2-eyebrow">Tracking</p>
          <h2 className="itg2-section-title mt-1">Your goals</h2>
          {resolved.length === 0 ? (
            <div className="itg2-card mt-4 flex items-start gap-3.5 p-5">
              <span className="itg2-kpi-icon" aria-hidden="true">
                <Target className="h-5 w-5" />
              </span>
              <p className="text-muted-foreground">
                No goals yet. Create your first goal above — for example,
                journaling a set number of trades this month.
              </p>
            </div>
          ) : (
            <ul className="mt-4 space-y-4">
              {listedGoals.map((r) => {
                const GoalIcon = GOAL_TYPE_ICON[r.goal.goal_type] ?? Target;
                return (
                <li key={r.goal.id} className="itg2-card itg2-card-flat p-4 sm:p-5">
                  <div className="flex items-start gap-3">
                    <span className="itg2-kpi-icon" aria-hidden="true">
                      <GoalIcon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold">{r.goal.title}</h3>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {PERIOD_LABEL[r.goal.period] ?? r.goal.period}
                        {r.goal.end_date ? ` · ends ${r.goal.end_date}` : ""}
                      </p>
                    </div>
                    <span className={STATUS_CHIP[r.goal.status] ?? "itg2-chip itg2-chip-muted"}>
                      {STATUS_LABEL[r.goal.status] ?? r.goal.status}
                    </span>
                  </div>
                  {r.measurable && r.percent !== null && r.currentValue !== null ? (
                    <div className="mt-3">
                      <div
                        className={`itg2-goalbar-scope${
                          r.goal.status === "completed" ? " itg2-goalbar-done" : ""
                        }`}
                      >
                        <ProgressBar
                          percent={r.percent}
                          label={`${r.goal.title}: ${r.currentValue} / ${r.goal.target_value} (${r.percent.toFixed(0)}%)`}
                        />
                      </div>
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
                );
              })}
            </ul>
          )}
        </section>

        <section className="itg2-card mt-6 sm:mt-8 p-4 sm:p-6" aria-label="Recent discipline reminders">
          <p className="itg2-eyebrow">Discipline</p>
          <h2 className="itg2-section-title mt-1">Recent discipline reminders</h2>
          {events.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No reminders yet. If you miss a day of journaling, a
              supportive reminder appears here and on your dashboard —
              Day 1 is a gentle nudge, Day 2 a warning, Day 3 a stronger
              reminder. Nothing here is ever shaming.
            </p>
          ) : (
            <ul className="mt-2">
              {events.map((e) => (
                <li key={e.id} className="itg2-row">
                  <span>
                    Day {e.level} reminder · {e.message}
                  </span>
                  <span className="shrink-0 text-muted-foreground tnum">{e.event_date}</span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/notifications" className="itg2-link mt-2">
            View all notifications
          </Link>
        </section>
    </AppShell>
  );
}

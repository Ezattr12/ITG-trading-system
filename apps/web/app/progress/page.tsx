import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AppShell } from "@/components/app-shell";
import { displayOrNotProvided } from "@/lib/onboarding/completion";
import { getAnalyticsBundle, type AnalyticsBundle } from "@/lib/analytics/queries";
import { mondayOf, periodPnl, psychologySummary } from "@/lib/analytics/analytics";
import { XpHistoryChart } from "@/components/analytics/charts";
import { ProgressBar } from "@/components/analytics/stat-card";
import { formatMoney } from "@/lib/trades/calculations";

export const metadata = { title: "Progress — ITG TraderOS" };

/**
 * Progress page (Phase 4, spec §28). Historical progress across
 * trading development, discipline, psychology, risk, strategy,
 * journal consistency, goals, level and XP — all from the trader's
 * real rows (trades, xp_transactions, goal_progress,
 * daily_activity). With no history yet, the page says so.
 *
 * Master Web UI Redesign (Task 4 sweep) — PRESENTATION ONLY:
 * the page moved onto the v2 system (flat header band with
 * eyebrow + .itg2-page-title, the level/XP stats as .itg2-kpi
 * cards, goal status as .itg2-chip variants with the shared
 * ProgressBar re-scoped by .itg2-goalbar-scope, both trend
 * tables as .itg2-table, and the shared XP chart re-scoped
 * blue -> cyan by .itg2-xp-scope — XP is not AI, so its old
 * violet glow is gone). All data, copy and empty states are
 * exactly as before.
 */

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  completed: "Completed",
  paused: "Paused",
  failed: "Failed",
};

// Goal status chips (v2). The variant follows the real
// status — completed is a win (profit), active is the
// default blue chip, paused is a warning, failed is a
// loss. Unknown statuses fall back to the muted chip
// showing the raw status string.
const STATUS_CHIP_CLASS: Record<string, string> = {
  completed: "itg2-chip-profit",
  active: "",
  paused: "itg2-chip-warning",
  failed: "itg2-chip-loss",
};

const EMPTY_BUNDLE: AnalyticsBundle = {
  trades: [],
  goals: [],
  xpTotal: 0,
  xpHistory: [],
  levelName: null,
  levelScore: null,
  levels: [],
  dailyActivity: [],
};

export default async function ProgressPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.onboarding?.is_complete) redirect("/onboarding");

  const bundle = isSupabaseConfigured()
    ? await getAnalyticsBundle(await createServerSupabaseClient(), user.id)
    : EMPTY_BUNDLE;
  const psych = psychologySummary(bundle.trades);

  // Weekly journal consistency over the last 12 weeks (closed trades per week).
  const weekly = periodPnl(bundle.trades, "week");
  const journaledByWeek = new Map<string, { trades: number; journaled: number }>();
  for (const t of bundle.trades) {
    const week = mondayOf(new Date(t.closedAt));
    const row = journaledByWeek.get(week) ?? { trades: 0, journaled: 0 };
    row.trades += 1;
    if (t.journaled) row.journaled += 1;
    journaledByWeek.set(week, row);
  }
  const weeklyRows = weekly.slice(-12).map((w) => ({
    ...w,
    journaledPct:
      (journaledByWeek.get(w.label)?.journaled ?? 0) /
      Math.max(1, journaledByWeek.get(w.label)?.trades ?? 0) * 100,
  }));

  // Monthly discipline / confidence trend.
  const byMonth = new Map<string, { trades: number; good: number; rated: number; confidence: number[] }>();
  for (const t of bundle.trades) {
    const month = t.closedAt.slice(0, 7);
    const row = byMonth.get(month) ?? { trades: 0, good: 0, rated: 0, confidence: [] };
    row.trades += 1;
    if (t.discipline !== null) {
      row.rated += 1;
      if (t.discipline === "good") row.good += 1;
    }
    if (t.confidence !== null) row.confidence.push(t.confidence);
    byMonth.set(month, row);
  }
  const monthlyRows = [...byMonth.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([month, row]) => ({
      month,
      trades: row.trades,
      goodDisciplinePct: row.rated === 0 ? null : (row.good / row.rated) * 100,
      avgConfidence:
        row.confidence.length === 0
          ? null
          : row.confidence.reduce((s, c) => s + c, 0) / row.confidence.length,
    }));

  return (
    <AppShell email={user.email}>
        <header className="itg2-card itg2-card-flat p-5 sm:p-6">
          <p className="itg2-eyebrow">Progress</p>
          <h1 className="itg2-page-title mt-1">Progress</h1>
          <p className="mt-2 text-muted-foreground">
            Your development over time — trading, discipline, psychology, risk, strategy, journaling, goals, level and XP.
          </p>
        </header>

        <section className="mt-6 sm:mt-8 grid gap-4 sm:grid-cols-3" aria-label="Level and XP">
          <article className="itg2-card itg2-kpi">
            <h2 className="itg2-kpi-label">Trader level</h2>
            <p className="itg2-kpi-value">
              {bundle.levelName && bundle.levelName.trim() !== "" ? (
                <span className="itg2-text-gold">{bundle.levelName}</span>
              ) : (
                displayOrNotProvided(bundle.levelName)
              )}
            </p>
            <p className="itg2-kpi-hint">
              {bundle.levelScore === null ? "No score yet — journal a trade to start building your level." : `Multi-dimensional score: ${bundle.levelScore.toFixed(1)} / 100 — discipline, risk, journaling, goals, psychology, strategy, consistency and performance.`}
            </p>
          </article>
          <article className="itg2-card itg2-kpi">
            <h2 className="itg2-kpi-label">Total XP</h2>
            <p className="itg2-kpi-value">{`${bundle.xpTotal} XP`}</p>
            <p className="itg2-kpi-hint">Earned for journaling, goals, reviews and discipline.</p>
          </article>
          <article className="itg2-card itg2-kpi">
            <h2 className="itg2-kpi-label">Journal completion</h2>
            <p className="itg2-kpi-value">{`${psych.journalCompletionPct.toFixed(0)}%`}</p>
            <p className="itg2-kpi-hint">Share of closed trades with psychology or a lesson.</p>
          </article>
        </section>

        {/* XP history is the hero of this page — elevated
            surface; the shared chart's violet is re-scoped to
            blue -> cyan by .itg2-xp-scope (XP is not AI). */}
        <section className="itg2-card itg2-card-elevated mt-6 sm:mt-8 p-4 sm:p-6" aria-label="XP history">
          <h2 className="itg2-section-title">XP over time</h2>
          {bundle.xpHistory.length === 0 ? (
            <p className="mt-2 text-muted-foreground">
              No XP yet — XP is earned by journaling trades, completing goals and doing reviews.
            </p>
          ) : (
            <div className="itg2-xp-scope mt-4">
              <XpHistoryChart data={bundle.xpHistory} />
              <p className="mt-2 text-xs text-muted-foreground">
                Cumulative XP from your xp_transactions. Each point is one XP event.
              </p>
            </div>
          )}
        </section>

        <section className="itg2-card mt-6 sm:mt-8 p-4 sm:p-6" aria-label="Goals">
          <h2 className="itg2-section-title">Goals</h2>
          {bundle.goals.length === 0 ? (
            <p className="mt-2 text-muted-foreground">
              No goals yet. Goal progress will be tracked here once you create one.
            </p>
          ) : (
            <div className="mt-4 space-y-4">
              {bundle.goals.map((g) => (
                <div key={g.id}>
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                    {g.title}
                    <span className={`itg2-chip ${STATUS_CHIP_CLASS[g.status] ?? "itg2-chip-muted"}`}>
                      {STATUS_LABEL[g.status] ?? g.status}
                    </span>
                    <span className="font-normal text-muted-foreground">· {g.period}</span>
                  </p>
                  <div className={`itg2-goalbar-scope${g.status === "completed" ? " itg2-goalbar-done" : ""} mt-2`}>
                    <ProgressBar
                      percent={g.percent}
                      label={`${g.currentValue} / ${g.targetValue} (${g.percent.toFixed(0)}%)`}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="itg2-card mt-6 sm:mt-8 p-4 sm:p-6" aria-label="Journal consistency by week">
          <h2 className="itg2-section-title">Journal consistency — last 12 weeks</h2>
          {weeklyRows.length === 0 ? (
            <p className="mt-2 text-muted-foreground">No closed trades yet.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="itg2-table">
                <thead>
                  <tr>
                    <th>Week starting</th>
                    <th>Trades</th>
                    <th>P&amp;L</th>
                    <th>Journaled</th>
                  </tr>
                </thead>
                <tbody>
                  {weeklyRows.map((w) => (
                    <tr key={w.label}>
                      <td>{w.label}</td>
                      <td className="tnum">{w.trades}</td>
                      <td className="tnum">
                        <span className={w.pnl > 0 ? "itg2-text-profit" : w.pnl < 0 ? "itg2-text-loss" : ""}>
                          {formatMoney(w.pnl)}
                        </span>
                      </td>
                      <td className="tnum">{w.journaledPct.toFixed(0)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="itg2-card mt-6 sm:mt-8 p-4 sm:p-6" aria-label="Discipline and psychology by month">
          <h2 className="itg2-section-title">Discipline &amp; psychology by month</h2>
          {monthlyRows.length === 0 ? (
            <p className="mt-2 text-muted-foreground">No closed trades yet.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="itg2-table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Trades</th>
                    <th>Discipline “Good”</th>
                    <th>Avg confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyRows.map((row) => (
                    <tr key={row.month}>
                      <td>{row.month}</td>
                      <td className="tnum">{row.trades}</td>
                      <td className="tnum">
                        {row.goodDisciplinePct === null ? "—" : `${row.goodDisciplinePct.toFixed(0)}%`}
                      </td>
                      <td className="tnum">
                        {row.avgConfidence === null ? "—" : `${row.avgConfidence.toFixed(1)} / 5`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-sm text-muted-foreground">
                Risk behaviour and plan-vs-actual comparison live on the Risk and Plan pages.
              </p>
            </div>
          )}
        </section>
    </AppShell>
  );
}

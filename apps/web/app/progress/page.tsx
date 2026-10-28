import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AppShell } from "@/components/app-shell";
import { displayOrNotProvided } from "@/lib/onboarding/completion";
import { getAnalyticsBundle, type AnalyticsBundle } from "@/lib/analytics/queries";
import { mondayOf, periodPnl, psychologySummary } from "@/lib/analytics/analytics";
import { XpHistoryChart } from "@/components/analytics/charts";
import { ProgressBar, StatCard } from "@/components/analytics/stat-card";

export const metadata = { title: "Progress — ITG TraderOS" };

/**
 * Progress page (Phase 4, spec §28). Historical progress across
 * trading development, discipline, psychology, risk, strategy,
 * journal consistency, goals, level and XP — all from the trader's
 * real rows (trades, xp_transactions, goal_progress,
 * daily_activity). With no history yet, the page says so.
 */

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
        <h1 className="page-title">Progress</h1>
        <p className="page-lede">
          Your development over time — trading, discipline, psychology, risk, strategy, journaling, goals, level and XP.
        </p>

        <section className="mt-6 sm:mt-8 grid gap-4 sm:grid-cols-3" aria-label="Level and XP">
          <StatCard label="Trader level" value={displayOrNotProvided(bundle.levelName)} hint={bundle.levelScore === null ? "No score yet — journal a trade to start building your level." : `Multi-dimensional score: ${bundle.levelScore.toFixed(1)} / 100 — discipline, risk, journaling, goals, psychology, strategy, consistency and performance.`} />
          <StatCard label="Total XP" value={`${bundle.xpTotal} XP`} hint="Earned for journaling, goals, reviews and discipline." />
          <StatCard label="Journal completion" value={`${psych.journalCompletionPct.toFixed(0)}%`} hint="Share of closed trades with psychology or a lesson." />
        </section>

        <section className="mt-6 sm:mt-8 card-surface p-4 sm:p-6" aria-label="XP history">
          <h2 className="section-title">XP over time</h2>
          {bundle.xpHistory.length === 0 ? (
            <p className="mt-2 text-muted-foreground">
              No XP yet — XP is earned by journaling trades, completing goals and doing reviews.
            </p>
          ) : (
            <div className="mt-4">
              <XpHistoryChart data={bundle.xpHistory} />
              <p className="mt-2 text-xs text-muted-foreground">
                Cumulative XP from your xp_transactions. Each point is one XP event.
              </p>
            </div>
          )}
        </section>

        <section className="mt-6 sm:mt-8 card-surface p-4 sm:p-6" aria-label="Goals">
          <h2 className="section-title">Goals</h2>
          {bundle.goals.length === 0 ? (
            <p className="mt-2 text-muted-foreground">
              No goals yet. Goal progress will be tracked here once you create one.
            </p>
          ) : (
            <div className="mt-4 space-y-4">
              {bundle.goals.map((g) => (
                <div key={g.id}>
                  <p className="text-sm font-medium">
                    {g.title} <span className="text-muted-foreground">· {g.period} · {g.status}</span>
                  </p>
                  <div className="mt-2">
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

        <section className="mt-6 sm:mt-8 card-surface p-4 sm:p-6" aria-label="Journal consistency by week">
          <h2 className="section-title">Journal consistency — last 12 weeks</h2>
          {weeklyRows.length === 0 ? (
            <p className="mt-2 text-muted-foreground">No closed trades yet.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Week starting</th>
                    <th className="py-2 pr-4 font-medium">Trades</th>
                    <th className="py-2 pr-4 font-medium">P&amp;L</th>
                    <th className="py-2 font-medium">Journaled</th>
                  </tr>
                </thead>
                <tbody>
                  {weeklyRows.map((w) => (
                    <tr key={w.label} className="border-t">
                      <td className="py-2 pr-4">{w.label}</td>
                      <td className="py-2 pr-4">{w.trades}</td>
                      <td className="py-2 pr-4">{w.pnl.toFixed(2)}</td>
                      <td className="py-2">{w.journaledPct.toFixed(0)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="mt-6 sm:mt-8 card-surface p-4 sm:p-6" aria-label="Discipline and psychology by month">
          <h2 className="section-title">Discipline &amp; psychology by month</h2>
          {monthlyRows.length === 0 ? (
            <p className="mt-2 text-muted-foreground">No closed trades yet.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Month</th>
                    <th className="py-2 pr-4 font-medium">Trades</th>
                    <th className="py-2 pr-4 font-medium">Discipline “Good”</th>
                    <th className="py-2 font-medium">Avg confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyRows.map((row) => (
                    <tr key={row.month} className="border-t">
                      <td className="py-2 pr-4">{row.month}</td>
                      <td className="py-2 pr-4">{row.trades}</td>
                      <td className="py-2 pr-4">
                        {row.goodDisciplinePct === null ? "—" : `${row.goodDisciplinePct.toFixed(0)}%`}
                      </td>
                      <td className="py-2">
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

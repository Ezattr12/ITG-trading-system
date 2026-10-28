import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AppShell } from "@/components/app-shell";
import { displayOrNotProvided } from "@/lib/onboarding/completion";
import { formatMoney } from "@/lib/trades/calculations";
import { getAnalyticsBundle, type AnalyticsBundle } from "@/lib/analytics/queries";
import {
  buildEquityCurve,
  psychologySummary,
  summarizeTrades,
} from "@/lib/analytics/analytics";
import { EquityChart } from "@/components/analytics/charts";
import { Money, Pct, ProgressBar, StatCard } from "@/components/analytics/stat-card";
import { ensureDisciplineReminderLogged } from "@/lib/discipline/actions";
import { getLatestCoachInsights } from "@/lib/coach/queries";
import { progressToNextLevel } from "@/lib/gamification/scoring";
import { motivationContextFor, selectMotivationMessage } from "@/lib/discipline/motivation";
import {
  getLastJournalDate,
  getMotivationMessages,
  getNotifications,
} from "@/lib/discipline/queries";

export const metadata = { title: "Dashboard — ITG TraderOS" };

/**
 * Dashboard (Phase 4, spec §17). Computed from the trader's real
 * closed trades only — no demo trades, no fake P&L. With no trades
 * yet every stat shows "—" and an honest empty state; the AI
 * insights section shows the real latest coach insights (Phase 9)
 * or an honest empty state when none exist yet.
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

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.onboarding?.is_complete) redirect("/onboarding");

  const bundle = isSupabaseConfigured()
    ? await getAnalyticsBundle(await createServerSupabaseClient(), user.id)
    : EMPTY_BUNDLE;
  const summary = summarizeTrades(bundle.trades);
  const psych = psychologySummary(bundle.trades);
  const equity = buildEquityCurve(bundle.trades);

  let recentTrades: { id: string; pair: string; direction: string; opened_at: string; pnl: number | null; status: string }[] = [];
  if (isSupabaseConfigured()) {
    const supabase = await createServerSupabaseClient();
    const { data: recent } = await supabase
      .from("trades")
      .select("id, pair, direction, opened_at, pnl, status")
      .eq("user_id", user.id)
      .order("opened_at", { ascending: false })
      .limit(5);
    recentTrades = (recent ?? []) as typeof recentTrades;
  }

  const bestEmotion = [...psych.byEmotion].sort((a, b) => b.pnl - a.pnl)[0];
  // Real level/XP (Phase 7): multi-dimensional score from the
  // trader's real trades and goals — not profit alone.
  const nextLevel = progressToNextLevel(bundle.levelScore, bundle.levels);
  const streakLabel =
    summary.currentStreak === 0
      ? "—"
      : summary.currentStreak > 0
        ? `${summary.currentStreak} wins in a row`
        : `${Math.abs(summary.currentStreak)} losses in a row`;

  // Discipline reminder (Phase 6): computed from the last journaled
  // day; logging is idempotent — the same level is never logged
  // twice — and a motivation message is picked for the moment.
  const today = new Date().toISOString().slice(0, 10);
  const lastJournalDate = isSupabaseConfigured()
    ? await getLastJournalDate(await createServerSupabaseClient(), user.id)
    : null;
  const reminder = isSupabaseConfigured()
    ? await ensureDisciplineReminderLogged(user.id, lastJournalDate, today)
    : { level: 0 as const, missedDays: 0, title: "", body: "" };
  const goalNearCompletion = bundle.goals.some(
    (g) => g.percent >= 80 && g.percent < 100,
  );
  const hadLossToday = bundle.trades.some(
    (t) => t.closedAt.slice(0, 10) === today && t.pnl < 0,
  );
  const motivationMessages = isSupabaseConfigured()
    ? await getMotivationMessages(await createServerSupabaseClient())
    : [];
  const latestInsights = isSupabaseConfigured()
    ? await getLatestCoachInsights(await createServerSupabaseClient(), user.id, 3)
    : [];
  const recentActivity = isSupabaseConfigured()
    ? await getNotifications(await createServerSupabaseClient(), user.id, 5)
    : [];
  const motivation = selectMotivationMessage(
    motivationMessages,
    motivationContextFor({
      missedDays: lastJournalDate === null ? null : reminder.missedDays,
      goalNearCompletion,
      disciplinedStreak: 0,
      hadLossToday,
    }),
    null,
    today,
  );

  return (
    <AppShell email={user.email}>
      {/* 1. Welcome / current trading status */}
      <h1 className="page-title">
        Welcome{user.profile?.full_name ? `, ${user.profile.full_name}` : ""}
      </h1>
      <p className="page-lede">
        {summary.tradeCount === 0
          ? "No trades yet — add your first trade and your performance will be calculated from it."
          : `${summary.tradeCount} closed trades journaled. All figures below are calculated from your real trades.`}
      </p>

      {/* 2. KPI row — the five numbers that matter most, first. */}
      <section className="mt-6 grid grid-cols-2 gap-3 sm:mt-8 sm:grid-cols-3 sm:gap-4 xl:grid-cols-5" aria-label="Key performance indicators">
        <StatCard label="Current P&L" value={<Money value={summary.tradeCount === 0 ? null : summary.totalPnl} />} hint="Cumulative P&L of closed trades." />
        <StatCard label="Win rate" value={<Pct value={summary.winRate} />} hint={`${summary.wins} wins · ${summary.losses} losses`} />
        <StatCard label="Profit factor" value={summary.profitFactor === null ? "—" : summary.profitFactor.toFixed(2)} hint={summary.profitFactor === null ? "Needs at least one losing trade to calculate." : "Gross profit ÷ gross loss."} />
        <StatCard label="Average R" value={summary.avgR === null ? "—" : `${summary.avgR.toFixed(2)}R`} hint="Average R multiple (needs a stop-loss set)." />
        <div className="col-span-2 sm:col-span-1">
          <StatCard label="Current streak" value={streakLabel} hint={summary.tradeCount === 0 ? "No closed trades yet." : "Consecutive wins or losses."} />
        </div>
      </section>

      {/* 3. Main performance / equity curve. */}
      <section className="card-surface mt-6 p-4 sm:mt-8 sm:p-6" aria-label="Performance chart">
        <h2 className="section-title">Performance</h2>
        {equity.length === 0 ? (
          <p className="mt-2 text-base text-muted-foreground">
            Your equity curve will appear here once you close your first trade.
          </p>
        ) : (
          <>
            <div className="mt-4">
              <EquityChart data={equity} />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Cumulative P&L of closed trades, in close order. Starting capital is not stored, so the curve starts at 0.
            </p>
          </>
        )}
      </section>

      {/* 4. Risk & discipline + 5. Goal progress. */}
      <section className="mt-6 grid gap-4 sm:mt-8 lg:grid-cols-2" aria-label="Risk, discipline and goals">
        <article className="card-surface p-4 sm:p-6">
          <h2 className="section-title">Risk &amp; discipline</h2>
          <ul className="mt-3 space-y-2 text-base">
            <li>Stop-loss set on <strong>{psych.stopLossPct.toFixed(0)}%</strong> of closed trades</li>
            <li>Discipline rated “Good” on <strong>{psych.goodDisciplinePct === null ? "—" : `${psych.goodDisciplinePct.toFixed(0)}%`}</strong> of rated trades</li>
            <li>Journal completion: <strong>{psych.journalCompletionPct.toFixed(0)}%</strong> of closed trades have psychology or a lesson</li>
            <li>Max drawdown: <strong><Money value={summary.tradeCount === 0 ? null : summary.maxDrawdown} /></strong></li>
          </ul>
          {reminder.level > 0 ? (
            <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
              <p className="font-medium">{reminder.title}</p>
              <p className="page-lede">{reminder.body}</p>
            </div>
          ) : (
            <p className="mt-4 text-base text-muted-foreground">
              {lastJournalDate === null
                ? "No journal entries yet — your first reviewed trade starts your discipline streak."
                : "You're up to date with your journaling. Keep it going."}
            </p>
          )}
          {motivation ? (
            <p className="mt-3 text-sm italic text-muted-foreground">“{motivation.message}”</p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
            <Link href="/risk" className="action-link">Risk rules</Link>
            <Link href="/notifications" className="action-link">Notifications</Link>
          </div>
        </article>

        <article className="card-surface p-4 sm:p-6">
          <h2 className="section-title">Goal progress</h2>
          <p className="mt-3 page-title">{displayOrNotProvided(bundle.levelName)}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {bundle.levelScore === null
              ? "No score yet — journal a trade to start building your level."
              : `Score ${bundle.levelScore.toFixed(1)} / 100${nextLevel?.nextLevel ? ` · ${nextLevel.pointsToNext} points to ${nextLevel.nextLevel}` : " · Top level reached"}`}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {bundle.xpTotal} XP · Scored on discipline, risk, journaling, goals,
            psychology, strategy, consistency and performance — not profit alone.
          </p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
            <Link href="/levels" className="action-link">Level &amp; score breakdown</Link>
            <Link href="/achievements" className="action-link">Achievements</Link>
          </div>
          {bundle.goals.length > 0 ? (
            <div className="mt-4 space-y-3">
              {bundle.goals.slice(0, 3).map((g) => (
                <ProgressBar
                  key={g.id}
                  percent={g.percent}
                  label={`${g.title}: ${g.currentValue} / ${g.targetValue} (${g.percent.toFixed(0)}%)`}
                />
              ))}
              <Link href="/progress" className="action-link">
                View all goals and progress
              </Link>
            </div>
          ) : (
            <p className="mt-4 text-base text-muted-foreground">
              No goals yet.{" "}
              <Link href="/goals" className="font-medium underline">
                Create your first goal
              </Link>{" "}
              — for now, journaling builds your XP.
            </p>
          )}
        </article>
      </section>

      {/* 6. Psychology. */}
      <section className="card-surface mt-6 p-4 sm:mt-8 sm:p-6" aria-label="Psychology">
        <h2 className="section-title">Psychology</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <p className="section-label">Average confidence</p>
            <p className="metric-value">{psych.avgConfidence === null ? "—" : `${psych.avgConfidence.toFixed(1)} / 5`}</p>
          </div>
          <div>
            <p className="section-label">Best emotion by P&amp;L</p>
            <p className="metric-value">{bestEmotion ? bestEmotion.emotion : "—"}</p>
            {bestEmotion ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {formatMoney(bestEmotion.pnl)} over {bestEmotion.trades} trades
              </p>
            ) : null}
          </div>
          <div>
            <p className="section-label">Journal completion</p>
            <p className="metric-value">{psych.journalCompletionPct.toFixed(0)}%</p>
          </div>
        </div>
        {psych.byEmotion.length > 0 ? (
          <ul className="mt-4 space-y-2 text-base">
            {[...psych.byEmotion].sort((a, b) => b.trades - a.trades).slice(0, 4).map((row) => (
              <li key={row.emotion} className="flex flex-wrap justify-between gap-x-4 gap-y-1">
                <span className="capitalize">{row.emotion} · {row.trades} trades</span>
                <span className={row.pnl > 0 ? "font-medium text-emerald-400" : row.pnl < 0 ? "font-medium text-red-400" : ""}>
                  {formatMoney(row.pnl)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <Link href="/psychology" className="action-link mt-4">
          Full psychology breakdown
        </Link>
      </section>

      {/* 7. Recent trades. */}
      <section className="card-surface mt-6 p-4 sm:mt-8 sm:p-6" aria-label="Recent trades">
        <h2 className="section-title">Recent trades</h2>
        {recentTrades.length === 0 ? (
          <p className="mt-2 text-base text-muted-foreground">No trades yet.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-base">
            {recentTrades.map((t) => (
              <li key={t.id} className="flex flex-wrap justify-between gap-x-4 gap-y-1">
                <Link href={`/trades/${t.id}`} className="min-h-11 font-medium underline underline-offset-4">
                  {t.pair} · {t.direction} · {new Date(t.opened_at).toLocaleDateString()}
                </Link>
                <span className={t.pnl === null ? "" : t.pnl > 0 ? "font-medium text-emerald-400" : t.pnl < 0 ? "font-medium text-red-400" : ""}>
                  {t.status === "open" ? "Open" : formatMoney(t.pnl)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
          <Link href="/trades/new" className="action-link">Add a trade</Link>
          <Link href="/trades" className="action-link">View all trades</Link>
          <Link href="/calendar" className="action-link">Trading calendar</Link>
        </div>
      </section>

      {/* 8. AI Coach insights. */}
      <section className="card-surface mt-6 p-4 sm:mt-8 sm:p-6" aria-label="AI insights">
        <h2 className="section-title">AI Coach insights</h2>
        {latestInsights.length === 0 ? (
          <p className="mt-2 text-base text-muted-foreground">
            No coach insights yet — the AI Coach analyses your real trades once you have at
            least 3 closed trades in a week. Nothing here is generated or estimated.
          </p>
        ) : (
          <ul className="mt-3 space-y-2 text-base">
            {latestInsights.map((insight) => (
              <li key={insight.id}>
                <span className="font-medium">{insight.summary}</span>
                <span className="text-muted-foreground">
                  {" — "}
                  {insight.metrics_snapshot.recommendation}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Link href="/coach" className="action-link mt-4">
          Open AI Coach
        </Link>
      </section>

      {/* 9. Recent activity — real notifications only, never invented. */}
      <section className="card-surface mt-6 p-4 sm:mt-8 sm:p-6" aria-label="Recent activity">
        <h2 className="section-title">Recent activity</h2>
        {recentActivity.length === 0 ? (
          <p className="mt-2 text-base text-muted-foreground">
            No activity yet — achievements, risk milestones and coach insights will appear here as they happen.
          </p>
        ) : (
          <ul className="mt-3 space-y-3 text-base">
            {recentActivity.map((n) => (
              <li key={n.id} className="flex flex-wrap justify-between gap-x-4 gap-y-1">
                <span className="font-medium">{n.title}</span>
                <span className="text-sm text-muted-foreground">
                  {new Date(n.created_at).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Link href="/notifications" className="action-link mt-4">
          All notifications
        </Link>
      </section>
    </AppShell>
  );
}

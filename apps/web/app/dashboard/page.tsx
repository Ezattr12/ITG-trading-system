import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AppHeader } from "@/components/app-header";
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
    <div className="min-h-screen">
      <AppHeader email={user.email} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-bold">
          Welcome{user.profile?.full_name ? `, ${user.profile.full_name}` : ""}
        </h1>
        <p className="mt-1 text-muted-foreground">
          {summary.tradeCount === 0
            ? "No trades yet — add your first trade and your performance will be calculated from it."
            : `${summary.tradeCount} closed trades journaled. All figures below are calculated from your real trades.`}
        </p>

        <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Performance">
          <StatCard label="Current P&L (closed trades)" value={<Money value={summary.tradeCount === 0 ? null : summary.totalPnl} />} hint="Cumulative P&L of closed trades. Open trades have no P&L yet." />
          <StatCard label="Win rate" value={<Pct value={summary.winRate} />} hint={`${summary.wins} wins · ${summary.losses} losses`} />
          <StatCard label="Profit factor" value={summary.profitFactor === null ? "—" : summary.profitFactor.toFixed(2)} hint={summary.profitFactor === null ? "Needs at least one losing trade to calculate." : "Gross profit ÷ gross loss."} />
          <StatCard label="Average R" value={summary.avgR === null ? "—" : `${summary.avgR.toFixed(2)}R`} hint="Average R multiple (needs a stop-loss set)." />
          <StatCard label="Current streak" value={streakLabel} />
          <StatCard label="Max drawdown" value={<Money value={summary.tradeCount === 0 ? null : summary.maxDrawdown} />} hint="Largest peak-to-trough fall in cumulative P&L." />
        </section>

        <section className="mt-8 grid gap-4 lg:grid-cols-2" aria-label="Progress and discipline">
          <article className="rounded-lg border bg-card p-4">
            <h2 className="text-sm font-medium text-muted-foreground">Trader level</h2>
            <p className="mt-2 text-xl font-semibold">{displayOrNotProvided(bundle.levelName)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {bundle.levelScore === null
                ? "No score yet — journal a trade to start building your level."
                : `Score ${bundle.levelScore.toFixed(1)} / 100${nextLevel?.nextLevel ? ` · ${nextLevel.pointsToNext} points to ${nextLevel.nextLevel}` : " · Top level reached"}`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {bundle.xpTotal} XP · Scored on discipline, risk, journaling, goals,
              psychology, strategy, consistency and performance — not profit alone.
            </p>
            <div className="mt-3 flex gap-4">
              <Link href="/levels" className="text-sm font-medium underline">
                Level &amp; score breakdown
              </Link>
              <Link href="/achievements" className="text-sm font-medium underline">
                Achievements
              </Link>
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
                <Link href="/progress" className="text-sm font-medium underline">
                  View all goals and progress
                </Link>
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">
                No goals yet.{" "}
                <Link href="/goals" className="font-medium underline">
                  Create your first goal
                </Link>{" "}
                — for now, journaling builds your XP.
              </p>
            )}
          </article>
          <article className="rounded-lg border bg-card p-4">
            <h2 className="text-sm font-medium text-muted-foreground">Risk discipline</h2>
            <ul className="mt-2 space-y-2 text-sm">
              <li>Stop-loss set on <strong>{psych.stopLossPct.toFixed(0)}%</strong> of closed trades</li>
              <li>Discipline rated “Good” on <strong>{psych.goodDisciplinePct === null ? "—" : `${psych.goodDisciplinePct.toFixed(0)}%`}</strong> of rated trades</li>
              <li>Journal completion: <strong>{psych.journalCompletionPct.toFixed(0)}%</strong> of closed trades have psychology or a lesson</li>
              <li>Average confidence: <strong>{psych.avgConfidence === null ? "—" : `${psych.avgConfidence.toFixed(1)} / 5`}</strong></li>
              {bestEmotion ? (
                <li>Best emotion by P&L: <strong>{bestEmotion.emotion}</strong> ({formatMoney(bestEmotion.pnl)} over {bestEmotion.trades} trades)</li>
              ) : null}
            </ul>
            <Link href="/analytics" className="mt-3 inline-block text-sm font-medium underline">
              Full analytics
            </Link>
          </article>
        </section>

        <section className="mt-8 rounded-lg border bg-card p-6" aria-label="Discipline">
          <h2 className="text-lg font-semibold">Discipline</h2>
          {reminder.level > 0 ? (
            <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
              <p className="font-medium">{reminder.title}</p>
              <p className="mt-1 text-muted-foreground">{reminder.body}</p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              {lastJournalDate === null
                ? "No journal entries yet — your first reviewed trade starts your discipline streak."
                : "You're up to date with your journaling. Keep it going."}
            </p>
          )}
          {motivation ? (
            <p className="mt-3 text-sm italic text-muted-foreground">“{motivation.message}”</p>
          ) : null}
          <div className="mt-4 flex gap-4">
            <Link href="/goals" className="text-sm font-medium underline">Goals &amp; discipline</Link>
            <Link href="/notifications" className="text-sm font-medium underline">Notifications</Link>
          </div>
        </section>

        <section className="mt-8 rounded-lg border bg-card p-6" aria-label="Performance chart">
          <h2 className="text-lg font-semibold">Performance</h2>
          {equity.length === 0 ? (
            <p className="mt-2 text-muted-foreground">
              Your equity curve will appear here once you close your first trade.
            </p>
          ) : (
            <>
              <div className="mt-4">
                <EquityChart data={equity} />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Cumulative P&L of closed trades, in close order. Starting capital is not stored, so the curve starts at 0.
              </p>
            </>
          )}
        </section>

        <section className="mt-8 rounded-lg border bg-card p-6" aria-label="Recent trades">
          <h2 className="text-lg font-semibold">Recent trades</h2>
          {recentTrades.length === 0 ? (
            <p className="mt-2 text-muted-foreground">No trades yet.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {recentTrades.map((t) => (
                <li key={t.id} className="flex justify-between gap-4">
                  <Link href={`/trades/${t.id}`} className="underline">
                    {t.pair} · {t.direction} · {new Date(t.opened_at).toLocaleDateString()}
                  </Link>
                  <span className={t.pnl === null ? "" : t.pnl > 0 ? "text-emerald-400" : t.pnl < 0 ? "text-red-400" : ""}>
                    {t.status === "open" ? "Open" : formatMoney(t.pnl)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex gap-4">
            <Link href="/trades/new" className="text-sm font-medium underline">Add a trade</Link>
            <Link href="/trades" className="text-sm font-medium underline">View all trades</Link>
            <Link href="/calendar" className="text-sm font-medium underline">Trading calendar</Link>
          </div>
        </section>

        <section className="mt-8 rounded-lg border bg-card p-6" aria-label="AI insights">
          <h2 className="text-lg font-semibold">AI insights</h2>
          {latestInsights.length === 0 ? (
            <p className="mt-2 text-muted-foreground">
              No coach insights yet — the AI Coach analyses your real trades once you have at
              least 3 closed trades in a week. Nothing here is generated or estimated.
            </p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
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
          <div className="mt-4">
            <Link href="/coach" className="text-sm font-medium underline">
              Open AI Coach
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}

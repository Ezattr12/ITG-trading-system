import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AppShell } from "@/components/app-shell";
import { mondayOfWeek } from "@/lib/reviews/reviews";
import { getAiInsights, getAiInsightsForWeek, getCoachWeekData } from "@/lib/coach/queries";
import { generateCoachInsights } from "@/lib/coach/insights";
import { COACH_MIN_TRADES } from "@/lib/coach/types";
import type { AiInsightRow } from "@/lib/coach/types";
import { RefreshCoachForm } from "@/components/coach/refresh-coach-form";
import { BacktestingForm } from "@/components/coach/backtesting-form";

export const metadata = { title: "AI Coach — ITG TraderOS" };

/**
 * AI Coach (Phase 9, spec §28, §39).
 *
 * Deterministic, data-grounded coach — no external LLM is
 * called and none is claimed. The page shows this week's
 * analysis computed live from the trader's real trades (with
 * an honest "not enough trades yet" state when there are fewer
 * than 3 closed trades), the stored insight history, a refresh
 * action that stores only new or changed insights, and a
 * backtesting log that wires the +15 XP trigger.
 */

const SEVERITY_LABEL: Record<string, string> = {
  high: "High priority",
  medium: "Medium priority",
  low: "Low priority",
  positive: "Positive",
};

function InsightCard({ insight }: { insight: AiInsightRow }) {
  const s = insight.metrics_snapshot;
  const evidence: string[] = [];
  if (s.trades !== undefined) evidence.push(`${s.trades} trades`);
  if (s.totalPnl !== undefined) evidence.push(`total P&L ${s.totalPnl.toFixed(2)}`);
  if (s.winRate !== undefined && s.winRate !== null) evidence.push(`win rate ${s.winRate}%`);
  if (s.occurrences !== undefined) evidence.push(`${s.occurrences} occurrences`);
  if (s.disciplinePct !== undefined && s.disciplinePct !== null)
    evidence.push(`stop-loss on ${s.disciplinePct}% of trades`);
  if (s.journalCompletionPct !== undefined && s.journalCompletionPct !== null)
    evidence.push(`journal completion ${s.journalCompletionPct}%`);
  if (s.criticalRiskEvents !== undefined) evidence.push(`${s.criticalRiskEvents} critical risk events`);
  if (s.goalsTotal !== undefined) evidence.push(`goals ${s.goalsCompleted ?? 0}/${s.goalsTotal}`);
  return (
    <article className="card-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">{insight.summary}</h3>
        <span className="text-xs text-muted-foreground">
          {SEVERITY_LABEL[s.severity] ?? s.severity} · {insight.insight_type.replaceAll("_", " ")}
        </span>
      </div>
      {evidence.length > 0 && (
        <p className="mt-1 text-sm text-muted-foreground">Evidence: {evidence.join(" · ")}.</p>
      )}
      <p className="mt-2 text-sm">{s.recommendation}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        Week {insight.period_start} to {insight.period_end} · generated{" "}
        {new Date(insight.generated_at).toLocaleDateString()}
      </p>
    </article>
  );
}

export default async function CoachPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.onboarding?.is_complete) redirect("/onboarding");

  const today = new Date().toISOString().slice(0, 10);
  const monday = mondayOfWeek(today) ?? today;

  let liveInsights: AiInsightRow[] = [];
  let isPreview = false;
  let insufficient = false;
  let storedHistory: AiInsightRow[] = [];
  if (isSupabaseConfigured()) {
    const supabase = await createServerSupabaseClient();
    const evidence = await getCoachWeekData(supabase, user.id, monday);
    if (evidence) {
      const analysis = generateCoachInsights(evidence);
      insufficient = analysis.insufficientData;
      if (!analysis.insufficientData) {
        // Live preview of what a refresh would store (not stored
        // until the trader clicks Refresh analysis).
        const stored = await getAiInsightsForWeek(
          supabase,
          user.id,
          analysis.periodStart,
          analysis.periodEnd,
        );
        liveInsights = stored.length > 0 ? stored : [];
        if (stored.length === 0) {
          isPreview = true;
          liveInsights = analysis.insights.map((insight, i) => ({
            id: `preview-${i}`,
            user_id: user.id,
            insight_type: insight.type,
            period_start: analysis.periodStart,
            period_end: analysis.periodEnd,
            summary: insight.title,
            metrics_snapshot: insight.metricsSnapshot,
            generated_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
          }));
        }
      }
    }
    storedHistory = await getAiInsights(supabase, user.id, 50);
  }

  return (
    <AppShell email={user.email}>
        <h1 className="page-title">AI Coach</h1>
        <p className="page-lede">
          Weekly analysis of your own trading data — performance, mistakes, strategies, psychology,
          risk, goals and discipline. Every insight cites the real numbers it was computed from.
          No external AI service is connected yet: this coach is a deterministic analysis of your
          stored trades, not a language model.
        </p>

        <section className="mt-6 sm:mt-8 card-surface p-4 sm:p-6" aria-label="This week's analysis">
          <h2 className="section-title">This week&apos;s analysis</h2>
          {!isSupabaseConfigured() ? (
            <p className="mt-2 text-muted-foreground">
              Supabase is not connected, so there is no trading data to analyse yet.
            </p>
          ) : insufficient ? (
            <p className="mt-2 text-muted-foreground">
              Not enough trades yet to analyse this week — the coach needs at least{" "}
              {COACH_MIN_TRADES} closed trades. Journal a few more trades and refresh again.
            </p>
          ) : liveInsights.length === 0 ? (
            <p className="mt-2 text-muted-foreground">
              No insights for this week yet. Use “Refresh analysis” below to generate them from
              your trades.
            </p>
          ) : (
            <div className="mt-4 space-y-4">
              {liveInsights.map((insight) => (
                <InsightCard key={insight.id} insight={insight} />
              ))}
              {isPreview && (
                <p className="text-xs text-muted-foreground">
                  Insights shown above are a live preview until you refresh — refresh stores them
                  so they appear in your history and on the dashboard.
                </p>
              )}
            </div>
          )}
          <RefreshCoachForm defaultWeekStart={monday} />
        </section>

        <section className="mt-6 sm:mt-8 card-surface p-4 sm:p-6" aria-label="Backtesting">
          <h2 className="section-title">Backtesting</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Log the backtesting sessions you completed. Each session earns +15 XP.
          </p>
          <BacktestingForm defaultDate={today} />
        </section>

        <section className="mt-6 sm:mt-8" aria-label="Insight history">
          <h2 className="section-title">Insight history</h2>
          {storedHistory.length === 0 ? (
            <p className="mt-2 text-muted-foreground">
              No stored insights yet — refresh an analysis to start your history.
            </p>
          ) : (
            <div className="mt-4 space-y-4">
              {storedHistory.map((insight) => (
                <InsightCard key={insight.id} insight={insight} />
              ))}
            </div>
          )}
          <p className="mt-4 text-sm">
            <Link href="/reviews/weekly" className="underline">
              Weekly review
            </Link>
            {" · "}
            <Link href="/reports" className="underline">
              Reports
            </Link>
          </p>
        </section>
    </AppShell>
  );
}

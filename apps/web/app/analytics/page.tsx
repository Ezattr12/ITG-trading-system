import { redirect } from "next/navigation";
import Link from "next/link";
import type { CSSProperties } from "react";
import { BarChart3 } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AppShell } from "@/components/app-shell";
import { formatMoney } from "@/lib/trades/calculations";
import { getAnalyticsBundle, type AnalyticsBundle } from "@/lib/analytics/queries";
import {
  breakdownByDirection,
  breakdownBySession,
  breakdownByStrategy,
  buildEquityCurve,
  periodPnl,
  psychologySummary,
  rDistribution,
  summarizeTrades,
} from "@/lib/analytics/analytics";
import type { BreakdownRow } from "@/lib/analytics/types";
import {
  DrawdownChart,
  EquityChart,
  PeriodPnlChart,
  RDistributionChart,
} from "@/components/analytics/charts";
import { IntelligenceSection } from "@/components/analytics/intelligence";
import { getIntelligenceOverview } from "@/lib/intelligence/queries";
import { Money, Pct, StatCard, type StatCardGlow } from "@/components/analytics/stat-card";

export const metadata = { title: "Analytics — ITG TraderOS" };

/**
 * Analytics (Phase 4, spec §18). Every figure is computed from the
 * trader's real closed trades. With no trades, every section shows
 * an honest empty state — no charts are drawn from invented data.
 * Each chart is paired with a plain data table.
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

function BreakdownTable({ title, rows }: { title: string; rows: BreakdownRow[] }) {
  if (rows.length === 0) {
    return (
      <section className="itg-analytics-secondary-card">
        <h2 className="section-title">{title}</h2>
        <p className="mt-2 text-muted-foreground">No closed trades yet.</p>
      </section>
    );
  }
  // The best-P&L group gets a small pill (Phase 18) — derived
  // from the real rows, shown only when there is more than one
  // group to compare. It is a reading aid, not a judgement:
  // the "best" group can still be a losing one.
  const best = rows.length > 1 ? rows.reduce((m, r) => (r.pnl > m.pnl ? r : m), rows[0]) : null;
  return (
    <section className="itg-analytics-secondary-card">
      <h2 className="section-title">{title}</h2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Group</th>
              <th className="py-2 pr-4 font-medium">Trades</th>
              <th className="py-2 pr-4 font-medium">P&amp;L</th>
              <th className="py-2 pr-4 font-medium">Win rate</th>
              <th className="py-2 pr-4 font-medium">Avg R</th>
              <th className="py-2 font-medium">Avg win / loss</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-border transition-colors hover:bg-accent/40">
                <td className="py-2.5 pr-4 font-medium">
                  {r.label}
                  {best !== null && r.key === best.key ? (
                    <span className="ml-2 whitespace-nowrap rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
                      Best P&amp;L
                    </span>
                  ) : null}
                </td>
                <td className="py-2.5 pr-4 tabular-nums">{r.trades}</td>
                <td className="py-2.5 pr-4"><Money value={r.pnl} /></td>
                <td className="py-2.5 pr-4"><Pct value={r.winRate} /></td>
                <td className="py-2.5 pr-4">{r.avgR === null ? "—" : `${r.avgR.toFixed(2)}R`}</td>
                <td className="py-2.5 tabular-nums">
                  {formatMoney(r.avgWin)} / {formatMoney(r.avgLoss)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const PERIOD_LABELS: Record<string, string> = { day: "Daily", week: "Weekly", month: "Monthly" };

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams?: Promise<{ period?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.onboarding?.is_complete) redirect("/onboarding");

  const params = await searchParams;
  const period = params?.period === "week" || params?.period === "month" ? params.period : "day";

  const bundle = isSupabaseConfigured()
    ? await getAnalyticsBundle(await createServerSupabaseClient(), user.id)
    : EMPTY_BUNDLE;
  // Advanced intelligence (Phase 23): the deeper analyses
  // over the same real trades, rendered as their own section
  // below — existing figures above are untouched.
  const intelligence = isSupabaseConfigured()
    ? await getIntelligenceOverview(await createServerSupabaseClient(), user.id)
    : null;
  const summary = summarizeTrades(bundle.trades);
  const equity = buildEquityCurve(bundle.trades);
  const periods = periodPnl(bundle.trades, period);
  const rDist = rDistribution(bundle.trades);
  const psych = psychologySummary(bundle.trades);
  const hasTrades = bundle.trades.length > 0;
  // Value-driven glows (Phase 18): the P&L and profit-factor
  // cards follow their real sign; max drawdown is a risk
  // figure, so it carries the red risk glow when it exists.
  const totalPnlGlow: StatCardGlow | undefined =
    !hasTrades || summary.totalPnl === 0
      ? undefined
      : summary.totalPnl > 0
        ? "emerald"
        : "danger";
  const profitFactorGlow: StatCardGlow | undefined =
    summary.profitFactor === null
      ? undefined
      : summary.profitFactor > 1
        ? "emerald"
        : summary.profitFactor < 1
          ? "danger"
          : undefined;

  // Best / worst trade (Phase 19): a tiny UI adapter over the
  // trades already loaded for this page — the highest and
  // lowest P&L among closed trades with a recorded P&L. No
  // calculation changes; no new data source.
  const closedWithPnl = bundle.trades.filter(
    (t): t is typeof t & { pnl: number } => t.pnl !== null,
  );
  const bestTrade =
    closedWithPnl.length > 0
      ? closedWithPnl.reduce((m, t) => (t.pnl > m.pnl ? t : m), closedWithPnl[0])
      : null;
  const worstTrade =
    closedWithPnl.length > 0
      ? closedWithPnl.reduce((m, t) => (t.pnl < m.pnl ? t : m), closedWithPnl[0])
      : null;
  const heroPnlClass =
    !hasTrades || summary.totalPnl === 0
      ? ""
      : summary.totalPnl > 0
        ? " itg-pnl-positive"
        : " itg-pnl-negative";

  return (
    <AppShell email={user.email}>
      <div className="relative">
        <div className="itg-analytics-grid" aria-hidden="true">
          <div className="itg-analytics-grid-inner" />
        </div>
        <div className="relative z-[1]">
        <h1 className="itg-analytics-title">Analytics</h1>
        <p className="itg-analytics-description">
          {hasTrades
            ? `${summary.tradeCount} closed trades. All figures are calculated from your real trades.`
            : "No closed trades yet — your analytics will appear here once you close trades."}
        </p>

        <section className="mt-6 sm:mt-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4" aria-label="Performance summary">
          <StatCard label="Total P&L" glow={totalPnlGlow} value={<Money value={hasTrades ? summary.totalPnl : null} />} />
          <StatCard label="Win rate / loss rate" value={<><Pct value={summary.winRate} /> / <Pct value={summary.lossRate} /></>} />
          <StatCard label="Average win / loss" value={<>{formatMoney(summary.avgWin)} / {formatMoney(summary.avgLoss)}</>} />
          <StatCard label="Profit factor" glow={profitFactorGlow} value={summary.profitFactor === null ? "—" : summary.profitFactor.toFixed(2)} hint={summary.profitFactor === null && hasTrades ? "No losing trades yet — the factor is unbounded." : undefined} />
          <StatCard label="Expectancy (per trade)" value={<Money value={summary.expectancy} />} />
          <StatCard label="Max drawdown" glow={hasTrades ? "danger" : undefined} value={<Money value={hasTrades ? summary.maxDrawdown : null} />} />
          <StatCard label="Trade count" value={hasTrades ? summary.tradeCount : "—"} />
          <StatCard label="Average R" value={summary.avgR === null ? "—" : `${summary.avgR.toFixed(2)}R`} />
        </section>

        {/* Performance hero (Phase 18 hero, Phase 19 glass):
            the equity curve is the hero of this page — the
            current P&L in its real sign colour in the header,
            the real equity chart in its glass container, the
            data table below. With no trades, the premium
            glass empty state replaces the chart — no chart is
            drawn from invented data. The hero deliberately
            has no time-range control: the existing day/week/
            month control belongs to P&L by period below, and
            the equity curve is the full history. */}
        <section className="itg-analytics-performance" aria-label="Equity curve">
          <div className="itg-analytics-performance-header">
            <div>
              <p className="eyebrow text-xs font-semibold uppercase tracking-widest">Performance</p>
              <h2 className="section-title mt-1">Equity curve</h2>
              <p className={`itg-analytics-performance-value${heroPnlClass}`}>
                <Money value={hasTrades ? summary.totalPnl : null} />
              </p>
            </div>
          </div>
          {hasTrades ? (
            <>
              <div className="itg-analytics-chart"><EquityChart data={equity} /></div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">Date closed</th>
                      <th className="py-2 pr-4 font-medium">Cumulative P&amp;L</th>
                      <th className="py-2 font-medium">Drawdown</th>
                    </tr>
                  </thead>
                  <tbody>
                    {equity.map((p) => (
                      <tr key={`${p.date}-${p.trades}`} className="border-t border-border transition-colors hover:bg-accent/40">
                        <td className="py-2.5 pr-4">{p.date}</td>
                        <td className="py-2.5 pr-4"><Money value={p.equity} /></td>
                        <td className="py-2.5"><Money value={p.drawdown} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="itg-analytics-empty">
              <span className="itg-analytics-empty-icon" aria-hidden="true">
                <BarChart3 className="h-7 w-7" />
              </span>
              <h3 className="itg-analytics-empty-title">No closed trades yet</h3>
              <p className="itg-analytics-empty-text">
                Your equity curve and analytics will appear here once you close your first trade.
              </p>
            </div>
          )}
        </section>

        <div className="itg-analytics-secondary">
          {/* Win / loss ring (Phase 19): the ring fill comes
              from the real computed win rate via --win-rate
              (never hardcoded); the stat rows beside it are
              the real wins, losses, rates and best/worst
              trades. */}
          <section className="itg-analytics-secondary-card" aria-label="Win and loss">
            <h2 className="section-title">Win / loss</h2>
            {hasTrades ? (
              <div className="itg-win-loss">
                <div
                  className="itg-win-ring"
                  style={{ "--win-rate": `${summary.winRate ?? 0}%` } as CSSProperties}
                  role="img"
                  aria-label={`Win rate ${summary.winRate === null ? "not available" : `${summary.winRate.toFixed(1)} percent`}`}
                >
                  <span className="itg-win-ring-content">{summary.winRate === null ? "—" : `${summary.winRate.toFixed(0)}%`}</span>
                </div>
                <div className="itg-win-stats">
                  <div className="itg-stat-row"><span className="itg-stat-row-label">Wins</span><span className="itg-stat-row-value tabular-nums">{summary.wins}</span></div>
                  <div className="itg-stat-row"><span className="itg-stat-row-label">Losses</span><span className="itg-stat-row-value tabular-nums">{summary.losses}</span></div>
                  <div className="itg-stat-row"><span className="itg-stat-row-label">Win rate</span><span className="itg-stat-row-value"><Pct value={summary.winRate} /></span></div>
                  <div className="itg-stat-row"><span className="itg-stat-row-label">Loss rate</span><span className="itg-stat-row-value"><Pct value={summary.lossRate} /></span></div>
                  <div className="itg-stat-row"><span className="itg-stat-row-label">Best trade</span><span className="itg-stat-row-value">{bestTrade ? <>{bestTrade.pair} · <Money value={bestTrade.pnl} /></> : "—"}</span></div>
                  <div className="itg-stat-row"><span className="itg-stat-row-label">Worst trade</span><span className="itg-stat-row-value">{worstTrade ? <>{worstTrade.pair} · <Money value={worstTrade.pnl} /></> : "—"}</span></div>
                </div>
              </div>
            ) : (
              <p className="mt-2 text-muted-foreground">Your win/loss split will appear here once you close trades.</p>
            )}
          </section>

          <section className="itg-analytics-secondary-card" aria-label="Drawdown">
            <h2 className="section-title">Drawdown</h2>
            {hasTrades ? (
              <div className="mt-4">
                <DrawdownChart data={equity.map((p) => ({ date: p.date, drawdown: p.drawdown }))} />
                <p className="mt-2 text-xs text-muted-foreground">
                  Fall from the running peak in cumulative P&amp;L. Maximum drawdown: {formatMoney(summary.maxDrawdown)}.
                </p>
              </div>
            ) : (
              <p className="mt-2 text-muted-foreground">No drawdown to show yet.</p>
            )}
          </section>

          <section className="itg-analytics-secondary-card" aria-label="Profit and loss by period">
            <h2 className="section-title">P&amp;L by period</h2>
            <div className="itg-range mt-3" role="tablist" aria-label="Period">
              {(["day", "week", "month"] as const).map((p) => (
                <Link
                  key={p}
                  href={`/analytics?period=${p}`}
                  aria-current={period === p ? "true" : undefined}
                >
                  {PERIOD_LABELS[p]}
                </Link>
              ))}
            </div>
            {hasTrades ? (
              <>
                <div className="mt-4"><PeriodPnlChart data={periods} /></div>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="py-2 pr-4 font-medium">Period</th>
                        <th className="py-2 pr-4 font-medium">P&amp;L</th>
                        <th className="py-2 pr-4 font-medium">Trades</th>
                        <th className="py-2 font-medium">Wins</th>
                      </tr>
                    </thead>
                    <tbody>
                      {periods.map((p) => (
                        <tr key={p.label} className="border-t border-border transition-colors hover:bg-accent/40">
                          <td className="py-2.5 pr-4">{p.label}</td>
                          <td className="py-2.5 pr-4"><Money value={p.pnl} /></td>
                          <td className="py-2.5 pr-4 tabular-nums">{p.trades}</td>
                          <td className="py-2.5 tabular-nums">{p.wins}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="mt-2 text-muted-foreground">No P&amp;L by period yet.</p>
            )}
          </section>

          <section className="itg-analytics-secondary-card" aria-label="R distribution">
            <h2 className="section-title">R distribution</h2>
            {hasTrades ? (
              <>
                <div className="mt-4">
                  <RDistributionChart data={rDist.buckets} />
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {rDist.noR > 0
                    ? `${rDist.noR} trade(s) have no R multiple (no stop-loss set) and are not in the chart.`
                    : "Every closed trade has an R multiple."}
                </p>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="py-2 pr-4 font-medium">R bucket</th>
                        <th className="py-2 font-medium">Trades</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rDist.buckets.map((b) => (
                        <tr key={b.label} className="border-t border-border transition-colors hover:bg-accent/40">
                          <td className="py-2.5 pr-4">{b.label}</td>
                          <td className="py-2.5 tabular-nums">{b.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="mt-2 text-muted-foreground">Your R distribution will appear here once you close trades with a stop-loss.</p>
            )}
          </section>

          <BreakdownTable title="By strategy" rows={breakdownByStrategy(bundle.trades)} />
          <BreakdownTable title="By session" rows={breakdownBySession(bundle.trades)} />
          <BreakdownTable title="By direction" rows={breakdownByDirection(bundle.trades)} />

          <section className="itg-analytics-secondary-card" aria-label="Psychology">
            <h2 className="section-title">Psychology vs performance</h2>
            {psych.byEmotion.length === 0 ? (
              <p className="mt-2 text-muted-foreground">
                No psychology records yet — add confidence, emotion and discipline in a trade&apos;s advanced review.
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">Emotion</th>
                      <th className="py-2 pr-4 font-medium">Trades</th>
                      <th className="py-2 pr-4 font-medium">P&amp;L</th>
                      <th className="py-2 font-medium">Win rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {psych.byEmotion.map((row) => (
                      <tr key={row.emotion} className="border-t border-border transition-colors hover:bg-accent/40">
                        <td className="py-2.5 pr-4 font-medium capitalize">{row.emotion}</td>
                        <td className="py-2.5 pr-4 tabular-nums">{row.trades}</td>
                        <td className="py-2.5 pr-4"><Money value={row.pnl} /></td>
                        <td className="py-2.5"><Pct value={row.winRate} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-3 text-sm text-muted-foreground">
                  Average confidence: {psych.avgConfidence === null ? "—" : `${psych.avgConfidence.toFixed(1)} / 5`} · Discipline “Good”:{" "}
                  {psych.goodDisciplinePct === null ? "—" : `${psych.goodDisciplinePct.toFixed(0)}%`}
                </p>
              </div>
            )}
          </section>
        </div>

        {intelligence ? <IntelligenceSection data={intelligence} /> : null}
        </div>
      </div>
    </AppShell>
  );
}

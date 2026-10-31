import { redirect } from "next/navigation";
import Link from "next/link";
import type { CSSProperties } from "react";
import {
  BarChart3,
  CircleDollarSign,
  Crosshair,
  Hash,
  Scale,
  Sigma,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
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
import { Money, Pct } from "@/components/analytics/stat-card";

/** KPI tone -> icon tile / status chip modifier (v2, the
 * same maps as the Dashboard). The tone is always derived
 * from the real value in the page body. */
const KPI_ICON_TONE = {
  profit: " itg2-kpi-icon-profit",
  loss: " itg2-kpi-icon-loss",
  neutral: "",
} as const;
const KPI_CHIP_TONE = {
  profit: " itg2-chip-profit",
  loss: " itg2-chip-loss",
  neutral: "",
} as const;

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
      <section className="itg2-card p-5 sm:p-6">
        <p className="itg2-eyebrow">Breakdown</p>
        <h2 className="itg2-section-title mt-1">{title}</h2>
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
    <section className="itg2-card p-5 sm:p-6">
      <p className="itg2-eyebrow">Breakdown</p>
      <h2 className="itg2-section-title mt-1">{title}</h2>
      <div className="mt-4 overflow-x-auto">
        <table className="itg2-table itg2-table-fit">
          <thead>
            <tr>
              <th>Group</th>
              <th>Trades</th>
              <th>P&amp;L</th>
              <th>Win rate</th>
              <th>Avg R</th>
              <th>Avg win / loss</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="font-medium">
                  {r.label}
                  {best !== null && r.key === best.key ? (
                    <span className="itg2-chip itg2-chip-profit ml-2 whitespace-nowrap">
                      Best P&amp;L
                    </span>
                  ) : null}
                </td>
                <td className="tabular-nums">{r.trades}</td>
                <td><Money value={r.pnl} /></td>
                <td><Pct value={r.winRate} /></td>
                <td>{r.avgR === null ? "—" : `${r.avgR.toFixed(2)}R`}</td>
                <td className="tabular-nums">
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
  // Value-driven KPI tones (v2): the same conditions that
  // drove the Phase 18 card glows — the P&L and profit-
  // factor cards follow their real sign; max drawdown is a
  // risk figure, so it carries the loss tone when it exists.
  const totalPnlTone: keyof typeof KPI_ICON_TONE =
    !hasTrades || summary.totalPnl === 0
      ? "neutral"
      : summary.totalPnl > 0
        ? "profit"
        : "loss";
  const profitFactorTone: keyof typeof KPI_ICON_TONE =
    summary.profitFactor === null || summary.profitFactor === 1
      ? "neutral"
      : summary.profitFactor > 1
        ? "profit"
        : "loss";

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
      <div className="itg2-card itg2-card-flat motion-reveal flex flex-wrap items-start justify-between gap-4 p-5 sm:p-6">
        <div>
          <p className="itg2-eyebrow">Performance</p>
          <h1 className="itg2-page-title mt-1">Analytics</h1>
          <p className="mt-2 max-w-[720px] text-sm leading-relaxed text-muted-foreground">
            {hasTrades
              ? `${summary.tradeCount} closed trades. All figures are calculated from your real trades.`
              : "No closed trades yet — your analytics will appear here once you close trades."}
          </p>
        </div>
      </div>

        <section className="motion-reveal motion-reveal-1 mt-6 grid grid-cols-2 gap-3 sm:mt-8 sm:gap-4 lg:grid-cols-4" aria-label="Performance summary">
          <article className="itg2-card itg2-kpi">
            <span className={`itg2-kpi-icon${KPI_ICON_TONE[totalPnlTone]}`}>
              <CircleDollarSign className="h-5 w-5" aria-hidden />
            </span>
            <h2 className="itg2-kpi-label mt-3">Total P&amp;L</h2>
            <p className="itg2-kpi-value"><Money value={hasTrades ? summary.totalPnl : null} /></p>
          </article>
          <article className="itg2-card itg2-kpi">
            <span className="itg2-kpi-icon">
              <Target className="h-5 w-5" aria-hidden />
            </span>
            <h2 className="itg2-kpi-label mt-3">Win rate / loss rate</h2>
            <p className="itg2-kpi-value"><Pct value={summary.winRate} /> / <Pct value={summary.lossRate} /></p>
          </article>
          <article className="itg2-card itg2-kpi">
            <span className="itg2-kpi-icon">
              <Scale className="h-5 w-5" aria-hidden />
            </span>
            <h2 className="itg2-kpi-label mt-3">Average win / loss</h2>
            <p className="itg2-kpi-value">{formatMoney(summary.avgWin)} / {formatMoney(summary.avgLoss)}</p>
          </article>
          <article className="itg2-card itg2-kpi">
            <span className={`itg2-kpi-icon${KPI_ICON_TONE[profitFactorTone]}`}>
              <TrendingUp className="h-5 w-5" aria-hidden />
            </span>
            <h2 className="itg2-kpi-label mt-3">Profit factor</h2>
            <p className="itg2-kpi-value">{summary.profitFactor === null ? "—" : summary.profitFactor.toFixed(2)}</p>
            {summary.profitFactor === null ? (
              hasTrades ? (
                <p className="itg2-kpi-hint">No losing trades yet — the factor is unbounded.</p>
              ) : null
            ) : (
              <p className="itg2-kpi-hint">Gross profit ÷ gross loss.</p>
            )}
            {summary.profitFactor !== null && summary.profitFactor !== 1 ? (
              <div className="mt-3">
                <span className={`itg2-chip ${KPI_CHIP_TONE[profitFactorTone]}`}>{summary.profitFactor > 1 ? "Above break-even" : "Below break-even"}</span>
              </div>
            ) : null}
          </article>
          <article className="itg2-card itg2-kpi">
            <span className="itg2-kpi-icon">
              <Crosshair className="h-5 w-5" aria-hidden />
            </span>
            <h2 className="itg2-kpi-label mt-3">Expectancy (per trade)</h2>
            <p className="itg2-kpi-value"><Money value={summary.expectancy} /></p>
          </article>
          <article className="itg2-card itg2-kpi">
            <span className={`itg2-kpi-icon${KPI_ICON_TONE[hasTrades ? "loss" : "neutral"]}`}>
              <TrendingDown className="h-5 w-5" aria-hidden />
            </span>
            <h2 className="itg2-kpi-label mt-3">Max drawdown</h2>
            <p className="itg2-kpi-value"><Money value={hasTrades ? summary.maxDrawdown : null} /></p>
          </article>
          <article className="itg2-card itg2-kpi">
            <span className="itg2-kpi-icon">
              <Hash className="h-5 w-5" aria-hidden />
            </span>
            <h2 className="itg2-kpi-label mt-3">Trade count</h2>
            <p className="itg2-kpi-value">{hasTrades ? summary.tradeCount : "—"}</p>
          </article>
          <article className="itg2-card itg2-kpi">
            <span className="itg2-kpi-icon">
              <Sigma className="h-5 w-5" aria-hidden />
            </span>
            <h2 className="itg2-kpi-label mt-3">Average R</h2>
            <p className="itg2-kpi-value">{summary.avgR === null ? "—" : `${summary.avgR.toFixed(2)}R`}</p>
          </article>
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
        <section className="itg2-card-elevated motion-reveal motion-reveal-2 mt-6 p-4 sm:mt-8 sm:p-6" aria-label="Equity curve">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <div>
              <p className="itg2-eyebrow">Performance</p>
              <h2 className="itg2-section-title mt-1">Equity curve</h2>
              <p className={`itg2-hero-value${heroPnlClass} mt-2`}>
                <Money value={hasTrades ? summary.totalPnl : null} />
              </p>
            </div>
          </div>
          {hasTrades ? (
            <>
              <div className="itg2-chart-scope mt-4"><EquityChart data={equity} /></div>
              <div className="mt-4 overflow-x-auto">
                <table className="itg2-table itg2-table-fit">
                  <thead>
                    <tr>
                      <th>Date closed</th>
                      <th>Cumulative P&amp;L</th>
                      <th>Drawdown</th>
                    </tr>
                  </thead>
                  <tbody>
                    {equity.map((p) => (
                      <tr key={`${p.date}-${p.trades}`}>
                        <td>{p.date}</td>
                        <td><Money value={p.equity} /></td>
                        <td><Money value={p.drawdown} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="mt-6 px-2 py-8 text-center sm:py-10">
              <span className="itg2-kpi-icon mx-auto" aria-hidden="true">
                <BarChart3 className="h-5 w-5" />
              </span>
              <h3 className="itg2-section-title mt-4">No closed trades yet</h3>
              <p className="mx-auto mt-2 max-w-[460px] text-sm leading-relaxed text-muted-foreground">
                Your equity curve and analytics will appear here once you close your first trade.
              </p>
            </div>
          )}
        </section>

        <div className="motion-reveal motion-reveal-3 mt-5 grid gap-[18px] min-[801px]:grid-cols-2">
          {/* Win / loss ring (Phase 19): the ring fill comes
              from the real computed win rate via --win-rate
              (never hardcoded); the stat rows beside it are
              the real wins, losses, rates and best/worst
              trades. */}
          <section className="itg2-card p-5 sm:p-6" aria-label="Win and loss">
            <p className="itg2-eyebrow">Performance</p>
            <h2 className="itg2-section-title mt-1">Win / loss</h2>
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

          <section className="itg2-card p-5 sm:p-6" aria-label="Drawdown">
            <p className="itg2-eyebrow">Risk</p>
            <h2 className="itg2-section-title mt-1">Drawdown</h2>
            {hasTrades ? (
              <div className="itg2-chart-pool mt-4">
                <DrawdownChart data={equity.map((p) => ({ date: p.date, drawdown: p.drawdown }))} />
                <p className="mt-2 text-xs text-muted-foreground">
                  Fall from the running peak in cumulative P&amp;L. Maximum drawdown: {formatMoney(summary.maxDrawdown)}.
                </p>
              </div>
            ) : (
              <p className="mt-2 text-muted-foreground">No drawdown to show yet.</p>
            )}
          </section>

          <section className="itg2-card p-5 sm:p-6" aria-label="Profit and loss by period">
            <p className="itg2-eyebrow">Performance</p>
            <h2 className="itg2-section-title mt-1">P&amp;L by period</h2>
            <div className="itg2-range mt-3" role="tablist" aria-label="Period">
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
                <div className="itg2-chart-pool mt-4"><PeriodPnlChart data={periods} /></div>
                <div className="mt-4 overflow-x-auto">
                  <table className="itg2-table itg2-table-fit">
                    <thead>
                      <tr>
                        <th>Period</th>
                        <th>P&amp;L</th>
                        <th>Trades</th>
                        <th>Wins</th>
                      </tr>
                    </thead>
                    <tbody>
                      {periods.map((p) => (
                        <tr key={p.label}>
                          <td>{p.label}</td>
                          <td><Money value={p.pnl} /></td>
                          <td className="tabular-nums">{p.trades}</td>
                          <td className="tabular-nums">{p.wins}</td>
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

          <section className="itg2-card p-5 sm:p-6" aria-label="R distribution">
            <p className="itg2-eyebrow">Risk</p>
            <h2 className="itg2-section-title mt-1">R distribution</h2>
            {hasTrades ? (
              <>
                <div className="itg2-chart-pool mt-4">
                  <RDistributionChart data={rDist.buckets} />
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {rDist.noR > 0
                    ? `${rDist.noR} trade(s) have no R multiple (no stop-loss set) and are not in the chart.`
                    : "Every closed trade has an R multiple."}
                </p>
                <div className="mt-4 overflow-x-auto">
                  <table className="itg2-table itg2-table-fit">
                    <thead>
                      <tr>
                        <th>R bucket</th>
                        <th>Trades</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rDist.buckets.map((b) => (
                        <tr key={b.label}>
                          <td>{b.label}</td>
                          <td className="tabular-nums">{b.count}</td>
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

          <section className="itg2-card p-5 sm:p-6" aria-label="Psychology">
            <p className="itg2-eyebrow">Psychology</p>
            <h2 className="itg2-section-title mt-1">Psychology vs performance</h2>
            {psych.byEmotion.length === 0 ? (
              <p className="mt-2 text-muted-foreground">
                No psychology records yet — add confidence, emotion and discipline in a trade&apos;s advanced review.
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="itg2-table itg2-table-fit">
                  <thead>
                    <tr>
                      <th>Emotion</th>
                      <th>Trades</th>
                      <th>P&amp;L</th>
                      <th>Win rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {psych.byEmotion.map((row) => (
                      <tr key={row.emotion}>
                        <td className="font-medium capitalize">{row.emotion}</td>
                        <td className="tabular-nums">{row.trades}</td>
                        <td><Money value={row.pnl} /></td>
                        <td><Pct value={row.winRate} /></td>
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
    </AppShell>
  );
}

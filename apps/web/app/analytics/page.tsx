import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AppHeader } from "@/components/app-header";
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
import { Money, Pct, StatCard } from "@/components/analytics/stat-card";

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
      <section className="rounded-lg border bg-card p-6">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-2 text-muted-foreground">No closed trades yet.</p>
      </section>
    );
  }
  return (
    <section className="rounded-lg border bg-card p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-muted-foreground">
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
              <tr key={r.key} className="border-t">
                <td className="py-2 pr-4 font-medium">{r.label}</td>
                <td className="py-2 pr-4">{r.trades}</td>
                <td className="py-2 pr-4"><Money value={r.pnl} /></td>
                <td className="py-2 pr-4"><Pct value={r.winRate} /></td>
                <td className="py-2 pr-4">{r.avgR === null ? "—" : `${r.avgR.toFixed(2)}R`}</td>
                <td className="py-2">
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
  const summary = summarizeTrades(bundle.trades);
  const equity = buildEquityCurve(bundle.trades);
  const periods = periodPnl(bundle.trades, period);
  const rDist = rDistribution(bundle.trades);
  const psych = psychologySummary(bundle.trades);
  const hasTrades = bundle.trades.length > 0;

  return (
    <div className="min-h-screen">
      <AppHeader email={user.email} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-bold">Analytics</h1>
        <p className="mt-1 text-muted-foreground">
          {hasTrades
            ? `${summary.tradeCount} closed trades. All figures are calculated from your real trades.`
            : "No closed trades yet — your analytics will appear here once you close trades."}
        </p>

        <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Performance summary">
          <StatCard label="Total P&L" value={<Money value={hasTrades ? summary.totalPnl : null} />} />
          <StatCard label="Win rate / loss rate" value={<><Pct value={summary.winRate} /> / <Pct value={summary.lossRate} /></>} />
          <StatCard label="Average win / loss" value={<>{formatMoney(summary.avgWin)} / {formatMoney(summary.avgLoss)}</>} />
          <StatCard label="Profit factor" value={summary.profitFactor === null ? "—" : summary.profitFactor.toFixed(2)} hint={summary.profitFactor === null && hasTrades ? "No losing trades yet — the factor is unbounded." : undefined} />
          <StatCard label="Expectancy (per trade)" value={<Money value={summary.expectancy} />} />
          <StatCard label="Max drawdown" value={<Money value={hasTrades ? summary.maxDrawdown : null} />} />
        </section>

        <section className="mt-8 rounded-lg border bg-card p-6" aria-label="Equity curve">
          <h2 className="text-lg font-semibold">Equity curve</h2>
          {hasTrades ? (
            <>
              <div className="mt-4"><EquityChart data={equity} /></div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">Date closed</th>
                      <th className="py-2 pr-4 font-medium">Cumulative P&amp;L</th>
                      <th className="py-2 font-medium">Drawdown</th>
                    </tr>
                  </thead>
                  <tbody>
                    {equity.map((p) => (
                      <tr key={`${p.date}-${p.trades}`} className="border-t">
                        <td className="py-2 pr-4">{p.date}</td>
                        <td className="py-2 pr-4"><Money value={p.equity} /></td>
                        <td className="py-2"><Money value={p.drawdown} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="mt-2 text-muted-foreground">Your equity curve will appear here once you close your first trade.</p>
          )}
        </section>

        <section className="mt-8 rounded-lg border bg-card p-6" aria-label="Drawdown">
          <h2 className="text-lg font-semibold">Drawdown</h2>
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

        <section className="mt-8 rounded-lg border bg-card p-6" aria-label="Profit and loss by period">
          <h2 className="text-lg font-semibold">P&amp;L by period</h2>
          <div className="mt-3 flex gap-2" role="tablist" aria-label="Period">
            {(["day", "week", "month"] as const).map((p) => (
              <Link
                key={p}
                href={`/analytics?period=${p}`}
                aria-current={period === p ? "true" : undefined}
                className={`rounded-md border px-3 py-1 text-sm ${period === p ? "bg-secondary font-medium" : "text-muted-foreground"}`}
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
                    <tr className="text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">Period</th>
                      <th className="py-2 pr-4 font-medium">P&amp;L</th>
                      <th className="py-2 pr-4 font-medium">Trades</th>
                      <th className="py-2 font-medium">Wins</th>
                    </tr>
                  </thead>
                  <tbody>
                    {periods.map((p) => (
                      <tr key={p.label} className="border-t">
                        <td className="py-2 pr-4">{p.label}</td>
                        <td className="py-2 pr-4"><Money value={p.pnl} /></td>
                        <td className="py-2 pr-4">{p.trades}</td>
                        <td className="py-2">{p.wins}</td>
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

        <section className="mt-8 rounded-lg border bg-card p-6" aria-label="R distribution">
          <h2 className="text-lg font-semibold">R distribution</h2>
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
                    <tr className="text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">R bucket</th>
                      <th className="py-2 font-medium">Trades</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rDist.buckets.map((b) => (
                      <tr key={b.label} className="border-t">
                        <td className="py-2 pr-4">{b.label}</td>
                        <td className="py-2">{b.count}</td>
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

        <div className="mt-8 grid gap-4">
          <BreakdownTable title="By strategy" rows={breakdownByStrategy(bundle.trades)} />
          <BreakdownTable title="By session" rows={breakdownBySession(bundle.trades)} />
          <BreakdownTable title="By direction" rows={breakdownByDirection(bundle.trades)} />
        </div>

        <section className="mt-8 rounded-lg border bg-card p-6" aria-label="Psychology">
          <h2 className="text-lg font-semibold">Psychology vs performance</h2>
          {psych.byEmotion.length === 0 ? (
            <p className="mt-2 text-muted-foreground">
              No psychology records yet — add confidence, emotion and discipline in a trade&apos;s advanced review.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Emotion</th>
                    <th className="py-2 pr-4 font-medium">Trades</th>
                    <th className="py-2 pr-4 font-medium">P&amp;L</th>
                    <th className="py-2 font-medium">Win rate</th>
                  </tr>
                </thead>
                <tbody>
                  {psych.byEmotion.map((row) => (
                    <tr key={row.emotion} className="border-t">
                      <td className="py-2 pr-4 font-medium capitalize">{row.emotion}</td>
                      <td className="py-2 pr-4">{row.trades}</td>
                      <td className="py-2 pr-4"><Money value={row.pnl} /></td>
                      <td className="py-2"><Pct value={row.winRate} /></td>
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
      </main>
    </div>
  );
}

import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AppShell } from "@/components/app-shell";
import { Money, Pct, StatCard } from "@/components/analytics/stat-card";
import { PrintButton } from "@/components/reports/print-button";
import { getReportSummary } from "@/lib/reports/queries";
import { periodBounds } from "@/lib/reports/reports";
import { REPORT_TYPE_LABELS, type ReportType } from "@/lib/reports/types";
import {
  CATALOG_REPORT_LABELS,
  getCatalogReport,
  type CatalogPeriod,
  type CatalogReportKind,
} from "@/lib/reports/catalog";
import {
  BreakdownTable,
  CoachSections,
  PerformanceSections,
  PsychologySections,
  RiskSections,
  StrategySections,
} from "@/components/reports/catalog-sections";

export const metadata = { title: "Reports — ITG TraderOS" };

/**
 * Reports page (Phase 8, spec §27).
 *
 * Daily / weekly / monthly reports generated from the
 * trader's real trades: trades, P&L, win rate, risk,
 * psychology, discipline, goals, lessons and rule-based
 * recommendations from the trader's own data. Viewable
 * in-app, printable, and downloadable as a PDF (generated on
 * demand — not stored in Supabase Storage in this phase).
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; date?: string; report?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.onboarding?.is_complete) redirect("/onboarding");

  const params = await searchParams;
  const type: ReportType =
    params.type === "daily" || params.type === "weekly" || params.type === "monthly"
      ? params.type
      : "monthly";
  const anchor =
    params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date)
      ? params.date
      : new Date().toISOString().slice(0, 10);
  const bounds = periodBounds(type, anchor) ?? {
    start: anchor,
    end: anchor,
  };

  // Phase 24: the report catalog. `performance` IS the summary
  // view above (extended with the period drawdown block); the
  // other kinds render their own composed sections. Catalog
  // grains are week | month — a daily anchor maps to its
  // containing week for the non-Performance reports.
  const reportKind: CatalogReportKind =
    params.report === "psychology" ||
    params.report === "risk" ||
    params.report === "strategy" ||
    params.report === "coach"
      ? params.report
      : "performance";
  const catalogPeriod: CatalogPeriod = type === "monthly" ? "month" : "week";
  const catalogBounds = periodBounds(
    catalogPeriod === "month" ? "monthly" : "weekly",
    anchor,
  ) ?? { start: anchor, end: anchor };

  const configured = isSupabaseConfigured();
  let summary = null as Awaited<ReturnType<typeof getReportSummary>> | null;
  let catalog = null as Awaited<ReturnType<typeof getCatalogReport>>;
  if (configured) {
    const supabase = await createServerSupabaseClient();
    summary = await getReportSummary(supabase, user.id, {
      type,
      periodStart: bounds.start,
      periodEnd: bounds.end,
    });
    // A daily Performance view has no catalog grain; its
    // legacy summary + PDF stand alone (docs/phase-24.md).
    if (!(reportKind === "performance" && type === "daily")) {
      catalog = await getCatalogReport(
        supabase,
        user.id,
        reportKind,
        catalogPeriod,
        anchor,
      );
    }
  }

  const pdfHref =
    catalog && reportKind !== "performance"
      ? `/reports/pdf?type=${catalogPeriod === "month" ? "monthly" : "weekly"}&start=${catalogBounds.start}&end=${catalogBounds.end}&report=${reportKind}`
      : catalog && type !== "daily"
        ? `/reports/pdf?type=${type}&start=${bounds.start}&end=${bounds.end}&report=performance`
        : `/reports/pdf?type=${type}&start=${bounds.start}&end=${bounds.end}`;

  return (
    <AppShell email={user.email}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="page-title">Reports</h1>
            <p className="page-lede">
              {reportKind === "performance" ? (
                <>
                  {REPORT_TYPE_LABELS[type]} report · {bounds.start} to {bounds.end} ·
                  built from your real trades only.
                </>
              ) : (
                <>
                  {CATALOG_REPORT_LABELS[reportKind]} report ·{" "}
                  {catalogPeriod === "month" ? "Monthly" : "Weekly"} · {catalogBounds.start}{" "}
                  to {catalogBounds.end} · built from your real trades only.
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <PrintButton />
            {summary ? (
              <Link
                href={pdfHref}
                className="inline-flex min-h-11 items-center rounded-md border bg-card px-3 py-1.5 text-sm font-medium shadow-elevation-1 transition-all duration-fast ease-standard hover:bg-accent hover:shadow-elevation-2"
              >
                Download PDF
              </Link>
            ) : null}
          </div>
        </div>

        <nav className="mt-6 flex flex-wrap gap-2 text-sm" aria-label="Report period">
          {(["daily", "weekly", "monthly"] as ReportType[]).map((t) => (
            <Link
              key={t}
              href={`/reports?type=${t}&date=${anchor}&report=${reportKind}`}
              className={`inline-flex min-h-11 items-center rounded-md border px-3 py-1.5 shadow-elevation-1 transition-all duration-fast ease-standard hover:shadow-elevation-2 ${t === type ? "bg-primary font-medium text-primary-foreground" : "bg-card hover:bg-accent"}`}
            >
              {REPORT_TYPE_LABELS[t]}
            </Link>
          ))}
          <form method="get" action="/reports" className="flex items-center gap-2">
            <input type="hidden" name="type" value={type} />
            <input type="hidden" name="report" value={reportKind} />
            <label htmlFor="report-date" className="text-muted-foreground">
              Date
            </label>
            <input
              id="report-date"
              type="date"
              name="date"
              defaultValue={anchor}
              className="h-11 rounded-md border border-input bg-background px-2 py-1.5 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <button type="submit" className="inline-flex min-h-11 items-center rounded-md border bg-card px-3 py-1.5 text-sm font-medium shadow-elevation-1 transition-all duration-fast ease-standard hover:bg-accent hover:shadow-elevation-2">
              Show
            </button>
          </form>
        </nav>

        <nav className="mt-3 flex flex-wrap gap-2 text-sm" aria-label="Report type">
          {(Object.keys(CATALOG_REPORT_LABELS) as CatalogReportKind[]).map((k) => (
            <Link
              key={k}
              href={`/reports?type=${type}&date=${anchor}&report=${k}`}
              className={`inline-flex min-h-11 items-center rounded-md border px-3 py-1.5 shadow-elevation-1 transition-all duration-fast ease-standard hover:shadow-elevation-2 ${k === reportKind ? "bg-primary font-medium text-primary-foreground" : "bg-card hover:bg-accent"}`}
            >
              {CATALOG_REPORT_LABELS[k]}
            </Link>
          ))}
        </nav>

        {reportKind !== "performance" ? (
          !configured || !catalog ? (
            <p className="mt-6 sm:mt-8 text-muted-foreground">
              Supabase is not connected yet — reports will be generated from your
              real trades once the database is connected. Nothing here is estimated.
            </p>
          ) : !catalog.hasData ? (
            <p className="mt-6 sm:mt-8 text-muted-foreground">
              No closed trades in this period — there is nothing to report yet.
              Journal your next trades and this report will fill in.
            </p>
          ) : (
            <>
              <section className="mt-6 sm:mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                <StatCard label="Trades" value={catalog.summary.tradesCount} />
                <StatCard label="Total P&L" value={<Money value={catalog.summary.totalPnl} />} raised />
                <StatCard label="Win rate" value={<Pct value={catalog.summary.winRate} />} />
                <StatCard label="Profit factor" value={catalog.summary.profitFactor === null ? "—" : catalog.summary.profitFactor.toFixed(2)} />
                <StatCard label="Expectancy" value={<Money value={catalog.summary.expectancy} />} />
                <StatCard label="Average R" value={catalog.summary.avgR === null ? "—" : catalog.summary.avgR.toFixed(2)} />
                <StatCard label="Journal completion" value={<Pct value={catalog.summary.journalCompletionPct} />} />
                <StatCard
                  label="Goals completed"
                  value={`${catalog.summary.goalsCompleted} of ${catalog.summary.goalsTotal}`}
                />
              </section>
              {catalog.kind === "psychology" ? (
                <>
                  <BreakdownTable title="Psychology vs performance" rows={catalog.summary.byEmotion} />
                  <PsychologySections report={catalog} />
                </>
              ) : null}
              {catalog.kind === "risk" ? <RiskSections report={catalog} /> : null}
              {catalog.kind === "strategy" ? (
                <>
                  <BreakdownTable title="By strategy" rows={catalog.summary.byStrategy} />
                  <StrategySections report={catalog} />
                </>
              ) : null}
              {catalog.kind === "coach" ? <CoachSections report={catalog} /> : null}
            </>
          )
        ) : !configured || !summary ? (
          <p className="mt-6 sm:mt-8 text-muted-foreground">
            Supabase is not connected yet — reports will be generated from your
            real trades once the database is connected. Nothing here is estimated.
          </p>
        ) : summary.tradesCount === 0 ? (
          <p className="mt-6 sm:mt-8 text-muted-foreground">
            No closed trades in this period — there is nothing to report yet.
            Journal your next trades and this report will fill in.
          </p>
        ) : (
          <>
            <section className="mt-6 sm:mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <StatCard label="Trades" value={summary.tradesCount} />
              <StatCard label="Total P&L" value={<Money value={summary.totalPnl} />} raised />
              <StatCard label="Win rate" value={<Pct value={summary.winRate} />} />
              <StatCard label="Profit factor" value={summary.profitFactor === null ? "—" : summary.profitFactor.toFixed(2)} />
              <StatCard label="Expectancy" value={<Money value={summary.expectancy} />} />
              <StatCard label="Average R" value={summary.avgR === null ? "—" : summary.avgR.toFixed(2)} />
              <StatCard label="Journal completion" value={<Pct value={summary.journalCompletionPct} />} />
              <StatCard
                label="Goals completed"
                value={`${summary.goalsCompleted} of ${summary.goalsTotal}`}
              />
            </section>

            {summary.byStrategy.length > 0 && (
              <section className="mt-6 sm:mt-8 card-surface p-4 sm:p-6">
                <h2 className="section-title">By strategy</h2>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">Strategy</th>
                        <th className="py-2 pr-3 font-medium">Trades</th>
                        <th className="py-2 pr-3 font-medium">Wins</th>
                        <th className="py-2 font-medium">P&amp;L</th>
                      </tr>
                    </thead>
                    <tbody className="list-divider">
                      {summary.byStrategy.map((r) => (
                        <tr key={r.name} className="list-row-premium">
                          <td className="py-2 pr-3">{r.name}</td>
                          <td className="py-2 pr-3 tnum">{r.trades}</td>
                          <td className="py-2 pr-3 tnum">{r.wins}</td>
                          <td className="py-2 tnum"><Money value={r.totalPnl} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {summary.byEmotion.length > 0 && (
              <section className="mt-6 sm:mt-8 card-surface p-4 sm:p-6">
                <h2 className="section-title">Psychology vs performance</h2>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">Emotion</th>
                        <th className="py-2 pr-3 font-medium">Trades</th>
                        <th className="py-2 pr-3 font-medium">Win rate</th>
                        <th className="py-2 font-medium">P&amp;L</th>
                      </tr>
                    </thead>
                    <tbody className="list-divider">
                      {summary.byEmotion.map((r) => (
                        <tr key={r.name} className="list-row-premium">
                          <td className="py-2 pr-3 capitalize">{r.name}</td>
                          <td className="py-2 pr-3 tnum">{r.trades}</td>
                          <td className="py-2 pr-3 tnum"><Pct value={r.winRate} /></td>
                          <td className="py-2 tnum"><Money value={r.totalPnl} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <section className="mt-6 sm:mt-8 card-surface-raised p-4 sm:p-6">
              <h2 className="section-title">Recommendations</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Rule-based observations from this period&apos;s own data — not
                generic advice.
              </p>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">
                {summary.recommendations.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
              {summary.mostFrequentLosingSetup && (
                <p className="mt-3 text-sm text-muted-foreground">
                  Most frequent losing setup: {summary.mostFrequentLosingSetup.name} (
                  {summary.mostFrequentLosingSetup.losses} losing trades).
                </p>
              )}
              {summary.mostRepeatedMistake && (
                <p className="mt-1 text-sm text-muted-foreground">
                  Most repeated mistake: “{summary.mostRepeatedMistake.text}” (
                  {summary.mostRepeatedMistake.count} times).
                </p>
              )}
            </section>
            {catalog?.kind === "performance" ? (
              <PerformanceSections report={catalog} />
            ) : null}
          </>
        )}
    </AppShell>
  );
}

import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AppShell } from "@/components/app-shell";
import { Money, Pct } from "@/components/analytics/stat-card";
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
 *
 * Master Web UI Redesign (Task 6) — PRESENTATION ONLY: the
 * header moved into a flat glass band (.itg2-card
 * .itg2-card-flat) with eyebrow + .itg2-page-title, the
 * period / report-kind navigation and the date form onto
 * the v2 button + form system, the stat grids onto local
 * .itg2-kpi cards (the shared StatCard is no longer used
 * here), the breakdown tables onto .itg2-table, the empty
 * states onto v2 cards and the recommendations panel onto
 * an elevated v2 card. All data, copy, value expressions,
 * gating and the PDF link are exactly as before. Reports
 * are not AI, so no violet anywhere.
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
        <div className="itg2-card itg2-card-flat motion-reveal flex flex-wrap items-start justify-between gap-4 p-5 sm:p-6">
          <div>
            <p className="itg2-eyebrow">Reports</p>
            <h1 className="itg2-page-title mt-1">Reports</h1>
            <p className="mt-2 text-muted-foreground">
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
                className="itg2-btn-primary"
              >
                Download PDF
              </Link>
            ) : null}
          </div>
        </div>

        <nav className="mt-6 flex flex-wrap items-center gap-2" aria-label="Report period">
          {(["daily", "weekly", "monthly"] as ReportType[]).map((t) => (
            <Link
              key={t}
              href={`/reports?type=${t}&date=${anchor}&report=${reportKind}`}
              className={t === type ? "itg2-btn-primary" : "itg2-btn-ghost"}
            >
              {REPORT_TYPE_LABELS[t]}
            </Link>
          ))}
          <form method="get" action="/reports" className="flex items-end gap-2">
            <input type="hidden" name="type" value={type} />
            <input type="hidden" name="report" value={reportKind} />
            <div className="itg2-field">
              <label htmlFor="report-date" className="itg2-label">
                Date
              </label>
              <input
                id="report-date"
                type="date"
                name="date"
                defaultValue={anchor}
                className="itg2-input"
              />
            </div>
            <button type="submit" className="itg2-btn-primary">
              Show
            </button>
          </form>
        </nav>

        <nav className="mt-3 flex flex-wrap gap-2" aria-label="Report type">
          {(Object.keys(CATALOG_REPORT_LABELS) as CatalogReportKind[]).map((k) => (
            <Link
              key={k}
              href={`/reports?type=${type}&date=${anchor}&report=${k}`}
              className={k === reportKind ? "itg2-btn-primary" : "itg2-btn-ghost"}
            >
              {CATALOG_REPORT_LABELS[k]}
            </Link>
          ))}
        </nav>

        {reportKind !== "performance" ? (
          !configured || !catalog ? (
            <section className="itg2-card mt-6 sm:mt-8 p-4 sm:p-6">
              <p className="text-muted-foreground">
                Supabase is not connected yet — reports will be generated from your
                real trades once the database is connected. Nothing here is estimated.
              </p>
            </section>
          ) : !catalog.hasData ? (
            <section className="itg2-card mt-6 sm:mt-8 p-4 sm:p-6">
              <p className="text-muted-foreground">
                No closed trades in this period — there is nothing to report yet.
                Journal your next trades and this report will fill in.
              </p>
            </section>
          ) : (
            <>
              <section className="mt-6 sm:mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                <article className="itg2-card itg2-kpi">
                  <h2 className="itg2-kpi-label">Trades</h2>
                  <p className="itg2-kpi-value">{catalog.summary.tradesCount}</p>
                </article>
                <article className="itg2-card itg2-card-elevated itg2-kpi">
                  <h2 className="itg2-kpi-label">Total P&amp;L</h2>
                  <p className="itg2-kpi-value"><Money value={catalog.summary.totalPnl} /></p>
                </article>
                <article className="itg2-card itg2-kpi">
                  <h2 className="itg2-kpi-label">Win rate</h2>
                  <p className="itg2-kpi-value"><Pct value={catalog.summary.winRate} /></p>
                </article>
                <article className="itg2-card itg2-kpi">
                  <h2 className="itg2-kpi-label">Profit factor</h2>
                  <p className="itg2-kpi-value">{catalog.summary.profitFactor === null ? "—" : catalog.summary.profitFactor.toFixed(2)}</p>
                </article>
                <article className="itg2-card itg2-kpi">
                  <h2 className="itg2-kpi-label">Expectancy</h2>
                  <p className="itg2-kpi-value"><Money value={catalog.summary.expectancy} /></p>
                </article>
                <article className="itg2-card itg2-kpi">
                  <h2 className="itg2-kpi-label">Average R</h2>
                  <p className="itg2-kpi-value">{catalog.summary.avgR === null ? "—" : catalog.summary.avgR.toFixed(2)}</p>
                </article>
                <article className="itg2-card itg2-kpi">
                  <h2 className="itg2-kpi-label">Journal completion</h2>
                  <p className="itg2-kpi-value"><Pct value={catalog.summary.journalCompletionPct} /></p>
                </article>
                <article className="itg2-card itg2-kpi">
                  <h2 className="itg2-kpi-label">Goals completed</h2>
                  <p className="itg2-kpi-value">{`${catalog.summary.goalsCompleted} of ${catalog.summary.goalsTotal}`}</p>
                </article>
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
          <section className="itg2-card mt-6 sm:mt-8 p-4 sm:p-6">
            <p className="text-muted-foreground">
              Supabase is not connected yet — reports will be generated from your
              real trades once the database is connected. Nothing here is estimated.
            </p>
          </section>
        ) : summary.tradesCount === 0 ? (
          <section className="itg2-card mt-6 sm:mt-8 p-4 sm:p-6">
            <p className="text-muted-foreground">
              No closed trades in this period — there is nothing to report yet.
              Journal your next trades and this report will fill in.
            </p>
          </section>
        ) : (
          <>
            <section className="mt-6 sm:mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <article className="itg2-card itg2-kpi">
                <h2 className="itg2-kpi-label">Trades</h2>
                <p className="itg2-kpi-value">{summary.tradesCount}</p>
              </article>
              <article className="itg2-card itg2-card-elevated itg2-kpi">
                <h2 className="itg2-kpi-label">Total P&amp;L</h2>
                <p className="itg2-kpi-value"><Money value={summary.totalPnl} /></p>
              </article>
              <article className="itg2-card itg2-kpi">
                <h2 className="itg2-kpi-label">Win rate</h2>
                <p className="itg2-kpi-value"><Pct value={summary.winRate} /></p>
              </article>
              <article className="itg2-card itg2-kpi">
                <h2 className="itg2-kpi-label">Profit factor</h2>
                <p className="itg2-kpi-value">{summary.profitFactor === null ? "—" : summary.profitFactor.toFixed(2)}</p>
              </article>
              <article className="itg2-card itg2-kpi">
                <h2 className="itg2-kpi-label">Expectancy</h2>
                <p className="itg2-kpi-value"><Money value={summary.expectancy} /></p>
              </article>
              <article className="itg2-card itg2-kpi">
                <h2 className="itg2-kpi-label">Average R</h2>
                <p className="itg2-kpi-value">{summary.avgR === null ? "—" : summary.avgR.toFixed(2)}</p>
              </article>
              <article className="itg2-card itg2-kpi">
                <h2 className="itg2-kpi-label">Journal completion</h2>
                <p className="itg2-kpi-value"><Pct value={summary.journalCompletionPct} /></p>
              </article>
              <article className="itg2-card itg2-kpi">
                <h2 className="itg2-kpi-label">Goals completed</h2>
                <p className="itg2-kpi-value">{`${summary.goalsCompleted} of ${summary.goalsTotal}`}</p>
              </article>
            </section>

            {summary.byStrategy.length > 0 && (
              <section className="itg2-card mt-6 sm:mt-8 p-4 sm:p-6">
                <h2 className="itg2-section-title">By strategy</h2>
                <div className="mt-4 overflow-x-auto">
                  <table className="itg2-table itg2-table-fit">
                    <thead>
                      <tr>
                        <th>Strategy</th>
                        <th>Trades</th>
                        <th>Wins</th>
                        <th>P&amp;L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.byStrategy.map((r) => (
                        <tr key={r.name}>
                          <td>{r.name}</td>
                          <td className="tabular-nums">{r.trades}</td>
                          <td className="tabular-nums">{r.wins}</td>
                          <td><Money value={r.totalPnl} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {summary.byEmotion.length > 0 && (
              <section className="itg2-card mt-6 sm:mt-8 p-4 sm:p-6">
                <h2 className="itg2-section-title">Psychology vs performance</h2>
                <div className="mt-4 overflow-x-auto">
                  <table className="itg2-table itg2-table-fit">
                    <thead>
                      <tr>
                        <th>Emotion</th>
                        <th>Trades</th>
                        <th>Win rate</th>
                        <th>P&amp;L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.byEmotion.map((r) => (
                        <tr key={r.name}>
                          <td className="capitalize">{r.name}</td>
                          <td className="tabular-nums">{r.trades}</td>
                          <td><Pct value={r.winRate} /></td>
                          <td><Money value={r.totalPnl} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <section className="itg2-card itg2-card-elevated mt-6 sm:mt-8 p-4 sm:p-6">
              <h2 className="itg2-section-title">Recommendations</h2>
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

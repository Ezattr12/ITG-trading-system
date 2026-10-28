import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AppHeader } from "@/components/app-header";
import { Money, Pct, StatCard } from "@/components/analytics/stat-card";
import { PrintButton } from "@/components/reports/print-button";
import { getReportSummary } from "@/lib/reports/queries";
import { periodBounds } from "@/lib/reports/reports";
import { REPORT_TYPE_LABELS, type ReportType } from "@/lib/reports/types";

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
  searchParams: Promise<{ type?: string; date?: string }>;
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

  const configured = isSupabaseConfigured();
  let summary = null as Awaited<ReturnType<typeof getReportSummary>> | null;
  if (configured) {
    const supabase = await createServerSupabaseClient();
    summary = await getReportSummary(supabase, user.id, {
      type,
      periodStart: bounds.start,
      periodEnd: bounds.end,
    });
  }

  const pdfHref = `/reports/pdf?type=${type}&start=${bounds.start}&end=${bounds.end}`;

  return (
    <div className="min-h-screen">
      <AppHeader email={user.email} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Reports</h1>
            <p className="mt-1 text-muted-foreground">
              {REPORT_TYPE_LABELS[type]} report · {bounds.start} to {bounds.end} ·
              built from your real trades only.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <PrintButton />
            {summary ? (
              <Link
                href={pdfHref}
                className="rounded-md border px-3 py-1.5 text-sm font-medium"
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
              href={`/reports?type=${t}&date=${anchor}`}
              className={`rounded-md border px-3 py-1.5 ${t === type ? "bg-muted font-medium" : ""}`}
            >
              {REPORT_TYPE_LABELS[t]}
            </Link>
          ))}
          <form method="get" action="/reports" className="flex items-center gap-2">
            <input type="hidden" name="type" value={type} />
            <label htmlFor="report-date" className="text-muted-foreground">
              Date
            </label>
            <input
              id="report-date"
              type="date"
              name="date"
              defaultValue={anchor}
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
            />
            <button type="submit" className="rounded-md border px-3 py-1.5 text-sm font-medium">
              Show
            </button>
          </form>
        </nav>

        {!configured || !summary ? (
          <p className="mt-8 text-muted-foreground">
            Supabase is not connected yet — reports will be generated from your
            real trades once the database is connected. Nothing here is estimated.
          </p>
        ) : summary.tradesCount === 0 ? (
          <p className="mt-8 text-muted-foreground">
            No closed trades in this period — there is nothing to report yet.
            Journal your next trades and this report will fill in.
          </p>
        ) : (
          <>
            <section className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <StatCard label="Trades" value={summary.tradesCount} />
              <StatCard label="Total P&L" value={<Money value={summary.totalPnl} />} />
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
              <section className="mt-8">
                <h2 className="text-lg font-semibold">By strategy</h2>
                <table className="mt-2 w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="py-1">Strategy</th>
                      <th className="py-1">Trades</th>
                      <th className="py-1">Wins</th>
                      <th className="py-1">P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.byStrategy.map((r) => (
                      <tr key={r.name} className="border-t">
                        <td className="py-1">{r.name}</td>
                        <td className="py-1">{r.trades}</td>
                        <td className="py-1">{r.wins}</td>
                        <td className="py-1"><Money value={r.totalPnl} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {summary.byEmotion.length > 0 && (
              <section className="mt-8">
                <h2 className="text-lg font-semibold">Psychology vs performance</h2>
                <table className="mt-2 w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="py-1">Emotion</th>
                      <th className="py-1">Trades</th>
                      <th className="py-1">Win rate</th>
                      <th className="py-1">P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.byEmotion.map((r) => (
                      <tr key={r.name} className="border-t">
                        <td className="py-1 capitalize">{r.name}</td>
                        <td className="py-1">{r.trades}</td>
                        <td className="py-1"><Pct value={r.winRate} /></td>
                        <td className="py-1"><Money value={r.totalPnl} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            <section className="mt-8 rounded-lg border bg-card p-4">
              <h2 className="text-lg font-semibold">Recommendations</h2>
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
          </>
        )}
      </main>
    </div>
  );
}

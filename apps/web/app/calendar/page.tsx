import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AppHeader } from "@/components/app-header";
import { formatMoney } from "@/lib/trades/calculations";
import { getAnalyticsBundle, type AnalyticsBundle } from "@/lib/analytics/queries";
import {
  aggregateCalendarDays,
  buildMonthGrid,
  parseMonthParam,
  shiftMonth,
} from "@/lib/analytics/calendar";
import { Money, StatCard } from "@/components/analytics/stat-card";

export const metadata = { title: "Trading calendar — ITG TraderOS" };

/**
 * Trading calendar (Phase 4, spec §31). One cell per day of the
 * month: trades, P&L, journal completion. Days with no trades are
 * blank — never shown as zero-P&L days. A day links to the trades
 * list filtered to that day, so patterns can be followed up.
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

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default async function CalendarPage({
  searchParams,
}: {
  searchParams?: Promise<{ month?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.onboarding?.is_complete) redirect("/onboarding");

  const params = await searchParams;
  const { year, month } = parseMonthParam(params?.month);
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;

  const bundle = isSupabaseConfigured()
    ? await getAnalyticsBundle(await createServerSupabaseClient(), user.id)
    : EMPTY_BUNDLE;
  const days = aggregateCalendarDays(bundle.trades, bundle.dailyActivity);
  const monthTrades = bundle.trades.filter((t) => t.closedAt.slice(0, 7) === monthKey);
  const monthPnl = monthTrades.reduce((sum, t) => sum + t.pnl, 0);
  const monthWins = monthTrades.filter((t) => t.pnl > 0).length;
  const monthJournaled = monthTrades.filter((t) => t.journaled).length;
  const weeks = buildMonthGrid(year, month, days);

  return (
    <div className="min-h-screen">
      <AppHeader email={user.email} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-bold">Trading calendar</h1>
        <p className="mt-1 text-muted-foreground">
          Trading days, P&amp;L and journal completion — spot your patterns over time.
        </p>

        <div className="mt-6 flex items-center gap-4">
          <Link href={`/calendar?month=${shiftMonth(year, month, -1)}`} className="rounded-md border px-3 py-1 text-sm">
            ← Previous
          </Link>
          <h2 className="text-lg font-semibold">
            {MONTH_NAMES[month - 1]} {year}
          </h2>
          <Link href={`/calendar?month=${shiftMonth(year, month, 1)}`} className="rounded-md border px-3 py-1 text-sm">
            Next →
          </Link>
          <Link href="/calendar" className="text-sm text-muted-foreground underline">
            This month
          </Link>
        </div>

        <section className="mt-6 grid gap-4 sm:grid-cols-3" aria-label="Month summary">
          <StatCard label="Trades this month" value={monthTrades.length} />
          <StatCard label="P&L this month" value={<Money value={monthTrades.length === 0 ? null : monthPnl} />} />
          <StatCard
            label="Journal completion"
            value={monthTrades.length === 0 ? "—" : `${((monthJournaled / monthTrades.length) * 100).toFixed(0)}%`}
            hint={`${monthJournaled} of ${monthTrades.length} trades journaled · ${monthWins} wins`}
          />
        </section>

        {monthTrades.length === 0 && bundle.trades.length === 0 ? (
          <p className="mt-8 rounded-lg border bg-card p-6 text-muted-foreground">
            No trades yet — your calendar will fill in as you journal trades.
          </p>
        ) : (
          <section className="mt-8" aria-label="Calendar grid">
            <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground" role="row">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                <div key={d} className="py-1">{d}</div>
              ))}
            </div>
            {weeks.map((week, wi) => (
              <div key={wi} className="mt-1 grid grid-cols-7 gap-1">
                {week.map((cell, ci) => {
                  if (cell.day === null) {
                    return <div key={ci} className="min-h-16 rounded-md border border-transparent" />;
                  }
                  const hasTrades = (cell.data?.trades ?? 0) > 0;
                  const pnl = cell.data?.pnl ?? 0;
                  const content = (
                    <div
                      className={`flex min-h-16 flex-col rounded-md border p-1 text-left text-xs ${
                        hasTrades
                          ? pnl > 0
                            ? "border-emerald-500/40 bg-emerald-500/10"
                            : pnl < 0
                              ? "border-red-500/40 bg-red-500/10"
                              : "border-border bg-card"
                          : "border-border bg-card"
                      }`}
                    >
                      <span className="font-semibold">{cell.day}</span>
                      {hasTrades ? (
                        <>
                          <span className={pnl > 0 ? "text-emerald-400" : pnl < 0 ? "text-red-400" : ""}>
                            {formatMoney(pnl)}
                          </span>
                          <span className="text-muted-foreground">
                            {cell.data?.trades} trade{(cell.data?.trades ?? 0) === 1 ? "" : "s"} · {Math.round(cell.data?.journalCompletionPct ?? 0)}% journaled
                          </span>
                        </>
                      ) : cell.data?.journalCompleted ? (
                        <span className="text-muted-foreground">Journal ✓</span>
                      ) : null}
                    </div>
                  );
                  return hasTrades && cell.date ? (
                    <Link key={ci} href={`/trades?from=${cell.date}&to=${cell.date}`} aria-label={`${cell.date}: ${cell.data?.trades} trades, P&L ${formatMoney(pnl)}`}>
                      {content}
                    </Link>
                  ) : (
                    <div key={ci}>{content}</div>
                  );
                })}
              </div>
            ))}
            <p className="mt-3 text-xs text-muted-foreground">
              Green = winning day, red = losing day. Select a trading day to see its trades. Days with no trades are blank — they are not zero-P&amp;L days.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}

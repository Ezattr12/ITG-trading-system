import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AppShell } from "@/components/app-shell";
import { formatMoney } from "@/lib/trades/calculations";
import { getAnalyticsBundle, type AnalyticsBundle } from "@/lib/analytics/queries";
import {
  aggregateCalendarDays,
  buildMonthGrid,
  parseMonthParam,
  shiftMonth,
} from "@/lib/analytics/calendar";

export const metadata = { title: "Trading calendar — ITG TraderOS" };

/**
 * Trading calendar (Phase 4, spec §31). One cell per day of the
 * month: trades, P&L, journal completion. Days with no trades are
 * blank — never shown as zero-P&L days. A day links to the trades
 * list filtered to that day, so patterns can be followed up.
 *
 * Master Web UI Redesign (Task 4 sweep) — PRESENTATION ONLY:
 * the page moved onto the v2 system (flat header band with
 * eyebrow + .itg2-page-title, ghost month navigation, the
 * month summary as .itg2-kpi cards and the day grid as
 * .itg2-cal-day glass tiles — profit/loss tints from the
 * semantic tokens, a cyan ring on today). All data, copy,
 * links and empty states are exactly as before.
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
  // Today gets a ring in the grid (Phase 18) — a real calendar
  // always shows where "now" is.
  const todayKey = new Date().toISOString().slice(0, 10);

  return (
    <AppShell email={user.email}>
        <header className="itg2-card itg2-card-flat p-5 sm:p-6">
          <p className="itg2-eyebrow">Trading calendar</p>
          <h1 className="itg2-page-title mt-1">Trading calendar</h1>
          <p className="mt-2 text-muted-foreground">
            Trading days, P&amp;L and journal completion — spot your patterns over time.
          </p>
        </header>

        <div className="mt-6 flex flex-wrap items-center gap-3 sm:gap-4">
          <Link href={`/calendar?month=${shiftMonth(year, month, -1)}`} className="itg2-btn-ghost">
            ← Previous
          </Link>
          <h2 className="itg2-section-title">
            {MONTH_NAMES[month - 1]} {year}
          </h2>
          <Link href={`/calendar?month=${shiftMonth(year, month, 1)}`} className="itg2-btn-ghost">
            Next →
          </Link>
          <Link href="/calendar" className="itg2-link">
            This month
          </Link>
        </div>

        <section className="mt-6 grid gap-4 sm:grid-cols-3" aria-label="Month summary">
          <article className="itg2-card itg2-kpi">
            <h2 className="itg2-kpi-label">Trades this month</h2>
            <p className="itg2-kpi-value">{monthTrades.length}</p>
          </article>
          <article className="itg2-card itg2-kpi">
            <h2 className="itg2-kpi-label">P&amp;L this month</h2>
            <p className="itg2-kpi-value">
              {monthTrades.length === 0 ? (
                "—"
              ) : (
                <span className={monthPnl > 0 ? "itg2-text-profit" : monthPnl < 0 ? "itg2-text-loss" : ""}>
                  {formatMoney(monthPnl)}
                </span>
              )}
            </p>
          </article>
          <article className="itg2-card itg2-kpi">
            <h2 className="itg2-kpi-label">Journal completion</h2>
            <p className="itg2-kpi-value">
              {monthTrades.length === 0 ? "—" : `${((monthJournaled / monthTrades.length) * 100).toFixed(0)}%`}
            </p>
            <p className="itg2-kpi-hint">
              {`${monthJournaled} of ${monthTrades.length} trades journaled · ${monthWins} wins`}
            </p>
          </article>
        </section>

        {monthTrades.length === 0 && bundle.trades.length === 0 ? (
          <p className="itg2-notice itg2-notice-neutral mt-6 sm:mt-8">
            No trades yet — your calendar will fill in as you journal trades.
          </p>
        ) : (
          <section className="mt-6 sm:mt-8" aria-label="Calendar grid">
            <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground" role="row">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                <div key={d} className="py-1">{d}</div>
              ))}
            </div>
            {weeks.map((week, wi) => (
              <div key={wi} className="mt-1 grid grid-cols-7 gap-1">
                {week.map((cell, ci) => {
                  if (cell.day === null) {
                    return <div key={ci} className="min-h-14 sm:min-h-16" />;
                  }
                  const hasTrades = (cell.data?.trades ?? 0) > 0;
                  const pnl = cell.data?.pnl ?? 0;
                  const isToday = cell.date === todayKey;
                  const content = (
                    <div
                      className={`itg2-cal-day flex min-h-14 flex-col p-1.5 text-left text-xs leading-tight sm:min-h-16${
                        isToday ? " itg2-cal-day-today" : ""
                      }${
                        hasTrades
                          ? pnl > 0
                            ? " itg2-cal-day-win"
                            : pnl < 0
                              ? " itg2-cal-day-loss"
                              : ""
                          : ""
                      }`}
                    >
                      <span className="font-semibold">{cell.day}</span>
                      {hasTrades ? (
                        <>
                          <span className={pnl > 0 ? "itg2-text-profit" : pnl < 0 ? "itg2-text-loss" : ""}>
                            {formatMoney(pnl)}
                          </span>
                          <span className="text-muted-foreground">
                            {cell.data?.trades} trade{(cell.data?.trades ?? 0) === 1 ? "" : "s"}
                            <span className="hidden sm:inline"> · {Math.round(cell.data?.journalCompletionPct ?? 0)}% journaled</span>
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
            <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="itg2-cal-dot-win inline-block h-2 w-2 rounded-full" aria-hidden="true" />
                Winning day
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="itg2-cal-dot-loss inline-block h-2 w-2 rounded-full" aria-hidden="true" />
                Losing day
              </span>
              <span>Select a trading day to see its trades. Days with no trades are blank — they are not zero-P&amp;L days.</span>
            </p>
          </section>
        )}
    </AppShell>
  );
}

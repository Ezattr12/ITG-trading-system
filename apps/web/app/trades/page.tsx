import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AppShell } from "@/components/app-shell";
import { TradeFiltersForm } from "@/components/trades/trade-filters";
import { getSystemStrategies, getTradeListItems } from "@/lib/trades/queries";
import { applyTradeFilters, paginate } from "@/lib/trades/filters";
import { SESSION_LABELS, tradeFiltersSchema } from "@/lib/trades/validation";
import { formatMoney } from "@/lib/trades/calculations";

export const metadata = { title: "Trades — ITG TraderOS" };

/**
 * Trade list (Phase 3, spec §32). Search + filters by pair,
 * date, long/short, strategy, setup, session, win/loss,
 * psychology, confidence, discipline, market condition.
 * Filters live in the URL. Pagination: 20 per page.
 * The list fetches at most the 500 most recent trades for
 * in-memory psychology/outcome filtering (see queries.ts);
 * that cap is shown below, not hidden.
 *
 * Page 3 presentation (Master Web UI Redesign): an `.itg2`
 * header band and filter panel, glass trade cards on
 * mobile, and the institutional `.itg2-table` in an L2
 * panel on desktop. Markup/classes only — the data flow,
 * URL filters and pagination above are unchanged.
 */

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function TradesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.onboarding?.is_complete) redirect("/onboarding");

  const raw = await searchParams;
  const rawFilters: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) rawFilters[key] = first(value);
  const parsed = tradeFiltersSchema.safeParse(rawFilters);
  const filters = parsed.success
    ? parsed.data
    : { page: 1, perPage: 20 as const };
  // A `to` date means the end of that day, not midnight.
  const toFilter =
    filters.to && filters.to.length === 10 ? `${filters.to}T23:59:59.999Z` : filters.to;
  const effectiveFilters = { ...filters, to: toFilter };

  let items: Awaited<ReturnType<typeof getTradeListItems>> = [];
  let strategies: Awaited<ReturnType<typeof getSystemStrategies>> = [];
  if (isSupabaseConfigured()) {
    const supabase = await createServerSupabaseClient();
    strategies = await getSystemStrategies(supabase);
    items = await getTradeListItems(supabase, user.id, {
      pair: filters.pair,
      direction: filters.direction,
      session: filters.session,
      marketCondition: filters.marketCondition,
      strategyId: filters.strategyId,
      from: filters.from,
      to: toFilter,
    });
  }

  const filtered = applyTradeFilters(items, effectiveFilters);
  const page = paginate(filtered, filters.page, filters.perPage);

  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(rawFilters)) {
      if (value !== undefined && value !== "" && key !== "page") params.set(key, String(value));
    }
    params.set("page", String(p));
    return `/trades?${params.toString()}`;
  };

  return (
    <AppShell email={user.email}>
        <div className="itg2-card itg2-card-flat motion-reveal flex flex-wrap items-start justify-between gap-4 p-5 sm:p-6">
          <div>
            <p className="itg2-eyebrow">Journal</p>
            <h1 className="itg2-page-title mt-1">Trades</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {page.total === 0
                ? "No trades yet."
                : `${page.total} trade${page.total === 1 ? "" : "s"} found.`}{" "}
              Your journal — every trade you add is calculated from your real entries.
            </p>
          </div>
          <Link href="/trades/new" className="itg2-btn-primary shrink-0">
            + Add trade
          </Link>
        </div>

        <div className="mt-6">
          <TradeFiltersForm filters={filters} strategies={strategies} />
        </div>

        {page.total === 0 ? (
          <section className="itg2-card-elevated motion-reveal motion-reveal-2 mt-6 p-5 sm:mt-8 sm:p-6" aria-label="No trades">
            <p className="itg2-eyebrow">Journal</p>
            <h2 className="itg2-section-title mt-1">No trades match</h2>
            <p className="mt-2 text-muted-foreground">
              {items.length === 0
                ? "You have not added any trades yet. A trade takes 30–60 seconds to add."
                : "Try clearing a filter — or add a trade."}
            </p>
            <Link href="/trades/new" className="itg2-btn-primary mt-5">
              Add your first trade
            </Link>
          </section>
        ) : (
          <>
            {/* Mobile: one card per trade — a 720px table squeezed
                into a phone is not a mobile list. Desktop keeps the
                table, which fits there and stays sortable by eye.
                The card leads with what matters when scanning:
                pair, direction, P&L, R, date. */}
            <ul className="motion-reveal motion-reveal-2 mt-6 space-y-3 md:hidden" aria-label="Trades">
              {page.items.map(({ trade, strategyName }) => (
                <li
                  key={trade.id}
                  className={`itg2-card p-4 ${trade.direction === "long" ? "itg2-accent-long" : "itg2-accent-short"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/trades/${trade.id}`} className="min-h-11 text-base font-semibold hover:underline underline-offset-4">
                        {trade.pair}
                      </Link>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span
                          className={`itg2-chip itg2-chip-dir ${trade.direction === "long" ? "itg2-chip-profit" : "itg2-chip-loss"}`}
                        >
                          {trade.direction}
                        </span>
                        <span
                          className={`itg2-chip capitalize ${trade.status === "open" ? "" : "itg2-chip-muted"}`}
                        >
                          {trade.status}
                        </span>
                        {strategyName ? (
                          <span className="itg2-chip itg2-chip-muted">
                            {strategyName}
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <span
                      className={`tnum shrink-0 text-lg font-bold ${trade.pnl === null ? "" : trade.pnl > 0 ? "itg2-text-profit" : trade.pnl < 0 ? "itg2-text-loss" : ""}`}
                    >
                      {trade.status === "open" ? "Open" : formatMoney(trade.pnl)}
                    </span>
                  </div>
                  <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
                    <span className="tnum">{new Date(trade.opened_at).toLocaleDateString()}</span>
                    {trade.session ? <span>{SESSION_LABELS[trade.session]}</span> : null}
                    <span className="tnum">{trade.r_multiple === null ? "—" : `${trade.r_multiple.toFixed(2)}R`}</span>
                    <span>Entry {trade.entry_price} · Exit {trade.exit_price ?? "—"}</span>
                  </p>
                </li>
              ))}
            </ul>
            <div className="itg2-card-elevated motion-reveal motion-reveal-2 mt-6 hidden overflow-x-auto sm:mt-8 md:block">
              <table className="itg2-table">
                <thead>
                  <tr>
                    <th>Pair</th>
                    <th>Direction</th>
                    <th>Strategy</th>
                    <th>Opened</th>
                    <th className="text-right">Entry</th>
                    <th className="text-right">Exit</th>
                    <th className="text-right">P&amp;L</th>
                    <th className="text-right">R</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {page.items.map(({ trade, strategyName }) => (
                    <tr key={trade.id} className={trade.direction === "long" ? "itg2-row-long" : "itg2-row-short"}>
                      <td>
                        <Link href={`/trades/${trade.id}`} className="font-semibold hover:underline underline-offset-4">
                          {trade.pair}
                        </Link>
                      </td>
                      <td>
                        <span
                          className={`itg2-chip itg2-chip-dir ${trade.direction === "long" ? "itg2-chip-profit" : "itg2-chip-loss"}`}
                        >
                          {trade.direction}
                        </span>
                      </td>
                      <td>
                        {strategyName ? (
                          <span className="itg2-chip itg2-chip-muted">
                            {strategyName}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="tnum">{new Date(trade.opened_at).toLocaleDateString()}</td>
                      <td className="text-right tnum">{trade.entry_price}</td>
                      <td className="text-right tnum">{trade.exit_price ?? "—"}</td>
                      <td
                        className={`text-right font-semibold tnum ${
                          trade.pnl === null ? "" : trade.pnl > 0 ? "itg2-text-profit" : trade.pnl < 0 ? "itg2-text-loss" : ""
                        }`}
                      >
                        {formatMoney(trade.pnl)}
                      </td>
                      <td className="text-right tnum">
                        {trade.r_multiple === null ? "—" : `${trade.r_multiple.toFixed(2)}R`}
                      </td>
                      <td>
                        <span
                          className={`itg2-chip capitalize ${trade.status === "open" ? "" : "itg2-chip-muted"}`}
                        >
                          {trade.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                Showing the {Math.min(500, page.total)} most recent trades for filtering.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {page.page > 1 && (
                  <Link href={pageHref(page.page - 1)} className="itg2-btn-ghost">
                    Previous
                  </Link>
                )}
                <span className="itg2-chip px-3 py-1.5 text-xs" aria-current="page">
                  Page {page.page} of {page.totalPages}
                </span>
                {page.page < page.totalPages && (
                  <Link href={pageHref(page.page + 1)} className="itg2-btn-ghost">
                    Next
                  </Link>
                )}
              </div>
            </div>
          </>
        )}
    </AppShell>
  );
}

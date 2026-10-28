import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AppShell } from "@/components/app-shell";
import { TradeFiltersForm } from "@/components/trades/trade-filters";
import { getSystemStrategies, getTradeListItems } from "@/lib/trades/queries";
import { applyTradeFilters, paginate } from "@/lib/trades/filters";
import { tradeFiltersSchema } from "@/lib/trades/validation";
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="page-title">Trades</h1>
            <p className="page-lede">
              {page.total === 0
                ? "No trades yet."
                : `${page.total} trade${page.total === 1 ? "" : "s"} found.`}{" "}
              Your journal — every trade you add is calculated from your real entries.
            </p>
          </div>
          <Link
            href="/trades/new"
            className="inline-flex h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-elevation-1 transition-all duration-fast ease-standard hover:shadow-elevation-2"
          >
            + Add trade
          </Link>
        </div>

        <div className="mt-6">
          <TradeFiltersForm filters={filters} strategies={strategies} />
        </div>

        {page.total === 0 ? (
          <section className="mt-6 sm:mt-8 hero-card card-surface-raised p-4 sm:p-6" aria-label="No trades">
            <h2 className="section-title">No trades match</h2>
            <p className="mt-2 text-muted-foreground">
              {items.length === 0
                ? "You have not added any trades yet. A trade takes 30–60 seconds to add."
                : "Try clearing a filter — or add a trade."}
            </p>
            <Link href="/trades/new" className="mt-4 inline-block text-sm font-medium underline">
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
            <ul className="mt-6 space-y-3 md:hidden" aria-label="Trades">
              {page.items.map(({ trade, strategyName }) => (
                <li key={trade.id} className="trade-card card-surface p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/trades/${trade.id}`} className="min-h-11 text-base font-semibold underline underline-offset-4">
                        {trade.pair}
                      </Link>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${trade.direction === "long" ? "border-sky-500/40 bg-sky-500/10 text-sky-300" : "border-orange-500/40 bg-orange-500/10 text-orange-300"}`}
                        >
                          {trade.direction}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${trade.status === "open" ? "border-sky-500/40 bg-sky-500/10 text-sky-300" : trade.status === "reversed" ? "border-amber-500/40 bg-amber-500/10 text-amber-200" : "border-border bg-muted/60 text-muted-foreground"}`}
                        >
                          {trade.status}
                        </span>
                        {strategyName ? (
                          <span className="inline-flex items-center rounded-full border border-border bg-muted/60 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                            {strategyName}
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <span
                      className={`tnum shrink-0 text-base font-semibold ${trade.pnl === null ? "" : trade.pnl > 0 ? "text-emerald-400" : trade.pnl < 0 ? "text-red-400" : ""}`}
                    >
                      {trade.status === "open" ? "Open" : formatMoney(trade.pnl)}
                    </span>
                  </div>
                  <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
                    <span className="tnum">{new Date(trade.opened_at).toLocaleDateString()}</span>
                    <span className="tnum">{trade.r_multiple === null ? "—" : `${trade.r_multiple.toFixed(2)}R`}</span>
                    <span>Entry {trade.entry_price} · Exit {trade.exit_price ?? "—"}</span>
                  </p>
                </li>
              ))}
            </ul>
            <div className="mt-6 sm:mt-8 hidden overflow-x-auto card-surface md:block">
              <table className="w-full min-w-[800px] text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Pair</th>
                    <th className="px-3 py-2 font-medium">Direction</th>
                    <th className="px-3 py-2 font-medium">Strategy</th>
                    <th className="px-3 py-2 font-medium">Opened</th>
                    <th className="px-3 py-2 text-right font-medium">Entry</th>
                    <th className="px-3 py-2 text-right font-medium">Exit</th>
                    <th className="px-3 py-2 text-right font-medium">P&amp;L</th>
                    <th className="px-3 py-2 text-right font-medium">R</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="list-divider">
                  {page.items.map(({ trade, strategyName }) => (
                    <tr key={trade.id} className="list-row-premium hover:bg-accent/50">
                      <td className="px-3 py-2">
                        <Link href={`/trades/${trade.id}`} className="font-medium underline">
                          {trade.pair}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${trade.direction === "long" ? "border-sky-500/40 bg-sky-500/10 text-sky-300" : "border-orange-500/40 bg-orange-500/10 text-orange-300"}`}
                        >
                          {trade.direction}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {strategyName ? (
                          <span className="inline-flex items-center rounded-full border border-border bg-muted/60 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                            {strategyName}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 tnum">{new Date(trade.opened_at).toLocaleDateString()}</td>
                      <td className="px-3 py-2 text-right tnum">{trade.entry_price}</td>
                      <td className="px-3 py-2 text-right tnum">{trade.exit_price ?? "—"}</td>
                      <td
                        className={`px-3 py-2 text-right font-medium tnum ${
                          trade.pnl === null ? "" : trade.pnl > 0 ? "text-emerald-400" : trade.pnl < 0 ? "text-red-400" : ""
                        }`}
                      >
                        {formatMoney(trade.pnl)}
                      </td>
                      <td className="px-3 py-2 text-right tnum">
                        {trade.r_multiple === null ? "—" : `${trade.r_multiple.toFixed(2)}R`}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${trade.status === "open" ? "border-sky-500/40 bg-sky-500/10 text-sky-300" : trade.status === "reversed" ? "border-amber-500/40 bg-amber-500/10 text-amber-200" : "border-border bg-muted/60 text-muted-foreground"}`}
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
                Page {page.page} of {page.totalPages} · showing the {Math.min(500, page.total)} most recent trades
                for filtering.
              </p>
              <div className="flex gap-2">
                {page.page > 1 && (
                  <Link href={pageHref(page.page - 1)} className="inline-flex min-h-11 items-center rounded-md border bg-card px-3 py-2 shadow-elevation-1 transition-all duration-fast ease-standard hover:bg-accent hover:shadow-elevation-2">
                    Previous
                  </Link>
                )}
                {page.page < page.totalPages && (
                  <Link href={pageHref(page.page + 1)} className="inline-flex min-h-11 items-center rounded-md border bg-card px-3 py-2 shadow-elevation-1 transition-all duration-fast ease-standard hover:bg-accent hover:shadow-elevation-2">
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

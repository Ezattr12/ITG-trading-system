import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AppHeader } from "@/components/app-header";
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
    <div className="min-h-screen">
      <AppHeader email={user.email} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Trades</h1>
            <p className="mt-1 text-muted-foreground">
              {page.total === 0
                ? "No trades yet."
                : `${page.total} trade${page.total === 1 ? "" : "s"} found.`}{" "}
              Your journal — every trade you add is calculated from your real entries.
            </p>
          </div>
          <Link
            href="/trades/new"
            className="inline-flex h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            + Add trade
          </Link>
        </div>

        <div className="mt-6">
          <TradeFiltersForm filters={filters} strategies={strategies} />
        </div>

        {page.total === 0 ? (
          <section className="mt-8 rounded-lg border bg-card p-6" aria-label="No trades">
            <h2 className="text-lg font-semibold">No trades match</h2>
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
            <div className="mt-8 overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Pair</th>
                    <th className="px-3 py-2 font-medium">Direction</th>
                    <th className="px-3 py-2 font-medium">Opened</th>
                    <th className="px-3 py-2 text-right font-medium">Entry</th>
                    <th className="px-3 py-2 text-right font-medium">Exit</th>
                    <th className="px-3 py-2 text-right font-medium">P&amp;L</th>
                    <th className="px-3 py-2 text-right font-medium">R</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {page.items.map(({ trade }) => (
                    <tr key={trade.id} className="border-b last:border-0 hover:bg-accent/50">
                      <td className="px-3 py-2">
                        <Link href={`/trades/${trade.id}`} className="font-medium underline">
                          {trade.pair}
                        </Link>
                      </td>
                      <td className="px-3 py-2 capitalize">{trade.direction}</td>
                      <td className="px-3 py-2">{new Date(trade.opened_at).toLocaleDateString()}</td>
                      <td className="px-3 py-2 text-right">{trade.entry_price}</td>
                      <td className="px-3 py-2 text-right">{trade.exit_price ?? "—"}</td>
                      <td
                        className={`px-3 py-2 text-right font-medium ${
                          trade.pnl === null ? "" : trade.pnl > 0 ? "text-emerald-400" : trade.pnl < 0 ? "text-red-400" : ""
                        }`}
                      >
                        {formatMoney(trade.pnl)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {trade.r_multiple === null ? "—" : `${trade.r_multiple.toFixed(2)}R`}
                      </td>
                      <td className="px-3 py-2 capitalize">{trade.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex items-center justify-between text-sm">
              <p className="text-muted-foreground">
                Page {page.page} of {page.totalPages} · showing the {Math.min(500, page.total)} most recent trades
                for filtering.
              </p>
              <div className="flex gap-2">
                {page.page > 1 && (
                  <Link href={pageHref(page.page - 1)} className="rounded-md border px-3 py-2">
                    Previous
                  </Link>
                )}
                {page.page < page.totalPages && (
                  <Link href={pageHref(page.page + 1)} className="rounded-md border px-3 py-2">
                    Next
                  </Link>
                )}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

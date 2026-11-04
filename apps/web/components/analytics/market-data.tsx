import type { MarketDataPanel, MarketQuote } from "@/lib/market-data/types";

/**
 * Market data panel (Task 27) — the one surface fed by the
 * market-data seam. It renders exactly what the seam returned:
 * real provider quotes labelled with their provider and the
 * provider's own timestamp, or an honest state explaining
 * that market data is not connected / did not answer.
 *
 * Nothing here is a trading price, a chart, or an input:
 * quotes never prefill a journal entry and never label a
 * trade. Daily reference rates are labelled as daily
 * reference rates — never dressed up as live prices.
 */

function formatValue(q: MarketQuote): string {
  const digits = q.symbol === "EUR/USD" || q.symbol === "GBP/USD" ? 4 : 2;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(q.value);
}

function formatAsOf(q: MarketQuote): string {
  if (q.kind === "reference") return q.asOf; // the provider's rate date
  const d = new Date(q.asOf);
  if (Number.isNaN(d.getTime())) return q.asOf;
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function formatFetchedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const s = d.toISOString();
  return `${s.slice(0, 10)} ${s.slice(11, 16)} UTC`;
}

export function MarketDataCard({ data }: { data: MarketDataPanel }) {
  return (
    <section className="itg2-card p-5 sm:p-6" aria-label="Market data">
      <p className="itg2-eyebrow">Market context</p>
      <h2 className="itg2-section-title mt-1">Market data</h2>
      {data.status === "ok" ? (
        <>
          <p className="mt-1 max-w-[720px] text-xs leading-relaxed text-muted-foreground">
            Reference figures from outside ITG, shown for context only. They are
            never used to label your trades, never prefill a journal entry, and
            are not prices from your broker.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="itg2-table itg2-table-fit">
              <thead>
                <tr>
                  <th>Instrument</th>
                  <th>Value</th>
                  <th>Type</th>
                  <th>Source</th>
                  <th>As of</th>
                </tr>
              </thead>
              <tbody>
                {data.quotes.map((q) => (
                  <tr key={`${q.source}:${q.symbol}`}>
                    <td className="font-medium">
                      {q.symbol}
                      <span className="block text-xs font-normal text-muted-foreground">
                        {q.label}
                      </span>
                    </td>
                    <td className="tabular-nums">{formatValue(q)}</td>
                    <td>{q.kind === "spot" ? "Spot price" : "Daily reference rate"}</td>
                    <td>{q.source}</td>
                    <td className="tabular-nums">{formatAsOf(q)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Fetched {data.fetchedAt ? formatFetchedAt(data.fetchedAt) : "—"} via{" "}
            {data.providerName}. Daily reference rates are official central-bank
            midpoints for the date shown — not live tradable rates.
          </p>
        </>
      ) : data.status === "unavailable" ? (
        <p className="mt-3 max-w-[720px] text-muted-foreground">
          Market data is connected ({data.providerName}) but did not answer just
          now, so no figures are shown rather than stale or invented ones.
          Nothing in ITG depends on it — journaling and every other page work
          exactly the same.
        </p>
      ) : data.providerName === "Twelve Data" ? (
        <p className="mt-3 max-w-[720px] text-muted-foreground">
          Twelve Data is selected as the market-data provider, but its API key
          is not set in the server environment, so no quotes can be fetched
          yet. ITG works fully without market data — journaling never depends
          on a feed.
        </p>
      ) : (
        <p className="mt-3 max-w-[720px] text-muted-foreground">
          Market data is not connected, so no external figures are shown. ITG
          works fully without it — journaling never depends on a feed. An
          operator can connect read-only reference data through the
          server environment (see the Task 27 runbook in the project docs).
        </p>
      )}
    </section>
  );
}

/**
 * Market data — types (Task 27).
 *
 * Read-only market context, deliberately LAST in the roadmap
 * and never a dependency for basic journaling. A quote here is
 * an external reference figure shown for context only: it is
 * never written to the database, never prefills or influences
 * a journal form, and never feeds the Coach. Every quote
 * carries the provider that produced it and the provider's own
 * timestamp, so the surface can label it honestly — a daily
 * reference rate is never dressed up as a live price, and a
 * spot price is never dressed up as exchange data.
 */

export type MarketQuoteKind =
  /** A current spot price, timestamped by the provider. */
  | "spot"
  /** An official daily reference rate, dated by the provider. */
  | "reference";

export interface MarketQuote {
  /** Journal-convention symbol, e.g. "XAU/USD", "EUR/USD". */
  symbol: string;
  /** Human label, e.g. "Gold (spot, USD per troy ounce)". */
  label: string;
  /** Numeric value in the convention named by the label. */
  value: number;
  kind: MarketQuoteKind;
  /** Display name of the provider that produced this quote. */
  source: string;
  /**
   * The provider's own timestamp: an ISO instant for spot
   * prices, the reference date (YYYY-MM-DD) for daily rates.
   */
  asOf: string;
}

export type MarketDataStatus =
  /** A provider is configured and answered. */
  | "ok"
  /**
   * No provider is usable: market data is not connected
   * (disabled, or a key-gated provider was selected without
   * its key). The panel shows the enablement copy.
   */
  | "not_configured"
  /**
   * A provider is configured but did not answer. The panel
   * shows an honest unavailable state; nothing else in the
   * app is affected.
   */
  | "unavailable";

export interface MarketDataPanel {
  status: MarketDataStatus;
  /** Quotes when status is "ok"; empty otherwise. */
  quotes: MarketQuote[];
  /** Display name of the configured provider, if any. */
  providerName: string | null;
  /** When this snapshot was fetched (ISO instant). */
  fetchedAt: string | null;
}

/**
 * A market-data provider. Implementations fetch over the
 * network and either resolve with quotes or throw; the
 * service layer (service.ts) owns configuration, caching and
 * failure isolation around them.
 */
export interface MarketDataProvider {
  readonly name: string;
  fetchQuotes(fetchFn: typeof fetch): Promise<MarketQuote[]>;
}

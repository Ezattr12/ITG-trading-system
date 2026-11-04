import {
  createTwelveDataProvider,
  frankfurterProvider,
  goldApiProvider,
} from "./providers";
import type { MarketDataPanel, MarketDataProvider } from "./types";

/**
 * Market data — service (Task 27). The ONLY read path for
 * market data in the app: surfaces call getMarketDataPanel
 * and render what it returns. No page, coach path or
 * background job talks to a provider directly.
 *
 * Configuration (server env, never NEXT_PUBLIC_*):
 * - MARKET_DATA_PROVIDER unset or "keyless" (default): the
 *   keyless composite — Gold-API.com spot gold plus
 *   Frankfurter central-bank reference rates. No key needed;
 *   both sources permit this use (see providers.ts).
 * - MARKET_DATA_PROVIDER=twelvedata: Twelve Data spot
 *   quotes; requires MARKET_DATA_API_KEY. Selected without
 *   a key, the panel is honestly "not configured".
 * - MARKET_DATA_PROVIDER=none: market data disabled.
 *
 * Failure isolation: any provider error, timeout or malformed
 * payload degrades the panel to "unavailable" (or a partial
 * quote set when one composite leg answered). This function
 * NEVER throws, so a market-data outage cannot break a page —
 * market data is context, never a dependency.
 */

export const MARKET_DATA_CACHE_TTL_MS = 60_000;
export const MARKET_DATA_TIMEOUT_MS = 5_000;

type Resolution =
  | { kind: "ready"; providers: MarketDataProvider[]; providerName: string }
  | { kind: "unconfigured"; providerName: string | null };

export function resolveMarketDataProviders(
  env: Record<string, string | undefined>,
): Resolution {
  const selected = (env.MARKET_DATA_PROVIDER ?? "").trim().toLowerCase();
  if (selected === "" || selected === "keyless") {
    return {
      kind: "ready",
      providers: [goldApiProvider, frankfurterProvider],
      providerName: "Gold-API.com + Frankfurter",
    };
  }
  if (selected === "twelvedata") {
    const key = (env.MARKET_DATA_API_KEY ?? "").trim();
    if (!key) return { kind: "unconfigured", providerName: "Twelve Data" };
    return {
      kind: "ready",
      providers: [createTwelveDataProvider(key)],
      providerName: "Twelve Data",
    };
  }
  // "none" / "off" / "disabled", and any unrecognised value:
  // fail closed to not-configured rather than guessing.
  return { kind: "unconfigured", providerName: null };
}

interface CacheEntry {
  expiresAt: number;
  panel: MarketDataPanel;
}

let cache: CacheEntry | null = null;

/** Test hook: the module cache is process state. */
export function resetMarketDataCacheForTests(): void {
  cache = null;
}

export interface MarketDataPanelOptions {
  env?: Record<string, string | undefined>;
  fetchFn?: typeof fetch;
  now?: () => number;
}

export async function getMarketDataPanel(
  options: MarketDataPanelOptions = {},
): Promise<MarketDataPanel> {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const fetchFn = options.fetchFn ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));

  if (cache && cache.expiresAt > now()) return cache.panel;

  const resolution = resolveMarketDataProviders(env);
  if (resolution.kind === "unconfigured") {
    // Not cached: configuration is fixed per process, but an
    // unconfigured panel costs nothing to recompute and a
    // future hot config source should not be masked by it.
    return {
      status: "not_configured",
      quotes: [],
      providerName: resolution.providerName,
      fetchedAt: null,
    };
  }

  const timedFetch: typeof fetch = (input, init) =>
    fetchFn(input, {
      ...init,
      signal: AbortSignal.timeout(MARKET_DATA_TIMEOUT_MS),
    });

  const settled = await Promise.allSettled(
    resolution.providers.map((p) => p.fetchQuotes(timedFetch)),
  );
  const quotes = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const fetchedAt = new Date(now()).toISOString();
  const panel: MarketDataPanel =
    quotes.length > 0
      ? { status: "ok", quotes, providerName: resolution.providerName, fetchedAt }
      : { status: "unavailable", quotes: [], providerName: resolution.providerName, fetchedAt };

  cache = { expiresAt: now() + MARKET_DATA_CACHE_TTL_MS, panel };
  return panel;
}

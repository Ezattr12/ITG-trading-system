import type { MarketDataProvider, MarketQuote } from "./types";

/**
 * Market-data providers (Task 27) — the ONLY files that know
 * a provider's wire format. Providers are pure adapters: they
 * fetch, validate the payload shape, and map it to
 * MarketQuote rows. They never cache, never read env, and
 * never decide configuration — that is the service layer.
 *
 * A malformed payload throws, and the service layer degrades
 * it to "unavailable": a quote is shown only when it was
 * parsed from a real provider response, never reconstructed.
 */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function finiteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Frankfurter (https://frankfurter.dev) — free, keyless,
 * open-source API over official central-bank reference rates
 * (ECB and 100+ other providers). Its FAQ states blended
 * rates are free for commercial use. The rates are DAILY
 * reference rates, not tradable prices: every quote is
 * labelled `reference` with the rate's own date.
 *
 * v2 shape: GET /v2/rates?base=USD&quotes=EUR,GBP,JPY →
 * [{ date, base, quote, rate }] where rate is units of the
 * quote currency per 1 unit of base. Journal convention
 * inverts the EUR and GBP crosses (EUR/USD = USD per EUR);
 * USD/JPY is already in convention (JPY per USD).
 */
const FRANKFURTER_URL =
  "https://api.frankfurter.dev/v2/rates?base=USD&quotes=EUR,GBP,JPY";

const FRANKFURTER_ROWS: {
  quote: string;
  symbol: string;
  label: string;
  invert: boolean;
}[] = [
  { quote: "EUR", symbol: "EUR/USD", label: "Euro / US dollar", invert: true },
  { quote: "GBP", symbol: "GBP/USD", label: "Pound / US dollar", invert: true },
  { quote: "JPY", symbol: "USD/JPY", label: "US dollar / yen", invert: false },
];

export const frankfurterProvider: MarketDataProvider = {
  name: "Frankfurter (central-bank reference rates)",
  async fetchQuotes(fetchFn) {
    const res = await fetchFn(FRANKFURTER_URL, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Frankfurter HTTP ${res.status}`);
    const body: unknown = await res.json();
    if (!Array.isArray(body)) throw new Error("Frankfurter: unexpected payload");
    const byQuote = new Map<string, { rate: number; date: string }>();
    for (const row of body) {
      if (!isRecord(row)) continue;
      const rate = finiteNumber(row.rate);
      if (
        typeof row.quote === "string" &&
        rate !== null &&
        rate > 0 &&
        typeof row.date === "string"
      ) {
        byQuote.set(row.quote, { rate, date: row.date });
      }
    }
    const quotes: MarketQuote[] = [];
    for (const spec of FRANKFURTER_ROWS) {
      const row = byQuote.get(spec.quote);
      if (!row) continue;
      quotes.push({
        symbol: spec.symbol,
        label: spec.label,
        value: spec.invert ? 1 / row.rate : row.rate,
        kind: "reference",
        source: "Frankfurter",
        asOf: row.date,
      });
    }
    if (quotes.length === 0) throw new Error("Frankfurter: no usable rates");
    return quotes;
  },
};

/**
 * Gold-API.com — keyless spot prices for precious metals.
 * The /price endpoint needs no key (FAQ: free, unlimited) and
 * its Terms of Service §9 states commercial use, including in
 * web applications, is always permitted. Spot shape:
 * GET /price/XAU → { symbol, price, updatedAt, ... }.
 *
 * Only gold is surfaced: it is the metal this product
 * journals (XAUUSD). Other symbols the provider offers are
 * deliberately not shown.
 */
const GOLD_API_URL = "https://api.gold-api.com/price/XAU";

export const goldApiProvider: MarketDataProvider = {
  name: "Gold-API.com (spot metals)",
  async fetchQuotes(fetchFn) {
    const res = await fetchFn(GOLD_API_URL, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Gold-API HTTP ${res.status}`);
    const body: unknown = await res.json();
    if (!isRecord(body)) throw new Error("Gold-API: unexpected payload");
    const price = finiteNumber(body.price);
    if (
      body.symbol !== "XAU" ||
      price === null ||
      price <= 0 ||
      typeof body.updatedAt !== "string"
    ) {
      throw new Error("Gold-API: no usable price");
    }
    return [
      {
        symbol: "XAU/USD",
        label: "Gold (spot, USD per troy ounce)",
        value: price,
        kind: "spot",
        source: "Gold-API.com",
        asOf: body.updatedAt,
      },
    ];
  },
};

/**
 * Twelve Data (https://api.twelvedata.com) — the key-gated
 * upgrade path: real-time spot quotes for FX and metals
 * behind one API. Selected with MARKET_DATA_PROVIDER=
 * twelvedata and requires MARKET_DATA_API_KEY. Note the
 * terms reality (pricing page, checked 2026-11-04): the free
 * Basic plan is "internal non-display usage" — displaying
 * quotes needs a display plan. The adapter is plan-agnostic;
 * choosing a compliant plan is the operator's step in the
 * enablement runbook (docs/task-27-market-data.md).
 *
 * Quote shape: GET /quote?symbol=XAU/USD,EUR/USD,... →
 * a single object for one symbol, or a map keyed by symbol
 * for several. Error payloads carry { code, status: "error" }.
 */
const TWELVE_SYMBOLS = ["XAU/USD", "EUR/USD", "GBP/USD", "USD/JPY"] as const;

const TWELVE_LABELS: Record<string, string> = {
  "XAU/USD": "Gold (spot, USD per troy ounce)",
  "EUR/USD": "Euro / US dollar",
  "GBP/USD": "Pound / US dollar",
  "USD/JPY": "US dollar / yen",
};

export function createTwelveDataProvider(apiKey: string): MarketDataProvider {
  return {
    name: "Twelve Data",
    async fetchQuotes(fetchFn) {
      const url =
        "https://api.twelvedata.com/quote?symbol=" +
        TWELVE_SYMBOLS.map(encodeURIComponent).join(",") +
        `&apikey=${encodeURIComponent(apiKey)}`;
      const res = await fetchFn(url, {
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}`);
      const body: unknown = await res.json();
      if (!isRecord(body)) throw new Error("Twelve Data: unexpected payload");
      // A single-symbol response is the quote itself; a
      // multi-symbol response is a map keyed by symbol.
      const rows: Record<string, unknown>[] =
        typeof body.symbol === "string"
          ? [body]
          : TWELVE_SYMBOLS.map((s) => body[s]).filter(isRecord);
      const quotes: MarketQuote[] = [];
      for (const row of rows) {
        if (!isRecord(row) || row.status === "error") continue;
        const symbol = typeof row.symbol === "string" ? row.symbol : null;
        const close =
          typeof row.close === "string" ? Number(row.close) : finiteNumber(row.close);
        const ts = finiteNumber(row.timestamp);
        if (!symbol || !(symbol in TWELVE_LABELS) || close === null || !(close > 0) || ts === null) {
          continue;
        }
        quotes.push({
          symbol,
          label: TWELVE_LABELS[symbol],
          value: close,
          kind: "spot",
          source: "Twelve Data",
          asOf: new Date(ts * 1000).toISOString(),
        });
      }
      if (quotes.length === 0) throw new Error("Twelve Data: no usable quotes");
      return quotes;
    },
  };
}

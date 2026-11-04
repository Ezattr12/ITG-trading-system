import { describe, expect, it, vi } from "vitest";
import {
  createTwelveDataProvider,
  frankfurterProvider,
  goldApiProvider,
} from "./providers";

/**
 * Market-data provider adapters (Task 27). Payloads below are
 * the providers' real response shapes, captured from live
 * responses on 2026-11-04 — the adapters are pinned against
 * the shapes, never against invented data.
 */

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

const fetchReturning =
  (body: unknown, ok = true, status = 200) =>
  async () =>
    jsonResponse(body, ok, status);

describe("goldApiProvider", () => {
  it("maps a real-shaped spot payload to a labelled spot quote", async () => {
    const fetchFn = fetchReturning({
      currency: "USD",
      currencySymbol: "$",
      exchangeRate: 1.0,
      name: "Gold",
      price: 4061.199951,
      symbol: "XAU",
      updatedAt: "2026-11-04T22:28:00Z",
      updatedAtReadable: "a few seconds ago",
    }) as typeof fetch;
    const quotes = await goldApiProvider.fetchQuotes(fetchFn);
    expect(quotes).toEqual([
      {
        symbol: "XAU/USD",
        label: "Gold (spot, USD per troy ounce)",
        value: 4061.199951,
        kind: "spot",
        source: "Gold-API.com",
        asOf: "2026-11-04T22:28:00Z",
      },
    ]);
  });

  it("throws on HTTP errors and unusable payloads", async () => {
    await expect(
      goldApiProvider.fetchQuotes(fetchReturning({}, false, 503) as typeof fetch),
    ).rejects.toThrow();
    await expect(
      goldApiProvider.fetchQuotes(
        fetchReturning({ symbol: "XAG", price: 52.3, updatedAt: "2026-11-04T22:28:59Z" }) as typeof fetch,
      ),
    ).rejects.toThrow();
    await expect(
      goldApiProvider.fetchQuotes(
        fetchReturning({ symbol: "XAU", updatedAt: "2026-11-04T22:28:59Z" }) as typeof fetch,
      ),
    ).rejects.toThrow();
  });
});

describe("frankfurterProvider", () => {
  it("maps v2 rates: EUR/GBP inverted into journal convention, JPY direct, all reference-dated", async () => {
    const fetchFn = fetchReturning([
      { date: "2026-11-05", base: "USD", quote: "EUR", rate: 0.89093 },
      { date: "2026-11-05", base: "USD", quote: "GBP", rate: 0.74372 },
      { date: "2026-11-04", base: "USD", quote: "JPY", rate: 158.27 },
    ]) as typeof fetch;
    const quotes = await frankfurterProvider.fetchQuotes(fetchFn);
    expect(quotes).toHaveLength(3);
    const bySymbol = new Map(quotes.map((q) => [q.symbol, q]));
    expect(bySymbol.get("EUR/USD")?.value).toBeCloseTo(1 / 0.89093, 10);
    expect(bySymbol.get("GBP/USD")?.value).toBeCloseTo(1 / 0.74372, 10);
    expect(bySymbol.get("USD/JPY")?.value).toBe(158.27);
    for (const q of quotes) {
      expect(q.kind).toBe("reference");
      expect(q.source).toBe("Frankfurter");
    }
    expect(bySymbol.get("USD/JPY")?.asOf).toBe("2026-11-04");
  });

  it("skips missing or invalid rows and throws when nothing usable remains", async () => {
    const partial = await frankfurterProvider.fetchQuotes(
      fetchReturning([
        { date: "2026-11-05", base: "USD", quote: "EUR", rate: 0.89093 },
        { date: "2026-11-05", base: "USD", quote: "GBP", rate: -1 },
        "junk",
      ]) as typeof fetch,
    );
    expect(partial.map((q) => q.symbol)).toEqual(["EUR/USD"]);
    await expect(
      frankfurterProvider.fetchQuotes(fetchReturning({ nope: true }) as typeof fetch),
    ).rejects.toThrow();
    await expect(
      frankfurterProvider.fetchQuotes(fetchReturning([], false, 500) as typeof fetch),
    ).rejects.toThrow();
  });
});

describe("createTwelveDataProvider", () => {
  it("parses a multi-symbol quote map and skips error rows", async () => {
    const seen: string[] = [];
    const fetchFn = (async (input: unknown) => {
      seen.push(String(input));
      return jsonResponse({
        "XAU/USD": { symbol: "XAU/USD", close: "4061.20", timestamp: 1793828880, status: "ok" },
        "EUR/USD": { symbol: "EUR/USD", close: "1.1224", timestamp: 1793828880, status: "ok" },
        "GBP/USD": { code: 401, status: "error", message: "not available" },
        "USD/JPY": { symbol: "USD/JPY", close: "158.27", timestamp: 1793828880, status: "ok" },
      });
    }) as typeof fetch;
    const quotes = await createTwelveDataProvider("test-key").fetchQuotes(fetchFn);
    expect(seen[0]).toContain("api.twelvedata.com/quote");
    expect(seen[0]).toContain("apikey=test-key");
    expect(quotes.map((q) => q.symbol)).toEqual(["XAU/USD", "EUR/USD", "USD/JPY"]);
    expect(quotes[0].kind).toBe("spot");
    expect(quotes[0].source).toBe("Twelve Data");
    expect(quotes[0].value).toBeCloseTo(4061.2, 6);
    expect(quotes[0].asOf).toBe(new Date(1793828880 * 1000).toISOString());
  });

  it("throws when every row is an error", async () => {
    const fetchFn = fetchReturning({ code: 401, status: "error", message: "bad key" }) as typeof fetch;
    await expect(createTwelveDataProvider("k").fetchQuotes(fetchFn)).rejects.toThrow();
  });

  it("uses the fetch function it is given (no hidden network)", async () => {
    const spy = vi.fn(fetchReturning({}));
    await expect(
      createTwelveDataProvider("k").fetchQuotes(spy as unknown as typeof fetch),
    ).rejects.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

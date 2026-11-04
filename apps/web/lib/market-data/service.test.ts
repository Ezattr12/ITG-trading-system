import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MARKET_DATA_CACHE_TTL_MS,
  getMarketDataPanel,
  resetMarketDataCacheForTests,
  resolveMarketDataProviders,
} from "./service";

/**
 * Market-data service (Task 27): configuration gate, cache
 * and failure isolation. The network is a canned fetch keyed
 * by URL — the fake lives in this test file only and is never
 * a runtime fallback: production code has no test double, and
 * an unconfigured or failing provider yields an honest panel
 * state, never invented quotes.
 */

const GOLD_BODY = {
  currency: "USD",
  name: "Gold",
  price: 4061.199951,
  symbol: "XAU",
  updatedAt: "2026-11-04T22:28:00Z",
};

const FRANKFURTER_BODY = [
  { date: "2026-11-05", base: "USD", quote: "EUR", rate: 0.89093 },
  { date: "2026-11-05", base: "USD", quote: "GBP", rate: 0.74372 },
  { date: "2026-11-04", base: "USD", quote: "JPY", rate: 158.27 },
];

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

/** A fetch that answers per-provider canned payloads. */
function cannedFetch(overrides: { gold?: unknown; fx?: unknown; twelve?: unknown } = {}) {
  return vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes("gold-api.com")) return jsonResponse(overrides.gold ?? GOLD_BODY);
    if (url.includes("frankfurter.dev")) return jsonResponse(overrides.fx ?? FRANKFURTER_BODY);
    if (url.includes("twelvedata.com")) {
      return jsonResponse(
        overrides.twelve ?? {
          "XAU/USD": { symbol: "XAU/USD", close: "4061.20", timestamp: 1793828880, status: "ok" },
        },
      );
    }
    throw new Error(`unexpected URL ${url}`);
  });
}

const failingFetch = vi.fn(async () => {
  throw new Error("network down");
});

beforeEach(() => {
  resetMarketDataCacheForTests();
  vi.clearAllMocks();
});

describe("resolveMarketDataProviders — the configuration gate", () => {
  it("defaults to the keyless composite when the provider is unset", () => {
    const r = resolveMarketDataProviders({});
    expect(r.kind).toBe("ready");
    if (r.kind === "ready") expect(r.providers).toHaveLength(2);
  });

  it("treats 'none' and unrecognised values as not configured (fail closed)", () => {
    expect(resolveMarketDataProviders({ MARKET_DATA_PROVIDER: "none" }).kind).toBe("unconfigured");
    expect(resolveMarketDataProviders({ MARKET_DATA_PROVIDER: "off" }).kind).toBe("unconfigured");
    expect(resolveMarketDataProviders({ MARKET_DATA_PROVIDER: "something-else" }).kind).toBe("unconfigured");
  });

  it("gates Twelve Data on its key: selected without a key is unconfigured", () => {
    const noKey = resolveMarketDataProviders({ MARKET_DATA_PROVIDER: "twelvedata" });
    expect(noKey.kind).toBe("unconfigured");
    expect(noKey.providerName).toBe("Twelve Data");
    const withKey = resolveMarketDataProviders({
      MARKET_DATA_PROVIDER: "twelvedata",
      MARKET_DATA_API_KEY: "abc",
    });
    expect(withKey.kind).toBe("ready");
  });
});

describe("getMarketDataPanel", () => {
  it("returns labelled quotes from both keyless legs by default", async () => {
    const fetchFn = cannedFetch();
    const panel = await getMarketDataPanel({ env: {}, fetchFn: fetchFn as unknown as typeof fetch });
    expect(panel.status).toBe("ok");
    expect(panel.providerName).toBe("Gold-API.com + Frankfurter");
    expect(panel.quotes.map((q) => q.symbol)).toEqual(["XAU/USD", "EUR/USD", "GBP/USD", "USD/JPY"]);
    expect(panel.quotes[0].kind).toBe("spot");
    expect(panel.quotes[1].kind).toBe("reference");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("serves the cache within the TTL and refetches after it", async () => {
    const fetchFn = cannedFetch();
    let now = 1_000_000;
    const opts = { env: {}, fetchFn: fetchFn as unknown as typeof fetch, now: () => now };
    await getMarketDataPanel(opts);
    await getMarketDataPanel(opts);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    now += MARKET_DATA_CACHE_TTL_MS + 1;
    await getMarketDataPanel(opts);
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it("never throws when the network fails: the panel degrades to unavailable", async () => {
    const panel = await getMarketDataPanel({
      env: {},
      fetchFn: failingFetch as unknown as typeof fetch,
    });
    expect(panel.status).toBe("unavailable");
    expect(panel.quotes).toEqual([]);
    expect(panel.providerName).toBe("Gold-API.com + Frankfurter");
  });

  it("keeps the answering leg's quotes when the other leg fails (partial, honestly labelled)", async () => {
    const fetchFn = vi.fn(async (input: unknown) => {
      if (String(input).includes("frankfurter.dev")) throw new Error("fx down");
      return jsonResponse(GOLD_BODY);
    });
    const panel = await getMarketDataPanel({ env: {}, fetchFn: fetchFn as unknown as typeof fetch });
    expect(panel.status).toBe("ok");
    expect(panel.quotes.map((q) => q.symbol)).toEqual(["XAU/USD"]);
  });

  it("treats malformed payloads as unavailable, never as quotes", async () => {
    const panel = await getMarketDataPanel({
      env: {},
      fetchFn: cannedFetch({ gold: { nope: 1 }, fx: { nope: 2 } }) as unknown as typeof fetch,
    });
    expect(panel.status).toBe("unavailable");
    expect(panel.quotes).toEqual([]);
  });

  it("does not touch the network when market data is not configured", async () => {
    const fetchFn = cannedFetch();
    const off = await getMarketDataPanel({
      env: { MARKET_DATA_PROVIDER: "none" },
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(off.status).toBe("not_configured");
    const keyless12 = await getMarketDataPanel({
      env: { MARKET_DATA_PROVIDER: "twelvedata" },
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(keyless12.status).toBe("not_configured");
    expect(keyless12.providerName).toBe("Twelve Data");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("uses Twelve Data spot quotes when it is selected with a key", async () => {
    const fetchFn = cannedFetch();
    const panel = await getMarketDataPanel({
      env: { MARKET_DATA_PROVIDER: "twelvedata", MARKET_DATA_API_KEY: "abc" },
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(panel.status).toBe("ok");
    expect(panel.providerName).toBe("Twelve Data");
    expect(panel.quotes).toHaveLength(1);
    expect(panel.quotes[0].source).toBe("Twelve Data");
    expect(String(fetchFn.mock.calls[0][0])).toContain("apikey=abc");
  });
});

# Task 27 — Future Market Data Integrations (read-only)

## 1. The mandate's shape

- Market data comes LAST in the roadmap, is READ-ONLY, and
  must NEVER become a dependency for basic journaling. This
  task builds the integration seam and one honest surface.
  Nothing here connects to a broker, places an order, or
  writes market data anywhere: quotes are fetched at read
  time, shown with their source and timestamp, and forgotten
  (a 60-second in-memory cache is the only retention).
- No fake data: no demo feed, no simulated prices, no
  fallback numbers. A provider that does not answer yields
  an honest panel state, never an invented quote.
- If a provider needs an API key, the key is Ezat's to
  supply. Everything that does not need a key is built and
  verified here; §8 is the exact enablement step for the
  key-gated upgrade path.

## 2. Provider audit (evidence, checked 2026-11-04)

Instruments this product journals: XAUUSD (gold), major FX
pairs, indices. Candidates surveyed:

| Provider | Key? | Data | Free-tier limits | Display terms | Sandbox reality check |
|---|---|---|---|---|---|
| Frankfurter (frankfurter.dev) | No | Daily reference rates for 200+ currencies from the ECB and 100+ central banks (v2 API) | No cap (fair use) | Open source (MIT); its FAQ: blended rates "are Frankfurter's own calculation and free to use" — commercial use YES. ECB data is free to reuse. | **Answered live**: `GET api.frankfurter.dev/v2/rates?base=USD&quotes=EUR,GBP,JPY` returned dated rates (EUR 0.89093 dated 2026-11-05, GBP 0.74372, JPY 158.27 dated 2026-11-04). |
| Gold-API.com | No for spot | Spot prices for XAU, XAG, XPT, XPD (per troy ounce, USD) | /price endpoint: free, unlimited (FAQ); prices update ~30s | Terms of Service §9: "Commercial use of the API is always permitted, including use in web applications, mobile apps, and third-party websites." | **Answered live**: `GET api.gold-api.com/price/XAU` returned price 4061.199951 with `updatedAt 2026-11-04T22:28:00Z`. |
| Stooq | **Yes (since Mar 2026)** | Daily/hourly/5-min OHLC CSV incl. xauusd | Unpublished daily hit limit per IP | Personal use only; ToS §5.3 bars redistribution without consent; commercial use prohibited on the download page | **Did not answer**: the quote CSV request returned empty. Disqualified twice — no longer keyless, and terms forbid product display. |
| Twelve Data | Yes | Real-time + historical quotes/OHLC for FX, metals, indices, stocks, crypto | Basic (free): 800 credits/day, 8 credits/min | Pricing page: Basic is "**Internal non-display usage**"; display begins at Grow ("Internal display data access", $79/mo) | Not testable without a key (none requested — signing up is Ezat's step). |
| Alpha Vantage | Yes | FX daily/intraday series, stocks, some commodities | Free: 25 requests/day | Free key is for development use per its terms; no clean spot XAU/USD quote | Not wired: 25 req/day cannot serve a panel honestly, and its gold coverage is not a spot quote. |

Sources: frankfurter.dev (FAQ + v2 docs), gold-api.com
(FAQ + Terms of Service), twelvedata.com/pricing and
support.twelvedata.com plan article (checked 2026-11-04),
stockmarketstack.com / fxmacrodata.com Stooq reviews
(Oct 2026: key requirement + scripted-access refusal).

**Recommendation.** Ship the keyless composite —
Gold-API.com (spot gold) + Frankfurter (FX daily reference
rates) — as the default provider: it covers the product's
most-journaled instrument (gold) with a real spot price and
the major FX crosses with official reference rates, costs
nothing, needs no key, and both sources permit this use in
writing. Build the Twelve Data adapter behind the same
interface as the upgrade path: it is the honest route to
intraday spot FX and indices, and §8 documents its key +
plan-terms reality. Indices have NO qualifying keyless
source today (Stooq disqualified), so no index figures are
shown — the panel never implies coverage it does not have.

## 3. The seam (built regardless of provider choice)

Following the established pattern (a read → a pure mapping →
an honest surface; Task 26 §9: a future data source enters
through the same shape, never by a surface fetching a
provider directly):

- `apps/web/lib/market-data/types.ts` — `MarketQuote`
  (symbol, label, value, kind `spot|reference`, source,
  provider timestamp), `MarketDataPanel` (status
  `ok|not_configured|unavailable`, quotes, provider name,
  fetch time), and the `MarketDataProvider` interface.
- `apps/web/lib/market-data/providers.ts` — the only files
  that know a wire format. `goldApiProvider`,
  `frankfurterProvider` (EUR/GBP inverted into journal
  convention in the mapping, JPY direct; every rate keeps
  its own date), `createTwelveDataProvider(apiKey)`.
  Adapters validate payload shape and throw on anything
  unusable — a quote exists only if it was parsed from a
  real response.
- `apps/web/lib/market-data/service.ts` — the only read
  path. `getMarketDataPanel()` owns:
  - **Configuration gate** (server env only):
    `MARKET_DATA_PROVIDER` unset or `keyless` → the keyless
    composite (default); `twelvedata` → Twelve Data,
    requiring `MARKET_DATA_API_KEY` (selected without a key
    → `not_configured` naming Twelve Data); `none`/`off` or
    any unrecognised value → `not_configured` (fail closed).
  - **Cache**: one process-level entry, 60 s TTL — inside
    both keyless sources' update cadence (gold updates
    ~30 s per its FAQ; reference rates are daily).
  - **Failure isolation**: 5 s per-request timeout via
    `AbortSignal.timeout`; legs settle independently
    (`Promise.allSettled`) so one source failing still
    shows the other's quotes; total failure →
    `unavailable`. The function NEVER throws, so a
    market-data outage cannot break any page.
- No surface, coach path or background job fetches a
  provider directly — the analytics page calls
  `getMarketDataPanel()` once, alongside its existing
  reads. Market data is not stored: no migration, no
  table, no audit row (nothing about the trader is read
  or written; the panel is identical for every user).

## 4. The surface

- Placement: **/analytics**, after the intelligence
  section. The dashboard is the trader's own record
  (their trades, goals, discipline); external context
  belongs with the analysis surfaces, and /analytics is
  where Tasks 25–26 put recorded-condition and research
  context. One panel, no new route.
- `apps/web/components/analytics/market-data.tsx`
  (`MarketDataCard`), existing `.itg2-*` classes only,
  zero new CSS, no violet. Columns: Instrument / Value /
  Type / Source / As of. "Type" is the honesty column:
  "Spot price" vs "Daily reference rate", and the footer
  repeats that reference rates are official central-bank
  midpoints for the date shown — not live tradable rates.
  The header copy states the boundary in words: reference
  figures for context only, never used to label trades,
  never prefill a journal entry, not prices from a broker.
- States: `ok` (quotes table), `unavailable` ("did not
  answer just now, so no figures are shown rather than
  stale or invented ones"), `not_configured` (plain
  statement + what enabling takes; a Twelve-Data-specific
  variant when that provider is selected without its key).
- No candlesticks (the design system omits them — no feed
  has ever existed to draw them from, and drawing them is
  a separate product decision), no prices anywhere near
  trade entry, no prefill of any journal field, ever.

## 5. What a real feed changes — and what it does not

- Task 25 §1: with a feed, trades could additionally be
  TAGGED with measured market state as a new recorded
  field with a named source. This task does NOT do that:
  the panel is context display only, and `market_condition`
  remains the trader's own label. One copy consequence:
  the Task 25 card said "ITG has no live market feed" —
  that clause was updated to "Market data is never used to
  label your trades", which stays true with the panel
  live. (Single sentence; no test pinned the old wording;
  the claim it made is preserved in the new wording.)
- Task 26 §9: strategy replay against historical prices
  becomes computable only with a historical series AND a
  recording surface for strategy parameters/results —
  still a product decision, not built here. The keyless
  sources provide no candle history suitable for replay
  (Frankfurter is daily reference rates; Gold-API history
  is key-gated), and Twelve Data history would arrive
  only with Ezat's key + plan.
- Coach: market data is NOT wired into the Coach, by
  design. Coach evidence is the trader's own recorded
  trades (OBSERVE → ANALYZE → EXPLAIN → COACH over their
  record); quoting an external price inside coaching
  would blur FACT (their record) with outside context,
  and the coach skill bars presenting a price as a live
  market fact in an answer. Market context in coaching
  is a future, separate decision for Ezat.

## 6. Deliberately not built

- No indices (no qualifying keyless source — §2).
- No historical candles, no charts of any kind, no
  WebSocket/streaming, no per-user watchlists (the panel
  shows a fixed, labelled set: XAU/USD, EUR/USD, GBP/USD,
  USD/JPY — the instruments the journal centres on).
- No storage, no migration, no background-job fetching,
  no mobile change (mobile consumes its own surfaces;
  the seam is web-server-side and reusable later).
- No sign-ups, no keys requested, no production config
  changed by this task.

## 7. Tests

- `providers.test.ts` (7): adapters pinned against the
  providers' REAL response shapes captured live on
  2026-11-04 — gold spot mapping; Frankfurter inversion,
  dating and invalid-row skipping; Twelve Data map
  parsing, error-row skipping, key in the request URL.
- `service.test.ts` (10): the configuration gate
  (default composite, fail-closed values, Twelve Data
  key gate), the 60 s cache (hit + expiry), failure
  isolation (total failure → `unavailable`, never a
  throw; one leg down → the other's quotes survive;
  malformed payloads → no quotes), and no network at all
  when not configured. The fake is a canned fetch living
  ONLY in the test file — there is no test double in
  runtime code and no runtime fallback data.
- Gate results: see §10 (filled on completion).

## 8. Enablement runbook (for Ezat — the only key-gated part)

The panel is LIVE by default on the keyless sources; no
action is needed for what ships in this task. The
optional upgrade — intraday spot quotes for FX and
indices via Twelve Data — needs:

1. Create a Twelve Data account at twelvedata.com and
   copy the API key from the dashboard. Do NOT paste the
   key in chat — it goes through Muse's secure
   credential flow / the Vercel connector, like every
   other secret in this project.
2. Terms check before choosing the plan: the free Basic
   plan is internal non-display usage only (their pricing
   page). Displaying quotes in the product needs a plan
   with display rights (Grow or above at the time of
   writing). Pick the plan deliberately; the code does
   not care which plan, only that a key exists.
3. Set two production env vars on the Vercel project
   (via the Vercel connector): `MARKET_DATA_PROVIDER=
   twelvedata` and `MARKET_DATA_API_KEY=<the key>`, then
   redeploy. The panel switches to Twelve Data spot
   quotes (XAU/USD, EUR/USD, GBP/USD, USD/JPY) labelled
   "Twelve Data" with per-quote timestamps.
4. To return to the keyless sources, clear
   `MARKET_DATA_PROVIDER` (or set it to `keyless`) and
   redeploy. To disable the panel's data entirely, set
   `MARKET_DATA_PROVIDER=none`.

What does NOT change in any configuration: journaling,
levels, assessments, certificates, the Coach — market
data has no write path into any of them.

## 9. Production verification script (for the parent)

1. Baseline first (read-only SQL): A unchanged — 10
   trades / 390 XP / 23 notifications / 1 assessment /
   0 certificates; auth users 4.
2. Deploy; poll READY; resolve the production alias to
   the new deployment id.
3. Smokes: prod-smoke-t10.py and prod-smoke-levels.py
   ALL PASS (the seam must not disturb any existing
   surface).
4. A's /analytics SSR: the "Market data" section is
   present at the end of the page with real quotes —
   XAU/USD labelled Spot price / Gold-API.com with a
   current UTC timestamp, EUR/USD + GBP/USD + USD/JPY
   labelled Daily reference rate / Frankfurter with a
   rate date — and a "Fetched … via Gold-API.com +
   Frankfurter" footer. Values should be in a sane range
   of the day (gold four-thousands in Nov 2026) — check
   plausibility against the provider sites, never exact
   equality (prices move).
5. Journaling independence: as A, open /trades/new —
   the form is unchanged, no price prefilled anywhere;
   the trade list and dashboard render as before.
6. Failure posture (optional, config-level): the
   not-configured and unavailable states are unit-pinned
   and locally rendered; do NOT change production env to
   demo them.
7. Re-verify A's baseline byte-identical after all
   checks.

## 10. Gate results

Local battery (2026-11-04, env sourced from
`~/workspace/.itg-helpers/itg-env.sh`):

- **Vitest: 1025/1025 passed** (93 files; baseline 1008 + 17 new —
  providers.test.ts 7, service.test.ts 10). No existing assertion
  modified.
- **Typecheck: clean** (web + @itg/calc). **Lint: 0 errors** (1
  pre-existing dashboard `<img>` warning — the established baseline).
- **Production build: clean and verified on disk** — ✓ Compiled
  successfully, static pages 51/51, /analytics 210 B, First Load JS
  shared 103 kB (unchanged). `.next` verified present with a valid
  BUILD_ID after the build (see the fault note below).
- **Security check: PASSED** (447 files scanned; baseline 441 + 6 new).
- **Playwright e2e: 36/36 passed** via the mandated shape — repo
  root, env sourced, `CI=true npm run test:e2e` (2.2m). No deviation
  was needed.
- **Visual QA (local build, account A session): ALL CHECKS PASSED in
  both states at 390px and 1280px** (script
  `~/workspace/.itg-helpers/qa-t27-market.mjs`). Configured state:
  the panel rendered the four live quotes with correct
  Instrument/Value/Type/Source/As-of labels, boundary copy and
  footer; values plausibility-checked (gold spot 4,061.70 fetched
  2026-11-04 23:14 UTC; EUR/USD 1.1224 and GBP/USD 1.3446 inverted
  into journal convention from the Frankfurter USD-base rates;
  USD/JPY 158.27); no chart/canvas; no violet; zero horizontal
  overflow. Not-configured state (server restarted with
  `MARKET_DATA_PROVIDER=none`): the panel rendered the plain
  not-connected copy, no table, no symbols; zero overflow. Two
  initial QA-script assertion strings mismatched the shipped copy
  (eyebrow CSS uppercases the text; gold label is "Gold (spot, USD
  per troy ounce)") — the script was corrected to the shipped copy
  and re-run to ALL PASS; the application code was not changed.

**Infrastructure note (honest record):** a sandbox storage-fault
window (the recurring EPERM-on-write fault) blocked the local
battery for several hours on 2026-11-04: `next build` died within
~1s and one earlier build whose console reported success left no
valid artifact on disk. The battery above was completed after the
window cleared, with the build artifact verified on disk (BUILD_ID
+ size) before any result was trusted, and the e2e run used the
mandated CI=true shape with no deviation. Production was never
involved and is unaffected.

**Account A baseline:** untouched throughout — no writes of any
kind were made to any account; the seam writes nothing anywhere.

## 11. Task 28 hand-off — Final Institutional Production Audit

- Market data closes the feature roadmap: Tasks 1–27
  will all be built on the trader's own record plus this
  one read-only external seam. The final audit should
  re-verify the whole chain — including that the seam's
  invariants still hold in production (panel labelled,
  journal unaffected, no coach use of market data).
- Known residuals that remain Task 28's, unchanged by
  this task: the Vercel cron registration question for
  /api/intelligence/run; A's 4 backtest sessions without
  XP awards (Ezat's backfill decision); the Coach's
  taxonomy decisions (pairwise condition intent,
  backtesting intent) and its LLM key (Task 16 steps
  5–8); Supabase PITR (Ezat's dashboard action).

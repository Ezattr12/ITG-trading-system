# Phase 24 — Advanced Reporting

**Date:** 2026-10-30. **Scope:** local implementation + tests +
docs. Not deployed, not committed (the parent's gate, as in
Phases 20–23).

**Mandate:** improve the reporting system across the board —
weekly, monthly, performance, psychology, risk, strategy,
Coach and PDF reports — all from real production data,
reusing the existing engines. No fake data, no duplicated
math, honest empty / insufficient states everywhere. The
Coach Engine's math (`lib/coach/insights.ts`, `queries.ts`,
`service.ts` semantics), the Phase 23 intelligence analyzers'
definitions, and every P&L / risk / XP calculation are
untouched: this phase only **composes** their outputs.

## Audit findings (what already existed)

| Area | Existing asset | Phase 24 stance |
|---|---|---|
| Period summary | `lib/reports/queries.ts#getReportSummary` → `lib/reports/reports.ts#buildReportSummary` (trades, P&L, win rate, profit factor, expectancy, avg R, journal/discipline %, goals, by-strategy / by-session / by-emotion, most-frequent losing setup, most-repeated mistake, rule-based recommendations). `periodBounds` anchors daily / Monday-first weekly / calendar monthly periods. | Reused unchanged as the spine of every report. |
| Reports page | `app/reports/page.tsx` — daily/weekly/monthly period control + date anchor, stat grid, by-strategy and psychology tables, recommendations, Print + PDF download. | Extended in place (see UI design). The existing summary view is preserved as the Performance report. |
| PDF | `lib/reports/pdf.ts#buildReportPdf` (pdfkit, A4, generated on demand from a computed `ReportSummary`; same library as `lib/certificates/pdf.ts`), served by `app/reports/pdf/route.ts` (`?type=&start=&end=`, 400 on invalid type/period, 401 unauthenticated, 503 unconfigured). Smoke-tested in `lib/certificates/pdf.test.ts` (magic bytes `%PDF-`, size > 500). | Extended: a second builder renders any catalog report from the same composed object; the route gains an optional `report` parameter. The legacy path is byte-for-byte the same code. |
| Intelligence (Phase 23) | `lib/intelligence/analysis.ts` — pure analyzers `analyzeDrawdown`, `analyzeRiskBehavior`, `analyzePsychology`, `analyzeDiscipline`, `analyzeRecurring`, `analyzeConditions`, `buildImprovementPlan`, each with honest `status: "ok" \| "insufficient_data"` and documented sample minimums. `lib/intelligence/queries.ts` — `getIntelligenceData` (one user-scoped bundle: trades + psychology/strategy/setup joins + lessons + risk rules/plan + capital + risk events), the digest builders `getWeeklyDigest` / `getMonthlyDigest` (a `PeriodDigest`: period summary + sliced analyses + focus + coach findings), and per-analysis cores. The digest's `sliceAnalyses` pattern — filter the bundle to the period, run the pure analyzers on the slice — is exactly the composition this phase needs. | Reused: the catalog slices the same bundle the same way and calls the same pure analyzers. No analyzer is copied or re-defined. |
| Coach insights (stored) | `ai_insights` rows (`lib/coach/types.ts#AiInsightRow`); read patterns: `lib/coach/queries.ts#getAiInsights` / `getAiInsightsForWeek`, and the monthly digest's range read (`period_start >= start AND period_end <= end`, newest first, limit 10). | The Coach report reuses the monthly digest's range read for both periods, so "stored insights in range" means the same thing everywhere. No LLM calls (no key configured); nothing is labelled AI-generated beyond what the stored rows are. |
| Risk reads | `lib/risk/queries.ts#getRiskRules` / `getTradingPlan` / `getRiskEvents` (active rules/plan, stored events, all `user_id`-scoped); `RiskRules` / `TradingPlan` / `RiskEvent` types in `lib/risk/types.ts`. | Reached through the intelligence bundle (which already calls `getRiskRules` / `getTradingPlan` / `getRiskEvents`); the Risk report additionally surfaces the period's raw stored events and the active rule/plan values verbatim. |

**Gap the phase fills:** before Phase 24 a "report" was one
summary shape. Psychology, risk, strategy and coach views of
a period existed only scattered across Analytics (all-time
intelligence panels) and the Coach page. There was no single
period-scoped, report-typed object the page and the PDF
could both render from — the PDF in particular could only
ever show the summary.

## Plan / reuse map

1. **`lib/reports/catalog.ts`** — the report catalog: a
   server-side composition layer of transport-agnostic cores
   taking the caller's RLS client + `userId` (the house
   pattern). For a `week | month` period anchored exactly
   like the existing reports (`periodBounds("weekly" |
   "monthly", anchor)`), each core:
   - loads the period `ReportSummary` via `getReportSummary`;
   - loads the intelligence bundle **once** via
     `getIntelligenceData`, slices trades / lessons / risk
     events to the period (the digest's slicing pattern),
     and runs the existing pure analyzers on the slice;
   - for the Coach report, additionally composes the Phase
     23 digest (`getWeeklyDigest` / `getMonthlyDigest`) and
     the stored `ai_insights` in range.
   No figure is computed in this layer beyond selecting,
   slicing and picking best/worst rows under the existing
   sample minimum (`GROUP_MIN_TRADES` = 3, imported from
   `lib/intelligence/analysis.ts`). Every report object
   carries its period bounds and `hasData`
   (`summary.tradesCount > 0`); each composed analysis keeps
   its own `status`, so a period can have data yet still be
   honestly `insufficient_data` for, e.g., drawdown (< 5
   trades).
2. **Reports UI** — `app/reports/page.tsx` gains a
   report-type selector next to the existing period control;
   sections render from `components/reports/catalog-sections.tsx`
   with the existing `--itg-*` glass classes. See UI design.
3. **PDF** — `lib/reports/pdf.ts` gains
   `buildCatalogReportPdf(report, traderName)` rendering the
   same composed object; `app/reports/pdf/route.ts` accepts
   `?report=<kind>` alongside the existing parameters.
4. **Tests** — `lib/reports/catalog.test.ts` (composition on
   the shared Phase 23 fixture, hand-computed), plus PDF
   smoke cases in `lib/certificates/pdf.test.ts` style added
   to the catalog test file.

## Per-report contents and sources

All five reports share: `kind`, `period` (`week | month`),
`periodStart` / `periodEnd`, `hasData`, and the period
`ReportSummary` (source: `getReportSummary`).

| Report | Extra sections | Source |
|---|---|---|
| **Performance** | Drawdown block for the period slice (max drawdown, % of peak, episode, current drawdown); by-strategy and by-session tables | `analyzeDrawdown` on the period slice; `summary.byStrategy` / `summary.bySession` |
| **Psychology** | Emotion + confidence groups with the gated relationship statements; discipline block (stop-loss / rating / journaled splits, stop-loss %, journal completion %) | `analyzePsychology` + `analyzeDiscipline` on the slice; `summary.byEmotion` |
| **Risk** | Risk-behaviour analysis for the slice (planned-risk distribution, per-trade limit check, daily-loss breaches, leverage, streaks, trend); active risk rules + plan values verbatim; the period's stored risk events (list + the analysis's severity totals); drawdown | `analyzeRiskBehavior` with a `RiskContext` built from the bundle's rules/plan/capital and the **period-filtered** events; `analyzeDrawdown` |
| **Strategy** | By-strategy rows; strategy × session condition rows; most/least profitable strategy among rows with ≥ 3 trades (`GROUP_MIN_TRADES`) — null, with the sample stated, when none qualify | `summary.byStrategy`; `analyzeConditions` rows filtered to `dimension === "strategy_session"` |
| **Coach** | The period digest (summary figures, recommendations, focus actions, coach findings); stored `ai_insights` whose period falls in range (title + recommendation, newest first, ≤ 10); the deterministic recommendations | `getWeeklyDigest` / `getMonthlyDigest`; the monthly digest's `ai_insights` range read; `summary.recommendations` |

Risk-report note: `analyzeRiskBehavior`'s "last 30 days"
event count is computed against the **period end** (the
`RiskContext.today` passed in), so a historical period's
report describes that period, not today. Documented here
because it is the one place the composition chooses a
reference date; no analyzer definition changes.

## UI design

- The page keeps its existing period control (Daily /
  Weekly / Monthly + date anchor) and gains a second nav:
  Performance / Psychology / Risk / Strategy / Coach
  (`?report=`), preserving `type` and `date` across switches.
- **Choice (documented per the mandate):** the Performance
  report *is* the existing summary view, extended with the
  period drawdown block underneath it — so the pre-Phase-24
  page is not removed or altered in behaviour, and
  `?report=performance` (or no `report` param) reproduces it.
  The other four reports replace the summary body with their
  own sections (their objects still contain the summary, and
  each opens with the period's headline figures).
- Catalog periods are `week | month`: a Daily period maps to
  the week containing the anchor for the non-Performance
  reports (the catalog has no daily grain — the existing
  daily summary remains available under Performance). The
  page states the catalog period bounds it is showing.
- Every section renders its analysis's honest state:
  `hasData === false` → the existing "no closed trades"
  empty state; an analysis at `insufficient_data` → a plain
  note with the measured count, never a chart or a zero.
  Charts: only existing components are used — the drawdown
  block pairs the existing `DrawdownChart` with its figures
  table, per the house chart+table rule.

## PDF design

- `buildCatalogReportPdf(report, traderName)` renders the
  composed report object and **computes nothing**: every
  number printed is read off the object the page rendered.
  Sections mirror the on-page report; insufficient sections
  print their honest note instead of figures.
- The route keeps its existing contract and adds: when
  `report` is present it must be one of the five kinds and
  `type` must be `weekly | monthly` (the catalog grains);
  the PDF is then built from `getCatalogReport`. Without
  `report`, the legacy summary PDF is produced exactly as
  before. Filename gains the kind:
  `itg-report-<kind>-<type>-<start>-to-<end>.pdf`.
- The Reports page's Download PDF link carries the selected
  report kind (Performance with a weekly/monthly period uses
  the catalog PDF too, so page and PDF always match; a Daily
  Performance view keeps the legacy link, as the catalog has
  no daily grain).

## Test inventory

Baseline before this phase: **690 Vitest / 36 Playwright**.

New: `lib/reports/catalog.test.ts` —

- Performance (month, Phase 23 fixture): 7 trades, −90 total,
  drawdown max 300 / current 290, by-strategy Alpha +410 /
  Beta −500.
- Strategy: best Alpha (+410) / worst Beta (−500) under the
  ≥3-trade minimum; strategy×session rows present.
- Psychology: 5 recorded trades, calm group 3 trades / +410,
  discipline stop-loss % from the slice.
- Risk: 1 over-limit trade, 1 daily-loss breach day, 1
  leverage breach, both stored events inside the period,
  active rules surfaced (1% / 150 / leverage 5).
- Coach (month): digest findings include the stored
  September insight; `storedInsights` returns that row.
  Coach (week): digest composed for Mon 2026-09-07 –
  Sun 2026-09-13 with engine findings.
- Period anchoring: week bounds Mon–Sun, month bounds
  calendar month, for every kind.
- Empty period (October 2026): `hasData === false` and every
  analysis `insufficient_data` / empty, for every kind.
- Cross-user scoping: trader B's report contains only B's
  +9999 trade; A's never does; `assertScoped` on the trades
  and `ai_insights` queries.
- PDF smoke: `buildCatalogReportPdf` for each kind (and for
  an empty report) returns a real PDF (`%PDF-` magic,
  > 500 bytes).

## Verification results (2026-10-30)

- Vitest: **704/704 passed (71 files)** — baseline 690 + 14
  new catalog tests, zero regressions; no pre-existing test
  weakened or modified.
- `npm run typecheck` — clean (web + @itg/calc).
- `npm run lint` — clean.
- `npm run build` — compiled successfully (env sourced from
  /tmp/itg-env.sh for NEXT_PUBLIC_* inlining); `/reports`
  and `/reports/pdf` routes present, first-load JS unchanged
  at 103 kB.
- `npm run security:check` — passed, 352 files scanned.
- Playwright (CI=true, fresh server): **36/36 passed**.
- PDF verification: `buildCatalogReportPdf` over
  fixture-composed reports returns a real PDF for **every**
  report kind and for an empty-period report — `%PDF-`
  magic bytes and > 500 bytes each, asserted in
  `catalog.test.ts` (the established Phase 8 PDF smoke
  pattern). The legacy `buildReportPdf` smoke test passes
  unmodified.
- Route wiring checked against the built server: the PDF
  route sits behind the existing page-protection middleware
  (Phase 20 note), so a signed-out request to
  `/reports/pdf?...&report=coach` returns the same
  307 → /login as the legacy PDF URL — unchanged pre-existing
  behaviour; the handler's own 400/401 validation is
  exercised in code order after authentication, exactly as
  the legacy path was.

## Deviations and notes

1. **Catalog grains are week + month only** (per the spec).
   The pre-existing daily summary is untouched and remains
   reachable as the Performance report at a daily period;
   the catalog maps a daily anchor to its containing week
   for the other four kinds, and the page says so.
2. **Digests remain computed on read** (Phase 23's decision,
   unchanged): the Coach report composes the digest live and
   reads stored insights; nothing new is persisted.
3. **Catalog PDF route validation is strict about period
   bounds:** with `report` present, `start`/`end` must equal
   the catalog period's bounds for the anchor (the page's
   links always satisfy this); a hand-built URL naming a
   different range gets a 400 rather than a silently
   re-anchored PDF, so a downloaded file always matches the
   period printed on it.
4. **Fixture honesty surfaced in tests:** in the shared
   Phase 23 fixture no strategy×session cell reaches the
   3-trade minimum, so the Strategy report's
   strategy×session table is legitimately empty there —
   asserted as such rather than padded with a new fixture
   that would exist only to make the table non-empty.

## Production addendum (2026-10-30)

Deployed `dpl_4A3EXAf2Gs8eaYsy2oipGxZAAuxk` READY (production). Independent production verification: **PASS** — all five report kinds (performance, psychology, risk, strategy, coach) render from real data for October 2026; September 2026 is honestly empty on every kind; catalog PDFs return valid `%PDF-` payloads (performance 2,169 B, coach 2,655 B) with the legacy no-kind PDF unchanged (2,541 B); non-catalog period bounds → 400; signed-out PDF → 307 to /login; regression surfaces all green; the test account ended byte-identical and Ezat's account untouched.

**One discrepancy found and reconciled by the parent.** The verification brief expected strategy BOS at 3 trades / +2.20 (the Phase 22-era SQL truth); production showed 2 / +1.70. Root cause was NOT Phase 24 code — the identical split appeared in pre-Phase-24 surfaces. Investigation: trade `afcc3db3…` (+0.50, one of the trades the Phase 23 verification had reviewed via the API) had `strategy_id` NULL with `updated_at` inside the Phase 23 verification window. The advanced-review save is a full-form save (web form semantics since Phase 1): `saveAdvancedReviewCore` writes `strategy_id` from the submitted payload, and the Phase 23 verification's review call for that trade carried `strategy_id: null`, clearing it. The sibling reviewed trade, whose call carried its strategy, kept it. This is intended full-replacement semantics — the web review form presents Strategy as an editable field and pre-fills the current value — so no code change was made. The test-account datum was restored by the parent to its documented prior value (BOS), and the split re-verified: **BOS 3 / 2.200000, no-strategy 5 / 3700.300000**.

**Phase 25 requirement recorded:** the mobile review client must round-trip the trade's current `strategy_id`/`setup_id` (read the trade, pre-fill, submit the full form exactly like the web form). A partial review payload either fails schema validation (field required, nullable) or, if it sends explicit nulls, clears those fields by design.

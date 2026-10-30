# Phase 23 — Advanced Trading Intelligence

**Date:** 2026-10-30. **Scope:** local implementation + tests +
docs. Not deployed, not committed (the parent's gate, as in
Phases 20–22).

**Mandate:** an advanced intelligence layer over REAL ITG
data only — strategy/session intelligence, psychology- and
discipline-performance relationships, risk behaviour,
drawdown analysis, recurring mistakes and setups, best/worst
trading conditions, automated weekly and monthly review
digests, and personalized improvement plans. No fake data,
no conclusions below honest sample minimums, and **no
duplicated math**: every aggregate comes from `@itg/calc`
primitives or the existing summary machinery
(`summarizeTrades`, `buildReportSummary`, `getReportSummary`,
`generateCoachInsights`). This module selects, slices and
groups stored rows — it re-implements no P&L formula.

## Audit findings (what already existed)

| Area | Existing asset | Phase 23 stance |
|---|---|---|
| Aggregates | `lib/analytics/analytics.ts` — `summarizeTrades`, `buildEquityCurve`, `breakdownBy*`, `psychologySummary` (all `@itg/calc`) | Reused as the aggregation core |
| Trade reads | `lib/analytics/queries.ts#getAnalyticsBundle` — closed trades + psychology + strategy names + lessons/screenshots presence, user-scoped, 500-trade cap | Pattern mirrored for the intelligence read (needs raw fields the bundle drops: entry/SL/size/leverage, setup, market condition) |
| Reports | `lib/reports` — `buildReportSummary` / `getReportSummary` (by strategy/session/emotion, most-repeated mistake, most-frequent losing setup, rule-based recommendations) | Reused for digest period summaries |
| Coach engine | `lib/coach/queries.ts#getCoachWeekData` + `lib/coach/insights.ts#generateCoachInsights` (weekly, snapshot-deduped persistence in `lib/coach/service.ts`) | Reused for the weekly digest's coach section; NOT modified |
| Coach chat | `lib/coach/chat.ts` (Phase 22) — 12 intents, evidence assembly, LLM narration behind the number guard | Extended by composition: 5 new intents whose builders live in `lib/intelligence/coach-answers.ts` |
| Risk | `risk_rules` (max risk %/trade, max daily loss, max trades/day, max consecutive losses, max leverage), `trading_plans` (risk_per_trade_pct, max_daily_loss), stored `risk_events`, `lib/risk/queries.ts#getRiskRules/getTradingPlan`, risk engine's day-P&L basis (closed trades grouped by close date) | Reused reads + the same day basis |
| Risk amount | `@itg/calc#calcRiskAmount` — the exact primitive `lib/trades/calculations.ts` uses to compute stored R multiples | Reused per trade from stored entry/SL/size |
| Capital | `profiles.trading_capital` (nullable, private financial field) | Read for risk-% denominators; null → risk % honestly unavailable |
| Lessons | `lessons` table: `text`, `is_repeated_mistake`, `trade_id`, `deleted_at` | Grouped by text for recurrence + money impact |
| Setups / conditions | `trades.setup_id` → `setups.name`; `trades.market_condition` enum stored per trade | Fetched for setup + condition matrices |
| Equity/drawdown | `@itg/calc#calcEquityCurve`, `calcDrawdownSeries`, `calcMaxDrawdown` + `components/analytics/charts.tsx#DrawdownChart` | Reused for the drawdown analysis and its panel chart |

Nothing in the Coach Engine's math, `lib/coach/service.ts`
semantics, or the Phase 22 intents was changed. Phase 22's
chat gained intents by extension only (union members, router
rules placed so no existing phrase changes destination, and
switch cases delegating to the intelligence builders).

## Plan

1. **`lib/intelligence/types.ts`** — `IntelTrade` (an
   `AnalyticTrade` plus setup name, market condition, trade
   reason, leverage, and `riskAmount` from `calcRiskAmount`)
   and one result type per analysis, each carrying
   `status: "ok" | "insufficient_data"` in the coach's style.
2. **`lib/intelligence/analysis.ts`** — pure analyzers over
   `IntelTrade[]` (+ lessons / rules / plan / capital /
   risk events where relevant). All money aggregates via
   `summarizeTrades` / `breakdownBy` / `@itg/calc`.
3. **`lib/intelligence/queries.ts`** — user-scoped reads
   (every query filters `user_id`, RLS client only):
   `getIntelligenceData` (one bundle), per-analysis service
   cores, `getImprovementPlan`, `getWeeklyDigest`,
   `getMonthlyDigest`, `getIntelligenceOverview` (page).
4. **`lib/intelligence/coach-answers.ts`** — the five new
   chat answer builders, returning the Phase 22 structured
   shape (FACTS / INFERENCES / RECOMMENDATIONS + evidence).
5. **Analytics page** — an "Advanced intelligence" section
   (`components/analytics/intelligence.tsx`) with panels for
   drawdown, risk behaviour, psychology, discipline,
   conditions, recurring mistakes & setups, the improvement
   plan, and the current week/month digests. Existing page
   content untouched.
6. **Tests** — hand-computed fixtures per analysis,
   min-sample insufficiency, cross-user scoping, plan
   ranking, digest assembly (empty vs populated month),
   chat routing + answers for the new intents.

## Per-analysis definitions, minimums, fields relied on

### Drawdown (`analyzeDrawdown`)
Equity curve = cumulative stored P&L over closed trades in
close-time order (`buildEquityCurve`); drawdown series from
`calcDrawdownSeries`. Reports: max drawdown (money), the
peak and trough dates of that episode, whether/when it
recovered, the longest underwater run (trades + calendar
days), current drawdown and whether the curve sits at its
peak. **% figures are relative to the peak cumulative
profit** — the curve starts at 0 because starting capital is
not stored, so a "% of account" figure would be fabricated;
the type and UI both label it "of peak". Minimum: **≥5
closed trades**, else `insufficient_data`.

### Risk behaviour (`analyzeRiskBehavior`)
Fields: stored `entry_price`, `sl`, `position_size`,
`leverage`, `pnl`, `closed_at`; `risk_rules` +
`trading_plans` limits; `profiles.trading_capital`;
stored `risk_events`.
- Per-trade planned risk = `calcRiskAmount(entry, sl, size)`
  (null without a stop-loss — counted separately, never
  estimated). Distribution: count / average / median / min /
  max.
- Risk % of capital only when `trading_capital > 0` is on
  file. Per-trade limit = `risk_rules.max_risk_per_trade_pct`,
  falling back to the plan's `risk_per_trade_pct`; trades
  above it are counted, with the within-plan share.
- Daily loss: closed trades grouped by close date (the risk
  engine's own basis); worst day and the number of days
  whose P&L fell below −(rules or plan `max_daily_loss`).
- Leverage: max used vs `max_leverage`, over-limit count.
- Consecutive losses: maximum run and current streak
  (`calcCurrentStreak`).
- Trend: average planned risk, most recent 20 trades vs the
  prior 20 (chronological); null unless both sides have
  ≥5 risk-known trades.
- Stored risk events: totals by severity + last 30 days.
Minimum: ≥1 closed trade for the distribution; each
limit check is independently null when its inputs (limit,
capital) are not configured — stated, never assumed.

### Psychology ↔ performance (`analyzePsychology`)
Groups closed trades by recorded emotion and by confidence
band (low 1–2, mid 3, high 4–5) from `psychology_records`
(via the analytics bundle composition). Each group carries
`summarizeTrades` aggregates. A plain-language **relationship
statement is produced only when both compared groups have
≥3 trades and their win rates differ by ≥20 points**; it is
phrased as association, never causation. Otherwise the
groups are returned with `statement: null`.

### Discipline ↔ performance (`analyzeDiscipline`)
Splits closed trades three ways, from stored markers only:
stop-loss set vs not (`trades.sl`), discipline rating good
vs average/poor (`psychology_records.discipline`), journaled
vs not (psychology record or lesson, the bundle's existing
definition). Same ≥3-per-side and ≥20-point win-rate-gap
rule for comparison statements; plus the headline rates
(stop-loss %, journal completion %) from
`psychologySummary`.

### Recurring mistakes & setups (`analyzeRecurring`)
Lessons grouped by exact text (trimmed); a text is
recurring at **count ≥2**. Money impact = summed stored P&L
of the distinct linked closed trades. Ranked by count,
then by negative impact. The `is_repeated_mistake` flag is
reported per group. Losing setups: closed trades grouped by
setup name; a setup qualifies at **≥2 losses**; ranked by
losses then total P&L. Trades with no setup recorded cannot
be named and are excluded (counted as unrecorded).

### Best/worst conditions (`analyzeConditions`)
Three matrices over closed trades: session × direction,
strategy × session, and market condition. A row qualifies
at **≥3 trades**. Best/worst are chosen across qualifying
rows by total P&L. Rows carry trades, total P&L, win rate,
expectancy and average R from `summarizeTrades`.

### Improvement plan (`buildImprovementPlan`)
Deterministic candidate actions, each citing its evidence
figure, in a fixed priority order: (1) per-trade risk-limit
breaches, (2) daily-loss-limit breach days, (3) an
unrecovered/current drawdown, (4) the top recurring mistake,
(5) trades without a stop-loss, (6) a negative psychology
group with ≥3 trades, (7) the worst qualifying condition
row when negative, (8) journal completion below 80%.
Capped at **5 actions**. Supportive, never-shaming wording
(project convention). With ≥5 closed trades but no
qualifying signal, the plan is one "keep the routine"
action; below 5 closed trades it is `insufficient_data`.

### Weekly / monthly digests (`getWeeklyDigest` / `getMonthlyDigest`)
A digest composes, for one Monday-week or calendar month:
the period `ReportSummary` (`getReportSummary`), the
period-sliced drawdown / psychology / discipline /
recurring analyses, a focus list (the improvement-plan
builder over the period slice, top 3), and coach findings —
for a week, the deterministic engine's insight titles +
recommendations over `getCoachWeekData`; for a month, the
stored `ai_insights` whose period falls inside the month.
**Computed on read, never persisted.** Justification: the
coach's snapshot-dedupe persistence exists to keep one
canonical weekly insight set for the Coach page; a digest
is a deterministic composition of already-persisted facts
(report rows, stored insights), recomputable identically at
any time — persisting it would duplicate the report
engine's outputs and invite stale copies. A period with no
closed trades returns `insufficient_data` with every
section empty — an honest empty digest.

## Coach intents added (Phase 22 extension)

| Intent | Trigger examples | Evidence |
|---|---|---|
| `monthly_review` | "monthly review", "review this month" | `getMonthlyDigest` for the current month |
| `drawdown_analysis` | "drawdown", "underwater" | `analyzeDrawdown` |
| `risk_behavior` | "risk behaviour", "over-risking", "risk per trade" | `analyzeRiskBehavior` |
| `trading_conditions` | "conditions", "when do I trade best" | `analyzeConditions` |
| `improvement_plan` | "improvement plan", "how can I improve" | `getImprovementPlan` |

Router placement: `monthly_review` precedes `month_compare`
(only steals phrases containing "review"); the other four
sit after `biggest_weakness` and before `weekly_focus`, with
patterns narrow enough that every Phase 22 test phrase
keeps its original intent (verified by the Phase 22 suite
passing unmodified). Answers flow through the same
narration guard and deterministic fallback as Phase 22.

## UI surface

Analytics page gains one section after the existing
secondary grid: drawdown (stats + the existing
`DrawdownChart` over the real series), risk behaviour,
psychology relationships, discipline relationships,
best/worst conditions, recurring mistakes & setups, the
improvement plan, and two digest cards (this week / this
month). All panels use the existing `--itg-*` glass classes
(`itg-analytics-secondary-card`, `section-title`,
`itg-stat-row`) and render honest insufficient states from
the analyses' `status` — nothing is drawn from invented
data.

## Test inventory (38 new tests, all passing)

- `lib/intelligence/analysis.test.ts` (20) — pure analyzers on a
  hand-computed 12-trade fixture (Sep 2–17 2026, total +210):
  drawdown max 300 / 75% of peak / longest underwater 9 trades,
  recovered-episode and all-winning cases, <5 insufficiency;
  risk distribution, 2 over-limit trades, 1 daily breach day,
  leverage breach, 40-trade trend case (+50%), no-limit and
  capital-missing notes; psychology groups + gated statements
  (withheld below 3 trades/side and below the 20-point gap);
  discipline splits incl. null rating split; recurring
  mistakes ranked by count with linked-trade impact, losing
  setups; conditions matrix (6 qualifying rows, best Trending
  +750, worst "Beta Reversion · London" −430); improvement
  plan priorities [1,2,3,4,5], clean-history single action,
  <5 insufficiency.
- `lib/intelligence/queries.test.ts` (8) — fake-Supabase DB
  fixtures: bundle assembly + scoping (`assertScoped` on
  trades/lessons/profiles/risk_events), `calcRiskAmount`
  composition (80 for sl 92, null without sl), cross-user
  isolation, drawdown/risk/plan cores over rows, weekly
  digest (5 trades, −60, coach findings present), monthly
  digest with the stored `ai_insights` row, empty-month
  insufficiency.
- `lib/intelligence/coach-answers.test.ts` (10) — routing for
  the 5 new intents + Phase 22 regression routes; end-to-end
  answers through `answerCoachQuestion` (deterministic mode):
  drawdown 300.00/290.00, "1 of 5 trades planned more than
  your 1% per-trade limit", conditions best Trending 410.00,
  5-action improvement plan, monthly review −90.00 with the
  stored insight, empty-month insufficiency, cross-user
  insufficiency without leakage, guarded-LLM narration
  accepted for a new intent.
- Shared fixture: `lib/test-helpers/intelligence-fixture.ts`.

## Verification results (2026-10-30)

- Vitest: **689/689 passed (70 files)** — baseline 651 + 38
  new, zero regressions; all Phase 22 coach tests pass
  unmodified.
- `npm run typecheck` — clean (web + @itg/calc).
- `npm run lint` — clean.
- `npm run build` — compiled successfully, 49 static pages
  (env sourced from /tmp/itg-env.sh for NEXT_PUBLIC_*
  inlining).
- `npm run security:check` — passed, 349 files scanned.
- Playwright (CI=true, fresh server): **36/36 passed**.

## Deviations and notes

1. **Digests computed on read, never persisted** (justified
   in the Plan): a digest is a deterministic composition of
   already-persisted facts; persisting it would duplicate
   report outputs and invite stale copies. The coach's
   `ai_insights` snapshot-dedupe pattern remains the single
   persisted insight store, and the monthly digest reads it.
2. **Drawdown % is "% of peak cumulative profit"**, labelled
   as such in types and UI. The equity curve is cumulative
   P&L from 0 (starting capital is not stored); a "% of
   account" figure would be fabricated.
3. **Pre-existing defect found in audit, FIXED at the
   parent gate before deploy:** `lib/reports/queries.ts`
   and `lib/coach/chat.ts#getLessonsForTrades` selected a
   `repeated_mistake` column from `lessons`, but the
   database column is `is_repeated_mistake` (migration
   0004). Verified live: PostgREST answers the wrong
   select with 400, so both reads silently returned no
   lessons — reports' `mostRepeatedMistake` was always
   null and the chat's repeated-mistake evidence was
   always empty (headline aggregates were unaffected,
   which is why every earlier verification passed; the
   test account also has 0 flagged lessons). Both selects
   and their row mappings now use `is_repeated_mistake`,
   and the Phase 22 chat test fixture — which had mirrored
   the wrong column name, masking the defect — was
   corrected to the real schema. Full suite re-verified
   green after the fix (689/689). **Second defect found by
   the production verifier and fixed in the same gate:**
   the flag had NO writer anywhere in the app — the review
   schema/core never set it, so even with the reads fixed,
   real journaling could never produce a flagged lesson.
   `saveAdvancedReviewCore` now maintains the flag as a
   derivation of text recurrence (the definition
   `lib/trades/lessons.ts` already used): when a saved
   lesson's normalized text appears on 2+ distinct trades,
   every matching lesson is flagged. One new test covers
   it (690/690); production re-verified end-to-end (a third
   trade reviewed with the same lesson text was flagged by
   the product path alone, and the coach's repeated-mistake
   count rose 2 → 3 with no manual data writes).
4. **Digest slice summaries** (`PeriodDigest.summary`) are
   computed via `getReportSummary` over the digest period,
   while the slice drawdown/psychology/discipline/risk/
   recurring sections are computed from the intelligence
   bundle sliced by close date — same trades, same calc
   primitives, no second P&L implementation.
5. **Monthly coach findings** come from stored `ai_insights`
   whose whole period falls inside the month (the coach
   engine is weekly by design); the weekly digest runs the
   engine itself via `getCoachWeekData` +
   `generateCoachInsights`, exactly like Phase 20/22.
6. No changes to `lib/coach/insights.ts`, `lib/coach/
   queries.ts`, or `lib/coach/service.ts`; `lib/coach/
   chat.ts` was extended only (intent union, 5 router rules,
   5 delegating switch cases, one import). No mobile files
   touched. Nothing deployed or committed in this phase —
   local implementation + tests + docs only, per the task.

## Production addendum (2026-10-30)

Deployed `dpl_GM9wc7P4gY24BT6vq8V68zkQNywq` READY (Phase 23 + the lessons-column fix), then the flag-writer fix redeployed as `dpl_CRX85adY6QvDoTyKG1qBKLbBaEpn` READY (current production). Independent production verification: **PASS on every check.**

- **Analytics intelligence:** every rendered figure traced to SQL/hand-calc — max drawdown 0.20 (peak 2202.70 → trough 2202.50, recovered same day, currently at peak); average planned risk 300.36 (median 0.80, largest 1000.00) with the honest "no trading capital on file" note; discipline splits exact (SL-set 5/+2501.50/80% vs no-SL 3/+1201.00/100%, association statement per the documented ≥3-per-side/≥20-point rule); conditions panel honestly insufficient (largest group = 2 trades); improvement plan = the 2 data-supported actions with exact evidence lines; weekly + monthly digests match (monthly coach findings correctly absent — all stored insight periods straddle the month boundary, per the documented whole-period rule).
- **New coach intents:** drawdown_analysis, risk_behavior, trading_conditions (insufficient_data, honest), improvement_plan, monthly_review — all deterministic-labelled, all figures traceable. "What should I focus on?" continues to route to the Phase 22 weekly_focus intent by design.
- **Column fix end-to-end:** two closed trades reviewed via the mobile API with the same lesson text (all pre-existing fields/lessons preserved byte-for-byte); with the flag set on the two rows, the coach answered "Most repeated mistake: … recorded 2 times" and the mobile summary's `mostRepeatedMistake` went null → `{text, count: 2}` (headline aggregates unchanged). A control ask with the lessons present but unflagged confirmed the flag gate.
- **Flag writer (second fix):** a third trade reviewed via the API with the same lesson text was flagged by the product path alone (`is_repeated_mistake=true` on creation), and the coach's count rose to 3 — no manual data writes. Full suite 690/690.
- **Regression:** `/` 200 + six security headers, `/login` 200, `/dashboard` 307, mobile session 200 `created:false`, Phase 20 coach-insights 200, Phase 22 best_strategy answer still BOS 3 / 2.20 = SQL.
- Test account end state (all changes from the verification itself, explained): 10 trades, XP 390 (unchanged), 11 notifications (unchanged), 5 lessons (3 flagged — the verification lesson text), ai_insights 43 (refresh snapshots from the three review saves). Ezat's account verified untouched (0 trades) at start and end.

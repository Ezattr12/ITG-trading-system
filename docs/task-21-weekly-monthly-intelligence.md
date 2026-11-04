# Task 21 — Professional Weekly/Monthly Intelligence + the 500-trade figure-integrity fix

Status: **BUILT + FULLY GATED LOCALLY.** No migration, no
deployment, no production writes (parent deploys + verifies —
script in §8). Test account A re-verified untouched after all
work: **10 trades / 390 XP** (22 XP rows).

The core of this task is Part A: the shared 500-row cap that
silently bound nearly every computation read in the product
(Task 14 §6.3's loud flag) is gone from every computation
path. Part B wires the Task 18 pattern engine into the
weekly/monthly digests, the one real gap the audit found.

---

## 1. Part A audit — every consumer of the capped fetches

The cap was `TRADE_LIST_FETCH_LIMIT = 500`
(`lib/trades/queries.ts`), imported by nine modules, plus two
further 500-limits that did not use the constant. Each read is
classified **computation** (its output is presented as a
complete figure — must be complete) or **display** (a list a
human scrolls — a page size is legitimate).

| # | Read (file:line, pre-fix) | Consumer(s) | Class | Action |
|---|---|---|---|---|
| 1 | `lib/trades/queries.ts:79` `getTradeListItems` | journal list page, trade detail related trades | DISPLAY | **Kept capped.** The constant now documents display-only semantics. |
| 2 | `lib/analytics/queries.ts:107` `getAnalyticsBundle` trades | analytics, dashboard, calendar, progress, psychology, plan pages; gamification bundle (level scoring); coach chat | computation | fetchAllRows (§2) |
| 3 | `lib/intelligence/queries.ts:88` `getIntelligenceData` trades | all intelligence analyses, patterns, digests, catalog reports, coach Phase-23 intents | computation | fetchAllRows |
| 4 | `lib/intelligence/queries.ts:118` lessons (same fetch) | recurring/pattern analyses | computation | fetchAllRows |
| 5 | `lib/intelligence/queries.ts:126` risk events via `getRiskEvents(…, 500)` | risk-behaviour analysis | computation | fetchAllRows over `risk_events` directly; the display helper is untouched |
| 6 | `lib/reports/queries.ts:41` `getReportSummary` trades (period-bounded) | report summaries + PDFs, coach week data, weekly-review-adjacent reads, mobile summary API | computation | fetchAllRows |
| 7 | `lib/reviews/service.ts:75` `saveWeeklyReviewCore` week trades | the STORED weekly-review aggregates (a snapshot presented as the week's figures) | computation | fetchAllRows |
| 8 | `lib/coach/queries.ts:56` streak fetch in `getCoachWeekData` | coach current streak | computation | fetchAllRows |
| 9 | `lib/risk/queries.ts:75` `getRiskDayContext` | save-time risk evaluation (`createTradeCore`), pre-trade gate, risk page | computation | fetchAllRows |
| 10 | `lib/risk/queries.ts:117` `getRecentClosedTrades` | disciplined-streak check in `createTradeCore`, gate, gamification | computation | fetchAllRows |
| 11 | `lib/discipline/queries.ts:155` `getLastJournalDate` | dashboard discipline state, background pass escalation, goals page | computation | fetchAllRows |
| 12 | `lib/discipline/queries.ts:187` `getGoalMeasurementContext` | goal progress measurement | computation | fetchAllRows |
| 13 | `lib/certificates/queries.ts:84` `getMonthlyCertificateInputs` (month-bounded) | certificate eligibility | computation | fetchAllRows |
| 14 | `lib/plan/service.ts:357` `runPlanEnforcementForUser` trades | Task 19 background plan pass | computation | fetchAllRows |
| 15 | `lib/plan/queries.ts:52` `getPlanEventSummary` `.limit(500)` (no constant) | Plan page 30-day breach summary, presented as a count | computation | fetchAllRows (gained a deterministic `created_at desc` order for paging) |
| 16 | `lib/intelligence/background.ts:107,261` `RISK_EVENT_FETCH_LIMIT = 500` on an **ascending** read (no constant import) | Task 17 pass: notify un-notified risk events | computation | fetchAllRows; constant deleted. This one was worse than a truncation: once the oldest 500 events were notified, event 501+ could NEVER notify. |

Deliberately **not** changed (bounded by design, not silent
figure caps):

- `getRiskEvents(userId, limit)` default 20, notifications
  lists (20/50), `getAiInsights` (50), latest-insights (3),
  monthly-digest stored insights (10), plan events list (10) —
  display reads with caller-visible page sizes.
- `getXpTransactions` default 100 — the XP history list
  (display). The XP **total** does not come from it (Task 14:
  the bundle inherits the analytics all-rows total; that total
  now runs over the fetch-all analytics read).
- Analytics `daily_activity` `.limit(90)` — a labelled
  90-row recent-activity window, not a figure input.
- Background pass `.limit(COACH_MIN_TRADES)` — a threshold
  probe ("do ≥3 closed trades exist this week?"), where a
  bounded read is the correct semantics.
- Auxiliary `.in("trade_id", …)` joins in analytics /
  intelligence / reports / certificates / discipline: not
  capped (they return every matching row), unchanged. They
  grow with journal size exactly as they did at 500; see §3.

One adjacent observation, recorded not fixed: several reads
carry **no** limit at all (e.g. `xp_transactions` in the
analytics bundle, the background pass's notified-ids read).
Against PostgREST those rely on the platform's per-request
row ceiling at very large scale (order 1,000+ rows). They are
outside this task's named defect (the 500 cap) and no current
account is near them; if a future task paginates reads
wholesale, they belong on its list.

---

## 2. The fix — `fetchAllRows`

New shared helper in `lib/trades/queries.ts:65`:

```ts
export const FETCH_ALL_PAGE_SIZE = 500;
export async function fetchAllRows<T>(
  buildPage: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
  pageSize: number = FETCH_ALL_PAGE_SIZE,
): Promise<T[]>
```

- Each consumer's query keeps its exact filters, column list
  and ordering; `.limit(500)` is replaced by `.range(from,
  to)` and the helper concatenates pages until the first
  short page. For any result set ≤500 the behaviour is
  byte-identical to before: one page query, same rows, same
  order (pinned by tests, §5).
- **Why pagination, not "remove the limit":** PostgREST
  enforces a per-request row ceiling; a single unbounded
  request would silently stop at that ceiling instead —
  swapping one silent cap for another. Page size 500 stays
  under the ceiling, so every page returns its full slice.
- **Cost (performance honesty):** rows are fetched in
  500-row round-trips — a 620-trade journal costs 2 queries
  for its trades read, a 10k journal 20, each small and
  index-backed by the existing user_id/status/closed_at
  ordering paths. Small accounts (every current account)
  cost exactly one query, as before. Nothing is cached
  across requests; no figure semantics changed anywhere —
  same rows, same in-memory computation, complete input.
- **Ordering caveat (documented in the helper):** offset
  pagination over a non-unique sort key (closed_at etc.) can
  in theory repeat/skip a row whose sort value ties exactly
  at a page boundary and is ordered differently between page
  queries. Keyset pagination is not expressible in this
  codebase's query pattern (the fake harness and several
  queries avoid or-filters by design — see the note in
  `lib/trades/queries.ts`). Every consumer aggregates or
  scans the full set with the same tie tolerance the
  single-fetch code already had.
- The fake-Supabase test harness gained `range`, `gt` and
  `lt` ops (`lib/test-helpers/fake-supabase.ts`) so paginated
  queries are testable with the established pattern.

`TRADE_LIST_FETCH_LIMIT` remains, re-documented as the
**display** cap for the journal list only. A grep for the
constant in non-test code now returns exactly one query:
`getTradeListItems`.

---

## 3. Part B audit — weekly/monthly intelligence

What already existed (verified in code):

- **Stored weekly reviews** (`lib/reviews/`): save-time
  snapshot aggregates + the trader's 4 text fields. The
  Coach never reads them (Task 8 finding, still true).
- **Weekly/monthly digests** (`lib/intelligence/queries.ts`
  `buildDigest`/`sliceAnalyses`): the period's report
  summary plus within-period drawdown, psychology,
  discipline, recurring-mistake analyses and an improvement
  focus, rendered as the "This week / This month — review
  digest" cards on /analytics and embedded in Coach
  reports. Intelligence slices `IntelTrade[]` by period
  exactly as the Task 18 hand-off described.
- **Monthly catalog reports** (Task 6) and the **Task 17
  monthly_report notice** — complete as built.
- **The pattern engine** (`analyzePatterns`, Task 18) ran
  ONLY over all-time trades (`getPatternAnalysis` →
  PatternsCard). **The digests had no period patterns** —
  the one real gap.

### Built: period patterns in the digests

- `PeriodDigest` gains `patterns: PatternAnalysis`
  (`lib/intelligence/types.ts:297`).
- `sliceAnalyses` now runs `analyzePatterns(slice,
  sliceLessons)` over the period slice — the same engine,
  the same materiality standard (≥5 closed trades in the
  period, group ≥3, ≥20pt win-rate gap vs the period's own
  baseline or ≥50% of the period's gross P&L movement). No
  fork, no second standard (`lib/intelligence/queries.ts`,
  `sliceAnalyses`).
- `DigestCard` (`components/analytics/intelligence.tsx:108`)
  renders "Patterns this week/month" with the existing
  evidence line and Edge/Drag/Repeats chips (no violet —
  deterministic, not AI), framed as measured against the
  period's own overall results. Honest states: a period
  with <5 closed trades states the count and the threshold;
  a period with no standout group says so; a period with
  no trades keeps the pre-existing empty digest state.
- Coach answers and report figures are unchanged by this
  part: coach intents read digest fields they already read
  (the new field is additive), and catalog report figures
  change only through the Part A completeness fix.

### Deliberately NOT built: a new consumer for stored weekly-review text

Evaluated honestly, per the brief:

- The trader's own written words already have a genuine
  consumer: the Weekly Reviews page renders `main_mistake`,
  `focus_next_week` and `review_text` verbatim from the
  stored rows (`app/reviews/weekly/page.tsx:99-110`). The
  trader re-reading their own focus/mistake is served.
- Feeding the text into any "analysis" would be fake
  intelligence (there is no text-analysis engine, and
  keyword-matching a trader's prose into findings would
  fabricate exactly what this product refuses to fake).
- Duplicating the text onto the Analytics digest would be
  a second surface for the same words with no new
  information. Not built.
- The standing observation from Task 8 stands unchanged:
  nothing computes over the stored text, by design.

No new forms, no new trader-entered data, no predictions.
ONE INPUT → MANY OUTPUTS holds: the period patterns are
derived from trades the trader already journalled.

---

## 4. Files changed

Computation fetch-all (Part A): `lib/trades/queries.ts`
(helper + docs), `lib/analytics/queries.ts`,
`lib/intelligence/queries.ts`, `lib/reports/queries.ts`,
`lib/reviews/service.ts`, `lib/coach/queries.ts`,
`lib/risk/queries.ts`, `lib/discipline/queries.ts`,
`lib/certificates/queries.ts`, `lib/plan/service.ts`,
`lib/plan/queries.ts`, `lib/intelligence/background.ts`.
Part B: `lib/intelligence/types.ts`,
`lib/intelligence/queries.ts` (slice), 
`components/analytics/intelligence.tsx` (DigestCard).
Tests: `lib/test-helpers/fake-supabase.ts` (range/gt/lt),
`lib/trades/fetch-all.test.ts` (new),
`lib/reports/completeness.test.ts` (new),
`lib/analytics/isolation.test.ts` (spec-driven update, §5).
Stale "Known limit … 500" header comments were replaced in
every touched module — a grep for the old claim now returns
nothing.

No migration. No schema change. No RLS, auth, XP, P&L or
audit changes: every changed function returns the same
shape, computed over a complete input instead of a capped
one.

---

## 5. Tests

New (10):

- `lib/trades/fetch-all.test.ts` (5): 1,200 rows across 3
  pages in order; exact multiple of page size ends on an
  empty page; small set = 1 query; empty = []; custom page
  size honoured.
- `lib/reports/completeness.test.ts` (5):
  - 620 closed trades in one period → `getReportSummary`
    reports **620 trades, totalPnl 1550 (310×+10 + 310×−5),
    win rate 50** — under the old cap it reported the newest
    500 only; the fetch paged and used no `limit` op.
  - `getIntelligenceData` over the same fixture returns all
    620 (the catalog path that previously lost old periods
    retroactively).
  - Small-account identity: A's October shape (7W/1L,
    pnls summing 3702.50) → **8 trades, 3702.50, 87.5%**,
    with exactly ONE trades page query — byte-identical
    behaviour for ≤500 accounts.
  - Weekly digest patterns: a 6-trade week (4 XAUUSD wins,
    2 EURUSD losses) amid out-of-week trades → digest counts
    6 / +300, `patterns.status = ok`, XAUUSD pair pattern
    present as an Edge with 4 trades; a 3-trade week →
    `insufficient_data` with the true count.

Spec-driven update (1 existing test): 
`lib/analytics/isolation.test.ts` "caps analytics at the
500 most recent closed trades" asserted the defect itself
(600 seeded → 500 returned + a `limit` op). It now asserts
the fixed behaviour (600 returned, `range` ops 0–499 and
500–999, no `limit` op). No other existing assertion was
modified; the trades-list isolation test still pins the
display cap, unchanged.

Gate-service re-run (Task 20 §7 hand-off): the full suite
includes the gate service tests over the changed risk reads
— all pass (§6). The gate's verdicts for ≤500 accounts are
unchanged; for >500 accounts its risk rows now see the
complete history, as intended.

---

## 6. Gate results (env sourced, this run)

- **Vitest: 943/943** (baseline 933 + 10 new; 85 files).
- **Typecheck: clean. Lint: 0 errors** (1 pre-existing
  dashboard `<img>` warning). **Production build: clean**,
  First Load JS 103 kB (baseline held).
- **security:check: passed** (426 files; +2 = the new test
  files).
- **Playwright e2e: 36/36** (`CI=true`, repo root).
- **Visual QA (local production build, A's session,
  `~/workspace/.itg-helpers/qa-t21-digest.mjs`): 12/12** —
  both digest cards render at 390px and 1280px with zero
  horizontal overflow; A's current week/month show the
  honest "No closed trades in this period yet" state (A has
  no Nov 2026 trades, so the patterns block correctly does
  not render); the all-time XAUUSD pattern (3,702.20) still
  renders through the fetch-all read — the ≤500 regression
  check in the browser. Screenshots in /tmp
  (qa-t21-digest-390.png / -1280.png). The patterns-present
  digest rendering is covered by the unit tests in §5 and
  by step 5 of the parent's production script (§8), which
  seeds a throwaway — the builder does not write to
  production.
- **A baseline (read-only SQL, after all work): 10 trades,
  22 XP rows / 390 XP.** Untouched.

---

## 7. Known limitations

- Offset-pagination tie caveat (§2): theoretical, at page
  boundaries over identical sort timestamps; aggregates
  are unaffected in any realistic journal.
- Auxiliary `.in()` joins grow with journal size (§1);
  chunking them is a performance refinement for a future
  scale task, not a correctness issue at any current size.
- No-limit reads relying on PostgREST's per-request ceiling
  (§1 observation) remain as found — outside the named
  defect, flagged for a future wholesale-pagination pass.
- Stored weekly-review aggregates written BEFORE this fix
  remain as stored (they are save-time snapshots by
  design); accounts were never >500 in a week, so no stored
  snapshot is actually wrong.
- Digest patterns show at most 4 patterns (same slice as
  coach findings) — a display choice; the full set remains
  on the all-time card's terms.

---

## 8. Production verification script (for the parent)

1. Baseline (SQL, read-only): A = 10 trades / 390 XP;
   `plan_events` = 4. Deploy per the staging recipe; poll
   READY; alias-resolve `itg-traderos.vercel.app` to the
   new deployment id.
2. Smokes: `prod-smoke-t18.py` and `prod-smoke-t10.py` →
   ALL PASS. A's /analytics SSR shows the XAUUSD pattern
   (3,702.20) and October figures 3702.50 / 87.5% —
   byte-identical to pre-deploy (A is a ≤500 account).
3. Background endpoint: POST `/api/intelligence/run` with
   the cron secret → 200; a second run → all-zero new
   counts (A's plan events and risk notifications already
   exist; nothing about this task creates rows for A).
4. >500 proof (throwaway): create via Auth Admin API,
   seed `profiles` + `onboarding_profiles` (is_complete),
   insert 620 closed trades in the CURRENT month via SQL
   with stored pnl (+10 / −5 alternating, as in the unit
   fixture), sign in via the cookie pattern and check the
   Reports page / monthly summary shows **620 trades** and
   the fixture's total — pre-fix it would show 500. Delete
   the throwaway (cascade) and re-verify auth.users count
   and A's baseline.
5. Digest-pattern visual (same throwaway, before delete —
   or a second one): seed 6 closed trades in the CURRENT
   week (4 XAUUSD wins +100, 2 EURUSD losses −50), open
   /analytics, confirm the weekly digest shows "Patterns
   this week" with the XAUUSD Edge and the period framing
   line, zero overflow at 390px.
6. Commit + report in the mandated format; Task 22 next.

---

## 9. Task 22 hand-off

- Level scoring now computes over a complete history at
  any journal size: `getGamificationBundle` inherits the
  analytics bundle, whose trades read is fetch-all as of
  this task. No competency figure can silently truncate.
- The Task 5 evaluation (`docs/task-05-competency-
  evaluation.md`) remains the design input: levels run on
  the 8-dimension weighted competency score with
  null-exclusion; the 4→10 expansion boundary is the closed
  `LevelName` union in `@itg/calc`, and the anchor-
  preserving band proposal is documented there. F4
  (achievement % criteria) is still Ezat's open decision.
- `PeriodDigest.patterns` is available if Task 22 wants
  period-scoped competency evidence — it is the same
  engine output, not a new metric.

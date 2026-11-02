# Task 14 — Financial Integrity Audit

Date: 2026-11-02. Surface: web + shared calc + live database (read-only).
Scope: one scheduled fix (XP total page-limit defect, found in Task 5),
a calculation-integrity sweep, live-data reconciliation against the
verification account baseline, audit-trail completeness, XP award
integrity, and evidence-pinning for the five Task 6 reporting-honesty
items (for Task 21 — audited here, not fixed).

**Headline: every financial figure reconciles exactly.** All stored
P&L values recompute to the cent from their stored inputs, the
reversal model holds across every trade in the database, the audit
trail is complete for every surviving lifecycle event, and XP awards
are provably table-driven and idempotent. One real defect was fixed
(the XP total). One Task 6 item is worse than its original framing
and is flagged loudly in §6.3. One baseline variance in the task
brief itself (XP row count) is documented in §3.1.

---

## 1. The scheduled fix — XP total page-limit defect

**Defect (Task 5 finding, confirmed in code).**
`getGamificationBundle` (`apps/web/lib/gamification/queries.ts`)
spread the analytics bundle — whose `xpTotal` is computed over
**every** `xp_transactions` row (`apps/web/lib/analytics/queries.ts`:
the XP read has no limit; the total is the final cumulative sum) —
and then **overrode** it with `totalXp(xpTransactions)`, where
`xpTransactions` is `getXpTransactions`' default **100-row page**
(newest first). Past 100 transactions, /levels, /achievements and
/profile (the gamification bundle's consumers) would report the sum
of only the newest 100 rows, disagreeing with the dashboard /
analytics / progress surfaces (the analytics bundle). No live user
is affected today (largest history: 22 rows), but the first trader
to cross 100 XP events would have seen two different "Total XP"
figures on different pages.

**Fix.** The override is deleted. The bundle now inherits the
analytics bundle's all-rows total by construction, so the two
surfaces can never disagree again, and no extra query is added (the
analytics read inside the same bundle already fetches every XP
row). `xpTransactions` remains in the bundle as what it always was
visually — the newest-100 display page — and the interface now
documents that it is **not** the source of the total. The unused
`totalXp` import was removed from `queries.ts`; `totalXp` itself
remains a tested pure helper in `lib/gamification/xp.ts`.

Changed files:

- `apps/web/lib/gamification/queries.ts` — override removed,
  semantics documented on the interface.
- `apps/web/lib/gamification/queries.test.ts` — **new** regression
  tests (fake-Supabase pattern, same as the analytics isolation
  tests).

**Regression proof.** Three tests:

1. 150 transactions (oldest = a −50 penalty, then 149 × +10;
   all-time total **1440**; newest-100 page sums to 1000):
   bundle `xpTotal` = **1440**, equal to the analytics bundle's
   total for the same seed; the display page still returns exactly
   100 rows, all scoped to the requesting user (a second user's
   30 × 999 rows never leak in).
2. A 22-row mixed history summing to 390 (the live account's
   shape): both bundles report **390** — current-user behaviour
   unchanged.
3. No history: total 0, empty page.

Test 1 was verified to **fail against the pre-fix logic** (the
paged sum, 1000 ≠ 1440) and pass with the fix; tests 2–3 pass
under both, pinning that nothing changed for ≤100-row histories.

**Live confirmation.** After the fix, a local production build
served /levels for test account A showing **390 XP** (see §7), and
the live SQL total is 390 by both summation paths (§3.1).

---

## 2. Calculation-integrity sweep

Method: grep across `apps/web`, `apps/mobile`, `packages`
(excluding node_modules/build output) for `parseFloat`, arithmetic
on `pnl` / `entry_price` / `exit_price` / price identifiers,
`Decimal` usage, and `reduce` aggregations; plus an
`information_schema` inspection of every money-bearing column.

| Class | Hits | Verdict |
|---|---|---|
| `parseFloat` on money | **0** in all source trees | Clean |
| Per-trade metric derivation (pnl, roi_pct, r_multiple, risk_reward, is_win, duration) outside `@itg/calc` | **0** — the sole derivation path is `computeTradeMetrics` (`apps/web/lib/trades/calculations.ts`), a pure adapter over `calcPnl` / `calcRoi` / `calcRMultiple` / `calcRiskReward` / `calcRiskAmount` / `isWin` / `calcDurationSeconds` from `@itg/calc`, which does all money math in decimal.js | Clean |
| Client-side preview in the Edit Trade form | Uses the **same** `computeTradeMetrics` the server uses (`components/trades/edit-trade-form.tsx:263`); the server recomputes authoritatively on save | Fine — shared function, not a reimplementation |
| Derived statistics (win rate, avg win/loss, profit factor, expectancy, max drawdown, equity curve, R distribution, streaks) | All from `@itg/calc` helpers (`apps/web/lib/analytics/analytics.ts` imports 11 of them; reports/intelligence likewise) | Fine |
| Summation of **stored** pnl values (`reduce` totals) | `analytics.ts:51,136`, `analytics/calendar.ts:51`, `reports/reports.ts:56,145`, `intelligence/analysis.ts:525`, `coach/chat.ts:819`, `risk/engine.ts:126` (daily-loss sum), `gamification/xp.ts` (`totalXp`, `aggregateXpHistory`) | Aggregation of already-computed stored values — not price arithmetic; the same pattern the XP total uses |
| Sorting by stored pnl | `analytics.ts:143`, `coach/chat.ts:804`, `dashboard/page.tsx:141` | Comparators over stored values — fine |
| Display formatting | `formatMoney`, `formatNumber`, `toFixed` in messages/PDF (`reports/pdf.ts:16,20`, `coach/insights.ts:47`, `risk/engine.ts:207-208,362`) | Presentation only |
| Mobile arithmetic on money | **0** — mobile formats server values (`src/format.ts`), parses input text (`src/forms.tsx` `parseNumberText`, documented conversion-only), and compares raw inputs for edit change-detection (`trade/[id]/edit.tsx:279-296`, equality checks, no computation). The vendored `apps/mobile/vendor/itg-calc` is the canonical package, not a port | Clean |
| Decimal.js usage | `packages/calc/src/index.ts`, `apps/web/lib/trades/service.ts` | Centralised as designed |

**Database column types (live `information_schema`).** Zero
`double precision` / `real` columns anywhere in the public schema.
All trades money/ratio columns are `numeric(19,6)`
(entry/exit/tp/sl/fees/pnl/roi_pct/r_multiple/risk_reward/
leverage); `position_size` is `numeric(19,8)` (finer lot-size
scale, by design); `profiles.trading_capital` is `numeric(19,2)`;
goals/targets, risk limits, weekly/monthly review totals are
`numeric(19,6)`; `xp_transactions.amount` is `integer` (XP is
whole points by design).

---

## 3. Live-data reconciliation (SQL, read-only)

### 3.1 Test account A — baseline vs live

A = `c4838c9d-babd-4d8c-9008-e0b1991aaa00` (verification account).

| Check | Expected (brief) | Live | Result |
|---|---|---|---|
| Trade rows | 10 | 10 | ✓ |
| Status mix | 8 closed / 1 reversed / 1 cancelled | 8 / 1 / 1 | ✓ |
| October closed trades | 8 | 8 | ✓ |
| Total P&L (closed) | 3702.500000 | 3702.500000 | ✓ exact |
| Wins / losses | 7 / 1 | 7 / 1 | ✓ |
| Win rate | 87.5% | 87.5% | ✓ |
| Max drawdown (equity curve over closed, by close time) | 0.20 | 0.200000 | ✓ |
| Strategy split — BOS (`4e140f17…`) | 3 trades / +2.200000 | 3 / 2.200000 | ✓ |
| Strategy split — none | 5 trades / +3700.300000 | 5 / 3700.300000 | ✓ |
| Journal completion (psych record or lesson, of closed) | 3/8 | 3/8 | ✓ |
| XP total (sum of `xp_transactions.amount`) | 390 | **390** | ✓ exact |
| XP row count | 23 | **22** | ⚠ variance — see below |

**XP row-count variance (brief vs live).** The brief's baseline
says 23 rows; the live table holds **22** rows for A, summing to
exactly 390. Full live breakdown — trade_journal 9 × 10 = 90;
backtest_session 5 × 15 = 75; weekly_review 2 × 30 = 60;
risk_discipline 2 × 25 = 50; achievement 4 rows = 10 + 25 + 30 +
50 = 115 (the achievements catalogue's own `xp_reward` values).
Total 22 rows / 390. The financial invariant (the total) matches
to the point; only the brief's row count differs, by one.
`xp_transactions` is append-only for clients (no INSERT/UPDATE/
DELETE policy — writes are service-role engine paths), and no
row's value is missing: every earning event in A's history is
accounted for in §5's event-by-event reconciliation. Most likely
the brief's 23 was counted at an earlier snapshot; flagged here
for the parent to reconcile against their records. **No data was
changed.**

### 3.2 Reversal integrity — all users, all trades

Live totals: 16 trades (A: 10; second account: 6; two further
accounts: 0). 6 reversed: 3 with a correction link, 3 voids
(NULL link).

| Invariant | Violations |
|---|---|
| Link on a non-reversed trade | 0 |
| Self-reference (`reversal_trade_id = id`) | 0 |
| Dangling link (target missing) | 0 |
| Cross-user link | 0 |
| Reversed trade with neither link nor `trade.deleted` audit | 0 (see §4) |

**Chain shapes actually present** (the model's compositions, all
legitimate):

1. **Single correction** — A: original (reversed) → correcting
   trade (closed, active). Chain length 1, terminates in the
   active trade.
2. **Double correction, then voided at the head** — second
   account: original (reversed) → correction 1 (reversed) →
   correction 2 (reversed, NULL link). Each correction marked
   its predecessor reversed-with-link; the final correcting
   trade was then deleted, voiding it (NULL link). The whole
   chain is annulled; no active trade remains — the correct end
   state for "correct twice, then remove".
3. **Standalone voids** — second account: 2 closed trades
   deleted (reversed, NULL link, `trade.deleted` audit each).

No chain exceeds what repeated correction of the active trade
produces; every chain terminates; exactly the chain-head rules
hold (a reversed original points at its successor; only a void
has a NULL link).

*Provenance note:* the second account's rows were created
2026-11-01/02 through the live app and follow the model exactly;
agent production tests have only ever run on throwaway accounts
(deleted afterwards, §4) and read-only checks on A. This audit
changed no data on any account.

### 3.3 Stored P&L recomputation — all closed trades

Recomputed in SQL with exact numeric arithmetic using the
`@itg/calc` rule — long: `(exit − entry) × size − fees`; short:
`(entry − exit) × size − fees` — from each trade's stored inputs,
compared against stored `pnl`, plus `is_win = (pnl > 0)`:

- **Closed trades: 9/9 exact** (absolute difference 0.000000 on
  every row), **is_win consistent 9/9**.
- Supplementary: the same recomputation over all 6 reversed rows
  (which carry the pnl of their once-closed state): **0
  mismatches**.

---

## 4. Audit-trail completeness (SQL)

Counts of `audit_logs` by action — surviving accounts:

| Action | A | Second account |
|---|---|---|
| trade.created | 10 | 4 |
| trade.corrected | 1 | 2 |
| trade.edited | 0 | 2 |
| trade.deleted | 0 | 3 |
| trade.review_saved | 5 | 2 |
| trade.cancelled | 1 | 0 |

A's `trade.created` count (10) equals its trade-row count
exactly; its single correction and single cancellation each have
their row. The second account's counts match its own history
(4 created + 2 created-as-corrections = 6 rows; corrections are
audited as `trade.corrected`/`trade.edited`, not `trade.created`).

**Per-event presence, checked row by row:** every one of the 3
reversed-with-link trades has a `trade.corrected` (or
`trade.edited`) audit row keyed by its id; every one of the 3
voided trades has a `trade.deleted` audit row keyed by its id.
**6/6 — no gaps.**

**Deleted-owner trail:** 52 `trade.*` audit rows carry
`user_id = NULL` (created 21, corrected 5, deleted 6, edited 3,
cancelled 4, review_saved 5, screenshot_uploaded 8; dated
2026-10-30 → 2026-11-01). These are the production-verification
trails of throwaway test accounts whose `auth.users` rows were
deleted afterwards (the FK nulls the user reference; the
append-only log itself is preserved by design). **Zero** of them
reference a surviving trade. This is the intended posture, not a
gap: audit history outlives the test accounts that produced it.

---

## 5. XP award integrity

### 5.1 Code

- All five earning events call `awardXp({ reason, … })` with
  **no amount**: trades/service.ts (trade_journal,
  risk_discipline), discipline/service.ts (daily_goal),
  reviews/service.ts (weekly_review), coach/service.ts
  (backtest_session). `awardXp` resolves the amount centrally
  via `calcXpFor(reason)` → `XP_TABLE` in `@itg/calc`
  (gamification/service.ts:57). Live amounts confirm the table:
  10 / 20 / 15 / 30 / 25 exactly (`XP_TABLE` verified in source:
  trade_journal 10, daily_goal 20, backtest_session 15,
  weekly_review 30, risk_discipline 25).
- The only `awardXp` call passing an amount is the achievement
  path, passing `achievement.xp_reward` — the catalogue's own
  configured reward (data, not a code literal; `XP_TABLE.
  achievement` is 0 by design for this reason).
- The only other amount-bearing path is `logXpPenalty`, the
  spec §24 explicit-penalty path (validated: negative, whole,
  written reason required). No penalty rows exist for A.
- Corrections and deletes contain no XP calls at all
  (`correctTradeCore` / `deleteTradeCore` never invoke
  `awardXp`) — and §5.2 proves it in data.

### 5.2 Data

- **Idempotency, global:** grouping all `xp_transactions` by
  (user_id, reason, source_ref_id) yields **zero duplicate
  groups** — no event was ever awarded twice to the same user.
  (The only repeated source_ref_ids are achievement definition
  ids shared across two different users — legitimate.)
- **Weekly review (A):** 2 stored `weekly_reviews` ↔ 2
  weekly_review XP rows, and both XP rows' `source_ref_id`
  match a real review id. 1:1, idempotent per review.
- **Risk discipline (A):** 3 stored `risk_events` = 2 ×
  `positive_streak` + 1 × `daily_trade_limit` (warning). The 2
  streak events ↔ exactly 2 risk_discipline XP awards of 25.
  The warning event correctly carries no award.
- **Corrections award nothing (global):** **0** XP rows
  reference any correcting trade (any trade that is the target
  of a reversal link). For A specifically: 9 of 10 trades hold a
  trade_journal award — the single trade without one is
  `28a9f6eb…`, the correcting trade, exactly as designed; the
  original keeps the award it earned at creation.
- **Removals don't claw back:** A's cancelled trade retains the
  journal award it earned when it was journaled at creation —
  the lifecycle rule is that XP/achievements are untouched by
  cancel/delete, and the data matches the rule.

---

## 6. Task 6 reporting-honesty items — evidence for Task 21

All five items from the Task 6 audit were re-verified against
current code. **All five are still accurate.** Nothing was fixed
here (Task 21's scope), except that item 3 needs re-framing —
see the flag.

### 6.1 Drawdown copy references an equity curve the Reports page doesn't render — CONFIRMED

`apps/web/components/reports/catalog-sections.tsx:84-88`
(`PerformanceSections`): when the drawdown analysis has too few
trades, the copy reads *"The equity curve for the period is still
shown in the figures above as trades close."* The only figure
above that section is a "By session" breakdown table; the
Reports page renders no equity-curve chart anywhere (the
drawdown *series* chart renders below, only in the sufficient-
data branch, and it is a drawdown chart, not an equity curve).

### 6.2 Historical Risk reports show current rules/plan — CONFIRMED

`apps/web/lib/reports/catalog.ts:104` documents it in the type
itself: *"Active risk rules / plan values, verbatim"*.
`getRiskReport` returns `rules: load.data.rules, plan:
load.data.plan` (catalog.ts:280-281), loaded by
`lib/intelligence/queries.ts:117-118` via `getRiskRules` /
`getTradingPlan` — the **current** active rows, with no period
parameter. Only `periodRiskEvents` is period-scoped
(catalog.ts:107-108). A report for a past period therefore
presents today's rules and plan beside that period's events.

### 6.3 The 500-trade ceiling — CONFIRMED, AND WORSE THAN FRAMED ⚠

The cap is the shared constant `TRADE_LIST_FETCH_LIMIT = 500`
(`apps/web/lib/trades/queries.ts:24`). It binds **both** report
pipelines, in two different ways, and **neither surfaces the
truncation in its output**:

- **Legacy summary** (`lib/reports/queries.ts:34-41`): trades
  are filtered to the period, ordered newest-first, limited to
  500. For a period containing >500 closed trades, every figure
  in the summary — total P&L, win rate, drawdown, breakdowns —
  is computed over only the newest 500 and presented as the
  period's totals. The figures are not "the period, truncated
  with a note"; they are **silently understated totals**.
- **Catalog reports** (`lib/intelligence/queries.ts:86`, via
  `loadPeriod`): worse — the fetch takes the **500 most recent
  closed trades of all time** (no period filter in the query)
  and the period slice is cut from that set in memory. For a
  trader past 500 lifetime closed trades, older periods
  silently lose trades, and a historical report's figures
  **change retroactively** as newer trades push older ones out
  of the window. (The same fetch also caps lessons at 500 —
  line 116 — and risk events at 500 — line 124.)

Why this is a correctness issue and not just a display limit:
the affected numbers are presented as complete period totals.
**No current user is affected** (the largest account has 8
closed trades), so there is no live-data impact today — but
Task 21 should treat this as a figure-integrity fix (aggregate
in the database or page through all rows, and/or surface the
cap in the output), not a copy tweak. The same constant also
caps analytics (`lib/analytics/queries.ts:107`), coach reads
(`lib/coach/queries.ts:56`), certificates
(`lib/certificates/queries.ts:84`), risk
(`lib/risk/queries.ts:75,117`), discipline
(`lib/discipline/queries.ts:155,187`) and the weekly-review
aggregator (`lib/reviews/service.ts:75`) — Task 21 scoping
should decide which of those inherit the fix.

### 6.4 "Goals completed" counts period-created goals — CONFIRMED

`apps/web/lib/reports/queries.ts:26-32` selects goals by
`created_at` inside the period; line 101 then computes
`goalsCompleted` as those with `status = 'completed'`. So the
figure is "goals **created** in the period that are completed
(now)" — a goal created in the period but completed after it
counts, and a goal completed in the period but created before
it does not.

### 6.5 Daily Performance PDF is the legacy summary — CONFIRMED

`apps/web/app/reports/pdf/route.ts`: the catalog PDF branch
requires a weekly or monthly grain (`validGrain`, line 62) and
an explicit `report` parameter; everything else — including
every **daily** request — falls through to the legacy path:
`getReportSummary` + `buildReportPdf` (lines 89-94). The route's
own comment (lines 52-57) states this openly. The Reports page's
Performance view is the catalog composition
(`getPerformanceReport`), so the daily PDF and the on-page
Performance report are different documents.

---

## 7. Gate

| Check | Result |
|---|---|
| Vitest (root) | **806/806** (77 files) — baseline 803 + 3 new regression tests |
| Typecheck (web + calc) | Clean |
| Lint | 0 errors (1 pre-existing `<img>` warning on the dashboard page, untouched) |
| Production build | OK |
| security:check | Passed (405 files — 404 baseline + the new test file) |
| Local render check (production build on :3100, A's session) | /dashboard 200 with A's data · /levels 200 showing **390 XP** · /achievements 200 · /coach 200 · /admin as non-admin A → 404. (The helper script's stale "Sign in" marker for /login misses because the page copy is "Log in"; /login itself returns 200 signed-out with the correct form — a helper-marker issue, not an app defect.) |
| Playwright e2e (CI=true, repo root) | **36/36 passed** (2.0m, exit 0). First attempts on 2026-11-02 were blocked by the sandbox storage fault (EPERM bursts: npm could not start and Chromium launches failed — environment failures, all at browser launch, not app failures); the suite passed cleanly via the standard `CI=true npm run test:e2e` invocation once the fault cleared. |
| Live data after the audit | A unchanged: 10 trades, XP 390 (audit was read-only; the only writes in this task are code + tests + this doc) |

Baseline protection: test account A's figures were re-verified
after all checks (§3.1). Ezat's own account was never used for
testing; its rows were read only as part of the all-users
integrity checks and were not modified.

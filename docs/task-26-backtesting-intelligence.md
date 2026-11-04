# Task 26 — Advanced Research / Backtesting Intelligence

Status: BUILDER COMPLETE, fully gated locally. No git, no
deployment, no production writes (read-only SQL only for
the account-A reality check), no migrations, no memory
edits.

Mandate shape (Master Remaining Work v2, Task 26):
"Advanced Research / Backtesting Intelligence" — audit
the existing backtest record first, then build research
intelligence ONLY over data the system actually holds,
under the evidence-gating doctrine of Task 25 §10: there
is no historical price series in this product, so no
strategy replay is possible and none may be simulated.

## 1. The evidence-gating rationale

A backtest/research claim may only be computed over data
the system actually holds. What the system holds about
backtesting turns out to be very little — by design of
the original feature (Phase 9, spec §24): a trader logs
HOW MANY backtesting sessions they completed on a day.
Nothing else about the session is recorded. The audit
(§2) establishes this from the schema, the validation
contract and the write core, not from assumption.

Consequences, stated plainly:

- There is **no backtest result anywhere in the
  database** — no strategy, pair, period, trades-tested
  count, win rate or P&L attached to any session. A
  backtest-vs-live performance comparison (expectancy
  or win-rate deltas per strategy/pair) therefore has
  nothing honest to join: the live side exists, the
  backtest side is a daily integer. Computing the
  comparison anyway would require fabricating the
  backtest side, which the doctrine forbids.
- Extending the schema so traders type in their
  backtest results afterwards was considered and NOT
  built: it would add a results form (against the
  one-input principle — the task brief permits a new
  form only when recording is impossible; recording
  sessions works), and hand-typed retrospective results
  would still not be system-verified evidence — the
  honest label for them would be "self-reported",
  which is a product decision for Ezat, not a builder
  inference. See Known limitations.
- What the stored record DOES support, computed
  exactly: the research activity itself (totals, span,
  recency, active weeks) and how it lines up in time
  with live execution — for each closed live trade,
  whether any session was recorded in the 7 days up to
  and including its close day. That is a description of
  the recorded routine. It is never presented as
  evidence that backtesting caused any result, and the
  surface says so in words.

## 2. Audit — the actual backtest data model (file evidence)

### 2.1 Storage: one integer per day

`supabase/migrations/0006_goals_discipline.sql` creates
`daily_activity`:

- `user_id`, `activity_date` (unique together),
  `journal_completed boolean`, `study_hours numeric`,
  `backtesting_sessions integer ≥ 0`,
  `trading_sessions_count integer`, reminder level,
  timestamps. RLS: the standard own-row policies of
  that migration (unchanged by this task; no new
  table, so the 34-table RLS matrix is untouched).

There is NO `backtest_sessions` table, and no other
table stores anything about a backtest. The only other
traces of a session are derived ledgers:

- `xp_transactions` rows with `reason =
  'backtest_session'` (enum in
  `0001_extensions_and_enums.sql`), amount from
  `XP_TABLE.backtest_session = 15` (packages/calc),
  `source_ref_id =
  deterministicUuid('backtest:<date>:<n>')`, note
  "Backtesting session n of N on <date>".
- One `backtesting.logged` audit row per logging call
  (details: activityDate, sessions, xpAwarded).

### 2.2 The write path (recording works; it is a count)

- Web: `BacktestingForm` on the Coach page
  (`components/coach/backtesting-form.tsx`, "Date" +
  "Backtesting sessions today (total)") →
  `logBacktestingSessionAction` (`lib/coach/actions.ts`).
- Mobile: `POST /api/mobile/backtesting`
  (`app/api/mobile/backtesting/route.ts`) → the same
  core via `lib/api/handlers/coach.ts`.
- Core: `logBacktestingCore` (`lib/coach/service.ts`,
  Phase 21 M2 extraction of the Phase 9 action):
  validates with `backtestingSchema`
  (`lib/coach/validation.ts` — `activityDate` +
  `sessions` 1–10 per submission, the day's TOTAL, not
  an increment), upserts `daily_activity` on
  (user_id, activity_date), then awards +15 XP per
  session index through `awardXp` — idempotent per
  (date, index), so re-submitting the same total
  awards nothing new and raising it awards only the
  new sessions. Covered by `lib/coach/backtesting.test.ts`.

The trader can record NOTHING else about a session:
the schema's full expressive power for backtesting is
`{date, count}`. This is the schema limitation that
narrows the design (§1).

### 2.3 Readers before this task

- `getBacktestingSessionCount`
  (`lib/gamification/queries.ts`) — all-time sum of
  `backtesting_sessions`, feeding the gamification
  bundle's stats → the "Backtesting Streak" achievement
  (seeded in `0017_production_config_seed.sql`,
  criteria `{"backtesting_sessions": 5}`, +25 XP) and
  goal measurement (`measureGoal` handles the
  `backtesting_sessions` goal type over the same sums,
  `lib/discipline/queries.ts` + engine).
- MCP server mirrors the goal measurement over the
  same daily_activity sums
  (`apps/mcp-server/src/intelligence.ts`).
- The analytics calendar reads `daily_activity` for
  its journal-completion flag
  (`lib/analytics/queries.ts`) — not the backtesting
  count.
- Profile onboarding stores two self-descriptive
  fields (`profiles.backtesting_experience boolean`,
  `backtested_trades integer`, migration 0002) —
  onboarding answers, not session records; no
  intelligence reads them.

### 2.4 The gap

No surface presented the recorded activity AS research:
no totals/timeline in an intelligence context, no
computed relationship between the research record and
live trading, and — most importantly for honesty — no
surface stated what the record cannot support, leaving
"Backtesting" in the product implying a results
comparison that the data cannot back. The Coach has no
backtest/research intent (grep over
`lib/intelligence/coach-answers.ts` and
`lib/coach/chat.ts`: zero hits) — see §5.

## 3. What was built

One pure analysis in the existing intelligence family,
one paged read, one card. No migration, no new table,
no new form, no schema change, nothing stored.

### 3.1 `analyzeBacktestingResearch` (`lib/intelligence/analysis.ts`)

Pure function over `(trades: IntelTrade[],
activity: BacktestActivityDay[], today: string)` —
same module, same honesty conventions as the Task 25
analysis. New types in `lib/intelligence/types.ts`:
`BacktestActivityDay`, `ResearchWeek`,
`BacktestingResearchAnalysis` (each field documented
in the type). Computes:

- `totalSessions`, `activeDays`, `firstSessionDate`,
  `lastSessionDate` — over days with sessions > 0
  (zero rows are not activity).
- `recentSessions` — sessions whose day falls in the
  28-day window ending today (age 0–27 days; future-
  dated rows count in the totals only).
- `activeWeeks` — distinct Monday-start weeks
  containing ≥1 session (the product's week convention,
  matching `mondayOfWeek` semantics).
- Preparation coverage: a closed trade is `prepared`
  when a session day falls in the 7-day window ending
  on its close date (close day + 6 days before).
  Sessions after the close never count. Reported as
  `preparedTrades` / `liveTradesCount` /
  `preparationPct` (null when no closed trades).
- `weeks` — every Monday-start week with any session
  or any closed trade: `{weekStart, sessions,
  liveTrades}`, oldest first.
- `status`: "ok" when ≥1 session is recorded, else
  "insufficient_data".

No performance figure of any kind is produced for the
backtest side — there is none to produce.

### 3.2 Reads (`lib/intelligence/queries.ts`)

- `fetchBacktestActivity(supabase, userId)` — every
  `daily_activity` row for the caller via
  `fetchAllRows` (the Task 21 pagination pattern:
  computation reads cover the complete record),
  selecting only `activity_date, backtesting_sessions`,
  filtered by `user_id` (RLS + explicit filter, the
  module's defence-in-depth pattern).
- `getBacktestingResearchAnalysis(supabase, userId,
  today?)` — the standalone getter, mirroring
  `getMarketConditionsAnalysis`.
- `getIntelligenceOverview` now also returns
  `backtestingResearch` (the activity fetch joins the
  existing parallel digest fetches — one extra read on
  the Analytics render path only; `getIntelligenceData`
  itself is unchanged, so the Coach, background pass
  and digest paths pay nothing).

### 3.3 The surface — "Backtesting research" card (`components/analytics/intelligence.tsx`)

Placed in the Advanced intelligence grid immediately
after "Market conditions", full-width like Patterns
and Market conditions (`min-[801px]:col-span-2`),
existing `.itg2-*` classes only — the eyebrow / section
title / stat-row / table / chip system. **Zero new
CSS. No violet** (research is not an AI surface).

Every state is honest:

- **Header copy states the evidence rule in words**:
  ITG logs backtesting as a daily session count — that
  you backtested, not what you tested or what it
  showed; no strategy, pair or result is stored, so
  backtest performance cannot be compared with live
  performance here, and no result is ever invented.
- **No sessions recorded**: a teaching state — where
  sessions are logged (the Coach page's Log backtesting
  form, date + count, +15 XP each) and what this panel
  will show once they exist. No new form.
- **Sessions recorded**: stat rows (sessions over days
  with the recorded span; last-28-days count; weeks
  with recorded research), then "Preparation and live
  trading": the prepared count as "N of M (x%)" with
  the window definition AND the non-causation caveat
  in words ("This describes your recorded routine
  only — it is not evidence that backtesting caused
  any result"). With sessions but no closed trades,
  that block says there is nothing to line the record
  up against yet.
- **Week by week** table (Week starting / Sessions /
  Live trades closed) — the most recent 8 active
  weeks, with a footnote when older active weeks are
  not shown.

## 4. Account A — the honest state (read-only SQL)

A's recorded backtesting activity (`daily_activity`,
verified 2026-11-04): **7 days, 9 sessions** —
2026-10-07: 1, 10-08: 1, 10-24: 1, 10-25: 2, 10-27: 1,
10-28: 1, 10-29: 2. A's 8 closed trades all closed
2026-10-28 (×2), 10-29 (×1), 10-30 (×5).

The card therefore renders for A (locally verified,
§7): 9 sessions over 7 days, 2026-10-07 to 2026-10-29;
8 sessions in the last 28 days (the Oct 7 session is
28 days before Nov 4 — outside the window); 3 weeks
with recorded research (Mon Oct 5, Oct 19, Oct 26);
preparation **8 of 8 (100%)** — every close has a
session day inside its 7-day window (Oct 24/25 precede
the Oct 28 closes; Oct 27/28/29 cover the rest); week
rows 2026-10-05 (2 sessions, 0 trades), 2026-10-19
(3, 0), 2026-10-26 (4, 8).

One discrepancy in A's stored record, reported here
because the audit surfaced it — NOT repaired by this
task: the XP ledger holds only **5** `backtest_session`
awards (75 XP) for A, with notes covering Oct 7, 8, 24
and 25. The sessions logged for Oct 27, 28 and 29
(4 sessions) have no XP rows. That is consistent with
the known pre-fix window in which XP inserts could
fail silently (the source-ref UUID defect found
2026-10-29 — see the comment in `logBacktestingCore`;
the `daily_activity` upsert lands first and "a failed
XP insert never loses the logged day"). Consequences
for this task: (a) `daily_activity` is the source of
truth for recorded activity, and the analysis reads
it — the card's "9 sessions" is the recorded fact;
(b) repairing the missing 60 XP would move A's
protected baseline (390 XP) and rewrite earning
history — out of scope and not attempted. Whether to
backfill historical XP awards is Ezat's decision,
bundled here for the parent's report.

A's baseline re-verified after all work (read-only
SQL): 10 trades / 390 XP / 23 notifications /
1 assessment / 0 certificates — unmoved. Auth users
still 4.

## 5. Coach — the decision

No Coach change. No existing intent covers backtesting
or research: the intent taxonomy verified in Task 15
(17 intents) contains none, and `coach-answers.ts`
holds no backtesting answer path. Wiring one would be
a taxonomy change to a verified set — the same
reasoning as Task 25 §4 (a dedicated pairwise intent
remains a possible future Ezat decision). The
deterministic engine could answer from
`getBacktestingResearchAnalysis` verbatim if such an
intent is ever approved; the narration seam is
untouched either way. MCP: no change — it already
exposes the daily_activity sums through goal
measurement; no MCP tool computes its own version of
any statistic (the skill's rule), and none was added.

## 6. Tests

Vitest baseline 1000 → **1008 (+8)**, no existing
assertion modified:

- `lib/intelligence/analysis.test.ts` (+5,
  `analyzeBacktestingResearch`): insufficient state
  with zero sessions (weeks still report the live
  side; empty journal → null pct); activity-only
  summary (zero-session rows ignored, span/recency —
  the 28-day boundary at exactly 28 days excluded,
  26 days included — active-week merging); the
  preparation window boundaries (same day counts,
  6 days after counts, 7 days after does not, a
  session after the close never counts); Monday-week
  alignment for sessions and trades (Sunday rows join
  the preceding Monday's week); future-dated rows in
  totals but out of recency.
- `lib/intelligence/queries.test.ts` (+3,
  `getBacktestingResearchAnalysis` + overview): the
  fixture's 7 trades (closing Sep 8–16) against one
  recorded session day (Mon Sep 7) prepare exactly
  the 5 trades closing Sep 8–12; a second user's
  9 sessions on the same day never leak (scoping
  asserted on every `daily_activity` query via
  `assertScoped`); the no-sessions fixture state is
  insufficient; the analysis flows into
  `getIntelligenceOverview` (the object the Analytics
  page actually renders).

## 7. Gate results (local, this build)

- Vitest: **1008/1008** (91 files).
- Typecheck: clean (web + @itg/calc).
- Lint: 0 errors; 1 warning — the pre-existing
  dashboard `<img>` LCP warning, unchanged from the
  Task 24/25 baselines.
- Production build: clean; First Load JS **103 kB**
  (unchanged).
- security:check: **passed (441 files)**.
- Playwright e2e (CI=true, repo root, env sourced):
  **36/36**.
- Visual QA (`~/workspace/.itg-helpers/qa-t26-research.mjs`,
  local production build on :3100, A's session via
  cookie injection): **24/24 checks** at 390px and
  1280px — gating copy, totals (9 over 7 days,
  Oct 7 → Oct 29), last-28-days 8, 3 research weeks,
  preparation 8 of 8 (100%) with the non-causation
  caveat, the three week rows, no fabricated backtest
  result figures, no violet in the card (computed-style
  probe), zero horizontal overflow. Screenshots
  eyeballed at both widths.
- **Rendered vs test-pinned, stated plainly**: the
  populated state is what A renders, and it was
  rendered and screenshotted. The no-sessions teaching
  state and the sessions-but-no-live-trades state
  cannot render from A's data; both are pinned by the
  analysis and service tests driving the card's exact
  state fields (`status`, `liveTradesCount`).

## 8. Production verification script (for the parent)

No migration. Deploy → alias resolves to the new
deployment → smokes (prod-smoke-t10.py,
prod-smoke-levels.py) ALL PASS → A's /analytics SSR
(or a cookie-session render) shows the "Backtesting
research" section with: the gating copy ("daily
session count", "no result is ever invented"), "9
over 7 days — 2026-10-07 to 2026-10-29", last-28-days
count (8 while today is 2026-11-04; it decays as the
October days age out of the window — recompute against
the run date: sessions on days with age 0–27), 3 weeks
with recorded research, preparation "8 of 8 (100%)",
week rows 2026-10-05 (2/0), 2026-10-19 (3/0),
2026-10-26 (4/8) — and the rest of Advanced
intelligence unchanged (Your patterns still exactly
the XAUUSD edge + the repeated mistake; Market
conditions still 1-of-8 coverage with the Trending
small-sample row). A background intelligence run
writes nothing new for A; A's baseline byte-identical
afterwards (10 / 390 / 23 / 1 / 0). Note the surface is
web-only: mobile consumes the same intelligence reads
on its own schedule (unchanged, as in Task 25).

## 9. Task 27 hand-off — Future Market Data Integrations (read-only)

- Task 27 is where a real market-data feed may arrive
  — read-only, last, never a dependency for basic
  journaling, and possibly gated on an Ezat-supplied
  API key (isolate that blocker per the standing
  directive). If a feed lands, the two evidence gaps
  documented in Tasks 25–26 become addressable IN
  ORDER of honesty: (1) a live/recorded market regime
  would no longer need to mean "the trader's own
  label" (Task 25 §1 states what would change);
  (2) strategy replay against historical prices
  becomes computable for the first time — but note
  that even then, the backtest record built here
  stores no strategy parameters or session results,
  so a replay feature would be a NEW recording
  surface (a product decision), not a completion of
  this one.
- The research analysis is deliberately feed-shaped
  at its boundary: it consumes stored rows through
  one pure function (`analyzeBacktestingResearch`)
  and one paged read (`fetchBacktestActivity`). A
  future data source should enter through the same
  pattern — a read in `queries.ts`, a pure analysis,
  an honest surface — never by letting a surface or
  the Coach fetch provider data directly.
- Standing residuals not to conflate with Task 27:
  A's 4 backtest sessions without XP awards (§4 —
  Ezat's backfill decision); the Coach's pairwise
  trending-vs-ranging intent and any backtesting
  intent (coach-taxonomy decisions); the Vercel cron
  registration question stays with Task 28.

## Known limitations / deliberately not built

- **No backtest-vs-live performance comparison** —
  impossible over the stored record (§1, §2.2): no
  session stores a strategy, pair, period or result.
  Any expectancy/win-rate delta would be fabricated.
  This is the task's central narrowing, made on audit
  evidence, not preference.
- **No schema extension and no results form** — the
  brief permits a new form only when recording is
  impossible; session recording works on web and
  mobile through one shared core. Capturing per-session
  results (strategy/pair/outcome) is a plausible
  future product decision for Ezat; if approved, it
  should be one optional step on the existing log
  flow, its figures labelled self-reported, and only
  then does a comparison surface become honest.
- **No repair of A's missing XP awards** (§4) —
  documented for Ezat's decision; the protected
  baseline is untouched.
- **No Coach or MCP change** (§5); no digest change
  (digests summarise period trades/patterns — the
  research activity is not a trade statistic, and no
  digest slot was extended by invention); no mobile
  change; no changes to the progress page, goals or
  achievements (they already consume the same sums).
- **Preparation is a window convention, stated on the
  surface**: 7 days ending on the close day. A
  different window would give different counts; the
  convention is documented in the type, the analysis
  and the card copy, and pinned at its boundaries by
  tests, so the figure is reproducible rather than
  tuned.

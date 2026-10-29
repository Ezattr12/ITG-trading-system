# Stage 4 — AI intelligence tools (2026-10-29)

Extends the Stage 3 MCP POC (`apps/mcp-server`) with the
ten justified read-only tools from the approved catalog in
`docs/ai-intelligence-mcp-design.md` §4. The server now
exposes **12 tools**. No deployment (the server is a stdio
process by design), no `apps/web` changes, no new tables,
no migrations.

## Security model — unchanged from Stage 3, applied to every new tool

- Tenant identity comes **only** from the validated Supabase
  access token (`auth.getUser` per call). No tool schema
  accepts a user/tenant id; any unknown argument — above all
  a smuggled `user_id` — is rejected as `invalid_argument`
  **before any query runs**.
- All reads run on the anon+JWT RLS client with explicit
  `.eq("user_id", userId)` filters as defense-in-depth.
- The service-role key is read only in `src/config.ts` and
  used only for `audit_logs` inserts — the same single
  sanctioned use as Stage 3.
- Every call writes exactly one audit row, action
  `mcp.<tool_name>`, with the per-tool entity type (trades,
  risk_rules, goals, discipline_events, user_levels,
  weekly_reviews). `details.arguments` carry only structured
  values (limit, from, to, week_start); the free-text `pair`
  filter is deliberately **not** recorded.
- The Stage 3 rate limit (60 calls/minute per trader) and
  10 s per-call timeout apply to all tools unchanged.
- Results are bounded: list limit ≤ 50, closed-trade fetch
  capped at 500 rows (with a `fetch_capped` flag), groups
  capped at 20, free text capped at 2,000 chars with a
  `truncated` flag.

Code layout: shared helpers (numeric coercion, text cap,
timeout, date helpers, active plan/rules fetchers) moved to
`src/common.ts`; the ten tools live in `src/intelligence.ts`
(definitions + argument parsers + handlers + registry);
`src/tools.ts` keeps the Stage 3 tools and the single
dispatch path both families flow through.

## What was built, per tool

### 1. `get_recent_trades` — `{ limit?, pair? }`

Newest-first (`opened_at` desc) trade summaries: id, pair,
direction, status, opened/closed timestamps, pnl,
r_multiple, strategy name (resolved via `strategies`).
`limit` is an integer 1–50, default 10; one extra row is
fetched to compute `truncated` honestly. `pair` is a
case-insensitive substring filter (max 30 chars). No notes
or other free text. Pagination metadata
`{ returned, limit, truncated }`.

### 2. `get_performance_summary` — `{ from, to }`

ISO dates, `from ≤ to`, range ≤ 366 days (violations are
`invalid_argument` naming the field). Returns the closed-
trade summary for the range (see "Aggregation semantics"
below) plus best/worst trade (id, pair, pnl) and a
`fetch_capped` flag.

### 3. `get_strategy_performance` — `{ from, to }`

The same summary grouped per strategy. Strategy names are
resolved from `strategies`; trades without a strategy group
under `strategy_id: null`, `"No strategy"` (the web app's
label). Groups sorted by net P&L descending, capped at 20
(`groups_total` / `groups_truncated` report the true count).

### 4. `get_session_performance` — `{ from, to }`

The same summary grouped by session. **Deviation from the
original task text, recorded:** the task named
`psychology_records.session`, but that column does not
exist — session is stored on the trade itself
(`trades.session`), which is also the source the web app's
`breakdownBySession` uses. Trades without a session group
as `"Not Provided"`, mirroring the web breakdown. Same
sorting and cap as strategy groups.

### 5. `get_psychology_summary` — `{ from, to }`

From `psychology_records` joined to their closed trades in
range: per-emotion aggregates (trades, net P&L, win rate),
confidence-band aggregates (bands 1–2, 3, 4–5 — all three
always present, zeroed when empty), per-discipline
aggregates, average confidence, and explicit presence
counts: `closed_trades`, `with_psychology_records`,
`without_psychology_records`.

### 6. `get_risk_status` — `{ }`

Stored state only — the risk engine is **not** re-run. The
active `risk_rules` row (max risk %, max daily loss, max
trades/day, max consecutive losses, max leverage), the
active trading plan summary (name, risk_per_trade_pct,
max_daily_loss, max_daily_trades), today's (UTC)
`risk_events` total and count by severity, and the count of
open events (`resolved_at is null`, exact count query).
Missing rules/plan return `null`, never invented limits.

### 7. `get_goal_progress` — `{ }`

All non-deleted goals (title, type, target, unit, period,
status, dates) with resolved progress, mirroring the web
discipline engine (`lib/discipline/engine.ts`):

- **Measured** types — `max_trades` (trades opened in the
  window), `journal_completion` (closed trades in the window
  with a psychology record or a lesson), `study_hours`,
  `backtesting_sessions`, `trading_sessions` (sums over
  `daily_activity`) — computed over the engine's period
  window: daily = today; weekly = Monday → today; monthly =
  1st → today; yearly = Jan 1 → today; clamped to the goal's
  start/end dates. `journal_completion` with zero closed
  trades in the window is not measurable and falls through.
- Otherwise the **latest manual** `goal_progress` value
  (`progress_source: "manual"`).
- Otherwise `progress: null`, `progress_source: "none"`,
  `progress_note: "Measured in the app"` — never an invented
  number.

Percent uses `@itg/calc`'s `calcGoalProgress`, like the app.

### 8. `get_discipline_status` — `{ }`

Stored state only: the latest 5 `discipline_events` (kind,
level, message, event date) newest first, plus the count of
unread notifications (exact count query).

### 9. `get_level_status` — `{ }`

The **stored** `user_levels` row: level name (resolved via
`levels`), score, the stored `score_breakdown` (per-dimension
scores), calculated/updated timestamps. The scoring engine
is **not** re-implemented or re-run; with no stored row the
tool returns `level: null` and the honest note "No stored
level yet — the app calculates it on the next visit to the
levels page." Plus XP from `xp_transactions`: total,
by-reason totals (sorted by total desc), and the last 10 XP
events (reason, amount, note capped, date). The XP fetch is
capped at 1,000 rows with a `truncated` flag.

### 10. `get_weekly_review` — `{ week_start }`

Any valid ISO date is accepted and normalized to its week's
Monday, mirroring the app (`mondayOfWeek` / `weekBounds` in
`lib/reviews`). Returns the stored `weekly_reviews` row —
review text capped at 2,000 chars with a truncation flag,
main_mistake, focus_next_week, and the stored aggregates
**reported exactly as saved** (they are a snapshot from save
time) — alongside `week_summary`, the week's closed-trade
summary recomputed live via the same `@itg/calc` path, so a
caller can see both and any divergence is visible rather
than hidden. No stored review → the uniform `not_found`.

## Aggregation semantics (mirroring notes)

All summary math (tools 2–5 and the weekly summary) runs
through one `summarize()` in `src/intelligence.ts` built
**only** on `@itg/calc` primitives — `calcWinRate`,
`calcLossRate`, `calcAvgWin`, `calcAvgLoss`,
`calcProfitFactor`, `calcExpectancy`, `calcAvgRMultiple`,
`calcMaxDrawdown(calcEquityCurve(...))`, `calcCurrentStreak`
— with Decimal accumulation for sums. No formula that exists
in `@itg/calc` is re-implemented.

Row selection mirrors `getAnalyticsBundle` /
`summarizeTrades` in `apps/web/lib/analytics`:

- `status = 'closed'` and `pnl` not null (reversed trades
  are not closed trades and never enter an aggregate);
- the range filters on `closed_at` within the UTC days
  `[from, to]` inclusive;
- order is chronological by close time for equity-curve /
  drawdown / streak math (fetched newest-first, reversed);
- empty set → trade_count 0, net_pnl 0, win/loss rates,
  averages, profit factor, expectancy and avg R all `null`,
  max_drawdown 0, best/worst `null` — the same honesty rules
  as the app (a single trade is both best and worst, as in
  `summarizeTrades`).

One schema fact worth recording: the `trades` table has
**no `deleted_at` column** (verified against the live
schema) — soft deletion of a trade is expressed by
`status = 'reversed'`. The MCP trades queries therefore do
not filter on `deleted_at` (PostgREST would reject the
query). Tables that do have the column (goals, risk_rules,
trading_plans, strategies, lessons) keep the filter, as in
the app.

## Deferred: `compute_coach_insights` — NOT built

The deterministic coach engine exists only as web-app code
(`apps/web/lib/coach/insights.ts`). Copying it into the MCP
server would create a second source of truth for coach
logic — exactly what the design (§4: "the MCP layer is a
transport, never a second implementation of a calculation")
forbids. It remains a design entry in
`docs/ai-intelligence-mcp-design.md` §4 until it can call
the app's engine directly (shared-package extraction or an
internal app endpoint).

## Tests

Vitest with the fake-Supabase harness (the web app's test
helper), in `apps/mcp-server/src/intelligence.test.ts`
(25 new tests) plus the updated `tools/list` expectation in
`src/server.test.ts`:

- Per-tool happy paths against seeded fixtures with
  **hand-computed** expected aggregates (the arithmetic is
  written out in the test comments: e.g. October fixture
  pnls [100, −50, 30, −20] → net 60, win rate 50, avg win
  65, avg loss −35, profit factor 130/70, expectancy 15,
  avg R 1.6/3, equity [100, 50, 80, 60] → max drawdown 50).
- Validation: from > to, range > 366 days, malformed and
  impossible dates (field named), missing fields, limit
  0 / 51 / 2.5 / string, extra arguments on no-arg tools,
  smuggled `user_id`.
- Empty-state honesty: zero-trade ranges return the exact
  zeros/nulls above; missing rules/plan/level return nulls
  with the honest note.
- Cross-tenant isolation for `get_recent_trades`,
  `get_performance_summary` and `get_level_status` (user B
  sees only their own data; the fake applies the recorded
  `user_id` filters, so a missing filter fails the test).
- Audit spot checks: one row per call with the right
  action / entity type / outcome, including the
  weekly-review `not_found` carrying entity type
  `weekly_reviews`, and audit arguments containing only
  structured values.
- `tools/list` returns exactly the 12 tools;
  `compute_coach_insights` is asserted absent.

Full verification (2026-10-29): **406/406 Vitest**
(43 files; 381 before Stage 4, +25 new), typecheck
(web + calc + mcp-server) pass, lint pass, production build
pass (30 routes), `security:check` pass (248 files scanned).

## Live smoke cross-check (2026-10-29)

Compiled server over stdio against production Supabase, test
verification account only. Ground truth taken by SQL before
the run; every returned aggregate matched exactly.
(Full record: `apps/mcp-server/SMOKE_TEST.md`, Stage 4
section.)

| Tool | Expected (SQL) | Returned |
|---|---|---|
| tools/list | 12 tools | 12 tools, in definition order |
| get_recent_trades | 1 trade XAUUSD +1.20, R 1.5, "BOS" | identical; pair filter "xau" also matched |
| get_performance_summary (Oct) | count 1, net 1.2, win 100%, PF null, expectancy 1.2, avg R 1.5, DD 0, streak 1 | identical |
| get_performance_summary (Jan, empty) | zeros/nulls | identical |
| get_strategy_performance | 1 group "BOS" net 1.2 | identical |
| get_session_performance | 1 group "london" net 1.2 | identical |
| get_psychology_summary | calm {1, 1.2, 100%}, band 4-5, good, avg confidence 4, with 1 / without 0 | identical |
| get_risk_status | rules 1/200/5/3/20, plan "Audit Trading Plan", today 0 events, open 0 | identical |
| get_goal_progress | manual 4/10 (40%); 2× journal_completion measured 1/5 (20%); other goal null + "Measured in the app" | identical (4 goals) |
| get_discipline_status | 0 events, 6 unread | identical |
| get_level_status | Platinum 84.5 + 8-dimension breakdown; XP 200 (achievement 115×4, backtest 45×3, weekly_review 30, trade_journal 10); 9 recent events | identical |
| get_weekly_review (2026-10-29) | week normalized to 2026-10-26; stored aggregates as saved (count 0, P&L null); live week summary count 1, net 1.2 | identical |
| get_weekly_review (2026-10-19) | not_found | not_found |
| invalid_argument spot checks | from>to names `from`; limit 99 names `limit`; bad week_start names `week_start`; smuggled `user_id` rejected | all as expected |

Audit rows for the run were verified in SQL afterwards:
exactly one row per call, correct action / entity type /
outcome per tool.

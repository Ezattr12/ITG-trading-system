# @itg/mcp-server — ITG AI Intelligence MCP server (Stages 3–4, Phase 20)

A standalone, **read-only** MCP server that exposes thirteen
tools over ITG TraderOS data — the Stage 3 POC tools
(`get_trade`, `analyze_trade`), the ten Stage 4
intelligence tools listed below, and Phase 20's
`compute_coach_insights` — per the approved design
in `docs/ai-intelligence-mcp-design.md` (§3–§4) and
`docs/stage-4-ai-tools.md`. It has no write, execution,
broker, transfer or withdrawal surface of any kind.

## Security model (design §2, non-negotiable)

- **Tenant identity comes only from the authenticated
  context.** The MCP host supplies the trader's Supabase
  access token via the environment
  (`ITG_SUPABASE_ACCESS_TOKEN`). The server validates it
  with Supabase Auth (`auth.getUser`) on every `tools/call`
  and derives the user id from the validated token. Tool
  arguments contain only `trade_id` — any extra argument
  (e.g. a smuggled `user_id`) is rejected as
  `invalid_argument` before any query runs.
- **RLS is the enforcement layer.** Reads run on a Supabase
  client created with the anon key + the trader's JWT, and
  every query additionally filters `.eq("user_id", userId)`
  as defense-in-depth (the web app's `getTradeDetail`
  pattern).
- **Service role is used for exactly one thing:** inserting
  the `audit_logs` row for each call. It is never used to
  read trading data, and never appears in any tool result.
- **Audit everything.** Every `tools/call` writes one
  `audit_logs` row (`mcp.<tool_name>`) with the outcome
  (`ok`, `not_found`, `invalid_argument`, `unauthenticated`,
  `rate_limited`, `upstream_error`), the duration, and a
  correlation id. Failed authentication is logged with a
  null actor; no token material is ever logged. Stage 4
  audit rows carry only structured argument values (limit,
  from, to, week_start) — the free-text `pair` filter is
  deliberately not recorded.
- **No existence oracle.** A trade owned by another trader
  returns the byte-identical `not_found` result as a trade
  that does not exist.
- **Bounded results.** Single-entity tools only; free-text
  fields are capped at 2,000 chars with a `truncated` flag;
  screenshots are returned as a **count only** (no signed
  URLs in the POC). Per-user rate limit: 60 calls/minute.
  Per-call timeout: 10 s.

## Tools

### `get_trade` — `{ trade_id: uuid }`

The trade (pair, direction, prices, size, leverage, fees,
status, opened/closed, stored pnl/roi_pct/r_multiple/
risk_reward/is_win/duration), strategy and setup names,
psychology (emotion, confidence, discipline), lessons
(capped), screenshot count, and reversal linkage (ids +
statuses only).

### `analyze_trade` — `{ trade_id: uuid }`

Deterministic analysis, numbers-first:

- `metrics` — stored values, an `@itg/calc` recomputation
  from the raw inputs (the same functions the web app uses),
  and a `metrics_match` flag. Comparison is done as Decimals
  at the storage precision (`numeric(19,6)`); drift is
  reported in `mismatches`, never hidden.
- `plan_adherence` — stop-loss / take-profit presence,
  leverage vs the active risk-rules maximum, and position
  risk. The risk **amount** is computed via `@itg/calc`; the
  risk **percentage** is reported as
  `not computable: the active plan provides no capital base`
  when no capital context exists — never guessed.
- `risk_context` — risk events recorded on the trade's
  close date.
- `journal_completeness` — presence map for strategy,
  session, emotion, confidence, discipline, lesson, notes,
  screenshot.
- `findings` — rule-based observations, each citing the
  numbers it was derived from (the `lib/coach/insights.ts`
  honesty pattern).

### Stage 4 intelligence tools

All ten follow the identical security model (token-only
identity, RLS + `user_id` filters, unknown arguments
rejected before any query, one audit row per call, 60/min
rate limit, 10 s timeout, bounded results). All aggregation
math runs through `@itg/calc` primitives only, mirroring
the web app's `summarizeTrades` row semantics (closed
trades with a stored P&L; reversed trades are not closed
trades). Details: `docs/stage-4-ai-tools.md`.

- `get_recent_trades` — `{ limit? 1–50 (default 10), pair? }`
  newest-first trade summaries (no notes/free text) +
  pagination metadata `{ returned, limit, truncated }`.
- `get_performance_summary` — `{ from, to }` (ISO dates,
  range ≤ 366 days): count, win/loss rates, net P&L, profit
  factor, avg win/loss, expectancy, avg R, max drawdown,
  current streak, best/worst trade.
- `get_strategy_performance` — `{ from, to }`: the same
  summary per strategy (names resolved; strategy-less
  trades group as "No strategy"), sorted by net P&L desc,
  capped at 20 groups.
- `get_session_performance` — `{ from, to }`: grouped by
  the trade's stored `session`; trades without one group
  as "Not Provided".
- `get_psychology_summary` — `{ from, to }`: per-emotion,
  confidence-band (1–2 / 3 / 4–5) and per-discipline
  aggregates, plus explicit counts of closed trades with
  and without a psychology record.
- `get_risk_status` — `{ }`: stored state only (the risk
  engine is not re-run) — active risk rules, active plan
  summary, today's (UTC) risk events by severity, open
  (unresolved) event count.
- `get_goal_progress` — `{ }`: goals with progress —
  measured where the app measures them (mirroring the
  discipline engine's goal types and period windows),
  otherwise the latest manual `goal_progress` value,
  otherwise `progress: null` + `"Measured in the app"`.
- `get_discipline_status` — `{ }`: latest 5 stored
  discipline events + unread notification count.
- `get_level_status` — `{ }`: the stored `user_levels` row
  (never recomputed; `level: null` + an honest note when
  none exists) + XP total, by-reason totals, last 10 XP
  events.
- `get_weekly_review` — `{ week_start }`: any date in the
  week, normalized to its Monday like the app; the stored
  review (text capped at 2,000 chars with a truncation
  flag, stored aggregates reported as saved) + the week's
  live closed-trade summary. No review → `not_found`.

- `compute_coach_insights` — `{ week_start? }` (Phase 20):
  the deterministic weekly coach analysis, computed by the
  web app's authenticated internal endpoint
  (`POST /api/internal/coach-insights`) — **not** by this
  server. The tool forwards the caller's validated access
  token as a Bearer header and sends `week_start` only (no
  identity fields, no service key); the endpoint derives the
  trader from the token and runs the one coach engine
  (`lib/coach/insights.ts`) under RLS. Compute-only: nothing
  is persisted by the call. Upstream statuses map onto the
  usual taxonomy (401 → `unauthenticated`, 400 →
  `invalid_argument`, 429 → `rate_limited`, else
  `upstream_error`), the response is sanity-capped at
  ~64 KB, and the call is audited like every other tool
  (`mcp.compute_coach_insights`, entity_type `ai_insights`).

## Protocol

MCP over stdio, newline-delimited JSON-RPC 2.0, implemented
directly (no SDK, per design §1): `initialize`,
`notifications/initialized`, `ping`, `tools/list`,
`tools/call`. A malformed frame or failing call returns a
JSON-RPC / tool error — the process never crashes on a bad
request. Diagnostics go to stderr; stdout carries only
protocol frames.

## Configuration

| Env var | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Anon key — auth validation + RLS-scoped reads |
| `SUPABASE_SERVICE_ROLE_KEY` | Audit inserts only |
| `ITG_SUPABASE_ACCESS_TOKEN` | The trader's access token (host-supplied) |
| `ITG_API_BASE_URL` | Web app base URL for the internal coach endpoint used by `compute_coach_insights` (Phase 20). Optional; defaults to `https://itg-traderos.vercel.app` |

If `SUPABASE_URL` / `SUPABASE_ANON_KEY` are missing, the
server still starts and answers `initialize`, but every
`tools/call` returns `upstream_error: not_configured`.

## Run

```bash
# from the repo root
npm install
npm run build --workspace=@itg/mcp-server

SUPABASE_URL=... SUPABASE_ANON_KEY=... \
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key ITG_SUPABASE_ACCESS_TOKEN=... \
npm start --workspace=@itg/mcp-server
```

The build compiles the server **and** the `@itg/calc`
sources it imports into `apps/mcp-server/dist/`
(`dist/apps/mcp-server/src/index.js` is the entry point), so
the compiled server runs with plain `node` — no transpiler
or SDK at runtime.

## Tests

Unit tests (fake-Supabase, reusing the web app's test
helper) live beside the sources and run with the repo suite:

```bash
npm test            # repo root — includes apps/mcp-server/src
npm run typecheck --workspace=@itg/mcp-server
```

They cover: happy paths, uuid/unknown-argument validation,
tenant isolation (user B + user A's trade → the identical
`not_found` shape), `metrics_match` true/false (tampered
pnl), exactly-one-audit-row per call on every path, the
60/minute rate limit, and the JSON-RPC protocol subset.
The Stage 4 tests (`src/intelligence.test.ts`) add
hand-computed aggregate fixtures per tool, validation and
empty-state honesty cases, and cross-tenant checks for the
list/summary tools. The Phase 20 tests (`src/coach.test.ts`)
cover the coach tool's wire contract (URL, Bearer header,
`week_start`-only body), pre-fetch argument rejection,
upstream status mapping and audit-once behaviour; the
13-tool `tools/list` contract is asserted in
`src/server.test.ts`.

The live smoke test against the real Supabase project
(verification accounts only) is recorded in
[SMOKE_TEST.md](./SMOKE_TEST.md).

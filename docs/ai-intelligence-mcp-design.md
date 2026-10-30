# ITG AI Intelligence + MCP — design (Stages 3–5)

Status: design document, written before implementation
(Stage 4 requirement). Stage 3 implements only the POC
subset (§3). Everything here is **read-only**: this layer can
never execute trades, reach a broker, move funds, or write
trading data.

## 1. Architecture

```
Muse AI
  → MCP Client / Host (supplies the trader's Supabase session token)
    → ITG MCP Server (new standalone process, apps/mcp-server)
      → ITG backend libraries (@itg/calc, shared query logic)
        → Supabase (Postgres + Auth), RLS enforced
```

- The MCP server is a separate Node/TypeScript process in
  this monorepo so it reuses `@itg/calc` (the single source
  of financial calculations) and mirrors the web app's
  tenant-scoped query patterns (`lib/trades/queries.ts`).
- Transport: stdio, MCP JSON-RPC protocol (initialize,
  tools/list, tools/call, ping). No new runtime dependency
  for the POC: the protocol subset is small and implemented
  directly; adopting the official SDK later is a drop-in
  transport swap, not a redesign.
- The web app is untouched by the POC: no new routes, no
  changes to auth, RLS, or calculations.

## 2. Security model (non-negotiable)

1. **Tenant identity comes only from the authenticated
   context.** The MCP host passes the trader's Supabase
   access token to the server process (environment,
   `ITG_SUPABASE_ACCESS_TOKEN`). The server validates it
   with Supabase Auth (`auth.getUser(token)`) and derives
   `user_id` from the validated token. **Tool arguments
   never carry a user/tenant id** — a `user_id` field in
   tool input is rejected as an unknown argument.
2. **RLS is the enforcement layer.** All reads run through
   a Supabase client created with the anon key + the user's
   JWT (exactly like the web app's browser/server clients),
   so Postgres RLS applies. Queries additionally filter
   `.eq("user_id", userId)` as defense-in-depth, mirroring
   `getTradeDetail`.
3. **Service role is used for exactly one thing:** inserting
   the audit row (`writeAuditLog` pattern), inside the
   server process only. Its key lives in the server process
   environment, is never returned in any tool result, and
   is never used to read trading data.
4. **Audit everything.** Every `tools/call` writes an
   `audit_logs` row: actor = token user, action =
   `mcp.<tool_name>`, entity = target entity, details =
   { tool, arguments (ids only, no free text), outcome:
   ok | not_found | invalid | error, duration_ms }.
   Failed authentication attempts are logged with a null
   actor and the reason class (no token material, ever).
5. **Input validation.** ids must be UUID-shaped; enums are
   whitelisted; numeric ranges bounded (e.g. limit 1–50);
   unknown arguments rejected; payload size capped.
6. **Bounded results.** Single-entity tools return one
   entity. List tools paginate with a hard cap (50) and
   return `truncated: true` + a continuation hint rather
   than unbounded data. Free-text fields (notes, lessons)
   are length-capped in projections (2,000 chars) with the
   cap visible in the result metadata.
7. **No existence oracle.** A trade that belongs to another
   trader returns the identical `not_found` result as a
   trade that does not exist.
8. **Rate limiting.** Per-user call budget (e.g. 60 calls /
   minute, in-process token bucket) — a misbehaving client
   cannot hammer the database.
9. **No write/execution surface.** The server exposes no
   tool that inserts, updates, deletes, executes, transfers
   or withdraws. Future write-ish ideas (e.g. "save this
   insight") must go through the web app's existing audited
   server actions, not MCP.

## 3. Stage 3 POC tools

### 3.1 `get_trade`
- **Purpose:** return one of the authenticated trader's
  trades with its journal context.
- **Input:** `{ trade_id: string (uuid) }` — nothing else.
- **Output (bounded projection of TradeDetail):**
  trade fields (pair, direction, prices, size, leverage,
  fees, status, opened/closed, stored pnl/roi_pct/
  r_multiple/risk_reward/is_win/duration), strategy name,
  setup name, psychology (emotion, confidence, discipline,
  session, market condition, trade reason), lessons
  (texts, capped), screenshot **count** (no signed URLs in
  the POC — avoids leaking bearer URLs into model context),
  reversal linkage (ids + statuses only).
- **Errors:** `invalid_argument` (bad uuid / extra fields),
  `not_found` (missing OR not owned), `unauthenticated`,
  `upstream_error` (sanitized).
- **Data sources:** trades, strategies, setups,
  psychology_records, lessons, trade_screenshots (count) —
  via the RLS client, user-scoped.
- **Audit:** `mcp.get_trade` on trades/<trade_id>.

### 3.2 `analyze_trade`
- **Purpose:** deterministic, numbers-first analysis of one
  trade — the same facts the AI Coach engine reasons over,
  with every figure cited.
- **Input:** `{ trade_id: string (uuid) }`.
- **Output:**
  - `metrics`: stored pnl/roi/R/RR/win/duration **plus** a
    recomputation via `@itg/calc` from the raw inputs and
    a `metrics_match` flag (drift between stored and
    recomputed values is reported, never hidden).
  - `plan_adherence`: stop-loss present? take-profit
    present? leverage vs the trader's active plan max (and
    vs risk rules), position risk % vs plan risk-per-trade
    (computed with @itg/calc from entry/SL/size/capital when
    the plan provides capital context — otherwise reported
    as "not computable: <missing input>", never guessed).
  - `risk_context`: risk events recorded on the trade's
    close date (daily-loss breaches etc.), or none.
  - `journal_completeness`: which review fields exist vs
    missing (strategy, session, emotion, confidence,
    discipline, lesson, notes, screenshot) — presence only.
  - `findings`: rule-based observations, each with the
    numbers it was derived from (same honesty pattern as
    `lib/coach/insights.ts`: an insight always cites its
    snapshot).
- **Calculations:** only `@itg/calc` + the stored row.
  No LLM math, no invented figures.
- **Errors / audit:** as get_trade; action
  `mcp.analyze_trade`.

## 4. Stage 4 tool catalog

Each tool follows §2. "Compute" tools are pure functions of
stored data via existing app logic (analytics/coach/risk/
gamification modules) — the MCP layer is a transport, never
a second implementation of a calculation.

Status as of 2026-10-29 (Stage 4): ten of the eleven tools
below are **Implemented (Stage 4)** — see
`docs/stage-4-ai-tools.md` for inputs/outputs/sources, the
aggregation-semantics mirroring notes, and the live
cross-check table. `compute_coach_insights` was **Deferred**
at Stage 4 for the reason recorded under the table, and was
then **Implemented in Phase 20 (2026-10-30)** via the
internal-endpoint route described there — all eleven tools
are now implemented.

| Tool | Purpose | Inputs | Key outputs | Sources / logic | Status |
|---|---|---|---|---|---|
| `get_recent_trades` | Bounded list for "what have I been doing" | limit (1–50), optional from/to, pair | Trade summaries (no notes), pagination meta | getTradeListItems pattern | Implemented (Stage 4) |
| `get_performance_summary` | Period performance | period: week/month/custom range | trades, win rate, net P&L, profit factor, avg R, max drawdown — all from `summarizeTrades` | lib/analytics | Implemented (Stage 4) |
| `get_strategy_performance` | Per-strategy breakdown | period | rows per strategy with the same metrics | lib/analytics by strategy | Implemented (Stage 4) |
| `get_session_performance` | Per-session breakdown | period | rows per session | lib/analytics by session | Implemented (Stage 4) |
| `get_psychology_summary` | Emotion/confidence/discipline vs outcome | period | aggregates + best/worst emotion by P&L | lib/analytics psychology | Implemented (Stage 4) |
| `get_risk_status` | Current risk posture | — | active rules, today's usage vs limits, open risk events | lib/risk engine (read path) | Implemented (Stage 4) |
| `get_goal_progress` | Goals with measured progress | — | goals + resolved progress (same resolver as /goals) | lib/discipline engine | Implemented (Stage 4) |
| `get_level_status` | Level + XP standing | — | level, score by dimension, XP total, recent XP events (capped) | lib/gamification | Implemented (Stage 4) |
| `get_discipline_status` | Discipline reminders state | — | current reminder level + recent events | lib/discipline engine | Implemented (Stage 4) |
| `get_weekly_review` | One week's review + aggregates | week_start | review text (capped), aggregates snapshot | lib/reviews | Implemented (Stage 4) |
| `compute_coach_insights` | The deterministic coach analysis for a week, computed on demand | week_start | insights with metrics_snapshot (NOT persisted — persistence stays in the app action) | lib/coach/insights, via the app's internal endpoint | **Implemented (Phase 20)** |

**`compute_coach_insights` — Implemented (Phase 20).** The
Stage 4 deferral reason stands: the deterministic coach
engine exists only as web-app code
(`apps/web/lib/coach/insights.ts`), and copying it into the
MCP server would create a second source of truth for coach
logic, which §4's own rule ("the MCP layer is a transport,
never a second implementation of a calculation") forbids.
Phase 20 took the endpoint route the deferral anticipated:
the web app exposes `POST /api/internal/coach-insights`
(Bearer-token authenticated, token-derived identity only,
compute-only — see `docs/phase-20.md`), and the MCP tool is
a thin HTTP client for it, forwarding the caller's validated
access token. The engine still exists in exactly one place.

Implementation rule: a tool is built only when (a) its
underlying app logic already exists and is tested, (b) the
read is naturally bounded, and (c) a coach conversation
plausibly needs it. Anything else stays a design entry.

## 5. Failure handling (all tools)

- Auth token missing/expired/invalid → `unauthenticated`
  tool error, audit row with null actor; no data touched.
- Validation failure → `invalid_argument` with the field
  named; no query runs.
- Not found / not owned → single `not_found` shape.
- Supabase/network failure → `upstream_error` with a
  correlation id that matches the audit row; no stack
  traces, SQL, or keys in the message.
- Timeout per call (10 s) → `upstream_error: timeout`.
- The server process never crashes on a bad call: the
  JSON-RPC loop isolates per-request errors.

## 6. Testing strategy

- Unit: tool handlers against the existing fake-Supabase
  test helper — happy path, validation, not-found,
  **tenant isolation** (user B's id + user A's trade id →
  not_found; and a tool call whose arguments smuggle a
  `user_id` → invalid_argument).
- Metrics integrity: analyze_trade recomputation matches
  stored metrics for seeded rows; a tampered stored pnl
  flips `metrics_match` to false.
- Audit: every path (ok/not_found/invalid/auth) writes
  exactly one audit row with the right action.
- Live smoke (verification account only): initialize →
  tools/list → get_trade/analyze_trade on a real audit
  trade → audit rows present in `audit_logs`; cross-tenant
  probe with Ezat's (empty) trade space returns not_found
  for the test trade id when called under a different
  identity — executed only where a second test identity
  legitimately exists; otherwise the fake-client isolation
  tests carry the proof and the limitation is stated.

## 7. Stage 5 — AI Coach foundation (architecture)

Pipeline (all pieces already exist except the trigger):
`trade closed → analysis job → MCP tools → deterministic
analysis (+ future LLM narration over the SAME cited
numbers) → ai_insights row with metrics_snapshot → dashboard
/coach surfaces (already built in Phase 9)`.

Rules: the coach may only assert numbers a tool returned;
every insight keeps its metrics_snapshot; the deterministic
engine remains the fallback when no LLM is configured;
nothing in this pipeline can place, modify, or close a
trade. Full design: `docs/ai-coach-foundation.md`.

## 8. Explicitly out of scope (permanent for this layer)

Trade execution of any kind; broker/exchange connectivity
for orders; deposits, withdrawals, transfers; writing or
deleting journal data; admin impersonation; service-role
data reads; cross-user aggregation of private trading data.

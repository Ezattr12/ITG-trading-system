# @itg/mcp-server — ITG AI Intelligence MCP server (Stage 3 POC)

A standalone, **read-only** MCP server that exposes exactly
two tools over ITG TraderOS data — `get_trade` and
`analyze_trade` — per the approved design in
`docs/ai-intelligence-mcp-design.md`. It has no write,
execution, broker, transfer or withdrawal surface of any
kind, and the web app is untouched by it.

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
  `audit_logs` row (`mcp.get_trade` / `mcp.analyze_trade`)
  with the outcome (`ok`, `not_found`, `invalid_argument`,
  `unauthenticated`, `rate_limited`, `upstream_error`), the
  duration, and a correlation id. Failed authentication is
  logged with a null actor; no token material is ever
  logged.
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

The live smoke test against the real Supabase project
(verification accounts only) is recorded in
[SMOKE_TEST.md](./SMOKE_TEST.md).

# Stage 3 — MCP read-only POC: implementation record, 2026-10-29

Implements the POC subset (§3) of
`docs/ai-intelligence-mcp-design.md`. The web app is
untouched; nothing about production deployment changes — the
MCP server is a standalone stdio process in this monorepo
(`apps/mcp-server`, `@itg/mcp-server`).

## What exists

- Hand-rolled MCP JSON-RPC subset over stdio (initialize,
  notifications/initialized, ping, tools/list, tools/call) —
  no SDK dependency, per the design. Per-request error
  isolation; the process never crashes on a bad call.
- Exactly two tools: `get_trade(trade_id)`,
  `analyze_trade(trade_id)`. No write, execution, broker,
  transfer or withdrawal surface exists.
- Tenant identity **only** from the authenticated context:
  the trader's Supabase access token arrives via
  `ITG_SUPABASE_ACCESS_TOKEN`, is validated with
  `auth.getUser` on every call, and the user id is derived
  from the token. Tool schemas accept `trade_id` only — a
  smuggled `user_id` is rejected as an unknown argument
  before any query runs.
- Reads run on an anon-key + user-JWT client (Postgres RLS
  enforced) plus explicit `.eq("user_id", …)` filters.
  The service-role key is read in exactly one module
  (`src/config.ts`) and used for exactly one thing:
  inserting the `audit_logs` row. The security check was
  extended to recognize that single sanctioned reader.
- Every call writes exactly one audit row
  (`mcp.get_trade` / `mcp.analyze_trade`) with outcome
  ok | not_found | invalid_argument | unauthenticated |
  upstream_error | rate_limited, duration and a correlation
  id. 60 calls/min per-user token bucket; 10 s call timeout.
- Bounded results: explicit projections, free text capped
  at 2,000 chars with truncation flags, screenshot **count**
  only (no signed URLs), reversal linkage as ids+statuses.
  Another trader's trade and a nonexistent trade return the
  identical `not_found` shape (no existence oracle).
- `analyze_trade` recomputes metrics with `@itg/calc` and
  reports `metrics_match` honestly (stored roi_pct
  0.297767 vs recomputed 0.2977667… — equal at the column's
  numeric(19,6) precision); plan adherence is reported as
  "not computable: <missing input>" when the plan lacks a
  capital base — never guessed.

## Verification

- Unit: 21 new tests (fake-Supabase) — happy paths,
  validation, smuggled-argument rejection, cross-tenant
  isolation with byte-identical not_found payloads,
  metrics_match true/false (tampered pnl → metrics_drift
  finding), rate limit (call 61 rejected, all 61 audited),
  protocol negotiation and error isolation. Full repo suite
  **381/381**; typecheck (web + calc + mcp-server), lint,
  build and security check all pass.
- Live smoke vs real Supabase (compiled server, stdio):
  tools/list = exactly the two tools; get_trade returned
  the Stage 2 audit trade (XAUUSD 4030→4042, P&L 1.20,
  strategy BOS, full journal context); analyze_trade
  metrics_match true with plan adherence against the real
  plan; random uuid → not_found; smuggled user_id →
  invalid_argument; no token → unauthenticated.
- Cross-tenant proof: a second throwaway account was
  created via the Auth Admin API, called both tools on the
  first account's trade id, received byte-identical
  not_found responses, and was then **deleted** (verified:
  GET-after-delete 404, profile cascade-deleted).
- Audit evidence: 7 `mcp.%` rows in live `audit_logs`
  matching the 7 smoke calls (independently re-queried by
  the parent after the run).

## Known wrinkle (recorded in apps/mcp-server/SMOKE_TEST.md)

`audit_logs.user_id`/`actor_id` are FKs to `profiles(id)`.
An identity with no profile row (only possible for an
artificial Admin-API-created user that never entered the
app) cannot be audit-logged; the insert is rejected and, by
design, the call still proceeds — the same "audit never
breaks the flow" semantics as the web app's writeAuditLog.
Real trader identities always have a profile row.

## Not deployed

The MCP server is not hosted anywhere: MCP hosts run it
locally over stdio (see `apps/mcp-server/README.md` for the
run command and env). Production (Vercel) is unchanged by
this stage.

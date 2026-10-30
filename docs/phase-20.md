# Phase 20 — Coach Engine extraction, trade-close trigger, MCP `compute_coach_insights`

**Date:** 2026-10-30. **Scope:** Hours 1–3 of the approved Phase 20 plan.
**Hard rule honoured throughout:** the deterministic Coach Engine exists in
exactly ONE place. Nothing about coach results or behaviour changed.

## Architecture

```
                        ┌─────────────────────────────────────────────┐
                        │  THE ENGINE (unchanged, single source)      │
                        │  lib/coach/insights.ts                      │
                        │    generateCoachInsights(evidence) — pure   │
                        │  lib/coach/queries.ts                       │
                        │    getCoachWeekData(supabase, userId, mon)  │
                        └──────────────────┬──────────────────────────┘
                                           │
                        ┌──────────────────▼──────────────────────────┐
                        │  lib/coach/service.ts (NEW)                 │
                        │  computeCoachInsights()      — read-only    │
                        │  refreshCoachInsights()      — compute +    │
                        │    idempotent persist (snapshot dedupe)     │
                        │  refreshCoachInsightsSafely()— never throws │
                        └──────┬───────────────────────┬──────────────┘
                               │                       │
              ┌────────────────▼───────────┐   ┌───────▼────────────────┐
              │ App callers                │   │ Internal endpoint      │
              │ - refreshCoachAnalysis-    │   │ POST /api/internal/    │
              │   Action (manual refresh)  │   │   coach-insights       │
              │ - trade-close trigger in   │   │ lib/coach/endpoint.ts  │
              │   lib/trades/actions.ts    │   │ compute ONLY, no writes│
              └────────────────────────────┘   └───────▲────────────────┘
                                                       │ HTTPS + Bearer
                                                       │ (caller's token)
                        ┌──────────────────────────────┴───────────────┐
                        │ MCP server: compute_coach_insights          │
                        │ (apps/mcp-server/src/coach.ts — an HTTP     │
                        │ client + status mapping; NO coach logic)    │
                        └─────────────────────────────────────────────┘
```

### The shared service — `apps/web/lib/coach/service.ts` (new)

- `computeCoachInsights(supabase, userId, weekStartDate)` →
  `{ status: "ok", analysis } | { status: "insufficient_data", analysis } |
  { status: "invalid_week" } | { status: "no_data" }`. Runs `mondayOfWeek`
  normalisation + `getCoachWeekData` + `generateCoachInsights`. **No writes
  of any kind.**
- `refreshCoachInsights({ supabase, admin, userId, weekStartDate })` →
  compute + the idempotent persist that previously lived inline in
  `refreshCoachAnalysisAction`, moved verbatim: snapshot-key dedupe via
  `stableStringify` (moved here and exported) + `getAiInsightsForWeek`,
  service-role inserts, a unique-index race counts as skipped, insufficient
  data inserts nothing. Returns `{ inserted, skipped, analysis,
  insufficientData }`. When insights exist but no service-role client is
  available it throws `CoachStoreUnavailableError` (the action maps it to
  its original message; the safe wrapper swallows it).
- `refreshCoachInsightsSafely(args)` → try/catch wrapper that **never
  throws** (returns `null` on any failure). Built for the trade-close
  trigger.

`refreshCoachAnalysisAction` now delegates to `refreshCoachInsights` and
maps the result back onto its original outcomes. Session auth, form
validation (`refreshCoachSchema`), `mondayOfWeek` handling and
`revalidatePath("/coach")` + `revalidatePath("/dashboard")` are unchanged.

## Internal endpoint contract — `POST /api/internal/coach-insights`

Implementation: `apps/web/app/api/internal/coach-insights/route.ts` is a
thin adapter over the testable core `handleCoachInsightsCompute` in
`apps/web/lib/coach/endpoint.ts`. Runtime: nodejs.

- **Auth:** `Authorization: Bearer <Supabase access token>` required. An
  anon-key client carrying the token is built (same construction as the
  MCP server's RLS client) and validated with `auth.getUser()`; the
  trader identity is the validated user id **only**. All reads run on
  that token-scoped client, so RLS applies exactly as in the app.
  Missing/invalid token → `401 { "error": "unauthenticated" }`.
- **Request body:** JSON `{ "week_start"?: "YYYY-MM-DD" }`. Any date in
  the week is accepted and normalised to its Monday; omitted →
  current week's Monday (UTC). If the body contains `user_id`,
  `tenant_id`, `profile_id` or `userId` → `400 { "error":
  "invalid_argument", "message": "identity field not allowed: <field> —
  the trader is identified by the access token" }`, even with a valid
  token. Malformed JSON, a non-object body, or a non-date / impossible
  `week_start` (e.g. `2026-02-30`, rejected by round-trip check) → `400`.
- **Response 200:** `{ week_start, period_start, period_end,
  insufficient_data, insights: [{ type, title, metrics_snapshot }],
  generated_at }` — the engine's real field names from
  `lib/coach/types.ts` (`CoachInsight` has no free-text detail field, so
  none is invented). A week with too few closed trades is a 200 with
  `insufficient_data: true` and `insights: []`. Free-text fields are
  defensively capped at 2,000 chars.
- **Compute only:** the endpoint never writes `ai_insights` (asserted in
  tests: zero inserts on the client; asserted live: counts unchanged by
  endpoint calls).
- **Rate limit:** per user, 30 computes/minute via the shared
  `lib/auth/rate-limit` helpers → `429 { "error": "rate_limited" }`.
- **Audit:** every authenticated compute writes exactly one `audit_logs`
  row via the existing `writeAuditLog` helper — action
  `internal.coach_insights_compute`, entity_type `ai_insights`, details
  `{ week_start, outcome, insights_count }`. Unauthenticated attempts
  are audited best-effort with a null actor and outcome
  `unauthenticated` (the helper accepts a null user; the Stage 3 FK
  wrinkle applies only to non-null profile-less ids). Token material is
  never logged.
- **Middleware note:** `apps/web/middleware.ts` now returns early for
  `/api/*` paths. The Phase 2 page protection redirected token-only API
  calls to `/login`, which made the endpoint unusable for its only
  caller class (non-browser token clients). API routes authenticate
  themselves; page protection is unchanged. This was the one
  integration fix outside the planned file list, and it is required by
  the endpoint contract above.

## Trade-close trigger — hook sites (`apps/web/lib/trades/actions.ts`)

One helper, `refreshCoachAfterClosedTradeChange(supabase, userId,
closedAt, openedAt)`, builds the service-role client and awaits
`refreshCoachInsightsSafely` for the week containing the trade's
`closed_at` (fallback `opened_at`, date part only). It is called from:

1. **`createTradeAction`** — after a successful insert when
   `metrics.status === "closed"` (an open trade does not trigger).
2. **`correctTradeAction`** — after the correcting trade is inserted and
   the original marked reversed, when the correcting trade is closed.
   (The original's reversal also changes the week — the same refresh
   covers it, since evidence is assembled fresh.)
3. **`saveAdvancedReviewAction`** — this action never changes status,
   `closed_at` or P&L, but it changes strategy/setup/session/notes,
   psychology (emotion/confidence/discipline) and lessons, all of which
   feed the engine. Hooked when the trade is closed; the trade select
   was extended with `closed_at, opened_at` to locate the week.

**Failure isolation:** the trigger path cannot change any action's
result, redirect, XP or error behaviour — the only await is the
never-throwing safe wrapper, and the refresh runs after the trade is
already saved and audited. Proven by test (a sabotaged insight store
still returns the action's normal success) and by design (no shared
mutable state).

**Idempotency:** inherited from the service's snapshot dedupe plus the
migration 0013 unique index — repeating a trigger with unchanged data
inserts nothing. **The refresh awards no XP and creates no
notifications** (verified in the service code: it only reads and
inserts `ai_insights`; XP/notification writes live in the trade actions
themselves, untouched).

## MCP tool — `compute_coach_insights` (apps/mcp-server)

- New module `src/coach.ts`: tool definition, strict argument parsing
  (`{ week_start? }` only — unknown args incl. `user_id`/`tenant_id`
  rejected pre-call as `invalid_argument`, exactly like the other
  tools) and the HTTP client. **No coach logic is imported or copied.**
- The dispatcher (`src/tools.ts`) validates the caller's token as for
  every tool, then the tool POSTs `{ week_start }` (or `{}`) to
  `${ITG_API_BASE_URL ?? "https://itg-traderos.vercel.app"}/api/internal/coach-insights`
  with `Authorization: Bearer <the same validated access token>`. No
  service key is used; no identity fields are sent. Fetch base URL and
  implementation are injectable via `ToolCallerDeps.fetchImpl` +
  `McpConfig.apiBaseUrl` (`ITG_API_BASE_URL` env, new).
- Timeout: `AbortSignal.timeout(10000)` inside the dispatcher's
  existing 10 s per-call timeout. Status mapping: 401 →
  `unauthenticated`, 400 → `invalid_argument` (with the endpoint's
  short message), 429 → `rate_limited`, anything else →
  `upstream_error` (sanitised; upstream bodies never echoed beyond a
  ≤200-char message). Response bounded: ~64 KB total sanity cap +
  2,000-char text caps.
- Audit: through the existing dispatch — exactly one row per call,
  action `mcp.compute_coach_insights`, entity_type `ai_insights`,
  entity_id null, arguments `{ week_start }` only.
- `tools/list` now returns exactly **13 tools**.

## Security model (unchanged principles, new surface)

- Identity only ever comes from a validated Supabase access token —
  in the endpoint (Bearer → `auth.getUser`) and in the MCP server
  (env token → dispatcher auth). Smuggled identity is refused at both
  layers, before any data access.
- All endpoint reads run under RLS on the caller's own JWT client;
  there is no service-role read anywhere in the new code. The
  service-role client is used only where it already was: `ai_insights`
  inserts in the refresh (RLS has no client insert policy) and
  `audit_logs` inserts.
- The endpoint is compute-only; the MCP server gained no write surface
  of any kind; no execution/broker/funds capability exists anywhere in
  this phase.
- Rate limits at both layers (MCP 60/min per user; endpoint 30/min per
  user), one audit row per call at both layers, no secrets or token
  material in logs, results or audit details.

## Behaviour preservation — manual refresh messages

`refreshCoachAnalysisAction`'s user-facing strings are byte-identical
to before the refactor (verified by reading the final file, and the
up-to-date string was also observed live in the E2E below):

| Case | Message |
|---|---|
| Success with inserts | `Coach analysis refreshed: N new insight[s] stored[, M unchanged insight[s] skipped].` |
| Nothing changed | `Analysis is up to date — nothing changed since the last refresh, so no new insights were stored.` |
| Insufficient data | `Not enough trades yet to analyse this week — the coach needs at least 3 closed trades. Journal a few more trades and refresh again.` |
| Invalid week | `Choose a valid week (YYYY-MM-DD, Monday).` |
| Evidence load failure | `Could not load this week's data. Please try again.` |
| Store unavailable | `Supabase is not configured — the analysis was not stored.` |
| Not logged in | `Please log in first.` |
| Not configured | `supabaseNotConnectedMessage()` (unchanged helper) |

Outcome **ordering** is also preserved: not-configured → not-logged-in
→ form/week validation → evidence-null → insufficient-data →
store-unavailable → success.

## Local end-to-end evidence (2026-10-30, test account only)

Setup: production build + `next start` on `127.0.0.1:3100` with the
live project's env; test account
`itg-verification-test-20261027@example.com` (id
`c4838c9d-babd-4d8c-9008-e0b1991aaa00`). Current week: Mon 2026-10-26 –
Sun 2026-11-01. SQL via the Supabase Management API.

**Before:** the account had 1 closed trade in the week (XAUUSD long,
P&L 1.20, closed 2026-10-29) and `ai_insights` rows for the week: **0**
(total for the user: 0).

| Step (all through the real UI) | Closed trades in week | `ai_insights` rows for the week (SQL) |
|---|---|---|
| Baseline | 1 | **0** |
| Created Trade A — EURUSD long 1.1000→1.1050, P&L +0.50 | 2 | **0** — trigger ran; below the 3-trade minimum, so insufficient-data stored nothing |
| Created Trade B — GBPUSD long 1.2700→1.2680, P&L −0.20 | 3 | **4** — inserted by the trigger with NO manual refresh: `weekly_performance` "Profitable week: 1.50 across 3 trades" (1.20 + 0.50 − 0.20 ✓), `discipline` "Journal completion was 33% this week", `risk` "Clean risk week: no breaches, stop-loss on every trade", `goals` "Goals: 0 of 4 completed this week" |
| Created Trade C — XAUUSD long 4030→4045 size 100, P&L +1500.00 | 4 | **8** — 4 new rows for the changed snapshots ("Profitable week: 1501.50 across 4 trades", journal completion 25%, …); duplicate check `GROUP BY insight_type, metrics_snapshot HAVING count(*) > 1` → **0 groups** |
| Manual "Refresh analysis" on /coach, no data change | 4 | **8** — nothing inserted; UI showed the exact pre-refactor message "Analysis is up to date — nothing changed since the last refresh, so no new insights were stored." (repeated once more, still 8) |

**Direct endpoint calls** (token from a Supabase password grant for
the test account, used in-process only):

- No token → `401 { "error": "unauthenticated" }`.
- Valid token + body `{ week_start, user_id }` → `400` naming
  `user_id` ("identity field not allowed: user_id — …").
- Valid token + `{ "week_start": "2026-10-26" }` → `200` with the same
  4 insights the engine produces for the current data — titles
  byte-identical to the trigger-stored batch above.
- `audit_logs` for `internal.coach_insights_compute`: one row per
  call — `unauthenticated` (null actor) ×2 (incl. an earlier curl
  probe), `invalid_argument` ×1, `ok` ×1 with
  `{ week_start: "2026-10-26", outcome: "ok", insights_count: 4 }`.

**Full MCP chain** (real MCP server over stdio →
`ITG_API_BASE_URL=http://127.0.0.1:3100` → endpoint → engine):

- `tools/list` → 13 tools incl. `compute_coach_insights`.
- `tools/call compute_coach_insights { week_start: "2026-10-26" }` →
  success, same 4 insight titles.
- Same call with a smuggled `user_id` → `invalid_argument`
  ("unknown argument: user_id"), no fetch performed.
- `audit_logs` for `mcp.compute_coach_insights`: exactly 2 rows (one
  per call), entity_type `ai_insights`, entity_id null, arguments
  `{ week_start: "2026-10-26" }` only.

These E2E writes are real rows for the verification test account
only — expected and allowed. No production deployment was made in
this phase.

## Tests

New: `lib/coach/service.test.ts` (11), `lib/coach/endpoint.test.ts`
(13), `lib/trades/actions.test.ts` (3), `apps/mcp-server/src/coach.test.ts`
(14). Updated: `server.test.ts` (12 → 13 tools) and one catalog
assertion in `intelligence.test.ts` that encoded the Stage 4
deferral. The fake-Supabase helper gained additive insert recording
(`inserts` / `insertsFor`) so write behaviour is observable in tests.

Full local verification (2026-10-30, after all changes incl. the
middleware fix): `npm test` 447/447 (47 files; baseline 406),
typecheck web + calc + mcp-server, lint, production build (route
table includes `ƒ /api/internal/coach-insights`), `security:check`
(256 files), Playwright `CI=true` 36/36 on a fresh server.

## What was NOT changed

- The engine (`lib/coach/insights.ts`), evidence assembly
  (`lib/coach/queries.ts`), coach types, coach validation, the coach
  page and its components — untouched. Coach results are identical by
  construction (same functions, same inputs).
- No migration, no schema change, no new dependency.
- No trade XP, notification or audit behaviour changed; the trade
  actions' results/redirects/errors are unchanged (trigger is
  failure-isolated and runs after the save).
- No execution, broker, transfer or withdrawal surface anywhere; the
  MCP server remains read/compute-only; the endpoint persists
  nothing.
- `logBacktestingSessionAction` (Stage 2 fix) untouched.
- Not deployed, not committed (per the phase instruction split —
  deployment/commit are the parent step).

## Production verification addendum (2026-10-30, post-deployment)

Deployment `dpl_EqXnNhLmUAosjpNGhpbdh7fo8XV1` (READY,
production). Verified live:

- Public routes 200 / 200 / 307→/login with all six security
  headers. Endpoint: no token → 401 JSON (not a /login
  redirect — the middleware change confirmed live); valid
  token + smuggled `user_id` (another trader's) → 400 naming
  the field; valid token + week → 200 with the 4 stored
  insight titles byte-identical.
- MCP against production (default base URL): tools/list =
  13; `compute_coach_insights` returned the same 4 titles
  with full snapshots; smuggled `user_id` →
  `invalid_argument`; `get_trade` unaffected.
- Cross-tenant: throwaway account B got
  `insufficient_data:true`, empty insights, none of the test
  account's numbers, from both MCP and the endpoint; B
  deleted after (GET → 404). Ezat's account verified
  untouched (0 trades, 0 insights).
- Audit: exactly one row per call on both ledgers
  (`mcp.compute_coach_insights`, `internal.coach_insights_compute`),
  including the invalid-argument call correctly producing no
  internal row.
- **Trade-close trigger, production:** creating the week's
  5th closed trade through the real production Add Trade UI
  (Save Trade button) moved `ai_insights` for the week from
  8 → 13 rows with **0 duplicate snapshot groups** — the
  automatic refresh fired with no manual refresh. Manual
  refresh on unchanged data inserted 0 (idempotent persist
  confirmed in production).

### Verification-rig lesson (false alarm, recorded for future audits)

The first production pass reported trade creation as broken
(303 → /login, session cleared, no insert, 7 attempts). Root
cause was the test scripts, not the app: Playwright clicked
the FIRST `button[type=submit]` on /trades/new, which is the
AppShell header's **Log out** button (its own form precedes
the trade form in DOM order). The logout action correctly
redirected to /login and cleared the session. Reproduced
and isolated locally with instrumented builds (middleware
passed the POST with a valid user; the trade action was
never entered because the submitted action was sign-out).
Future UI scripts must select Save Trade by accessible name
(`getByRole("button", { name: "Save Trade" })`), never by
submit-button order. With the correct button, production
trade creation + the Phase 20 trigger passed end-to-end
(trade `6bc633ea-d1be-4098-9a0d-aac9b98a31f4`, `?saved=1`).

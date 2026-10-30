# Phase 21 — M2 Backend: Session Bootstrap, Remaining Writes, One Read (2026-10-30)

M2 backend completes the mobile API surface on the M1
foundations (`docs/phase-21-m1.md`): the session bootstrap
that closes the M1 profile-less finding, the six deferred
write areas (risk rules/plan, weekly review, trade
screenshots, cancel-trade, notification mark-read,
backtesting log), and the single justified read endpoint.
Everything runs on the M1 pattern — service cores shared
with the web Server Actions, thin handlers on the standard
pipeline (Bearer auth → body well-formed → identity-field
rejection → unknown-key rejection → UUID path checks →
per-user rate limit → core → one `api.mobile.<op>` audit
row per call). No migrations, no new dependencies, no web
behaviour change: every pre-existing test passes
unmodified.

## 1. M2-A — Session bootstrap (`POST /api/mobile/session`)

### The problem (M1 finding)

A mobile-first identity can hold a valid Supabase account
without ever entering the web app, so it may have no
`profiles` row — and every FK pointing at profiles
(trades, audit_logs, …) then rejects its writes with a
generic 422, and its API audit rows are rejected too. The
web never hits this: `getCurrentUser` creates the profile
on first login.

### The mechanism

- The creation logic was extracted from
  `lib/auth/session.ts` (`getCurrentUser`) into
  `ensureProfileCore(supabase, user)` in
  `lib/profile/service.ts`, returning
  `{ profile, created }`. `getCurrentUser` now calls it
  and keeps its exact outcomes (including profile = null
  when creation fails). The insert runs under the
  caller's RLS client and carries exactly
  `{ id: user.id, full_name: user.user_metadata?.full_name ?? null }`
  — the name comes from auth metadata, never from request
  input.
- `POST /api/mobile/session` (handler
  `lib/api/handlers/session.ts`) authenticates the Bearer
  token, runs `ensureProfileCore` with the TOKEN client,
  reads `onboarding_profiles.is_complete`, and answers
  `200 { profile_id, created, onboarding_complete }`.
  The body is optional and must be empty when sent — any
  key is a smuggled identity field (400, naming it) or
  unknown (400, naming it).
- **Idempotent:** an existing profile returns
  `created: false` and inserts nothing; a repeat call is a
  pure read.
- **Race-safe:** a unique-violation (23505) on the insert
  — two first calls racing — re-reads the row and returns
  `created: false`.
- **Audit ordering:** the `api.mobile.session_bootstrap`
  row is written AFTER the bootstrap, so for a first-time
  user the profile exists when the audit insert runs and
  the FK holds — the bootstrapped user is auditable from
  their very first call. (Unauthenticated calls are still
  audited with a null actor, as everywhere in this API.)
- **Distinct failure:** a genuine creation failure (not a
  race) returns
  `422 { error: "profile_bootstrap_failed", message: "We could not finish setting up your profile. Please try again." }`
  — client-actionable, no internal details.
- `ApiAuth` now also carries the validated `User` object
  (additive; it was already fetched by `auth.getUser`) so
  the handler can reach `user_metadata` without a second
  auth call.
- `parseOptionalJsonBody` (lib/api/auth.ts) supports the
  bodiless-POST endpoints (session, cancel): an empty body
  parses as `{}`, so a body that IS sent still goes
  through identity/unknown-key rejection.

**Client contract:** the mobile app calls
`POST /api/mobile/session` once after sign-in, before any
write. `created: true` means the profile was just made;
`onboarding_complete` tells the app whether to route into
onboarding.

## 2. M2-B — Remaining write endpoints

Each write was extracted from its web action into a core
in the indicated service; the web action is now an adapter
with identical signature, messages, redirects and
revalidate behaviour (fetch-free pre-validation where the
original ordering requires it — the same discipline as
M1). Handlers live in `lib/api/handlers/`, routes in
`app/api/mobile/`.

| Endpoint | Core (service) | Success |
|---|---|---|
| `PUT /api/mobile/risk-rules` | `saveRiskRulesCore` (`lib/risk/service.ts`, new) | `200 { ok: true }` |
| `PUT /api/mobile/risk-plan` | `saveTradingPlanCore` (`lib/risk/service.ts`) | `200 { plan_id }` |
| `POST /api/mobile/reviews/weekly` | `saveWeeklyReviewCore` (`lib/reviews/service.ts`, new) | `200 { review_id, xp_awarded }` |
| `POST /api/mobile/trades/[id]/screenshots` (multipart, field `file`) | `uploadScreenshotCore` (`lib/trades/service.ts`) | `201 { screenshot_id }` |
| `DELETE /api/mobile/trades/[id]/screenshots/[screenshotId]` | `deleteScreenshotCore` (`lib/trades/service.ts`) | `200 { ok: true }` |
| `POST /api/mobile/trades/[id]/cancel` | `cancelTradeCore` (`lib/trades/service.ts`) | `200 { trade_id, status }` |
| `POST /api/mobile/notifications/read` | `markNotificationReadCore` / `markAllNotificationsReadCore` (`lib/discipline/service.ts`) | `200 { updated }` |
| `POST /api/mobile/backtesting` | `logBacktestingCore` (`lib/coach/service.ts`) | `200 { sessions, sessions_awarded, xp_awarded }` |

Semantics worth naming:

- **Risk rules / plan** keep the web's one-active-row
  upsert-by-user behaviour and their own audit rows
  (`risk_rules.saved`, `trading_plan.saved`). The plan
  core returns the real plan id (existing row on update,
  inserted row on create — the insert now selects the id
  back; the write itself is unchanged).
- **Weekly review** keeps everything in the existing
  logic: aggregates computed from the week's real closed
  trades, upsert on `(user_id, week_start_date)`, +30 XP
  via `awardXp` keyed by the review id (re-saving a week
  awards 0 and returns the same `review_id`), the
  completion notification, gamification refresh.
- **Screenshots** use the identical private bucket
  (`trade-screenshots`), per-user path
  (`<user_id>/<trade_id>/<ts>-<sanitised name>`), image
  validation (image only, 5 MB) and the core's upload rate
  limit (10 / 10 min — the operation's ONE limiter; the
  API-layer limiter is deliberately not stacked on this
  endpoint, the M1 one-limiter-per-operation rule). The
  delete core takes an optional `expectedTradeId`: the
  web adapter doesn't pass it (its historic by-id delete),
  the API does — a screenshot under a different trade path
  is a 404, identical to another trader's or a missing
  one.
- **Cancel** only cancels OPEN trades; a closed trade is
  the core's `business` failure → 422 with the web's exact
  message ("Only an open trade can be cancelled — a
  closed trade is corrected by reversal, never
  cancelled."). The web adapter keeps its void,
  redirect-either-way signature and ignores the outcome —
  byte-for-byte its historic behaviour.
- **Notifications read** takes exactly one target:
  `{ notification_id }` (must be the caller's — otherwise
  the identical 404) or `{ all: true }` (returns the real
  number of previously-unread rows flipped). Both keys or
  neither → 400. Note the deliberate asymmetry with the
  web: the web mark-one action reports success when the
  row isn't the caller's (its scoped update touches zero
  rows, which is not an error) and the adapter preserves
  exactly that; the API is stricter (404), which is the
  correct contract for a client that needs to know.
- **Backtesting** reuses the existing idempotency path
  verbatim — the per-session key still goes through
  `deterministicUuid(\`backtest:<date>:<n>\`)` inside
  `awardXp` (moved with the code into the core; the Stage
  2 regression guard in `lib/gamification/xp.test.ts`
  passes unmodified). `sessions` is the day's TOTAL, as
  on the web: a repeat awards 0, raising the total awards
  only the new sessions at +15 each.

## 3. Service extractions (web behaviour preserved)

| Core | From | Into |
|---|---|---|
| `ensureProfileCore` | `lib/auth/session.ts` `getCurrentUser` (inline) | `lib/profile/service.ts` |
| `saveRiskRulesCore`, `saveTradingPlanCore` | `lib/risk/actions.ts` | `lib/risk/service.ts` (new) |
| `saveWeeklyReviewCore` | `lib/reviews/actions.ts` | `lib/reviews/service.ts` (new) |
| `cancelTradeCore`, `uploadScreenshotCore`, `deleteScreenshotCore` | `lib/trades/actions.ts` | `lib/trades/service.ts` |
| `markNotificationReadCore`, `markAllNotificationsReadCore` | `lib/discipline/actions.ts` | `lib/discipline/service.ts` |
| `logBacktestingCore` | `lib/coach/actions.ts` | `lib/coach/service.ts` |

`lib/reviews/actions.ts` is now only the adapter.
`logRiskEvent`/`resolveRiskEventAction` were not part of
the mandate and are untouched. The shared test fake gained
delete support (`FakeQuery.delete()` + per-client
`deletes`/`deletesFor(table)` recording), additive only.

## 4. M2-C — Read-endpoint evaluation: why only summary

Every other read the app needs is a list or a detail that
RLS already scopes to the caller, and the Supabase client
in the app can run it directly with the same token —
an HTTP wrapper would add a hop without adding safety or
computation:

| Read | Route | Why no endpoint |
|---|---|---|
| Trades list / detail | direct `trades` select under RLS | plain rows, owner-scoped by policy |
| Goals list / detail | direct `goals` select under RLS | same |
| Profile / onboarding | direct `profiles` / `onboarding_profiles` select | same |
| Levels / XP history | direct `user_levels` / `xp_transactions` selects | same |
| Coach insights | direct `ai_insights` select | stored rows, already computed server-side at write time |
| Notifications | direct `notifications` select | same |

The one exception is the dashboard/analytics aggregate:
`getReportSummary` (`lib/reports/queries.ts`) is a
trusted server computation over the period's trades
(win rate, profit factor, expectancy, breakdowns,
recommendations) that the client cannot reproduce from
raw rows without re-implementing the report engine — a
second source of truth. Hence exactly one read endpoint:

- `GET /api/mobile/summary?range=week|month` (default
  `week`) → `200 { range, period_start, period_end, summary }`
  where `summary` is the `ReportSummary` shape as-is.
  Week = current Mon–Sun UTC; month = current calendar
  month. Computed with the caller's token client.
  Invalid range → 400 naming the value; identity query
  parameters (`?user_id=` etc.) → 400 naming the field;
  one `api.mobile.summary_read` audit row per call.

## 5. Verification

### Automated (local)

- **Vitest: 574/574 (64 files)** — baseline 496 + 78 new,
  zero regressions, all pre-existing test files
  unmodified. New suites:
  `lib/api/handlers/session.test.ts` (10),
  `lib/profile/ensure-profile.test.ts` (5),
  `lib/api/handlers/risk.test.ts` (9),
  `lib/api/handlers/reviews.test.ts` (5),
  `lib/api/handlers/notifications.test.ts` (6),
  `lib/discipline/notification-read.test.ts` (5),
  `lib/api/handlers/coach.test.ts` (5),
  `lib/coach/backtesting.test.ts` (5),
  `lib/api/handlers/trades-m2.test.ts` (15),
  `lib/trades/service-m2.test.ts` (8),
  `lib/api/handlers/summary.test.ts` (5).
  Coverage mirrors M1 per endpoint: 401 (null-actor
  audit), identity smuggling → 400 naming the field with
  NO write, unknown key → 400 naming it, schema-invalid →
  the web's exact message, cross-user → byte-identical
  404, happy path with side effects (rows, XP,
  notifications, storage calls, both audit layers), plus
  the M2-specifics: bootstrap idempotency + race +
  audit-after-creation ordering probe, weekly-review XP
  idempotency, backtesting XP ladder (repeat 0, raise
  awards only the delta), notifications both/neither 400,
  screenshot trade-mismatch 404.
- **Typecheck** (web + @itg/calc + mcp-server): pass.
- **Lint**: pass. **Build**: pass — route table grows to
  18 `/api/mobile` routes; First Load JS unchanged
  (103 kB).
- **security:check**: pass (331 files scanned).
- **Playwright** (`CI=true`, fresh production server):
  **36/36**.

### Local production-build smoke (live Supabase, TEST ACCOUNT ONLY)

Production build served locally with live env; the test
account (`itg-verification-test-20261027@example.com`)
was signed in via an admin-minted magic-link session
(service-role key stayed local; no password was used or
changed). Baselines read via SQL first (risk rules
1% / 200 / 5 / 3 / 20×; XP 320 over 18 rows; week
aggregates 8 closed trades / +3702.5 / 7 wins):

- (a) `POST /api/mobile/session` ×2 → both
  `200 { created: false, onboarding_complete: true }` —
  the standing account has a profile, so the profile-less
  path is proven by the unit tests (insert payload,
  idempotency, race, audit-after-creation) and is the
  parent's later production proof with a throwaway
  account. `api.mobile.session_bootstrap` audit rows: 2.
- (b) `PUT /api/mobile/risk-rules` with the account's
  CURRENT values → `200 { ok: true }`; SQL after: values
  unchanged (1 / 200 / 5 / 3 / 20) — no state change.
- (c) `POST /api/mobile/backtesting` for fresh date
  2026-10-08, 1 session → `{ sessions: 1,
  sessions_awarded: 1, xp_awarded: 15 }`; repeat →
  `xp_awarded: 0`. SQL after: XP 320 → **335** (18 → 19
  rows, exactly +15 once); `daily_activity` row
  2026-10-08 = 1 session; `api.mobile.backtesting_logged`
  audit rows: 2.
- (d) `GET /api/mobile/summary?range=week` → 200,
  `period 2026-10-26 → 2026-11-01`, `tradesCount 8`,
  `totalPnl 3702.5`, `wins 7`, `winRate 87.5` — exactly
  the SQL aggregates. `range=month` → 2026-10-01 →
  2026-10-31, same aggregates (all 8 trades are this
  week's). `range=year` → 400 naming the value;
  `?user_id=` → 400 naming the field; no token → 401.
  `api.mobile.summary_read` audit rows: 5 (4 authenticated
  outcomes + 1 null-actor unauthenticated).

Ezat's own account was not touched by the smoke.

## 6. Deviations & notes

- The Stage 2 regression guard (`lib/gamification/
  xp.test.ts`) greps `lib/coach/actions.ts` for the
  `deterministicUuid(\`backtest:…\`)` mapping. The mapping
  moved with the code into `logBacktestingCore`; the test
  passes unmodified because the action now carries a
  comment naming the exact mapping and where it lives.
  The guard's forbidden pattern (raw key as
  `sourceRefId`) exists nowhere.
- `saveTradingPlanCore`'s insert selects the new id back
  (`.select("id").single()`) to return `plan_id`; the
  write itself is identical to the action's.
- The screenshot upload endpoint intentionally does not
  stack the API-layer rate limit on top of the core's
  upload limiter (one limiter per operation, as M1 split
  them); cancel/delete/session and all JSON writes use
  the API-layer limiter.
- Deployment and the production profile-less proof
  (throwaway account bootstrap → first write) are the
  parent's completion-gate steps, per the M2 split.

## Production addendum (2026-10-30)

Deployed `dpl_3HgYs2EpsvqkXdQH4FmYogu7jKjg` READY (production). Independent production verification: **PASS on every check, no failures, no skipped items.**

- **Profile-less bootstrap (the M1-finding closure):** throwaway account B created with no `profiles` row → `POST /api/mobile/session` → 200 `created:true` → repeat → `created:false` → B's first `POST /api/mobile/trades` → **201** (generic 422 pre-M2), server-computed pnl/roi, exactly +10 XP `trade_journal` → audit rows `api.mobile.session_bootstrap` + `api.mobile.trade_created` + `trade.created` present from B's first call (the audit-FK failure mode is gone). B deleted afterward; full FK cascade, zero residue, auth users back to 2.
- **Spoofing/auth:** identity fields in session/trade bodies → 400 naming the field; no/garbage token → 401.
- **Isolation:** B's summary shows only B's data; B acting on A's trade/screenshot/notification → 404 byte-identical to nonexistent ids.
- **Six write groups on the test account:** risk rules + plan round-trip unchanged (200s, SQL-identical); weekly review for 2026-10-19 → +30 XP once, repeat 0; backtesting 2026-10-07 → +15 XP once, repeat 0; screenshot upload → private bucket (unsigned URL 400), cross-user delete 404, owner delete 200 with row+object gone; open-trade cancel → `cancelled`, closed-trade cancel → 422 with the web's exact reversal message; notifications single → updated:1, all → updated:10, both/neither keys → 400.
- **Summary endpoint:** week and month aggregates match SQL mirrors of `getReportSummary` exactly (8 trades / 3702.500000 / 7 wins); invalid range 400; identity param 400 naming it.
- **Regression:** `/` 200 with all six security headers, `/login` 200, `/dashboard` signed-out 307; Phase 20 `POST /api/internal/coach-insights` 200 with figures cross-matching the summary endpoint and SQL; M1 `PATCH /api/mobile/profile` 200 unchanged echo.
- **Noted shared-core behaviors (web parity, not defects):** a repeat weekly review re-sends its completion notification while awarding 0 XP; creating an open trade earns the +10 `trade_journal` XP, exactly as the web flow does.
- Test account after verification: 10 trade rows (8 closed, 1 reversed, 1 cancelled), XP 390. Ezat's account verified untouched (0 trades, 0 goals) at start and end.

# Phase 21 — Mobile M1: authenticated write API extraction

Status: implemented (this document is the phase record; test
evidence at the end). No mobile UI, no migrations, no new
dependencies. Production behaviour of every existing web
Server Action is preserved — the actions are now thin
adapters over the same service cores the mobile API calls.

## 1. Hour 1 audit — the existing write architecture

Every write in the app is a Next.js Server Action. The
pattern is uniform: Zod parse → session user
(`supabase.auth.getUser()` on the cookie client) → queries
scoped `.eq("user_id", userId)` on the RLS client →
side-effect engines that write through the service-role
client because their tables have no client INSERT policy
(`xp_transactions`, `risk_events`, `discipline_events`,
`notifications`, `audit_logs`, `ai_insights`). Calculated
values are never accepted from the client: trade metrics
come from `computeTradeMetrics` (@itg/calc), levels from
the gamification engine, coach insights from the Phase 20
coach service.

| Operation | Server action (file) | Validation | Calculation source | Auth / RLS | XP / achievement side effects | Audit |
|---|---|---|---|---|---|---|
| Create trade | `createTradeAction` (lib/trades/actions.ts) | `quickTradeSchema` | `computeTradeMetrics`; risk via lib/risk engine + queries | session; inserts scoped by `user_id`, RLS | +10 XP `trade_journal`; risk-discipline streak +25 XP; `refreshGamification` → achievement/level notifications | `trade.created`; risk events on breach (critical blocks the save) |
| Advanced review | `saveAdvancedReviewAction` (lib/trades/actions.ts) | `advancedReviewSchema` | none (review fields, psychology, lessons) | session; trade fetched `.eq("id").eq("user_id")` | none directly; Phase 20 coach trigger on closed trades | `trade.review_saved` |
| Correct trade (reversal) | `correctTradeAction` (lib/trades/actions.ts) | `tradeId` + `quickTradeSchema` | `computeTradeMetrics` | session; original fetched scoped | none (new trade row carries no journal XP) | `trade.corrected` |
| Cancel trade | `cancelTradeAction` (lib/trades/actions.ts) | `tradeId` text | none | session; only `open` trades | none | `trade.cancelled` |
| Upload trade screenshot | `uploadScreenshotAction` (lib/trades/actions.ts) | file type/size (5 MB) inline | OCR status fixed `not_applicable` (no OCR connected) | session; trade fetched scoped; Storage `trade-screenshots` per-user path | none | `trade.screenshot_uploaded` |
| Delete screenshot | `deleteScreenshotAction` (lib/trades/actions.ts) | ids as text | none | session; row fetched scoped | none | none |
| Update profile | `updateProfileAction` (lib/auth/actions.ts) | `profileEditSchema` | none | session; `profiles.update().eq("id", user.id)` | none | `profile.updated` |
| Upload avatar | `uploadAvatarAction` (lib/auth/actions.ts) | shared `lib/profile/avatar-validation.ts` (image, ≤2 MB) | none | session; Storage `avatars` path `{userId}/avatar-{ts}.{ext}` | none | none (unchanged) |
| Create goal | `createGoalAction` (lib/discipline/actions.ts) | `goalSchema` | none | session; insert scoped | none | `goal.created` |
| Record goal progress | `recordGoalProgressAction` (lib/discipline/actions.ts) | `goalProgressSchema` | none (per-day upsert) | session; goal fetched via `getGoalById` (scoped, `deleted_at` null) | goal-reached notification (no XP) | none (unchanged) |
| Update goal status | `updateGoalStatusAction` (lib/discipline/actions.ts) | `goalStatusSchema` | none | session; goal fetched scoped | on `completed`: +20 XP `daily_goal`, `refreshGamification` → achievement/level notifications, completion notification | none (unchanged) |
| Mark notification read / all read | `markNotificationReadAction`, `markAllNotificationsReadAction` (lib/discipline/actions.ts) | id as text | none | session; update scoped by `user_id` | none | none |
| Save risk rules / trading plan | `saveRiskRulesAction`, `saveTradingPlanAction` (lib/risk/actions.ts) | lib/risk/validation.ts | risk engine defaults | session; scoped | none | risk actions write their own rows |
| Resolve risk event | `resolveRiskEventAction` (lib/risk/actions.ts) | id as text | none | session; scoped | none | — |
| Save weekly review | `saveWeeklyReviewAction` (lib/reviews/actions.ts) | lib/reviews/validation.ts | weekly aggregates via reports queries | session; scoped | +30 XP weekly review path | review actions write their own rows |
| Refresh coach analysis | `refreshCoachAnalysisAction` (lib/coach/actions.ts) | `refreshCoachSchema` | Phase 20 coach service (single source) | session | none (refresh never awards XP) | via coach service path |
| Log backtesting session | `logBacktestingSessionAction` (lib/coach/actions.ts) | `backtestingSchema` | deterministic UUID idempotency (Stage 2 fix) | session | +15 XP / session `backtest_session` | — |
| Onboarding steps / complete | lib/auth/actions.ts | `onboardingStepSchemas` | profile column mapping | session | none | `onboarding.step_saved`, `onboarding.completed` |
| Auth (sign in/up/out, reset) | lib/auth/actions.ts | lib/auth/validation.ts | — | Supabase Auth itself | none | `auth.*` |
| Admin writes | lib/admin/actions.ts | lib/admin/validation.ts | — | admin role check (RBAC) | none | admin audit |

Side-effect engines (never endpoints themselves):
`awardXp` / `refreshGamification` (lib/gamification),
`logRiskEvent` (lib/risk/actions.ts), `createNotification`
/ `logDisciplineEvent` (lib/discipline/actions.ts),
`writeAuditLog` (lib/auth/audit.ts), and the Phase 20
coach trigger inside the trade actions. All of them create
their own service-role client internally — the cores call
them exactly as the actions did.

## 2. The M1 boundary

M1 extracts the operations a mobile client needs first —
the journal write path, the profile, and goals — onto a
shared service layer, and exposes them as token-
authenticated JSON endpoints that call the SAME cores as
the web actions. One source of truth per operation:

```
Web form ──► Server Action (adapter: session + FormData) ──┐
                                                           ├──► service core ──► engines
Mobile ────► /api/mobile/* (adapter: Bearer token + JSON) ─┘        (XP, risk,
                                                                    audit, coach)
```

Extracted in M1:

| Core | File | Web adapter | Mobile endpoint |
|---|---|---|---|
| `createTradeCore` | lib/trades/service.ts | `createTradeAction` | `POST /api/mobile/trades` |
| `saveAdvancedReviewCore` | lib/trades/service.ts | `saveAdvancedReviewAction` | `POST /api/mobile/trades/[id]/review` |
| `correctTradeCore` | lib/trades/service.ts | `correctTradeAction` | `POST /api/mobile/trades/[id]/correct` |
| `updateProfileCore` | lib/profile/service.ts | `updateProfileAction` | `PATCH /api/mobile/profile` |
| `uploadAvatarCore` | lib/profile/service.ts | `uploadAvatarAction` | `POST /api/mobile/profile/avatar` (multipart, field `file`) |
| `createGoalCore` | lib/discipline/service.ts | `createGoalAction` | `POST /api/mobile/goals` |
| `recordGoalProgressCore` | lib/discipline/service.ts | `recordGoalProgressAction` | `POST /api/mobile/goals/[id]/progress` |
| `updateGoalStatusCore` | lib/discipline/service.ts | `updateGoalStatusAction` | `PATCH /api/mobile/goals/[id]` |

Each core takes `(supabase, userId, input)` — the caller's
RLS-scoped client and the token/session-derived user id —
validates with the EXISTING Zod schema, and returns a
discriminated result:
`{ ok: true, … } | { ok: false, code, error }` with
`code ∈ invalid_input | rate_limited | not_found |
business | save_failed` and `error` carrying the exact
message string the web form shows today. All side effects
(risk events, XP, gamification, notifications, audit,
Phase 20 coach trigger) live inside the cores, in the same
order as before, so both adapters inherit them unchanged.

Web adapters keep their current order of visible outcomes
(not-configured → form parse → session → core →
revalidate/redirect/message), their exact signatures, and
their exact result shapes. No component changed.

## 3. API security model (mirrors Phase 20)

Implemented in `lib/api/auth.ts` + handlers in
`lib/api/handlers/*.ts` (injectable deps, unit-tested with
the fake Supabase client; `app/api/mobile/**/route.ts`
files are thin adapters):

- **Auth:** `Authorization: Bearer <Supabase access
  token>` required. The token is validated with
  `auth.getUser()` on an anon-key client carrying the
  caller's JWT — the same construction as the Phase 20
  internal endpoint. Identity comes from the validated
  token ONLY. Missing/invalid → `401 { error:
  "unauthenticated" }`.
- **Identity smuggling:** a body containing `user_id`,
  `tenant_id`, `profile_id`, `userId` or `tenantId` →
  `400` naming the field, and no write is performed.
  Unknown top-level keys → `400` naming the key (strict,
  same spirit as the MCP argument rejection).
- **Bodies:** JSON only (avatar excepted — multipart),
  capped at 64 KB; malformed JSON → `400`. Path ids and
  body ids must be UUIDs → `400` otherwise.
- **Isolation:** every core read/write is scoped by the
  token user's id AND runs on the RLS client. A resource
  that does not exist OR belongs to another trader →
  `404 { error: "not_found" }` — identical either way, no
  existence oracle.
- **Status mapping:** 401 unauthenticated; 400
  `invalid_argument` (identity fields, unknown keys, bad
  UUID, malformed JSON, Zod validation — with the existing
  first-Zod-error message); 404 `not_found`; 422
  `validation_failed` (business-rule and save failures,
  with the exact message the web shows); 429
  `rate_limited`; 500 `internal` (sanitized, no detail).
- **Rate limits:** per-user API limit 60 writes/minute
  per operation, in addition to the in-core limits that
  already existed (trade creation 30/10 min, uploads
  10/10 min — unchanged).
- **Audit:** the cores write the same audit rows the
  actions always wrote (`trade.created`,
  `trade.review_saved`, `trade.corrected`,
  `profile.updated`, `goal.created`). The API layer adds
  exactly ONE extra row per call —
  `api.mobile.<operation>` (e.g. `api.mobile.trade_created`)
  with the outcome in `details` — for API observability,
  mirroring Phase 20's `internal.*` rows. Unauthenticated
  calls are audited with a null actor.
- **Secrets:** no service-role key ever reaches a client;
  the service-role client is constructed only by the
  existing server module and used only by the existing
  server-side engines, exactly as before. Middleware
  already bypasses page protection for `/api/*` (Phase
  20); the endpoints authenticate themselves.

## 4. Endpoint catalog

All request bodies use the same camelCase field names the
web forms submit (the Zod schema field names). All
responses are bounded projections.

### POST /api/mobile/trades → 201
Body: `quickTradeSchema` fields — `pair`, `direction`
(`long|short`), `entryPrice`, `exitPrice|null`, `tp|null`,
`sl`|null`, `positionSize`, `strategyId?` (uuid|null),
`leverage`, `fees?`, `openedAt`, `closedAt|null`.
Response: `{ trade: { id, pair, direction, status, pnl,
roi_pct, r_multiple, opened_at, closed_at } }` — metrics
are the server-computed values from the stored row.

### POST /api/mobile/trades/[id]/review → 200
Body: `advancedReviewSchema` fields minus `tradeId`
(the id is the path): `strategyId`, `setupName`,
`marketCondition`, `tradeReason`, `session`, `confidence`,
`emotion`, `discipline`, `lesson`, `notes` (all nullable).
Response: `{ trade_id }`.

### POST /api/mobile/trades/[id]/correct → 201
Body: the quick-trade fields (same as create). The
original trade id is the path.
Response: `{ trade_id, reversed_trade_id }` — the new
correcting trade and the original it reversed.

### PATCH /api/mobile/profile → 200
Body: `profileEditSchema` fields — `fullName`,
`fatherName`, `dateOfBirth`, `country`,
`tradingExperience`, `tradingEducation`,
`backtestingExperience`, `backtestedTrades`,
`realTradingExperience`, `realTradesCount`, `demoTrading`,
`employmentStatus`, `monthlyIncome`, `tradingCapital`,
`tradesRealMoney`.
Response: `{ profile: { …the columns the update writes… } }`.

### POST /api/mobile/profile/avatar → 200
Multipart form-data, field `file`. Same rules as the web
(shared avatar validation: image, ≤ 2 MB), same Storage
path scheme `{userId}/avatar-{ts}.{ext}` in the `avatars`
bucket. Response: `{ avatar_url }`.

### POST /api/mobile/goals → 201
Body: `goalSchema` fields — `title`, `period`
(`daily|weekly|monthly|yearly`), `goalType`, `targetValue`,
`targetUnit`, `startDate`, `endDate`.
Response: `{ goal: { id, title, period, goal_type,
target_value, target_unit, start_date, end_date, status } }`.

### POST /api/mobile/goals/[id]/progress → 200
Body: `{ currentValue, note }`. Response:
`{ goal_id, current_value }`.

### PATCH /api/mobile/goals/[id] → 200
Body: `{ status }` (`active|completed|paused|failed`).
Response: `{ goal_id, status }`. Completing a goal runs
the same XP/notification side effects as the web.

Error body (all endpoints): `{ error: <code>, message? }`
with codes `unauthenticated`, `invalid_argument`,
`not_found`, `validation_failed`, `rate_limited`,
`internal`.

## 5. Deferred to M2 (with reasons)

- **Risk rules + trading plan** (`saveRiskRulesAction`,
  `saveTradingPlanAction`, `resolveRiskEventAction`) —
  settings surface, not needed for the M2 read-only +
  journal-first client; the write path is more sensitive
  (it gates trade creation) and deserves its own review
  pass rather than riding along with M1.
- **Weekly review** (`saveWeeklyReviewAction`) — a
  composed, once-a-week flow tied to the reports surface;
  mobile M3 territory per the spec's phase split.
- **Trade screenshots** (upload/delete) — binary upload
  flows need the mobile client's file-picker/camera
  contract decided first (M3); avatar upload in M1 proves
  the multipart pattern against the same Storage model.
- **Cancel trade** (`cancelTradeAction`) — a
  redirect-style void action with no form result; low
  mobile value in M1 and safer to expose alongside the
  correction flow review in M2.
- **Notifications mark-read** — trivially extractable but
  useless until the mobile client renders notifications
  (M2 read surface); extracting it now would add an
  unaudited-by-usage endpoint.
- **Backtesting log** (`logBacktestingSessionAction`) —
  XP-bearing with the deterministic-UUID idempotency
  contract; kept web-only until M2 so its idempotency is
  re-verified against the API shape deliberately, not by
  accident.
- **Coach refresh** — already callable via the Phase 20
  internal endpoint pattern; the mobile client reads
  `ai_insights`, and refresh stays server-triggered
  (trade-close) or web-manual.
- **Onboarding + auth actions** — Supabase Auth is used
  directly by the mobile client (spec §3); onboarding
  extraction is an M2 decision.

## 6. Test evidence

Baseline before M1: **447/447 Vitest, 36/36 Playwright.**
After M1: **496/496 Vitest (+49 new), 36/36 Playwright**,
typecheck clean (web + calc + MCP), lint clean, production
build clean (38 routes incl. the 8 new `/api/mobile/*`
routes), `security:check` passed (278 files scanned).

New test files (fake-Supabase + injected handler deps):

- `lib/trades/service.test.ts` (9) — create/review/correct
  cores: closed-trade metrics from `@itg/calc`
  (2000→2010 × 100 → P&L 1000, ROI 0.5 %, R 2), XP +
  streak path, `trade.created` / `trade.review_saved` /
  `trade.corrected` audits, coach-insight refresh on a
  closed trade, critical risk breach blocking with the
  legacy message, open trade → null metrics and no coach
  refresh, cross-user review/correct → `not_found` with
  no writes, reversed-trade review refusal message.
- `lib/profile/service.test.ts` (4) — profile update
  writes + `profile.updated` audit, empty-name rejection
  with the schema message, avatar upload to
  `{userId}/avatar-{ts}.{ext}` + `profiles.avatar_url`
  update, missing/non-image file messages.
- `lib/discipline/service.test.ts` (6) — goal create +
  `goal.created` audit, date-range schema rejection,
  progress upsert + goal-reached notification,
  cross-user progress/status → `not_found`, completion →
  +20 XP (`daily_goal`) + notification, non-completion
  status change with no XP.
- `lib/api/handlers/trades.test.ts` (13),
  `lib/api/handlers/profile.test.ts` (7),
  `lib/api/handlers/goals.test.ts` (10) — per endpoint:
  no token 401; invalid token 401; smuggled identity field
  → 400 naming the field with NO write; malformed JSON
  400; unknown top-level key 400 naming it; invalid path
  UUID 400; zod-invalid body 400 with the existing schema
  message; business failure 422 with the legacy message;
  rate limit 429; happy path writes scoped to the TOKEN
  user (the other user's fixture rows untouched and never
  leaked); cross-user resource id → 404
  `{ error: "not_found" }` byte-identical to a nonexistent
  id (no existence oracle), no write; exactly one
  `api.mobile.*` audit entry per call with the right
  operation/outcome.

**No existing test file was modified.** All pre-existing
action-level tests (including the Phase 20 coach-trigger
tests in `lib/trades/actions.test.ts`) pass unmodified
against the refactored adapters. The fake Supabase helper
was extended additively (recorded `update`/`upsert`
support); no existing fake behaviour changed.

## 7. Local production-build smoke

Run 2026-10-30 against the locally built app
(`next start`, port 3210) with live Supabase env, using
the verification test account only:

1. `POST /api/mobile/trades` with no token →
   `{"error":"unauthenticated"}`.
2. Password-grant token acquired for the test account.
3. Same POST with the token plus a smuggled `user_id` →
   400 `invalid_argument`, message naming `user_id`.
4. Same POST with the token, clean body (XAUUSD long
   2000→2010, size 100) → **HTTP 201**, response
   `pnl 1000, roi_pct 0.5, r_multiple 2` — exactly the
   `@itg/calc` result, matching the fake-based tests.
5. DB cross-check (Management API): the trade row exists
   in production Supabase with `pnl 1000.000000`,
   `roi_pct 0.500000`, `r_multiple 2.000000`,
   `status closed` (trade id
   `06426040-a727-45bc-99d7-176a9c8ca3a5`, on the test
   account, opened 2026-10-28), and exactly three
   `api.mobile.trade_created` audit rows exist — one per
   smoke call (the success carries the trade id; the 401
   and 400 calls carry a null entity, as designed).

Note for the production-verification pass: the test
account now has this one additional closed trade in the
week of 2026-10-26 from the smoke.

## Production verification addendum (2026-10-30, post-deployment)

Deployment `dpl_FidpTzmAT8uZ2UzQpsuFaCu6sqfJ` (READY,
production). Verified live on the test account + a throwaway
isolation account (created, used, deleted; Ezat's account
untouched, 0 trades / 0 goals):

- Security: no token → 401 JSON; smuggled `user_id` → 400
  naming the field, no write; malformed JSON → 400; unknown
  top-level key → 400 naming the key; wrong-typed field → 400
  with the shared schema message.
- Happy paths: trade create → 201, pnl 1000.000000 /
  roi 0.500000 exactly per @itg/calc, one trade.created +
  one api.mobile.trade_created audit, exactly +10 XP
  (trade_journal, source = the trade id); review → 200 with
  psychology/lesson persisted; goals create/progress/status
  → 201/200/200; profile PATCH → 200 persisted; avatar JPEG
  → 200 + profiles.avatar_url updated, .txt → 400 with the
  shared avatar-validation message; correction → 201,
  original reversed, correcting trade pnl 1200.000000, no XP
  (web parity).
- Isolation: B's review/correct on A's trade and PATCH on
  A's goal → 404 byte-identical to a nonexistent id (no
  oracle); A's rows unchanged; B's own create → 201 owned
  by B; B + A's user_id in body → 400; B deleted after.
- Web regression: Add Trade via the real UI (Save Trade by
  accessible name) → ?saved=1, session intact; coach Refresh
  → exact up-to-date message; sweep of
  dashboard/trades/analytics/profile/goals → 200, zero page
  errors. Week insights 18 → 37 from the Phase 20 trigger
  firing on API/UI closed-trade changes; manual refresh
  inserted 0 (idempotency holds across both surfaces).
- Audit reconciliation: 22 API calls logged; api.mobile.*
  rows 3 → 19 = exactly the 16 calls from identities with a
  profiles row, one per call with correct outcomes.

### Finding for M2 — profile-less identities

A throwaway account that never entered the app has no
`profiles` row; its write calls fail the trades→profiles FK
and surface a generic 422 ("Could not save the trade"), and
its `api.mobile.*` audit inserts are rejected by the same
FK (the Stage 3 audit wrinkle, now on the write path). Real
web users always have a profile (created on first login).
M2 requirement: the mobile signup/onboarding flow must
ensure the profile row exists before the first write —
e.g. an authenticated `POST /api/mobile/session` bootstrap
that reuses the web's profile-creation path — and the API
should return a distinct, client-actionable error for this
state instead of the generic save failure.

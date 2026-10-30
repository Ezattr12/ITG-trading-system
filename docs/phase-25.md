# Phase 25 — Mobile Write Activation

**Status: implemented and verified locally (2026-10-30). Client-only
phase: nothing under `apps/web` changed, no deployment, no commit in
this phase (the parent runs the completion gate).**

The Expo shell from Phase 21 M2 was read-only. Phase 25 activates the
write workflows in `apps/mobile`, all through the M1/M2 `/api/mobile`
endpoints with the session Bearer token (identity is derived
server-side from the token; no request body ever contains an identity
field — the API rejects `user_id` / `tenant_id` / `profile_id` /
`userId` with a 400 naming the field).

Rules held throughout:

- **Server-confirmed state only.** Success UI appears only after the
  endpoint resolves; lists and forms re-read from RLS after writes.
  No optimistic financial figures anywhere.
- **Server errors verbatim.** `src/api.ts` throws the endpoint's
  `{ message }` (the web core's exact wording, e.g. a 422 validation
  message) and every form shows it unchanged.
- **No client-side financial calculations.** The app converts text →
  number and text → ISO timestamp at submit time and displays
  stored/server-returned values. P&L, R, ROI, status, XP and goal
  state are all computed by the server cores. (`mondayOfWeek` /
  `shiftDate` in `src/forms.tsx` are calendar helpers for the weekly
  review picker, not financial math.)
- **Double-submit protection.** Every submit is single-flight
  (`submitting` state + spinner + disabled button in `SubmitBar`).
- **Client validation is presence/format only** — the web Zod schema
  behind each endpoint is authoritative and its messages win.
- **ITG glass tokens only** (`src/theme.ts`); Long uses the profit
  green treatment, Short the loss red treatment, as on web.
- **Biometric gate and session handling unchanged.**

## 1. Workflows activated

| # | Workflow | Where |
| --- | --- | --- |
| 1 | Add Trade | Trades tab → "Add trade" → `app/(app)/trade/new.tsx` (shared `src/trade-form.tsx`) |
| 2 | Close Trade (open trades) | Trade detail → "Close trade" → `app/(app)/trade/[id]/close.tsx` |
| 3 | Correct Trade | Trade detail → "Correct trade" → `app/(app)/trade/[id]/correct.tsx` |
| 4 | Cancel Trade (open trades) | Trade detail → "Cancel trade" (two-tap confirm, like web) |
| 5 | Review (journal + psychology) | Trade detail → "Review trade" → `app/(app)/trade/[id]/review.tsx` |
| 6 | Screenshots (add / list / display / delete) | Trade detail "Screenshots" section |
| 7 | Goals: create / progress / status | Goals tab → "New goal" → `goal/new.tsx`; tap a goal → `goal/[id].tsx` |
| 8 | Risk rules + trading plan editors | Profile → "Risk rules & trading plan" → `app/(app)/risk.tsx` |
| 9 | Weekly Review | Coach tab → "Weekly review" card |
| 10 | Backtesting log | Coach tab → "Log backtesting" card |
| 11 | Notifications list + mark-read (single / all) | Dashboard unread link or Profile → `app/(app)/notifications.tsx`; Dashboard unread count reloads on focus |

### Close Trade goes through the correct endpoint — by design

TraderOS has **no in-place trade update**: a trade's financial fields
are never overwritten (the web app follows the same rule — its trade
page shows the pre-filled "Correct this trade" form for open trades
too). Closing an open trade therefore uses
`POST /api/mobile/trades/[id]/correct` with the trade's own stored
values plus the exit price and close time: `correctTradeCore` creates
the closed trade and marks the original open trade `reversed`, with
the `trade.corrected` audit row and the Phase 20 coach refresh firing
exactly as on web. The close screen says this in plain language so
the trader is never surprised by the reversal row.

### The review round-trip (Phase 24 requirement)

`saveAdvancedReviewCore` is a **full-form save**: it overwrites
`strategy_id`, `setup_id` (resolved from the submitted setup NAME),
`market_condition`, `trade_reason`, `session`, `notes`, and upserts
the psychology record with exactly what is sent. The review screen
therefore pre-fills **every** field from the trade + psychology +
setups reads and always sends the complete payload — `strategyId`
round-trips the trade's current strategy and `setupName` round-trips
the name of the trade's current setup. This is the exact failure the
Phase 24 production addendum recorded (a verification payload with
`strategy_id: null` cleared a trade's strategy); the mobile client
now makes that class of mistake impossible by construction, and the
warning is repeated in `apps/mobile/README.md`.

## 2. Contract table — screen → endpoint → fields sent → response used

Payload keys are exactly the handler key allow-lists in
`apps/web/lib/api/handlers/*.ts` (unknown keys → 400); nullable
schema fields are sent explicitly as `null`, never omitted.

| Screen | Endpoint | Fields sent | Response used |
| --- | --- | --- | --- |
| Add Trade | `POST /api/mobile/trades` | `pair, direction, entryPrice, exitPrice, tp, sl, positionSize, strategyId, leverage, fees, openedAt, closedAt` | 201 `{ trade: { id, … } }` → navigate to `trade/{id}` |
| Close Trade | `POST /api/mobile/trades/[id]/correct` | same 12 quick-trade fields, pre-filled from the trade, exit + close time entered | 201 `{ trade_id, reversed_trade_id }` → navigate to `trade_id` |
| Correct Trade | `POST /api/mobile/trades/[id]/correct` | same 12 fields, full-form pre-filled | 201 `{ trade_id, reversed_trade_id }` → navigate to `trade_id` |
| Cancel Trade | `POST /api/mobile/trades/[id]/cancel` | `{}` (empty body, as the handler requires) | 200 `{ trade_id, status }` → back to Trades list |
| Review | `POST /api/mobile/trades/[id]/review` | `strategyId, setupName, marketCondition, tradeReason, session, confidence, emotion, discipline, lesson, notes` | 200 `{ trade_id }` → back to trade detail (re-read) |
| Screenshot add | `POST /api/mobile/trades/[id]/screenshots` (multipart) | form field `file` (picked image) | 201 `{ screenshot_id }` → re-read list |
| Screenshot list/display | RLS read of `trade_screenshots` + `supabase.storage.from("trade-screenshots").createSignedUrl(path, 3600)` — the same signed-URL mechanism the web trade page uses; bucket stays private | — | stored rows + signed URLs |
| Screenshot delete | `DELETE /api/mobile/trades/[id]/screenshots/[screenshotId]` | — | 200 `{ ok: true }` → re-read list |
| Goal create | `POST /api/mobile/goals` | `title, period, goalType, targetValue, targetUnit, startDate, endDate` | 201 `{ goal: { id, … } }` → navigate to `goal/{id}` |
| Goal progress | `POST /api/mobile/goals/[id]/progress` | `current
...[truncated 7906 chars]Value, note` | 200 `{ goal_id, current_value }` → shown verbatim + re-read |
| Goal status ("edit") | `PATCH /api/mobile/goals/[id]` | `status` | 200 `{ goal_id, status }` → shown + re-read |
| Risk rules | `PUT /api/mobile/risk-rules` | `maxRiskPerTradePct, maxDailyLoss, maxTradesPerDay, maxConsecutiveLosses, maxLeverage` | 200 `{ ok: true }` → re-read pre-fill |
| Trading plan | `PUT /api/mobile/risk-plan` | `name, markets, sessions, riskPerTradePct, maxDailyLoss, maxDailyTrades, preferredSetupIds, noTradeConditions, psychologyRules, scheduleNotes` | 200 `{ plan_id }` → re-read pre-fill |
| Weekly review | `POST /api/mobile/reviews/weekly` | `weekStartDate, reviewText, mainMistake, focusNextWeek` | 200 `{ review_id, xp_awarded }` → `xp_awarded` shown verbatim |
| Backtesting | `POST /api/mobile/backtesting` | `activityDate, sessions` | 200 `{ sessions, sessions_awarded, xp_awarded }` → all three shown verbatim |
| Notification mark-read (one) | `POST /api/mobile/notifications/read` | `{ notification_id }` | 200 `{ updated }` → re-read list |
| Notification mark-read (all) | `POST /api/mobile/notifications/read` | `{ all: true }` | 200 `{ updated }` → count shown verbatim + re-read list |

## 3. Endpoint gaps found (for the parent — nothing was faked)

1. **No discipline-event endpoint.** There is no
   `POST /api/mobile/discipline-events` (or equivalent) route, and
   `logDisciplineEvent` (`lib/discipline/service.ts`) is an internal
   engine invoked inside other cores — it has no API surface. A
   standalone "log discipline event" action therefore **cannot** be
   activated in the app without new backend work. Discipline coverage
   that DOES exist in Phase 25: the discipline rating inside the
   trade review (stored psychology), goals, and the server-computed
   discipline % in the summary. If a discipline-event endpoint is
   wanted, it needs a Phase-21-style core extraction on the web side.
2. **Goal field editing does not exist.** `PATCH
   /api/mobile/goals/[id]` accepts `{ status }` only
   (`goalStatusSchema`). There is no endpoint to edit a goal's title,
   period, type, target or dates after creation, so the app's goal
   "edit" is the status change; the goal screen says so in plain
   language. (Deleting/recreating a goal is also not exposed: goal
   deletion is a web-side soft-delete with no mobile route.)
3. **Profile edit + avatar endpoints exist but were out of scope.**
   `PATCH /api/mobile/profile` and `POST /api/mobile/profile/avatar`
   (M1) were not in this phase's workflow list and were not
   activated — noted so the omission is a decision, not an oversight.

## 4. Deviations from the brief (schema-forced)

- **Add Trade has no Session field.** The brief listed session among
  the Add Trade fields, but `quickTradeSchema` does not accept a
  `session` key — sending one is an unknown-key 400. On web, session
  is likewise set by the advanced review, not at creation. The
  mobile Add Trade form mirrors the schema exactly; session is
  editable in the Review form.
- **Date/time entry is text-based** (YYYY-MM-DD + HH:MM fields,
  composed to ISO at submit). `@react-native-community/datetimepicker`
  would have been a second new dependency; the brief allowed only
  `expo-image-picker` unless blocked. Text entry with format checks
  keeps the dependency rule and the 30–60-second entry target.
- **Cancel Trade was activated in addition to the listed
  workflows**: the endpoint shipped in M2, the web trade page offers
  the same action for open trades, and an open trade otherwise had
  no void path in the app.

## 5. New / changed files

- `src/api.ts` — one helper per write endpoint + a multipart upload
  path (no JSON Content-Type; fetch sets the boundary).
- `src/types.ts` — row types (strategies, setups, screenshots,
  notifications, risk rules, trading plan, weekly review) and the
  payload/response contracts mirroring the web Zod schemas.
- `src/forms.tsx` (new) — glass form primitives (fields, chip
  selects, date/time fields, error/success lines, single-flight
  SubmitBar) + format-only parsing/calendar helpers.
- `src/options.ts` (new) — picker options whose values/labels mirror
  the web validation label maps.
- `src/trade-form.tsx` (new) — the shared quick-trade form (Add /
  Close / Correct), with the ITG Long/Short treatments and the
  strategy picker from RLS reads.
- `src/components.tsx` — `PrimaryButton` gains a `loading` state
  (spinner + blocked presses); no visual change otherwise.
- Routes (new): `trade/new`, `trade/[id]/close`,
  `trade/[id]/correct`, `trade/[id]/review`, `goal/new`,
  `goal/[id]`, `risk`, `notifications` — all registered `href: null`
  in `(app)/_layout.tsx` (reachable from parent screens, not tabs).
- Extended: `trades` (Add button + focus reload), `trade/[id]`
  (actions card, full screenshots section, focus reload), `goals`
  (New goal + tap-through + focus reload), `goal/[id]`, `coach`
  (weekly review + backtesting cards), `index` (unread count →
  Notifications, focus reload), `profile` (Risk & plan /
  Notifications entry points).
- `app.json` — `expo-image-picker` config plugin with the photo
  permission string.

## 6. Verification performed (sandbox, 2026-10-30)

- Baseline before changes: root `npm test` — **704/704 green**.
- `npx tsc --noEmit` in `apps/mobile` — **clean**.
- `npx expo export --platform android` — **succeeded** (Hermes
  bundle + `metadata.json` in `apps/mobile/dist/`, which is
  gitignored).
- Root `npm test` after changes — **704/704 green** (mobile stays
  outside the Vitest globs; no web file was touched).
- Payload audit: every constructed body was diffed against the
  handler allow-lists in `apps/web/lib/api/handlers/*.ts` (§2);
  a grep confirms no identity field appears in any request body.
- NOT verified: on-device behavior (no emulator/device in the
  sandbox — same limitation as M2; first device run is Ezat-side
  via Expo Go with a local `.env`). The endpoints themselves were
  production-verified in Phases 21 M1/M2; the parent gate can
  replay the app's exact payloads from §2 against production on
  the verification account.

## Production verification addendum (2026-10-30)

No web code changed in this phase, so there was nothing to deploy — production remains `dpl_4A3EXAf2Gs8eaYsy2oipGxZAAuxk`. Verification therefore replayed the app's EXACT payload shapes (the §2 contract table) against the live production endpoints on throwaway accounts (created, bootstrapped via `POST /api/mobile/session`, fully deleted after; auth users back to 2, test account A byte-identical at 10 trades / XP 390, Ezat untouched).

**Result: 20/20 checks PASS** — session bootstrap (created:true), Add Trade 201 with server-computed pnl 1000, review 200, screenshot upload 201 + delete 200, open trade 201, close-via-correct 201 (original reversed, correcting trade returned), cancel 200, goal create/progress/complete 201/200/200, risk rules 200, risk plan 200, weekly review +30 XP then +0 on repeat (idempotent), backtesting +15 XP, notifications mark-all 200, summary 200.

**Phase 24 round-trip requirement proven at the database level:** a trade created with strategy BOS was reviewed using the app's review payload (strategyId round-tripped); a direct SQL read afterwards shows `strategy_id` still set to BOS — the Phase 23 clearing incident cannot recur through the mobile client.

Two early replay failures were the replay script's own free-text values (`tradeReason`, `goalType`, `discipline`), not app defects: the app models all three as typed pickers matching the web schemas exactly (`TradeReason`, `GOAL_TYPE_OPTIONS`, `DisciplineName` = good/average/poor), verified in the app source before the corrected run passed 20/20.

**Still not device-verified** (no emulator in the sandbox, same as M2): the payload contracts and endpoint behavior are production-proven; the on-device UI run remains Ezat-side via the apps/mobile README instructions.

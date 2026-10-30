# Phase 26 — Mobile AI Coach

**Status: implemented and verified locally (2026-10-30). No deployment,
no commit in this phase (the parent runs the completion gate).**

Phase 22 shipped the Interactive AI Trading Coach on the web
(`POST /api/coach/chat`, cookie-session auth). Phase 26 gives the
mobile app the same coach: a new Bearer surface,
`POST /api/mobile/coach/chat`, over the **same** handler pipeline and
the **same** chat core — and turns the mobile Coach screen into the
interactive chat, alongside (never instead of) the stored weekly
insights and the Phase 25 review/backtesting forms.

The coach still runs in **deterministic mode** in production (no LLM
key connected yet). Nothing in this phase assumes a mode: the mobile
UI renders whatever the response says — `narration: "deterministic"`
→ "Deterministic analysis" badge; `narration: "llm"` → "AI-narrated ·
<provider>" — so the day a key is connected, mobile narrates with no
app change, through the same Phase 22 hallucination guard.

## 1. Architecture — one pipeline, two auth adapters

```
Web     ──► POST /api/coach/chat        ──► createDefaultCoachChatDeps()
                                              (cookie session resolver)
Mobile  ──► POST /api/mobile/coach/chat ──► createMobileCoachChatDeps(token, apiDeps)
                                              (Bearer token resolver)
                                                        │
                                                        ▼
                                    handleCoachChat (lib/coach/chat-handler.ts)
                                    body contract · identity-field refusal ·
                                    rate limit · ONE audit row · response shape
                                                        │
                                                        ▼
                                    answerCoachQuestion (lib/coach/chat.ts)
                                    17 intents over the trader's own data only
```

The chat handler was built transport-shaped in Phase 22 precisely for
this: session resolution is one injected dependency. Phase 26's only
handler change is factoring the production deps — the shared tail
(audit, rate limit, core, clock) moved into
`createCoachChatDeps(getSession, overrides?)`, and
`createDefaultCoachChatDeps()` (web) is now that factory fed with the
cookie-session resolver. The mobile factory
(`createMobileCoachChatDeps` in `lib/api/handlers/coach-chat.ts`)
feeds the same factory a Bearer resolver built on the M1 pipeline's
`authenticateApiToken`, and routes the rate limit through the API
deps — with the **same bucket key** (`coach-chat:<userId>`) and the
**same preset** (20/minute), so a trader has one allowance across
both surfaces, not two.

No coach logic was copied, no second intent router exists, and the
web endpoint's behavior, messages, and response shape are unchanged
— all 19 pre-existing `chat-handler.test.ts` tests pass unmodified.

### What differs between the surfaces (complete list)

| Aspect | Web | Mobile |
| --- | --- | --- |
| Auth | Cookie session (`auth.getUser()` on the server client) | `Authorization: Bearer <Supabase access token>`, validated by `authenticateApiToken` (M1) |
| Identity source | Session | Validated token — the only source on both |
| Body cap | None at transport (message/history limits bound the payload) | 64 KB (`MAX_JSON_BODY_BYTES`, the M1 cap), enforced by the route before parsing |
| Rate-limit plumbing | `checkPresetRateLimit` called directly | Same limiter via `ApiDeps.rateLimit`, same key + preset |
| Everything else | — identical: validation order + messages, 400/401/429/500 shapes, response body, audit — | |

The 64 KB cap is enforced in the route (a transport concern) and
reported into the handler as `CoachChatInput.bodyError` — a new
optional field the web route never sets. The handler refuses with
400 `invalid_argument` ("request body is too large", the M1
pipeline's wording) and writes its one audit row with a null actor,
exactly like malformed JSON — so the cap cannot be used to bypass
the audit-once rule.

## 2. Endpoint contract — `POST /api/mobile/coach/chat`

Identical to `POST /api/coach/chat` (docs/phase-22.md), with Bearer
auth:

| Aspect | Contract |
| --- | --- |
| Auth | `Authorization: Bearer <access token>`; missing/invalid → `401 { error: "unauthenticated" }` |
| Body | JSON object, ≤ 64 KB: `{ message, history? }` |
| `message` | Required string, non-empty after trim, ≤ 1000 chars → else 400 with the web handler's message |
| `history` | Optional array of ≤ any length of `{ role: "user" \| "assistant", content: string ≤ 2000 }`; the handler keeps the last 6 turns; invalid shapes → 400 |
| Identity fields | `user_id` / `tenant_id` / `profile_id` / `userId` / `tenantId` in the body → `400` naming the field, core never called |
| Unknown keys | Any key other than `message` / `history` → `400` naming the key |
| Rate limit | 20 questions/minute per trader (shared `coach-chat:<userId>` bucket) → `429 { error: "rate_limited" }` |
| Success | `200` with the chat core's answer verbatim: `{ status, intent, facts[], inferences[], recommendations[], evidence{…}, narration, narrationProvider? }` |
| `status` | `"ok"` or `"insufficient_data"` (honest sample minimums — an answer, not an error) |
| Failure | Core throw → sanitized `500 { error: "internal" }` (no internal detail) |
| Writes | None. The chat is read-only: it analyses and never writes, modifies or executes anything |

## 3. Audit decision — one `coach.chat` row per call, on both surfaces

**Decision: the mobile surface writes the same single `coach.chat`
audit row the web surface writes (action `coach.chat`, entity type
`coach_chat`, details exactly `{ outcome, intent, narration }` —
never the message text, never history, never a figure), and writes
NO `api.mobile.*` row.**

Justification:

- **The M1/M2 `api.mobile.*` rows are a transport ledger for write
  endpoints.** Each of those endpoints wraps a state-changing core
  that writes its own domain audit rows inside the core
  (`trade.created`, `goal.created`, …); the `api.mobile.<operation>`
  row is the API layer's one additional observation, and the
  invariant the codebase actually holds is *one row per layer per
  call*. The chat has no core-written domain row to pair with: the
  core (`answerCoachQuestion`) is read-only and writes nothing, and
  the one audit row the feature has ever had is the handler's
  `coach.chat` row — written by the shared handler, which is the
  domain layer here.
- **Exactly one row per call stays true on both surfaces** with a
  single, queryable ledger for all coach usage. Splitting mobile
  questions into `api.mobile.coach_chat` would fragment coach
  reporting across two actions for zero information gain (the rows
  would carry identical details), and wiring both would
  double-count every mobile question.
- **The privacy contract is the handler's**, and it travels with
  the handler: details carry only outcome / intent / narration
  mode. Unauthenticated calls are audited with a null actor, as on
  web. The handler tests pin this: the mobile test suite asserts
  `auditApi` (the `api.mobile.*` writer) is never called, and that
  audit entries contain no message text.

## 4. Mobile app — the Coach screen

`apps/mobile/app/(app)/coach.tsx` is now a three-segment screen
(segmented control under the title; **Ask the coach** is the default
segment):

- **Ask the coach** — the interactive chat:
  - Message list (own layout, not the scrolling page shell):
    messages in a `ScrollView` that scrolls to the latest turn on
    every content change, a pinned composer below, all inside a
    `KeyboardAvoidingView` (iOS `padding` with the tab-header
    offset, Android `height`).
  - User turns: right-aligned glass bubbles. Coach turns: a glass
    card rendering the answer **exactly as structured** — the
    narration-mode badge from the response ("Deterministic
    analysis" vs "AI-narrated · <provider>", plus a "Not enough
    data yet" badge for `insufficient_data` answers, which render
    as ordinary answers, never as errors), then **Facts** /
    **Inferences** / **Recommendations** sections (accent-coloured
    labels: cyan / violet / profit-green, bulleted lines), then
    the evidence line ("Evidence: <scope> · N closed trades ·
    total P&L … · win rate … · profit factor … · average R ….")
    formatted with the app's stored-value formatters.
  - Suggested-question chips (horizontal scroller, disabled while
    a question is in flight): 14 questions, each phrased to land
    on a real intent in the engine's catalog (weakness, last 30
    trades, best strategy, best session, repeated mistakes,
    psychology, discipline trend, drawdown, risk behaviour,
    trading conditions, monthly review, month comparison,
    improvement plan, weekly focus).
  - Composer: multiline input capped at 1000 chars (the server
    cap) + Ask button; single-flight — the input locks and an
    "Analysing your trades…" indicator shows while awaiting, so
    no double-send is possible. Server error messages are shown
    verbatim (`FormError`); the server schema remains
    authoritative.
  - History: the last 6 turns are kept client-side and sent per
    the contract, built exactly as the web chat builds them
    (coach turns carried as their joined section text). **New
    chat** (in the title row, visible once a conversation exists)
    clears turns, input and error.
  - No coach math, no intent logic, no figures computed in the
    app: it sends `{ message, history }` and renders the
    response. (`src/api.ts` gains `askCoach`; `src/types.ts`
    gains the chat contract types mirroring `lib/coach/chat.ts`.)
- **Insights** — the stored weekly `ai_insights` cards, unchanged
  (the Phase 21 M2 surface; its intro card no longer says the
  interactive coach "arrives in the next phase" — it points to the
  Ask segment).
- **Review** — the Phase 25 weekly-review form and backtesting
  log, unchanged.

Supporting change: `Screen` (`src/components.tsx`) gained an
optional `contentStyle` prop (the chat layout needs a `flex: 1`
content container to pin its composer). No existing caller passes
it; all other screens render identically.

## 5. Test evidence

Baseline before Phase 26: **704 Vitest** (root). After: **724/724
passing (72 files)** — +20 new, zero regressions; the 19
pre-existing web `chat-handler.test.ts` tests pass **unmodified**,
pinning the "web byte-identical" requirement.

New: `apps/web/lib/api/handlers/coach-chat.test.ts` (20 tests),
mirroring the web handler tests over the Bearer adapter (fake
Supabase clients per token, the reviews.test.ts `ApiDeps` pattern):

- **Auth:** no token → 401 + one null-actor audit, core never
  called; invalid token → 401; the core is invoked with the
  **token** user (token-b → user B even though the canned data is
  A's test fixture shape).
- **Body contract:** smuggled `user_id` → 400 naming the field
  (+ `tenant_id` / `profile_id` / `userId` / `tenantId` each);
  unknown key → 400 naming it; message of 1001 chars → 400,
  exactly 1000 → 200; invalid history shape → 400; transport
  body error → 400 "request body is too large" with a null-actor
  audit; malformed JSON → 400.
- **Outcomes:** happy path → 200 with the web response shape
  (`{ ...answer }`) and exactly one audit row
  `{ outcome: "ok", intent, narration }`; insufficient-data →
  audited `insufficient_data`; rate-limit denial → 429, core
  never called; core throw → sanitized 500.
- **Audit privacy + the §3 decision:** audit entries have exactly
  the keys `{ userId, outcome, intent, narration }` and contain
  no message text; `auditApi` (the `api.mobile.*` writer) is
  asserted **never called** across the suite.
- **Rate-limit wiring:** the factory routes through the API deps
  with key `coach-chat:<userId>` and preset `{ limit: 20,
  windowMs: 60_000 }` — the web bucket, shared.
- **Real core, token scoping:** with the real
  `answerCoachQuestion`, two traders' same-week trades in one
  table set — token A is answered "Profitable week: 100.00
  across 3 trades" (evidence totalPnl 100, no trace of B's
  figures) and token B "Profitable week: 60.00 across 3 trades"
  (no trace of A's). Figures never cross users.

Other gates, all run 2026-10-30:

- Root `npm run typecheck` (web + calc) — clean.
- Root `npm run lint` — clean.
- Root `npm run security:check` — passed (367 files scanned).
- Root `npm run build` — succeeds; route table contains both
  `ƒ /api/coach/chat` and `ƒ /api/mobile/coach/chat`.
- Mobile `npx tsc --noEmit` — clean.
- Mobile `npx expo export --platform android` — succeeds
  (Hermes bundle ~3.3 MB).
- Not verified here (as in M2/Phase 25): running on a physical
  device / emulator — no device in the sandbox; first device run
  is via Expo Go with a local `.env` (see `apps/mobile/README.md`).

## 6. Deviations

- **One additive handler field**: `CoachChatInput.bodyError`
  (optional; web never sets it) so the mobile route's 64 KB cap
  is refused *inside* the shared handler — keeping audit-once and
  the 400 shape single-sourced instead of letting the route
  short-circuit. No web behavior changes: with `bodyError` unset,
  every code path is the pre-Phase-26 one, and the web handler
  tests pass unmodified.
- **Deps factoring**: `createDefaultCoachChatDeps` was refactored
  into `createCoachChatDeps(getSession, overrides?)` + a thin web
  wrapper. This is the factoring the Phase 22 handler header
  already promised ("the Phase 26 mobile variant can supply a
  Bearer-token resolution and reuse this exact pipeline + core").
- The mobile chat keeps its conversation in component state only
  (like web) — nothing is persisted on the device, and no chat
  history is stored server-side beyond the one privacy-bounded
  audit row per question.

## Production addendum (2026-10-30)

Deployed `dpl_9H6QmPdvyvmQM3hzEG51ahva2gqz` READY (production). Independent production verification: **PASS** —

- `POST /api/mobile/coach/chat` with no token → 401; with a smuggled `user_id` → 400 naming the field; a 1001-char message → 400.
- Real answers on the test account trace to SQL: the weekly question returned the week's verified figures (3,702.50 present in the answer payload), the drawdown question returned intent `drawdown_analysis` with the 0.20 max drawdown, and the October-vs-September comparison returned honest `insufficient_data` (September is empty), all in deterministic mode (`narration: "deterministic"` — the LLM key remains Ezat's pending activation, unchanged).
- Routing note: "How did I do this week?" lands on the `weekly_focus` intent rather than the `weekly_overview` fallback — both are real Phase 22 intents and the answer carries the week's figures; routing is the shared web router's, so mobile/web parity holds by construction.
- Audit reconciliation exact: test-account `coach.chat` rows 21 → 26 = precisely the 5 authenticated calls (2 `invalid_argument`, 3 answered), each with details of exactly `{ intent, outcome, narration }` — no message text or history anywhere. No `api.mobile.*` rows were written, per the §3 decision. Chat created no trades/XP/notifications (account unchanged at 10 trades / 390 XP).
- Isolation: a throwaway account (bootstrapped, then deleted; auth users back to 2) asking the same weekly question received `insufficient_data` — no cross-user data.
- Web regression: `POST /api/coach/chat` without a session → 401 JSON (cookie adapter intact after the factoring); `/coach` signed-out → 307 to /login.

Mobile chat UI remains device-unverified (no emulator in the sandbox); endpoint behavior, payload contract, audit, and isolation are production-proven.

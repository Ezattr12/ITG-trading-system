# Task 15 — Coach Readiness Audit

Audit of the AI Coach surface (web chat, mobile chat, stored insights,
MCP server) as preparation for Task 16 (Phase 22: Interactive Trading
Intelligence Agent). Audit + plan only: **no code was changed** and no
fix was needed that could not wait for its owning task. All claims
below were re-verified against the code and the live database on
2026-11-02 (read-only SQL), not carried over from earlier phase docs.

Doctrine check (OBSERVE → ANALYZE → EXPLAIN → COACH, never
DECIDE → EXECUTE): **holds everywhere on the coach surface** — see §6.

## 0. Readiness verdicts

| Area | Verdict |
|---|---|
| Intent routing & evidence gates (§1) | **READY** |
| FACT / INFERENCE / RECOMMENDATION separation & honesty (§2) | **READY** |
| `ai_insights` store & UI consumption (§3) | **READY-WITH-GAPS** |
| MCP server (§4) | **READY** |
| Chat pipeline, rate limit, audit (§5) | **READY** (one documented platform caveat) |
| Execution surface (§6) | **READY** — zero execution capability |
| LLM narration (§7) | **BLOCKED-ON-KEY** — plumbing READY, live narration has never run |

Standing baseline used throughout: test account A
(`c4838c9d-babd-4d8c-9008-e0b1991aaa00`) — 10 trade rows, 8 closed
(all closed in the week of 2026-10-26, i.e. October 2026), total P&L
3702.50, 7W/1L, win rate 87.5%, XP 390. Re-verified live during this
audit (10 rows, XP sum 390 — unchanged).

## 1. Intent inventory — 17 intents, verified

The router is `detectCoachIntent` (`apps/web/lib/coach/chat.ts`):
deterministic regex rules evaluated in a fixed order, falling back to
`weekly_overview`. There is no free-form generation path — an
unmatched question is answered as a weekly overview from the trader's
own data, never improvised. The 17 members of `CoachChatIntent`
match the 17 claimed in Phase 22/29 exactly: 12 Phase 22 intents
answered inside `chat.ts`, 5 Phase 23 intents delegated to
`lib/intelligence/coach-answers.ts`.

Gating constants (all in code, re-verified):

- `COACH_MIN_TRADES = 3` — closed trades **in the week** before the
  weekly engine analyses it (`lib/coach/types.ts`).
- `PATTERN_MIN_TRADES = 5` — closed trades all-time before chat
  pattern claims (`lib/coach/chat.ts`).
- `ROW_MIN_TRADES = 2` — trades on one strategy/session/emotion row
  before the coach ranks it.
- `INTEL_MIN_TRADES = 5`, `GROUP_MIN_TRADES = 3`,
  `MATERIAL_WIN_RATE_GAP = 20` points (`lib/intelligence/analysis.ts`)
  — intelligence conclusions; a comparison statement additionally
  needs ≥3 trades on **both** sides and a ≥20-point win-rate gap,
  below which groups are reported with no conclusion.

"A today" is Monday 2026-11-02: A's 8 closed trades all sit in the
week of Oct 26 / in October, so week- and month-scoped intents are
insufficient **today** even though A's all-time evidence is rich.
That is the gates working, not a defect — A's live `coach.chat`
audit history shows `ok` outcomes for the weekly/monthly intents
when they were asked while the data was current.

| # | Intent | Scope | Sufficiency gate | Account A today | Zero-trade account |
|---|---|---|---|---|---|
| 1 | `weekly_overview` (fallback) | Current week | ≥3 closed this week | **insufficient** (0 this week) | insufficient |
| 2 | `weekly_focus` | Current week | ≥3 closed this week | **insufficient** (0 this week) | insufficient |
| 3 | `last_30_trades` | Most recent 30 closed | ≥5 all-time | **ok** (8) | insufficient |
| 4 | `best_strategy` | All closed, by strategy | ≥5 total + a strategy row ≥2 | **ok** (BOS 3 trades; ungrouped 5) | insufficient |
| 5 | `best_session` | All closed, by session | ≥5 total + a session row ≥2 | **ok** (London 2 trades, +1,201.20) | insufficient |
| 6 | `repeated_mistakes` | All closed + lessons | ≥5 total | **ok** | insufficient |
| 7 | `psychology_impact` | All closed, by emotion | ≥5 total + an emotion row ≥2 | **insufficient** — calm logged on 1 trade, 2 records carry no emotion, 5 trades have no emotion recorded (SQL-verified) | insufficient |
| 8 | `discipline_trend` | Recent 30 vs previous 30 | ≥10 total, ≥5 in the earlier span | **insufficient** (8 total) | insufficient |
| 9 | `worst_trades` | All closed | ≥1 | **ok** | insufficient |
| 10 | `month_compare` | This month vs last | Both months ≥1 closed | **insufficient** — Oct has 8, Nov has 0; answer states last month's headline and says why | insufficient |
| 11 | `loss_patterns` | Losing closed trades | ≥5 total **and** ≥3 losses | **insufficient** (1 loss) | insufficient |
| 12 | `biggest_weakness` | All closed | ≥5 total | **ok** | insufficient |
| 13 | `drawdown_analysis` | All closed (equity curve) | ≥5 (`INTEL_MIN_TRADES`) | **ok** (max drawdown 0.20) | insufficient |
| 14 | `risk_behavior` | All closed + rules/plan | ≥1 closed | **ok** (stop-loss on 5/8; planned-risk distribution exists) | insufficient |
| 15 | `trading_conditions` | All closed, by condition group | ≥1 group with ≥3 trades (`GROUP_MIN_TRADES`) | **insufficient** — session·direction max is London·Long 2; market condition: trending ×1, unset ×7 (SQL-verified; matches A's live audit history) | insufficient |
| 16 | `improvement_plan` | All closed | ≥5 (`INTEL_MIN_TRADES`) | **ok** | insufficient |
| 17 | `monthly_review` | Current calendar month | ≥1 closed this month | **insufficient** (0 in November; was `ok` in October) | insufficient |

Zero-trade behaviour is uniform: **every** intent returns
`status: "insufficient_data"` with the true count (0) in the facts,
the threshold it needs, and the standing recommendation ("Journal
more closed trades, then ask again — the coach only speaks from your
recorded data."). No intent returns `ok`, no figure is estimated,
and narration is never invoked (§2). Unit tests pin this
(`answerCoachQuestion — insufficient data is honest` in
`chat.test.ts`, plus per-intent numerical-accuracy tests).

The 8 suggestion chips in the web chat UI
(`components/coach/coach-chat.tsx`) were each traced through the
router and are pinned by the canonical-questions test: all 8 land on
a real intent (biggest_weakness, last_30_trades, best_strategy,
best_session, repeated_mistakes, psychology_impact, month_compare,
weekly_focus). No chip falls through to the fallback.

## 2. Separation & honesty structure — verified by data-flow trace

- **Shape.** `CoachChatAnswer` is
  `{ status, intent, facts[], inferences[], recommendations[],
  evidence, narration, narrationProvider? }`. Sections are separate
  arrays end-to-end: assembled separately by every intent builder,
  rendered as separate headed sections in the UI, and — when an LLM
  narrates — re-parsed into the same three arrays by
  `parseNarratedSections`, which rejects anything that is not
  exactly FACTS → INFERENCES → RECOMMENDATIONS in order, with
  non-empty FACTS and RECOMMENDATIONS, ≤8 points per section and
  ≤500 chars per line. The UI additionally badges every answer
  "AI-narrated" or "Deterministic analysis" — the surface never
  claims a model was involved when one was not.
- **Non-ok returns before narration.** In `answerCoachQuestion`
  (`chat.ts`), the deterministic answer is built first; if
  `status !== "ok"` the function returns immediately with
  `narration: "deterministic"`. The provider is not even resolved,
  let alone called. Pinned by the test *"insufficient-data answers
  are never narrated (provider not called)"*.
- **Narration cannot invent numbers.** The only data an LLM
  receives is `buildCoachNarrationPrompt`'s rendering of the
  finished deterministic answer (its three sections + a one-line
  evidence summary). It never receives a database handle, a tool,
  or the raw question as anything but labelled context. Its output
  is accepted only if `narrateWithGuard` (`lib/coach/llm.ts`)
  proves every numeric token in the text is a formatting variant
  (0/1/2-decimal rounded form) of a number already present in the
  deterministic answer (`collectAllowedNumbers` /
  `findForeignNumbers`). A single foreign number discards the
  **whole** narration — it is never edited into compliance — and
  the deterministic sections are returned instead. Provider error,
  timeout (15s `AbortController`), empty or unstructured output
  all take the same fallback. Pinned by tests in `llm.test.ts` (19)
  and the narration-integration block of `chat.test.ts`.
- **Inference is labelled as interpretation** in the deterministic
  text itself (e.g. psychology answers state the association is
  correlational; rankings carry small-sample caveats), and the
  narration system prompt repeats the rule.
- **Isolation.** The core reads only through the caller's
  RLS-scoped client with the transport-derived `userId`; message
  text is never identity. Tests pin cross-user isolation and
  prompt-injection behaviour ("ignore your instructions…", a
  claimed `user_id` in the message), and that the core performs
  **no writes on any table**.

## 3. `ai_insights` — one writer, two freshness modes

- **Only writer:** `refreshCoachInsights` in
  `lib/coach/service.ts` (the single `.insert(` on `ai_insights`,
  via the service-role client; the table has no client INSERT
  policy — migration 0009). Repo-wide grep confirms every other
  reference is a read (`lib/coach/queries.ts`,
  `lib/reports/catalog.ts`, `lib/intelligence/queries.ts`, admin
  counts) or a comment. The MCP `compute_coach_insights` tool is
  compute-only through the internal endpoint and never persists.
- **Refresh triggers (exactly two):** (1) the manual
  `refreshCoachAnalysisAction` on the /coach page; (2) the
  automatic, never-throwing `refreshCoachAfterClosedTradeChange`
  in `lib/trades/service.ts`, fired when a closed trade is created,
  corrected or re-reviewed, for the week of that trade's close.
  Refresh is idempotent on (week, type, exact metrics snapshot) —
  checked in code and enforced by the unique index in migration
  0013 — awards no XP and creates no notifications. When data
  changes, the changed snapshot stores as a **new** row; history is
  append-only and reads take the newest.
- **Account A's store, live:** 51 rows, all for the week of
  2026-10-26 — 43 generated 2026-10-30 and 8 more on 2026-10-31,
  i.e. the brief's "43" was the Oct 30 state and a refresh after
  that week's data changed during verification added 8
  changed-snapshot rows. By type: discipline 17,
  weekly_performance 8, goals 8, best_strategy 7, focus_next_week
  5, risk 4, mistakes 2. Consistent with the design; no drift in
  trades (10) or XP (390).
- **UI consumption — consistent, one engine, two freshness modes.**
  Stored snapshots: /coach history, the dashboard card
  (`getLatestCoachInsights`), period Reports
  (`lib/reports/catalog.ts`), and the monthly digest's
  `coachFindings`. Live computation from the same engine + same
  evidence assembly: the /coach page's current-week analysis, the
  weekly digest, and **all chat answers**. A stored row can lag
  live data only between a data change and the next refresh — and
  closed-trade changes auto-refresh their own week, so the window
  is narrow and the manual refresh closes it.
- **Gap (from Task 8, re-confirmed):** nothing in `lib/coach`,
  `lib/intelligence` or `lib/reports` reads the stored
  `weekly_reviews` table (grep: zero references). The trader's
  written weekly review — main mistake, focus for next week — feeds
  no coach answer, digest or report. The coach computes its weekly
  view live from trades instead. Documented for Task 16/17
  scoping; not fixed here.
- **Inherited cap (from Task 14):** coach evidence reads inherit
  the platform-wide `TRADE_LIST_FETCH_LIMIT = 500` fetch cap (e.g.
  the streak read in `lib/coach/queries.ts`, the analytics bundle
  behind most chat intents). No current user is near it; the
  figure-integrity fix belongs to Task 21 as already flagged.

## 4. MCP server — exactly 13 tools, same cores

`apps/mcp-server` builds clean (`npm run build`, `tsc -p
tsconfig.build.json`); `dist/` was removed after verification (it
trips `security:check` and must never be committed). Its test files
run inside the root Vitest battery (root config includes
`apps/mcp-server/src/**/*.test.ts`).

| Tool | Contract (one line) |
|---|---|
| `get_trade` | One of the caller's own trades by id, full detail |
| `analyze_trade` | Per-trade P&L / R / ROI for one trade, computed by `@itg/calc` |
| `get_recent_trades` | The caller's recent trades, bounded |
| `get_performance_summary` | Aggregate performance over the caller's trades |
| `get_strategy_performance` | Per-strategy aggregates |
| `get_session_performance` | Per-session aggregates |
| `get_psychology_summary` | Emotion / discipline aggregates |
| `get_risk_status` | Risk rules + plan and current risk standing |
| `get_goal_progress` | Goals and their progress |
| `get_discipline_status` | Discipline measures (stop-loss, journaling) |
| `get_level_status` | Level / XP standing |
| `get_weekly_review` | The week's review data |
| `compute_coach_insights` | The deterministic coach engine itself, via the app's authenticated internal endpoint — compute-only, stores nothing |

No parallel logic: `src/calc.ts` is a single re-export of
`packages/calc/src` (the same source the web app compiles);
`compute_coach_insights` holds **no** coach logic at all — it is an
HTTP client for `POST /api/internal/coach-insights`, which runs the
one engine (`computeCoachInsights` in `lib/coach/service.ts`).
Intelligence tools read the same tables through the caller's
token-scoped RLS client with an additional `user_id` filter and
aggregate with the shared calc primitives. Every tool: identity
from the validated access token only (identity arguments are
rejected before any query), per-user rate limit, 10s call timeout,
exactly one audit row per call. The server's **only** data write
anywhere is that audit row (`src/audit.ts` → `audit_logs`); grep
confirms zero inserts/updates/deletes on any domain table.

## 5. Chat paths — one pipeline, one bucket, one audit shape

- **One pipeline.** Web `POST /api/coach/chat` and mobile
  `POST /api/mobile/coach/chat` are thin route adapters over the
  single `handleCoachChat` (`lib/coach/chat-handler.ts`) +
  `answerCoachQuestion` (`lib/coach/chat.ts`). The mobile handler
  (`lib/api/handlers/coach-chat.ts`) contributes only the
  Bearer-token session adapter via `createCoachChatDeps`. There is
  no second router, no second core, and deliberately **no**
  additional `api.mobile.*` audit row for chat (documented in
  Phase 26: the shared `coach.chat` row is the feature's one
  domain audit on both surfaces).
- **Transport caps.** Web: message ≤1000 chars, history ≤6 turns of
  ≤2000 chars (older turns dropped, never scope-widening). Mobile
  adds the M1 64 KB body cap, enforced at the route and reported
  through the handler so the refusal still writes its one audit
  row. Identity fields (`user_id`, `tenant_id`, `profile_id`,
  `userId`, `tenantId`) in the body are a 400 naming the field,
  even with a valid session; unknown keys are a 400.
- **Rate limit.** `COACH_CHAT_RATE_LIMIT` = 20/min, key
  `coach-chat:<userId>`. Both surfaces resolve to
  `checkPresetRateLimit` over the same module-level store in
  `lib/auth/rate-limit.ts` (mobile routes through the API deps to
  the identical function and key), so web + mobile share one
  allowance per trader. **Caveat (documented in the module
  header):** the store is in-memory per server instance — on
  multi-instance Vercel it is a best-effort guard, not a
  distributed limiter. A shared store (e.g. Upstash) is an
  infrastructure decision for Ezat, already flagged in Task 13;
  call sites would not change.
- **Audit.** Exactly one `coach.chat` row per call on every path
  (success, insufficient, invalid, unauthenticated, rate-limited,
  error), details exactly `{ outcome, intent, narration }` — never
  the message text, never a figure. **Live verification:**
  37 `coach.chat` rows exist; every row's details carry exactly
  those three keys; narration is `"deterministic"` on all 27
  answered rows and `null` on the 10 refusal rows. Account A has
  26 rows spanning 13 intents with outcomes matching the gates in
  §1. Zero rows anywhere carry `narration: "llm"` — see §7.

## 6. Execution-surface scan — zero

Grep across `lib/coach`, `lib/intelligence`, the MCP server source,
and both chat handlers/routes for `broker`, `withdraw`,
`transfer`, `place order`, `execute order`, `buy`, `sell`: **no
capability hits**. Remaining matches for "order"/"execute" are
sort-ordering (`.order(...)`), the FACTS/INFERENCES/RECOMMENDATIONS
section order, and doctrine comments stating the coach *cannot*
execute. The chat core is read-only (test-pinned: no inserts,
updates or upserts on any table); the MCP server's only write is
its audit row; the internal coach endpoint computes only. The
narration system prompt additionally forbids instructing the
trader to place, modify or close a specific trade — but see the
§7 gap: that prohibition is currently prompt-level only.

## 7. LLM narration — BLOCKED-ON-KEY (plumbing READY)

**The seam already exists and is unit-tested.** Task 16 does not
need to build the narration layer; it needs to switch it on and
prove it in production.

- **Seam:** `answerCoachQuestion` → `resolveCoachLlmProvider()`
  (`lib/coach/llm.ts`) → `buildCoachNarrationPrompt` →
  `narrateWithGuard` → `parseNarratedSections`. Plain `fetch`, no
  SDK dependencies. A legacy formatter, `buildLlmCoachPrompt` in
  `lib/coach/insights.ts`, is explicitly marked NOT CONNECTED and
  is **not** the seam — Task 16 should leave it alone.
- **Configuration (env var names only):** `ANTHROPIC_API_KEY`
  (preferred when both are set) or `OPENAI_API_KEY`;
  optional `COACH_LLM_MODEL` override. Defaults:
  `claude-sonnet-4-5` / `gpt-4o-mini`. Keys are read server-side
  only, never sent to the browser, never logged.
- **Fallback:** with neither key set, resolution returns `null`
  and every answer is the complete deterministic answer — "no LLM
  is a valid configuration". This is the state production is in
  today, proven by the audit trail: all 37 `coach.chat` rows are
  deterministic/null, zero `llm`. The local env file likewise
  contains neither key.
- **Gap found — the guard is numeric + structural only.** Nothing
  mechanically stops an accepted narration from containing an
  imperative trade instruction with no numbers in it ("buy gold
  now") — today only the system prompt forbids it. Before a key is
  switched on, Task 16 should add a deterministic banned-content
  screen to the narration acceptance path (imperative trade verbs
  directed at the trader, price-prediction phrasing), with tests.
- **Gap — language.** Intent patterns and deterministic answers
  are English-only today. The skill's target set for the
  interactive coach is English / Pashto / Dari; narration could
  render another language once an LLM exists, but routing and
  deterministic answers cannot. Ezat scoping decision for
  Task 16: in scope, or explicitly deferred.

### Task 16 implementation plan

**Buildable BEFORE the key exists (do these first):**
1. The banned-content screen above (in `narrateWithGuard`'s
   acceptance path or immediately after `parseNarratedSections`),
   with unit tests: instruction-laden narration → deterministic
   fallback; ordinary coaching prose → accepted.
2. Handler-level guardrail assertion: with a fake provider
   injected, the `coach.chat` audit row records
   `narration: "llm"` and the response carries
   `narrationProvider` (the core-level equivalent exists;
   pin it at the handler/audit seam).
3. A production configuration checklist in the Task 16 doc: which
   env var, where it is set (Vercel production environment, via
   the Secure Vault flow — never in chat, never in the repo),
   redeploy step, and the rollback (remove the var → deterministic
   everywhere; there is no other off-switch, by design).
4. Re-run the §8 browser QA pack in deterministic mode as the
   pre-key baseline (the parent runs this in Task 15 already).

**The moment Ezat provides a key:**
5. Set `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`) in the Vercel
   production environment; redeploy.
6. As account A, ask the §8 questions in production; verify the
   badge reads "AI-narrated", the response/audit show
   `narration: "llm"`, and **figure-diff** each narrated answer
   against the deterministic answer to the same question — every
   number must match the evidence (the guard enforces this in
   code; this is the production proof).
7. Verify the fallback live: one question with a deliberately
   wrong key in a preview/local environment returns deterministic,
   badged as such.
8. Verify one insufficient-data question still returns
   deterministic and the provider is not called (audit outcome
   `insufficient_data`, narration `deterministic`).

**Exact stop-point:** if no key has been provided, Task 16 stops
after steps 1–4 with the verdict "narration-ready; deterministic
in production; live narration unverified". Steps 5–8 require the
key in the production environment, which only Ezat can supply or
authorise. Nothing else blocks Task 16.

**Guardrail test set Task 16 must pass** (status today):
- Foreign-number narration rejected → deterministic [exists]
- Insufficient-data never reaches the provider [exists]
- Unstructured / out-of-order / oversized narration rejected
  [exists]
- Provider error, empty output and timeout → deterministic
  [exists]
- Figure-diff: every numeric token in accepted narration is a
  rounded form of an evidence number [exists, `llm.test.ts`]
- Cross-user isolation and prompt-injection resistance [exists]
- Core writes nothing on any table [exists]
- Banned-content narration (trade instruction / price prediction)
  rejected → deterministic [**new, step 1**]
- Audit records `narration: "llm"` + provider at the handler seam
  [**new, step 2**]

## 8. Browser QA pack (for the parent — production /coach, as A)

Run today (2026-11-02). A's baseline for the markers: 8 closed trades,
total P&L 3702.50, win rate 87.5%, all trades in the week of 2026-10-26
(none in the current week).

1. **Q1 "What is my biggest weakness?"** (biggest_weakness — ok for A).
   Expected markers: "8 closed trades", "3702.50", "87.5%"; the answer
   badge reads "Deterministic analysis" (no LLM key in production);
   Facts / Inferences / Recommendations sections render separately.
2. **Q2 "Show my last 30 trades"** (last_30 — ok for A). Expected: the
   same October figures over the 30-trade window (all 8 trades fall
   inside it).
3. **Q3 "What should I focus on this week?"** (weekly focus — the live
   insufficient-data proof on A itself: 0 trades this week). Expected: an
   honest insufficient-data answer stating the true count, no invented
   advice, provider never called.
4. **Throwaway zero-trade account**: every intent returns
   `insufficient_data` with the true count (0) stated.

**Execution status (2026-11-02, parent):** attempted twice and defeated
by the environment both times — (a) local Chromium cannot reach
production through the sandbox proxy (chrome-error on every attempt);
(b) a live browser task with the QA account's credentials was aborted
before sign-in completed (no sign-in occurred, no data touched). The
pack remains OWED and is scheduled as Task 16 step 4 (the pre-key
deterministic baseline). Compensating evidence already in hand: the
router/gate behaviours are unit-test-pinned, 37 live `coach.chat` audit
rows show gate-consistent outcomes across 13 intents for A, and local
production-build renders of /coach as A return 200 with correct data.
...[truncated 2547 chars]
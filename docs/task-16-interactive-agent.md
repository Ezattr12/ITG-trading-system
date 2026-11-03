# Task 16 — Interactive Trading Intelligence Agent (pre-key steps)

Scope executed: **steps 1–4** of the Task 15 implementation plan
(`docs/task-15-coach-readiness.md` §7) — everything that can be
built and proven before an LLM API key exists. Steps 5–8 are
**not** in scope and were not attempted: they begin at the key,
which only Ezat can supply or authorise.

Doctrine held throughout: OBSERVE → ANALYZE → EXPLAIN → COACH,
never DECIDE → EXECUTE. The deterministic Coach Engine remains
the only source of trading facts; an LLM may only narrate a
verified answer, and only through the guarded acceptance path.

## 1. Banned-content screen for narration (step 1) — BUILT

**The gap (Task 15 §7):** `narrateWithGuard` proved a narration
invented no *numbers*, but a number-free trade instruction —
"buy gold now" — contains no digit and passed the numeric
guard; only the system prompt forbade it. Prompt-level
prohibition is not a mechanical guarantee.

**The fix:** `findBannedContent` in `apps/web/lib/coach/llm.ts`
— a deterministic pattern screen (9 rules) applied inside
`narrateWithGuard` at the same acceptance gate as the numeric
guard, immediately after it. A single hit discards the WHOLE
narration (never an edit) and the caller returns the
deterministic answer — the identical failure semantics as a
foreign number, a provider error, or a timeout. The screen
applies only to LLM narration; deterministic answers never
pass through it.

Rules: `modal-trade-instruction` (you should/must/need to +
execution verb), `advised-trade-instruction` (recommend /
advise / suggest / consider + trade gerund, or recommend-you-
to + verb), `imperative-line-start` (execution verb opening a
line or sentence in imperative shape), `execution-phrase`
(place a trade, enter a position, take this trade, go
long/short, …), `direction-instrument` (buy/sell + instrument
or urgency tail; imperative short + instrument),
`urgency` (act now, buy/sell now, before it's too late, …),
`price-prediction` (will reach/hit/rise/fall, is going to hit,
expected/poised/set to + market verb, price target),
`outcome-promise` (guaranteed, can't lose, risk-free profit,
sure thing, …), `hold-instruction` (hold your position/trade).

**The line drawn** — instruction to trade a market NOW vs
coaching about the trader's process and recorded past. The
patterns key on imperative *shapes* (sentence-initial verbs,
modals, advised trade gerunds, direction + instrument
objects, urgency tails), never on direction words alone:

| Rejected | Why |
|---|---|
| "Buy gold now." | direction + instrument + urgency |
| "You should short EURUSD here." | modal + execution verb |
| "Short EURUSD at market." | imperative short + instrument |
| "Consider buying gold here." | consider + TRADE gerund |
| "Enter a position before the news." / "Place a trade today." / "Take this trade." | execution phrases |
| "Gold will reach a new high." / "The price is going to hit…" | price prediction |
| "Guaranteed." / "You can't lose." / "Risk-free profit." | outcome promise |
| "Hold your position through the announcement." | hold instruction |

| Accepted | Why |
|---|---|
| "You bought gold three times; two of those buys lost." | past tense, possessive — description |
| "Your short gold trades lost 50.00 in October." | direction + instrument as a noun phrase about the past, no imperative shape |
| "Your shorts underperformed your longs." | direction words as nouns |
| "Most of your profit came from long trades on gold." | descriptive |
| "Consider reviewing your stop placement before the next session." | consider + PROCESS gerund = coaching |
| "Review the three losing trades…" / "Keep the routine…" | process imperatives are not execution verbs |
| "- Closed trades: 8…" / "- Open trades averaged…" | stat lines, past/adjectival forms |

The screen errs toward rejection where a phrase is genuinely
ambiguous ("will reach" cannot be told apart as price target
vs goal target): a false positive costs only the narration —
the deterministic answer is shown — while a false negative
would put a trade instruction in the coach's voice.

**Tests:** 37 new in `llm.test.ts` — every rejected example
above pinned to its rule, every accepted example pinned to
zero hits, multi-rule ordering, and two `narrateWithGuard`
integrations (banned recommendation line discards an
otherwise clean, number-true narration whole; descriptive
narration about the trader's own positions passes both
guards). All 19 pre-existing guard tests and the shipped
clean-narration shape pass unchanged — the screen does not
disturb the acceptance path for honest prose.

## 2. Handler-level guardrail assertion (step 2) — BUILT

Two new tests in `apps/web/lib/coach/chat-handler.test.ts`
("LLM narration at the handler/audit seam") run the REAL core
(`answerCoachQuestion`) through `handleCoachChat` with a fake
provider injected, over a 3-trade fixture:

- **Clean narration** → HTTP 200, `body.narration === "llm"`,
  `body.narrationProvider === "mock"`, sections replaced by
  the narrated ones; the captured audit entry's detail fields
  are exactly `{ outcome, intent, narration }` (the three keys
  `createCoachChatDeps` writes to `audit_logs`) with values
  `{ ok, weekly_overview, llm }`.
- **Banned-content narration** ("Buy gold now — this run is
  guaranteed.") → HTTP 200 with `narration: "deterministic"`,
  no `narrationProvider`, the provider's text nowhere in the
  response body, deterministic facts intact, and the audit
  entry records `narration: "deterministic"` — the banned
  narration leaves no trace anywhere downstream.

## 3. Production configuration checklist (step 3)

Ready to execute the moment Ezat supplies a key. Nothing here
was executed in this task.

- **Variable:** `ANTHROPIC_API_KEY` (preferred — Anthropic
  wins when both are set). Alternative: `OPENAI_API_KEY`.
  Optional override: `COACH_LLM_MODEL` (defaults:
  `claude-sonnet-4-5` / `gpt-4o-mini`). No other configuration
  exists or is needed; the seam reads the server environment
  only.
- **Where it goes:** the **Vercel production environment** of
  project `itg-traderos`, set through the connector after Ezat
  supplies the key via the **Secure Vault flow**. Never in
  chat, never in the repo, never in any `NEXT_PUBLIC_*`
  variable, never in the client bundle. Keys are read
  server-side only and never logged (Task 15 §7).
- **Redeploy step:** after setting the variable, redeploy
  production (environment changes do not reach running
  deployments) and confirm the alias serves the new
  deployment, per the standing deploy recipe.
- **Rollback:** remove the variable and redeploy → every
  answer is deterministic everywhere. There is deliberately
  **no other off-switch**: no key = deterministic mode, which
  is a complete, valid configuration (the state production
  has run in since Phase 22).
- **Verification script (steps 5–8 of the Task 15 plan),
  executed immediately after the key lands:**
  5. Set the variable (above); redeploy.
  6. As account A, ask the §8 questions in production; verify
     the badge reads "AI-narrated", the response and the
     `coach.chat` audit row show `narration: "llm"`, and
     **figure-diff** each narrated answer against the
     deterministic answer to the same question — every number
     must match the evidence.
  7. Fallback proof: one question with a deliberately wrong
     key in a preview/local environment returns the
     deterministic answer, badged as such.
  8. Insufficient-data proof: one insufficient-data question
     still returns deterministic and the provider is not
     called (audit outcome `insufficient_data`, narration
     `deterministic`).

## 4. Deterministic interactive QA baseline (step 4) — RUN

**What ran:** the §8 pack as a REAL typed interaction against
a **local production build** of the deployed code —
`~/workspace/.itg-helpers/qa-coach-interact-local.mjs`:
the built app served on :3100 (env sourced), account A's
session minted via the password grant, the @supabase/ssr
cookie injected into a Playwright context (390×844), the
questions typed into `#coach-question` and submitted with
the Ask button. Server killed by PID afterwards; A
re-verified by read-only SQL: **10 trades, XP 390 —
unchanged**. (The run's own `coach.chat` audit rows are the
endpoint's designed one-row-per-call behaviour for the QA
account's real questions.)

```
coach page loaded at http://127.0.0.1:3100/coach
PASS — Q1 badge reads Deterministic analysis
PASS — Q1 not labelled AI-narrated
PASS — Q1 evidence shows 8 closed trades
PASS — Q1 evidence shows total P&L 3702.50
PASS — Q1 evidence shows win rate 87.5%
PASS — Q1 renders Facts section
PASS — Q1 renders Inferences section
PASS — Q1 renders Recommendations section
PASS — Q2 shows the insufficient-data chip (Not enough data yet)
PASS — Q2 still badged Deterministic analysis
PASS — Q2 states the true position (0 trades this week / journal-more framing)
QA RESULT: ALL PASS
```

Q1 "What is my biggest weakness?" → deterministic answer over
A's real evidence (8 closed trades, 3702.50, 87.5%), three
sections rendered separately. Q2 "What should I focus on
this week?" → the live insufficient-data proof on A itself
(0 trades this week): honest chip + true-count framing, no
invented advice. This is the pre-key baseline steps 5–8 will
be diffed against.

**Still owed, stated plainly:** the production-URL variant of
this pack. The sandbox browser cannot reach production
(chrome-error through the proxy on every Task 15 attempt)
and the one live browser task was aborted by the environment
before sign-in. The local-build run above exercises the same
deployed code, the same production database and the same
real endpoint; it does not claim to be the production-URL
run. The pack is re-listed in step 6 above for the moment
the key lands (and can be re-attempted against production
whenever the browser path recovers).

## 5. Open scoping decision for Ezat — coach language (EN/PS/FA)

The interactive coach's target language set is English /
Pashto / Dari, but today **intent routing and deterministic
answers are English-only**. Narration language ≠ router
language: an LLM narrator could *render* a verified English
answer in Pashto or Dari, but it cannot *route* a Pashto
question to an intent, and with no key the deterministic
fallback is English regardless. Options for when the key
arrives:

- **(a) Defer explicitly:** narration on, English-only
  end-to-end; record EN/PS/FA as a later task. Zero added
  risk to the narration launch.
- **(b) Narration-language only:** pass a locale to the
  narrator so verified answers render in PS/FA;
  questions still routed in English. The numeric guard is
  language-blind (digits are digits), but the
  banned-content screen's patterns are English — PS/FA
  narration would need its own screen review before this
  is safe.
- **(c) Full multilingual routing:** intent patterns and
  deterministic answer copy in three languages — a
  separate feature task, not a narration switch-on.

Not built in this task, in any variant. Ezat's call,
bundled with the key decision.

## 6. Task 17 hand-off note

The coach still never reads the stored `weekly_reviews`
table (Task 8 finding, re-confirmed in Task 15 §3): the
trader's written weekly review — main mistake, focus for
next week — feeds no coach answer, digest or report. One
line, no fix here; it belongs to the Task 17 scoping.

## 7. Guardrail test set — all nine now exist and pass

| Guardrail | Status |
|---|---|
| Foreign-number narration rejected → deterministic | existed |
| Insufficient-data never reaches the provider | existed |
| Unstructured / out-of-order / oversized narration rejected | existed |
| Provider error, empty output, timeout → deterministic | existed |
| Figure-diff: narration numbers ⊆ evidence numbers | existed |
| Cross-user isolation, prompt-injection resistance | existed |
| Core writes nothing on any table | existed |
| Banned-content narration rejected → deterministic | **new (§1)** |
| Audit records `narration: "llm"` + provider at the handler seam | **new (§2)** |

## 8. Gate results (this task)

| Gate | Result |
|---|---|
| Vitest (root, env sourced) | **845/845** (77 files) — baseline 806 + 39 new (37 `llm.test.ts`, 2 `chat-handler.test.ts`); no existing assertion modified |
| Typecheck (web + calc) | clean |
| Lint | 0 errors (1 pre-existing `<img>` warning on the dashboard, untouched) |
| Production build | OK |
| security:check | passed (405 files) |
| Playwright e2e (`CI=true`, repo root) | **36/36** |
| Interactive QA baseline (§4) | **ALL PASS** (11 assertions) |
| Account A baseline after all runs | 10 trades / XP 390 — unchanged (read-only SQL) |
| MCP | untouched; no `dist/` created |
| Artifacts | test-results removed; local server killed by PID |

Files changed: `apps/web/lib/coach/llm.ts` (screen + guard
hook), `apps/web/lib/coach/llm.test.ts`,
`apps/web/lib/coach/chat-handler.test.ts`, this doc.
Helper added outside the repo:
`~/workspace/.itg-helpers/qa-coach-interact-local.mjs`.
No deployment, no git operations, no production data writes
(the QA chats wrote only the endpoint's own designed
`coach.chat` audit rows for account A).

## Stop-point verdict

**narration-ready; deterministic in production; live narration unverified — steps 5–8 await Ezat's key**

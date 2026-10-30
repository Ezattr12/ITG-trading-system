# Phase 29 — Final Audit

**Date:** 2026-10-30. **Scope:** independent closing audit of the
30-phase build — local code, migrations, tests and docs only; no
deployment, no production access, no refactors. Two trivially safe
documentation defects were found and fixed (F1, F2); everything
structural is registered as a finding with a recommended action.

**Overall verdict: PASS WITH FINDINGS.** No FAIL area, no Critical
or High finding. The system in the tree today is the system the
phase docs describe: one calculation engine, one coach core, one
report composition, RLS on every table, identity only ever from a
validated session/token, and an audit trail on every mutation
surface. All findings are Medium or below, and every Medium is a
known, previously documented item carried deliberately (F3, F4).

## Battery results (all run 2026-10-30, this audit)

| Check | Result |
| --- | --- |
| `npm test` (Vitest) | **732/732 passed, 74 files** |
| `npm run typecheck` (web + calc) | exit 0 |
| `npm run lint` | exit 0 |
| `npm run build` (production) | exit 0 |
| `npm run security:check` | **passed, 373 files scanned** (after MCP `dist/` removal — see F8) |
| `CI=true npx playwright test` | **36/36 passed** (3 spec files; `.last-run.json` status `passed`, 0 failed) |
| `apps/mobile`: `npx tsc --noEmit` | exit 0 |
| `apps/mobile`: `npx expo export --platform android` | exit 0, bundle exported |
| `apps/mcp-server`: `npm run build` | exit 0 (13 tools compile); `dist/` then deleted and security:check re-verified green |

## Area verdicts

### 1. Database & migrations — PASS

- Migrations `0001`–`0018`, complete and ordered
  (`supabase/migrations/`).
- **32 public tables** created in the migration text; **32**
  distinct tables carry an `enable row level security` statement
  (set difference verified empty); **zero** `using (true)`
  policies anywhere.
- Policy count reconciles with the live figure from Phase 27:
  80 `create policy` statements − 8 storage.objects policies
  (0016) = **72 public-schema policies**.
- Append-only by construction: `xp_transactions` has only
  `xp_select_own`; `audit_logs` only `audit_logs_select_own`
  (0008/0010) — no client INSERT/UPDATE/DELETE policy exists, so
  writes are service-role-only, exactly as the engines assume.
- Storage (0016): buckets inserted as `avatars` public = **true**,
  `trade-screenshots` public = **false**; the avatars public-read
  exception is documented in the migration itself; screenshots
  carry owner-only select/insert/update/delete policies.
- Privilege guards: 0015 creates the guard functions/triggers;
  0018 fixes the `TG_OP` case bug (`TG_OP` is always uppercase)
  that once blocked profile creation.

### 2. Calculation integrity — PASS

- `@itg/calc` (`packages/calc/src/index.ts`, decimal.js
  throughout — `new Decimal(...)` wrappers at the boundary) is
  the single trade-math source: `apps/web/lib/trades/service.ts`
  calls `computeTradeMetrics` (create line 146, correct line 505)
  and a grep for price-difference arithmetic
  (`exit − entry` shapes) across `apps/web` outside calc returns
  **zero** hits.
- Aggregation layers delegate, never re-derive:
  `lib/analytics/analytics.ts` imports its formulas from
  `@itg/calc`; `lib/intelligence/analysis.ts` builds on
  `summarizeTrades`/`buildEquityCurve` + calc drawdown primitives
  and states the no-reimplementation rule in its header.
- XP amounts live in exactly one table — `XP_TABLE` in
  `packages/calc/src/index.ts:215` — and handlers resolve amounts
  through `calcXpFor` / the gamification actions, not literals.

### 3. Gamification — PASS WITH FINDINGS (F4)

- `XP_TABLE` verified against spec §24: trade_journal **10**,
  daily_goal **20**, backtest_session **15**, weekly_review
  **30**, risk_discipline **25** (the +25 risk-discipline streak
  award in `lib/trades/service.ts` uses this same reason/action).
- Level thresholds in exactly one code location:
  `DEFAULT_LEVELS` in `packages/calc/src/index.ts:237` — Bronze
  0–39, Silver 40–59, Gold 60–79, Platinum 80+; migration 0017
  seeds the same values as config rows by design.
- Achievements are config-driven (`lib/gamification/achievements.ts`):
  criteria jsonb from the seed is evaluated verbatim
  (`{"weekly_journal_pct": 100}` → +30 XP; `{"monthly_journal_pct":
  100}` → +50 XP). `journalPctInWindow` returns `null` for an
  empty window, so zero trades can never satisfy a percentage
  criterion — the ≥1-trade guard — and one fully-journaled trade
  in a window does satisfy it. **The engine does exactly what
  the seed says; whether the seed should demand more volume is
  Ezat's open product question (F4). Not changed.**

### 4. API surface — PASS

- HTTP routes (21 `route.ts` files): 19 under `/api/mobile/*`
  (trades CRUD-by-reversal, review, screenshots, cancel, goals +
  progress, profile + avatar, risk-rules, risk-plan, weekly
  review, backtesting, notifications/read, session, summary,
  coach/chat), plus `/api/coach/chat` (cookie session) and
  `/api/internal/coach-insights` (Bearer, compute-only).
- Web mutations: 9 `"use server"` action modules (auth, trades,
  risk, discipline, gamification, certificates, reviews, coach,
  admin), all thin adapters over the same service cores the
  mobile API calls (Phase 21 architecture, intact).
- MCP server: **13 tools** (analyze_trade, compute_coach_insights,
  get_discipline_status, get_goal_progress, get_level_status,
  get_performance_summary, get_psychology_summary,
  get_recent_trades, get_risk_status, get_session_performance,
  get_strategy_performance, get_trade, get_weekly_review) —
  read-only plus the single compute trigger; no write/execution
  tool exists.
- Identity: `IDENTITY_FIELDS` + `rejectIdentityFields`
  (`lib/api/auth.ts`, `lib/api/handlers/shared.ts`) reject any
  body carrying `user_id`/`tenant_id`/`profile_id`/`userId`/
  `tenantId` with a 400 naming the field; identity comes only
  from `auth.getUser()` on the validated token/session. Handler
  tests pinning this are part of the 732.

### 5. AI Coach — PASS

- **17 intents** in `INTENT_RULES` (`lib/coach/chat.ts:225`) —
  the 12 Phase 22 intents + monthly_review, drawdown_analysis,
  risk_behavior, trading_conditions, improvement_plan (Phase 23),
  with monthly_review routed before month_compare.
- Deterministic core is authoritative, verified in the code path
  of `answerCoachQuestion`: a non-`ok` deterministic answer
  returns immediately as deterministic — **insufficient-data
  answers are never narrated** — and narration, when a provider
  exists, goes only through `narrateWithGuard` (`lib/coach/llm.ts`):
  every numeric token in the narration must match a rounded form
  of a number in the deterministic answer (llm.ts:172–236), the
  text must parse into FACTS / INFERENCES / RECOMMENDATIONS, and
  a rejected narration is **discarded whole, never edited**
  (llm.ts:252). No provider configured → deterministic answer,
  honestly labelled (`narration: "deterministic"`).
- Privacy: the audit details type in `lib/coach/chat-handler.ts`
  is exactly `{ outcome, intent, narration }` — there is no
  field that could carry message text, and unauthenticated /
  invalid calls are audited with a null actor.
- **No execution capability anywhere:** a repo-wide grep over
  web lib/app, MCP src, mobile src and calc for order/broker/
  withdraw/transfer code paths returns zero hits.

### 6. Reports & intelligence — PASS

- Five catalog kinds — performance, psychology, risk, strategy,
  coach (`CATALOG_REPORT_KINDS`, `lib/reports/catalog.ts:63`) —
  all composed over the single `getReportSummary` →
  `buildReportSummary` machinery (catalog.ts:205); no per-kind
  math exists to diverge.
- Intelligence gating intact as constants with enforcement:
  `GROUP_MIN_TRADES = 3`, `MATERIAL_WIN_RATE_GAP = 20`
  (`lib/intelligence/analysis.ts:50–52`, enforced at lines
  124–126 and the group filters at 405/417); statements are
  association-phrased by construction of the answer builders.
- Digests are **computed on read** (`buildDigest` in
  `lib/intelligence/queries.ts:316`, weekly/monthly wrappers at
  413/425); the only writer of persisted insights in the
  codebase is `lib/coach/service.ts` into `ai_insights` —
  verified by grep for `ai_insights` insert/upsert across `lib/`
  (single hit).

### 7. Mobile — PASS

- No financial math in `apps/mobile`: a grep for P&L/ROI/R
  computation shapes returns only display logic over **stored**
  values (e.g. choosing a profit/loss tone from the stored
  `trade.pnl` in `app/(app)/trade/[id].tsx:245`). `@itg/calc` is
  deliberately not linked (Phase 21 M2 decision, still true).
- All writes go through `src/api.ts` helpers onto `/api/mobile/*`
  endpoints; reads are direct RLS; the session lives in
  SecureStore (`src/supabase.ts`, `src/auth.tsx`) with the
  chunked adapter for the 2,048-byte limit.
- Review round-trip present by construction (Phase 25):
  strategyId + setupName are pre-filled from the trade read and
  submitted with the full form, the Phase 24 requirement.
- Standalone install preserved (own `package-lock.json` +
  `node_modules` under `apps/mobile`); root `package.json`
  workspaces unchanged (`apps/*`, `packages/*`).
- Spec status accurate after the F2 fix below.

### 8. Security — PASS WITH FINDINGS (F3, F10, F11)

- `security:check` passes (373 files); live headers were
  verified in Phase 27 including the CSP with
  `object-src 'none'` (`lib/security/headers.ts:33`).
- Auth callback validates `next` through `safeNextPath`
  (`app/auth/callback/route.ts:21`, `lib/auth/redirect.ts:20`)
  — the Phase 27 open-redirect fix is in place.
- Admin: every admin action sits behind `adminGate`
  (`lib/admin/access.ts`, used throughout `lib/admin/actions.ts`),
  re-checked server-side per call.
- Secrets: a credential-shape scan of the whole repo (key
  prefixes, private-key blocks, JWT shapes) returns **0** hits;
  `SERVICE_ROLE` references are env-var reads in server code and
  docs only — no values.
- Carried from Phase 27, unchanged (F3/F10/F11): engine
  functions exported from `"use server"` modules trust a
  caller-supplied `userId` and write via the service role —
  latent today because no client component imports them, and a
  session check inside the engines would be wrong (the mobile
  Bearer path calls them legitimately); the drafted fix is a
  module move, its own change. CSP still allows
  `script-src 'unsafe-inline'` (nonce-CSP drafted). The rate
  limiter is in-memory per instance (shared-store swap drafted).

### 9. Error handling & UX honesty — PASS

- All three boundaries exist and are branded:
  `app/error.tsx` (digest as support reference, never a stack),
  `app/not-found.tsx`, `app/global-error.tsx` (Phase 27 — none
  existed before it).
- No fake data: a grep for demo/mock/sample/fake across
  components and app code returns only honesty comments and the
  legitimate "demo / paper trading" **profile field** — no
  component presents invented numbers as real; skeletons
  explicitly carry no text (`components/ui/skeleton.tsx`).
- "Not Provided" pattern present where the spec demands it:
  onboarding wizard copy ("will show as Not Provided, never as
  zero"), profile page contract, and validation comments
  (`lib/auth/validation.ts:118`).

### 10. Documentation consistency — PASS WITH FINDINGS (F1, F2 — both fixed)

- Present: phase docs 19–28, the 12-hour mandate final report,
  `docs/ai-coach-foundation.md`, `docs/mobile-app-specification.md`,
  `docs/runbooks/restore.md` (Phase 28), architecture/database/
  security docs.
- Mobile README spot-checks all accurate: Phase 21 M2 shell,
  Phase 25 write activation, Phase 26 coach, the
  `--workspaces=false` standalone-install warning, the
  expo-image-picker note.
- **F1 (fixed):** root `README.md` status section was Phase
  14-era — wrong deployment id, phases ending at 14, and a
  "Still blocked: GitHub 403" line for a blocker closed on
  2026-10-27. Rewritten to the Phase 29 status with a
  Phases 15–29 index; the historical 1–14 entries are preserved
  as written at the time.
- **F2 (fixed):** `docs/mobile-app-specification.md` header
  still read "specification only, no mobile implementation
  authorized" above body sections recording M1/M2/M3/Phase 26
  as DONE. Header now states the implemented status.

## Findings register

| # | Severity | Area | Finding | Recommended action |
| --- | --- | --- | --- | --- |
| F3 | Medium | Security (defense-in-depth) | Engine functions exported from `"use server"` modules trust caller-supplied `userId` + service role (Phase 27). Latent: no client component imports them, so no action id ships to a browser. | Move engines to non-`"use server"` modules (`lib/gamification/engine.ts` etc.) as its own change; do NOT add session checks inside engines (mobile Bearer path). |
| F4 | Medium | Product decision | Achievement %-criteria (`weekly_journal_pct`/`monthly_journal_pct` = 100) award with a single fully-journaled trade in the window. Engine evaluates the seed exactly; the ≥1-trade guard (null on empty window) is the only volume floor. | Ezat decides whether the seed should require a minimum trade count; if so, it is a seed + criteria change, not an engine change. |
| F5 | Low | Backup/DR | Supabase PITR is OFF (verified Phase 28 via Management API); recovery rests on plan-cadence backups + the local logical snapshot. | Ezat enables PITR in the dashboard (paid add-on, ~2 min) or accepts the ~24 h RPO knowingly. |
| F6 | Low | Monitoring | No error tracking, uptime monitor or alerting is connected (Phase 27). | Adopt the Phase 27 recommendations (Sentry + uptime on /login + Vercel Analytics) when Ezat approves the sign-ups. |
| F7 | Low | Mobile scope | No discipline-event endpoint and no goal field-editing endpoint exist; documented gaps from Phase 25, worked around honestly in the app. | Add Phase-21-style core extractions only if Ezat wants those two actions on mobile. |
| F8 | Info | Tooling | `apps/mcp-server/dist/` trips `security:check` (compiled output crosses the service-role boundary scan). | Standing procedure, re-verified this phase: delete `dist/` after building the MCP server locally; it is gitignored and rebuildable. |
| F9 | Info | Coach activation | LLM narration is built, guarded and mock-tested but inactive: no `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` in production. Coach is fully functional in deterministic mode. | Ezat provides one key via the Secure Vault; set as a Vercel production env var; redeploy; verify one narrated answer. No code change. |
| F10 | Low | Security | CSP `script-src 'unsafe-inline'` remains (Phase 27 drafted the nonce-CSP project). | Schedule the nonce-CSP change separately with full Playwright coverage. |
| F11 | Low | Security | Rate limiter is in-memory, per instance (documented accepted risk since Phase 20). | Swap to a shared store behind the existing limiter signature when traffic warrants. |
| F12 | Info | Dependencies | `npm audit` cannot run in the sandbox (registry refuses the endpoint); CI runs `npm audit --audit-level=high` + gitleaks on every push. Major upgrades (Next 16, zod 4, Tailwind 4) are pending as future work, deliberately not bundled here. | Keep majors as their own phase; rely on CI audit meanwhile. |
| F1 | Low | Docs | Root README status section stale (Phase 14-era). | **Fixed in this audit.** |
| F2 | Low | Docs | Mobile spec header contradicted its own status lines. | **Fixed in this audit.** |

## Roadmap close-out — what shipped (Phases 20–28)

- **Phase 20** — Coach Engine behind `lib/coach/service.ts`;
  trade-close insight triggers; internal compute endpoint;
  MCP `compute_coach_insights` (13 tools total).
- **Phase 21 M1+M2** — service-core extraction (web actions are
  thin adapters), the full mobile endpoint set on one
  auth/audit pipeline, profile bootstrap closing the
  profile-less finding, and the Expo shell.
- **Phase 22** — Interactive AI Coach on web: 12 intents,
  FACT/INFERENCE/RECOMMENDATION answers, guarded LLM narration
  with deterministic fallback.
- **Phase 23** — Advanced Trading Intelligence (drawdown, risk
  behaviour, psychology/discipline splits, recurring mistakes,
  conditions, improvement plan, on-read digests) + 5 coach
  intents; found and fixed the `is_repeated_mistake` read-path
  bug and its missing writer.
- **Phase 24** — five-kind report catalog (page + PDF) with
  strict period bounds and the legacy PDF preserved.
- **Phase 25** — Mobile Write Activation: every journal write
  workflow in the app on the same endpoints, including the
  strategy/setup review round-trip proven at the database
  level.
- **Phase 26** — Mobile AI Coach on the shared Phase 22 handler
  (one pipeline, two auth adapters, one audit row per call).
- **Phase 27** — Production Hardening: CSP `object-src 'none'`,
  the app's first error boundaries, the auth-callback
  open-redirect fix, five audit-log gaps closed, RLS/index
  posture verified complete with zero live drift.
- **Phase 28** — Backup & DR: live posture verified, logical
  snapshot safety net built and executed outside git, restore
  runbook written; PITR enablement documented as Ezat's
  decision.

## Ezat-side open items (nothing else is outstanding)

1. **LLM API key** (F9) — Anthropic or OpenAI, via the Secure
   Vault; activates coach narration on web + mobile.
2. **PITR enablement** (F5) — Supabase dashboard → Database →
   Backups → Point in Time Recovery (paid add-on).
3. **Verification test account fate** — `itg-verification-test-20261027@example.com`
  still exists deliberately (10 trades / 390 XP of verification
  history); delete or keep is Ezat's call.
4. **Achievement criteria question** (F4) — whether the two
  100%-journal achievements should require more than one trade.
5. **On-device mobile verification** — the app is bundle- and
   contract-verified; the physical-device run is Ezat-side per
   `apps/mobile/README.md`.
6. **Monitoring sign-ups** (F6) and the **Phase 27 engine-module
   refactor** (F3) — approved-scope decisions, both drafted and
   ready to execute.
7. Supabase dashboard Auth settings checklist (Phase 27 §12)
   and an off-machine home for the logical snapshots
   (Phase 28 §7).

*End of the sequential roadmap. Production stands at Phase 27's
deployment `dpl_F9GjGimc2hGR4zV2ogKb8keztcpy`; the repository
HEAD at audit time is Phase 28's commit
`6f13c6b769e8b22e1346be4b1f528021c434f807` plus this document.*

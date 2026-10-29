# 12-hour autonomous mandate — final report, 2026-10-29

Mandate received 2026-10-29 09:44 EDT. All six stages were
completed **in order**; every stage ended verified,
deployed (where applicable) and committed. Production:
https://itg-traderos.vercel.app

## 1. Work completed

- **Stage 1** — Profile photo upload crash (Digest
  3390255549) reproduced, root-caused, fixed, verified
  locally and live, deployed, committed.
- **Stage 2** — Complete production audit: 17 real flows
  exercised end-to-end on the verification account and
  cross-checked against the live database. One genuine bug
  found, fixed, verified locally and live, deployed,
  committed.
- **Stage 3** — MCP read-only POC (`apps/mcp-server`):
  `get_trade` + `analyze_trade`, live-verified against real
  Supabase data incl. a cross-tenant isolation proof.
- **Stage 4** — 10 further read-only intelligence tools
  implemented under the design-first rule; 1 catalog tool
  deliberately deferred (see §11). Live smoke cross-checked
  against SQL ground truth with zero mismatches.
- **Stage 5** — AI Coach foundation architecture
  (`docs/ai-coach-foundation.md`).
- **Stage 6** — Mobile app architecture & specification
  (`docs/mobile-app-specification.md`). No implementation,
  per the mandate.

## 2. Work still remaining

- `compute_coach_insights` MCP tool — deferred by design
  (§11); needs the coach engine callable outside the web
  app rather than copied.
- Stage 5 rollout step 3: wiring the trade-close trigger
  to refresh the week's deterministic insights
  automatically (today refresh is a user action).
- Mobile implementation (spec phases M1–M5) — M1 is a
  web-side endpoint extraction; starts only on Ezat's go.
- The production verification test account still exists
  (deliberately: it is the identity used for all live
  verification). Recommend deleting it, or keeping it
  explicitly as the standing verification account.
- Supabase PITR/backup still off (see §14).

## 3. Production bugs found

1. **Avatar upload crash** — any profile photo >1 MB
   crashed /profile with a server-side exception
   (Digest 3390255549).
2. **Backtesting XP never awarded** — logging backtesting
   sessions recorded activity but the +15 XP/session
   (spec §24) silently never landed, and first-time
   submissions falsely replied "already logged — no new
   XP".
3. Investigated and **cleared** (not a bug): a Stage 4
   flag suggested the web analytics bundle filters trades
   on a nonexistent `deleted_at` column. Verified against
   the live schema: the filter targets `goals`, which has
   the column; trades queries do not use it.

## 4. Root causes

1. Next.js Server Actions' default **1 MB request-body
   limit** sat below the app's own upload limits (avatar
   2 MB, screenshots 5 MB). Files in between were rejected
   by the framework with a thrown 413 ("Body exceeded
   1 MB limit") *before* the action's validation could run.
   Storage bucket, RLS, paths and DB updates were all
   proven healthy.
2. `logBacktestingSessionAction` passed the idempotency
   key `"backtest:<date>:<n>"` — a non-UUID string — into
   `xp_transactions.source_ref_id`, a Postgres **uuid**
   column. The insert was rejected and `awardXp` swallowed
   the error, so the action concluded the sessions were
   already awarded. Every other XP caller passes a real
   row UUID, which is why only backtesting was broken.

## 5. Fixes

1. `serverActions.bodySizeLimit: "10mb"` (above every app
   limit + multipart overhead; app limits unchanged);
   one shared avatar validation module used by both the
   server action and the client picker (invalid files get
   the inline error and are never submitted);
   `revalidatePath("/profile")` so the new photo appears
   immediately. Full record:
   `docs/avatar-upload-fix-2026-10-29.md`.
2. `deterministicUuid()` (MD5 → RFC 4122 layout) maps the
   per-session key to a stable valid UUID. Idempotency
   preserved (same date+index → same UUID → never
   double-awards); no migration needed — re-saving a date
   safely backfills previously unawarded sessions.
   Record: `docs/stage-2-production-audit-2026-10-29.md`.

## 6. Tests and exact results

Final state at the last commit: **Vitest 406/406**
(43 files), **Playwright 36/36**, typecheck (web + calc +
mcp-server) pass, lint pass, production build pass
(30 routes), security check pass (248 files).

Per stage: Stage 1 — 356/356 Vitest (+5: avatar validation
boundaries + framework-limit config guard), 36/36
Playwright. Stage 2 — 360/360 (+4 deterministicUuid /
regression guard). Stage 3 — 381/381 (+21 MCP: isolation,
smuggled-argument rejection, metrics drift, audit-once,
rate limit, protocol). Stage 4 — 406/406 (+25 intelligence
tools with hand-computed aggregate fixtures).

## 7. Production verification

- Stage 1: 21/21 live checks — 1.5 MB photo uploads and
  swaps immediately; 3 MB and non-image files fail
  gracefully inline; avatar persists across reload and
  logout/login; regression routes + PDF endpoint 200;
  security headers present.
- Stage 2: audit flows all passed live (trade create/
  review with dashboard P&L 1.20 matching the centralized
  calc, 1.5 MB + 3 MB screenshots, goals, risk rules,
  plan, weekly review +30 XP, reports + PDFs, honest
  certificate state, admin gate denying the trader role,
  auth rate limiter engaging and recovering). Backtesting
  fix verified live: XP 185 → 200 exactly, idempotent on
  re-submission.
- Stages 3–4: MCP live smokes against real Supabase with
  SQL ground-truth cross-checks (zero mismatches); audit
  rows independently re-queried (7 rows for the POC calls;
  34 for the Stage 4 runs, one per call).

## 8. Vercel deployments (this mandate)

- `dpl_8UmAtBoEXX5gzryawn6GqF2s7ifT` — Stage 1 fix, READY,
  production.
- `dpl_3EWyBAbYgatTanG2P8rajQQ2RcLC` — Stage 2 fix, READY,
  production.
- Stages 3–6 changed no web-app code (MCP server is a
  local stdio process by design; Stages 5–6 are
  documents), so no further deployments were needed or
  made. (Immediately before the mandate, the /profile
  crash fix Digest 2190686083 was deployed as
  `dpl_RJzDBQ1Z9Y3HmV9e7e6iVAqjapSx`.)

## 9. GitHub commits (all verified as `main` HEAD after push)

- `32febe90b75899f33127be9a31e43d37777f574e` — Stage 1
  (272 files).
- `af7840f5885cc885b1d8a07874f0fe21ba610912` — Stage 2
  (276 files).
- `f10ebb54722e3339cf3ff4c3edfca10c63566572` — Stage 3
  (293 files).
- `6eef3720df16ad89df8dd5b42ba62557ec6654fa` — Stages 4–6
  (297 files).
- This report's commit follows it.

## 10. MCP POC status

**Working and live-verified.** `apps/mcp-server` speaks
the MCP JSON-RPC subset over stdio (initialize, ping,
tools/list, tools/call; no SDK dependency). Tenant
identity comes **only** from the validated Supabase access
token (`auth.getUser` on every call); tool schemas accept
no user/tenant id (smuggled ids rejected pre-query); reads
run through RLS plus explicit `user_id` filters; the
service-role key is read in exactly one module and used
only to insert audit rows; one audit row per call; 60/min
per-user rate limit; 10 s timeouts; bounded, capped
results; another trader's data returns the identical
`not_found` as nonexistent data (proven live with a
second throwaway account, created for the probe and
deleted after).

## 11. MCP tools implemented (12)

Stage 3: `get_trade`, `analyze_trade` (with `@itg/calc`
recomputation + `metrics_match` honesty, plan adherence
with "not computable" instead of guesses).

Stage 4: `get_recent_trades`, `get_performance_summary`,
`get_strategy_performance`, `get_session_performance`,
`get_psychology_summary`, `get_risk_status`,
`get_goal_progress`, `get_discipline_status`,
`get_level_status` (stored `user_levels` only — the
scoring engine is never duplicated), `get_weekly_review`
(stored snapshot + live summary shown side by side).

**Deferred:** `compute_coach_insights` — the coach engine
exists only as web-app code; copying it into the MCP
server would create a second source of truth for coach
logic. It stays a design entry until the engine can be
called directly.

## 12. AI Coach status

Foundation architecture complete
(`docs/ai-coach-foundation.md`): the existing
deterministic Phase 9 engine remains the coach's core;
the target pipeline is trade closed → idempotent analysis
job → MCP tool reads (authenticated as the trader) →
deterministic analysis → optional future LLM narration
over tool outputs **only** (numbers must trace to a
metrics_snapshot; no LLM is a valid configuration) →
`ai_insights` → dashboard/coach surfaces that already
exist. Hard boundary: the coach can never execute,
modify or delete trades, change risk rules, or move
money.

## 13. Mobile app architecture status

Specification complete and implementation-ready
(`docs/mobile-app-specification.md`): React Native +
Expo (TypeScript — reuses `@itg/calc` and the shared
validation modules, so no calculation is ever
re-implemented); Supabase Auth with SecureStore +
biometric gate; reads direct under RLS; write flows with
side effects require first extracting the web Server
Actions into authenticated endpoints (phase M1 — the
spec is explicit that mobile must not re-implement XP/
risk/audit logic); online-only financial writes with
clearly-marked offline drafts; push via Expo Push with
decisions kept in the existing server engines; EAS
build/submit release strategy. **No mobile code was
written**, per the mandate.

## 14. Blockers

None blocking. Two items need Ezat-side action and are
unchanged from before the mandate:
- **Supabase PITR/backup is still off** for the ITG
  project — enable it in the Supabase dashboard (may
  affect billing).
- Vercel runtime-log endpoints remain unreachable through
  the connector's team scope (403); local reproduction
  against live Supabase remains the working substitute.

## 15. Security concerns

- PITR off (above) is the main operational risk: no
  point-in-time recovery for production financial records.
- The verification test account exists in production with
  a throwaway password; it holds only its own audit data,
  but it should be deleted or explicitly kept as the
  standing verification account.
- `audit_logs` FK wrinkle: identities without a
  `profiles` row (only artificial Admin-API users that
  never entered the app) cannot be audit-logged; the
  insert is rejected and the call proceeds — the same
  semantics as the web app. Real traders always have a
  profile row.
- MCP server runs locally with the service-role key in
  its process environment, used only for audit inserts;
  it is never exposed over a network listener (stdio).
- No secrets were committed at any stage; the security
  check (which scans for secret patterns and enforces the
  service-key boundary) passes at 248 files.
- Product-rule observation from the audit (not a bug):
  the "100% Weekly Journal" (+30 XP) and "Monthly
  Consistency" (+50 XP) achievements are percentage
  criteria with a ≥1-trade guard, so a single fully
  journaled trade unlocks both. The engine computes
  exactly what the seeded criteria say; if sustained
  volume is intended, the criteria need a minimum trade
  count — Ezat's call, deliberately not changed during a
  bug-fix stage.

## 16. Recommended next phase

1. **Phase 20 — Coach trigger + engine extraction:**
   wire trade-close → idempotent weekly-insight refresh,
   and extract the coach engine behind an authenticated
   internal endpoint so `compute_coach_insights` can be
   exposed through MCP without duplication.
2. **Mobile M1** (endpoint extraction) when Ezat wants
   the mobile build to start — it is a web-side,
   behavior-preserving change with the full verification
   suite as its gate.
3. Housekeeping decisions for Ezat: enable PITR; decide
   the test account's fate; decide the achievement
   criteria minimum-volume question.

# Task 28 — Final Institutional Production Audit

**Date:** 2026-11-04. **Scope:** closing audit of Master
Remaining Work v2 (Tasks 1–27) against LIVE evidence —
production database (read-only SQL via the Management API),
production HTTP (curl SSR + headers), and the local tree
(full battery). No deployment, no production writes, no
fixes authored beyond this document. Account A and Ezat's
own account were only read; both baselines were re-verified
byte-identical after every check, including after nine
production smoke suites ran against A.

**Overall verdict: PASS WITH FINDINGS.** No FAIL area, no
Critical or High finding, and **no application defect
requiring a code fix was found**. The single (c)-class item
is a defect in a parent-side smoke *script*, not in the
application (§5.2). Everything else is the classified
residuals register (§6): Ezat decisions, and limitations
accepted by design and documented at the time they were
made.

Production at audit time: deployment
`dpl_4qC55xqhULALDi79Ci1CyAes6Jtf` (READY, alias
`itg-traderos.vercel.app` resolves to it — verified via
`get_deployment` on the alias), git HEAD
`eec87208567035a217e36abd327a574a348eef75`.

## Verdicts by area

| # | Area | Verdict |
| --- | --- | --- |
| 1 | Security (RLS, storage, headers, gates, public surfaces, secrets) | **PASS WITH FINDINGS** — zero drift; findings are the accepted residuals F10/F11 |
| 2 | Financial integrity (P&L, reversals, XP, certificates, plan/risk events) | **PASS** — full recomputation clean; one documented historical XP shortfall on the test account, classified as Ezat's decision |
| 3 | Background schedule (Task 17 cron) | **FINDING (classified, §3)** — no authorised fire has ever occurred outside manual verification; resolution is dashboard-side |
| 4 | Feature chain, Tasks 17–27 | **PASS** — every mechanism live-evidenced (§4) |
| 5 | Test battery + production smokes | **PASS WITH FINDINGS** — battery fully green; 8 of 9 smoke suites ALL PASS; the auth suite's 3 failures are a smoke-script defect (§5.2), the surface itself verified correct |

## 1. Security

### 1.1 Live RLS matrix — zero drift

Query (Management API SQL): `pg_class` ⋈ `pg_namespace`
for `relkind='r'` in `public`, left-joined to `pg_policy`,
plus `pg_policies` for permissive expressions.

- **34 public tables, RLS enabled on all 34, every table
  carries ≥ 1 policy.** Per-table counts: achievements 2,
  ai_insights 1, assets 2, audit_logs 1, certificates 1,
  daily_activity 3, discipline_events 1, goal_progress 3,
  goals 3, lessons 3, level_assessments 1, levels 2,
  monthly_reviews 3, motivation_messages 2, notifications
  2, onboarding_profiles 3, plan_events 1, profiles 3,
  psychology_records 3, report_runs 1, risk_events 1,
  risk_rules 3, setups 3, strategies 3, system_settings 1,
  trade_screenshots 4, trades 3, trading_plans 3,
  trading_sessions 3, user_achievements 1, user_levels 1,
  verification_records 3, weekly_reviews 3,
  xp_transactions 1 — **74 public policies live**.
- **Reconciliation with migrations:** 82 `create policy`
  statements in `supabase/migrations/` (each preceded by a
  `drop policy if exists` guard — 82 of those too), 8 of
  them on `storage.objects` → 74 public + 8 storage = 82.
  **Live count equals migration count exactly.**
- **Zero** policies with `qual = 'true'` or
  `with_check = 'true'` live; zero `using (true)` in the
  migration text.
- **Append-only shape intact:** ai_insights, audit_logs,
  certificates, level_assessments, plan_events,
  risk_events, user_levels and xp_transactions each carry
  exactly one policy, `SELECT` own-or-admin, role
  `public` — all writes are service-role-only, exactly as
  the engines assume (the Task 19/23 pattern).

### 1.2 Storage posture

`storage.buckets`: `avatars` public = **true** (public-read
by design, documented since Phase 16/27), `trade-screenshots`
public = **false**. All 8 `storage.objects` policies are
owner-scoped except `avatars_select_public`, as designed.

### 1.3 Production security headers (live, 2026-11-04)

`curl -sI https://itg-traderos.vercel.app/login`:

- CSP: `default-src 'self'; script-src 'self'
  'unsafe-inline'; style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: https:; font-src 'self' data:;
  connect-src 'self' https://*.supabase.co
  wss://*.supabase.co; object-src 'none';
  frame-ancestors 'none'; form-action 'self';
  base-uri 'self'`
- HSTS `max-age=63072000; includeSubDomains; preload`;
  `X-Content-Type-Options: nosniff`; `X-Frame-Options:
  DENY`; `Referrer-Policy: strict-origin-when-cross-origin`;
  `Permissions-Policy: camera=(), microphone=(),
  geolocation=()`.
- The one known softness is unchanged and documented:
  `script-src 'unsafe-inline'` (nonce-CSP drafted in
  Phase 27, unscheduled — register item R-10).

### 1.4 Admin gate pattern

- `app/admin/layout.tsx` denies via `notFound()` (the
  Task 4 stream-leak fix), and **all 8 admin pages**
  (`page.tsx`, achievements, audit, certificates, levels,
  settings, users, users/[id]) call `requireAdmin()`
  before any query — verified by grep, 8/8.
- The Task 4 / onb-admin production smoke (non-admin →
  404, no admin data in payloads) passes today (§5.2).

### 1.5 Public surfaces inventory

Middleware (`apps/web/middleware.ts`): signed-out access
is limited to `/`, `/login`, `/register`,
`/forgot-password`, `/reset-password`, `/auth/*` and
`/verify/*`; everything else redirects to `/login`.
`/api/*` bypasses middleware and authenticates per route
(mobile Bearer pipeline, coach session, intelligence
shared secret — each verified in its own task).

- `/verify/<id>` live-checked signed-out with a fabricated
  id: HTTP 200, uniform **"Not verified"**, no record data
  (Task 24 whitelist behaviour intact in production).
- The market-data panel is an authenticated `/analytics`
  section (§4), not a public surface.

### 1.6 Secrets hygiene

- `security:check` passes over 447 files (§5.1), which
  includes the credential-shape scan (0 hits at Phase 29;
  the scan is part of the check re-run today).
- Both `.env.example` files eyeballed: placeholders only
  (`your-project-ref`, `your-supabase-anon-key`, commented
  key names for the optional LLM / market-data keys, a
  localhost URL). No values.
- **Phase 29 finding F3 is CLOSED.** The engine-functions-
  in-`"use server"`-modules exposure was fixed in Task 13:
  `lib/gamification/actions.ts` no longer exists, engines
  live in `lib/*/service.ts` modules (the `"use server"`
  strings remaining in those files are historical comments
  documenting the move), and no session check was added
  inside the engines, preserving the mobile Bearer path.

## 2. Financial integrity (live recomputation)

### 2.1 Stored P&L vs recomputed — exact

Population: 16 trade rows globally (9 closed, 6 reversed,
1 cancelled, 0 open) — A's 10 (8 closed / 1 reversed /
1 cancelled) + Ezat's 6 (1 closed / 5 reversed).

Recomputed every closed trade in SQL with the central
formula (`calcPnl`: `(exit − entry) × size − fees` for
long, mirrored for short):

- **9 closed trades: 0 P&L mismatches** (tolerance 1e-5),
  **0 `is_win` mismatches** (`is_win = pnl > 0`),
  **0 closed trades missing pnl/exit/closed_at**,
  **0 open trades carrying a pnl** (there are no open
  trades in production).

### 2.2 Reversal integrity — clean, chains legitimate

- 6 reversed rows: 3 voided (NULL link), 3 corrections
  (linked). **0 self-links, 0 dangling links, 0 cross-user
  links, 0 non-reversed rows carrying a link, 0 correction
  targets shared by two originals.**
- 2 correction targets are themselves reversed; inspected
  row by row, both are legitimate lifecycle chains, same
  user throughout: one trade corrected → its correction
  corrected again → the final correction voided (NULL
  link). This is the documented correct/edit/delete
  composition, not corruption.

### 2.3 XP ledger — exact, one documented shortfall

- Fixed-reason amounts match `XP_TABLE` exactly across
  the whole ledger: trade_journal 10 ×13, backtest_session
  15 ×7, weekly_review 30 ×2, risk_discipline 25 ×2;
  achievement rows vary (10/25/30/50) as config-driven
  awards do.
- **0 duplicate (user_id, reason, source_ref_id) groups;
  0 rows with a null source ref.**
- Per-user sums: **A = 390 XP over 22 rows** (the
  protected baseline, exact); Ezat = 110 over 8 rows.
- **The Task 26 discrepancy is re-confirmed live:** A has
  **9 backtesting sessions** recorded in `daily_activity`
  (7 days) but only **5 backtest_session XP awards** —
  4 sessions × 15 = **60 XP unawarded**, from the known
  pre-fix silent-failure window (the activity upsert lands
  before the award by design). The activity record is the
  source of truth; backfilling moves A's protected
  baseline, so it stays **Ezat's decision (R-05)** — not
  repaired, not hidden.

### 2.4 Certificates vs assessment evidence

- The `certificates` table is currently **empty** in
  production (all Task 24 proof certificates were issued
  to throwaway accounts and cascade-deleted with them;
  A holds 0, as required). The check "any level
  certificate whose referenced assessment is not a pass"
  therefore returns **0 violations over 0 rows — vacuous
  today**. The invariant itself was proven end-to-end in
  Task 24's production verification (server-side pass
  re-read, snapshot fields matching the pass row, and —
  after the entity-id fix — the audit row landing).
- The audit trail preserves that proof: exactly **1
  `certificate.issued`** row and **1
  `admin.certificate_revoke`** row exist (the Task 24
  post-fix issuance + revocation; user since deleted, rows
  append-only). Before the Task 24 fix the count was 0 —
  the defect and its fix are on record in
  `docs/task-24-certificates.md` §12.

### 2.5 Plan / risk event integrity

- `plan_events`: 4 rows globally (2 `market`, 2
  `session`) — exactly A's Task 19 fixture. **0 duplicate
  (user, trade, term) rows, 0 orphaned or cross-user
  trade references**; both partial unique dedupe indexes
  from migration 0019 are present
  (`plan_events_trade_term_uidx`,
  `plan_events_day_term_uidx`).
- `risk_events`: 3 rows (1 warning, 2 positive) — A's
  stored events; **0 orphaned/cross-user references**.

### 2.6 Audit-log population note

560 audit rows; 238 carry `user_id = NULL`. Broken down
by action, these are fully explained, not anomalous: the
bulk are mobile-API and trade-lifecycle rows belonging to
the many verification throwaway accounts deleted across
Tasks 12–27 (rows preserved append-only, user nulled on
account deletion), plus the 10 `intelligence.background_run`
system rows, 7 `coach.chat` rows (unauthenticated/invalid
calls are audited with a null actor by design) and admin
rows, which key on `actor_id`. The Phase 29-era count of
52 grew for exactly this reason — more verification
accounts lived and died since.

## 3. The cron question — classified, not resolved

Declared schedule (`apps/web/vercel.json`, shipped in
every deployment): `30 6 * * *` → `/api/intelligence/run`
daily at **06:30 UTC**.

Live evidence — **all 10** `intelligence.background_run`
audit rows ever written:

| Timestamp (UTC) | Pair | Signature |
| --- | --- | --- |
| 2026-11-03 03:05:16 / 03:05:21 | ×2 | Task 17 production verification |
| 2026-11-03 03:16:43 / 03:16:44 | ×2 | Task 17 verification, continued |
| 2026-11-03 07:14:39 / 07:14:54 | ×2 | Task 19 verification (planEvents 4 → 0) |
| 2026-11-04 07:22:49 / 07:22:51 | ×2 | manual verification pair |
| 2026-11-04 19:18:11 / 19:18:13 | ×2 | Task 23 verification (assessments 1 → 0) |

Findings:

1. **Every row arrives in a pair seconds apart** — the
   manual "run it twice, second run must be all-zero"
   verification pattern used by Tasks 17/19/23. A scheduler
   fires once.
2. **No row exists at 06:30 UTC on any day** since the
   endpoint deployed (2026-11-02), although a registered
   daily cron would have produced single rows at
   2026-11-03 06:30 and 2026-11-04 06:30 UTC.
3. **However, a mis-registered fire would be invisible:**
   the handler returns a detail-free 401 on secret
   mismatch and writes its audit row only on the
   authorised path (`lib/intelligence/background.ts`,
   audit at the success branch; 401 at line ~549). Vercel
   Cron's native secret convention (`CRON_SECRET`) is not
   this app's `INTELLIGENCE_CRON_SECRET`, so even a
   registered cron would 401 silently.

**Classification:** there is **no evidence the schedule
has ever fired**, and strong evidence no *authorised* run
has occurred outside manual verification. Whether the
cause is (a) file-API deployments not registering
`vercel.json` crons, or (b) a registered cron failing
auth invisibly, **cannot be proven from any evidence
available in this environment** (Vercel runtime logs are
team-scope 403 via the connector). What would prove it:
the project's Cron Jobs list in the Vercel dashboard, or
aligning the cron secret convention and watching for a
06:30 UTC row. Severity **Low**: the pass is idempotent,
manually triggerable, and no stored data depends on it
for correctness. Carried to the register as an Ezat /
dashboard item (R-13).

## 4. Feature chain, Tasks 17–27 — one live-evidence line each

- **T17 Background pass:** 10 audit rows; every second
  run in a pair reports all-zero effects (idempotency
  holds in production, §3 table). Endpoint secret-gated,
  detail-free 401s (code, §3.3).
- **T18 Pattern engine:** `prod-smoke-t18.py` ALL PASS on
  the current deployment; A's two patterns (XAUUSD edge,
  repeated mistake ×3) unchanged.
- **T19 Plan enforcement:** 4 stored plan_events = the
  designed fixture, dedupe indexes live, 0 duplicates
  (§2.5); observational-only by code (no save path
  consults it — Task 19/20 design, re-grepped).
- **T20 Pre-trade gate:** `lib/gate/` contains **zero**
  insert/update/delete/upsert statements across all six
  files — the gate writes nothing, by construction and
  by grep.
- **T21 Pagination:** `fetchAllRows` is used in 13 lib
  files; **zero** `.limit(500)` remains in non-test lib
  code (the journal display cap in `getTradeListItems`
  is the documented sole survivor pattern — a bounded
  page fetch, not a computation truncation). The
  620-trade production proof stands from Task 21.
- **T22 Ladder:** live `levels` = 10 rows, **1 distinct
  scoring_config**; `prod-smoke-levels.py` ALL PASS
  (Strategy Operator + ITG Master Trader present,
  Platinum absent).
- **T23 Assessments:** exactly 2 assessment rows exist —
  A (strategy-operator, 59.2, hold) and Ezat
  (psychological-discipline, 63.6, hold) — and no new
  rows have appeared since Task 23's close-out despite
  page visits and background runs: state-signature
  dedupe holds in production.
- **T24 Certificates + verify:** §2.4 (invariant proven
  in-task; table currently empty by cascade) and §1.5
  (/verify uniform response live-checked today).
- **T25 Conditions view:** A's `/analytics` SSR today
  contains "Market conditions" and the "1 of 8" coverage
  line.
- **T26 Backtesting view:** same SSR contains
  "Backtesting research" and the "8 of 8" preparation
  figure.
- **T27 Market seam:** same SSR contains the panel with
  "Spot price", "Daily reference rate", "Gold-API",
  "Frankfurter" and the "not prices from your broker"
  boundary copy — live in production. Invariants by grep:
  the seam's only runtime consumers are
  `app/analytics/page.tsx` and
  `components/analytics/market-data.tsx`; the four other
  files matching "market-data" (`app/trades/new`,
  `app/dashboard`, `lib/intelligence/*`) contain only
  explanatory comments — **no coach use, nothing near
  trade entry, journal unaffected**.
- **Coach audit shape:** all 41 `coach.chat` rows carry
  exactly the key set `{intent, narration, outcome}`;
  `narration = 'llm'` count is **0 ever** — the narration
  seam is inactive without Ezat's key, deterministic
  answers everywhere, honestly labelled (R-02).

## 5. Battery and production smokes

### 5.1 Local battery (env sourced, 2026-11-04)

| Check | Result |
| --- | --- |
| Vitest | **1025/1025 passed** (baseline exact) |
| Typecheck (web + @itg/calc) | clean |
| Lint | 0 errors, 1 warning (pre-existing dashboard `<img>` LCP warning) |
| Production build | clean; **First Load JS shared 103 kB** (baseline held); BUILD_ID on disk verified |
| security:check | **passed, 447 files** |
| Playwright e2e (`CI=true`, repo root) | **36/36 passed** |

### 5.2 Production smokes (read-only, A's session)

| Suite | Result |
| --- | --- |
| prod-smoke-t10.py | ALL PASS |
| prod-smoke-levels.py | ALL PASS |
| prod-smoke-coach.py | ALL PASS (12/12) |
| prod-smoke-onb-admin.py | ALL PASS (17/17) |
| prod-smoke-risk.py | ALL PASS |
| prod-smoke-t18.py | ALL PASS |
| prod-smoke-t8.py | ALL PASS |
| prod-smoke-t9.py | ALL PASS |
| prod-smoke-auth.py | **3 FAILURES — smoke-script defect, see below** |

Note on inventory: the brief named profile/nav/plan/cal/
progress/ach/cert smoke files; those surfaces are covered
by the consolidated t8/t9/t10 suites (the per-page files
do not exist under those names) — all run above.

**The auth failures, diagnosed:** all three are the check
`"{label}: no violet classes"` asserting the bare string
`violet` is absent from the page HTML. Fetching `/login`,
`/register` and `/forgot-password` directly shows the
**only** violet occurrences in production HTML are
`app-ambient-orb-violet` (×2 each) — the shared
AmbientBackground's accepted faint-violet remnant, a
standing Page-1 design decision present on every page.
The coach smoke was previously fixed to exclude this
class; the auth smoke was not. **The application is
correct; the assertion is stale.** This is finding C-1
(§6): a one-line exclusion in
`~/workspace/.itg-helpers/prod-smoke-auth.py`, to be
applied by the parent in the closing pass and re-run to
ALL PASS. A false-failing smoke is worth fixing
precisely because it trains operators to ignore failures.

### 5.3 Baselines after all checks

`auth.users` = 4. **A: 10 trades / 390 XP / 23
notifications / 1 assessment / 0 certificates** —
byte-identical to the pre-audit baseline. **Ezat: 6
trades / 110 XP** — untouched. This audit wrote nothing
to production.

## 6. Residuals register — complete, classified

Classification: **(a)** Ezat decision/action ·
**(b)** documented limitation accepted by design ·
**(c)** defect requiring a fix.

### (a) Waiting on Ezat

| # | Item | What unblocks it |
| --- | --- | --- |
| R-01 | **Supabase PITR still OFF** (Phase 28/F5). SQL shows base WAL archiving on (`archive_mode=on`, wal-g `archive_command`, `wal_level=logical`); the PITR add-on flag is platform-side and was FALSE at last Management-API verification. | Dashboard → Database → Backups → PITR (paid add-on, ~2 min). Cannot be done via API. |
| R-02 | **LLM API key** for coach narration (Task 16 steps 5–8; F9). Seam + guard built; 0 llm-narrated answers ever. | Anthropic or OpenAI key via Secure Vault → Vercel env → redeploy → one narrated answer verified. No code change. |
| R-03 | **M2 physical-device re-test** of the fresh Task 12 APK (run 41522183387, commit 25eab1d8, SHA-256 verified). Agent-side finalization complete (21/21 endpoint contracts). | Ezat tests on his device and reports. M2 is not declared complete until then. |
| R-04 | **Plan limits as hard limits?** Task 20 decided plan breaches are at most CAUTION; only the two critical risk rules refuse a save. | Ezat's product call; reversing it is a save-semantics change. |
| R-05 | **A's 60 XP backfill** (§2.3): 9 sessions recorded, 5 awards. | Ezat decides; backfill moves the protected 390 baseline to 450. |
| R-06 | **Test account A fate** — keep or delete (holds the whole verification history). | Ezat's call. |
| R-07 | **Coach language scoping** — the coach answers in English today (no PS/FA handling in `lib/coach`); the skill's target set is EN/PS/FA. | Ezat decides scope; then it's a build task. |
| R-08 | **Offline support** — verified still absent: 0 serviceWorker registrations; Task 10 documented it as a product decision, not an oversight. | Ezat's direction to build it. |
| R-09 | **F4 achievement criteria** — the two 100%-journal achievements can be earned with one fully-journaled trade in the window; the engine evaluates the seed exactly (re-verified Phase 29 §3, unchanged). | Ezat decides whether the seed gains a minimum trade count (seed change, not engine change). |
| R-11 | **Monitoring sign-ups** (F6) — no Sentry/uptime tooling connected (no sentry dep in either package.json, re-verified). | Ezat approves the sign-ups (Phase 27 recommendations drafted). |
| R-12 | **Supabase Auth dashboard checklist** (Phase 27 §12) and **off-machine snapshot destination** (Phase 28 §7; snapshots currently live only in `~/workspace/itg-backups/`). | Dashboard pass by Ezat; destination choice by Ezat. |
| R-13 | **Cron registration resolution** (§3). | Vercel dashboard Cron Jobs inspection; optionally align the secret convention. Low severity. |
| R-14 | **Backtest results recording** (Task 26): a schema + form for per-session strategy/results would enable backtest-vs-live comparison; rejected by the builder as a product decision (one-input principle; hand-typed results remain self-reported). | Ezat decides whether to commission it. |
| R-15 | **Twelve Data upgrade** (Task 27, optional): intraday spot FX/indices need Ezat's API key AND a paid display plan (free Basic is internal-non-display per the provider's own pricing). The keyless panel already ships live. | Key via Secure Vault + plan decision; runbook in `docs/task-27-market-data.md` §8. |
| R-16 | **Coach taxonomy additions** — pairwise trending-vs-ranging intent (Task 25 §4) and a backtesting intent (Task 26): both deliberately not added to the Task-15-verified 17-intent set. | Ezat commissions a taxonomy change, or not. |
| R-17 | **Mobile endpoint gaps** (F7): no discipline-event endpoint; no goal field-editing endpoint (a goals handler exists for progress/creation). Documented since Phase 25. | Build only if Ezat wants those two actions on mobile. |

### (b) Documented limitations, accepted by design

| # | Item | Status on re-verification |
| --- | --- | --- |
| R-10 | **Nonce CSP** (F10): `script-src 'unsafe-inline'` remains; the nonce project is drafted, unscheduled. | Confirmed in live CSP (§1.3). |
| R-18 | **In-memory rate limiter** (F11): per-instance `Map` buckets in `lib/auth/rate-limit.ts`; its own header documents the shared-store swap (call sites unchanged). | Confirmed in code today. |
| R-19 | **Aux-read PostgREST ceiling** (Task 21 residual): computation reads paginate via `fetchAllRows`; some bounded display/aux reads rely on PostgREST's ~1k per-request ceiling. Flagged, not fixed, by design of Task 21's scope. | Confirmed: 0 `.limit(500)` in computation paths; the residual class is as documented. |
| R-20 | **Task 6 reporting honesty items (4):** (1) drawdown empty-state copy says the equity curve "is still shown in the figures above" on a page whose figures are tables — copy verified verbatim today in `components/reports/catalog-sections.tsx`; (2) historical Risk reports compose current rules/plan, not the period's; (3) "Goals completed" counts completed goals in the period-fetched set (`lib/reports/queries.ts`, path unchanged); (4) the daily Performance PDF remains the legacy summary. The fifth Task 6 item (500-cap) was fixed in Task 21. | All four re-verified as still accurately stated. Items (2)–(4) are composition facts; item (1) is a Low wording inaccuracy — grouped here because Task 6 already carries it as a documented gap for a future reporting pass, not a silent defect. |
| R-21 | **No /verify index/search page** (Task 24) — anti-enumeration by design; verification is by direct link only. | By design. |
| R-22 | **Stored weekly-review text is not consumed by intelligence** (Task 21 deliberate — rendering it verbatim on /reviews/weekly is honest; feeding save-time snapshots into "analysis" would be fake intelligence). `discipline_events` history is displayed nowhere (Task 8 documented). | Unchanged, deliberate. |
| R-23 | **Market panel scope** (Task 27): no indices (no qualifying keyless, terms-permitting source), FX is a daily reference rate — labelled as such — not an intraday quote; no candles, streaming or storage. | Live-verified (§4). |
| R-24 | **Assessment duration evidence** (Task 23): confirmation windows measure only engine-recorded assessments; nothing retroactive. | By design. |
| R-25 | **Dependency majors pending** (F12): Next 16 / zod 4 / Tailwind 4 deliberately not bundled; CI runs `npm audit --audit-level=high` + gitleaks per push (npm audit cannot run in this sandbox). | Unchanged. |
| R-26 | **MCP `dist/` trips security:check** (F8): standing procedure — delete after local MCP builds; done again during this audit's cleanup. | Procedure followed. |
| R-27 | **Interactive coach QA, production-URL variant** — the local-build baseline (11/11, Task 16) stands; the production-browser variant remains owed to the sandbox environment (production is unreachable from local Chromium through the proxy; the browser-task route is the parent's tool). The deterministic coach smoke against production passes (12/12, §5.2). | Partially verified — graded honestly as OWED, not passed. |

### (c) Defects requiring a fix

| # | Severity | Item | Fix |
| --- | --- | --- | --- |
| C-1 | Low (test harness) | `prod-smoke-auth.py` violet assertion false-fails on the accepted `app-ambient-orb-violet` class — 3 FAILURES against correct production behaviour (§5.2). | Exclude the ambient class in the check, as `prod-smoke-coach.py` already does; re-run to ALL PASS. Parent-side helper, applied in the closing pass. **Not an application defect.** |

No other (c) items. In particular: no RLS drift, no
P&L/reversal/XP discrepancy beyond the documented R-05,
no certificate-without-pass, no gate writes, no market
data near trade entry, no coach use of market data.

### Info-level observations (not findings)

- Two source comments still say "ITG has no market-data
  feed" (`app/dashboard/page.tsx:227`,
  `app/trades/new/page.tsx:33`, and similar in
  `lib/intelligence/*`). In context they mean "no feed
  behind your trades", which remains true post-Task 27;
  the user-facing Task 25 copy was already corrected.
  A future reader could misread them — worth a wording
  touch whenever those files are next edited, not a
  change in its own right.
- Phase 29 items F1/F2 (docs) were fixed in that audit;
  F3 is closed (§1.6); F5/F6/F9/F10/F11/F12 map to
  R-01/R-11/R-02/R-10/R-18/R-25 above; F4 → R-09;
  F7 → R-17; F8 → R-26.

## 7. What this audit could NOT verify (honest grading)

- **PITR add-on flag** — platform-side; SQL shows the WAL
  prerequisites on, but the flag itself needs the
  Management API / dashboard (last verified FALSE,
  Phase 28). Carried as R-01, not re-proven either way.
- **Cron registration, positively** — §3: invisible-401
  design + connector log limits make a definitive answer
  impossible from here. Classified, with the proof path
  named.
- **Interactive coach, production URL, in a real
  browser** — R-27 (environment limitation; local-build
  baseline + production deterministic smoke stand).
- **M2 on a physical device** — R-03, Ezat-side by
  definition.
- **Vercel runtime logs** — team-scope 403 via the
  connector throughout the programme; production
  behaviour was verified via responses and database
  state instead, as in every task.

## 8. Parent's closing script

1. **Smoke fix + re-run:** apply the C-1 one-line
   exclusion to `~/workspace/.itg-helpers/prod-smoke-auth.py`
   (exclude `app-ambient-orb-violet`, mirroring
   prod-smoke-coach.py) and re-run it — expect ALL PASS —
   so the programme's final smoke record is clean.
2. **Final snapshot:** recreate the `/tmp/sbmgmt.py`
   shim, source env, run
   `~/workspace/itg-backups/snapshot.py`; record the new
   snapshot directory in the closing report (the export
   covers all 34 public tables + storage + auth
   inventory).
3. **No deploy is required by this audit** — no
   application code changed. If the parent elects to fix
   the Info-level stale comments, that is a docs/comment
   change: rebuild → upload → manifest SHA-assert →
   create_deployment (file paths carry the `apps/web/`
   prefix) → poll READY → alias check → smokes t10 +
   levels + auth.
4. **Push** this doc (and any comment touch) via the
   GitHub connector; verify the new HEAD with
   list-commits. Expected message: "Task 28: final
   institutional production audit — PASS WITH FINDINGS,
   full-chain live re-verification, residuals register".
5. **Records:** append the Task 28 entry to
   `~/memory/2026-11-04.md`; update MEMORY.md commitments
   (Master Remaining Work v2: **28 of 28 tasks DONE**);
   close the todo list.
6. **Closing report to Ezat** in the mandated format,
   containing: the overall verdict (PASS WITH FINDINGS,
   no application defect requiring a code fix), the
   per-area verdicts, the C-1 harness note, the cron
   classification, and the **final ledger + decision
   bundle** below.

### Final ledger — Master Remaining Work v2, 28 of 28

| Task | Outcome | Production / commit evidence |
| --- | --- | --- |
| 1 Delete Trade | DONE — reversal-model removal, one audit per removal | 2460f370 |
| 2 Web Profile | DONE — completion/Verified-badge correction (single calculator) | profile-correction commit 981708c0 |
| 3 Global Navigation | DONE | completed in the 2026-11-01/02 sweep sequence |
| 4 Remaining route sweep | DONE — 10 units; admin stream-leak security fix | 2026-11-02 |
| 5 Levels/XP audit + competency evaluation | DONE — 8-dimension score established as the level basis | dpl_GiWYwL3aoQQWGdRKGrq634ED7U8r |
| 6 Professional Reporting | DONE — 5 kinds, one composition; honesty gaps registered (R-20) | cbb34551 |
| 7 Risk Management Engine | DONE — pre-insert evaluation, criticals block | bd1931de |
| 8 Weekly Review / Journal / Discipline / Psychology | DONE — save-time snapshots audited | 0c539e64 |
| 9 Notifications / Activity | DONE — all 9 kinds have producers (completed by T17/T19) | e63968ca |
| 10 Global UX State System | DONE — skeleton/boundaries v2; offline documented (R-08) | 20b1e5ed |
| 11 Responsive + Mobile Consistency | DONE — closed inside the PERF cycle | PERF commit 574be13b |
| PERF (inserted) | DONE — region hnd1, loading coverage; dashboard 6.47→1.96 s | 574be13b |
| 12 Mobile M2 Finalization | DONE agent-side — 21/21 contracts, fresh APK; **M2 itself stays OPEN on R-03** | run 41522183387 |
| 13 Security Hardening | DONE — F3 fixed (engines out of "use server") | 56b5fce6 |
| 14 Financial Integrity Audit | DONE — XP page-limit defect fixed; reconciliation exact (re-confirmed §2) | dpl_2KZBGDBSTjwSf7BFDngKy3U7AEon |
| 15 Coach Readiness | DONE as audit — 17 intents verified | 09c5dd63 |
| 16 Interactive Agent (pre-key) | DONE steps 1–4 — banned-content screen, guard; steps 5–8 wait on R-02 | 541bf8bf |
| 17 Background Intelligence | DONE — idempotent secret-guarded pass; schedule classified in §3 | 42a5df60 |
| 18 Pattern Engine | DONE — one engine, uniform materiality | 6ae96b6d |
| 19 Plan Enforcement | DONE — observational only, plan_events (migration 0019) | 7eb2d353 |
| 20 Pre-Trade Risk Gate | DONE — read-only gate; rules block, plan advises | 4c21530b |
| 21 Weekly/Monthly Intelligence + 500-cap fix | DONE — fetchAllRows across 16 reads; digest patterns | 0d922630 |
| 22 Competency Levels 1–10 | DONE — 10-band ladder; fractional fall-through defect fixed (migration 0020) | 4daf690e |
| 23 Level Assessment Engine | DONE — append-only assessments, floors/breadth/confirmation (migration 0021) | ce723013 |
| 24 Certificates / Verification | DONE — was-assessed level certs, public /verify; UUID entity-id defect found + fixed (migration 0022) | fc9a4104 |
| 25 Regime Intelligence | DONE — evidence-gated conditions view | b96c8090 |
| 26 Backtesting Intelligence | DONE — recorded-activity research; comparison honestly impossible (R-14) | 9ecd1fa5 |
| 27 Market Data (read-only) | DONE — keyless composite live; Twelve Data behind the seam (R-15) | eec87208 |
| 28 Final Audit | **THIS DOCUMENT** — PASS WITH FINDINGS | production dpl_4qC55xqhULALDi79Ci1CyAes6Jtf |

### Consolidated Ezat-decision bundle (for the closing report)

1. LLM API key (R-02) — activates coach narration, Task 16 steps 5–8.
2. Supabase PITR (R-01) — paid dashboard add-on.
3. M2 device re-test (R-03) — the only gate that can close M2.
4. Plan limits as hard limits? (R-04)
5. A's 60 XP backfill (R-05) and test account A's fate (R-06).
6. F4 achievement criteria (R-09).
7. Coach language scoping EN vs EN/PS/FA (R-07); coach taxonomy additions (R-16).
8. Offline support (R-08); monitoring sign-ups (R-11); Auth dashboard checklist + off-machine snapshot destination (R-12).
9. Cron dashboard check (R-13, Low).
10. Optional builds if wanted: backtest results recording (R-14), Twelve Data display upgrade (R-15), mobile discipline/goal-edit endpoints (R-17).

*End of Master Remaining Work v2. The system Ezat
specified — one input, many automatic outputs; nothing
faked; no autonomous execution — is the system verified
above, on the production deployment named in the header.*

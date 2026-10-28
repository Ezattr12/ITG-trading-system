# Phase 12 — Testing

Status: implemented locally, tested. **Supabase project
ITG-trading-system exists** (per the parent agent's brief) but
migrations 0001–0016 have NOT been applied to it and its keys
are NOT in the app env yet — no live-database test ran in this
phase, and none is claimed below. Vercel is connected (per the
parent agent's brief); nothing is deployed yet (deployment is
Phase 13). Not committed to GitHub (GitHub App push still
fails 403 — parent agent's blocker, unchanged). No external
AI/LLM service is connected.

## Spec covered

- §43, Plan v2 §7: full suite — unit, integration, DB (static),
  auth, RLS/security, UI smoke, critical workflows. Must pass
  before "complete": signup, login, profile, add/edit/delete
  trade, screenshot upload, goal creation/tracking, risk
  warnings, XP, levels, certificates, admin, user isolation.

## What was already covered (verified, not re-claimed)

The 296 pre-existing tests already covered, among others:
privilege-escalation guards (onboarding never writes `role` /
`verification_status`; migration 0015 triggers parsed from the
migration files), the admin 15-minute financial-view window
(in-window / expired / wrong admin / wrong trader / wrong
action / no rows), certificate eligibility (each criterion
blocking), coach insufficient data (0 and 1 trades), and the
RLS matrix (32 tables, RLS on, append-only tables
client-read-only, `system_settings` admin-only, no policy for
signed-out users on user data). Phase 12 re-ran all of them
green and closed the gaps below.

## Findings — two real bugs, both fixed

### 1. Certificate percentages were rounded before comparison (FIXED)

`lib/certificates/eligibility.ts` computed percentages with
`Math.round` and then compared them to the thresholds, so 39
of 49 trades (79.59%) passed the "at least 80%" journaling
rule, and 44 of 49 (89.8%) passed the 90% discipline rule.
The comparison now uses the exact percentage; only the
display string rounds. New boundary tests pin it:
exactly 80% (4/5) passes, 79.59% (39/49) fails, 40/50 passes;
exactly 90% (9/10) passes, 89.8% (44/49) fails; routine
exactly 8 days / 2 weeks passes, 7 days fails, 8 days in 1
week fails.

### 2. Vitest could not load modules using the `@/` alias (FIXED)

`apps/web/lib/analytics/queries.ts` and
`apps/web/lib/discipline/queries.ts` import `@/lib/...` at
runtime, and the Vitest config had no alias for `@`, so those
two production modules could not be imported by any test at
all (Phase 7 worked around this with relative imports in the
one file it hit). `vitest.config.ts` now mirrors
`apps/web/tsconfig.json` (`@` → `apps/web`). This unblocked
the isolation tests below.

## New tests

### User isolation at the query layer (18 tests)

A fake Supabase client (`apps/web/lib/test-helpers/fake-supabase.ts`)
applies the recorded `.eq("user_id", …)` / `.in(...)` / `.not(...)`
filters to seeded rows, so a query that forgot its `user_id`
filter returns the other trader's rows and fails — the failure
a missing filter would cause against RLS-less data. It is NOT
a Supabase emulator: it enforces no RLS and runs no SQL.

- `lib/trades/isolation.test.ts` (6): trade list returns only
  the requesting trader's rows, scoped and capped at 500; a
  pair filter never widens scope to another trader; trade
  detail returns null for another trader's id and for a
  missing id.
- `lib/analytics/isolation.test.ts` (3): the analytics bundle
  scopes trades, goals, XP and daily activity to the trader;
  the 500 most recent closed trades cap is asserted
  (600 seeded → 500 returned); honest empty state (no trades
  → null level/score, zero XP).
- `lib/discipline/isolation.test.ts` (3): goal list and
  single-goal read scope by `user_id`; another trader's goal
  id resolves to null.

### Certificate eligibility boundaries (12 tests)

`lib/certificates/eligibility-boundary.test.ts` — see Finding 1
above, plus whole-month eligibility only when every criterion
is met at its boundary, and ineligibility when exactly one
criterion misses.

### Critical workflow, end to end through the pure layers (6 tests)

`lib/workflow.test.ts` — one trader's week (5 closed trades)
through calcPnl → analytics summary → risk engine → weekly
report → coach insights → level score → certificate
eligibility, with no database and no network:
- P&L is computed from entry/exit/size/fees (98, −52, 48,
  −52, 28; total 70; 3 wins, 2 losses, 60% win rate).
- Over-leveraged trade (10× vs 5× max) is a critical breach;
  a within-limits trade is not, and the 5-trade disciplined
  streak hits the positive milestone.
- The weekly report names the most frequent losing setup
  (Order Block, 2 losses) and the most repeated mistake
  ("Chased the entry", 2×) from the trader's own data; the
  coach's insights all cite their metrics snapshots.
- Level score is 95.3 → Platinum for that disciplined,
  journaled, profitable week (discipline 100, risk 100,
  journal 100, psychology 80, strategy 100, consistency
  100, performance 60; goals excluded — none set).
- The same week does NOT earn a monthly certificate (only
  5 active days; routine needs 8 over 2 weeks).
- With 2 trades the coach reports insufficient data and
  generates nothing, instead of inventing insights.

## Playwright E2E — now actually running

- `@playwright/test` 1.64.1 installed (Next 15.5.28 requires
  ^1.51.1 as a peerOptional; 1.49.1 could not resolve).
  Chromium headless shell downloaded in the sandbox.
- `playwright.config.ts` + `e2e/smoke.spec.ts`: **6/6 pass**
  against the production build with NO Supabase env vars —
  landing page, login form, register form, signed-out
  redirects for 6 protected routes, security headers on
  `/login`, unknown routes redirecting to login.
- `npm run test:e2e` script added; CI now installs Chromium
  and runs the smoke suite after the unit tests.
- Two failures found while writing the suite were test bugs,
  not app bugs, and were fixed in the tests: `getByLabel("Password")`
  also matches the "Show password" toggle (targeted `#password`
  instead), and unknown routes return 200 for signed-out users
  because the middleware redirects them to `/login` — the test
  now asserts that redirect. A signed-in 404 check is a
  Phase 13/14 item.
- `test-results/` and `playwright-report/` added to `.gitignore`.

## What was NOT tested (pending — live only)

These cannot run locally and are **not** claimed as done:

| Test | Why it waits | Phase |
|---|---|---|
| Signup / login / logout against real Auth | Needs Supabase Auth + applied migrations | 13/14 |
| Add / edit / delete trade, screenshot upload, goal tracking, XP, levels, certificates, admin flows in the browser | Needs a live database; the pure layers are covered, the HTTP + DB path is not | 13/14 |
| Live RLS matrix — every role × every table, privilege-escalation attempts against the real DB, user A reading user B's rows via the API | Needs migrations applied to a staging project; the static matrix test parses migration files only | 13/14 |
| Storage upload to real buckets (avatars, trade-screenshots) | Needs the buckets from migration 0016 applied | 13/14 |
| Restore drill (Plan v2 §9) | Needs a production database with backups | 14 |

Also still open, carried from earlier phases: analytics and
goal measurement run over the 500 most recent closed trades
(the cap is now a tested behaviour, not a silent one);
aggregation should move into the database if a journal grows
past it. `npm audit` results are still unknown locally
(registry 403 in this sandbox); it runs as a CI step.

## Verification

- `npm test` — **326/326 pass** (296 before + 30 new:
  6 trades isolation, 3 analytics isolation, 3 goals
  isolation, 12 certificate boundaries, 6 workflow)
- `npm run test:e2e` — **6/6 pass** (Playwright, production
  build, no Supabase env vars)
- `npm run typecheck` — pass (web + calc)
- `npm run lint` — pass
- `npm run build` — pass (all routes; see build output)
- `npm run security:check` — pass (202 files scanned)
- `npm audit` — NOT runnable in this sandbox (registry 403
  `policy_denied`); CI step, unchanged

## Files created / changed

- Created: `playwright.config.ts`, `e2e/smoke.spec.ts`,
  `apps/web/lib/test-helpers/fake-supabase.ts`,
  `apps/web/lib/trades/isolation.test.ts`,
  `apps/web/lib/analytics/isolation.test.ts`,
  `apps/web/lib/discipline/isolation.test.ts`,
  `apps/web/lib/certificates/eligibility-boundary.test.ts`,
  `apps/web/lib/workflow.test.ts`, `docs/phase-12.md`
- Changed: `apps/web/lib/certificates/eligibility.ts`
  (exact-percentage comparison), `vitest.config.ts` (`@`
  alias), `package.json` (`test:e2e` script, Playwright
  devDependency), `package-lock.json`,
  `.github/workflows/ci.yml` (Playwright install + e2e step),
  `.gitignore` (test artifacts), `docs/architecture.md`,
  `README.md`

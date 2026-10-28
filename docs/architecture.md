# ITG TraderOS — Architecture

Status: Phase 13 — deployed to production at
https://itg-traderos.vercel.app (deployment
`dpl_GPjGVbmcqRuJg3iUFfZt6hBte5Q4`, READY). Migrations 0001–0016
applied to the live Supabase project (32 tables, RLS 32/32, 2 Storage
buckets, 8 policies); Vercel env vars set; live smoke checks pass
(`/` 200, `/login` 200, `/dashboard` 307 → `/login`, all security
headers). GitHub commit STILL blocked (403, App installation) — the
deployment was built from a staging tree, see `docs/phase-13.md`.
Seed skipped (dev-only guard) — system-config tables are empty in
production. See Execution Plan v2 §0 / §13 and `docs/security.md`
for the RLS matrix.

## Principles (spec §1–2, §50)

1. Database works for the trader, not the other way round.
2. Trade entry in 30–60 seconds; never ask for a calculable value.
3. No autonomous real-trade execution, no fund transfers, no withdrawals.
4. No fabricated data: missing = "Not Provided", verified = "Verified".
5. No unnecessary technology.

## System diagram

```
Browser (PWA-capable, responsive: desktop / laptop / tablet / mobile)
 → Vercel / Next.js 15 (Server Components, Server Actions, Route Handlers)
 → Supabase Auth (sessions, MFA-ready, OAuth-ready)
 → Supabase Postgres (RLS on EVERY table, user isolation)
 → Supabase Storage (screenshots, profile photos, certificate PDFs)
 → Supabase Realtime (notifications, XP/level updates)
 → Supabase Edge Functions (XP, levels, certificates, AI-coach aggregation, risk engine)
```

## Stack decisions (made in Plan v2, no questions asked)

| Decision | Choice | Why |
|---|---|---|
| Frontend | Next.js 15 App Router, TypeScript, React 19 | Single codebase, server components, best Vercel fit |
| UI | Tailwind CSS + shadcn/ui (Radix) | Accessible, consistent, dark trading terminal theme |
| Charts | Recharts / Lightweight Charts (Phase 4) | Analytics + candlesticks, not built in-house |
| DB / Auth / Storage | Supabase Postgres / Auth / Storage | One provider, RLS, PITR backups |
| DB access | Versioned SQL migrations + Supabase JS client | No ORM hiding RLS; migrations in `supabase/migrations/` |
| Money | Postgres `numeric(19,6)`, TS `decimal.js` | Never float for money, P&L or fees |
| Validation | Zod on every server boundary | Never trust the client |
| API style | Next.js Server Actions + Route Handlers | No separate backend server in v1 |
| Hosting | Vercel | GitHub → Vercel auto-deploy, Preview per PR |
| CI/CD | GitHub Actions | lint, typecheck, unit tests, secret scan |
| Time | UTC in DB, user timezone on display | Unambiguous audit trail |

## Repository layout

```
apps/web/app/        routes: (auth), onboarding, dashboard, trades, analytics,
                     risk, goals, progress, journal, calendar, reports, profile, admin
apps/web/components/ shadcn/ui + domain components
apps/web/lib/        supabase clients, money, dates, validation
packages/calc/       pure calculations (P&L, ROI, R, RR, profit factor,
                     expectancy, drawdown, XP, levels)
supabase/migrations/ 0001_… → 0010_… (see docs/database.md)
supabase/seed.sql    demo-only seed, never production
docs/                this file, database.md, runbooks/
```

## Security model (summary — full detail in docs/database.md)

- Supabase Auth; RLS on every table; trader sees only own rows.
- RBAC: `admin`, `trader` (default), `auditor` (read-only). Admins do **not**
  automatically access private financial data unless explicitly authorised.
- Service-role key is server-only, never in the browser bundle.
- All money is `numeric`; all financial facts are immutable — corrections
  are reversing trades, never in-place edits.
- Audit log is append-only.

## Environment variables

See `.env.example`. Public: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_URL`. Server-only:
`SUPABASE_SERVICE_ROLE_KEY`. No secrets in git, ever.

## Phase 2 — Authentication & Onboarding (done locally, not connected)

- Routes `/login`, `/register`, `/forgot-password`, `/reset-password`,
  `/auth/callback`, `/onboarding`, `/dashboard`, `/profile`.
- Cookie-based sessions via `@supabase/ssr`; `middleware.ts` protects
  app routes and refreshes the session; `lib/auth/session.ts` creates
  the profile row on first login (no `auth.users` trigger in Phase 1).
- Zod validation on every Server Action; in-memory rate limiting
  (5 login attempts / 15 min, 3 resets / hour); server-side audit
  writes when the service-role key is available.
- Onboarding wizard (5 steps, spec §7) with "Not provided" allowed
  everywhere; avatar upload to Storage bucket `avatars` (images only,
  2 MB), disabled with a clear notice until Supabase is connected.
- **Not connected yet:** no live Supabase project, so auth cannot
  log anyone in until env vars are set. Full detail: `docs/phase-2.md`.

## Phase 3 — Core Trading Journal (done locally, not connected)

- Routes `/trades`, `/trades/new`, `/trades/[id]`.
- Quick Entry (minimal, 30–60s, touch-friendly) + optional Advanced
  Review; server-calculated P&L / ROI / R / risk-reward / win-loss /
  duration — never user-entered. Search + filters, pagination.
- Screenshots to Storage bucket `trade-screenshots` (images only,
  5 MB, signed-URL previews), disabled with a clear error until
  Supabase is connected. OCR is architecture-only (`lib/trades/ocr.ts`);
  no OCR service is connected and no extraction is faked.
- Corrections are reversing trades; only open trades can be
  cancelled; closed trades are never deleted. Lessons with
  repeated-mistake detection; +10 XP per journaled trade.
  AI insight honestly unavailable until Phase 9. Full detail:
  `docs/phase-3.md`.

## Phase 4 — Dashboard & Analytics (done locally, not connected)

- Routes `/dashboard` (rewritten), `/analytics`, `/calendar`, `/progress`.
- All figures computed from the trader's real closed trades via
  RLS-enforced reads; equity curve, day/week/month P&L, R
  distribution, drawdown, strategy/session/direction/psychology
  breakdowns, trading calendar, XP/goal/discipline history.
  Recharts 2.15.4; every chart has a data-table alternative.
  Honest empty states everywhere; AI insights honestly unavailable
  until Phase 9. Full detail: `docs/phase-4.md`.

## Phase 5 — Risk & Psychology (done locally, not connected)

- Routes `/risk`, `/plan`, `/psychology`.
- Configurable risk rules (max risk/trade %, max daily loss,
  max trades/day, max consecutive losses, max leverage);
  engine warns on breach and logs to `risk_events` (new
  migration 0011 — the table did not exist in Phase 1 as the
  brief assumed); only the daily loss limit and leverage above
  maximum block a trade from being saved. Nothing auto-executes
  or closes a real trade. Trading plan form + plan-vs-actual
  from real closed trades; psychology by emotion / confidence /
  discipline vs performance. Full detail: `docs/phase-5.md`.

## Phase 6 — Goals & Discipline (done locally, not connected)

- Routes `/goals`, `/notifications`; discipline section added
  to `/dashboard`; header gains Goals / Notifications links and
  a real unread-count badge.
- Goals (daily/weekly/monthly/yearly) measured from real trades
  and activity where the type allows it; unmeasurable goals say
  so honestly, manual goals use trader-recorded progress.
  Discipline engine: Day 1 reminder / Day 2 warning / Day 3+
  stronger reminder from the last journaled day, supportive copy
  only, logged to `discipline_events` (new migration 0012 — the
  table did not exist in Phase 1 as the brief assumed) only on
  escalation. Motivation library selects context-aware messages
  from `motivation_messages` (seed extended). In-app
  notifications are created server-side on reminder escalation,
  goal reached, and goal completion. Full detail:
  `docs/phase-6.md`.

## Phase 7 — Gamification (done locally, not connected)

- Routes `/levels`, `/achievements`; header gains both links;
  dashboard level card and progress page now show the real
  level/score/XP.
- XP engine (`lib/gamification/`): spec §24 amounts from
  `@itg/calc` (`XP_TABLE`), awarded on trade journaled (+10),
  goal completed (+20), risk-discipline streak milestones (+25)
  and achievement unlocks (own `xp_reward`). Writes go through
  the service-role client — this fixes the Phase 3 bug where the
  signed-in-client insert into append-only `xp_transactions`
  was silently rejected by RLS. Awards are idempotent per
  (user, reason, source); penalties are explicit, logged,
  negative whole XP with a written reason, never silent.
- Levels are multi-dimensional, not profit-only: eight
  dimensions scored 0–100 from real stored data, weighted by
  the level's `scoring_config` (admin-configurable). A dimension
  with no data is excluded (weights renormalised), never scored
  as 0; no measurable dimension means no score at all.
  Performance is 5% of the score.
- Achievements are config rows (`criteria` jsonb); new ones
  need no code change. Awarded automatically when met, with
  XP and a notification, on trade save / goal completion /
  visiting the Levels or Achievements page.
- Weekly-review (+30) XP had no trigger yet at the end of Phase
  7: no weekly-review UI existed. Phase 8 wires it (see below).
  Backtesting (+15) XP had no trigger either: no
  `daily_activity` writer existed. Phase 9 wires it (see below).
  Full detail: `docs/phase-7.md`.

## Phase 8 — Certificates & reports (done locally, not connected)

- Routes `/certificates`, `/reports`, `/reviews/weekly`; PDF
  download handlers `/certificates/[certificateId]/pdf` and
  `/reports/pdf`; header gains all three links.
- Monthly certificate (`lib/certificates/`): issued only when
  every criterion is met — journaling ≥80% of ≥5 trades, risk
  discipline ≥90% with zero CRITICAL breaches, routine ≥8
  active days in ≥2 weeks, ≥1 completed weekly review — checked
  from real stored data, with the missing criteria shown
  honestly when not met. Unique ID `ITG-YYYYMM-XXXXXX`,
  idempotent per user+month, service-role write (no client
  INSERT policy, migration 0009).
- Reports (`lib/reports/`): daily/weekly/monthly summaries from
  real trades (P&L, win rate, profit factor, expectancy, R,
  strategy/session/psychology breakdowns, discipline, goals)
  with rule-based recommendations from the trader's own data
  only. In-app, printable, PDF download.
- Weekly review (`lib/reviews/`): the trader writes only the
  reflection; the week's aggregates are computed from real
  trades on save. Completing a review awards +30 XP via the
  existing `awardXp` path (idempotent per review) — the Phase 7
  weekly-review trigger is now wired. Backtesting XP (+15) had
  no trigger yet: no `daily_activity` writer existed. Phase 9
  wires it (see below).
- PDFs use pdfkit 0.17.2, generated on demand from the stored
  record — not stored in Supabase Storage in this phase (Phase
  13 step). Full detail: `docs/phase-8.md`.

## Phase 9 — AI Coach (done locally, not connected)

- Route `/coach`; dashboard AI insights section now shows the
  real latest coach insights; header gains the AI Coach link.
- Deterministic, data-grounded coach (`lib/coach/`): weekly
  analysis from the Phase 8 report summary plus the week's risk
  events and current streak — best/worst strategy and session,
  losing setup, repeated mistake, worst emotion, discipline,
  risk breaches, goals, and one focus for next week. Every
  insight cites its metrics snapshot; a rule with no supporting
  data produces no insight, and fewer than 3 closed trades in a
  week is reported honestly as not enough data. No external LLM
  is called and none is claimed; `buildLlmCoachPrompt` is a
  clearly-marked, uncalled extension point.
- Refresh is idempotent: an insight is stored only when no row
  for the same week, type and exact snapshot exists (checked in
  the action, enforced by the unique index in migration 0013).
  No new table — `ai_insights` already existed from migration
  0009 (31 tables total).
- Backtesting XP (+15) is now wired: the `/coach` backtesting
  log records the day's total sessions in `daily_activity` and
  awards once per session index via `awardXp`, so all spec §24
  XP triggers are now wired. Full detail: `docs/phase-9.md`.

## Phase 10 — Admin panel (done locally, not connected)

- Routes `/admin`, `/admin/users`, `/admin/users/[id]`,
  `/admin/certificates`, `/admin/achievements`, `/admin/levels`,
  `/admin/audit`, `/admin/settings`; header gains an Admin link
  for admins only.
- Layout gate: only `profiles.role = 'admin'` enters; others
  see a clear "not authorised" page, never a redirect loop.
  Admin writes use the service-role client (RLS blocks client
  writes to profiles/certificates/audit_logs); reads use the
  signed-in client so RLS still enforces the boundary.
- Privacy: the user list carries only non-financial summary
  fields; capital/income/historical P&L appear only after an
  explicit, audit-logged financial-view request, valid 15
  minutes (checked against the audit log, not a URL flag).
- Every admin action writes an `audit_logs` row (admin as
  actor, trader as target, action, entity, reason); a failed
  audit write is reported as a failure. `/admin/audit` lists
  the append-only log.
- AI config honestly shows the deterministic coach with NO
  external LLM connected; `ai_coach_mode` only accepts
  "deterministic" and `llm_connected` is not an editable key.
- Migration 0014 adds `system_settings` (32 tables total).
  Full detail: `docs/phase-10.md`.

## Phase 11 — Security hardening (done locally, not connected)

- Two privilege-escalation gaps found and fixed. Migration
  0015 adds BEFORE INSERT OR UPDATE triggers on `profiles`
  (blocks non-admin changes to `role` / `verification_status`)
  and `verification_records` (blocks non-admin changes to
  `status`), and pins `public.is_admin()` to
  `search_path = public`. Onboarding no longer writes
  `verification_status` to profiles — the trader's answer is a
  self-declaration stored in `onboarding_profiles.answers`
  only; the profile field is admin-set.
- Migration 0016 creates the `avatars` (public read,
  owner-only write) and `trade-screenshots` (private,
  owner-only) Storage buckets with matching
  `storage.objects` policies. No new table.
- Rate limits extended beyond auth: admin writes 20/min per
  admin per action (all 7 actions), trade creation 30/10 min,
  uploads 10/10 min (`lib/auth/rate-limit.ts`).
- Security headers on every route (`lib/security/headers.ts`,
  `next.config.ts`): HSTS, nosniff, DENY framing,
  referrer/permissions policies, CSP. Verified live against
  the production build.
- `scripts/security-check.mjs` (`npm run security:check`,
  runs in CI): service-role boundary + secret scan, 196 files
  clean. CI now checks out full history for gitleaks and runs
  `npm audit --audit-level=high` (`npm audit` is blocked by
  the sandbox registry locally, 403).
- Full RLS matrix (32 tables × anon/trader/admin/auditor):
  `docs/security.md`, regression-tested by
  `lib/security/rls-matrix.test.ts` (parses the migrations).
  The `auditor` role has no distinct access anywhere.
  Full detail: `docs/phase-11.md`.

## Phase 12 — Testing (done locally, not connected)

- Full local suite green: Vitest 326/326 (30 new: query-layer
  user-isolation tests for trades/analytics/goals, certificate
  eligibility boundary tests, 6-test end-to-end workflow
  through the pure layers) and Playwright 6/6 smoke tests
  against the production build with no Supabase env vars.
- Two real bugs fixed: certificate percentages were rounded
  before comparison (79.59% wrongly passed an 80% rule — now
  exact comparison, rounded display only), and Vitest had no
  `@/` alias, so two production query modules could not be
  loaded by any test (`vitest.config.ts` now mirrors the
  tsconfig alias).
- Test helpers: `lib/test-helpers/fake-supabase.ts` (in-memory
  fake client that applies recorded query filters — proves
  `user_id` scoping, enforces no RLS, runs no SQL).
- Live tests explicitly pending for Phases 13/14: signup/login,
  trade CRUD, screenshot upload, goal tracking, XP/levels/
  certificates/admin flows in the browser, live RLS matrix
  (every role × every table), Storage uploads to real buckets,
  restore drill. Analytics/goal measurement still run over the
  500 most recent closed trades (now a tested behaviour).
  Full detail: `docs/phase-12.md`.

## Phase 13 — Production Deployment (live)

- Live at **https://itg-traderos.vercel.app** (Vercel project
  `itg-traderos`, deployment `dpl_GPjGVbmcqRuJg3iUFfZt6hBte5Q4`,
  READY, production). Migrations 0001–0016 applied to the live
  Supabase project via the Management API query endpoint: 32 tables,
  RLS on 32/32, 2 Storage buckets, 8 policies. Env vars set
  (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`).
- Live smoke checks pass: `/` 200, `/login` 200, `/dashboard` 307 →
  `/login`, all six security headers present.
- GitHub commit still blocked (403, App installation). The deployment
  was built from a self-contained staging tree
  (`~/workspace/.itg-deploy-staging/`, vendored `@itg/calc`, pinned
  dependencies) via the Vercel MCP file-upload route, because only
  files under the Vercel root directory (`apps/web`) reach the build
  container and the monorepo's shared package lives outside it.
  The repo and the deployment will drift until the GitHub route
  works — see `docs/phase-13.md` before the next deploy.
- Seed skipped (dev-only guard): `strategies`, `levels`,
  `achievements`, `motivation_messages` are empty in production.
  Full detail: `docs/phase-13.md`.

## What Phase 1 does NOT include

- No live Supabase project, no Vercel deployment, no real credentials.
- XP / level scoring and achievements are implemented (Phase 7,
  `lib/gamification/`, `/levels`, `/achievements`) but untested
  against a live database — migrations are not applied yet.
- No AI Coach provider (Phase 9) and no OCR provider — the
  schema is OCR-ready (`trade_screenshots.ocr_extracted`, unverified until
  the trader confirms it).

## Phase 14 — Production Verification (partial — see docs/phase-14.md)

- Live API-level verification passed (84/88 harness checks; the 4
  failures are explained in `docs/phase-14.md`). Production seed
  applied and verified (9 strategies, 4 levels, 11 achievements,
  8 motivation messages). Full 32-table live RLS matrix in
  `docs/production-verification.md`.
- Two real bugs found live and fixed in the live database:
  migration `0018_fix_privilege_guard_tg_op.sql` fixes a `TG_OP`
  case bug (`tg_op = 'insert'` is always false — TG_OP is
  uppercase) that blocked profile creation for every new trader;
  migration `0017_production_config_seed.sql` is now idempotent
  after `ON CONFLICT` proved ineffective for NULL `user_id` rows.
  The same `ON CONFLICT` flaw was fixed in `supabase/seed.sql`.
  32 tables total, unchanged. No redeploy (no app code changed).
- **Verdict: not yet fully verified for real users.** Signed-in app
  flows were not exercised live from a real browser (this test
  environment's network blocks POSTs and cookie-bearing requests to
  the live site — verified against example.com/vercel.com as an
  environment limitation, not a deployment fault), PITR is off with
  no backups listed, and password-reset email delivery is
  unverified. GitHub commit still blocked (403).

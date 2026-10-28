# ITG TraderOS

**Institutional Trading & Performance Management System**
Org: ITG — Institutional Trading Group
Repo: https://github.com/Ezattr12/ITG-trading-system.git

A simple, intelligent, modern and gamified trading management platform:
trading journal, trader profile, performance analytics, risk management,
trading psychology, discipline tracking, goals, progress, achievements,
levels, certificates, AI coaching, reports, notifications, administration.

> **Core principle:** *The database should work for the trader, not the trader
> work for the database.* Trade entry targets 30–60 seconds. The system
> calculates P&L, ROI, R multiple and risk/reward — the trader never enters
> a value the system can calculate.

> **Financial safety:** This system does **NOT** automatically execute real
> trades. No autonomous order placement, no fund transfers, no withdrawals.
> Future exchange integration is read-only initially.

## Status (Phase 14 — Production Verification)

**Live: https://itg-traderos.vercel.app** — deployment READY
(`dpl_GPjGVbmcqRuJg3iUFfZt6hBte5Q4`, production). Migrations 0001–0018
applied to the live Supabase project (32 tables, RLS 32/32); env vars
set; live checks pass (`/` 200, `/login` 200, `/dashboard` 307 →
`/login`, all security headers). Production config seed applied and
verified (9 strategies, 4 levels, 11 achievements, 8 motivation
messages). **Not committed to GitHub** — push still fails 403 (App
installation needs `ITG-trading-system` with Contents write); the
deployment was built from a staging tree, see `docs/phase-13.md`.
**Verdict: not yet fully verified for real users** — see
`docs/phase-14.md`. Two critical bugs found live in Phase 14 are
fixed (migration 0018: `TG_OP` case bug that blocked profile creation
for every new trader; migration 0017 seed idempotency). Still open:
signed-in app flows were not exercised live from a real browser
(this test environment's network blocks the required requests —
see `docs/phase-14.md`), PITR is off with no backups listed, and
password-reset email delivery is unverified.

- ✅ Phase 1: scaffold, 10 migrations (29 tables, RLS), calc package, CI.
- ✅ Phase 2: auth (login/register/forgot/reset/callback/logout), protected routes via middleware, 5-step onboarding, profile + avatar upload, dashboard empty state. Tested locally — see `docs/phase-2.md`.
- ✅ Phase 3: core trading journal — Quick Entry + Advanced Review, server-calculated P&L/ROI/R/RR, search + filters, trade detail, screenshots, corrections via reversal, lessons + repeated-mistake detection. Tested locally — see `docs/phase-3.md`.
- ✅ Phase 4: dashboard & analytics — computed dashboard, equity curve, day/week/month P&L, R distribution, drawdown, strategy/session/direction/psychology breakdowns, trading calendar, progress page. Recharts 2.15.4. Tested locally — see `docs/phase-4.md`.
- ✅ Phase 5: risk & psychology — configurable risk rules + engine (warnings, breach log, only daily-loss and leverage breaches block a save), trading plan + plan-vs-actual, dedicated psychology page. Migration 0011 adds `risk_events` (30 tables). Tested locally — see `docs/phase-5.md`.
- ✅ Phase 6: goals & discipline — daily/weekly/monthly/yearly goals measured from real trades/activity (honest "not measurable yet" where they can't be), Day 1/2/3 discipline reminders (supportive, never shaming), context-aware motivation library, in-app notifications with unread badge. Migration 0012 adds `discipline_events` (31 tables). Tested locally — see `docs/phase-6.md`.
- ✅ Phase 7: gamification — XP engine (spec §24 amounts, service-role writes fixing the Phase 3 silent RLS failure), multi-dimensional levels Bronze→Platinum (not profit-only, configurable weights, missing dimensions excluded not scored 0), achievements from config rows with automatic awarding, `/levels` and `/achievements` pages, real level/XP on dashboard and progress. No new migration (all tables from Phase 1). Weekly-review XP was not yet wired (no review UI). Tested locally — see `docs/phase-7.md`.
- ✅ Phase 8: certificates & reports — monthly ITG Performance Certificate issued only when all criteria are met (journaling ≥80%, risk discipline ≥90% with zero critical breaches, routine, completed weekly review), unique certificate ID, on-demand PDF via pdfkit (not stored in Storage yet); daily/weekly/monthly reports from real trades with rule-based recommendations; weekly-review flow wiring the +30 XP trigger. No new migration (all tables from Phase 1). Backtesting XP (+15) still has no trigger (no daily_activity writer). Tested locally — see `docs/phase-8.md`.
- ✅ Phase 9: AI Coach — deterministic, data-grounded weekly analysis from real trades only (best/worst strategy and session, losing setup, repeated mistake, worst emotion, discipline, risk breaches, goals, focus for next week); every insight cites its metrics snapshot, fewer than 3 closed trades is reported honestly as not enough data, refresh is idempotent (migration 0013 unique index, no new table); no external LLM is connected (clearly-marked uncalled extension point only); dashboard now shows real latest insights; backtesting log wires the +15 XP trigger, so all spec §24 XP triggers are now wired. Tested locally — see `docs/phase-9.md`.
- ✅ Phase 10: Admin panel — `/admin` gated to role `admin` (clear "not authorised" page, never a redirect loop, self-demotion blocked); dashboard with real counts; user management (role/verification changes, audit-logged); certificates list + revoke with required reason; achievements create/edit from config rows; level threshold editing; system settings; full append-only audit log; financial data (capital, income, historical P&L) hidden by default and shown only after an explicit, audit-logged request, valid 15 minutes; AI config honestly shows deterministic coach with NO external LLM connected (no setting can claim one). Migration 0014 adds `system_settings` (32 tables). Tested locally — see `docs/phase-10.md`.
- ✅ Phase 11: Security hardening — RLS matrix for all 32 tables (`docs/security.md`, regression-tested against the migration files); fixed two privilege-escalation gaps (trader self-promotion to admin and self-verification, via migration 0015 triggers + `is_admin()` search_path pin; onboarding no longer writes `verification_status`); Storage buckets + policies via migration 0016 (`avatars` public-read/owner-write, `trade-screenshots` private/owner-only); rate limits on admin writes, trade creation and uploads; security headers on every route (verified live); `scripts/security-check.mjs` service-role boundary + secret scan (196 files clean, runs in CI); `npm audit` added to CI (blocked by the sandbox registry locally). Tested locally — see `docs/phase-11.md`.
- ✅ Phase 12: Testing — full local suite green: Vitest **326/326** (296 before + 30 new: query-layer user-isolation tests for trades/analytics/goals via an in-memory fake Supabase client, certificate eligibility boundary tests, and a 6-test end-to-end workflow through the pure layers from raw trade prices to P&L, analytics, risk, report, coach insights, level score and certificate eligibility); Playwright **6/6** smoke tests running against the production build (landing, login/register forms, signed-out redirects, security headers); fixed two real bugs found while testing — certificate percentages were rounded before comparison (79.59% wrongly passed an 80% rule) and Vitest had no `@/` alias so two production query modules could not be loaded by any test. Live-database tests (signup/login, trade CRUD, uploads, live RLS matrix, restore drill) are explicitly pending for Phases 13/14 — nothing live was claimed. Tested locally — see `docs/phase-12.md`.
- ✅ Phase 13: Production deployment — **live at https://itg-traderos.vercel.app** (Vercel project `itg-traderos`, deployment `dpl_GPjGVbmcqRuJg3iUFfZt6hBte5Q4`, READY). Migrations 0001–0016 applied to the live Supabase project via the Management API query endpoint (32 tables, RLS 32/32, 2 Storage buckets, 8 policies; migration 0016's redundant ALTER skipped — RLS was already on — buckets + policies applied in two parts, file untouched). Env vars set (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`). Live checks pass: `/` 200, `/login` 200, `/dashboard` 307 → `/login`, all six security headers. GitHub push still fails 403, so the deploy used the Vercel MCP file-upload route from a self-contained staging tree (`~/workspace/.itg-deploy-staging/`, vendored `@itg/calc`, pinned deps) — the repo and the deployment will drift until the GitHub route works. See `docs/phase-13.md`.
- ⚠️ Phase 14: Production verification — live API-level verification passed (84/88 harness checks; the 4 failures are explained in `docs/phase-14.md`: Supabase email rate limits and a PostgREST 204 misread — the trade was confirmed still present). Production seed applied and verified (9 strategies, 4 levels, 11 achievements, 8 motivation messages). Two real bugs found live and fixed in the live DB: migration 0018 fixes a `TG_OP` case bug in the privilege guards that blocked profile creation for every new trader, and migration 0017's seed is now idempotent. Full 32-table live RLS matrix in `docs/production-verification.md`. **Verdict: not yet fully verified for real users** — signed-in app flows were not exercised live from a real browser (this test environment's network blocks the required requests), PITR is off with no backups listed, and password-reset email delivery is unverified. See `docs/phase-14.md`.
- ⛔ **Still blocked:** GitHub commit (403 — App installation needs `ITG-trading-system` selected with Contents write).

## Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 15 App Router + TypeScript + React 19, Tailwind CSS + shadcn/ui |
| Backend / DB / Auth / Storage | Supabase (Postgres, Auth, Storage, Realtime, Edge Functions) |
| Money math | Postgres `numeric(19,6)` + `decimal.js` — never float |
| Deployment | Vercel (once connected) |
| Tests | Vitest (unit) + Playwright (E2E, Phase 12) |
| CI | GitHub Actions |

## Quick start (local, no Supabase needed for calc/tests)

```bash
npm install
npm test          # Vitest unit tests (packages/calc)
npm run typecheck # TypeScript, web app + calc package
npm run dev       # Next.js dev server (needs real Supabase env vars to log in)
```

Copy `.env.example` to `apps/web/.env.local` and fill in real Supabase
values only after the Supabase project exists. Never commit real keys.

## Layout

```
apps/web/            Next.js app (auth, onboarding, dashboard, trades, …)
packages/calc/       Pure TS calculations: P&L, ROI, R, RR, profit factor,
                     expectancy, drawdown, XP, levels — decimal.js only
supabase/migrations/ Versioned SQL, one migration per logical group
supabase/seed.sql    DEMO-ONLY seed data — never run in production
docs/                architecture.md, database.md, runbooks/
.github/workflows/   ci.yml
```

## Phases (spec §47)

0 Audit ✅ · 1 Architecture & DB ✅ · 2 Auth & onboarding ✅ ·
3 Core journal ✅ · 4 Dashboard & analytics ✅ · 5 Risk & psychology ✅ ·
6 Goals & discipline ✅ ·
7 Gamification ✅ · 8 Certificates & reports ✅ ·
9 AI Coach ✅ · 10 Admin ✅ (this phase) · 11 Hardening ·
12 Testing · 13 Deployment · 14 Production verification

Full plan: `~/workspace/your_files/ITG-TraderOS-Execution-Plan-v2.md`

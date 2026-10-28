# Phase 13 — Production Deployment

Status: **deployed to production, minimally verified live.**
Live URL: **https://itg-traderos.vercel.app**
(also `https://itg-traderos-ezattr12s-projects.vercel.app`; the deployment
URL was `itg-traderos-mexu4apz1-ezattr12s-projects.vercel.app`.)

- Vercel project `itg-traderos` (`prj_p8yHVfeLkTMGRP8uGYwDx19nXHL7`),
  framework `nextjs`, root directory `apps/web`, Node 24.x.
- Deployment `dpl_GPjGVbmcqRuJg3iUFfZt6hBte5Q4`, target `production`,
  state **READY** (2026-10-27). Three earlier deployments failed at the
  build step and are recorded below — the causes and the fixes are part
  of this phase's record, not hidden.
- Supabase project `ITG-trading-system` (`pwzvthvvxyfppenmessf`,
  ap-northeast-1, Postgres 17): migrations 0001–0016 applied via the
  Supabase Management API database query endpoint
  (`POST /v1/projects/{ref}/database/query`, no database password
  needed). Verified live: **32 public tables, RLS enabled on 32/32**,
  each with ≥1 policy; 2 Storage buckets (`avatars` public,
  `trade-screenshots` private); 8 Storage policies.
- Vercel env vars set (names only): `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` (sensitive), `SUPABASE_SERVICE_ROLE_KEY`
  (sensitive) — production + preview; `NEXT_PUBLIC_APP_URL`
  (production only, the live URL above).
- GitHub: **NOT committed.** The push still fails with the same error as
  since Phase 1 (see below). The deployment does NOT depend on GitHub:
  it was built from files uploaded through the Vercel MCP tools.
- Seed: **NOT applied.** `supabase/seed.sql` is explicitly DEV-ONLY
  ("DO NOT RUN THIS IN PRODUCTION") with an opt-in guard, so it was
  skipped per the Phase 13 brief. Consequence: the system-config tables
  (`strategies`, `levels`, `achievements`, `motivation_messages`) are
  EMPTY in production — see "Open follow-ups" below.
- Live checks done in this phase (minimal — full live verification is
  Phase 14): `/` → 200 and renders the real landing page; `/login` →
  200 and renders the real login form with no "Supabase is not
  connected" message; `/dashboard` signed out → 307 to
  `/login?next=%2Fdashboard`; all six Phase 11 security headers present
  (CSP, HSTS, X-Content-Type-Options nosniff, X-Frame-Options DENY,
  Referrer-Policy, Permissions-Policy).

## GitHub commit — still blocked (unchanged since Phase 1)

`push_files` to `Ezattr12/ITG-trading-system`, branch `main`, 227 files
(~1.5 MB, all UTF-8, within the snapshot limits) failed:

> `failed to create tree: POST https://api.github.com/repos/Ezattr12/ITG-trading-system/git/trees: 403 Resource not accessible by integration`

Repo state confirmed before the attempt: only the Initial commit
(`d0b4c930…`, empty README.md) exists. No sync record was advanced —
a failed write never advances it.

Fix needed (same as Phase 1): the GitHub App installation must have
`ITG-trading-system` selected with Contents write access:
https://github.com/apps/meta-muse-ai/installations/new — an account
owner must complete that selection, then the commit can be retried.
Until then, **do not claim the code is committed to GitHub.**

## Migrations — applied and verified

Route used: Supabase Management API database query endpoint. The
project's database was empty (0 public tables) before this phase.

- 0001–0015 applied cleanly, one file per call, HTTP 201 each.
- 0016 (`storage_buckets`) failed as a whole file with
  `42501: must be owner of table objects`. Root cause, found by
  testing each statement: `ALTER TABLE storage.objects ENABLE ROW
  LEVEL SECURITY` fails under the query endpoint's role even though
  it runs as `postgres` (Supabase restricts ALTER on the storage
  schema's tables), while `CREATE POLICY` on the same table succeeds.
  RLS was already enabled on `storage.objects`, so the ALTER was a
  no-op. Resolution: the bucket inserts were applied in their own
  call, then the 8 policies were applied in a second call (the ALTER
  line omitted). Verified: both buckets exist, all 8 policies exist.
  **The migration file itself was NOT edited** (forward-only rule);
  this deviation is recorded here only.
- Verification queries run against the live project afterwards:
  32 tables (list matches the Phase 1 schema exactly), RLS on 32/32,
  policies present on every table, 2 buckets, 8 storage policies.

## Deployment route — and why it is not the GitHub route

Plan v2 §8 assumes GitHub → Vercel auto-deploy. That route is
unavailable while the GitHub 403 stands, so this phase deployed via
the Vercel MCP tools instead: `upload_file` (one file per call,
base64 + SHA1) + `create_deployment` (file references by SHA/size).

Two hard limits of that route shaped the deployment:

1. **Single CLI arguments are capped at 128 KiB.** `package-lock.json`
   (294 KB) cannot be uploaded as one file. It was split into 70 KB
   chunks and reassembled by the install command. This worked once
   the chunks were inside the app directory (see point 2).
2. **Only files under the Vercel root directory (`apps/web`) reach
   the build container.** Three failed deployments proved this:
   - Deploy 1 (`dpl_HqVo5aeu…`): `npm install` exited 1 — install ran
     in `apps/web`, where `@itg/calc: *` (a workspace dependency)
     cannot resolve from the npm registry.
   - Deploy 2 (`dpl_4mySn4j…`): install command reassembled the
     lockfile from `../package-lock.json.??` — `enoent`, the chunks
     at the repo root never reached the build container.
   - Deploy 3 (`dpl_bFCtnUv…`): same command without `../` — still
     `enoent`, confirming repo-root files are unavailable at build
     time regardless of `sourceFilesOutsideRootDirectory=true`.
   - Deploy 4 (`dpl_GPjGVb…`): **READY.** Built from a self-contained
     staging tree (below).

Build logs could not be read for the failures: `list_deployment_events`
returns 403 ("re-authenticate to this scope") and no
`authorize_team_access` tool exists in the Vercel connector, so the
failure reasons above were established from `get_deployment`'s
`errorCode`/`errorMessage`/`errorStep` fields only. If build logs are
needed in future, Ezat must approve team-scope access through the
link the Vercel connector returns — that step was not available to
this phase.

## The staging tree — READ THIS BEFORE THE NEXT DEPLOY

The deployed code is **not byte-identical to the repo**. The repo is
an npm-workspaces monorepo (`@itg/calc` shared package); the Vercel
file-upload route cannot build that layout, so the deployment was
built from a staging tree at `~/workspace/.itg-deploy-staging/`:

- `apps/web/**` copied from the repo, plus:
  - `apps/web/lib/calc/index.ts` — a copy of
    `packages/calc/src/index.ts` (pure functions, only imports
    `decimal.js`, which is already an `apps/web` dependency).
  - `apps/web/tsconfig.json` — `@itg/calc` path remapped from
    `../../packages/calc/src/index.ts` to `./lib/calc/index.ts`.
  - `apps/web/package.json` — `@itg/calc` dependency removed; every
    direct dependency pinned to the exact version in the repo's root
    `package-lock.json` (no ranges).
  - `apps/web/next.config.ts` — `transpilePackages: ["@itg/calc"]`
    removed.
  - `apps/web/package-lock.json` — generated in the staging tree by
    `npm install --package-lock-only` (registry reachable), split
    into 4 chunks (`package-lock.json.aa`–`.ad`, 70 KB each) for
    upload; reassembled by the project's install command.
- Test files (`*.test.ts`) were excluded from the deployment.
- The staging tree was validated locally before deploying:
  `npm install` (431 packages) + `npm run build` — "Compiled
  successfully", 36 static pages. (Local `typecheck` shows only
  `Cannot find module 'vitest'` errors in the excluded test files;
  vitest is a root devDependency and is not part of the deployed app.)
- Vercel project settings set in this phase: install command
  `cat package-lock.json.?? > package-lock.json && npm install`,
  `sourceFilesOutsideRootDirectory=true`, SSO protection **disabled**
  (it was on for `all_except_custom_domains`, which would have
  blocked public access to the production site).

**Consequence for the repo:** the repo and the deployment will drift
unless this is resolved properly. The correct long-term fix is to get
the code into GitHub (fix the App installation) and let Vercel deploy
from Git — the git route handles the monorepo correctly. The staging
tree is a workaround, not the architecture. Do not edit the repo to
match the staging tree without a deliberate decision, and do not
delete `~/workspace/.itg-deploy-staging/` — the next deploy needs it
until the GitHub route works.

## Seed — skipped, and what that means

`supabase/seed.sql` refuses to run unless `itg.seed_dev_only` is set
to `'true'`, and its header says "DO NOT RUN THIS IN PRODUCTION.
Production starts EMPTY." Per the Phase 13 brief, it was skipped.
The data in it is system configuration only (9 strategies, 4 levels,
11 achievements, 3 motivation messages) — no demo trades, no fake
P&L, no fake users — but the file's own guard marks it dev-only, so
overriding the guard for production was not done.

Production consequence: `strategies`, `levels`, `achievements` and
`motivation_messages` are currently empty in the live database. The
app was designed for honest empty states, so nothing crashes, but
strategy selection, level thresholds and the achievements catalogue
have no rows until configuration is added. Follow-up for Phase 14 /
the parent: create a production-safe config seed (same rows, no
dev-only guard) as a reviewed migration or via the admin panel, and
verify the app reads it.

## Open follow-ups for Phase 14

- GitHub commit still blocked (App installation, see above) — retry
  the push once Ezat completes the repository selection, then switch
  Vercel to the GitHub route and retire the staging tree.
- Production config seed (strategies/levels/achievements/motivation)
  — see above.
- Full live verification (Phase 14's job, not claimed here): sign up,
  login, onboarding, trade CRUD, screenshot upload, live RLS matrix,
  goal/XP/certificate flows, backup/restore drill.
- Build-log access needs team-scope authorization if a future deploy
  fails opaquely (no `authorize_team_access` tool available in this
  phase).

## Verification summary (this phase)

| Check | Result |
|---|---|
| GitHub push (227 files) | ❌ 403 `Resource not accessible by integration` (unchanged blocker) |
| Migrations 0001–0015 | ✅ HTTP 201 each |
| Migration 0016 (buckets + 8 policies) | ✅ Applied in two parts; ALTER skipped (RLS already on) |
| Live tables | ✅ 32, RLS 32/32 |
| Live Storage buckets / policies | ✅ 2 buckets, 8 policies |
| Seed | ⏭️ Skipped (dev-only guard) |
| Vercel project created | ✅ `itg-traderos`, Next.js, root `apps/web` |
| Vercel env vars | ✅ 4 vars set by name (verified via list) |
| Deployments 1–3 | ❌ Build errors (npm install / lockfile chunks outside root dir) |
| Deployment 4 | ✅ READY — `dpl_GPjGVbmcqRuJg3iUFfZt6hBte5Q4` |
| Live `/` | ✅ 200, real landing page |
| Live `/login` | ✅ 200, real login form, no "not connected" message |
| Live `/dashboard` (signed out) | ✅ 307 → `/login?next=%2Fdashboard` |
| Live security headers | ✅ All 6 present |

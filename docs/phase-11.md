# Phase 11 — Security Hardening

Status: implemented locally, tested. **Supabase project
ITG-trading-system exists** (per the parent agent's brief) but
migrations have NOT been applied to it and its keys are NOT in
the app env yet — the new migrations and triggers below are
verified against the migration files, not against a live
database. Vercel is connected (per the parent agent's brief);
nothing is deployed yet (deployment is Phase 13). Not committed
to GitHub (GitHub App push still fails 403 — parent agent's
blocker, unchanged). No external AI/LLM service is connected.

## Spec covered

- §5, §43 Security hardening: RLS matrix, rate limits, audit,
  dependency + secret scan.

## Findings — two real privilege-escalation gaps, both fixed

### 1. A trader could promote themselves to admin (FIXED)

Postgres RLS has no column-level policies. The profiles
policies let any authenticated user UPDATE their own row —
including `role` and `verification_status` — and INSERT a row
with any role. The app's Server Actions never set those
columns, but a trader calling the Supabase API directly could
bypass the app entirely.

Fix — migration `0015_privilege_guards.sql`: BEFORE INSERT OR
UPDATE triggers on `profiles` that reject any change to `role`
or `verification_status` unless the caller is the service role
(used by the audit-logged admin actions) or a signed-in admin.
The same trigger guards `verification_records.status`.

### 2. Onboarding let a trader mark themselves "Verified" (FIXED)

Onboarding step 3 wrote the trader's `verification_status`
answer straight into `profiles.verification_status`, and the
profile page then displayed "Verified". Verification is an
admin-reviewed fact, not a self-declaration.

Fix — same phase, app + DB:
- `ONBOARDING_PROFILE_COLUMNS` (moved to
  `lib/auth/validation.ts` so it is unit-testable) no longer
  lists `verification_status` for any step; the answer is still
  validated and stored in `onboarding_profiles.answers` as the
  trader's own words. The wizard label now says
  "self-declared" and explains an admin reviews it.
- `profiles.verification_status` is set only by the admin
  verification action (service role, audit-logged), and the
  migration 0015 trigger enforces the same rule at the DB layer.

### 3. `is_admin()` search_path hijack (FIXED)

`public.is_admin()` is SECURITY DEFINER but ran with the
caller's `search_path`. Migration 0015 recreates it with
`SET search_path = public`.

## RLS matrix

Full table × role matrix: `docs/security.md`. Verified by
`apps/web/lib/security/rls-matrix.test.ts`, which parses the
migration files and asserts: 32 tables, RLS enabled on all,
at least one policy each, append-only / server-written tables
have no client insert/update/delete policy, `system_settings`
is admin-only, and the Phase 11 triggers exist.

Notable design points the matrix records:
- Admins can read other traders' rows at the RLS layer
  (needed for admin pages); the *financial* fields are gated
  one layer up, in the app, by the explicit audit-logged
  15-minute financial-view request (Phase 10).
- The `auditor` role exists in the enum but has NO distinct
  access anywhere — RLS grants it nothing and `adminGate`
  denies it. An auditor today is treated exactly like a
  trader. Wiring read-only auditor access is a deliberate
  product decision for a later phase. Two Phase 10 comments
  that claimed otherwise were corrected in this phase.
- `audit_logs`, `xp_transactions`, `risk_events`,
  `discipline_events`, `certificates`, `report_runs`,
  `ai_insights`, `user_levels`, `user_achievements` are
  client-read-only; all writes go through the service role
  from Server Actions.

## Rate limits

`lib/auth/rate-limit.ts` (in-memory sliding window; per
instance, best-effort on multi-instance Vercel — the call
sites do not change if a shared store is added later):

| Action | Limit |
|---|---|
| Login / signup | 5 per 15 min per email |
| Password reset | 3 per hour per email |
| Admin writes (each of the 7 actions) | 20 per min per admin, per action |
| Trade creation | 30 per 10 min per trader |
| File uploads (screenshot / avatar) | 10 per 10 min per trader |

Wired in `lib/admin/actions.ts` (all 7 mutating actions),
`lib/trades/actions.ts` (`createTradeAction`,
`uploadScreenshotAction`) and `lib/auth/actions.ts`
(`uploadAvatarAction`). New presets are tested in
`lib/auth/rate-limit.test.ts`.

## Security headers

`apps/web/lib/security/headers.ts` (unit-tested) applied to
every route from `next.config.ts`: HSTS (2 years,
includeSubDomains, preload), `X-Content-Type-Options:
nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy:
strict-origin-when-cross-origin`, `Permissions-Policy`
(camera/microphone/geolocation off), and a CSP
(`default-src 'self'`, scripts/styles `'self'
'unsafe-inline'` — Next.js needs inline scripts for
hydration, so a nonce-based CSP is a Phase 12+ item —
`connect-src` limited to the app and `*.supabase.co`,
`frame-ancestors 'none'`). Verified live: the production
build was started locally and `/login` returned 200 with all
six headers present.

## Service-role boundary

Verified by inspection and by `scripts/security-check.mjs`
(runs in CI): no `"use client"` file imports
`lib/supabase/server` or references
`createServiceRoleSupabaseClient`; only
`lib/supabase/server.ts` reads `SUPABASE_SERVICE_ROLE_KEY`.
Client components import Server Actions only — the action
reference stays server-side, the module is never bundled for
the browser. Service-role writes (risk events, discipline
events, XP, certificates, admin audit) are reachable only
from Server Actions / route handlers.

## Secrets and dependencies

- Secret sweep (this phase): no JWT, GitHub/AWS/Slack token
  or real key anywhere in tracked source — `npm run
  security:check` scans 196 files and passes. `.env.example`
  contains placeholders only; `.gitignore` covers `.env*`.
- `npm audit` could NOT run in this sandbox: the registry
  returns 403 `policy_denied` for the audit endpoint. It is
  now a CI step (`npm audit --audit-level=high`, runs on
  GitHub where the registry is reachable). No advisory was
  fixed or waived locally because none could be listed.
- CI (`.github/workflows/ci.yml`): checkout now uses
  `fetch-depth: 0` so gitleaks scans the full history (it
  already ran as `gitleaks/gitleaks-action@v2`); added the
  `security:check` and `npm audit` steps.

## Error handling and uploads

- Signup no longer returns Supabase's error message (it
  revealed whether an email is already registered — account
  enumeration); it returns a generic message. All other
  actions already returned generic messages.
- Uploads were already validated server-side (images only,
  screenshots 5 MB, avatars 2 MB, sanitised file names,
  per-user paths) — verified, unchanged.
- Storage: migration `0016_storage_buckets.sql` creates the
  `avatars` (public read, owner-only write — the app uses
  `getPublicUrl`) and `trade-screenshots` (private,
  owner-only read/write/delete, displayed via 1-hour signed
  URLs) buckets with matching `storage.objects` policies.
  Before this phase no bucket or Storage policy existed in
  any migration, so uploads failed until an admin created
  them by hand.

## What was NOT verified live

- No live-database RLS test was run: migrations are not
  applied to the Supabase project yet. The matrix test parses
  the migration files; a live role × table test is a Phase 12
  item against staging.
- `npm audit` results are unknown until CI runs on GitHub.

## Verification

- `npm test` — **296/296 pass** (271 before + 25 new: 6
  headers, 11 RLS matrix, 5 rate-limit presets, 3 onboarding
  columns)
- `npm run typecheck` — pass (web + calc)
- `npm run lint` — pass
- `npm run build` — pass
- `npm run security:check` — pass (196 files scanned)
- Live header smoke test — `/login` 200 with all six
  security headers present
- `npm audit` — NOT runnable in this sandbox (registry 403
  `policy_denied`); added as a CI step instead

## Files created / changed

- Created: `supabase/migrations/0015_privilege_guards.sql`,
  `supabase/migrations/0016_storage_buckets.sql`,
  `apps/web/lib/security/{headers,headers.test,rls-matrix.test}.ts`,
  `scripts/security-check.mjs`, `docs/phase-11.md`,
  `docs/security.md`
- Changed: `apps/web/next.config.ts` (headers),
  `apps/web/lib/auth/{rate-limit,rate-limit.test,validation,validation.test,actions}.ts`,
  `apps/web/lib/admin/{actions,access}.ts`,
  `apps/web/lib/trades/actions.ts`,
  `apps/web/components/onboarding/onboarding-wizard.tsx`,
  `package.json` (`security:check` script),
  `.github/workflows/ci.yml`, `docs/architecture.md`,
  `docs/phase-10.md` (auditor comment correction), `README.md`

# ITG TraderOS — Security: RLS Matrix & Hardening

Status: Phase 11. Verified against the migration files
(`supabase/migrations/0001–0016`), not against a live database
— migrations are not applied to the Supabase project yet, so a
live role × table test is a Phase 12 item against staging.
The matrix is regression-tested by
`apps/web/lib/security/rls-matrix.test.ts`, which parses the
migration files. Full Phase 11 report: `docs/phase-11.md`.

## Roles

- **anon** — signed-out. Sees nothing user-owned.
- **trader** — signed-in, `profiles.role = 'trader'` (default).
  Own rows only.
- **admin** — signed-in, `profiles.role = 'admin'`.
- **auditor** — `profiles.role = 'auditor'`. **No distinct access
  anywhere**: RLS grants it nothing (`public.is_admin()` checks
  `role = 'admin'` only) and `adminGate` denies it. An auditor
  today is treated exactly like a trader. Wiring read-only
  auditor access is a deliberate product decision for a later
  phase, not a silent default.

Legend: `R own` = read own rows · `R all` = read all rows ·
`W own` = insert/update own rows · `W admin` = admin-only write
· `—` = no access. "Server" = written only by the service-role
client from Server Actions (no client policy at all).

## Matrix — 32 tables

| Table | anon | trader | admin | auditor | Notes |
|---|---|---|---|---|---|
| profiles | — | R own, W own* | R all, W* | R own, W own* | *Trigger 0015: `role` / `verification_status` changeable only by service role or admin |
| onboarding_profiles | — | R own, W own | R all | R own, W own | Answers are the trader's own words |
| verification_records | — | R own, W insert* | R all, W | R own, W insert* | *Trigger 0015: `status` changeable only by service role or admin; insert must be `not_provided` |
| assets | — | R all | R all, W admin | R all | Shared reference data |
| strategies | — | R own + system, W own | R all, W own | R own + system, W own | System rows have `user_id` null; no delete policy |
| setups | — | R own + system, W own | R all, W own | R own + system, W own | As strategies |
| trades | — | R own, W own | R all | R own, W own | No delete: closed trades are corrected by reversal |
| trade_screenshots | — | R own, W own, delete own | R all | R own, W own, delete own | File itself is in private Storage (see below) |
| psychology_records | — | R own, W own | R all | R own, W own | |
| lessons | — | R own, W own | R all | R own, W own | |
| trading_plans | — | R own, W own | R all | R own, W own | |
| risk_rules | — | R own, W own | R all | R own, W own | |
| trading_sessions | — | R own, W own | R all | R own, W own | |
| goals | — | R own, W own | R all | R own, W own | |
| goal_progress | — | R own, W own | R all | R own, W own | |
| daily_activity | — | R own, W own | R all | R own, W own | |
| weekly_reviews | — | R own, W own | R all | R own, W own | |
| monthly_reviews | — | R own, W own | R all | R own, W own | |
| levels | — | R all | R all, W admin | R all | Config; thresholds editable by admin |
| achievements | — | R all | R all, W admin | R all | Config rows; new achievements need no code |
| user_levels | — | R own | R all | R own | Server-written only |
| user_achievements | — | R own | R all | R own | Server-written only |
| xp_transactions | — | R own | R all | R own | Server-written only; penalties are explicit rows |
| certificates | — | R own | R all | R own | Server-written only (issue/revoke via admin) |
| report_runs | — | R own | R all | R own | Server-written only |
| ai_insights | — | R own | R all | R own | Server-written only |
| motivation_messages | — | R all | R all, W admin | R all | Config |
| notifications | — | R own, update own | R all | R own, update own | Update = mark read; no client insert/delete |
| audit_logs | — | R own (user or actor) | R all | R own (user or actor) | Append-only: no insert/update/delete policy at all |
| risk_events | — | R own | R all | R own | Server-written only |
| discipline_events | — | R own | R all | R own | Server-written only |
| system_settings | — | — | R all, W admin | — | Admin only, read and write |

## Known residual risks (accepted, documented)

1. **Admin RLS read-all vs financial privacy.** RLS lets an
   admin read any trader's row, including financial fields.
   The financial gate lives one layer up, in the app: capital,
   income and historical P&L are shown only after an explicit,
   audit-logged financial-view request, valid 15 minutes
   (Phase 10). If the app gate were ever bypassed, RLS alone
   would not stop an admin reading financials. This is a
   conscious trade-off: the admin panel needs row access, and
   the audit trail is the control.
2. **In-memory rate limiting.** The limiter is per server
   instance; on multi-instance Vercel it is a best-effort
   guard, not a distributed one. Call sites are isolated in
   `lib/auth/rate-limit.ts`, so a shared store (e.g. Upstash
   Redis) can replace it without touching the actions.
3. **CSP uses `'unsafe-inline'`.** Next.js needs inline
   scripts for hydration data. A nonce-based CSP is a
   Phase 12+ improvement.
4. **No live RLS test yet.** The matrix test parses SQL.
   A live test (every role × every table, including a
   privilege-escalation attempt) must run against staging in
   Phase 12 once migrations are applied.

## Storage policies (migration 0016)

| Bucket | Public | Read | Write |
|---|---|---|---|
| `avatars` | yes | anyone | owner only, path `<user_id>/…` |
| `trade-screenshots` | no | owner only, path `<user_id>/…` | owner only, path `<user_id>/…` |

Avatars are public because the app serves them with
`getPublicUrl`; screenshots are private and displayed via
1-hour signed URLs.

## Service-role boundary

- Only `apps/web/lib/supabase/server.ts` reads
  `SUPABASE_SERVICE_ROLE_KEY`, and only
  `createServiceRoleSupabaseClient()` constructs that client.
- No `"use client"` file imports that module or references
  the service-role client. Client components import Server
  Action references only.
- Enforced by `scripts/security-check.mjs` (`npm run
  security:check`, runs in CI) and by the
  `gitleaks/gitleaks-action@v2` step (full-history checkout,
  `fetch-depth: 0`).

## Rate limits

| Action | Limit |
|---|---|
| Login / signup | 5 per 15 min per email |
| Password reset | 3 per hour per email |
| Admin writes (each of the 7 actions) | 20 per min per admin, per action |
| Trade creation | 30 per 10 min per trader |
| File uploads (screenshot / avatar) | 10 per 10 min per trader |

## Security headers

Applied to every route from `next.config.ts`
(`lib/security/headers.ts`): HSTS 2 years + subdomains +
preload, `nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy: camera=(), microphone=(),
geolocation=()`, CSP (`default-src 'self'`,
`connect-src` limited to the app and `*.supabase.co`,
`frame-ancestors 'none'`). Verified live against the
production build (`/login` 200, all six headers present).

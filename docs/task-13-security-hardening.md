# Task 13 — Security Hardening Audit

Date: 2026-11-02. Surface: web (Next.js app + Supabase). Scope: audit the
Phase 27/29 posture for drift, close finding F3, verify headers, admin
gates, auth surface, secrets, and the mobile API envelope. No feature,
visual, or financial-logic behaviour changes.

## Findings

| # | Area | Severity | Evidence | Outcome |
|---|------|----------|----------|---------|
| F3 | Engine functions exported from `"use server"` modules trusting a caller-supplied userId | Medium (latent) | Inventory below | **FIXED** — engines moved to non-`"use server"` modules; `getAuthorisedFinancials` now derives the admin from the session |
| H1 | Production security headers | — | Live `curl -sI /login` on 2026-11-02 | **Verified complete** — full baseline already shipped (Phase 11/27); no change made |
| H2 | `Access-Control-Allow-Origin: *` on the prerendered login page | Info | Live headers | Documented — Vercel platform behaviour for prerendered static pages; `*` without credentials mode exposes nothing beyond the public page itself; not set by app config |
| R1 | RLS / policy drift | — | Live Management-API queries (below) | **No drift** — exact baseline match |
| G1 | Admin gate pattern (Task 4 stream-leak class) | — | Code sweep | **Verified** — all 8 admin pages call `requireAdmin()` first; layout denies via `notFound()`; no other gating layout exists in the app |
| A1 | Open redirect via `next` param | — | Code sweep | **Verified** — the only consumer is `app/auth/callback/route.ts`, wrapped in `safeNextPath`; sign-out redirects to a fixed `/login` |
| S1 | Secrets in repo / workflows | — | `security:check` + targeted greps | **Clean** — see below |
| M1 | Mobile API envelope | — | Code + handler tests | **Verified unchanged** — identity fields → 400 naming the field, unknown keys → 400, byte-identical 404s, one `api.mobile.*` audit row per call |
| L1 | Rate limiting | Info | Code inventory | Documented — in-memory coach-chat bucket only (20/min per user); a shared store needs infra Ezat hasn't approved; not faked |

## F3 inventory and fix

Exports of `"use server"` modules that accepted a caller-supplied identity
(or a client object bound to one) instead of deriving it from the session:

| Function | Was in | Identity input | Fix |
|----------|--------|----------------|-----|
| `awardXp` | `lib/gamification/actions.ts` | `award.userId` | Moved to new `lib/gamification/service.ts` (no `"use server"`) |
| `logXpPenalty` | `lib/gamification/actions.ts` | `input.userId` (no live callers — dead but wire-exposed) | Moved to `lib/gamification/service.ts` |
| `checkAndAwardAchievements` | `lib/gamification/actions.ts` | `userId` param | Moved to `lib/gamification/service.ts` |
| `ensureLevelStored` | `lib/gamification/actions.ts` | `userId` param | Moved to `lib/gamification/service.ts` |
| `refreshGamification` | `lib/gamification/actions.ts` | `userId` param | Moved to `lib/gamification/service.ts` |
| `logRiskEvent` | `lib/risk/actions.ts` | `input.userId` | Moved to `lib/risk/service.ts` |
| `logDisciplineEvent` | `lib/discipline/actions.ts` (delegating wrapper over the service core) | `input.userId` | Wrapper deleted; callers import from `lib/discipline/service.ts` |
| `createNotification` | `lib/discipline/actions.ts` (delegating wrapper) | `input.userId` | Wrapper deleted; callers import from `lib/discipline/service.ts` |
| `ensureDisciplineReminderLogged` | `lib/discipline/actions.ts` | `userId` param | Moved verbatim into `lib/discipline/service.ts` |
| `getAuthorisedFinancials` | `lib/admin/actions.ts` | `userId` **and `adminId`** params | Signature now `(userId)` — the target only; the admin identity is derived inside via the module's session `requireAdmin()`, so the recent-audit authorisation check can only ever be evaluated against the caller's own grants |

Details:

- `lib/gamification/actions.ts` contained **only** engines (no genuine
  form actions), so the file was deleted outright; no Server Actions
  remain registered for gamification. All moves are verbatim — no
  behaviour, audit-row, XP, or response-shape change.
- Import sites repointed: `lib/trades/service.ts`, `lib/discipline/service.ts`,
  `lib/reviews/service.ts`, `lib/coach/service.ts`, `app/levels/page.tsx`,
  `app/achievements/page.tsx` (gamification); `lib/trades/service.ts`
  (risk); `lib/certificates/actions.ts`, `app/levels/page.tsx`,
  `app/achievements/page.tsx`, `app/dashboard/page.tsx` (discipline).
- `lib/certificates/actions.test.ts`: the `vi.mock` target for
  `createNotification` moved with the import (`@/lib/discipline/actions`
  → `@/lib/discipline/service`); the mock factory and every assertion are
  unchanged.
- Per the Phase 29 constraint, **no session check was added inside any
  shared service core** — the mobile Bearer path calls the same cores
  legitimately. The fix removes wire reachability, not internal trust.
- Proof sweep after the fix: every remaining export of every `"use server"`
  module is a form action taking `(_prev, FormData)` / `(FormData)`,
  except `getAuthorisedFinancials(userId)` (target id only, session-gated
  inside — the same pattern as the admin form actions, whose target user
  id arrives via form data behind `requireAdmin()`). The three service
  modules contain no `"use server"` directive (verified by first-line
  inspection; the string appears only inside explanatory comments).

## Headers — before / after

Production (`/login`, 2026-11-02, also reproduced byte-identically by the
local production build after this task's changes):

- `Content-Security-Policy: default-src 'self'; script-src 'self'
  'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:
  blob: https:; font-src 'self' data:; connect-src 'self'
  https://*.supabase.co wss://*.supabase.co; object-src 'none';
  frame-ancestors 'none'; form-action 'self'; base-uri 'self'`
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

The canonical baseline is complete, so **no header changes were made**.
The one known CSP weakness is `script-src 'unsafe-inline'`, required by
Next.js's inline hydration bootstrap. Nonce plan (unchanged from the
Phase 11 note in `lib/security/headers.ts`, recorded here as the accepted
path when it is scheduled): generate a per-request nonce in middleware,
thread it via a request header, have Next stamp its inline scripts with
it, and set `script-src 'self' 'nonce-…' 'strict-dynamic'`. It was not
implemented in this task because it touches every page render and the
risk/benefit does not justify it inside a hardening pass whose other
items are zero-behaviour-change; the current policy already confines
scripts to `'self'` + inline bootstrap, with `object-src 'none'`,
`base-uri 'self'`, and `frame-ancestors 'none'`.

## RLS verification (live, Management API, 2026-11-02)

- Public tables: **32**; tables with RLS disabled: **0**
- Public-schema policies: **72**; storage policies: **8** (80 total — exact
  Phase 29 baseline, zero drift)
- Append-only tables: `audit_logs`, `xp_transactions`, `risk_events` each
  carry exactly **one SELECT policy and no INSERT/UPDATE/DELETE policy** —
  writes happen only through the service role, as designed
- Buckets: `trade-screenshots` private (`public = false`);
  `avatars` public-read **by design** (profile photos are public assets;
  writes remain owner-scoped by policy)

## Secrets scan

- `npm run security:check`: passed (404 files scanned)
- `.github/workflows/mobile-apk.yml` embeds only the Supabase **anon** key
  (JWT `role` claim decoded and confirmed `anon`, project ref matches) —
  public by design, it ships inside every app binary. `ci.yml` contains
  no key material.
- `SUPABASE_SERVICE_ROLE_KEY` is referenced in exactly one place in the
  web app: `lib/supabase/server.ts` (the server-only client factory).
  No service-role reference exists in the mobile app or client components.

## Gate results (2026-11-02, env sourced from ~/workspace/.itg-helpers/itg-env.sh)

- Vitest: **803/803 passed** (76 files) — baseline count unchanged; no
  test added or removed (one mock path retargeted, assertions untouched)
- Typecheck (web + calc): clean
- Lint: 0 errors, 1 warning (pre-existing `@next/next/no-img-element` on
  the dashboard page)
- Production build: clean; all authenticated routes still ƒ Dynamic
- security:check: passed (404 files)
- Playwright e2e (repo root, CI=true): **36/36 passed**, including
  "login page is served with the security headers"
- Local production render check (build on :3100, test account A session):
  /dashboard 200 with A's data, /levels 200 with XP 390, /achievements
  200, /coach 200, /login (signed-out) 200 with the full header set,
  /admin as non-admin A → 404. These renders exercise every moved engine
  (dashboard reminder, levels/achievements refresh, coach).
- Test account A re-verified after all checks: **10 trades, XP 390**,
  auth.users total 4 — baseline untouched.

## Ezat-side items — untouched, as instructed

- **Supabase PITR**: still off; enabling it is a dashboard/billing action
  only Ezat can take.
- **Shared/external rate-limit store**: drafted in Phase 29, needs infra
  approval; the in-memory per-instance coach-chat limiter is the current
  state and is documented as such (L1) — no distributed limiter was faked.
- **Monitoring sign-ups** (Sentry/uptime): not actioned; Ezat's accounts
  are required.
- **Verification test account A fate** and the **F4 achievement-criteria**
  question remain Ezat's open decisions, unaffected by this task.
